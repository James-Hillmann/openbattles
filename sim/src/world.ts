import { fxAdd, fxDiv, fxLen, fxMul, fxRaw, type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import { NEVER, combatStep, findById, projectileDamage } from './combat';
import type { AttackStats, MeleeBonusTable, PlayerId, Unit, World } from './state';

export interface WorldInit {
  seed: number;
  bonus?: MeleeBonusTable | null;
}

export function createWorld({ seed, bonus = null }: WorldInit): World {
  return { tick: 0, rng: makeRng(seed), nextId: 1, units: [], projectiles: [], bonus };
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
    case 'move':
      for (const u of w.units) {
        if (u.owner === player && cmd.unitIds.includes(u.id)) {
          u.tx = cmd.x;
          u.ty = cmd.y;
          u.target = null;
        }
      }
      break;
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
 * The game moves units in cell space: a cell is 24x16 px, but a unit covers the
 * same number of cells per tick in any direction, so it is faster in px going
 * sideways than up/down. We measure distance in 48ths of a cell (48 = lcm(24,16)):
 * 1 px across = 2/48 cell, 1 px down = 3/48 cell.
 * Moves (x, y) toward (tx, ty) by speed/4096 cell; returns the new position and whether it arrived.
 */
function stepToward(x: Fx, y: Fx, tx: Fx, ty: Fx, speed: number): { x: Fx; y: Fx; arrived: boolean } {
  const dx = (tx - x) as Fx;
  const dy = (ty - y) as Fx;
  const dist48 = fxLen((dx * 2) as Fx, (dy * 3) as Fx);
  // speed/4096 cell = speed*48/4096 48ths = speed*768 in Fx raw units.
  const step48 = fxRaw(speed * 768);
  if (dist48 <= step48) return { x: tx, y: ty, arrived: true };
  const k = fxDiv(step48, dist48);
  return { x: fxAdd(x, fxMul(dx, k)), y: fxAdd(y, fxMul(dy, k)), arrived: false };
}

function moveUnit(u: Unit): void {
  if (u.tx === null || u.ty === null) return;
  const p = stepToward(u.x, u.y, u.tx, u.ty, u.speed);
  u.x = p.x;
  u.y = p.y;
  if (p.arrived) u.tx = u.ty = null;
}

/** Projectiles home on their target and hit on arrival; they fizzle if it is gone. */
function stepProjectiles(w: World): void {
  const keep = [];
  for (const p of w.projectiles) {
    const t = findById(w.units, p.target);
    if (!t || t.hp === 0) continue;
    const n = stepToward(p.x, p.y, t.x, t.y, p.type.speed);
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
  for (const u of w.units) if (u.hp > 0) moveUnit(u);
  w.units = w.units.filter((u) => u.hp > 0);
  w.tick++;
}

/** Deep copy, used by the renderer to keep the previous tick for interpolation. */
export function cloneWorld(w: World): World {
  return {
    ...w,
    rng: { ...w.rng },
    units: w.units.map((u) => ({ ...u })),
    projectiles: w.projectiles.map((p) => ({ ...p })),
  };
}
