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
  // Hero spells (sim/src/spells.ts, docs/re-notes/spells.md).
  /** Magic charge (game: unit +0x1A2): spells cost from it; refills one point a tick. 0 for non-heroes. */
  charge: number;
  /** Most charge (entity +0x64): 1000 for heroes, 0 for everything else. Static per unit type. */
  maxCharge: number;
  /** Spell ids this hero can cast, in strip order (entity +0x72..+0x76). Static per unit type. */
  spells: number[];
  /**
   * Stat buffs on this unit, per slot (BUFF_SPEED, BUFF_DAMAGE, BUFF_ARMOR): how many buff spells
   * hold it (game: the influence list at unit +0x1E4). Only whether a count is above 0 matters.
   */
  buffs: number[];
  /** The buffs in effect (bit per slot), refreshed from `buffs` at the start of the unit's update (game: stats rebuild 0x0205CCA4). */
  boost: number;
  /** Damage spell hits this unit shrugs off first (game: unit +0x230); set when a damage spell takes it. */
  grace: number;
  /** Frozen by a freeze ring until this tick (game: FreezeEntityCommand); 0 when never. */
  frozen: number;
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
  /** Heroes: most charge and spell ids (see Unit). */
  charge?: number;
  spells?: number[];
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
  /** The game's spell table by spell id (ARM9). Static game data, not hashed; empty without a ROM. */
  spellDefs: SpellDef[];
  /** Spells being cast or still running, sorted by id. */
  spells: ActiveSpell[];
  /** Next spell id (spells count separately from units so a cast never shifts unit ids). */
  nextSpell: number;
  /** Spells waiting for their area scan, front first; one is scanned per tick (game: 0x02075FBC). */
  scanQueue: number[];
}

/**
 * One record of the game's spell table (ARM9 0x02126CB0 in C5SE); same shape as extract's SpellDef.
 * Field meanings: docs/re-notes/spells.md.
 */
export interface SpellDef {
  id: number;
  icon: number;
  params: [number, number, number, number];
  /** Cast range in cells: squared cell distance from the hero to the target <= range^2. */
  range: number;
  b7: number;
  flags: number;
  /** Charge spent; the hero needs strictly more than this. */
  cost: number;
  category: number;
  time: number;
}

/** A spell in flight or in effect (game: a SpellBase in the SpellPool). */
export interface ActiveSpell {
  id: EntityId;
  owner: PlayerId;
  /** Spell id (SpellDef.id). */
  spell: number;
  /** The hero who cast it. */
  caster: EntityId;
  /** Target unit, or 0. */
  target: EntityId;
  /** Target point (Fx pixels): the target unit's or the tapped spot. */
  x: Fx;
  y: Fx;
  /** Tick it was cast. */
  start: number;
  /** Ticks left; -1 runs until its caster is gone (game: SpellBase +0x14). */
  left: number;
  /** 1 a unit, 2 around the caster, 3 a spot (game: SpellBase +0x1C). */
  mode: number;
  /** Centre cell of its area and the radius in cells (|dx| + |dy|), or radius -1 for no area. */
  cx: number;
  cy: number;
  radius: number;
  /** Units in its area as of the last scan (game: SpellBase +0x38), in id order. */
  units: EntityId[];
  /** Heals: ticks to the next pulse (HealSpell +0x50). Freeze rings: ticks left (EAttackSpell +0x7C). */
  timer: number;
  /** Damage spells: damage and hit chance per tick, 20.12, and how much they change each tick (DamageSpell +0x64/+0x68, +0x50/+0x54). */
  dmg: number;
  dmgStep: number;
  chance: number;
  chanceStep: number;
  /** Growing hit zone or freeze ring radius in cells, 20.12, and its growth a tick (DamageSpell +0x5C/+0x60, EAttackSpell +0x80). */
  ring: number;
  ringStep: number;
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
