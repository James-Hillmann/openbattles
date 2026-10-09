import { isBuilding, isFinished, ROLE_BARRACKS, ROLE_BASE, ROLE_LUMBER_MILL, ROLE_MINE, ROLE_SHIPYARD, ROLE_STABLES } from '../economy';
import { isTower, MAX_BUILDINGS, MAX_TOWERS, ROLE_TOWER, ROLE_TOWER2, ROLE_TOWER3 } from '../structures';
import type { Unit } from '../state';
import { aiRand } from './state';
import { at, builders, cellOfXY, cx, cy, enemies, isHarvesting, isIdleBuilder, kindsOfRole, manhattan, typeOf, W, type Ctx } from './ctx';
import { issueBuild, propose } from './economy';

/*
 * What the CPU builds besides builders' basics (farms, mines, the lumber mill): towers, more
 * barracks, special factories, and tower upgrades. AIResources' "try other" pass (0x0209524C), the
 * tower proposers and the "own entity created" handler (0x0208A85C). docs/re-notes/ai.md "Buildings".
 */

const ROLE_FACTORY = ROLE_STABLES;

/** Own live entities of a role, unfinished buildings included (AITeamStats_countRole 0x02092560). */
const cnt = (c: Ctx, role: number) => c.own.filter((u) => u.role === role).length;
/** Own buildings of a role within Manhattan r of a cell, r = 0 for anywhere; role 20 for every building (0x02092998). */
function near(c: Ctx, role: number, cell: number, r: number): number {
  let n = 0;
  for (const u of c.own) {
    if (!isBuilding(u) || (role !== 20 && u.role !== role)) continue;
    if (r === 0 || manhattan(c, at(c, u), cell) <= r) n++;
  }
  return n;
}
/** A builder is putting up a building of this role (squad task Construct, 0x0209DDC4). */
const building = (c: Ctx, role: number) => c.own.some((u) => u.role === role && isBuilding(u) && !isFinished(u));
const planned = (c: Ctx) => (c.ai.res.plan.kind >= 0 ? (typeOf(c, c.ai.res.plan.kind)?.role ?? -1) : -1);

/** The cell of the main building (AIResources +0x50): the base's record cell, else the start. */
export function mainCell(c: Ctx): number {
  const b = c.own.find((u) => u.role === ROLE_BASE);
  return b ? at(c, b) : c.ai.home;
}

/**
 * Bricks held back for a planned building (AITeamStats_computeReserve 0x02093F7C): 420 while a
 * special factory is planned, 420 before tick 7000 with more than 4 soldiers and no lumber mill, 600
 * for a late mine. likely (code; the emulator showed 0 and 420)
 */
export function reserve(c: Ctx): number {
  let r = 0;
  const role = planned(c);
  if (role === ROLE_MINE && c.w.tick > 16000 && cnt(c, ROLE_MINE) < 1 && c.ai.res.mines > 0) r += 600;
  if (role === ROLE_FACTORY) r += 420;
  if (c.w.tick < 7000 && c.ai.stats.military > 4 && near(c, ROLE_LUMBER_MILL, 0, 0) < 1) r += 420;
  return r;
}
/** "Available" bricks: the bank, or 0 when the reserve is larger. */
const avail = (c: Ctx) => (reserve(c) > c.me.bricks ? 0 : c.me.bricks);

/**
 * TowerSpotOK (0x02093664): a tower may go here when an own building stands within 6 and the
 * strength (+0x70) of everything within 6, any side, plus rand(60) is under 225. confirmed (rolls)
 */
function towerSpotOk(c: Ctx, cell: number): boolean {
  const x = cx(c, cell), y = cy(c, cell);
  let v = 0;
  for (const u of c.w.units) {
    if (u.hp <= 0) continue;
    const a = at(c, u);
    if (Math.abs(cx(c, a) - x) <= 6 && Math.abs(cy(c, a) - y) <= 6) v += u.priority;
  }
  const n = near(c, 20, cell, 6);
  const r = aiRand(c.ai, 60);
  return n !== 0 && v + r < 225;
}

/** TryOther (0x0209524C), odd AI ticks when no plan went to a builder: one of four chores at random. */
export function tryOther(c: Ctx): void {
  // The game also returns when the plan waits for want of an idle builder squad (+0x20).
  if (c.ai.res.plan.kind >= 0 && !builders(c).some(isIdleBuilder)) return;
  switch (aiRand(c.ai, 4) + 1) {
    case 1: return towersBranch(c);
    case 2: return wallsBranch(c);
    case 3: return productionBranch(c);
    default: return upgradeTimer(c);
  }
}

