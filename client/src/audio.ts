import { OUT_RATE, decibel } from '@lbw/extract';
import type { SoundPcm } from './romPanel';

/**
 * Game sound in the browser, from the player's own ROM (docs/re-notes/sound.md).
 *
 * Effects are rendered once by the ROM worker the way the DS sound driver plays them and
 * cached as AudioBuffers. Like the game, each sound player holds a few sequences at once
 * (PLAYER_EFFECTS 8, PLAYER_INTERFACE 4, from the archive's player table): starting one more
 * stops the oldest, which fades out over the instrument's release.
 */

export interface SoundSource {
  /** Sequence archives (name, effect labels) and music stream names, from the ROM summary. */
  labels(): { arcs: { name: string; seqs: string[] }[]; strms: string[] } | null;
  render(req: { effect: { arc: number; index: number } } | { music: number }): Promise<SoundPcm | null>;
}

/** The game's option bytes: 0..127 each (profile options; a new profile has music 50, effects 127). */
export interface AudioSettings {
  music: number;
  effects: number;
}

/** A 0..127 volume through the sound library's curve (20 log10(v / 127) dB, `SNDi_DecibelTable`). */
export const volumeGain = (v: number): number => (v <= 0 ? 0 : 10 ** (decibel(Math.min(127, v)) / 200));

