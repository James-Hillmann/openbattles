import { fxAdd, fxLen, fxMulDiv, fxRaw, type Fx } from './fixed';
import { DEFAULT_SPEED } from './config';
import { makeRng } from './rng';
import type { Command, ScheduledCommand } from './commands';
import { orderCommands } from './commands';
import { NEVER, combatStep, findById, projectileDamage } from './combat';
import type { AttackStats, MeleeBonusTable, PlayerId, Unit, World } from './state';
import { cellOf, reachableFrom, spreadCells, type TerrainGrid } from './terrain';
import { moveOnMap, orderMove, placeUnit, removeUnit, stepBudget, stepToward } from './movement';

export interface WorldInit {
  seed: number;
  grid?: TerrainGrid | null;
  bonus?: MeleeBonusTable | null;
}

export function createWorld({ seed, grid = null, bonus = null }: WorldInit): World {
  const occ = grid ? new Int32Array(grid.width * grid.height) : null;
  return { tick: 0, rng: makeRng(seed), nextId: 1, units: [], projectiles: [], grid, bonus, occ };
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
    cell: -1,
    mv: null,
  };
  w.units.push(u); // ids are monotonic, so push keeps the array sorted
  placeUnit(w, u);
  return u;
}

function applyCommand(w: World, player: PlayerId, cmd: Command): void {
  switch (cmd.kind) {
    case 'move': {
      const units = w.units.filter((u) => u.owner === player && cmd.unitIds.includes(u.id));
      for (const u of units) u.target = null;
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
        if (u.owner === player && u.attack && cmd.unitIds.includes(u.id)) u.target = t.id;
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
  const starts = units.map((u) => {
    const [ux, uy] = cellOf(u.x, u.y);
    return uy * g.width + ux;
  });
  const goals = spreadCells(g, cx, cy, units.length, reachableFrom(g, starts));
  units.forEach((u, k) => {
    const goal = goals[k];
    if (goal !== undefined) orderMove(w, u, goal); // else nowhere to stand: ignore the order
  });
}

/** Movement without a map (bare test worlds): straight at (tx, ty), no collisions. */
function moveUnit(u: Unit): void {
  if (u.tx === null || u.ty === null) return;
  const n = stepToward(u.x, u.y, u.tx, u.ty, stepBudget(u.speed));
  u.x = n.x;
  u.y = n.y;
  if (n.arrived) u.tx = u.ty = null;
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
  for (const u of w.units) {
    if (u.hp === 0) continue;
    if (w.grid) moveOnMap(w, u);
    else moveUnit(u);
  }
  for (const u of w.units) if (u.hp === 0) removeUnit(w, u);
  w.units = w.units.filter((u) => u.hp > 0);
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
  };
}