/** Case 1: maybe upgrade a tower, else propose one at a map tower marker. */
function towersBranch(c: Ctx): void {
  const res = c.ai.res;
  if (c.own.filter((u) => isTower(u.role)).length >= MAX_TOWERS) return wallsBranch(c);
  const t1 = cnt(c, ROLE_TOWER);
  if (t1 > 4 && res.upInterval > 20) {
    if (cnt(c, ROLE_TOWER2) < 2 && cnt(c, ROLE_TOWER3) < 1) {
      res.upInterval = 20;
      if (t1 > 3 && c.me.bricks > 355 && upgradeTower(c)) return;
    }
  } else res.upInterval = 60;
  if (building(c, ROLE_TOWER)) return;
  if (t1 >= 2 && c.me.bricks <= reserve(c) + 750) return;
  towerProposer(c);
}

/**
 * Case 2: walls. The game plans wall rings here once it has 8 soldiers, 2 towers and is past tick
 * 7000, but it never built one in 13,700 ticks of emulator play (no JobContractBuild). Not ported.
 */
function wallsBranch(_c: Ctx): void {}

/** Case 3: barracks, shipyard, special factory, when there's no barracks or bricks to spare. */
function productionBranch(c: Ctx): void {
  const others = c.own.filter((u) => isBuilding(u) && ((u.role >= ROLE_BASE && u.role <= ROLE_FACTORY) || u.role === ROLE_SHIPYARD || u.role === 18)).length;
  if (others >= MAX_BUILDINGS) return;
  const nb = cnt(c, ROLE_BARRACKS);
  const tb = c.me.bricks;
  if (!(nb === 0 || (c.ai.stats.military >= 6 && tb > 355) || tb > 1500)) return;
  // ProductionBuildings (0x0209550C). The shipyard proposer needs the island test (0x02093A50), which
  // we haven't traced; it found no islands on The Pond and never proposed. Not ported.
  if (!barracksProposer(c)) specialFactoryProposer(c);
}

/** Case 4: count passes; past the interval, upgrade a tower. */
function upgradeTimer(c: Ctx): void {
  const res = c.ai.res;
  if (res.upCount > res.upInterval && c.me.bricks > 355) {
    res.upCount = 0;
    if (upgradeTower(c)) return;
  }
  res.upCount++;
}

/** TowerProposer (0x02095E30): priority 50 at the nearest unclaimed tower marker (MARK type 3) to the base. */
function towerProposer(c: Ctx): void {
  const ai = c.ai;
  const thr = aiRand(ai, 100) < 4 ? 60 : 355;
  const t1 = cnt(c, ROLE_TOWER);
  if (t1 !== 0 && ai.stats.military < 4) return;
  if (ai.res.plan.kind >= 0) return;
  if (c.me.bricks <= reserve(c) + thr) return;
  // Same map region as the base (guess: we take every marker).
  let m = -1, best = 999;
  for (const k of ai.towerMarks) {
    if (ai.res.towersClaimed.includes(k)) continue;
    const d = manhattan(c, k, ai.home);
    if (d < best) (m = k), (best = d);
  }
  if (building(c, ROLE_TOWER) || near(c, ROLE_BARRACKS, 0, 0) < 1 || m < 0) return;
  const n = near(c, ROLE_TOWER, m, 8);
  if (n === 0 || (n < 3 && towerSpotOk(c, m))) propose(c, ROLE_TOWER, m, 50);
  else ai.res.towersClaimed.push(m);
}

/** BarracksProposer (0x02095568): the first at 99, a second when rich, a third forward toward the enemy. */
function barracksProposer(c: Ctx): boolean {
  if (planned(c) === ROLE_BARRACKS) return false;
  const main = mainCell(c);
  const nb = cnt(c, ROLE_BARRACKS);
  const av = avail(c);
  if (nb < 2) {
    if (nb === 0 && av > 355) return propose(c, ROLE_BARRACKS, main, 99);
    if (av > reserve(c) + 1500) return propose(c, ROLE_BARRACKS, main, nb === 0 ? 99 : 50);
    return false;
  }
  if (av > 2575 && nb < 3 && cnt(c, ROLE_FACTORY) + cnt(c, ROLE_SHIPYARD) > 0) {
    // (main + enemy) / 3 per axis: the sum over 3, not a third of the way. confirmed: (20,22) on The Pond.
    const e = c.ai.enemyHome;
    const fwd = cellOfXY(c, Math.min(W(c) - 1, Math.floor((cx(c, main) + cx(c, e)) / 3)), Math.floor((cy(c, main) + cy(c, e)) / 3));
    return propose(c, ROLE_BARRACKS, fwd, 50);
  }
  return false;
}

/** SpecialFactoryProposer (0x020959E0): up to two, the second when rich. */
function specialFactoryProposer(c: Ctx): boolean {
  if (planned(c) === ROLE_FACTORY) return false;
  const nf = cnt(c, ROLE_FACTORY);
  if (nf >= 2) return false;
  const av = avail(c);
  if (!(nf === 0 ? av > 355 || c.ai.stats.military > 8 : av > 2575)) return false;
  if (building(c, ROLE_FACTORY)) return false;
  return propose(c, ROLE_FACTORY, mainCell(c), 50);
}

