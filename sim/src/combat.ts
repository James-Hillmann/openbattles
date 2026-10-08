import { CELL_H, CELL_W } from './config';
import { FX_SHIFT, type Fx } from './fixed';
import { nextInt } from './rng';
import type { EntityId, MeleeBonusTable, Projectile, Unit, World } from './state';
import { cellOf, planUnitPath } from './terrain';

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

/** Squared distance in whole cells, the metric the game's range check uses. */
export function cellDist2(a: Unit, b: { x: number; y: number }): number {
  const dx = cellX(a.x) - cellX(b.x);
  const dy = cellY(a.y) - cellY(b.y);
  return dx * dx + dy * dy;
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
 * Damage is applied in 20.12 fixed point times the target's damage multiplier.
 * The multiplier is always 1.0 so far (buffs/upgrades are out of scope), which
 * makes this a plain integer subtraction clamped at 0.
 */
function applyDamage(t: Unit, dmg: number): void {
  t.hp = t.hp > dmg ? t.hp - dmg : 0;
}

/** Game: melee branch of 0x02050A40. One RNG draw when damageRand > 0. */
function meleeHit(w: World, u: Unit, t: Unit): void {
  const a = u.attack!;
  const roll = a.damageRand > 0 ? nextInt(w.rng, a.damageRand) : 0;
  const base = Math.max(1, a.damage + meleeBonus(w.bonus, u.kind, t.kind));
  applyDamage(t, roll + base);
}

/** Game: 0x0206E950. One RNG draw when maxDamage > minDamage. */
export function projectileDamage(w: World, p: Projectile): number {
  const span = p.type.maxDamage - p.type.minDamage;
  return p.type.minDamage + (span > 0 ? nextInt(w.rng, span) : 0);
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
  if (a.maxRange > 1 && cellDist2(u, t) > a.maxRange * a.maxRange) {
    gx = t.x;
    gy = t.y;
  } else {
    const dcx = cellX(u.x) - cellX(t.x);
    const dcy = cellY(u.y) - cellY(t.y);
    let ox = 0;
    let oy = 0;
    if (dcx === 0 && dcy === 0) ox = u.x < t.x ? -1 : 1;
    else if (Math.abs(dcx) >= Math.abs(dcy)) ox = Math.sign(dcx);
    else oy = Math.sign(dcy);
    gx = (((cellX(t.x) + ox) * CELL_W + CELL_W / 2) << FX_SHIFT) as Fx;
    gy = (((cellY(t.y) + oy) * CELL_H + CELL_H / 2) << FX_SHIFT) as Fx;
  }
  if (!w.grid) {
    u.tx = gx;
    u.ty = gy;
    u.path = [];
    return;
  }
  if (u.tx !== null && u.ty !== null && cellOf(u.tx, u.ty).join() === cellOf(gx, gy).join()) return;
  planUnitPath(w.grid, u, gx, gy);
}

function nearestEnemyInSight(w: World, u: Unit): Unit | undefined {
  const r2 = u.attack!.sight * u.attack!.sight;
  let best: Unit | undefined;
  let bestD = 0;
  for (const o of w.units) {
    if (o.owner === u.owner || o.hp === 0) continue;
    const d = cellDist2(u, o);
    // Ties go to the lower id because we scan in id order and need strictly closer.
    if (d <= r2 && (!best || d < bestD)) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/**
 * Per-tick combat for one unit, run before it moves: drop dead targets, pick
 * up an enemy in sight when idle, chase until in range, then attack whenever
 * the cooldown has run out (game: 0x02050A40, cooldown check against +0x19C).
 */
export function combatStep(w: World, u: Unit): void {
  if (!u.attack || u.hp === 0) return;
  let t = u.target === null ? undefined : findById(w.units, u.target);
  if (u.target !== null && (!t || t.hp === 0)) {
    // Target died or vanished: stop where we are.
    u.target = null;
    u.tx = u.ty = null;
    u.path = [];
    t = undefined;
  }
  if (!t && u.tx === null) {
    t = nearestEnemyInSight(w, u);
    if (t) u.target = t.id;
  }
  if (!t) return;
  if (!inRange(u, t)) {
    chase(w, u, t);
    return;
  }
  u.tx = u.ty = null;
  u.path = [];
  if (w.tick < u.lastAttack + u.attack.cooldown) return;
  u.lastAttack = w.tick;
  if (u.attack.projectile) {
    w.projectiles.push({ id: w.nextId++, owner: u.owner, x: u.x, y: u.y, target: t.id, type: u.attack.projectile });
  } else {
    meleeHit(w, u, t);
  }
}
