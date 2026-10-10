import { canPlace, isBuilding, isFinished, ROLE_BARRACKS, ROLE_BASE, ROLE_BUILDER, ROLE_FARM, ROLE_HERO, ROLE_LUMBER_MILL, ROLE_MINE, ROLE_SHIPYARD, ROLE_STABLES, ROLE_WALL, TRAINS } from '../economy';
import { ringSearch } from '../ring';
import { mayBuild } from '../structures';
import { MOVES_GROUND, isWalkableCode } from '../terrain';
import { fpH, fpW } from '../footprint';
import type { Unit } from '../state';
import { aiRand, type AiRequest } from './state';
import { avail, computeReserve, finishSites, mainCell, tryOther } from './buildings';
import {
  at, builders, cellOfXY, centre, cheb, clamp, cx, cy, finishedOfRole, freePop, freeSlots, H, isHarvesting, isIdleBuilder, kindsOfRole, manhattan,
  nearestTree, ofRole, pushRequest, queuedOfRole, typeOf, W, type Ctx,
} from './ctx';

/*
 * The CPU's economy: AIResources (builders, trees, buildings), AIProducer (training) and the
 * brain's army requests. Numbers and confidence: docs/re-notes/ai.md.
 */

/** Builder count the AI keeps between (AIResources +0x2C / +0x2D). confirmed */
export const MIN_BUILDERS = 3;
export const MAX_BUILDERS = 9;
const BUILDER_QUEUE = 10;
const ARMY_QUEUE = 4;
const ROLE_TOWER = 13;

const NONE: AiRequest = { kind: -1, prio: 0, cell: -1 };

// ---------------------------------------------------------------- AIResources

/** AIResources_update (0x020942C0), every 13 ticks (cycle positions 6 and 12). */
export function resourcesUpdate(c: Ctx): void {
  if (c.w.tick % 2 === 0) economy(c);
  else if (!assignBuild(c)) {
    tryOther(c);
    repair(c);
    finishSites(c);
  }
}

/** Economy (0x02094484), even ticks. */
function economy(c: Ctx): void {
  const bs = builders(c);
  regulateBuilders(c, bs.length);
  if (bs.length === 0) return;
  // Every 12th tick: the pool chores, and nothing else (not even the hero rebuy).
  if (c.w.tick % 12 === 0) return poolChores(c);
  if (!minesAndHarvest(c)) {
    if (ofRole(c, ROLE_BASE).length === 0) propose(c, ROLE_BASE, c.ai.home, 75);
    if (c.own.some((u) => isBuilding(u) && !isFinished(u))) towerPlanner(c);
  }
  farmPlanner(c);
  if (c.w.tick % 4 === 0) rebuyHero(c);
}

/** BuilderRegulator (0x02094E58): keep 3 to 9 builders, one request at priority 99 at a time. */
function regulateBuilders(c: Ctx, b: number): void {
  const q = queuedOfRole(c, c.ai.builderQ, ROLE_BUILDER);
  const t = b + q;
  const free = freeSlots(c, 1);
  if (free >= 2 && (q === 0 || b < MIN_BUILDERS) && c.me.bricks > 60 && t < MAX_BUILDERS - 1 && (MIN_BUILDERS - b > q || q < free)) {
    const kind = kindsOfRole(c, ROLE_BUILDER)[0];
    if (kind !== undefined) pushRequest(c.ai.builderQ, BUILDER_QUEUE, { kind, prio: 99, cell: c.ai.home }, true);
  }
  // The game can also retire builders when rich and at the unit cap; never seen in the emulator, not ported.
}

