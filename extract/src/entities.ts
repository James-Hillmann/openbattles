import { u16 } from './bytes';

/**
 * BP/Entities.ebp (BPNZ): the game's unit, building and projectile table.
 * Layout and field meanings are in docs/re-notes/formats.md ("BPNZ") and
 * docs/re-notes/combat.md. Everything is read from the player's ROM at load.
 */

/** Record size per kind byte (+0x08), from the loader's switch (Bp_buildEntities). */
const RECORD_SIZE: Record<number, number> = { 0: 0x7c, 1: 0x74, 2: 0x70 };
/** The loader walks exactly this many records. */
const RECORD_COUNT = 0x227;
const MELEE = 0xffff;

export interface ProjectileStats {
  /** 1/4096 cell per tick, same unit as unit speed. */
  speed: number;
  /** Damage is min + rand(max - min): max itself is never rolled. */
  minDamage: number;
  maxDamage: number;
  /** +0x6B: hits a 5x5 cell area with falloff instead of one cell. */
  splash: boolean;
}

export interface EntityRecord {
  index: number;
  kind: number;
  name: string;
  /** Sprite or model path that follows the name in the string table. */
  sprite: string;
  raw: Uint8Array;
}

/** Combat-relevant fields of a kind-0 (unit/building) record. */
export interface UnitStats {
  /** Entity index (+0x04): what the combat bonus tables are keyed by. */
  index: number;
  name: string;
  speed: number;
  hp: number;
  cost: number;
  /** Melee: base damage (+0x68) plus rand(damageRand) (+0x6A) per hit. */
  damage: number;
  damageRand: number;
  /** Ticks between attacks (+0x6D). */
  cooldown: number;
  /** Attack range in cells, compared as squared Euclidean cell distance (+0x6E/+0x6F). */
  minRange: number;
  maxRange: number;
  /** Sight radius in cells (+0x71): how far the unit looks for enemies. */
  sight: number;
  /** Role (+0x5C): 0 hero, 1 builder, 2 melee, 3 ranged, ... 7-19 buildings. */
  role: number;
  /** Target priority (+0x70): auto-targeting prefers higher. */
  priority: number;
  /** Null for melee units. */
  projectile: ProjectileStats | null;
  /** Ticks to build (buildings) or train (units) (+0x60). Confirmed in the emulator: Farm 360, Builder 150. */
  buildTime: number;
  /**
   * Heroes: most magic charge (+0x64, 1000 for every hero; spells cost from it). Other entities hold
   * 0xFFFF here, which the cast check treats as "free". docs/re-notes/spells.md
   */
  charge: number;
  /** Heroes: spell ids from +0x72..+0x76 in strip order, empty slots (0) dropped. docs/re-notes/spells.md */
  spells: number[];
  /**
   * Footprint shape (+0x1D), an index into the game's size table (0x02001170): 1 = 1x1, 2 = 2x2,
   * 3 = 3x3, 4 = 2x3, 5 = 2x6, 6 = 2x9, 7 = 3x2, 8 = 6x2, 9 = 9x2, 10 = 1x4, 11 = 4x1.
   */
  size: number;
  /** +0x6C: bricks per Mine payout (25); 0 for everything else. */
  yield: number;
  /**
   * Terrain the unit may enter, bit n = terrain code n (0 open, 1 tree, 2 rough,
   * 3 water), from +0x16 open, +0x17 rough, +0x18 water, +0x19 tree (0x02001510).
   */
  moves: number;
  /** Occupancy layer: 0 ground (+0x1A), 1 air (+0x1B), 2 bridges (+0x1C) (0x0200159C). */
  layer: number;
}


function cString(b: Uint8Array, o: number): string {
  let s = '';
  while (o < b.length && b[o] !== 0) s += String.fromCharCode(b[o++]!);
  return s;
}

