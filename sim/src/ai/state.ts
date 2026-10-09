import type { PlayerId } from '../state';

/**
 * State of one computer opponent. The game keeps the same pieces on its AIPlayer object
 * (ctor 0x02089FE4) and the objects it owns; field notes say where each lives there.
 * Everything is plain numbers and arrays so the whole thing hashes and copies like the rest
 * of the world. Behavior and confidence: docs/re-notes/ai.md.
 */
export interface AiPlayer {
  player: PlayerId;
  /** The player it plays against (AIPlayer +0x37: the human team in skirmish). */
  enemy: PlayerId;
  /** The dispatcher's 1..13 counter (AIPlayer +0x35). */
  cycle: number;
  /** AI_rand state (0x021568C8): a 64-bit LCG, kept as two 32-bit halves. */
  seedHi: number;
  seedLo: number;
  /** Builder share target in percent (AIPlayer +0x5C): 70, then 18 from LATE_TICK. */
  builderPct: number;
  /** "Army away" percent above which the brain plans defense (brain +0x38): 30, then 60. */
  awayPct: number;
  /** Skirmish setup events that have run (bit 0: enemy-base goal, bit 1: late switch). */
  events: number;
  stats: AiStats;
  brain: AiBrain;
  res: AiResources;
  /** Army requests (brain +0x50, capacity 4) and builder/hero requests (AIResources +0x0C, capacity 10). */
  armyQ: AiRequest[];
  builderQ: AiRequest[];
  squads: AiSquad[];
  /** Goals for attacks and defense (TargetItem list, AIPlayer +0x48). */
  targets: AiTarget[];
  nextSquad: number;
  nextTarget: number;
  /** ArmySquadManager phase 0..4 (+0x1C) and round-robin unit index (+0x18). */
  asmPhase: number;
  /** Map MARK type-0 points (static map data, not hashed): where the AI looks for forests. */
  marks: number[];
  /** Cells (y * width + x) of the own and enemy start points. */
  home: number;
  enemyHome: number;
}

/** AITeamStats (AIPlayer +0x44), the counters the other parts read. */
export interface AiStats {
  lastBricks: number;
  /** Smoothed brick income per AI pass (+0x48 source) and its 10-entry ring. */
  incomeAvg: number;
  ring: number[];
  ringPos: number;
  income: number;
  /** Builder share of own units in percent (+0x50), refreshed every 5 ticks. */
  builderShare: number;
  /** Own non-builder units (+0x42) and buildings (+0x40). */
  military: number;
  buildings: number;
  /** Percent of army strength away from home (+0x51). */
  away: number;
}

/** AIBrain (0x0208B084): army production and attack planning. */
export interface AiBrain {
  /** Update counter (+0x18). */
  count: number;
  /** Brain updates since the last attack launch (+0x20). */
  sinceAttack: number;
  /** Attack-planning calls since the last scout (+0x28); starts full. */
  scoutCount: number;
  /** Priority bonus for army requests, 0..20 (+0x3D). */
  bonus: number;
}

/** AIResources (AIPlayer +0x4C): builders, harvesting and buildings. */
export interface AiResources {
  /** The one building plan: entity kind, priority and requested cell, or kind -1 for none (+0x44). */
  plan: AiRequest;
  /** Odd-tick passes a plan has waited for a builder (+0x6C). */
  wait: number;
  /** Harvest orders given (+0x84): picks the rotating forest offset. */
  harvests: number;
  /** Placement failures (+0x80) and forest marks found empty (+0x8C, cells in `claimed`). */
  fails: number;
  claimed: number[];
  /** Mines still wanted (+0x34). */
  mines: number;
  /** Builders on repair duty (JobRepair squads), by unit id. */
  repairers: number[];
}

export interface AiRequest {
  kind: number;
  prio: number;
  /** Target cell, or -1 for "anywhere". */
  cell: number;
}

/** A goal (game: User::TargetItem). cat 0 = attack, 1 = defend (home). */
export interface AiTarget {
  id: number;
  cat: number;
  cell: number;
  radius: number;
  /** Strength a squad needs for it (+0x28). */
  required: number;
  prio: number;
  born: number;
}

/**
 * A squad (User::Squad / ArmySquad). Squad 0 is the pool new units wait in. `state` follows
 * the game's numbering (ArmySquadManager_update switch): 1 disband, 2 gather, 3 assemble,
 * 4 hero idle, 5 respond, 7 advance, 8 fight back, 10 regroup, 11 hold, 12 new.
 */
