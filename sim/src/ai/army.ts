import { isBuilding, ROLE_BARRACKS, ROLE_BASE, ROLE_BUILDER, ROLE_FARM, ROLE_HERO, ROLE_LUMBER_MILL, ROLE_STABLES, ROLE_TRANSPORT } from '../economy';
import { canTarget, spellTarget } from '../spells';
import { isWalkable } from '../terrain';
import { findById } from '../combat';
import type { Unit } from '../state';
import { aiRand, type AiSquad, type AiTarget } from './state';
import { at, cellOfXY, cheb, clamp, cx, cy, enemies, H, issueMove, manhattan, strengthNear, W, type Ctx } from './ctx';

/*
 * The CPU's army: ArmySquadManager (0x020986F4), squads, the attack / defend / scout jobs and the
 * brain's attack planning (0x0208B440). Numbers and confidence: docs/re-notes/ai.md.
 */

export const JOB_SCOUT = 0;
export const JOB_ATTACK = 5;
export const JOB_DEFEND = 6;
export const CAT_ATTACK = 0;
export const CAT_HOME = 1;

/** The brain launches an attack once this many brain updates (~60 s) have passed since the last (brain +0x1C). */
export const ATTACK_INTERVAL = 300;
/** Attack-planning calls between scouts (brain +0x24). */
export const SCOUT_INTERVAL = 900;
/** Squads gather this many steps at most before they go anyway (squad +0x50), and give up after twice that. */
const GATHER_STEPS = 75;
/** Regroup radius in cells (squad +0x92). */
const GROUP_RADIUS = 6;
/** The hero goes home below this HP (squad state 4, JobDefend). */
const HERO_RETREAT_HP = 700;

const squadUnits = (c: Ctx, s: AiSquad): Unit[] => s.units.map((id) => findById(c.w.units, id)).filter((u): u is Unit => !!u && u.hp > 0);
const targetOf = (c: Ctx, s: AiSquad): AiTarget | undefined => c.ai.targets.find((t) => t.id === s.target);
const hasHero = (c: Ctx, s: AiSquad) => squadUnits(c, s).some((u) => u.role === ROLE_HERO);

function centroid(c: Ctx, us: readonly Unit[]): number {
  if (!us.length) return c.ai.home;
  let sx = 0, sy = 0;
  for (const u of us) {
    const a = at(c, u);
    sx += cx(c, a);
    sy += cy(c, a);
  }
  return cellOfXY(c, Math.trunc(sx / us.length), Math.trunc(sy / us.length));
}

function setState(s: AiSquad, state: number): void {
  if (s.state === state) return;
  s.prev = s.state;
  s.state = state;
  s.timer = 0;
}

/** Add a goal unless one of the same kind already covers the spot (TargetMgr add 0x0209E568). */
export function addTarget(c: Ctx, cat: number, cell: number, radius: number, prio: number): AiTarget | undefined {
  for (const t of c.ai.targets) if (t.cat === cat && cheb(c, t.cell, cell) <= radius + (t.radius >> 1)) return undefined;
  const t: AiTarget = { id: c.ai.nextTarget++, cat, cell, radius, required: 1 + strengthNear(c, cell, radius), prio, born: c.w.tick };
  c.ai.targets.push(t);
  return t;
}

function newSquad(c: Ctx, job: number, target: number): AiSquad {
  const s: AiSquad = { id: c.ai.nextSquad++, state: job < 0 ? 12 : 2, prev: 12, timer: 0, units: [], job, jobState: 0, target, goal: -1, last: -1, need: 0, strength: 0 };
  const t = c.ai.targets.find((x) => x.id === target);
  if (t) s.need = t.required;
  c.ai.squads.push(s);
  return s;
}

// ---------------------------------------------------------------- ArmySquadManager

/** ArmySquadManager_update (0x0209878C), every 4th brain update: group, recruit, then step or prune. */
export function armyUpdate(c: Ctx): void {
  groupUnits(c);
  recruit(c);
  reactToHits(c);
  const a = c.ai;
  if (a.asmPhase < 4) {
    for (const s of [...a.squads]) if (s.id !== 0) stepSquad(c, s);
  } else prune(c);
  a.asmPhase = (a.asmPhase + 1) % 5;
}

