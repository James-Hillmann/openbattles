import type { Command } from '../commands';
import type { PlayerId, World } from '../state';
import { addBricks, getPlayer, isBuilding, ROLE_BASE, ROLE_BUILDER } from '../economy';
import { AI_CYCLE, newAi, type AiPlayer } from './state';
import { at, centre, type Ctx } from './ctx';
import { brainEconomy, producerUpdate, resourcesUpdate } from './economy';
import { onCreated } from './buildings';
import { addTarget, armyUpdate, attackPlanning, awayPercent, CAT_ATTACK, CAT_HOME } from './army';

export * from './state';
export { JOB_ATTACK, JOB_DEFEND, JOB_SCOUT } from './army';

/*
 * The computer opponent, ported from the game's User::AIPlayer and the objects it owns (AIBrain,
 * AIResources, AIProducer, ArmySquadManager, the jobs). It lives in the sim, decides from the world
 * state on fixed tick phases, and gives ordinary commands, like the game's AI does (it builds
 * Command objects and submits them like a player). Behavior and confidence: docs/re-notes/ai.md.
 */

/** Bricks the skirmish setup gives the CPU on top of the starting bank (0x02045BC8). confirmed */
export const AI_BONUS_BRICKS = 100;
/**
 * Skirmish mission events, scheduled at match start in what look like milliseconds (5000 and
 * 100000): the attack goal on the enemy base (event 0x84) and the switch to a smaller builder share
 * and a higher defense threshold (event 0x85). The late switch was seen at tick 3073 (confirmed); the
 * goal tick is scaled from it (likely).
 */
export const GOAL_TICK = 162;
export const LATE_TICK = 3073;
/** TargetMgr drops old goals once the game is this old (0x0209E6BC). */
const TARGET_LIFE = 7500;

/**
 * Make `player` a computer opponent against `enemy`. `marks` are the map's MARK type-0 points
 * (cells), where it looks for forests, and `towerMarks` its MARK type-3 points, where it puts towers. Call once, right after the world is created.
 */
export function addAi(w: World, player: PlayerId, enemy: PlayerId, marks: readonly number[] = [], towerMarks: readonly number[] = []): AiPlayer {
  const p = getPlayer(w, player);
  const g = w.grid;
  if (!p || !g) throw new Error('addAi needs a skirmish world');
  const base = (id: PlayerId) => {
    const pl = getPlayer(w, id);
    if (pl && pl.start >= 0) return pl.start;
    const b = w.units.find((u) => u.owner === id && u.role === ROLE_BASE);
    return b ? centre({ w } as Ctx, b) : 0;
  };
  const ai = newAi(player, enemy, w.rng.s ^ Math.imul(player + 1, 0x9e3779b9), base(player), base(enemy), marks, towerMarks);
  ai.seen = w.units.reduce((m, u) => Math.max(m, u.id), 0); // the starting buildings aren't "created"
  addBricks(p, AI_BONUS_BRICKS);
  ai.stats.lastBricks = p.bricks;
  w.ai.push(ai);
  w.ai.sort((a, b) => a.player - b.player);
  return ai;
}

/** One tick of a computer opponent: the commands it gives now. */
export function aiStep(w: World, ai: AiPlayer): Command[] {
  const me = getPlayer(w, ai.player);
  if (!me || !w.grid || me.status !== 0) return [];
  const c: Ctx = { w, ai, me, out: [], own: w.units.filter((u) => u.owner === ai.player && u.hp > 0) };
  missionEvents(c);
  onCreated(c);
  // AIPlayer_updateDispatch (0x0208AC08): a 1..13 counter picks what runs this tick.
  const k = ai.cycle;
  let flags = 0;
  if (k % 6 === 0) flags = 1;
  else if ((k + 2) % 6 === 0) flags = 2;
  else if (k % 3 === 0) flags = 4;
  else if ((k + 3) % 8 === 0) flags = 8;
  update(c, flags);
  ai.cycle = k >= AI_CYCLE ? 1 : k + 1;
  return c.out;
}