const SETTINGS_KEY = 'ob.audio';
/** One DS frame (VBlank, ~59.8 Hz). */
const FRAME_MS = 1000 / 59.8261;
/** Sequences each player can hold (archive PLAYER block: max sequences per player). */
const PLAYER_LIMIT = [8, 4];
/** Release 125 on every instrument: 0x1E00 per 5.2 ms frame from 0 to -72.3 dB, about 63 ms. */
const RELEASE_S = 0.063;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private buffers = new Map<string, Promise<{ buffer: AudioBuffer; player: number } | null>>();
  private voices: { player: number; src: AudioBufferSourceNode; gain: GainNode; started: number }[] = [];
  private music: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Music wanted before audio was unlocked or while it was still decoding. */
  private wantMusic: { name: string; loop: boolean } | null = null;
  /** Music stream being decoded. */
  private pendingMusic: string | null = null;
  private labelIndex: Map<string, { arc: number; index: number }> | null = null;
  settings: AudioSettings = { music: 50, effects: 127 };

  constructor(private source: SoundSource) {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<AudioSettings> | null;
      const ok = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 127;
      if (s && ok(s.music) && ok(s.effects)) this.settings = { music: s.music, effects: s.effects };
    } catch {
      /* storage blocked: defaults */
    }
    // Browsers only start audio from a user gesture.
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'running') {
        removeEventListener('pointerdown', unlock, true);
        removeEventListener('keydown', unlock, true);
      }
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.fxBus = this.ctx.createGain();
      this.fxBus.connect(this.master);
      this.applySettings();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.kick());
    else this.kick();
    return this.ctx;
  }

  /** Start music that was asked for before audio could run. */
  private kick() {
    const w = this.wantMusic;
    if (w && !this.music && !this.pendingMusic && this.ctx?.state === 'running') this.playMusic(w.name, w.loop);
  }

  setSettings(s: AudioSettings) {
    this.settings = s;
    this.applySettings();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  private applySettings() {
    if (this.musicBus) this.musicBus.gain.value = volumeGain(this.settings.music);
    if (this.fxBus) this.fxBus.gain.value = volumeGain(this.settings.effects);
  }

  /** Drop cached sounds (a different ROM was loaded). */
  reset() {
    this.buffers.clear();
    this.labelIndex = null;
    this.stopMusic();
  }

  private find(label: string): { arc: number; index: number } | undefined {
    if (!this.labelIndex) {
      const l = this.source.labels();
      if (!l) return undefined;
      this.labelIndex = new Map();
      l.arcs.forEach((a, arc) => a.seqs.forEach((s, index) => s && this.labelIndex!.set(s, { arc, index })));
    }
    return this.labelIndex.get(label);
  }

  private load(key: string, req: Parameters<SoundSource['render']>[0]) {
    let p = this.buffers.get(key);
    if (!p) {
      p = this.source.render(req).then((pcm) => {
        const ctx = this.ensure();
        if (!pcm || !ctx || pcm.left.length === 0) return null;
        const buffer = ctx.createBuffer(2, pcm.left.length, OUT_RATE);
        buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
        buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
        return { buffer, player: pcm.player };
      });
      this.buffers.set(key, p);
    }
    return p;
  }

  /** Render these effects ahead of time so the first play isn't late. */
  preload(labels: Iterable<string>) {
    for (const l of labels) {
      const at = this.find(l);
      if (at) void this.load(`${at.arc}:${at.index}`, { effect: at });
    }
  }

  /** Play an effect by label (SE_...). Missing labels are ignored. */
  play(label: string) {
    const at = this.find(label);
    if (at) this.playSeq(at.arc, at.index);
  }

  /** (arc, index) -> time it last started: the game starts each at most once per frame (0x02155798). */
  private startedAt = new Map<string, number>();

  /** Play effect `index` of sequence archive `arc`. */
  playSeq(arc: number, index: number) {
    const key = `${arc}:${index}`;
    const now = performance.now();
    if (now - (this.startedAt.get(key) ?? -1e9) < FRAME_MS) return;
    this.startedAt.set(key, now);
    void this.load(key, { effect: { arc, index } }).then((s) => {
      const ctx = this.ctx;
      if (!s || !ctx || ctx.state !== 'running' || !this.fxBus) return;
      const limit = PLAYER_LIMIT[s.player] ?? 8;
      const mine = this.voices.filter((v) => v.player === s.player);
      if (mine.length >= limit) this.stopVoice(mine[0]!);
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      const gain = ctx.createGain();
      src.connect(gain).connect(this.fxBus);
      const v = { player: s.player, src, gain, started: ctx.currentTime };
      this.voices.push(v);
      src.onended = () => {
        const i = this.voices.indexOf(v);
        if (i >= 0) this.voices.splice(i, 1);
      };
      src.start();
    });
  }

  private stopVoice(v: GameAudio['voices'][number]) {
    const ctx = this.ctx!;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime);
    v.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + RELEASE_S);
    v.src.stop(ctx.currentTime + RELEASE_S);
  }

  /** Music stream name by number, if the ROM has it. */
  strmName(n: number): string | undefined {
    return this.source.labels()?.strms[n];
  }

  musicPlaying(): boolean {
    return !!this.music || !!this.wantMusic;
  }

  /** Start a music stream (STRM_...); replaces the current one. */
  playMusic(name: string, loop = true) {
    if (this.music?.name === name || (this.pendingMusic === name && this.wantMusic?.name === name)) return;
    this.stopMusic();
    this.wantMusic = { name, loop };
    const n = this.source.labels()?.strms.indexOf(name) ?? -1;
    if (n < 0) return;
    this.pendingMusic = name;
    void this.load(name, { music: n }).then((s) => {
      if (this.pendingMusic === name) this.pendingMusic = null;
      const ctx = this.ctx;
      if (!s || !ctx || ctx.state !== 'running' || !this.musicBus || this.wantMusic?.name !== name || this.music) return;
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      src.loop = loop;
      const gain = ctx.createGain();
      src.connect(gain).connect(this.musicBus);
      this.music = { name, src, gain };
      src.onended = () => {
        if (this.music?.src === src) this.music = null;
        this.onMusicEnd?.(name);
      };
      src.start();
    });
  }

  /** Called when a non-looping music stream finishes. */
  onMusicEnd: ((name: string) => void) | null = null;

  stopMusic() {
    this.wantMusic = null;
    const m = this.music;
    this.music = null;
    if (!m || !this.ctx) return;
    m.src.onended = null;
    m.src.stop();
  }
}
