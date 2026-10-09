import { instrumentRegion, type Instrument, type Swav } from './sdat';

/**
 * Renders a Nitro sequence to PCM the way the DS sound driver plays it.
 *
 * DS background: the ARM7 sound driver wakes every 64 * 2728 CPU cycles (~5.21 ms, the
 * "sound frame"). Each frame it updates every channel's envelope and volume, then runs the
 * sequencer: a tempo counter gains `tempo` per frame and the tracks advance one tick per 240.
 * The hardware mixer samples each channel at 33.513982 MHz / 1024 = 32728.5 Hz with no
 * interpolation: a channel steps one source sample every `timer` ticks of 16.756991 MHz,
 * which is `512 / timer` source samples per output sample.
 *
 * Every LEGO Battles effect is "program change, one note (velocity 127, length 0 = until the
 * sample ends), end" and every instrument is one PCM region with ADSR 127/127/127/125, so the
 * opcodes below cover the archive with room to spare; anything else throws.
 */

export const ARM7_CLOCK = 33513982;
/** Mixer output rate. */
export const OUT_RATE = ARM7_CLOCK / 1024;
/** Output samples per sound frame: 64 * 2728 cycles / 1024. */
const SAMPLES_PER_FRAME = (64 * 2728) / 1024;

/** 200 * log10(x / 127): linear 0..127 to tenths of a dB (driver table `SNDi_DecibelTable`). */
export const decibel = (x: number): number => (x <= 0 ? -32768 : Math.round(200 * Math.log10(x / 127)));
/** 400 * log10(x / 127), floor -722 (`SNDi_DecibelSquareTable`, used for volume, velocity, sustain). */
export const decibelSquare = (x: number): number => (x <= 0 ? -32768 : Math.max(-722, Math.round(400 * Math.log10(x / 127))));
/** (2^(i/768) - 1) * 65536 (`SNDi_PitchTable`, 768 steps per octave). */
const PITCH = Int32Array.from({ length: 768 }, (_, i) => Math.round((2 ** (i / 768) - 1) * 65536));
/** Attack rates for attack values 109..127, indexed by 127 - attack (from the ARM7 driver). */
const ATTACK_TAIL = [0, 1, 5, 14, 26, 38, 51, 63, 73, 84, 92, 100, 109, 116, 123, 127, 132, 137, 143];
/** Quarter sine, 0..127, for modulation (from the ARM7 driver). */
const SINE = [0, 6, 12, 19, 25, 31, 37, 43, 49, 54, 60, 65, 71, 76, 81, 85, 90, 94, 98, 102, 106, 109, 112, 115, 117, 120, 122, 123, 125, 126, 126, 127, 127];

/** Envelope floor: -72.3 dB, << 7. */
const AMPL_FLOOR = -723 << 7;
const AMPL_K = 723;

export function attackRate(a: number): number {
  a = Math.min(a, 127);
  return a >= 109 ? ATTACK_TAIL[127 - a]! : 255 - a;
}
export function fallRate(r: number): number {
  r = Math.min(r, 127);
  if (r === 127) return 0xffff;
  if (r === 126) return 0x3c00;
  if (r < 50) return r * 2 + 1;
  return Math.floor(0x1e00 / (126 - r));
}

/** `SND_CalcTimer`: scales a channel timer period by `pitch` 64ths of a semitone. */
export function adjustTimer(timer: number, pitch: number): number {
  let shift = 0;
  pitch = -pitch;
  while (pitch < 0) {
    shift--;
    pitch += 768;
  }
  while (pitch >= 768) {
    shift++;
    pitch -= 768;
  }
  let t = timer * (PITCH[pitch]! + 0x10000);
  shift -= 16;
  t = shift <= 0 ? Math.floor(t / 2 ** -shift) : t * 2 ** shift;
  return Math.min(0xffff, Math.max(0x10, t));
}

/**
 * Linear gain of a channel for a total level in tenths of a dB above -72.3 dB (0..723). The
 * hardware gets a 7-bit volume plus a divider (1, 2, 4, 16) from the driver's table; this is
 * that table's curve, 10^((t - 723) / 200), without its 7-bit rounding (under 1%).
 */