/** AIPlayer_update (0x0208ACE0). */
function update(c: Ctx, flags: number): void {
  const t = c.w.tick;
  if (flags & 4) {
    updateIncome(c);
    producerUpdate(c);
    if (t % 5 === 0) countUnits(c);
  }
  if (flags & 1) resourcesUpdate(c);
  if (flags & 2) brainUpdate(c);
  if (flags & 8) expireTargets(c);
}

/** AIBrain_update (0x0208B168): economy every 4th update, the squads two updates later, planning every other. */
function brainUpdate(c: Ctx): void {
  const br = c.ai.brain;
  br.count++;
  br.sinceAttack++;
  if (br.count % 4 === 0) {
    brainEconomy(c);
    c.ai.stats.away = awayPercent(c);
  } else if ((br.count + 2) % 4 === 0) armyUpdate(c);
  if (br.count % 2 === 1) attackPlanning(c);
}

/** The skirmish's AI setup (MultiplayerMission 0x02045BC8, 0x02045CB4, 0x02045D50). */
function missionEvents(c: Ctx): void {
  const ai = c.ai;
  if (!c.ai.targets.length && !(ai.events & 4)) {
    // The home goal (category 1, radius 10, priority 99) every defense squad guards (0x0208A558).
    const home = addTarget(c, CAT_HOME, ai.home, 10, 99);
    if (home) home.required = 55;
    ai.events |= 4;
  }
  if (!(ai.events & 1) && c.w.tick >= GOAL_TICK) {
    addTarget(c, CAT_ATTACK, ai.enemyHome, 10, 80);
    ai.events |= 1;
  }
  if (!(ai.events & 2) && c.w.tick >= LATE_TICK) {
    ai.builderPct = 18;
    ai.awayPct = 60;
    ai.events |= 2;
  }
}

/** Stats_updateIncome (0x020923A0): a smoothed brick income, in bricks per pass. Integer version of the game's doubles. */
function updateIncome(c: Ctx): void {
  const s = c.ai.stats;
  const d = c.me.bricks - s.lastBricks;
  s.lastBricks = c.me.bricks;
  if (Math.abs(d) > 2 && Math.abs(d) > Math.abs(s.incomeAvg)) {
    s.incomeAvg += Math.trunc((d - s.incomeAvg) / 4);
    s.ring[s.ringPos] = d;
    s.ringPos = (s.ringPos + 1) % s.ring.length;
    s.income = Math.trunc(s.ring.reduce((a, b) => a + b, 0) / s.ring.length);
  } else if (Math.abs(d) > 2) s.incomeAvg = Math.trunc((s.incomeAvg * 8) / 10);
  else s.incomeAvg = Math.trunc((s.incomeAvg * 9) / 10);
}

/** Stats_countUnits (0x02092480): builder share, soldiers and buildings, every 5 ticks. */
function countUnits(c: Ctx): void {
  const s = c.ai.stats;
  let b = 0, m = 0, k = 0;
  for (const u of c.own) {
    if (isBuilding(u)) k++;
    else if (u.role === ROLE_BUILDER) b++;
    else if (u.role === 0 || (u.role >= 2 && u.role <= 6)) m++;
  }
  s.buildings = k;
  s.military = m;
  s.builderShare = b + m === 0 ? 50 : Math.trunc((100 * b) / (b + m));
}

/** TargetMgr_update (0x0209E6BC): attack goals older than 7500 ticks go once there are 3 or more. */
function expireTargets(c: Ctx): void {
  const ts = c.ai.targets;
  if (c.w.tick < TARGET_LIFE || ts.length < 3) return;
  c.ai.targets = ts.filter((t) => t.cat !== CAT_ATTACK || c.w.tick - t.born < TARGET_LIFE || c.ai.squads.some((s) => s.target === t.id));
}