/** ASM_groupUnits (0x02099808): new soldiers go to the pool, a hero gets a squad of its own. */
function groupUnits(c: Ctx): void {
  const inSquad = new Set<number>();
  for (const s of c.ai.squads) for (const id of s.units) inSquad.add(id);
  for (const u of c.own) {
    if (isBuilding(u) || u.role === ROLE_BUILDER || u.role === ROLE_TRANSPORT || u.role < 0 || inSquad.has(u.id)) continue;
    if (u.role === ROLE_HERO) newSquad(c, -1, 0).units.push(u.id);
    else c.ai.squads[0]!.units.push(u.id);
  }
}

/** Roles a job takes (UnitsRequired): soldiers 2-4 for attacks and scouts, 2-3 for defense. */
const takes = (job: number, role: number) => (job === JOB_DEFEND ? role === 2 || role === 3 : role >= 2 && role <= 4) || (job !== JOB_SCOUT && role === 6);

/** ASM_recruit (0x02099B1C): squads short of strength pull units from the pool, 1 a call for scouts, 4 for others. */
function recruit(c: Ctx): void {
  const pool = c.ai.squads[0]!;
  for (const s of c.ai.squads) {
    if (s.id === 0 || s.job < 0 || s.state === 1) continue;
    const full = s.job === JOB_SCOUT ? s.units.length >= 1 : s.strength >= s.need && s.state !== 2;
    if (full) continue;
    let n = s.job === JOB_SCOUT ? 1 : 4;
    for (let i = 0; i < pool.units.length && n > 0; ) {
      const u = findById(c.w.units, pool.units[i]!);
      if (u && takes(s.job, u.role)) {
        s.units.push(u.id);
        pool.units.splice(i, 1);
        n--;
      } else i++;
    }
    s.strength = squadUnits(c, s).reduce((t, u) => t + u.priority, 0);
  }
}

/** Drop dead units and empty squads (the 5th ASM call). */
function prune(c: Ctx): void {
  for (const s of c.ai.squads) s.units = s.units.filter((id) => (findById(c.w.units, id)?.hp ?? 0) > 0);
  c.ai.squads = c.ai.squads.filter((s) => s.id === 0 || s.units.length > 0 || (s.job >= 0 && s.job !== JOB_SCOUT && s.state === 2));
}

/**
 * Unit-attacked hook (0x0209A6B8): a squad whose unit was hit fights back (state 8); a hit building or
 * builder calls the nearest squad stronger than 20 within 45 cells (state 5).
 */
function reactToHits(c: Ctx): void {
  const since = c.w.tick - 26;
  for (const u of c.own) {
    if (u.lastHit < since) continue;
    const s = c.ai.squads.find((q) => q.id !== 0 && q.units.includes(u.id));
    if (s) {
      if (s.state !== 8 && s.state !== 1 && s.job !== JOB_SCOUT) {
        setState(s, 8);
        s.goal = at(c, u);
      }
      continue;
    }
    if (!isBuilding(u) && u.role !== ROLE_BUILDER) continue;
    let best: AiSquad | undefined;
    let bestD = 46;
    for (const q of c.ai.squads) {
      if (q.id === 0 || q.strength <= 20 || q.state === 5 || q.state === 8 || q.state === 1) continue;
      const d = manhattan(c, centroid(c, squadUnits(c, q)), at(c, u));
      if (d < bestD) (best = q), (bestD = d);
    }
    if (best) {
      setState(best, 5);
      best.goal = at(c, u);
    }
  }
}

