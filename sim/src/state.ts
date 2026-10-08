import type { Fx } from './fixed';
import type { Rng } from './rng';
import type { TerrainGrid, TerrainMask } from './terrain';

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
  /** Null for units that can't attack (no damage and no projectile, e.g. a castle). Static per unit type. */
  attack: AttackStats | null;
  /** Sight radius in cells (entity +0x71): fog of war vision, and how far the unit looks for enemies. Static per unit type. */
  sight: number;
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
  /** Terrain codes the unit may enter (entity +0x16..+0x19); see terrain.ts. Static per unit type. */
  moves: TerrainMask;
  /** Occupancy layer: 0 ground, 1 air, 2 bridges/gates (entity +0x1A/+0x1B/+0x1C). Static per unit type. */
  layer: number;
  /** Role (entity +0x5C): 0 hero, 1 builder, 2-6 other units, 7-16 buildings, -1 unknown. Static per unit type. */
  role: number;
  /** Active move order on a map (game: MoveUnitAction), or null. */
  mv: Mover | null;
  // Economy (sim/src/economy.ts, docs/re-notes/economy.md). Static per type unless noted.
  /** Footprint shape (+0x1D): 1, 2, 3 are squares of that side; units are 1. */
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
  /** Faction prefix of the entity name (K, W, P, I, E, A): a building only makes its own faction's entities. */
  faction?: string;
  /** Terrain mask, occupancy layer and sight for units this type spawns (see Unit). */
  moves?: TerrainMask;
  layer?: number;
  sight?: number;
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
  /**
   * Unit id holding each map cell, 0 = free: one width * height plane per
   * occupancy layer (OCC_LAYERS), indexed layer * width * height + cell. Null without a grid.
   */
  occ: Int32Array | null;
  /** Players, sorted by id. Empty in sandbox worlds, which never end. */
  players: Player[];
  /** Skirmish win condition, or null for a sandbox world. */
  rules: GameRules | null;
  /** Entity types by entity index (sparse), for build and train orders. Static game data, not hashed. */
  types: (EntityType | undefined)[];
  /** Map cells (y * width + x) where a Mine may stand: the top-left of its footprint. Static map data. */
  mineSites: number[];
}

/** The game's occupancy layers (OccupationGrid): ground, air, bridges. */
export const OCC_LAYERS = 3;

/** Player status (game: team +0x9C). */
export const PLAYING = 0;
export const DEFEATED = 1;
export const WON = 2;
export const LOST = 3;

export interface Player {
  id: PlayerId;
  /** Players on the same team are allies. 1v1: each player its own team. */
  team: number;
  /** LEGO bricks (game: team +0x90). */
  bricks: number;
  status: number;
  /** Cell the camera starts on: the hero's start record (game: map +0x234). -1 if none. */
  start: number;
  /** Population and star slots taken by units still in a production queue (team +0xEE / +0xEF). */
  reservedPop: number;
  reservedStars: number;
  /**
   * The player's army from the army select screen (docs/re-notes/armies.md), or undefined to
   * use the faction of whatever does the building or training (the old sandbox rule).
   */
  army?: PlayerArmy;
}

/** A picked army: the units it trains and the faction whose buildings it builds. */
export interface PlayerArmy {
  /** Entity index per unit slot (hero, builder, close combat, ranged, mounted, 3 specials, transport); -1 for none. */
  units: number[];
  /** Faction prefix of the army's buildings (K, W, P, I, E, A). */
  base: string;
}

/**
 * Skirmish win conditions, as picked on the game's options screen (game:
 * GameRuleManager +4): 0 "Defeat the enemy's Hero", 1 "Defeat all enemy units",
 * 2 "Collect 10000 LEGO Bricks". See docs/re-notes/skirmish.md.
 */
export type WinMode = 0 | 1 | 2;
export interface GameRules {
  mode: WinMode;
}
