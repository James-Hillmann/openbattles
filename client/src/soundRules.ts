import { ROLE_BUILDER, type ActiveSpell, type Unit, type World } from '@lbw/sim';

/**
 * When the game plays which sound, as traced in ARM9 and checked in DeSmuME
 * (docs/re-notes/sound-triggers.md). Pure functions of sim state, so they can be tested
 * without audio.
 */

/** Indexes inside a unit/building SEQARC: the game passes its event number straight through. */
export const ON_SELECT = 0;
export const ON_DEATH = 1;
/** Units: strike. Buildings only have 3 entries, so a tower's strike lands on its `_ONHIT`. */
export const ON_STRIKE = 2;
export const ON_SPECIAL = 4;

/** SEQARC 0 (front end) and 1 (in-game UI) sound indexes the game uses. */
export const FE_CLICK1 = { arc: 0, index: 5 };
export const FE_ERROR = { arc: 0, index: 10 };
export const UI_BACK1 = { arc: 1, index: 1 };
export const UI_COINS = { arc: 1, index: 17 };
export const UI_MENUSLIDECLICK = { arc: 1, index: 15 };

const UNIT_ROLES_MAX = 6;

/**
 * `Snd_entitySeqArc` (0x020889F8): entity index -> SEQARC, or -1 for silent. Keeps the game's two
 * bugs: the Alien Shipyard (119) is silent (`index < 119`) and the Troll King (165) uses TROLLBASE.
 */
export function entitySeqArc(index: number, role: number): number {
  if (index >= 0 && index < 119) {
    const faction = Math.floor(index / 20);
    const slot = index % 20;
    return role >= 0 && role <= UNIT_ROLES_MAX ? 2 + 10 * faction + slot : 62 + 10 * faction + slot - 10;
  }
  if (index === 120) return 122;
  if (index >= 121 && index <= 126) return 123;
  if (index === 127 || index === 128) return 124;
  if (index === 165) return 164;
  if (index >= 129 && index <= 181) return index - 4;
  return -1;
}

/** `Snd_spellSeqArc` (0x02088F24): spell id -> SEQARC, or -1. */
const SPELL_ARC: Record<number, number> = {
  1: 201, 2: 202, 3: 200, 4: 189, 5: 188, 6: 187, 7: 186, 8: 185, 9: 184, 10: 199, 11: 193, 12: 205, 13: 194, 14: 197, 15: 206,
  16: 214, 17: 208, 18: 211, 19: 190, 20: 209, 21: 192, 23: 183, 25: 182, 26: 213, 27: 195, 28: 212, 29: 196, 30: 215, 31: 191,
  32: 203, 33: 207, 34: 198,
};
export const spellSeqArc = (spell: number): number => SPELL_ARC[spell] ?? -1;

/** A sound to start: SEQARC and index, plus the unit whose cell decides whether it is heard (-1: always). */
export interface SoundEvent {
  arc: number;
  index: number;
  /** Unit whose map cell must be in view, or 0 for sounds that always play (UI). */
  at: number;
}

/** Builders chopping play their strike at most once per this many ticks of chopping (HarvestAction 0x0205333C). */
export const CHOP_SOUND_TICKS = 15;

/** Heal spells: one pulse sound per pulse that heals a damaged unit (HealSpell 0x02078728). */
const HEAL_SPELLS = new Set([1, 2, 3]);

const isBuildingRole = (role: number) => role >= 7;
const finished = (u: Unit) => u.progress >= u.buildTime;

/**
 * Sounds caused by one sim tick, from the state before and after it. `chopCount` keeps each
 * builder's ticks of chopping since its last chop sound; `localPlayer` gets the brick sound.
 */