/** MinesAndHarvest (0x02094C18). True when it gave a harvest order. */
function minesAndHarvest(c: Ctx): boolean {
  const bricks = c.me.bricks;
  const bs = builders(c);
  const idle = bs.filter(isIdleBuilder);
  if (!(c.ai.stats.income < 4 || bricks < 1000 || (idle.length > 2 && bricks < 2575))) return false;
  const res = c.ai.res;
  if (c.ai.res.plan.kind < 0 || c.ai.res.plan.prio < 75) {
    if (res.mines > 0 && (bricks > 1920 || c.ai.stats.military > 10)) {
      res.mines = Math.min(res.mines, c.w.mineSites.length);
      if (ofRole(c, ROLE_MINE).length < res.mines) {
        const site = mineSite(c, c.ai.home, 10);
        if (site >= 0) propose(c, ROLE_MINE, site, bricks > 1920 && manhattan(c, site, c.ai.home) <= 15 ? 99 : 76);
        else res.mines = 0;
      }
    }
  }
  const harvesting = bs.filter(isHarvesting).length;
  if (harvesting === 0 || (harvesting < bs.length && bs.length > 1 && idle.length > 0)) {
    const u = nearest(c, idle, c.ai.home);
    if (u) return harvest(c, u);
  }
  return false;
}

/** HarvestDecide (0x020965CC): a tree near the builder, else one near a forest mark. confirmed (code and emulator) */
function harvest(c: Ctx, u: Unit): boolean {
  const res = c.ai.res;
  const here = at(c, u);
  let tree = nearestTree(c, here, 4);
  if (tree < 0) {
    const start = res.harvests % 2 === 0 ? c.ai.home : here;
    let best = -1;
    let bestD = 999;
    for (const m of c.ai.marks) {
      if (res.claimed.includes(m)) continue;
      const d = manhattan(c, m, start);
      if (d < bestD) (best = m), (bestD = d);
    }
    const m = best >= 0 ? best : here;
    let x = cx(c, m), y = cy(c, m);
    // The search point steps 3 cells off the mark, turning with the harvest count: up, down, left, right.
    // (emulator: the first search went from (58,49), 3 above the mark at (58,52))
    switch (res.harvests % 4) {
      case 0: if (y > 4) y -= 3; break;
      case 1: y += 3; break;
      case 2: if (x > 4) x -= 3; break;
      default: x += 3;
    }
    // Clamped like the game: 0 becomes 1, and the far edges by its own (slightly uneven) tests.
    if (x === 0) x = 1;
    if (y === 0) y = 1;
    if (x >= W(c)) x = W(c) - 1;
    if (y > H(c)) y = H(c) - 1;
    tree = nearestTree(c, cellOfXY(c, x, y), 7);
    if (tree < 0) {
      // A mark with no trees left is given up; with no mark at all it wants one more mine instead.
      if (best >= 0) res.claimed.push(best);
      else res.mines = Math.min(res.mines + 1, c.w.mineSites.length);
      return false;
    }
    lumberMill(c, tree);
  }
  res.harvests++;
  c.out.push({ kind: 'harvest', unitIds: [u.id], cx: cx(c, tree), cy: cy(c, tree) });
  return true;
}

/**
 * The lumber mill part of HarvestDecide, for a tree found near a forest mark: with 1500 bricks or less only
 * when the tree is 16 or more cells (Manhattan) from home; then, with more than 355 available and no builder
 * already on a mill, it finds a spot for one within 16 of the tree (the CPU's placement search) and proposes
 * it at priority 81 if no own mill stands closer than 11 to that spot. So it can have more than one mill, each by
 * its own forest. confirmed (code; emulator: proposals at (57,47) and (42,61) on The Pond)
 */
function lumberMill(c: Ctx, tree: number): void {
  if (c.me.bricks <= 1500 && manhattan(c, tree, c.ai.home) < 16) return;
  if (avail(c) <= 355 || c.own.some((b) => b.role === ROLE_LUMBER_MILL && !isFinished(b))) return;
  const kind = kindsOfRole(c, ROLE_LUMBER_MILL)[0];
  if (kind === undefined) return;
  const spot = placementSearch(c, kind, tree, 16, 0);
  if (spot < 0 || c.own.some((b) => b.role === ROLE_LUMBER_MILL && manhattan(c, centre(c, b), spot) < 11)) return;
  propose(c, ROLE_LUMBER_MILL, spot, 81);
}

