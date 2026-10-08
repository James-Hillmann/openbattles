import { describe, expect, it } from 'vitest';
import {
  cellCenterX,
  cellCenterY,
  cellOf,
  createWorld,
  fx,
  fxToFloat,
  orderMove,
  unitPath,
  WAIT_TICKS,
  hashWorld,
  isWalkable,
  spawnUnit,
  spreadCells,
  step,
  type TerrainGrid,
  type Unit,
  type UnitType,
  type World,
} from '@lbw/sim';

/** '.' open, 'r' rough, 'T' tree, '~' water, '#' plateau. */
function grid(rows: string[]): TerrainGrid {
  const code: Record<string, number> = { '.': 0, T: 1, r: 2, '~': 3, '#': 5 };
  return { width: rows[0]!.length, height: rows.length, cells: Uint8Array.from(rows.join(''), (c) => code[c]!) };
}
const xy = (g: TerrainGrid, i: number) => [i % g.width, Math.floor(i / g.width)];

/** Order unit u to cell (x, y) and run until it stops (or `ticks` run out). */
function walk(w: World, u: Unit, x: number, y: number, ticks = 400): void {
  orderMove(w, u, y * w.grid!.width + x);
  for (let t = 0; t < ticks && u.mv; t++) step(w, []);
}
const cellXY = (u: Unit) => cellOf(u.x, u.y);

describe('walking on a map', () => {
  it('walks around a wall', () => {
    const g = grid(['..#..', '..#..', '..~..', '..T..', '..r..']);
    const w = createWorld({ seed: 1, grid: g });
    const u = spawnUnit(w, 0, cellCenterX(0), cellCenterY(0));
    const seen: number[][] = [];
    orderMove(w, u, 4);
    for (let t = 0; t < 400 && u.mv; t++) {
      step(w, []);
      seen.push(xy(g, u.cell));
    }
    expect(cellXY(u)).toEqual([4, 0]);
    expect(seen.some(([, y]) => y === 4)).toBe(true); // through the rough gap at the bottom
    for (const [x, y] of seen) expect(isWalkable(g, x!, y!)).toBe(true);
  });

  it('stops at the edge when sent into a forest, like the game', () => {
    const w = createWorld({ seed: 1, grid: grid(['...TTT']) });
    const u = spawnUnit(w, 0, cellCenterX(0), cellCenterY(0));
    walk(w, u, 5, 0);
    expect(u.mv).toBeNull();
    expect(cellXY(u)).toEqual([2, 0]);
  });

  it('gets as close as it can to an unreachable island', () => {
    const w = createWorld({ seed: 1, grid: grid(['..~~~', '..~.~', '..~~~']) });
    const u = spawnUnit(w, 0, cellCenterX(0), cellCenterY(1));
    walk(w, u, 3, 1);
    expect(u.mv).toBeNull();
    expect(cellXY(u)[0]).toBe(1);
  });

  it('heads for a point about 5 cells ahead, not straight at a far goal', () => {
    const w = createWorld({ seed: 1, grid: grid(['.'.repeat(30)]) });
    const u = spawnUnit(w, 0, cellCenterX(0), cellCenterY(0));
    orderMove(w, u, 20);
    step(w, []);
    // 20 cells: scale 0x529/4096, 20 * 1321 >> 12 = 6 (docs/re-notes/movement.md)
    expect(u.mv!.wp).toBe(6);
  });

  it('stops on the cell centre once inside the align window (emulator: King at 310.64, 286.64)', () => {
    // The King walking from game position (264, 240) to cell (13, 18) in DeSmuME stopped at
    // game (310.64, 286.64). Game positions are ours minus (12, 8): the game measures from cell centres.
    const w = createWorld({ seed: 1, grid: grid(Array(30).fill('.'.repeat(30))) });
    const king = spawnUnit(w, 0, fx(276), fx(248), { speed: 410 });
    walk(w, king, 13, 18);
    expect(fxToFloat(king.x) - 12).toBeCloseTo(310.64, 2);
    expect(fxToFloat(king.y) - 8).toBeCloseTo(286.64, 2);
  });
});

