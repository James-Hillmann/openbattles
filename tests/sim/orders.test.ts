import { describe, expect, it } from 'vitest';
import {
  RETURN_WAIT, STANCE_HOLD, STANCE_MOVE, STANCE_PATROL, STANCE_STAND, cellCenterX, cellCenterY, createWorld, getPlayer, placeBuilding,
  sanitizeCommand, spawnUnit, step, type AttackStats, type Command, type EntityType, type TerrainGrid, type Unit, type UnitType, type World,
} from '@lbw/sim';

const melee: AttackStats = { damage: 10, damageRand: 0, cooldown: 30, minRange: 1, maxRange: 1, sight: 5, projectile: null };
const SWORDSMAN: UnitType = { kind: 3, speed: 410, hp: 350, priority: 15, attack: melee, sight: 5 };
/** Can't fight back and never dies quickly: a target to chase. */
const DUMMY: UnitType = { kind: 5, speed: 410, hp: 30, priority: 5 };

const W = 30;
const open = (): TerrainGrid => ({ width: W, height: W, cells: new Uint8Array(W * W) });
const cell = (u: Unit) => [Math.floor(u.x / (24 << 16)), Math.floor(u.y / (16 << 16))];

function world(types: EntityType[] = []): World {
  return createWorld({
    seed: 3, grid: open(), types,
    players: [0, 1].map((id) => ({ id, team: id, bricks: 500, status: 0, start: -1, reservedPop: 0, reservedStars: 0 })),
  });
}
const put = (w: World, owner: number, cx: number, cy: number, t: UnitType) => spawnUnit(w, owner, cellCenterX(cx), cellCenterY(cy), t);
function run(w: World, ticks: number, cmds: Command[] = [], player = 0): void {
  for (let i = 0; i < ticks; i++) step(w, i === 0 ? cmds.map((cmd) => ({ tick: w.tick, player, cmd })) : []);
}

describe('holding a post (the default stance)', () => {
  it('chases an enemy it sees, kills it, waits 20 ticks, then walks back to its post', () => {
    const w = world();
    const s = put(w, 0, 10, 10, SWORDSMAN);
    const d = put(w, 1, 14, 10, DUMMY);
    expect(s.stance).toBe(STANCE_HOLD);
    expect(s.post).toBe(10 * W + 10);
    let died = -1;
    for (let i = 0; i < 400 && died < 0; i++) {
      run(w, 1);
      if (d.hp === 0) died = w.tick;
    }
    expect(died).toBeGreaterThan(0);
    expect(cell(s)).toEqual([13, 10]);
    run(w, RETURN_WAIT - 1);
    expect(cell(s)).toEqual([13, 10]); // still waiting
    run(w, 200);
    expect(cell(s)).toEqual([10, 10]);
  });

  it('only takes enemies within sight + max range of its post', () => {
    const w = world();
    const s = put(w, 0, 20, 10, SWORDSMAN);
    s.post = 5 * W + 10; // guarding a cell 10 columns away: far = 5 + 1 = 6
    put(w, 1, 23, 10, DUMMY); // 3 cells from the unit, 13 from its post
    run(w, 100);
    expect(s.target).toBeNull();
    expect(cell(s)).toEqual([20, 10]);
  });

  it('a move order ends in a hold on the arrival cell, and units walking under it ignore enemies', () => {
    const w = world();
    const s = put(w, 0, 5, 5, SWORDSMAN);
    put(w, 1, 9, 9, DUMMY); // in sight along the way
    run(w, 1, [{ kind: 'move', unitIds: [s.id], x: cellCenterX(12), y: cellCenterY(12) }]);
    expect(s.stance).toBe(STANCE_MOVE);
    for (let i = 0; i < 300 && s.stance === STANCE_MOVE; i++) {
      run(w, 1);
      if (s.stance === STANCE_MOVE) expect(s.target).toBeNull();
    }
    expect(s.stance).toBe(STANCE_HOLD);
    expect(s.post).toBe(12 * W + 12);
  });
});

describe('stand ground', () => {
  it('never moves: ignores an enemy in sight but out of range, hits one in range', () => {
    const w = world();
    const s = put(w, 0, 10, 10, SWORDSMAN);
    const far = put(w, 1, 13, 10, DUMMY);
    run(w, 1, [{ kind: 'stand', unitIds: [s.id] }]);
    expect(s.stance).toBe(STANCE_STAND);
    run(w, 120);
    expect(cell(s)).toEqual([10, 10]);
    expect(far.hp).toBe(30);
    const near = put(w, 1, 10, 11, DUMMY);
    run(w, 90);
    expect(near.hp).toBeLessThan(30);
    expect(cell(s)).toEqual([10, 10]);
  });
});