/** Nearest free Mine site to `from` within r cells (0x02092B6C). */
function mineSite(c: Ctx, from: number, r: number): number {
  const t = typeOf(c, kindsOfRole(c, ROLE_MINE)[0] ?? -1);
  let best = -1;
  for (const s of c.w.mineSites) {
    if (cheb(c, s, from) > r || (t && !canPlace(c.w, t, cx(c, s), cy(c, s)))) continue;
    if (best < 0 || manhattan(c, s, from) < manhattan(c, best, from)) best = s;
  }
  return best;
}

/** FarmPlanner (0x02094BBC): a farm when the population is about to run out. */
function farmPlanner(c: Ctx): void {
  const want = Math.min(2, (c.me.bricks > 2575 ? 2 : 1) - freePop(c));
  const building = c.own.filter((b) => b.role === ROLE_FARM && !isFinished(b)).length;
  const main = ofRole(c, ROLE_BASE)[0];
  if (want > building) propose(c, ROLE_FARM, main ? centre(c, main) : c.ai.home, 80);
}

/**
 * Base tower planner (0x02094B44), while some builder is constructing: a tower at the main building
 * when no tower is within 12 (Manhattan) of the base and more than 4 buildings are. likely (never
 * fired in the emulator: the marker towers come first)
 */
function towerPlanner(c: Ctx): void {
  const near = (u: Unit) => isBuilding(u) && manhattan(c, at(c, u), c.ai.home) <= 12;
  if (c.own.some((u) => u.role === ROLE_TOWER && !isFinished(u))) return;
  if (c.own.some((u) => u.role >= ROLE_TOWER && u.role <= 15 && near(u))) return;
  if (c.own.filter(near).length > 4) propose(c, ROLE_TOWER, mainCell(c), 50);
}

/**
 * PoolChores (0x02097054): towers at priority 76 where builders without a squad stand, and walking
 * them home. The pool was empty at all 175 calls in the emulator, and our builders have no
 * squad-less state, so this does nothing here.
 */
function poolChores(_c: Ctx): void {}

/** RebuyHero (0x02094A7C): a dead hero is bought back first, at priority 100. */
function rebuyHero(c: Ctx): void {
  if (ofRole(c, ROLE_HERO).length || queuedOfRole(c, c.ai.builderQ, ROLE_HERO)) return;
  const kind = kindsOfRole(c, ROLE_HERO)[0];
  if (kind === undefined) return;
  c.ai.builderQ.length = 0;
  c.ai.builderQ.push({ kind, prio: 100, cell: c.ai.home });
}

/** CanAfford (0x0209639C): available bricks cover the price, and a building needs a builder. */
const canAfford = (c: Ctx, cost: number, role: number): boolean => avail(c) >= cost && (role < ROLE_BASE || builders(c).length > 0);

/**
 * Propose a building (0x02097354, plan set by 0x020951F0): it replaces the plan only if the plan is empty
 * or of strictly lower priority, and says whether it did. A plan of the same role already counts as yes.
 * Setting a plan records its role and works out the reserve again. confirmed (code)
 */
export function propose(c: Ctx, role: number, cell: number, prio: number): boolean {
  const res = c.ai.res;
  const kind = kindsOfRole(c, role)[0];
  if (kind === undefined) return false;
  if (res.plan.kind >= 0 && typeOf(c, res.plan.kind)?.role === role) return true;
  const t = typeOf(c, kind)!;
  if (!canAfford(c, t.cost, role) || !mayBuild(c.w, c.ai.player, t)) {
    if (res.plan.kind < 0) res.role = 20;
    return false;
  }
  if (res.plan.kind >= 0 && prio <= res.plan.prio) return false;
  res.plan = { kind, prio, cell };
  res.wait = 0;
  res.role = role;
  computeReserve(c);
  return true;
}

