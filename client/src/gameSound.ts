import { PLAYING, ROLE_HERO, WON, type World } from '@lbw/sim';
import type { GameAudio } from './audio';
import {
  BATTLE_MUSIC_TICKS,
  HERO_ALERT_TICKS,
  MUSIC_BATTLE,
  MUSIC_CALM,
  MUSIC_DEFEAT,
  MUSIC_FE,
  MUSIC_VICTORY,
  MusicPlan,
  selectionSounds,
  tickSounds,
  type SoundEvent,
} from './soundRules';

/**
 * Plays the game's sounds and music for what happens in the match and the menus
 * (docs/re-notes/sound-triggers.md). Owns the music plan; reads sim state, never writes it.
 */
export class GameSound {
  private plan = new MusicPlan();
  private chop = new Map<number, number>();
  /** Tick of the last "hero under attack" alert, or null before the first. */
  private heroAlert: number | null = null;
  private inMatch = false;

  constructor(private audio: GameAudio) {
    audio.onMusicEnd = () => this.nextTrack();
  }

  private nextTrack() {
    const n = this.plan.next();
    const name = this.audio.strmName(n);
    // The front-end theme and the victory/defeat tracks have one-entry lists: they repeat.
    const repeats = this.plan.type === MUSIC_FE || this.plan.type >= MUSIC_VICTORY;
    if (name) this.audio.playMusic(name, repeats);
  }

  /** Switch music type with a hard cut, as the game does. */
  private setType(t: number) {
    this.plan.setType(t);
    this.audio.stopMusic();
    this.nextTrack();
  }

  menu() {
    this.inMatch = false;
    if (this.plan.type === MUSIC_FE && this.plan.faction === 6 && this.audio.musicPlaying()) return;
    this.plan.setFaction(6);
    this.setType(MUSIC_FE);
  }

  /** Match loaded: calm music of the local player's faction (0 King .. 5 Alien). */
  matchStart(faction: number) {
    this.inMatch = true;
    this.heroAlert = null;
    this.chop.clear();
    this.plan.setFaction(faction);
    this.setType(MUSIC_CALM);
  }

  /** Sounds and music for one sim tick. `heard(unitId, world)` is the view test. */
  tick(before: World, after: World, localPlayer: number, heard: (id: number, w: World) => boolean) {
    for (const e of tickSounds(before, after, localPlayer, this.chop)) {
      if (e.at === 0 || heard(e.at, after) || heard(e.at, before)) this.play(e);
    }
    if (!this.inMatch) return;
    const me = (w: World) => w.players.find((p) => p.id === localPlayer);
    const status = me(after)?.status ?? PLAYING;
    if (status !== (me(before)?.status ?? PLAYING)) {
      this.setType(status === WON ? MUSIC_VICTORY : status === PLAYING ? MUSIC_CALM : MUSIC_DEFEAT);
      return;
    }
    if (status !== PLAYING) return;
    // Battle music: the local hero losing HP posts "hero under attack" (at most every 450 ticks).
    const hero = after.units.find((u) => u.owner === localPlayer && u.role === ROLE_HERO);
    const was = hero && before.units.find((u) => u.id === hero.id);
    if (hero && was && hero.hp < was.hp && (this.heroAlert === null || after.tick - this.heroAlert > HERO_ALERT_TICKS)) {
      this.heroAlert = after.tick;
      if (this.plan.type === MUSIC_CALM) this.setType(MUSIC_BATTLE);
    }
    if (this.plan.type === MUSIC_BATTLE && this.heroAlert !== null && after.tick - this.heroAlert >= BATTLE_MUSIC_TICKS) this.setType(MUSIC_CALM);
  }

  /** The local player changed the selection. */
  select(before: ReadonlySet<number>, after: ReadonlySet<number>, world: World) {
    for (const e of selectionSounds(before, after, world.units)) this.play(e);
  }

  play(e: Pick<SoundEvent, 'arc' | 'index'>) {
    this.audio.playSeq(e.arc, e.index);
  }
}
