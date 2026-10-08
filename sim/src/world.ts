import { fx, fxAdd, fxDiv, fxLen, fxMul, type Fx } from './fixed';
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

export function spawnUnit(w: World, owner: PlayerId, x: Fx, y: Fx): Unit {
  const u: Unit = { id: w.nextId++, owner, x, y, tx: null, ty: null, speed: fx(4) };
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

function moveUnit(u: Unit): void {
  if (u.tx === null || u.ty === null) return;
  const dx = (u.tx - u.x) as Fx;
  const dy = (u.ty - u.y) as Fx;
  const dist = fxLen(dx, dy);
  if (dist <= u.speed) {
    u.x = u.tx;
    u.y = u.ty;
    u.tx = u.ty = null;
    return;
  }
  const k = fxDiv(u.speed, dist);
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