export const levelGain = (t: number): number => (t <= 0 ? 0 : (127 / 128) * 10 ** ((Math.min(t, AMPL_K) - AMPL_K) / 200));

const sine = (i: number) => (i < 32 ? SINE[i]! : i < 64 ? SINE[64 - i]! : i < 96 ? -SINE[i - 64]! : -SINE[128 - i]!);

const enum St {
  Start,
  Attack,
  Decay,
  Sustain,
  Release,
}

interface Channel {
  track: Track;
  swav: Swav;
  state: St;
  /** Timer period before track pitch/modulation. */
  timer: number;
  /** Source sample position. */
  pos: number;
  length: number;
  ampl: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  velocity: number;
  /** Instrument pan - 64. */
  initPan: number;
  modDelayCount: number;
  modCounter: number;
  mod: Track['mod'];
  /** Live mixer settings. */
  gain: number;
  pan: number;
  step: number;
}

interface Track {
  pos: number;
  wait: number;
  end: boolean;
  noteWait: boolean;
  program: number;
  volume: number;
  expression: number;
  /** -64..63. */
  pan: number;
  transpose: number;
  bend: number;
  bendRange: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  mod: { depth: number; speed: number; type: number; range: number; delay: number };
  stack: { pos: number; count: number }[];
}

export interface SeqSource {
  /** Sequence bytes; commands address offsets within it. */
  data: Uint8Array;
  /** Offset of the first command. */
  offset: number;
  /** Sequence volume 0..127 (from the SSAR record). */
  volume: number;
  /** Bank instruments by program number. */
  instruments: (Instrument | null)[];
  /** Sample `wave` of the bank's wave archive slot `waveArc`. */
  sample(waveArc: number, wave: number): Swav;
}

export interface RenderOptions {
  /** Extra level in tenths of a dB (player/handle volume). */
  extraLevel?: number;
  /** Stop after this many seconds even if notes still sound (looping samples). */
  maxSeconds?: number;
}

