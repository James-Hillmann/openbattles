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
  /** Sight radius in cells (+0x71). guess. */
  sight: number;
  /** Null for melee units. */
  projectile: ProjectileStats | null;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);

function cString(b: Uint8Array, o: number): string {
  let s = '';
  while (o < b.length && b[o] !== 0) s += String.fromCharCode(b[o++]!);
  return s;
}

/** Parse a decompressed Entities.ebp. */
export function parseEntities(ebp: Uint8Array): EntityRecord[] {
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
  return { speed: u16(r, 0x0c), minDamage: u16(r, 0x70), maxDamage: u16(r, 0x72) };
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
    projectile: proj === MELEE ? null : projectileStats(recs[proj]!),
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
