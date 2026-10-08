import { describe, expect, it } from 'vitest';
import {
  cellCenterX,
  cellCenterY,
  cellOf,
  createWorld,
  findPath,
  fx,
  hashWorld,
  isWalkable,
  spawnUnit,
  spreadCells,
  step,
  type TerrainGrid,
  type UnitType,
} from '@lbw/sim';

/** '.' open, 'r' rough, 'T' tree, '~' water, '#' plateau. */
function grid(rows: string[]): TerrainGrid {
  const code: Record<string, number> = { '.': 0, T: 1, r: 2, '~': 3, '#': 5 };
  return { width: rows[0]!.length, height: rows.length, cells: Uint8Array.from(rows.join(''), (c) => code[c]!) };
}
const xy = (g: TerrainGrid, i: number) => [i % g.width, Math.floor(i / g.width)];

describe('findPath', () => {
  it('walks around a wall', () => {
    const g = grid(['..#..', '..#..', '..~..', '..T..', '..r..']);
    const p = findPath(g, 0, 0, 4, 0).map((i) => xy(g, i));
    expect(p.at(-1)).toEqual([4, 0]);
    expect(p.some(([, y]) => y === 4)).toBe(true); // through the rough gap at the bottom
    for (const [x, y] of p) expect(isWalkable(g, x!, y!)).toBe(true);
  });

  it('never cuts a blocked corner', () => {
    const g = grid(['.#', '..']);
    expect(findPath(g, 0, 0, 1, 1).map((i) => xy(g, i))).toEqual([[0, 1], [1, 1]]);
  });

  it('stops at the edge when sent into a forest, like the game', () => {
    const g = grid(['...TTT']);
    expect(findPath(g, 0, 0, 5, 0).map((i) => xy(g, i))).toEqual([[1, 0], [2, 0]]);
  });

  it('gets as close as it can to an unreachable island', () => {
    const g = grid(['..~~~', '..~.~', '..~~~']);
    expect(xy(g, findPath(g, 0, 1, 3, 1).at(-1)!)).toEqual([1, 1]);
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
        const [cx, cy] = cellOf(u.x, u.y);
        if (!isWalkable(g, cx, cy)) log.push(`unit ${u.id} in water at tick ${w.tick}`);
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
    expect([w.units[0]!.x, w.units[0]!.y]).toEqual([fx(8 * 24 + 5), fx(2 * 16 + 3)]); // first unit: exact click
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
    expect(hashWorld(run().w).toString(16)).toMatchInlineSnapshot(`"caf5f360"`);
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
      const [cx, cy] = cellOf(w.units[0]!.x, w.units[0]!.y);
      expect(isWalkable(g, cx, cy)).toBe(true);
    }
    expect(w.units[1]!.hp).toBeLessThan(350);
  });
});