/** Parse a decompressed Entities.ebp. */
export function parseEntityRecords(ebp: Uint8Array): EntityRecord[] {
  if (cString(ebp, 0).slice(0, 4) !== 'BPNZ') throw new Error('not a BPNZ file');
  const recs: { off: number; kind: number }[] = [];
  let off = 4;
  for (let i = 0; i < RECORD_COUNT; i++) {
    const kind = ebp[off + 8]!;
    const size = RECORD_SIZE[kind];
    if (!size) throw new Error(`entity ${i}: unknown kind ${kind}`);
    recs.push({ off, kind });
    off += size;
  }
  // The string table follows the last record.
  const strings = off;
  return recs.map(({ off, kind }, index) => {
    const raw = ebp.subarray(off, off + RECORD_SIZE[kind]!);
    const name = cString(ebp, strings + u16(raw, 0));
    const sprite = cString(ebp, strings + u16(raw, 0) + name.length + 1);
    return { index, kind, name, sprite, raw };
  });
}

export function projectileStats(rec: EntityRecord): ProjectileStats {
  if (rec.kind !== 1) throw new Error(`${rec.name} is not a projectile`);
  const r = rec.raw;
  return { speed: u16(r, 0x0c), minDamage: u16(r, 0x70), maxDamage: u16(r, 0x72), splash: r[0x6b] !== 0 };
}

export function unitStats(recs: readonly EntityRecord[], rec: EntityRecord): UnitStats {
  if (rec.kind !== 0) throw new Error(`${rec.name} is not a unit or building`);
  const r = rec.raw;
  const proj = u16(r, 0x66);
  return {
    index: u16(r, 0x04),
    name: rec.name,
    speed: u16(r, 0x0c),
    hp: u16(r, 0x62),
    cost: u16(r, 0x5e),
    damage: u16(r, 0x68),
    damageRand: u16(r, 0x6a),
    cooldown: r[0x6d]!,
    minRange: r[0x6e]!,
    maxRange: r[0x6f]!,
    sight: r[0x71]!,
    role: r[0x5c]!,
    priority: r[0x70]!,
    projectile: proj === MELEE ? null : projectileStats(recs[proj]!),
    buildTime: u16(r, 0x60),
    charge: u16(r, 0x64),
    spells: [...r.subarray(0x72, 0x77)].filter((id) => id !== 0),
    size: r[0x1d]!,
    yield: r[0x6c]!,
    moves: (r[0x16] ? 1 : 0) | (r[0x19] ? 2 : 0) | (r[0x17] ? 4 : 0) | (r[0x18] ? 8 : 0),
    layer: r[0x1b] ? 1 : r[0x1c] ? 2 : 0,
  };
}

export function findUnitStats(recs: readonly EntityRecord[], name: string): UnitStats {
  const rec = recs.find((r) => r.name === name);
  if (!rec) throw new Error(`no entity named ${name}`);
  return unitStats(recs, rec);
}

/**
 * Melee damage bonus: a signed byte per (defender class, attacker class),
 * where each class comes from a per-entity-index byte table (0xff = none).
 * The tables are game data in ARM9; we read them from the player's ROM.
 * Same shape as the sim's `MeleeBonusTable`, which does the lookup.
 */
export interface CombatBonus {
  attackerClass: Uint8Array;
  defenderClass: Uint8Array;
  /** Row-major [defenderClass * stride + attackerClass]. */
  matrix: Int8Array;
  stride: number;
}

/** ARM9 RAM addresses per game code (see docs/re-notes/combat.md). */
const BONUS_ADDRS: Record<string, { stride: number; attacker: number; defender: number; matrix: number; entries: number }> = {
  C5SE: { stride: 0x021413e8, attacker: 0x021413ec, defender: 0x02141614, matrix: 0x0214183c, entries: 0x228 },
};

export function readCombatBonus(arm9: Uint8Array, ramAddress: number, gameCode: string): CombatBonus | null {
  const a = BONUS_ADDRS[gameCode];
  if (!a) return null;
  const at = (addr: number) => addr - ramAddress;
  const stride = arm9[at(a.stride)]!;
  const attackerClass = arm9.slice(at(a.attacker), at(a.attacker) + a.entries);
  const defenderClass = arm9.slice(at(a.defender), at(a.defender) + a.entries);
  let rows = 0;
  for (const c of defenderClass) if (c !== 0xff) rows = Math.max(rows, c + 1);
  for (const c of attackerClass) if (c !== 0xff && c >= stride) return null; // wrong addresses
  const bytes = arm9.slice(at(a.matrix), at(a.matrix) + rows * stride);
  return { attackerClass, defenderClass, matrix: new Int8Array(bytes.buffer), stride };
}
