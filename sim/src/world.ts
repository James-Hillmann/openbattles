import { fxAdd, fxLen, fxMulDiv, fxRaw, type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import { NEVER, combatStep, findById, projectileDamage } from './combat';
import type { AttackStats, MeleeBonusTable, PlayerId, Unit, World } from './state';
import { cellCenterX, cellCenterY, cellOf, findPath, reachableFrom, simplifyPath, spreadCells, type TerrainGrid } from './terrain';

export interface WorldInit {
  seed: number;
  grid?: TerrainGrid | null;
  bonus?: MeleeBonusTable | null;
}

export function createWorld({ seed, grid = null, bonus = null }: WorldInit): World {
  return { tick: 0, rng: makeRng(seed), nextId: 1, units: [], projectiles: [], grid, bonus };
}

/** Per-type values for spawnUnit. Units without `attack` can't fight back. */
export interface UnitType {
  kind?: number;
  speed?: number;
  hp?: number;
  attack?: AttackStats | null;
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
    lastAttack: NEVER,
  };
  w.units.push(u); // ids are monotonic, so push keeps the array sorted
  return u;
}

function applyCommand(w: World, player: PlayerId, cmd: Command): void {
  switch (cmd.kind) {
    case 'move': {
      const units = w.units.filter((u) => u.owner === player && cmd.unitIds.includes(u.id));
      for (const u of units) u.target = null;
      if (w.grid) planGroupMove(w.grid, units, cmd.x, cmd.y);
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
        if (u.owner === player && u.attack && cmd.unitIds.includes(u.id)) u.target = t.id;
      }
      break;
    }
  }
}

/**
 * Give each unit (in id order) its own cell near the click and a path there.
 * The first unit goes to the exact clicked point when it can reach that cell.
 */
function planGroupMove(g: TerrainGrid, units: readonly Unit[], x: Fx, y: Fx): void {
  const [cx, cy] = cellOf(x, y);
  const click = cy * g.width + cx;
  const starts = units.map((u) => {
    const [ux, uy] = cellOf(u.x, u.y);
    return uy * g.width + ux;
  });
  const goals = spreadCells(g, cx, cy, units.length, reachableFrom(g, starts));
  units.forEach((u, k) => {
    const goal = goals[k];
    if (goal === undefined) return; // nowhere to stand: ignore the order
    const start = starts[k]!;
    const ux = start % g.width;
    const uy = Math.floor(start / g.width);
    const raw = findPath(g, ux, uy, goal % g.width, Math.floor(goal / g.width));
    const end = raw.length > 0 ? raw[raw.length - 1]! : start;
    const exact = k === 0 && end === click;
    u.tx = exact ? x : cellCenterX(end % g.width);
    u.ty = exact ? y : cellCenterY(Math.floor(end / g.width));
    u.path = simplifyPath(g, start, raw).slice(0, -1);
  });
}

/**
 * The game moves units in cell space: a cell is 24x16 px, but a unit covers the
 * same number of cells per tick in any direction, so it is faster in px going
 * sideways than up/down. We measure distance in 48ths of a cell (48 = lcm(24,16)):
 * 1 px across = 2/48 cell, 1 px down = 3/48 cell.
 * Moves (x, y) toward (tx, ty) by at most `budget` (48ths of a cell, Fx).
 */
function stepToward(x: Fx, y: Fx, tx: Fx, ty: Fx, budget: Fx): { x: Fx; y: Fx; arrived: boolean; left: Fx } {
  const dx = (tx - x) as Fx;
  const dy = (ty - y) as Fx;
  const dist48 = fxLen((dx * 2) as Fx, (dy * 3) as Fx);
  if (dist48 <= budget) return { x: tx, y: ty, arrived: true, left: (budget - dist48) as Fx };
  // Scale by budget/dist in one go. A Q16.16 ratio budget/dist is tiny on long moves and truncating it
  // made units slower the farther away their target was (0.4% at 20 cells).
  return { x: fxAdd(x, fxMulDiv(dx, budget, dist48)), y: fxAdd(y, fxMulDiv(dy, budget, dist48)), arrived: false, left: 0 as Fx };
}

/** speed/4096 cell = speed*48/4096 48ths = speed*768 in Fx raw units. */
const stepBudget = (speed: number): Fx => fxRaw(speed * 768);

function moveUnit(u: Unit, g: TerrainGrid | null): void {
  let budget = stepBudget(u.speed);
  while (u.tx !== null && u.ty !== null && budget > 0) {
    const wp = u.path[0];
    const gx = wp !== undefined && g ? cellCenterX(wp % g.width) : u.tx;
    const gy = wp !== undefined && g ? cellCenterY(Math.floor(wp / g.width)) : u.ty;
    const n = stepToward(u.x, u.y, gx, gy, budget);
    u.x = n.x;
    u.y = n.y;
    if (!n.arrived) break;
    // Reached this waypoint: spend what's left of the step on the next leg.
    budget = n.left;
    if (wp !== undefined) u.path.shift();
    else u.tx = u.ty = null;
  }
}

/** Projectiles home on their target and hit on arrival; they fizzle if it is gone. */
function stepProjectiles(w: World): void {
  const keep = [];
  for (const p of w.projectiles) {
    const t = findById(w.units, p.target);
    if (!t || t.hp === 0) continue;
    const n = stepToward(p.x, p.y, t.x, t.y, stepBudget(p.type.speed));
    p.x = n.x;
    p.y = n.y;
    if (!n.arrived) {
      keep.push(p);
      continue;
    }
    const dmg = projectileDamage(w, p);
    t.hp = t.hp > dmg ? t.hp - dmg : 0;
  }
  w.projectiles = keep;
}

/** Advance one tick. `cmds` must all be scheduled for `w.tick`. */
export function step(w: World, cmds: readonly ScheduledCommand[]): void {
  for (const c of orderCommands(cmds)) {
    if (c.tick !== w.tick) throw new Error(`command for tick ${c.tick} applied on ${w.tick}`);
    applyCommand(w, c.player, c.cmd);
  }
  for (const u of w.units) combatStep(w, u);
  stepProjectiles(w);
  for (const u of w.units) if (u.hp > 0) moveUnit(u, w.grid);
  w.units = w.units.filter((u) => u.hp > 0);
  w.tick++;
}

/** Deep copy, used by the renderer to keep the previous tick for interpolation. */
export function cloneWorld(w: World): World {
  return {
    ...w,
    rng: { ...w.rng },
    units: w.units.map((u) => ({ ...u, path: [...u.path] })),
    projectiles: w.projectiles.map((p) => ({ ...p })),
  };
}
