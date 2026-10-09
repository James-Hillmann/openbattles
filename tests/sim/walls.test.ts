import { describe, expect, it } from 'vitest';
import {
  BRIDGE_EXIT_TICKS, TERRAIN_BUILDING, TERRAIN_ROUGH, TERRAIN_WATER, cellCenterX, cellCenterY, createWorld, fpH, fpW, getPlayer,
  hashWorld, isWalkable, sizeBridge, spawnUnit, step, wallLine, type Command, type EntityType, type ScheduledCommand,
  type TerrainGrid, type World,
} from '@lbw/sim';

/**
 * Walls and bridges against the numbers read from Entities.ebp and measured in the emulator
 * (docs/re-notes/walls-bridges.md). Types are written out here; no ROM data is read.
 */
const t = (kind: number, role: number, hp: number, cost: number, buildTime: number, size: number, extra: Partial<EntityType> = {}): EntityType => ({
  kind, role, hp, cost, buildTime, size, speed: role >= 7 ? 0xffff : 410, yield: 0, priority: 1, attack: null, ...extra,
});
const BUILDER = t(2, 1, 150, 50, 150, 1, { faction: 'K' });
const CASTLE = t(10, 7, 1500, 1000, 900, 3, { faction: 'K' });
const WALL = t(120, 19, 250, 10, 60, 1, { moves: 0b0001, layer: 1 });
const BRIDGE_MH = t(123, 17, 500, 10, 30, 8, { moves: 0b1100, layer: 2 });
const TYPES: EntityType[] = [];
for (const x of [BUILDER, CASTLE, WALL, BRIDGE_MH]) TYPES[x.kind] = x;

const W = 32;
/** Open 32x32 map with a river (water) in columns 12-17. */
function grid(): TerrainGrid {
  const cells = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 12; x < 18; x++) cells[y * W + x] = TERRAIN_WATER;
  return { width: W, height: W, cells };
}

function world(bricks = 500): World {
  return createWorld({
    seed: 3, grid: grid(), types: TYPES,
    players: [{ id: 0, team: 0, bricks, status: 0, start: -1, reservedPop: 0, reservedStars: 0 }],
    bridgeSites: [{ cell: 8 * W + 12, type: BRIDGE_MH.kind }],
  });
}

const at = (w: World, cx: number, cy: number) => spawnUnit(w, 0, cellCenterX(cx), cellCenterY(cy), BUILDER);
const bricks = (w: World) => getPlayer(w, 0)!.bricks;
const walls = (w: World) => w.units.filter((u) => u.role === 19);

function run(w: World, ticks: number, cmds: Command[] = []): void {
  for (let i = 0; i < ticks; i++) {
    const sc: ScheduledCommand[] = i === 0 ? cmds.map((cmd) => ({ tick: w.tick, player: 0, cmd })) : [];
    step(w, sc);
  }
}

describe('footprint shapes', () => {
  it('reads the size code as the game table: squares, then bridges and gates', () => {
    expect([1, 2, 3].map((s) => [fpW(s), fpH(s)])).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect([7, 8, 9].map((s) => [fpW(s), fpH(s)])).toEqual([[3, 2], [6, 2], [9, 2]]);
    expect([4, 5, 6].map((s) => [fpW(s), fpH(s)])).toEqual([[2, 3], [2, 6], [2, 9]]);
    expect([10, 11].map((s) => [fpW(s), fpH(s)])).toEqual([[1, 4], [4, 1]]);
  });
});