/** AssignBuild (0x02094324), odd ticks: give the plan to the nearest idle builder (or a harvester). */
function assignBuild(c: Ctx): boolean {
  const res = c.ai.res;
  const plan = res.plan;
  if (plan.kind < 0) return false;
  const t = typeOf(c, plan.kind);
  if (!t) return (res.plan = NONE), false;
  const role = t.role;
  // Unaffordable plans lose a priority point a pass, down to 10; a plan whose role a builder is
  // already putting up waits.
  if (!canAfford(c, t.cost, role)) {
    if (plan.prio >= 11) plan.prio--;
    return false;
  }
  if (c.own.some((b) => b.role === role && !isFinished(b))) return false;
  res.wait++;
  const bs = builders(c);
  let u = nearest(c, bs.filter(isIdleBuilder), plan.cell);
  if (!u) {
    // Taking a harvester: never with fewer than 2 harvesting (so the first barracks waits for the
    // second builder), always with 8; otherwise once the plan has waited 56 passes, or with more than
    // 1500 available bricks, or for a plan of priority 76 or more, or with 3 harvesting and more than 750.
    // confirmed (code; emulator: the first barracks went to the second builder as it came out, tick 175)
    const harv = bs.filter(isHarvesting);
    const n = harv.length;
    const av = avail(c);
    const take = n >= MAX_BUILDERS - 1 || (n >= 2 && (res.wait >= 56 || av > 1500 || plan.prio >= 76 || (n >= 3 && av > 750)));
    if (take) u = nearest(c, harv, plan.cell);
  }
  if (!u) return false;
  const cell = plan.cell;
  res.plan = NONE;
  return issueBuild(c, u, t.kind, role, cell);
}

/** IssueBuild (0x02096988): find a spot around the anchor at `cell` and send the builder. */
export function issueBuild(c: Ctx, u: Unit, kind: number, role: number, cell: number): boolean {
  const res = c.ai.res;
  const t = typeOf(c, kind)!;
  let spot = -1;
  if (role === ROLE_MINE) spot = mineSite(c, cell, 10);
  else {
    const anchor = placementAnchor(c, role, cell >= 0 ? cell : at(c, u), t.size);
    let spacing = 0;
    if (role === ROLE_BARRACKS || role === ROLE_STABLES || role === ROLE_FARM) {
      const r = aiRand(c.ai, 10);
      spacing = r > 8 ? (role === ROLE_FARM ? 1 : 2) : r > 2 ? 1 : 0;
    }
    let radius = res.claimed.length < 2 && res.fails > 10 ? 28 : 16;
    if (role === ROLE_FARM) radius += 8;
    spot = placementSearch(c, t.kind, anchor, radius, spacing);
  }
  if (spot < 0) {
    res.fails++;
    return false;
  }
  res.wait = 0;
  c.out.push({ kind: 'build', unitIds: [u.id], type: kind, cx: cx(c, spot), cy: cy(c, spot) });
  return true;
}

/**
 * PlacementAnchor (0x02096C2C): farms go to the side away from the enemy, barracks, special
 * factories and towers toward it, everything else at the requested cell.
 */
