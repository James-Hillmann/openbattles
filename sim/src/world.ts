import { fxAdd, fxLen, fxMulDiv, fxRaw, type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import type { PlayerId, Unit, World } from './state';
import { cellCenterX, cellCenterY, cellOf, findPath, reachableFrom, simplifyPath, spreadCells, type TerrainGrid } from './terrain';

export interface WorldInit {
  seed: number;
  grid?: TerrainGrid | null;
}

export function createWorld({ seed, grid = null }: WorldInit): World {
  return { tick: 0, rng: makeRng(seed), nextId: 1, units: [], grid };
}

export function spawnUnit(w: World, owner: PlayerId, x: Fx, y: Fx, speed = DEFAULT_SPEED): Unit {
  const u: Unit = { id: w.nextId++, owner, x, y, tx: null, ty: null, path: [], speed };
  w.units.push(u); // ids are monotonic, so push keeps the array sorted
  return u;
}

function applyCommand(w: World, player: PlayerId, cmd: Command): void {
  switch (cmd.kind) {
    case 'move': {
      const units = w.units.filter((u) => u.owner === player && cmd.unitIds.includes(u.id));
      if (w.grid) planGroupMove(w.grid, units, cmd.x, cmd.y);
      else
        for (const u of units) {
          u.tx = cmd.x;
          u.ty = cmd.y;
          u.path = [];
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
 */
function moveUnit(u: Unit, g: TerrainGrid | null): void {
  // speed/4096 cell = speed*48/4096 48ths = speed*768 in Fx raw units.
  let budget = fxRaw(u.speed * 768);
  while (u.tx !== null && u.ty !== null && budget > 0) {
    const wp = u.path[0];
    const gx = wp !== undefined && g ? cellCenterX(wp % g.width) : u.tx;
    const gy = wp !== undefined && g ? cellCenterY(Math.floor(wp / g.width)) : u.ty;
    const dx = (gx - u.x) as Fx;
    const dy = (gy - u.y) as Fx;
    const dist48 = fxLen((dx * 2) as Fx, (dy * 3) as Fx);
    if (dist48 <= budget) {
      // Reach this waypoint and spend what's left of the step on the next leg.
      u.x = gx;
      u.y = gy;
      budget = (budget - dist48) as Fx;
      if (wp !== undefined) u.path.shift();
      else u.tx = u.ty = null;
      continue;
    }
    // Scale by budget/dist in one go. A Q16.16 ratio budget/dist is tiny on long moves and truncating it
    // made units slower the farther away their target was (0.4% at 20 cells).
    u.x = fxAdd(u.x, fxMulDiv(dx, budget, dist48));
    u.y = fxAdd(u.y, fxMulDiv(dy, budget, dist48));
    break;
  }
}

/** Advance one tick. `cmds` must all be scheduled for `w.tick`. */
export function step(w: World, cmds: readonly ScheduledCommand[]): void {
  for (const c of orderCommands(cmds)) {
    if (c.tick !== w.tick) throw new Error(`command for tick ${c.tick} applied on ${w.tick}`);
    applyCommand(w, c.player, c.cmd);
  }
  for (const u of w.units) moveUnit(u, w.grid);
  w.tick++;
}

/** Deep copy, used by the renderer to keep the previous tick for interpolation. */
export function cloneWorld(w: World): World {
  return { ...w, rng: { ...w.rng }, units: w.units.map((u) => ({ ...u, path: [...u.path] })) };
}
