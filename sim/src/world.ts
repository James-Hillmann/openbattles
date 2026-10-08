import { type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import { NEVER, combatStep, findById, stepProjectiles } from './combat';
import { stepBudget, stepToward } from './motion';
import { OCC_LAYERS, type AttackStats, type GameRules, type MeleeBonusTable, type Player, type PlayerId, type Unit, type World } from './state';
import { MOVES_GROUND, cellOf, reachableFrom, spreadCells, type TerrainGrid, type TerrainMask } from './terrain';
import { moveOnMap, orderMove, placeUnit, removeUnit } from './movement';
import { checkBricks, onUnitLost } from './rules';

export interface WorldInit {
  seed: number;
  grid?: TerrainGrid | null;
  bonus?: MeleeBonusTable | null;
  /** Skirmish players (ids 0..n-1); omit for a sandbox world that never ends. */
  players?: Player[];
  rules?: GameRules | null;
}

export function createWorld({ seed, grid = null, bonus = null, players = [], rules = null }: WorldInit): World {
  const occ = grid ? new Int32Array(OCC_LAYERS * grid.width * grid.height) : null;
  return { tick: 0, rng: makeRng(seed), nextId: 1, units: [], projectiles: [], grid, bonus, occ, players, rules };
}

/** Per-type values for spawnUnit. Units without `attack` can't fight back. */
export interface UnitType {
  kind?: number;
  speed?: number;
  hp?: number;
  attack?: AttackStats | null;
  priority?: number;
  /** Terrain the unit may enter; default open and rough ground. */
  moves?: TerrainMask;
  /** Occupancy layer: 0 ground (default), 1 air, 2 bridges. */
  layer?: number;
  role?: number;
}

/** HP for units spawned without a type (test fixtures). */
const DEFAULT_HP = 100;

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
    speed: type.speed ?? DEFAULT_SPEED,
    kind: type.kind ?? -1,
    hp,
    maxHp: hp,
    attack: type.attack ?? null,
    target: null,
    ordered: false,
    lastAttack: NEVER,
    cell: -1,
    mv: null,
    lastHit: NEVER,
    born: w.tick,
    priority: type.priority ?? 0,
    moves: type.moves ?? MOVES_GROUND,
    layer: type.layer ?? 0,
    role: type.role ?? -1,
  };
  w.units.push(u); // ids are monotonic, so push keeps the array sorted
  placeUnit(w, u);
  return u;
}

function applyCommand(w: World, player: PlayerId, cmd: Command): void {
  switch (cmd.kind) {
    case 'move': {
      const units = w.units.filter((u) => u.owner === player && u.speed > 0 && cmd.unitIds.includes(u.id));
      for (const u of units) {
        u.target = null;
        u.ordered = false;
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
      if (!t || t.owner === player) break;
      for (const u of w.units) {
        if (u.owner === player && u.attack && cmd.unitIds.includes(u.id)) {
          u.target = t.id;
          u.ordered = true;
        }
      }
      break;
    }
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
  const n = stepToward(u.x, u.y, u.tx, u.ty, stepBudget(u.speed));
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
  for (const u of w.units) combatStep(w, u);
  stepProjectiles(w);
  for (const u of w.units) {
    if (u.hp === 0) continue;
    if (w.grid) moveOnMap(w, u);
    else moveUnit(u);
  }
  const dead = w.units.filter((u) => u.hp === 0);
  for (const u of dead) removeUnit(w, u);
  w.units = w.units.filter((u) => u.hp > 0);
  for (const u of dead) onUnitLost(w, u.owner);
  checkBricks(w);
  w.tick++;
}

/** Deep copy, used by the renderer to keep the previous tick for interpolation. */
export function cloneWorld(w: World): World {
  return {
    ...w,
    rng: { ...w.rng },
    units: w.units.map((u) => ({ ...u, path: [...u.path], mv: u.mv && { ...u.mv } })),
    occ: w.occ && w.occ.slice(),
    projectiles: w.projectiles.map((p) => ({ ...p })),
    players: w.players.map((p) => ({ ...p })),
  };
}