function placementAnchor(c: Ctx, role: number, cell: number, size: number): number {
  const home = c.ai.home;
  const dx = cx(c, c.ai.enemyHome) - cx(c, home), dy = cy(c, c.ai.enemyHome) - cy(c, home);
  const s = manhattan(c, cell, home) <= 15 ? 2 : 1;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const fx = ax > 2 * ay ? 3 : 2, fy = ay > 2 * ax ? 3 : 2;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let x = cx(c, cell), y = cy(c, cell);
  if (role === ROLE_FARM) {
    x -= clamp(s * fx * sx, -6, 6);
    y -= clamp(s * fy * sy, -6, 6);
  } else if (role === ROLE_BARRACKS) {
    x += s * fx * sx + sx;
    y += s * fy * sy + sy;
  } else if (role === ROLE_STABLES || role === ROLE_SHIPYARD) {
    if (manhattan(c, cell, home) <= 15) {
      x += Math.max(s, 2) * fx * sx + 5 * sx;
      y += Math.max(s, 2) * fy * sy + 5 * sy;
    }
  } else if (role >= ROLE_TOWER && role <= 15) {
    x += Math.min(s, 2) * fx * sx;
    y += Math.min(s, 2) * fy * sy;
  }
  x = clamp(x, 2, W(c) - fpW(size));
  y = clamp(y, 2, H(c) - fpH(size));
  return cellOfXY(c, x, y);
}

/**
 * PlacementSearch (0x0207F194 with the test 0x020016AC): the game's ring search (sim/src/ring.ts) out from the
 * anchor, `radius` rings, for a top-left cell where the building fits. For the CPU every building but a Mine,
 * Shipyard, bridge, gate or wall also needs a margin of `spacing + 1` cells all round that stays inside the
 * map, is ground the building itself could stand on (so no trees) and holds no building (walls and mines don't
 * count; units do no harm). Footprint cells must be free. confirmed (code)
 */
export function placementSearch(c: Ctx, kind: number, anchor: number, radius: number, spacing: number): number {
  const t = typeOf(c, kind)!;
  const g = c.w.grid!;
  const fw = fpW(t.size), fh = fpH(t.size);
  const moves = t.moves ?? MOVES_GROUND;
  const margin = (t.role >= ROLE_BASE && t.role <= 15 && t.role !== ROLE_MINE) ? spacing + 1 : 0;
  const fits = (x: number, y: number) => {
    if (!canPlace(c.w, t, x, y)) return false;
    if (margin === 0) return true;
    if (x - margin < 0 || y - margin < 0 || x + fw - 1 + margin >= g.width || y + fh - 1 + margin >= g.height) return false;
    for (let yy = y - margin; yy < y + fh + margin; yy++) {
      for (let xx = x - margin; xx < x + fw + margin; xx++) {
        if (xx >= x && xx < x + fw && yy >= y && yy < y + fh) continue;
        const cell = yy * g.width + xx;
        if (!isWalkableCode(g.cells[cell]!, moves)) return false;
        const o = c.w.occ![cell];
        if (o !== 0 && c.w.units.some((u) => u.id === o && isBuilding(u) && u.role !== ROLE_MINE && u.role !== ROLE_WALL)) return false;
      }
    }
    return true;
  };
  return ringSearch(c.w, cx(c, anchor), cy(c, anchor), radius, fits);
}

/**
 * Repair (0x02094504 and JobRepair): with more than 3 builders, one (two when rich) repairs the least
 * damaged finished building within 15 cells of home.
 */
function repair(c: Ctx): void {
  const bs = builders(c);
  if (bs.length <= 3) return;
  const want = bs.length > 5 && c.me.bricks > 1500 ? 2 : 1;
  const busy = bs.filter((u) => u.job?.kind === 'repair').length;
  if (busy >= want) return;
  let target: Unit | undefined;
  for (const b of c.own) {
    if (!isBuilding(b) || !isFinished(b) || b.hp >= b.maxHp || cheb(c, at(c, b), c.ai.home) > 15) continue;
    if (!target || b.maxHp - b.hp < target.maxHp - target.hp) target = b;
  }
  if (!target) return;
  let u = nearest(c, bs.filter(isIdleBuilder), at(c, target));
  if (!u && c.me.bricks > 355) u = nearest(c, bs.filter(isHarvesting), at(c, target));
  if (u) c.out.push({ kind: 'repair', unitIds: [u.id], target: target.id });
}

