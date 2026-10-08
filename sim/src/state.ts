import type { Fx } from './fixed';
import type { Rng } from './rng';
import type { TerrainGrid } from './terrain';

export type PlayerId = number;
export type EntityId = number;

export interface Unit {
  id: EntityId;
  owner: PlayerId;
  x: Fx;
  y: Fx;
  /** Final movement target, or null when idle. */
  tx: Fx | null;
  ty: Fx | null;
  /** Cells (y * width + x) to pass through, in order, before heading to (tx, ty). */
  path: number[];
  /**
   * Game speed value from Entities.ebp (+0x0C): 1/4096 of a map cell per tick.
   * Plain integer, not Fx.
   */
  speed: number;
  /** Entity index from Entities.ebp (+0x04), or -1. Keys the melee bonus table. */
  kind: number;
  hp: number;
  maxHp: number;
  /** Null for units that can't attack. Static per unit type. */
  attack: AttackStats | null;
  /** Unit being attacked or chased, or null. */
  target: EntityId | null;
  /** True when `target` came from a player's attack order rather than the unit's own scan. */
  ordered: boolean;
  /** Tick of the last attack (also when the attack animation starts). */
  lastAttack: number;
  /** Tick of the last damage taken (drives the client's white hit flash), or NEVER. */
  lastHit: number;
  /** Tick the unit was spawned. Sets the phase of its once-a-second target scan. */
  born: number;
  /** Target priority (+0x70): enemies scanning for a target prefer higher. Static per unit type. */
  priority: number;
}

/** Combat fields from Entities.ebp; see docs/re-notes/combat.md. Plain integers. */
export interface AttackStats {
  damage: number;
  /** Each hit adds rand(damageRand), 0 <= roll < damageRand. */
  damageRand: number;
  /** Ticks between attacks. */
  cooldown: number;
  /** Cells, compared as squared distance between unit cells. */
  minRange: number;
  maxRange: number;
  /** Units look for enemies this many cells away (squared cell distance). */
  sight: number;
  /** Null for melee. */
  projectile: ProjectileType | null;
}

export interface ProjectileType {
  speed: number;
  /** Damage is minDamage + rand(maxDamage - minDamage). */
  minDamage: number;
  maxDamage: number;
  /** Damages every enemy within 2 cells of the impact, less further out. */
  splash: boolean;
}

export interface Projectile {
  id: EntityId;
  owner: PlayerId;
  x: Fx;
  y: Fx;
  target: EntityId;
  type: ProjectileType;
}

/**
 * Melee bonus lookup read from the ROM (same shape as extract's CombatBonus).
 * Static game data: identical on every client, so it is not hashed.
 */
export interface MeleeBonusTable {
  attackerClass: Uint8Array;
  defenderClass: Uint8Array;
  matrix: Int8Array;
  stride: number;
}

export interface World {
  tick: number;
  rng: Rng;
  nextId: EntityId;
  /**
   * Always kept sorted by id. Iterate this array, never an object's keys or a
   * Set, so every client processes entities in the same order.
   */
  units: Unit[];
  /** Kept sorted by id, like units. */
  projectiles: Projectile[];
  bonus: MeleeBonusTable | null;
  /** Map walkability; null for a bare test world, where units move in straight lines. */
  grid: TerrainGrid | null;
}