describe('wall line', () => {
  it('steps the longer axis one cell at a time and floors the other', () => {
    expect(wallLine(0, 0, 5, 2)).toEqual([[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 1]]);
    expect(wallLine(0, 0, 5, -2)).toEqual([[0, 0], [1, -1], [2, -1], [3, -2], [4, -2], [5, -2]]);
    expect(wallLine(3, 3, 3, 3)).toEqual([[3, 3]]);
    // A tie goes along y.
    expect(wallLine(0, 0, 2, 2)).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
});

describe('walls', () => {
  it('pays 10 per piece as each one starts, builds them in order in 60 ticks each, and blocks the cells', () => {
    const w = world();
    const b = at(w, 5, 5);
    run(w, 1, [{ kind: 'wall', unitIds: [b.id], type: WALL.kind, fx: 4, fy: 4, tx: 8, ty: 4 }]);
    expect(b.job?.kind).toBe('wall');
    expect(bricks(w)).toBe(490); // the builder is already next to the first piece
    expect(walls(w)).toHaveLength(1);
    expect(walls(w)[0]!.progress).toBe(1); // work starts the tick it is put down
    run(w, 600);
    const ws = walls(w);
    expect(ws).toHaveLength(5);
    expect(ws.every((x) => x.progress === 60 && x.hp === 250)).toBe(true);
    expect(bricks(w)).toBe(450);
    for (let x = 4; x <= 8; x++) expect(w.grid!.cells[4 * W + x]).toBe(TERRAIN_BUILDING);
    expect(b.job).toBeNull();
  });

  it('leaves out pieces on terrain a wall cannot stand on', () => {
    const w = world();
    const b = at(w, 10, 5);
    run(w, 1, [{ kind: 'wall', unitIds: [b.id], type: WALL.kind, fx: 10, fy: 4, tx: 14, ty: 4 }]);
    expect(b.job?.kind === 'wall' && b.job.cells).toEqual([4 * W + 10, 4 * W + 11]);
  });

  it('stops when the player runs out of bricks', () => {
    const w = world(25);
    const b = at(w, 6, 5);
    run(w, 1, [{ kind: 'wall', unitIds: [b.id], type: WALL.kind, fx: 4, fy: 4, tx: 8, ty: 4 }]);
    run(w, 400);
    expect(walls(w)).toHaveLength(2);
    expect(bricks(w)).toBe(5);
    expect(b.job).toBeNull();
  });

  it('is the same on every run', () => {
    const go = () => {
      const w = world();
      const a = at(w, 6, 5), c = at(w, 7, 6);
      run(w, 1, [{ kind: 'wall', unitIds: [a.id, c.id], type: WALL.kind, fx: 3, fy: 2, tx: 9, ty: 6 }]);
      run(w, 500);
      return hashWorld(w);
    };
    expect(go()).toBe(go());
  });
});

describe('bridges', () => {
  it('fits the smallest bridge whose far end is on land', () => {
    const g = grid(); // river 6 wide: x 12..17
    expect(sizeBridge(g, 12, 8, false)).toBe(123); // medium: end at x 18 is land
    expect(sizeBridge(g, 15, 8, false)).toBe(121); // small: end at x 18
    expect(sizeBridge(g, 12, 8, true)).toBe(126); // down the river: never reaches land, so large
  });

  it('only goes on a bridge site, pays when the builder gets there, and turns the water into ground when done', () => {
    const w = world();
    const b = at(w, 10, 8);
    run(w, 1, [{ kind: 'bridge', unitIds: [b.id], type: BRIDGE_MH.kind, cx: 12, cy: 10 }]);
    expect(b.job).toBeNull(); // not a site
    run(w, 1, [{ kind: 'bridge', unitIds: [b.id], type: BRIDGE_MH.kind, cx: 12, cy: 8 }]);
    expect(b.job?.kind).toBe('bridge');
    expect(bricks(w)).toBe(500);
    run(w, 30);
    expect(bricks(w)).toBe(490);
    const br = w.units.find((u) => u.role === 17)!;
    expect(br.hp).toBeGreaterThan(1);
    expect(b.cell).toBe(-1); // inside
    expect(isWalkable(w.grid!, 14, 8)).toBe(false);
    run(w, 40);
    expect(br.progress).toBe(30);
    expect(br.hp).toBe(500);
    for (let y = 8; y < 10; y++) for (let x = 12; x < 18; x++) expect(w.grid!.cells[y * W + x]).toBe(TERRAIN_ROUGH);
    expect(isWalkable(w.grid!, 14, 8)).toBe(true);
    run(w, BRIDGE_EXIT_TICKS);
    expect(b.cell).toBe(8 * W + 18); // out past the far end of the top row
  });

  it('walkers cross a finished bridge', () => {
    const w = world();
    const b = at(w, 10, 8);
    run(w, 1, [{ kind: 'bridge', unitIds: [b.id], type: BRIDGE_MH.kind, cx: 12, cy: 8 }]);
    run(w, 120);
    const walker = at(w, 9, 9);
    run(w, 1, [{ kind: 'move', unitIds: [walker.id], x: cellCenterX(22), y: cellCenterY(9) }]);
    run(w, 400);
    expect(walker.cell).toBe(9 * W + 22);
  });

  it('a destroyed bridge turns back into water and drowns the walkers on it', () => {
    const w = world();
    const b = at(w, 10, 8);
    run(w, 1, [{ kind: 'bridge', unitIds: [b.id], type: BRIDGE_MH.kind, cx: 12, cy: 8 }]);
    run(w, 120);
    const walker = at(w, 14, 9);
    expect(walker.cell).toBe(9 * W + 14);
    const br = w.units.find((u) => u.role === 17)!;
    br.hp = 0;
    run(w, 1);
    expect(w.units.includes(walker)).toBe(false);
    expect(w.grid!.cells[9 * W + 14]).toBe(TERRAIN_WATER);
  });
});

describe('helping', () => {
  it('a builder sent to an unfinished wall helps from outside', () => {
    const w = world();
    const a = at(w, 5, 5);
    run(w, 1, [{ kind: 'wall', unitIds: [a.id], type: WALL.kind, fx: 4, fy: 4, tx: 4, ty: 4 }]);
    const piece = walls(w)[0]!;
    const b = at(w, 3, 3);
    run(w, 1, [{ kind: 'construct', unitIds: [b.id], site: piece.id }]);
    expect(b.job?.kind).toBe('wall');
    expect(b.cell).toBe(3 * W + 3); // still on the map
    run(w, 80);
    expect(piece.hp).toBe(250);
  });
});