export function tickSounds(before: World, after: World, localPlayer: number, chopCount: Map<number, number>): SoundEvent[] {
  const out: SoundEvent[] = [];
  const prev = new Map(before.units.map((u) => [u.id, u]));
  const unitEvent = (u: Unit, index: number) => {
    const arc = entitySeqArc(u.kind, u.role);
    if (arc >= 0) out.push({ arc, index, at: u.id });
  };
  const now = new Set<number>();
  for (const u of after.units) {
    now.add(u.id);
    const p = prev.get(u.id);
    if (!p) {
      // A trained unit plays its select sound; a new construction site makes none yet.
      if (!isBuildingRole(u.role) && finished(u)) unitEvent(u, ON_SELECT);
      continue;
    }
    if (u.hp <= 0 && p.hp > 0) unitEvent(u, ON_DEATH);
    if (u.lastAttack !== p.lastAttack) unitEvent(u, ON_STRIKE);
    if (isBuildingRole(u.role) && finished(u) && !finished(p)) unitEvent(u, ON_SELECT);
    if (u.role === ROLE_BUILDER) {
      // Starting to build: once, when the builder goes to work on a site.
      const building = (j: Unit['job']) => j?.kind === 'inside' && j.tree < 0;
      if (building(u.job) && !building(p.job)) unitEvent(u, ON_SPECIAL);
      const chopping = u.job?.kind === 'chop' && p.job?.kind === 'chop' && u.job.timer !== p.job.timer;
      if (chopping) {
        const n = (chopCount.get(u.id) ?? CHOP_SOUND_TICKS) + 1;
        if (n >= CHOP_SOUND_TICKS) {
          unitEvent(u, ON_STRIKE);
          chopCount.set(u.id, 0);
        } else chopCount.set(u.id, n);
      } else if (u.job?.kind !== 'chop') chopCount.delete(u.id);
    }
  }
  // Units that left the sim this tick died (the die command starts the sound).
  for (const p of before.units) if (!now.has(p.id) && p.hp > 0) unitEvent(p, ON_DEATH);

  // Spells: every new spell object plays its own id with the caster's handle (Spell_create
  // 0x0207BBEC); impacts make a new damage spell, which is how FIREBALLEXPLOSION etc. play.
  const oldSpells = new Set(before.spells.map((s) => s.id));
  const hpBefore = new Map(before.units.map((u) => [u.id, u.hp]));
  const spellEvent = (s: ActiveSpell) => {
    const arc = spellSeqArc(s.spell);
    if (arc >= 0) out.push({ arc, index: 0, at: s.caster });
  };
  for (const s of after.spells) {
    if (!oldSpells.has(s.id)) spellEvent(s);
    else if (HEAL_SPELLS.has(s.spell)) {
      const healed = s.units.some((id) => {
        const u = id ? after.units.find((x) => x.id === id) : undefined;
        return !!u && !isBuildingRole(u.role) && u.hp > (hpBefore.get(u.id) ?? u.hp);
      });
      if (healed) spellEvent(s);
    }
  }

  // Bricks: any change to the local player's count plays COINS (Player_setBricks 0x02086614).
  const mine = (w: World) => w.players.find((p) => p.id === localPlayer)?.bricks;
  if (mine(before) !== undefined && mine(before) !== mine(after)) out.push({ ...UI_COINS, at: 0 });
  return out;
}

/** The selection sounds (0x020E2F88): a new selection plays UI BACK1, then each unit's select; re-tapping plays BACK1 only. */
export function selectionSounds(before: ReadonlySet<number>, after: ReadonlySet<number>, units: readonly Unit[]): SoundEvent[] {
  if (after.size === 0) return [];
  const same = after.size === before.size && [...after].every((id) => before.has(id));
  if (same) return [{ ...UI_BACK1, at: 0 }];
  const out: SoundEvent[] = [{ ...UI_BACK1, at: 0 }];
  for (const u of units) {
    if (!after.has(u.id)) continue;
    const arc = entitySeqArc(u.kind, u.role);
    if (arc >= 0) out.push({ arc, index: ON_SELECT, at: 0 });
  }
  return out;
}

// ---------------------------------------------------------------- music

/** Music types (settings block +8). */
export const MUSIC_FE = 0;
export const MUSIC_CALM = 1;
export const MUSIC_BATTLE = 2;
export const MUSIC_VICTORY = 3;
export const MUSIC_DEFEAT = 4;

/** First STRM per faction (King, Wizard, Pirate, Imperial, Earth, Alien) for calm, battle, victory, defeat (`Snd_musicBase` 0x02089C18). */
const MUSIC_BASE = [
  [4, 10, 16, 17],
  [18, 24, 30, 31],
  [66, 72, 78, 79],
  [80, 87, 96, 97],
  [32, 38, 47, 48],
  [49, 55, 64, 65],
];

/**
 * Calm and battle playlists per faction: 1-based track numbers added to the base. Built by the game
 * at boot (0x021554C8) and read from RAM; the Pirate battle list's 7-9 run past its 6 tracks (a
 * game bug we keep: they land on PIRATE_VICTORY, PIRATE_DEFEAT, IMPERIAL_CAMPAIGN_1).
 */