describe('unit spacing', () => {
  const open = () => grid(Array(30).fill('.'.repeat(30)));

  it('a second unit sent to an occupied cell stops next to it (emulator: builder after King)', () => {
    const w = createWorld({ seed: 1, grid: open() });
    const king = spawnUnit(w, 0, fx(276), fx(248), { speed: 410 });
    const builder = spawnUnit(w, 0, fx(252), fx(216), { speed: 410 });
    walk(w, king, 13, 18);
    walk(w, builder, 13, 18);
    expect(builder.mv).toBeNull();
    // DeSmuME: the builder stopped in cell (13, 17) at game (310.93, 272.83).
    expect(cellXY(builder)).toEqual([13, 17]);
    expect(cellXY(king)).toEqual([13, 18]);
  });

  it('never lets two units hold the same cell', () => {
    const w = createWorld({ seed: 1, grid: open() });
    for (let i = 0; i < 8; i++) spawnUnit(w, i % 2, cellCenterX(2 + i), cellCenterY(5 + (i % 3)));
    // everyone at one spot, in two opposing groups
    step(w, [
      { tick: 0, player: 0, cmd: { kind: 'move', unitIds: [1, 3, 5, 7], x: cellCenterX(20), y: cellCenterY(6) } },
      { tick: 0, player: 1, cmd: { kind: 'move', unitIds: [2, 4, 6, 8], x: cellCenterX(1), y: cellCenterY(6) } },
    ]);
    for (let t = 0; t < 400; t++) {
      step(w, []);
      const held = w.units.map((u) => u.cell);
      expect(new Set(held).size).toBe(held.length);
      for (const u of w.units) expect(w.occ![u.cell]).toBe(u.id);
    }
    expect(w.units.every((u) => u.mv === null)).toBe(true);
  });

  it('waits behind a walking unit for up to 2 s, then sidesteps past it', () => {
    const w = createWorld({ seed: 1, grid: open() });
    const fast = spawnUnit(w, 0, cellCenterX(2), cellCenterY(5), { speed: 410 });
    const slow = spawnUnit(w, 0, cellCenterX(4), cellCenterY(5), { speed: 5 }); // stays in its cell for the whole wait
    orderMove(w, slow, 5 * 30 + 25);
    orderMove(w, fast, 5 * 30 + 12);
    const runs: number[] = []; // lengths of each stretch spent waiting
    let run = 0;
    for (let t = 0; t < 600 && fast.mv; t++) {
      step(w, []);
      if (fast.mv?.wait === 1) run++;
      else if (run > 0) runs.push(run), (run = 0);
    }
    expect(runs[0]).toBe(WAIT_TICKS); // 2 s at 30 ticks/s, then it gives up and sidesteps
    expect(cellXY(fast)).toEqual([12, 5]);
  });

  it('walks around a standing unit without waiting', () => {
    const w = createWorld({ seed: 1, grid: open() });
    const a = spawnUnit(w, 0, cellCenterX(2), cellCenterY(5));
    spawnUnit(w, 0, cellCenterX(4), cellCenterY(5));
    orderMove(w, a, 5 * 30 + 8);
    let waited = false;
    for (let t = 0; t < 300 && a.mv; t++) {
      step(w, []);
      if (a.mv?.wait === 1) waited = true;
    }
    expect(waited).toBe(false);
    expect(cellXY(a)).toEqual([8, 5]);
  });

  it('frees the cell of a unit that dies', () => {
    const w = createWorld({ seed: 1, grid: open() });
    const u = spawnUnit(w, 0, cellCenterX(3), cellCenterY(3));
    expect(w.occ![3 * 30 + 3]).toBe(u.id);
    u.hp = 0;
    step(w, []);
    expect(w.occ![3 * 30 + 3]).toBe(0);
  });
});

describe('unitPath (game path costs)', () => {
  it('cuts corners like the game and treats standing units as very expensive', () => {
    const g = grid(['.#', '#.']);
    const w = createWorld({ seed: 1, grid: g });
    const u = spawnUnit(w, 0, cellCenterX(0), cellCenterY(0));
    expect(unitPath(w, u, 3)).toEqual([3]);
    const w2 = createWorld({ seed: 1, grid: grid(['...', '...', '...']) });
    const v = spawnUnit(w2, 0, cellCenterX(0), cellCenterY(1));
    spawnUnit(w2, 0, cellCenterX(1), cellCenterY(1));
    expect(unitPath(w2, v, 5)!.map((c) => xy(w2.grid!, c))).not.toContainEqual([1, 1]);
  });

  it('fails when another unit stands on the goal', () => {
    const w = createWorld({ seed: 1, grid: grid(['....']) });
    const u = spawnUnit(w, 0, cellCenterX(0), cellCenterY(0));
    spawnUnit(w, 0, cellCenterX(3), cellCenterY(0));
    expect(unitPath(w, u, 3)).toBeNull();
  });
});

