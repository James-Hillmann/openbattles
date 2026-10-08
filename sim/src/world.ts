import { fxAdd, fxDiv, fxLen, fxMul, fxRaw, type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import type { PlayerId, Unit, World } from './state';

export interface WorldInit {
  seed: number;
}

export function createWorld({ seed }: WorldInit): World {
  return { tick: 0, rng: makeRng(seed), nextId: 1, units: [] };
}

export function spawnUnit(w: World, owner: PlayerId, x: Fx, y: Fx, speed = DEFAULT_SPEED): Unit {
  const u: Unit = { id: w.nextId++, owner, x, y, tx: null, ty: null, speed };
  w.units.push(u); // ids are monotonic, so push keeps the array sorted
  return u;
}

function applyCommand(w: World, player: PlayerId, cmd: Command): void {
  switch (cmd.kind) {
    case 'move':
      for (const u of w.units) {
        if (u.owner === player && cmd.unitIds.includes(u.id)) {
          u.tx = cmd.x;
          u.ty = cmd.y;
        }
      }
      break;
  }
}

/**
 * The game moves units in cell space: a cell is 24x16 px, but a unit covers the
 * same number of cells per tick in any direction, so it is faster in px going
 * sideways than up/down. We measure distance in 48ths of a cell (48 = lcm(24,16)):
 * 1 px across = 2/48 cell, 1 px down = 3/48 cell.
 */
function moveUnit(u: Unit): void {
  if (u.tx === null || u.ty === null) return;
  const dx = (u.tx - u.x) as Fx;
  const dy = (u.ty - u.y) as Fx;
  const dist48 = fxLen((dx * 2) as Fx, (dy * 3) as Fx);
  // speed/4096 cell = speed*48/4096 48ths = speed*768 in Fx raw units.
  const step48 = fxRaw(u.speed * 768);
  if (dist48 <= step48) {
    u.x = u.tx;
    u.y = u.ty;
    u.tx = u.ty = null;
    return;
  }
  const k = fxDiv(step48, dist48);
  u.x = fxAdd(u.x, fxMul(dx, k));
  u.y = fxAdd(u.y, fxMul(dy, k));
}

/** Advance one tick. `cmds` must all be scheduled for `w.tick`. */
export function step(w: World, cmds: readonly ScheduledCommand[]): void {
  for (const c of orderCommands(cmds)) {
    if (c.tick !== w.tick) throw new Error(`command for tick ${c.tick} applied on ${w.tick}`);
    applyCommand(w, c.player, c.cmd);
  }
  for (const u of w.units) moveUnit(u);
  w.tick++;
}

/** Deep copy, used by the renderer to keep the previous tick for interpolation. */
export function cloneWorld(w: World): World {
  return { ...w, rng: { ...w.rng }, units: w.units.map((u) => ({ ...u })) };
}
