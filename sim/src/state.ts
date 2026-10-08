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
  /** Final movement target (on a map: the goal cell's centre), or null when idle. */
  tx: Fx | null;
  ty: Fx | null;
  /** On a map: the short A* path the move plotter is following, if any (cells, y * width + x). */
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
  /** Map cell this unit holds in World.occ (y * width + x), or -1. */
  cell: number;
  /** Active move order on a map (game: MoveUnitAction), or null. */
  mv: Mover | null;
  // Economy (sim/src/economy.ts, docs/re-notes/economy.md). Static per type unless noted.
  /** Role (+0x5C): 0 hero, 1 builder, 2 melee, 3 ranged, 4 mounted, 5 transport, 6 siege, 7+ buildings. */
  role: number;
  /** Footprint side in cells (+0x1D): 1 for units, 2 or 3 for buildings. */
  size: number;
  /** Ticks to build or train this type (+0x60). */
  buildTime: number;
  /** Construction ticks done; a building is finished when progress >= buildTime. Units spawn finished. */
  progress: number;
  /** Builder's current economy job, or null. */
  job: Job | null;
  /** Builder is carrying a load of bricks back. */
  carrying: boolean;
  /** Production buildings: entity kinds waiting to be trained, front first. */
  queue: number[];
  /** Ticks spent on queue[0]. */
  prod: number;
  /** Mines: ticks until the next payout. */
  payout: number;
}

/** What a builder is doing. Cells are y * width + x. */
export type Job =
  /** Chop the tree at `tree`; `timer` counts the chop down (game: HarvestAction). */
  | { kind: 'chop'; tree: number; timer: number }
  /** Carry a load to the nearest finished building; `tree` is where to go back to. */
  | { kind: 'deliver'; tree: number; drop: EntityId }
  /** Work on the construction site `site`. */
  | { kind: 'build'; site: EntityId };

/** One player's economy. Kept sorted by id in World.players. */
export interface Player {
  id: PlayerId;
  bricks: number;
  /** Population and star slots taken by units still in a production queue. */
  reservedPop: number;
  reservedStars: number;
}

/**
 * Static per-type data from Entities.ebp, indexed by entity index (+0x04).
 * Identical on every client, so not hashed.
 */
export interface EntityType {
  kind: number;
  role: number;
  speed: number;
  hp: number;
  cost: number;
  buildTime: number;
  size: number;
  /** +0x6C: bricks per payout for mines (25), 0 otherwise. */
  yield: number;
  priority: number;
  attack: AttackStats | null;
}

/**
 * Per-unit state of the game's move plotters; see sim/src/movement.ts and
 * docs/re-notes/movement.md. Cells are y * width + x, -1 for none.
 */
export interface Mover {
  goal: number;
  /** Travel is over; centring on the cell before stopping. */
  align: boolean;
  /** Cell the unit is heading for this tick. */
  wp: number;
  /** Cell the unit last bumped into. */
  blocked: number;
  /** Wait-for-obstacle: 0 off, 1 waiting, 2 gave up. */
  wait: number;
  waitLeft: number;
  /** Sidestep: 0 off, 1 straight, 2 turn left, 3 turn right, 4 out of options. */
  side: number;
  sideCell: number;
  sideReset: boolean;
  /** A*: 0 off, 1 search, 2 follow path, 3 skipped a blocked step, 4 failed. */
  astar: number;
  /** Index into Unit.path while following a path. */
  pathIdx: number;
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
  /** Unit id holding each map cell, 0 = free. Null without a grid. */
  occ: Int32Array | null;
  /** Players with an economy, sorted by id. Empty in combat-only test worlds. */
  players: Player[];
  /** Entity types by entity index (sparse). Static game data, not hashed. */
  types: (EntityType | undefined)[];
  /** Map cells (y * width + x) where a Mine may stand: the top-left of its footprint. Static map data. */
  mineSites: number[];
}