/** Renders a sequence to stereo PCM at `OUT_RATE`. */
export function renderSeq(src: SeqSource, opts: RenderOptions = {}): { left: Float32Array; right: Float32Array } {
  const d = src.data;
  const seqLevel = decibelSquare(src.volume) + (opts.extraLevel ?? 0);
  const maxFrames = Math.ceil(((opts.maxSeconds ?? 30) * OUT_RATE) / SAMPLES_PER_FRAME);
  const tracks: Track[] = [];
  const channels: Channel[] = [];
  let tempo = 120;
  // The driver's tempo counter starts full, so the first frame already ticks (guess, see sound.md).
  let tempoCount = 240;

  const newTrack = (pos: number): Track => ({
    pos,
    wait: 0,
    end: false,
    noteWait: true,
    program: 0,
    volume: 127,
    expression: 127,
    pan: 0,
    transpose: 0,
    bend: 0,
    bendRange: 2,
    attack: 0xff,
    decay: 0xff,
    sustain: 0xff,
    release: 0xff,
    mod: { depth: 0, speed: 16, type: 0, range: 1, delay: 0 },
    stack: [],
  });
  tracks.push(newTrack(src.offset));

  const varlen = (t: Track) => {
    let v = 0;
    for (;;) {
      const c = d[t.pos++]!;
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
  };
  const u24 = (t: Track) => {
    const v = d[t.pos]! | (d[t.pos + 1]! << 8) | (d[t.pos + 2]! << 16);
    t.pos += 3;
    return v;
  };
  const s16 = (t: Track) => {
    const v = ((d[t.pos]! | (d[t.pos + 1]! << 8)) << 16) >> 16;
    t.pos += 2;
    return v;
  };

  const noteOn = (t: Track, key: number, velocity: number, length: number) => {
    const ins = src.instruments[t.program];
    if (!ins) return;
    const def = instrumentRegion(ins, key);
    if (!def) return;
    if (def.type !== 1) throw new Error(`Instrument type ${def.type} (PSG/noise) is not supported`);
    const swav = src.sample(def.waveArc, def.wave);
    channels.push({
      track: t,
      swav,
      state: St.Start,
      timer: adjustTimer(swav.timer, (key - def.key) * 64),
      pos: 0,
      length,
      ampl: AMPL_FLOOR,
      attack: attackRate(t.attack !== 0xff ? t.attack : def.attack),
      decay: fallRate(t.decay !== 0xff ? t.decay : def.decay),
      sustain: t.sustain !== 0xff ? t.sustain : def.sustain,
      release: fallRate(t.release !== 0xff ? t.release : def.release),
      velocity: decibelSquare(velocity),
      initPan: def.pan - 64,
      modDelayCount: 0,
      modCounter: 0,
      mod: { ...t.mod },
      gain: 0,
      pan: 64,
      step: 0,
    });
  };

  /** One sequencer tick of a track: count down the wait, then run commands until the next wait. */
  const runTrack = (t: Track) => {
    if (t.end) return;
    for (const c of channels) if (c.track === t && c.state < St.Release && c.length > 0 && --c.length === 0) c.state = St.Release;
    if (t.wait > 0 && --t.wait > 0) return;
    while (t.wait === 0 && !t.end) {
      const cmd = d[t.pos++]!;
      if (cmd < 0x80) {
        const velocity = d[t.pos++]!;
        const length = varlen(t);
        noteOn(t, Math.min(127, Math.max(0, cmd + t.transpose)), velocity, length);
        if (t.noteWait) t.wait = length;
        continue;
      }
      switch (cmd) {
        case 0x80: t.wait = varlen(t); break;
        case 0x81: t.program = varlen(t); break;
        case 0x93: { const n = d[t.pos++]!; const at = u24(t); if (n > 0) tracks.push(newTrack(at)); break; }
        case 0x94: t.pos = u24(t); break;
        case 0x95: { const at = u24(t); t.stack.push({ pos: t.pos, count: 0 }); t.pos = at; break; }
        case 0xfd: { const r = t.stack.pop(); if (r) t.pos = r.pos; else t.end = true; break; }
        case 0xd4: t.stack.push({ pos: t.pos + 1, count: d[t.pos]! }); t.pos++; break;
        case 0xfc: {
          const top = t.stack[t.stack.length - 1];
          if (!top) break;
          if (top.count === 0 || --top.count > 0) t.pos = top.pos;
          else t.stack.pop();
          break;
        }
        case 0xc0: t.pan = d[t.pos++]! - 64; break;
        case 0xc1: t.volume = d[t.pos++]!; break;
        case 0xc3: t.transpose = (d[t.pos++]! << 24) >> 24; break;
        case 0xc4: t.bend = (d[t.pos++]! << 24) >> 24; break;
        case 0xc5: t.bendRange = d[t.pos++]!; break;
        case 0xc6: t.pos++; break; // priority: only matters when channels run out
        case 0xc7: t.noteWait = d[t.pos++]! !== 0; break;
        case 0xca: t.mod.depth = d[t.pos++]!; break;
        case 0xcb: t.mod.speed = d[t.pos++]!; break;
        case 0xcc: t.mod.type = d[t.pos++]!; break;
        case 0xcd: t.mod.range = d[t.pos++]!; break;
        case 0xd0: t.attack = d[t.pos++]!; break;
        case 0xd1: t.decay = d[t.pos++]!; break;
        case 0xd2: t.sustain = d[t.pos++]!; break;
        case 0xd3: t.release = d[t.pos++]!; break;
        case 0xd5: t.expression = d[t.pos++]!; break;
        case 0xe0: t.mod.delay = s16(t); break;
        case 0xe1: tempo = s16(t) & 0xffff; break;
        case 0xfe: t.pos += 2; break; // track allocation mask; 0x93 opens the tracks
        case 0xff: t.end = true; break;
        default: throw new Error(`Sequence opcode 0x${cmd.toString(16)} at ${t.pos - 1} is not supported`);
      }
    }
  };

  /** The driver's per-frame channel update: envelope, modulation, then volume/pan/pitch. */
  const updateChannel = (c: Channel): boolean => {
    switch (c.state) {
      case St.Start:
        c.ampl = AMPL_FLOOR;
        c.state = St.Attack;
      // falls through
      case St.Attack:
        c.ampl = Math.trunc((c.attack * c.ampl) / 255);
        if (c.ampl === 0) c.state = St.Decay;
        break;
      case St.Decay: {
        c.ampl -= c.decay;
        const s = decibelSquare(c.sustain) << 7;
        if (c.ampl <= s) {
          c.ampl = s;
          c.state = St.Sustain;
        }
        break;
      }
      case St.Sustain:
        break;
      case St.Release:
        c.ampl -= c.release;
        if (c.ampl <= AMPL_FLOOR) return false;
        break;
    }
    const t = c.track;
    let modParam = 0;
    let modOn = c.mod.depth !== 0;
    if (modOn && c.modDelayCount < c.mod.delay) {
      c.modDelayCount++;
      modOn = false;
    }
    if (modOn) {
      modParam = sine(c.modCounter >> 8) * c.mod.range * c.mod.depth;
      modParam = c.mod.type === 1 ? Math.floor((modParam * 60) / 2 ** 14) : modParam >> 8;
      const speed = c.mod.speed << 6;
      let counter = (c.modCounter + speed) >> 8;
      while (counter >= 0x80) counter -= 0x80;
      c.modCounter = ((c.modCounter + speed) & 0xff) | (counter << 8);
    }
    const ext = seqLevel + decibelSquare(t.volume) + decibelSquare(t.expression);
    let level = (c.ampl >> 7) + Math.max(ext, -0x8000) + c.velocity + AMPL_K;
    if (modOn && c.mod.type === 1) level += modParam;
    c.gain = levelGain(level);
    let pan = t.pan + c.initPan + 64;
    if (modOn && c.mod.type === 2) pan += modParam;
    c.pan = Math.min(127, Math.max(0, pan));
    let tune = (t.bend * t.bendRange * 64) >> 7;
    if (modOn && c.mod.type === 0) tune += modParam;
    c.step = 512 / adjustTimer(c.timer, tune);
    return true;
  };

  const left: number[] = [];
  const right: number[] = [];
  /** Output length up to the last sample any channel played (the final frame is cut there). */
  let sounding = 0;
  let frac = 0;
  for (let frame = 0; frame < maxFrames; frame++) {
    for (let i = channels.length - 1; i >= 0; i--) if (!updateChannel(channels[i]!)) channels.splice(i, 1);
    while (tempoCount >= 240) {
      tempoCount -= 240;
      for (const t of [...tracks]) runTrack(t);
    }
    tempoCount += tempo;
    // Mix this frame's output samples. Channels that started this frame wait for their first update.
    frac += SAMPLES_PER_FRAME;
    const n = Math.floor(frac);
    frac -= n;
    const live = channels.filter((c) => c.state !== St.Start);
    for (let s = 0; s < n; s++) {
      let l = 0;
      let r = 0;
      for (const c of live) {
        const w = c.swav;
        if (c.pos >= w.pcm.length) continue;
        sounding = left.length + 1;
        const v = w.pcm[Math.floor(c.pos)]! * c.gain;
        l += (v * (128 - c.pan)) / 128;
        r += (v * c.pan) / 128;
        c.pos += c.step;
        if (c.pos >= w.pcm.length && w.loop) c.pos = w.loopStart + ((c.pos - w.pcm.length) % Math.max(1, w.pcm.length - w.loopStart));
      }
      left.push(l);
      right.push(r);
    }
    // A one-shot sample that ran out frees its channel (the driver kills channels the hardware stopped).
    for (let i = channels.length - 1; i >= 0; i--) {
      const c = channels[i]!;
      if (c.state !== St.Start && c.pos >= c.swav.pcm.length) channels.splice(i, 1);
    }
    if (channels.length === 0 && tracks.every((t) => t.end)) break;
  }
  return { left: Float32Array.from(left.slice(0, sounding)), right: Float32Array.from(right.slice(0, sounding)) };
}

/**
 * Plays a stream channel through the mixer: the channel timer is 16756991 / rate (whole
 * ticks), and the mixer holds each source sample until the next (no interpolation), as the
 * hardware does.
 */
export function holdResample(pcm: Float32Array, rate: number): Float32Array {
  const step = 512 / Math.floor(ARM7_CLOCK / 2 / rate);
  const out = new Float32Array(Math.floor(pcm.length / step));
  for (let i = 0; i < out.length; i++) out[i] = pcm[Math.floor(i * step)]!;
  return out;
}
