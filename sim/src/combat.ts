import { CELL_H, CELL_W } from './config';
import { FX_SHIFT, type Fx } from './fixed';
import { nextInt } from './rng';
import type { EntityId, MeleeBonusTable, Projectile, Unit, World } from './state';
import { stepBudget, stepToward } from './motion';
import { cellCenterX, cellCenterY, cellOf } from './terrain';
import { orderMove, stopMove } from './movement';
import { damageTaken, meleeDamage } from './spells';

/** lastAttack value for a unit that has never attacked. */
export const NEVER = -0x40000000;

/** Binary search: units and projectiles are kept sorted by id. */
export function findById<T extends { id: EntityId }>(list: readonly T[], id: EntityId): T | undefined {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid]!;
    if (v.id === id) return v;
    if (v.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** Map cell a position lies in. Positions are Fx pixels. */
const cellX = (x: number) => Math.floor(x / (CELL_W << FX_SHIFT));
const cellY = (y: number) => Math.floor(y / (CELL_H << FX_SHIFT));

/**
 * A unit's footprint: a building covers `size` x `size` cells from the cell its
 * position is in (its top-left); everything else is one cell.
 */
export function footprint(u: { x: number; y: number; size?: number }): { x0: number; y0: number; size: number } {
  return { x0: cellX(u.x), y0: cellY(u.y), size: u.size ?? 1 };
}

/** The footprint cell of `t` nearest to cell (cx, cy): the cell itself when inside. */
export function nearestFootprintCell(cx: number, cy: number, t: { x: number; y: number; size?: number }): [number, number] {
  const f = footprint(t);
  return [Math.min(Math.max(cx, f.x0), f.x0 + f.size - 1), Math.min(Math.max(cy, f.y0), f.y0 + f.size - 1)];
}

/**
 * Squared distance in whole cells, the metric the game's range check uses
 * (0x0207F640): from the attacker's cell to the nearest cell of the target's footprint.
 */
export function cellDist2(a: Unit, b: { x: number; y: number; size?: number }): number {
  const [bx, by] = nearestFootprintCell(cellX(a.x), cellY(a.y), b);
  const dx = cellX(a.x) - bx;
  const dy = cellY(a.y) - by;
  return dx * dx + dy * dy;
}

/** Chebyshev distance from cell (cx, cy) to the nearest cell of a footprint (0 inside). */
function chebToFootprint(cx: number, cy: number, t: { x: number; y: number; size?: number }): number {
  const [bx, by] = nearestFootprintCell(cx, cy, t);
  return Math.max(Math.abs(cx - bx), Math.abs(cy - by));
}

export function inRange(u: Unit, t: Unit): boolean {
  if (!u.attack) return false;
  const d2 = cellDist2(u, t);
  return d2 >= u.attack.minRange * u.attack.minRange && d2 <= u.attack.maxRange * u.attack.maxRange;
}

/** Game: 0x02002B18. Signed bonus from the ROM tables; 0 when either side has no class. */
export function meleeBonus(t: MeleeBonusTable | null, attackerKind: number, defenderKind: number): number {
  if (!t || attackerKind < 0 || defenderKind < 0) return 0;
  const d = t.defenderClass[defenderKind] ?? 0xff;
  const a = t.attackerClass[attackerKind] ?? 0xff;
  if (d === 0xff || a === 0xff) return 0;
  return t.matrix[d * t.stride + a] ?? 0;
}

/**
 * Damage is applied in 20.12 fixed point times the target's damage multiplier: 1.0, or 0.5 with the
 * armor buff (spells.ts damageTaken). Upgrades are not ported.
 */
function applyDamage(w: World, t: Unit, hit: number): void {
  const dmg = damageTaken(t, hit);
  t.hp = t.hp > dmg ? t.hp - dmg : 0;
  t.lastHit = w.tick;
}

/** Game: melee branch of 0x02050A40. One RNG draw when damageRand > 0. */
function meleeHit(w: World, u: Unit, t: Unit): void {
  const a = u.attack!;
  const roll = a.damageRand > 0 ? nextInt(w.rng, a.damageRand) : 0;
  const base = Math.max(1, meleeDamage(u, a.damage) + meleeBonus(w.bonus, u.kind, t.kind));
  applyDamage(w, t, roll + base);
}

/** Game: 0x0206E950. One RNG draw when maxDamage > minDamage. */
function rollDamage(w: World, min: number, max: number): number {
  return min + (max > min ? nextInt(w.rng, max - min) : 0);
}

/** 1.0 - 0.2 * ring in 20.12, as the game computes it (0x333 is 0.2). */
const SPLASH_FACTOR = [4096, 4096 - 0x333, 4096 - 2 * 0x333];

/**
 * Game: 0x0206E5EC. Rings 0-2 of cells around the impact (a 5x5 square), skipping the
 * shooter's side; damage range scaled by 1.0 / 0.8 / 0.6 and truncated, then rolled per unit.
 * The game holds one unit per cell; here every enemy unit in a cell is hit, in id order.
 */
function splash(w: World, p: Projectile, cx: number, cy: number): void {
  for (const o of w.units) {
    if (o.owner === p.owner || o.hp === 0) continue;
    const ring = chebToFootprint(cx, cy, o); // a building is hit through its nearest footprint cell
    if (ring > 2) continue;
    const f = SPLASH_FACTOR[ring]!;
    applyDamage(w, o, rollDamage(w, (p.type.minDamage * f) >> 12, (p.type.maxDamage * f) >> 12));
  }
}

/**
 * Projectiles follow their target, moving in cell space at their speed from the tick they are
 * fired, and hit once they stand in the target's cell (game: 0x0206E2xx). Adjacent targets are
 * hit on the firing tick. A projectile whose target is gone does nothing (guess).
 */
export function stepProjectiles(w: World): void {
  const keep = [];
  for (const p of w.projectiles) {
    const t = findById(w.units, p.target);
    if (!t || t.hp === 0) continue;
    // Aim at the nearest cell of the target's footprint; a hit is landing in any footprint cell (0x0207ECFC).
    const [ax, ay] = nearestFootprintCell(cellX(p.x), cellY(p.y), t);
    const n = stepToward(p.x, p.y, t.size > 1 ? cellCenterX(ax) : t.x, t.size > 1 ? cellCenterY(ay) : t.y, stepBudget(p.type.speed));
    p.x = n.x;
    p.y = n.y;
    const cx = cellX(p.x);
    const cy = cellY(p.y);
    if (chebToFootprint(cx, cy, t) !== 0) {
      keep.push(p);
      continue;
    }
    if (p.type.splash) splash(w, p, cx, cy);
    else applyDamage(w, t, rollDamage(w, p.type.minDamage, p.type.maxDamage));
  }
  w.projectiles = keep;
}

/**
 * Where to walk to get in range. Ranged units walk at the target until in
 * range. Melee units (and anyone too close) aim for the cell next to the
 * target on the side they come from, so they don't end up in its cell, which
 * is out of range for a minimum range of 1. On a map the unit paths there,
 * re-planning only when the goal moves to another cell.
 */
function chase(w: World, u: Unit, t: Unit): void {
  const a = u.attack!;
  let gx: Fx;
  let gy: Fx;
  // A building is approached through its nearest footprint cell, so units attack it from any side.
  const [tx, ty] = nearestFootprintCell(cellX(u.x), cellY(u.y), t);
  if (a.maxRange > 1 && cellDist2(u, t) > a.maxRange * a.maxRange) {
    gx = t.size > 1 ? cellCenterX(tx) : t.x;
    gy = t.size > 1 ? cellCenterY(ty) : t.y;
  } else {
    const dcx = cellX(u.x) - tx;
    const dcy = cellY(u.y) - ty;
    let ox = 0;
    let oy = 0;
    if (dcx === 0 && dcy === 0) ox = u.x < t.x ? -1 : 1;
    else if (Math.abs(dcx) >= Math.abs(dcy)) ox = Math.sign(dcx);
    else oy = Math.sign(dcy);
    gx = (((tx + ox) * CELL_W + CELL_W / 2) << FX_SHIFT) as Fx;
    gy = (((ty + oy) * CELL_H + CELL_H / 2) << FX_SHIFT) as Fx;
  }
  if (!w.grid) {
    u.tx = gx;
    u.ty = gy;
    u.path = [];
    return;
  }
  const [cx, cy] = cellOf(gx, gy);
  const goal = Math.min(Math.max(cy, 0), w.grid.height - 1) * w.grid.width + Math.min(Math.max(cx, 0), w.grid.width - 1);
  // Keep the plotters' state when only the goal moves, like the game's follow-a-unit move (0x02054710).
  if (!u.mv || u.mv.align) orderMove(w, u, goal);
  u.mv!.goal = goal;
  u.tx = cellCenterX(goal % w.grid.width);
  u.ty = cellCenterY(Math.floor(goal / w.grid.width));
}

/** Units scan for targets once a second (game: AI counter, `(age + 28) % 30 == 0`). */
const SCAN_PERIOD = 30;
const SCAN_PHASE = 2;

/**
 * Game: 0x020638A8. Enemies within sight, and between min range and sight + max range, are
 * candidates. One in attack range beats one that isn't; then higher priority (+0x70) wins.
 * The game's tie order is unknown; here nearer, then lower id, wins (guess).
 */
function pickTarget(w: World, u: Unit): Unit | undefined {
  const a = u.attack!;
  // Buildings (role 8-19, i.e. towers) search their max range instead of their sight (likely: code).
  const sight = u.role >= 8 && u.role <= 19 ? a.maxRange : u.sight;
  const sight2 = sight * sight;
  const min2 = a.minRange * a.minRange;
  const far = sight + a.maxRange;
  let best: Unit | undefined;
  let bestIn = false;
  let bestD = 0;
  for (const o of w.units) {
    if (o.owner === u.owner || o.hp === 0) continue;
    const d = cellDist2(u, o);
    if (d > sight2 || d < min2 || d > far * far) continue;
    const isIn = d <= a.maxRange * a.maxRange;
    if (best) {
      if (bestIn !== isIn) {
        if (bestIn) continue;
      } else if (o.priority !== best.priority) {
        if (o.priority < best.priority) continue;
      } else if (d >= bestD) continue;
    }
    best = o;
    bestIn = isIn;
    bestD = d;
  }
  return best;
}

/**
 * Per-tick combat for one unit, run before it moves: drop dead targets, scan
 * for a better target once a second unless walking or obeying an attack order,
 * chase until in range, then attack whenever the cooldown has run out
 * (game: 0x02050A40, cooldown check against +0x19C).
 */
export function combatStep(w: World, u: Unit): void {
  if (!u.attack || u.hp === 0) return;
  let t = u.target === null ? undefined : findById(w.units, u.target);
  if (u.target !== null && (!t || t.hp === 0)) {
    // Target died or vanished: stop where we are.
    u.target = null;
    u.ordered = false;
    stopMove(w, u);
    t = undefined;
  }
  const scanning = t ? !u.ordered : u.tx === null;
  if (scanning && (w.tick - u.born) % SCAN_PERIOD === SCAN_PHASE) {
    const pick = pickTarget(w, u);
    if (pick) {
      t = pick;
      u.target = t.id;
    }
  }
  if (!t) return;
  if (!inRange(u, t)) {
    if (u.speed > 0) chase(w, u, t); // a tower waits for the target to come to it
    return;
  }
  stopMove(w, u);
  if (w.tick < u.lastAttack + u.attack.cooldown) return;
  u.lastAttack = w.tick;
  if (u.attack.projectile) {
    w.projectiles.push({ id: w.nextId++, owner: u.owner, x: u.x, y: u.y, target: t.id, type: u.attack.projectile });
  } else {
    meleeHit(w, u, t);
  }
}