const PLAYLISTS: [number[], number[]][] = [
  [[1, 2, 1, 2, 3, 4, 2, 4, 6, 6, 5, 5, 3, 2, 2, 3, 4, 6, 6, 5, 5, 6, 6], [1, 1, 2, 1, 2, 3, 4, 5, 5, 6, 6, 4, 5, 5, 3, 6, 6, 2]],
  [[1, 2, 3, 4, 1, 2, 5, 5, 6, 6, 3, 4, 5, 5, 4, 4, 6, 6, 6, 6, 4, 4], [1, 2, 3, 4, 3, 3, 5, 6, 6, 2, 1, 1, 6, 2, 4, 6, 6]],
  [
    [1, 2, 2, 1, 3, 4, 5, 5, 1, 1, 2, 2, 6, 6, 4, 5, 6, 3, 6, 3, 4, 6],
    [1, 2, 3, 4, 5, 7, 7, 2, 3, 4, 5, 5, 6, 7, 8, 8, 8, 9, 7, 7, 4, 4, 5, 5, 6, 7, 7, 8, 8, 8, 9],
  ],
  [[1, 2, 3, 3, 4, 2, 3, 2, 3, 4, 5, 6, 6, 3, 3, 5, 6, 7, 7, 6, 6, 7, 7, 3, 3], [1, 2, 3, 4, 5, 2, 3, 4, 5, 6, 6, 7, 8, 9, 9, 5, 6, 6, 7, 9, 9]],
  [[1, 2, 1, 2, 2, 3, 3, 4, 3, 4, 5, 6, 4, 4, 3, 3, 5, 6], [1, 1, 2, 3, 4, 4, 5, 1, 1, 2, 4, 4, 5, 6, 6, 7, 7, 8, 5, 6, 7, 7, 8, 8]],
  [[1, 1, 2, 3, 4, 5, 2, 2, 3, 4, 5, 6, 2, 2, 3, 4, 5, 6], [1, 2, 1, 4, 3, 4, 5, 6, 7, 2, 1, 1, 3, 4, 5, 4, 3, 4, 5, 6, 7, 8, 9, 1, 1, 3, 4, 3, 4, 7, 8, 9]],
];
/** Where a playlist restarts every other type change ("second half" offsets, 0x0215540C): calm, battle. */
const PLAYLIST_SECOND = [
  [10, 7],
  [12, 7],
  [12, 18],
  [9, 8],
  [12, 12],
  [11, 21],
];

/** Battle music falls back to calm this long after the last "hero under attack" (Snd_battleMusicTimeout). */
export const BATTLE_MUSIC_TICKS = 450;
/** "Hero under attack" is posted at most this often (Unit_setHp 0x0205E7D4). */
export const HERO_ALERT_TICKS = 450;

/**
 * The game's music state machine (sound-triggers.md "Music"): picks the next STRM number.
 * The second-half toggles are global in the game and survive between matches; so here.
 */
export class MusicPlan {
  type = MUSIC_FE;
  /** 0..5, or 6 for the front end's combined theme. */
  faction = 6;
  private pos = 0;
  private static second = [false, false, false, false, false];
  /** Forget the toggles (a fresh boot of the game). */
  static reset() {
    MusicPlan.second = [false, false, false, false, false];
  }

  setFaction(f: number) {
    this.faction = f;
    this.pos = 0;
  }

  setType(t: number) {
    this.type = t;
    const flags = MusicPlan.second;
    const f = this.faction;
    this.pos = flags[t] && f < 6 && t >= 1 && t <= 2 ? PLAYLIST_SECOND[f]![t - 1]! : 0;
    flags[t] = !flags[t];
  }

  /** The next STRM to play, advancing the playlist. */
  next(): number {
    const f = this.faction;
    const t = this.type;
    if (t === MUSIC_FE || f > 5) return 0; // COMBINED_FE_THEME; the menus never pick a faction theme here
    const base = MUSIC_BASE[f]![t - 1]!;
    if (t >= MUSIC_VICTORY) return base;
    const list = PLAYLISTS[f]![t - 1]!;
    const n = list[this.pos % list.length]!;
    this.pos = (this.pos + 1) % list.length;
    return base + n - 1;
  }
}