export interface AiSquad {
  id: number;
  state: number;
  prev: number;
  /** Steps in the current state (+0x0C). */
  timer: number;
  units: number[];
  /** Job type (0 scout, 5 attack, 6 defend) or -1 for none, its state, and its goal (target id). */
  job: number;
  jobState: number;
  target: number;
  /** Scout: the current and the previous scout point (cells). */
  goal: number;
  last: number;
  /** Strength needed (+0x18) and current strength (+0x58). */
  need: number;
  strength: number;
}

export const AI_CYCLE = 13;

/** A new computer opponent for `player` against `enemy`. */
export function newAi(player: PlayerId, enemy: PlayerId, seed: number, home: number, enemyHome: number, marks: readonly number[]): AiPlayer {
  return {
    player,
    enemy,
    cycle: 1,
    seedHi: (seed ^ 0x5d588b65) | 0,
    seedLo: (Math.imul(seed, 0x6c078965) ^ (player + 1)) | 0,
    builderPct: 70,
    awayPct: 30,
    events: 0,
    stats: { lastBricks: 0, incomeAvg: 0, ring: new Array<number>(10).fill(0), ringPos: 0, income: 0, builderShare: 50, military: 0, buildings: 0, away: 100 },
    brain: { count: 0, sinceAttack: 0, scoutCount: 900, bonus: 0 },
    res: { plan: { kind: -1, prio: 0, cell: -1 }, wait: 0, harvests: 0, fails: 0, claimed: [], mines: 1, repairers: [] },
    armyQ: [],
    builderQ: [],
    squads: [{ id: 0, state: 12, prev: 12, timer: 0, units: [], job: -1, jobState: 0, target: 0, goal: -1, last: -1, need: 0, strength: 0 }],
    targets: [],
    nextSquad: 1,
    nextTarget: 1,
    asmPhase: 0,
    marks: [...marks],
    home,
    enemyHome,
  };
}

const M64 = (1n << 64n) - 1n;

/**
 * AI_rand(n) (0x0208AEF0): s = s * 0x5D588B656C078965 + 0x269EC3 (mod 2^64), result
 * (high 32 bits of s * n) >> 32, so 0 <= r < n. The AI has its own stream, apart from
 * combat's. confirmed (code)
 */
export function aiRand(ai: AiPlayer, n: number): number {
  let s = (BigInt(ai.seedHi >>> 0) << 32n) | BigInt(ai.seedLo >>> 0);
  s = (s * 0x5d588b656c078965n + 0x269ec3n) & M64;
  ai.seedHi = Number(s >> 32n) | 0;
  ai.seedLo = Number(s & 0xffffffffn) | 0;
  if (n <= 0) return 0;
  return Number(((s >> 32n) * BigInt(n)) >> 32n);
}

/** Mix every AI field into the world hash, in a fixed order. */
export function hashAi(ais: readonly AiPlayer[], mix: (v: number) => void): void {
  for (const a of ais) {
    for (const v of [a.player, a.enemy, a.cycle, a.seedHi, a.seedLo, a.builderPct, a.awayPct, a.events, a.nextSquad, a.nextTarget, a.asmPhase, a.home, a.enemyHome]) mix(v);
    const s = a.stats;
    for (const v of [s.lastBricks, s.incomeAvg, s.ringPos, s.income, s.builderShare, s.military, s.buildings, s.away, ...s.ring]) mix(v);
    const b = a.brain;
    for (const v of [b.count, b.sinceAttack, b.scoutCount, b.bonus]) mix(v);
    const r = a.res;
    for (const v of [r.plan.kind, r.plan.prio, r.plan.cell, r.wait, r.harvests, r.fails, r.mines, r.claimed.length, ...r.claimed, r.repairers.length, ...r.repairers]) mix(v);
    for (const q of [a.armyQ, a.builderQ]) {
      mix(q.length);
      for (const it of q) (mix(it.kind), mix(it.prio), mix(it.cell));
    }
    mix(a.squads.length);
    for (const q of a.squads) {
      for (const v of [q.id, q.state, q.prev, q.timer, q.job, q.jobState, q.target, q.goal, q.last, q.need, q.strength, q.units.length, ...q.units]) mix(v);
    }
    mix(a.targets.length);
    for (const t of a.targets) for (const v of [t.id, t.cat, t.cell, t.radius, t.required, t.prio, t.born]) mix(v);
  }
}