describe('stop', () => {
  it('stops a walking unit, which then holds where it stopped', () => {
    const w = world();
    const s = put(w, 0, 2, 2, SWORDSMAN);
    run(w, 1, [{ kind: 'move', unitIds: [s.id], x: cellCenterX(25), y: cellCenterY(2) }]);
    run(w, 60);
    run(w, 1, [{ kind: 'stop', unitIds: [s.id] }]);
    run(w, 30);
    const [x, y] = cell(s);
    expect(x).toBeLessThan(25);
    expect(s.stance).toBe(STANCE_HOLD);
    expect(s.post).toBe(y! * W + x!);
    run(w, 120);
    expect(cell(s)).toEqual([x, y]);
  });

  it("ignores other players' units", () => {
    const w = world();
    const s = put(w, 1, 2, 2, SWORDSMAN);
    run(w, 1, [{ kind: 'move', unitIds: [s.id], x: cellCenterX(25), y: cellCenterY(2) }], 1);
    run(w, 1, [{ kind: 'stop', unitIds: [s.id] }], 0);
    expect(s.stance).toBe(STANCE_MOVE);
  });
});

describe('patrol', () => {
  it('walks to the first point, then back and forth', () => {
    const w = world();
    const s = put(w, 0, 10, 10, SWORDSMAN);
    run(w, 1, [{ kind: 'patrol', unitIds: [s.id], ax: 14, ay: 10, bx: 6, by: 10 }]);
    expect(s.stance).toBe(STANCE_PATROL);
    const seen: number[] = [];
    for (let i = 0; i < 900; i++) {
      run(w, 1);
      const [x] = cell(s);
      if (x === 14 || x === 6) if (seen[seen.length - 1] !== x) seen.push(x!);
    }
    expect(seen.slice(0, 4)).toEqual([14, 6, 14, 6]);
  });

  it('fights what it meets, then goes on patrolling', () => {
    const w = world();
    const s = put(w, 0, 10, 10, SWORDSMAN);
    const d = put(w, 1, 12, 13, DUMMY);
    run(w, 1, [{ kind: 'patrol', unitIds: [s.id], ax: 14, ay: 10, bx: 6, by: 10 }]);
    run(w, 600);
    expect(d.hp).toBe(0);
    expect(s.stance).toBe(STANCE_PATROL);
    const xs = new Set<number>();
    for (let i = 0; i < 600; i++) {
      run(w, 1);
      xs.add(cell(s)[0]!);
    }
    expect(xs.has(14) && xs.has(6)).toBe(true);
  });
});

describe('rally points', () => {
  const BUILDER: EntityType = { kind: 1, role: 1, speed: 410, hp: 250, cost: 50, buildTime: 30, size: 1, yield: 0, priority: 5, attack: null, faction: 'K' };
  const CASTLE: EntityType = { kind: 2, role: 7, speed: 0xffff, hp: 1500, cost: 0, buildTime: 1, size: 3, yield: 0, priority: 10, attack: null, faction: 'K' };
  const types: EntityType[] = [];
  types[1] = BUILDER;
  types[2] = CASTLE;

  it('a trained unit walks to its building rally point', () => {
    const w = world(types);
    const c = placeBuilding(w, 0, CASTLE, 5, 5);
    run(w, 1, [{ kind: 'rally', unitIds: [c.id], cx: 15, cy: 12 }]);
    expect(c.rally).toBe(12 * W + 15);
    run(w, 1, [{ kind: 'train', building: c.id, type: 1 }]);
    run(w, 400);
    const b = w.units.find((u) => u.kind === 1)!;
    expect(cell(b)).toEqual([15, 12]);
    expect(b.stance).toBe(STANCE_HOLD);
  });

  it('cell (0, 0) clears it, and only own buildings take it', () => {
    const w = world(types);
    const c = placeBuilding(w, 0, CASTLE, 5, 5);
    run(w, 1, [{ kind: 'rally', unitIds: [c.id], cx: 15, cy: 12 }], 1);
    expect(c.rally).toBe(-1);
    run(w, 1, [{ kind: 'rally', unitIds: [c.id], cx: 15, cy: 12 }]);
    run(w, 1, [{ kind: 'rally', unitIds: [c.id], cx: 0, cy: 0 }]);
    expect(c.rally).toBe(-1);
  });

  it('stop on a building cancels the unit in training and refunds it', () => {
    const w = world(types);
    const c = placeBuilding(w, 0, CASTLE, 5, 5);
    run(w, 1, [{ kind: 'train', building: c.id, type: 1 }]);
    run(w, 15);
    expect(getPlayer(w, 0)!.bricks).toBe(450);
    run(w, 1, [{ kind: 'stop', unitIds: [c.id] }]);
    expect(getPlayer(w, 0)!.bricks).toBe(500);
    expect(c.queue).toEqual([]);
  });
});

describe('wire', () => {
  it('sanitizes the new orders', () => {
    expect(sanitizeCommand({ kind: 'stop', unitIds: [1, 2] })).toEqual({ kind: 'stop', unitIds: [1, 2] });
    expect(sanitizeCommand({ kind: 'stand', unitIds: [3], extra: 1 })).toEqual({ kind: 'stand', unitIds: [3] });
    expect(sanitizeCommand({ kind: 'patrol', unitIds: [1], ax: 1, ay: 2, bx: 3, by: 4 })).toEqual({ kind: 'patrol', unitIds: [1], ax: 1, ay: 2, bx: 3, by: 4 });
    expect(sanitizeCommand({ kind: 'patrol', unitIds: [1], ax: 1, ay: 2, bx: 3 })).toBeNull();
    expect(sanitizeCommand({ kind: 'rally', unitIds: [1], cx: 1.5, cy: 2 })).toBeNull();
  });
});