function nearest(c: Ctx, us: readonly Unit[], cell: number): Unit | undefined {
  let best: Unit | undefined;
  for (const u of us) if (!best || manhattan(c, at(c, u), cell) < manhattan(c, at(c, best), cell)) best = u;
  return best;
}

// ---------------------------------------------------------------- AIProducer

/** Building role that trains a unit role (AIProducer_factoryRoleFor 0x0208C4E0). */
function factoryRole(role: number, water: boolean): number {
  if (role <= ROLE_BUILDER) return ROLE_BASE;
  if (role <= 4) return ROLE_BARRACKS;
  return water ? ROLE_SHIPYARD : ROLE_STABLES;
}

/** Nearest finished factory with nothing in training (0x0208C570): the AI never queues more than one. */
function idleFactory(c: Ctx, kind: number, cell: number): Unit | undefined {
  const t = typeOf(c, kind);
  if (!t) return undefined;
  const role = factoryRole(t.role, ((t.moves ?? 0) & 0b1000) !== 0 && t.layer !== 1);
  if (!(TRAINS[role] ?? []).includes(t.role)) return undefined;
  const fs = c.own.filter((b) => b.role === role && isFinished(b) && b.queue.length === 0);
  return cell >= 0 ? nearest(c, fs, cell) : fs[0];
}

/** Last affordable item, or the one at `prefer` if it still is (BuildQueue_pick 0x0208CC4C). */
function pick(c: Ctx, q: readonly AiRequest[], prefer: number, specialsOnly: boolean): number {
  let found = -1;
  for (let i = 0; i < q.length; i++) {
    const t = typeOf(c, q[i]!.kind);
    if (!t || t.cost > c.me.bricks) continue;
    if (specialsOnly && t.role !== 5 && t.role !== 6) continue;
    found = i;
    if (i === prefer) break;
  }
  return found;
}

/** AIProducer_update (0x0208C1E4): spend bricks on queued requests, builders first. */
export function producerUpdate(c: Ctx): void {
  const bq = c.ai.builderQ, aq = c.ai.armyQ;
  const prefer = aiRand(c.ai, aq.length);
  const freeU = freeSlots(c, 1), freeS = freeSlots(c, 2);
  if (freeU < 1 && freeS < 1 && !bq.length) return;
  const bi = bq.length && (freeU > 0 || typeOf(c, bq[0]!.kind)?.role === ROLE_HERO) ? pick(c, bq, 0, false) : -1;
  let ai = -1;
  if (aq.length && (freeU > 0 || freeS > 0)) {
    if (c.me.bricks < 60) return;
    ai = pick(c, aq, prefer, freeU <= 1 && freeS > 0);
  }
  const b = bi >= 0 ? bq[bi]! : null;
  const a = ai >= 0 ? aq[ai]! : null;
  const aCost = a ? typeOf(c, a.kind)!.cost : 0;
  const bCost = b ? typeOf(c, b.kind)!.cost : 0;
  const armyFirst = !!(a && b && b.prio < a.prio && aCost <= c.me.bricks);
  const both = !!(a && b && aCost + bCost < c.me.bricks);
  let spent = 0;
  if (b && (both || !armyFirst) && (freePop(c) > 0 || typeOf(c, b.kind)!.role === ROLE_HERO) && bCost <= c.me.bricks) {
    const f = idleFactory(c, b.kind, b.cell);
    if (f) {
      c.out.push({ kind: 'train', building: f.id, type: b.kind });
      bq.splice(bi, 1);
      spent = bCost;
    }
  }
  if (a && ((aq.length > 0 && bq.length === 0) || armyFirst || c.me.bricks > aCost + 750)) {
    const role = typeOf(c, a.kind)!.role;
    if ((freePop(c) > 0 || role === 5 || role === 6) && aCost + spent <= c.me.bricks) {
      const f = idleFactory(c, a.kind, a.cell);
      if (f) {
        c.out.push({ kind: 'train', building: f.id, type: a.kind });
        aq.splice(aq.indexOf(a), 1);
      }
    }
  }
}