/**
 * UpgradeTower (0x02095FC4): research the next level on the tower nearest the base that is at least
 * 100 ticks old (Tower I while there are fewer Tower IIs, else a Tower II). confirmed
 */
function upgradeTower(c: Ctx): boolean {
  const t1 = near(c, ROLE_TOWER, 0, 0), t2 = near(c, ROLE_TOWER2, 0, 0), t3 = near(c, ROLE_TOWER3, 0, 0);
  if (t1 + t2 + t3 < 2 || (t1 === 0 && t2 === 0)) return false;
  let role: number, maxAge: number;
  if (t1 > 1 && t2 < t1 - 1 && (t2 < 3 || t2 < t3 + 2)) {
    if (avail(c) <= 355) return false;
    maxAge = aiRand(c.ai, 10) > 7 ? 0 : 50000;
    role = ROLE_TOWER;
  } else if (t2 > 1) {
    if (avail(c) <= 950) return false;
    maxAge = aiRand(c.ai, 10) > 7 ? 0 : 100000;
    role = ROLE_TOWER2;
  } else return false;
  // PickEntity (0x02092860): walks the list from the end, strict <, so ties go to the later entity.
  const list = c.own.filter((u) => u.role === role);
  let best: Unit | undefined, bestD = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const u = list[i]!;
    const age = c.w.tick - u.born;
    if (age < 100 || (maxAge > 0 && age > maxAge)) continue;
    const d = manhattan(c, at(c, u), c.ai.home);
    if (!best || d < bestD) (best = u), (bestD = d);
  }
  if (!best) return false;
  c.out.push({ kind: 'upgrade', building: best.id });
  return true;
}

/**
 * The "own entity created" handler (0x0208A85C). It fires when the foundation goes down, which for
 * us is when the first builder gets to the site and work starts (likely, from the event's timing).
 * A new tower speeds up the upgrade timer; a new lumber mill, mine, barracks or factory gets a tower
 * next to it straight away (TowerNextTo 0x020961A0), outside the plan. The game delivers each
 * event twice (two rolls, at most one tower). confirmed
 */
export function onCreated(c: Ctx): void {
  const ai = c.ai;
  ai.fired = ai.fired.filter((id) => c.own.some((u) => u.id === id && !isFinished(u)));
  for (const u of c.own) {
    if (u.id <= ai.seen || !isBuilding(u) || u.progress === 0 || isFinished(u) || ai.fired.includes(u.id)) continue;
    ai.fired.push(u.id);
    if (isTower(u.role)) ai.res.upInterval = 1;
    else if (u.role === ROLE_LUMBER_MILL || u.role === ROLE_MINE || u.role === ROLE_BARRACKS || u.role === ROLE_FACTORY) {
      for (let i = 0; i < 2; i++) if (towerNextTo(c, at(c, u))) break;
    }
  }
}

function towerNextTo(c: Ctx, here: number): boolean {
  if (c.me.bricks < reserve(c) + 340) return false;
  // With enemies within 15 the game moves the builder's squad instead (0x0209C37C, not traced).
  if (enemies(c).some((e) => manhattan(c, at(c, e), here) <= 15)) return false;
  const kind = kindsOfRole(c, ROLE_TOWER)[0];
  const t = kind === undefined ? undefined : typeOf(c, kind);
  if (!t || !(t.cost < c.me.bricks + 420) || !towerSpotOk(c, here)) return false;
  // The game hands the tower to the builder that placed the site; ours is inside it by now, so the
  // nearest idle builder, else the nearest harvester, takes it. guess
  const bs = builders(c);
  const free = bs.filter(isIdleBuilder);
  const pool = free.length ? free : bs.filter(isHarvesting);
  let b: Unit | undefined;
  for (const u of pool) if (!b || manhattan(c, at(c, u), here) < manhattan(c, at(c, b), here)) b = u;
  return !!b && issueBuild(c, b, t.kind, ROLE_TOWER, here);
}

/**
 * Our addition: an idle builder goes back to an own building site nobody is working on. The game's
 * tower-next-to order takes a builder off the site it just placed, and in the emulator those sites
 * still got finished; how is not traced. guess
 */
export function finishSites(c: Ctx): void {
  const idle = builders(c).filter(isIdleBuilder);
  if (!idle.length) return;
  for (const s of c.own) {
    if (!isBuilding(s) || isFinished(s)) continue;
    if (c.own.some((u) => u.job && 'site' in u.job && u.job.site === s.id)) continue;
    let best = idle[0]!;
    for (const u of idle) if (manhattan(c, at(c, u), at(c, s)) < manhattan(c, at(c, best), at(c, s))) best = u;
    c.out.push({ kind: 'construct', unitIds: [best.id], site: s.id });
    return;
  }
}