describe('spreadCells', () => {
  it('returns distinct walkable cells nearest the click first', () => {
    const g = grid(['.....', '.###.', '.....']);
    const cells = spreadCells(g, 2, 1, 4);
    expect(new Set(cells).size).toBe(4);
    for (const c of cells) expect(g.cells[c]).toBe(0);
    for (const c of cells) expect(Math.abs(xy(g, c)[1]! - 1)).toBe(1); // ring around the plateau cell
  });
});

describe('moving on a map', () => {
  const g = grid([
    '..........',
    '....~~....',
    '....~~....',
    '....~~....',
    '....~~....',
    '..........',
  ]);
  function run() {
    const w = createWorld({ seed: 7, grid: g });
    for (let i = 0; i < 4; i++) spawnUnit(w, 0, cellCenterX(1), cellCenterY(1 + i));
    step(w, []);
    const log: string[] = [];
    step(w, [{ tick: 1, player: 0, cmd: { kind: 'move', unitIds: [1, 2, 3, 4], x: fx(8 * 24 + 5), y: fx(2 * 16 + 3) } }]);
    for (let t = 0; t < 300; t++) {
      step(w, []);
      for (const u of w.units) {
        // Positions may clip a water corner on a diagonal step, like the game; held cells never do.
        const [cx, cy] = xy(g, u.cell);
        if (!isWalkable(g, cx!, cy!)) log.push(`unit ${u.id} in water at tick ${w.tick}`);
      }
    }
    return { w, log };
  }

  it('routes a group around water, each unit to its own cell', () => {
    const { w, log } = run();
    expect(log).toEqual([]);
    expect(w.units.every((u) => u.tx === null)).toBe(true);
    const cells = w.units.map((u) => cellOf(u.x, u.y).join(','));
    expect(new Set(cells).size).toBe(4);
    expect(cellOf(w.units[0]!.x, w.units[0]!.y)).toEqual([8, 2]); // first unit: the clicked cell
  });

  it('spreads a group along the near shore when the click is on water', () => {
    const lake = grid(['..~~~..', '..~~~..', '..~~~..', '..~~~..']);
    const w2 = createWorld({ seed: 7, grid: lake });
    for (let i = 0; i < 4; i++) spawnUnit(w2, 0, cellCenterX(0), cellCenterY(i));
    step(w2, [{ tick: 0, player: 0, cmd: { kind: 'move', unitIds: [1, 2, 3, 4], x: cellCenterX(3), y: cellCenterY(1) } }]);
    for (let t = 0; t < 200; t++) step(w2, []);
    const cells = w2.units.map((u) => cellOf(u.x, u.y));
    expect(new Set(cells.map((c) => c.join())).size).toBe(4);
    for (const [x] of cells) expect(x).toBeLessThan(2); // nobody crossed or entered the water
  });

  it('is deterministic (hash pinned; update deliberately when sim rules change)', () => {
    expect(hashWorld(run().w)).toBe(hashWorld(run().w));
    expect(hashWorld(run().w).toString(16)).toMatchInlineSnapshot(`"5851ec51"`);
  });
});

describe('chasing on a map', () => {
  it('a melee unit walks around water to reach and hit its target', () => {
    const g = grid(['..........', '....~.....', '....~.....', '....~.....', '..........']);
    const SWORD: UnitType = { speed: 410, hp: 350, attack: { damage: 10, damageRand: 0, cooldown: 30, minRange: 1, maxRange: 1, sight: 5, projectile: null } };
    const w = createWorld({ seed: 3, grid: g });
    spawnUnit(w, 0, cellCenterX(2), cellCenterY(2), SWORD);
    spawnUnit(w, 1, cellCenterX(7), cellCenterY(2), { hp: 350 });
    step(w, [{ tick: 0, player: 0, cmd: { kind: 'attack', unitIds: [1], target: 2 } }]);
    for (let t = 0; t < 200; t++) {
      step(w, []);
      const [cx, cy] = xy(g, w.units[0]!.cell);
      expect(isWalkable(g, cx!, cy!)).toBe(true);
    }
    expect(w.units[1]!.hp).toBeLessThan(350);
  });
});
