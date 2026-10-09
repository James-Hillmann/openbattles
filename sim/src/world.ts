import { type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import { aiStep } from './ai';
import { NEVER, combatStep, findById, stepProjectiles } from './combat';
import { stepBudget, stepToward } from './motion';
import { OCC_LAYERS, type AttackStats, type BridgeSite, type EntityType, type GameRules, type MeleeBonusTable, type Player, type PlayerId, type SpellDef, type Unit, type World } from './state';
import { MOVES_GROUND, cellOf, reachableFrom, spreadCells, type TerrainGrid, type TerrainMask } from './terrain';
import { moveOnMap, orderMove, placeUnit, removeUnit } from './movement';
import { checkBricks, onUnitLost } from './rules';
import { pickupsStep } from './pickups';
import { countBuilt, countDeath } from './stats';
import { orderRepair, orderUpgrade } from './structures';
import { BUFF_SLOTS, isFrozen, moveSpeed, orderCast, refreshBoost, regenCharge, spellsStep, startAura } from './spells';
import {
  ROLE_BRIDGE, ROLE_HERO, TERRAIN_BUILDING, cellPos, clearFootprint, economyStep, isBuilding, isInside, orderBuild, orderCancel, orderConstruct, orderHarvest, orderTrain,
  type SpawnFn,
} from './economy';
import { fpH, fpW } from './footprint';
import { STANCE_HOLD, STANCE_MOVE, cellUnder, orderPatrol, orderRally, orderStand, orderStop } from './orders';

/** Cell index of (cx, cy), or -1 off the map. */
const cellIndex = (g: TerrainGrid, cx: number, cy: number): number => (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height ? -1 : cy * g.width + cx);
import { collapseBridge, orderBridge, orderWall } from './walls';

export interface WorldInit {
  seed: number;
  grid?: TerrainGrid | null;
  bonus?: MeleeBonusTable | null;
  /** Skirmish players (ids 0..n-1); omit for a sandbox world that never ends. */
  players?: Player[];
  rules?: GameRules | null;
  /** Entity types by entity index, for build and train orders. Giving types turns the economy on. */
  types?: (EntityType | undefined)[];
  /** Mine sites from the map's MINE section (cells, y * width + x). */
  mineSites?: number[];
  /** The ROM's spell table; without it heroes can't cast. */
  spellDefs?: SpellDef[];
  /** Bridge sites from the map's MARK section, sized with sizeBridge. */
  bridgeSites?: BridgeSite[];
}

export function createWorld({ seed, grid = null, bonus = null, players = [], rules = null, types = [], mineSites = [], spellDefs = [], bridgeSites = [] }: WorldInit): World {
  const occ = grid ? new Int32Array(OCC_LAYERS * grid.width * grid.height) : null;
  return {
    tick: 0, rng: makeRng(seed), nextId: 1, units: [], projectiles: [], grid, bonus, occ, players, rules, types,
    mineSites: [...mineSites], bridgeSites: bridgeSites.map((s) => ({ ...s })), spellDefs, spells: [], nextSpell: 1, scanQueue: [], pickups: [], nextPickup: 1, lastDead: [], ai: [],
  };
}

/** Per-type values for spawnUnit. Units without `attack` can't fight back. */
export interface UnitType {
  kind?: number;
  speed?: number;
  hp?: number;
  attack?: AttackStats | null;
  /** Sight radius in cells; defaults to the attack's sight. Buildings see without attacking (castle 11). */
  sight?: number;
  priority?: number;
  /** Terrain the unit may enter; default open and rough ground. */
  moves?: TerrainMask;
  /** Occupancy layer: 0 ground (default), 1 air, 2 bridges. */
  layer?: number;
  role?: number;
  /** Economy fields; see EntityType. Defaults make a finished 1x1 unit. */
  size?: number;
  buildTime?: number;
  /** Heroes: most charge (entity +0x64) and spell ids. Others leave these out. */
  charge?: number;
  spells?: number[];
}

/** Entities.ebp speed of a building (+0x0C = 0xFFFF): it never moves, so the sim stores 0. */
const IMMOBILE = 0xffff;

/** HP for units spawned without a type (test fixtures). */
const DEFAULT_HP = 100;

/**
 * The entity table gives every unit and building attack fields, but one with no
 * melee damage and no projectile (castles, farms, mills) has nothing to hit with
 * (likely: 0x02050A40 would deal max(1, bonus) a swing, which no building does).
 */
const canAttack = (a: AttackStats | null | undefined): a is AttackStats => !!a && (a.projectile !== null || a.damage > 0 || a.damageRand > 0);

export function spawnUnit(w: World, owner: PlayerId, x: Fx, y: Fx, type: UnitType = {}): Unit {
  const hp = type.hp ?? DEFAULT_HP;
  const u: Unit = {
    id: w.nextId++,
    owner,
    x,
    y,
    tx: null,
    ty: null,
    path: [],
    speed: type.speed === IMMOBILE ? 0 : type.speed ?? DEFAULT_SPEED,
    kind: type.kind ?? -1,
    hp,
    maxHp: hp,
    attack: canAttack(type.attack) ? type.attack : null,
    sight: type.sight ?? type.attack?.sight ?? 0,
    target: null,
    ordered: false,
    lastAttack: NEVER,
    cell: -1,
    mv: null,
    lastHit: NEVER,
    lastHitBy: -1,
    born: w.tick,
    priority: type.priority ?? 0,
    moves: type.moves ?? MOVES_GROUND,
    layer: type.layer ?? 0,
    role: type.role ?? -1,
    size: type.size ?? 1,
    buildTime: type.buildTime ?? 0,
    progress: type.buildTime ?? 0,
    job: null,
    carrying: false,
    queue: [],
    prod: 0,
    payout: 0,
    // Only heroes carry charge; buildings hold 0xFFFF and units 0 in the table.
    maxCharge: type.role === ROLE_HERO ? type.charge ?? 0 : 0,
    charge: type.role === ROLE_HERO ? type.charge ?? 0 : 0,
    spells: type.role === ROLE_HERO ? [...(type.spells ?? [])] : [],
    buffs: new Array<number>(BUFF_SLOTS).fill(0),
    boost: 0,
    grace: 0,
    frozen: 0,
    tracked: 0,
    stance: STANCE_HOLD,
    post: -1,
    route: [],
    leg: 0,
    since: w.tick,
    back: 0,
    rally: -1,
  };
  w.units.push(u); // ids are monotonic, so push keeps the array sorted
  if (u.size === 1) placeUnit(w, u); // bigger buildings block their footprint in the grid instead
  u.post = cellUnder(w, u); // a new unit guards the cell it appears on (game: its first command is a hold)
  startAura(w, u);
  return u;
}

/** Spawn an entity of a ROM type in a map cell (production and construction sites). */
const spawnInCell: SpawnFn = (w, owner, t, cell) => {
  const { x, y } = cellPos(w.grid!, cell);
  countBuilt(w, owner, t.role); // a trained unit (0x02072228)
  return spawnUnit(w, owner, x, y, t);
};

/**
 * Put a building on the map with its top-left at cell (cx, cy), finished by
 * default. Marks its footprint as blocked.
 */
export function placeBuilding(w: World, owner: PlayerId, t: UnitType, cx: number, cy: number, finished = true): Unit {
  const g = w.grid!;
  const { x: px, y: py } = cellPos(g, cy * g.width + cx);
  const b = spawnUnit(w, owner, px, py, t);
  if (b.cell >= 0) removeUnit(w, b);
  const size = t.size ?? 1;
  // Bridges stand on their own layer over water and leave the terrain alone until finished (bridges.ts).
  if (t.role !== ROLE_BRIDGE)
    for (let y = cy; y < Math.min(g.height, cy + fpH(size)); y++)
      for (let x = cx; x < Math.min(g.width, cx + fpW(size)); x++) g.cells[y * g.width + x] = TERRAIN_BUILDING;
  if (!finished) {
    b.progress = 0;
    b.hp = 1;
  }
  return b;
}

const isInsideId = (w: World, id: number): boolean => {
  const u = findById(w.units, id);
  return u !== undefined && isInside(u);
};

function applyCommand(w: World, player: PlayerId, cmd0: Command): void {
  // Builders inside a building can't be given orders (they're off the map until they come out).
  const cmd = 'unitIds' in cmd0 ? { ...cmd0, unitIds: cmd0.unitIds.filter((id) => !isInsideId(w, id)) } : cmd0;
  switch (cmd.kind) {
    case 'move': {
      const units = w.units.filter((u) => u.owner === player && u.speed > 0 && cmd.unitIds.includes(u.id));
      for (const u of units) {
        u.target = null;
        u.ordered = false;
        u.job = null;
        // A combat move (mode 2, the computer's advance) fights on the way: a hold with no post, so
        // it scans as it walks with no leash and stays where its last fight ends. likely
        u.stance = cmd.mode === 2 ? STANCE_HOLD : STANCE_MOVE;
        if (cmd.mode === 2) {
          u.post = -1;
          u.since = w.tick;
        }
        u.back = 0;
      }
      if (w.grid) planGroupMove(w, w.grid, units, cmd.x, cmd.y);
      else
        for (const u of units) {
          u.tx = cmd.x;
          u.ty = cmd.y;
          u.path = [];
        }
      break;
    }
    case 'attack': {
      const t = findById(w.units, cmd.target);
      if (!t || t.owner === player || isInside(t)) break;
      for (const u of w.units) {
        if (u.owner === player && u.attack && cmd.unitIds.includes(u.id)) {
          u.target = t.id;
          u.ordered = true;
          u.job = null;
          // The attack command replaces any stance; when it ends the unit holds where it stands.
          u.stance = STANCE_HOLD;
          u.back = 0;
        }
      }
      break;
    }
    case 'harvest':
      orderHarvest(w, player, cmd.unitIds, cmd.cx, cmd.cy);
      break;
    case 'build':
      orderBuild(w, player, cmd.unitIds, cmd.type, cmd.cx, cmd.cy, placeBuilding);
      break;
    case 'construct':
      orderConstruct(w, player, cmd.unitIds, cmd.site);
      break;
    case 'wall':
      orderWall(w, player, cmd.unitIds, cmd.type, cmd.fx, cmd.fy, cmd.tx, cmd.ty);
      break;
    case 'bridge':
      orderBridge(w, player, cmd.unitIds, cmd.type, cmd.cx, cmd.cy);
      break;
    case 'train':
      orderTrain(w, player, cmd.building, cmd.type);
      break;
    case 'upgrade':
      orderUpgrade(w, player, cmd.building);
      break;
    case 'repair':
      orderRepair(w, player, cmd.unitIds, cmd.target);
      break;
    case 'cancel':
      orderCancel(w, player, cmd.building, cmd.index);
      break;
    case 'cast':
      orderCast(w, player, cmd);
      break;
    case 'stop':
      orderStop(w, player, cmd.unitIds);
      break;
    case 'stand':
      orderStand(w, player, cmd.unitIds);
      break;
    case 'patrol':
      if (w.grid) orderPatrol(w, player, cmd.unitIds, cellIndex(w.grid, cmd.ax, cmd.ay), cellIndex(w.grid, cmd.bx, cmd.by));
      break;
    case 'rally':
      orderRally(w, player, cmd.unitIds, cmd.cx, cmd.cy);
      break;
  }
}

/**
 * Give each unit (in id order) its own goal cell near the click; the first
 * unit gets the clicked cell. Units walk to the centre of their goal cell,
 * like the game (it never targets the exact tapped pixel).
 * Spreading a group over distinct cells is our own rule so far: how the game
 * picks group goals is not traced yet (docs/re-notes/movement.md).
 */
function planGroupMove(w: World, g: TerrainGrid, units: readonly Unit[], x: Fx, y: Fx): void {
  const [cx, cy] = cellOf(x, y);
  // Units that cross different terrain (ships, flyers, walkers) spread separately,
  // each over the area its own members can reach. Our rule, like the spreading itself.
  const masks: TerrainMask[] = [];
  for (const u of units) if (!masks.includes(u.moves)) masks.push(u.moves);
  for (const moves of masks) {
    const group = units.filter((u) => u.moves === moves);
    const starts = group.map((u) => {
      const [ux, uy] = cellOf(u.x, u.y);
      return uy * g.width + ux;
    });
    const goals = spreadCells(g, cx, cy, group.length, reachableFrom(g, starts, moves), moves);
    group.forEach((u, k) => {
      const goal = goals[k];
      if (goal !== undefined) orderMove(w, u, goal); // else nowhere to stand: ignore the order
    });
  }
}

/** Movement without a map (bare test worlds): straight at (tx, ty), no collisions. */
function moveUnit(u: Unit): void {
  if (u.tx === null || u.ty === null) return;
  const n = stepToward(u.x, u.y, u.tx, u.ty, stepBudget(moveSpeed(u)));
  u.x = n.x;
  u.y = n.y;
  if (n.arrived) u.tx = u.ty = null;
}

/** Advance one tick. `cmds` must all be scheduled for `w.tick`. */
export function step(w: World, cmds: readonly ScheduledCommand[]): void {
  for (const c of orderCommands(cmds)) {
    if (c.tick !== w.tick) throw new Error(`command for tick ${c.tick} applied on ${w.tick}`);
    applyCommand(w, c.player, c.cmd);
  }
  // Computer opponents decide after the people's commands and give theirs through the same path.
  for (const ai of w.ai) for (const cmd of aiStep(w, ai)) applyCommand(w, ai.player, cmd);
  for (const u of w.units) {
    refreshBoost(u);
    regenCharge(u);
    if (!isFrozen(w, u)) combatStep(w, u);
  }
  stepProjectiles(w);
  spellsStep(w);
  for (const u of w.units) {
    if (u.hp === 0 || isFrozen(w, u)) continue;
    if (w.grid) moveOnMap(w, u);
    else moveUnit(u);
  }
  pickupsStep(w);
  if (w.types.length > 0) economyStep(w, spawnInCell, placeBuilding);
  // A bridge going down takes the ground units on it with it, so they die this tick too.
  if (w.grid) for (const b of w.units) if (b.hp === 0 && b.role === ROLE_BRIDGE) collapseBridge(w, b);
  const dead = w.units.filter((u) => u.hp === 0);
  for (const u of dead) {
    removeUnit(w, u);
    if (isBuilding(u)) clearFootprint(w, u);
  }
  w.units = w.units.filter((u) => u.hp > 0);
  w.lastDead = dead;
  for (const u of dead) {
    countDeath(w, u);
    onUnitLost(w, u.owner);
  }
  checkBricks(w);
  w.tick++;
}

/** Deep copy, used by the renderer to keep the previous tick for interpolation. */
export function cloneWorld(w: World): World {
  return {
    ...w,
    rng: { ...w.rng },
    units: w.units.map((u) => ({ ...u, path: [...u.path], route: [...u.route], mv: u.mv && { ...u.mv }, job: u.job && { ...u.job }, queue: [...u.queue], spells: [...u.spells], buffs: [...u.buffs] })),
    occ: w.occ && w.occ.slice(),
    grid: w.grid && { ...w.grid, cells: w.grid.cells.slice() },
    mineSites: [...w.mineSites],
    bridgeSites: w.bridgeSites,
    projectiles: w.projectiles.map((p) => ({ ...p })),
    spells: w.spells.map((s) => ({ ...s, units: [...s.units] })),
    scanQueue: [...w.scanQueue],
    pickups: w.pickups.map((p) => ({ ...p })),
    players: w.players.map((p) => ({ ...p, ...(p.stats ? { stats: { built: [...p.stats.built], lost: [...p.stats.lost], destroyed: [...p.stats.destroyed], bricks: p.stats.bricks } } : {}) })),
    // The renderer's copy never steps, so it can share the AI state.
    ai: w.ai,
  };
}