/** One squad step (the ASM_update state switch). */
function stepSquad(c: Ctx, s: AiSquad): void {
  s.timer++;
  const us = squadUnits(c, s);
  s.strength = us.reduce((t, u) => t + u.priority, 0);
  if (s.job === JOB_SCOUT) return stepScout(c, s, us);
  const t = targetOf(c, s);
  switch (s.state) {
    case 12:
      if (hasHero(c, s)) setState(s, 4);
      else if (s.job >= 0) setState(s, 2);
      break;
    case 1: // disband
      if (s.timer > 5) {
        c.ai.squads[0]!.units.push(...s.units.filter((id) => findById(c.w.units, id)?.role !== ROLE_HERO));
        s.units = [];
        s.job = -1;
      }
      break;
    case 2: // gather
      if (!t) setState(s, 1);
      else if (s.strength >= s.need || s.timer >= GATHER_STEPS) {
        if (us.length === 0) setState(s, 1);
        else if (s.job === JOB_DEFEND) {
          setState(s, 11);
          scatter(c, us, t.cell, t.radius >> 1, 2);
        } else {
          s.jobState = 1;
          setState(s, 7);
          issueMove(c, us.map((u) => u.id), t.cell, 2);
        }
      } else if (s.timer >= 2 * GATHER_STEPS) setState(s, 1);
      // Every 16 steps the gathered units spread out toward the goal (Squad_scatterAround from the gather
      // state; this is how the game sent a lone swordsman to the enemy base). Which of regroup and scatter
      // it picks is not traced; scatter is what the emulator showed. likely
      else if (s.timer % 16 === 0 && us.length) scatter(c, us.filter((u) => u.target === null), t.cell, GROUP_RADIUS, 2);
      break;
    case 4: // hero idle
      heroIdle(c, s, us);
      break;
    case 7: { // advance
      if (!t || us.length === 0) return setState(s, 1);
      const mid = centroid(c, us);
      if (us.some((u) => cheb(c, at(c, u), mid) > 2 * GROUP_RADIUS)) {
        setState(s, 10);
        break;
      }
      if (cheb(c, mid, t.cell) <= t.radius) setState(s, 11);
      else {
        const idle = us.filter((u) => u.tx === null && u.target === null).map((u) => u.id);
        issueMove(c, idle, t.cell, 2);
      }
      if (s.timer % 4 === 0) heroAbility(c, us);
      break;
    }
    case 10: { // regroup
      const mid = centroid(c, us);
      const far = us.filter((u) => cheb(c, at(c, u), mid) > GROUP_RADIUS);
      if (!far.length || s.timer > 36) setState(s, s.prev === 10 ? 7 : s.prev);
      else issueMove(c, far.map((u) => u.id), mid, 0);
      break;
    }
    case 11: // hold at the goal
      if (!t || us.length === 0) return setState(s, 1);
      if (s.job === JOB_ATTACK && strengthNear(c, t.cell, t.radius) === 0) {
        c.ai.targets = c.ai.targets.filter((x) => x.id !== t.id);
        setState(s, 1);
        break;
      }
      if (s.timer % 8 === 0) scatter(c, us.filter((u) => u.target === null), t.cell, Math.max(2, t.radius >> 1), 2);
      if (s.job === JOB_DEFEND && us.some((u) => u.role === ROLE_HERO && u.hp < HERO_RETREAT_HP)) issueMove(c, us.filter((u) => u.role === ROLE_HERO).map((u) => u.id), c.ai.home, 0);
      break;
    case 5: // respond to a hit elsewhere
    case 8: { // fight back
      const foes = enemies(c).filter((e) => cheb(c, at(c, e), s.goal) <= 6);
      if (foes.length) {
        s.timer = 0;
        const idle = us.filter((u) => u.target === null && u.attack);
        if (idle.length) {
          if (s.state === 8) c.out.push({ kind: 'attack', unitIds: idle.map((u) => u.id), target: nearestOf(c, foes, s.goal).id });
          else issueMove(c, idle.map((u) => u.id), s.goal, 2);
        }
        heroAbility(c, us);
      } else if (s.timer >= 20 || s.state === 8) setState(s, s.prev === 5 || s.prev === 8 ? (s.job >= 0 ? 2 : 4) : s.prev);
      break;
    }
  }
}

function nearestOf(c: Ctx, us: readonly Unit[], cell: number): Unit {
  let best = us[0]!;
  for (const u of us) if (cheb(c, at(c, u), cell) < cheb(c, at(c, best), cell)) best = u;
  return best;
}

/**
 * Squad_scatterAround (0x0209CD18): each unit to a random spot near `cell`, offset
 * rand(2r + 10) - r - 5 per axis, as a combat move (mode 2) by default.
 */
function scatter(c: Ctx, us: readonly Unit[], cell: number, r: number, mode: number): void {
  for (const u of us) {
    const x = clamp(cx(c, cell) + aiRand(c.ai, 2 * r + 10) - r - 5, 0, W(c) - 1);
    const y = clamp(cy(c, cell) + aiRand(c.ai, 2 * r + 10) - r - 5, 0, H(c) - 1);
    issueMove(c, [u.id], cellOfXY(c, x, y), mode);
  }
}

/** Squad state 4: the hero wanders around home, goes home when hurt, and tries a spell every 8 steps. */
function heroIdle(c: Ctx, s: AiSquad, us: readonly Unit[]): void {
  const hero = us.find((u) => u.role === ROLE_HERO);
  if (!hero) return setState(s, 1);
  if (hero.hp < HERO_RETREAT_HP && cheb(c, at(c, hero), c.ai.home) > GROUP_RADIUS) issueMove(c, [hero.id], c.ai.home, 0);
  else if (hero.tx === null && hero.target === null) scatter(c, [hero], c.ai.home, GROUP_RADIUS, 2);
  if (s.timer % 8 === 0) heroAbility(c, us);
}