// ---------------------------------------------------------------- AIBrain economy

/** AIBrain_economy (0x0208B1D0), every 26 ticks: ask for an army unit, or leave the bricks to builders. */
export function brainEconomy(c: Ctx): void {
  const br = c.ai.brain;
  const pct = c.ai.stats.builderShare;
  const target = c.ai.builderPct;
  const freeU = freeSlots(c, 1), freeS = freeSlots(c, 2);
  const bricks = c.me.bricks;
  const want =
    pct > target ||
    (bricks > 1500 && (freeU > 2 || freeS >= 1)) ||
    (bricks > 355 && c.ai.armyQ.length === 0 && (freeS !== 0 || freeU >= 2 || builders(c).length === MAX_BUILDERS));
  if (want) {
    if (pct - target > 10 && br.bonus < 20) br.bonus++;
    requestArmyUnit(c, freeU, freeS);
  } else if (br.bonus > 15) br.bonus--;
}

/** AIBrain_requestArmyUnit (0x0208BAA8). Transport wishes (island maps) are not ported. */
function requestArmyUnit(c: Ctx, freeU: number, freeS: number): void {
  const q = c.ai.armyQ;
  if (q.length >= ARMY_QUEUE || c.me.bricks < 75) return;
  const kind = pickArmyUnit(c, freeU, freeS);
  if (kind < 0) return;
  const t = typeOf(c, kind)!;
  const melee = t.attack && !t.attack.projectile && t.attack.damage > 10 ? 15 : 0;
  const prio = Math.min(100, 40 + c.ai.brain.bonus + melee);
  // The target cell is a random active squad job's goal: it picks the factory nearest the front.
  const jobs = c.ai.squads.filter((s) => s.job >= 0);
  let cell = -1;
  if (jobs.length) {
    const s = jobs[jobs.length > 1 ? aiRand(c.ai, jobs.length) : 0]!;
    cell = c.ai.targets.find((x) => x.id === s.target)?.cell ?? -1;
  }
  pushRequest(q, ARMY_QUEUE, { kind, prio, cell }, t.role === 4 || t.role === 5 || t.role === 6);
}

/**
 * AIBrain_pickArmyUnit (0x0208BF70): melee by default, ranged once melee leads by more than 4,
 * mounted once there are more than 3 ranged (and over 200 bricks), half the time a random special
 * when rich with a special factory. confirmed (44 logged decisions)
 */
function pickArmyUnit(c: Ctx, freeU: number, freeS: number): number {
  const bricks = c.me.bricks;
  let special = false;
  const factory = finishedOfRole(c, ROLE_STABLES).length + finishedOfRole(c, ROLE_SHIPYARD).length > 0;
  if (bricks > 750 && freeS !== 0 && freeU < 10 && factory && aiRand(c.ai, 10) > 4) special = true;
  let role: number;
  if (!special && freeU !== 0) {
    const melee = ofRole(c, 2).length + queuedOfRole(c, c.ai.armyQ, 2);
    const ranged = ofRole(c, 3).length + queuedOfRole(c, c.ai.armyQ, 3);
    if (bricks > 200 && ranged > 3) role = 4;
    else if (melee !== 0 && melee > ranged + 4) role = 3;
    else role = 2;
  } else role = 6;
  // Specials that swim (ships) only on maps with water routes: the naval filter is not ported, so drop them.
  const list = kindsOfRole(c, role).filter((k) => {
    const t = typeOf(c, k)!;
    return !(((t.moves ?? 0) & 0b1000) !== 0 && t.layer === 0 && ((t.moves ?? 0) & 0b0001) === 0);
  });
  if (!list.length) return -1;
  return list[list.length > 1 ? aiRand(c.ai, list.length) : 0]!;
}