/**
 * HeroAbility_choose / _cast (0x0209752C, 0x020979E8): with charge to spare and enemies within 5
 * cells, cast one of the hero's spells at the nearest. The game weighs spell categories by the
 * strengths on both sides; that weighting isn't ported (guess: any castable spell, picked by AI_rand).
 */
function heroAbility(c: Ctx, us: readonly Unit[]): void {
  const hero = us.find((u) => u.role === ROLE_HERO);
  if (!hero || hero.charge < hero.maxCharge - 500) return;
  const foes = enemies(c).filter((e) => cheb(c, at(c, e), at(c, hero)) <= 5);
  if (!foes.length) return;
  const foe = nearestOf(c, foes, at(c, hero));
  const ok = hero.spells.filter((id) => {
    const d = c.w.spellDefs[id];
    if (!d || d.cost >= hero.charge) return false;
    const mode = spellTarget(d);
    return mode !== 'unit' || canTarget(c.w, d, c.ai.player, foe);
  });
  if (!ok.length) return;
  const id = ok[ok.length > 1 ? aiRand(c.ai, ok.length) : 0]!;
  const d = c.w.spellDefs[id]!;
  const mode = spellTarget(d);
  c.out.push({ kind: 'cast', caster: hero.id, spell: id, target: mode === 'unit' ? foe.id : 0, x: foe.x, y: foe.y });
}

// ---------------------------------------------------------------- JobScout

/** JobScout (0x02091560): one soldier walks a biased random path and reports enemy buildings. */
function stepScout(c: Ctx, s: AiSquad, us: readonly Unit[]): void {
  const u = us[0];
  if (!u) return;
  if (s.timer % 2 === 0) scoutLook(c, u);
  if (u.tx === null && u.target === null) {
    const p = scoutPoint(c, s, u, 0);
    if (p >= 0) issueMove(c, [u.id], p, 0);
  }
}

/** PickScoutPoint (0x02091CAC): 6-18 cells per axis, away from the last point, up to 5 tries. */
function scoutPoint(c: Ctx, s: AiSquad, u: Unit, depth: number): number {
  const p = at(c, u);
  const last = s.last >= 0 ? s.last : p;
  const bx = cx(c, last) > cx(c, p) ? -3 : 3;
  const by = cy(c, last) > cy(c, p) ? -3 : 3;
  let ox = aiRand(c.ai, 24) - 12;
  ox += ox < 0 ? -6 : 6;
  let oy = aiRand(c.ai, 24) - 12;
  oy += oy < 0 ? -6 : 6;
  let x = cx(c, p) + ox + bx, y = cy(c, p) + oy + by;
  if (x < 3) x = 3;
  // The game compares x with the map height and sends overshoots to x = 1. confirmed (code; a scout
  // seen walking to (1, 62)). Reproduced as is.
  if (x > H(c) - 3) x = 1;
  if (y < 3) y = 3;
  if (y > H(c) - 3) y = H(c) - 3;
  x = Math.min(x, W(c) - 1);
  const found = walkableNear(c, cellOfXY(c, x, y), 7, u);
  if (found >= 0) {
    s.last = found;
    return found;
  }
  return depth < 4 ? scoutPoint(c, s, u, depth + 1) : -1;
}

function walkableNear(c: Ctx, cell: number, r: number, u: Unit): number {
  const g = c.w.grid!;
  const x0 = cx(c, cell), y0 = cy(c, cell);
  for (let d = 0; d < r; d++)
    for (let y = y0 - d; y <= y0 + d; y++)
      for (let x = x0 - d; x <= x0 + d; x++) {
        if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== d || x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
        if (isWalkable(g, x, y, u.moves) && c.w.occ![y * g.width + x] === 0) return y * g.width + x;
      }
  return -1;
}

/** ScoutLook (0x02091F3C): an enemy building within 8 cells becomes an attack goal (farms first). */
function scoutLook(c: Ctx, u: Unit): void {
  const pref = [ROLE_FARM, ROLE_LUMBER_MILL, ROLE_BASE, ROLE_STABLES, ROLE_BARRACKS];
  const seen = enemies(c).filter((e) => isBuilding(e) && e.owner === c.ai.enemy && cheb(c, at(c, e), at(c, u)) <= 8);
  if (!seen.length) return;
  let pick = seen[0]!;
  for (const r of pref) {
    const b = seen.find((e) => e.role === r);
    if (b) {
      pick = b;
      break;
    }
  }
  const t = addTarget(c, CAT_ATTACK, at(c, pick), 4, 50);
  if (t) t.required = 1 + strengthNear(c, t.cell, 10);
}

// ---------------------------------------------------------------- AIBrain attack planning

/** AIBrain_attackPlanning (0x0208B440), every 13 ticks. */
export function attackPlanning(c: Ctx): void {
  const a = c.ai, br = a.brain;
  const squads = a.squads.filter((s) => s.id !== 0);
  const n = a.squads.reduce((t, s) => t + squadUnits(c, s).length, 0);
  if (n < 3) return;
  const need = n < 10 ? 1 : aiRand(a, 10) > 2 ? 2 : 3;
  if (a.targets.length && br.sinceAttack > 2 * ATTACK_INTERVAL) br.sinceAttack = 0;
  const count = (job: number) => squads.filter((s) => s.job === job).length;
  const homes = a.targets.filter((t) => t.cat === CAT_HOME);
  const threat = a.stats.away > a.awayPct || (count(JOB_DEFEND) === 0 && homes.length > 0);
  let defended = false;
  if (threat && homes.length > count(JOB_DEFEND)) {
    const free = homes.filter((t) => !squads.some((s) => s.job === JOB_DEFEND && s.target === t.id));
    if (free.length) {
      newSquad(c, JOB_DEFEND, free[free.length > 1 ? aiRand(a, free.length) : 0]!.id);
      defended = true;
    }
  }
  const idle = squads.filter((s) => s.job >= 0 && s.jobState === 0).length;
  let attacked = false;
  if (!threat || (!defended && idle === 0)) {
    if (br.sinceAttack > ATTACK_INTERVAL) {
      const attacks = count(JOB_ATTACK);
      if (attacks === 0 || idle < need) {
        const goals = a.targets.filter((t) => t.cat === CAT_ATTACK);
        if (idle === 0) attacked = launchAttack(c, goals.filter((t) => !squads.some((s) => s.job === JOB_ATTACK && s.target === t.id)));
        else if ((n > 15 && goals.length >= attacks) || attacks < need || attacks === 0) attacked = launchAttack(c, goals);
      }
    }
  }
  if (!attacked) {
    if (br.scoutCount++ >= SCOUT_INTERVAL) {
      const k = aiRand(a, 3) + 1 + (c.w.tick > 32000 ? 1 : 0);
      const scouts = squads.filter((s) => s.job === JOB_SCOUT);
      if (scouts.length < k || c.w.tick > 16000) {
        if (scouts.length > k && (c.w.tick > 16000 || scouts.length > 2)) {
          const s = scouts[0]!;
          s.job = -1;
          setState(s, 1);
        } else {
          newSquad(c, JOB_SCOUT, 0);
          br.scoutCount = 0;
        }
      }
    }
    if (br.scoutCount > SCOUT_INTERVAL + 4) br.scoutCount = 0;
  }
}

/**
 * AIBrain_launchAttack (0x0208B9B4): among the goals, the one whose enemy strength is the smallest
 * above 21 (5 one time in five); the first goal when none qualifies. Its requirement goes up by 10
 * (to at most 25+) and a squad starts gathering for it.
 */
function launchAttack(c: Ctx, goals: readonly AiTarget[]): boolean {
  if (!goals.length) return false;
  let pick = goals[0]!;
  if (goals.length > 1) {
    const min = aiRand(c.ai, 10) > 7 ? 5 : 21;
    let best = Infinity;
    for (const g of goals) {
      const s = strengthNear(c, g.cell, g.radius);
      if (s > min && s < best) (best = s), (pick = g);
    }
  }
  if (pick.required < 25) pick.required += 10;
  newSquad(c, JOB_ATTACK, pick.id);
  c.ai.brain.sinceAttack = 0;
  return true;
}

/** Percent of squad strength more than 16 cells from home (AITeamStats_updateArmyAwayPct 0x0209378C). */
export function awayPercent(c: Ctx): number {
  let total = 0, away = 0;
  for (const s of c.ai.squads) {
    const us = squadUnits(c, s);
    const st = us.reduce((t, u) => t + u.priority, 0);
    total += st;
    if (cheb(c, centroid(c, us), c.ai.home) > 16) away += st;
  }
  return total > 0 ? Math.trunc((away * 100) / total) : 100;
}
