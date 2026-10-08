import { describe, expect, it } from 'vitest';
import {
  CHOP_TICKS, TERRAIN_BUILDING, TERRAIN_TREE, cellCenterX, cellCenterY, createWorld, getPlayer, hashWorld, placeBuilding,
  popCap, popUsed, spawnUnit, starCap, step, type Command, type EntityType, type ScheduledCommand, type TerrainGrid,
  type World,
} from '@lbw/sim';

/**
 * Economy rules against the numbers measured in the emulator (docs/re-notes/economy.md).
 * Types use the King faction's real values but are written out here; no ROM data is read.
 */
const t = (kind: number, role: number, hp: number, cost: number, buildTime: number, size: number, extra: Partial<EntityType> = {}): EntityType => ({
  kind, role, hp, cost, buildTime, size, speed: size > 1 || role >= 7 ? 0 : 410, yield: 0, priority: 0, attack: null, ...extra,
});
const BUILDER = t(2, 1, 150, 50, 150, 1);
const CASTLE = t(10, 7, 1500, 1000, 900, 3);
const LUMBER_MILL = t(11, 8, 750, 400, 540, 2);
const MINE = t(12, 9, 1250, 600, 690, 2, { yield: 25 });
const FARM = t(13, 10, 350, 75, 360, 2);
const TYPES: EntityType[] = [];
for (const x of [BUILDER, CASTLE, LUMBER_MILL, MINE, FARM]) TYPES[x.kind] = x;

const W = 24;
/** Open 24x24 map with a forest in columns 0-1. */
function grid(): TerrainGrid {
  const cells = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) cells[y * W] = cells[y * W + 1] = TERRAIN_TREE;
  return { width: W, height: W, cells };
}

function world(bricks = 500, mineSites: number[] = []): World {
  return createWorld({ seed: 7, grid: grid(), players: [{ id: 0, bricks }], types: TYPES, mineSites });
}

const at = (w: World, cx: number, cy: number) => spawnUnit(w, 0, cellCenterX(cx), cellCenterY(cy), BUILDER);

function run(w: World, ticks: number, cmds: Command[] = []): void {
  for (let i = 0; i < ticks; i++) {
    const sc: ScheduledCommand[] = i === 0 ? cmds.map((cmd) => ({ tick: w.tick, player: 0, cmd })) : [];
    step(w, sc);
  }
}

const bricks = (w: World) => getPlayer(w, 0)!.bricks;

describe('economy', () => {
  it('pays every player 5 bricks every 60 s of game time', () => {
    const w = world();
    run(w, 1799);
    expect(bricks(w)).toBe(500);
    run(w, 1);
    expect(bricks(w)).toBe(505);
    run(w, 1800);
    expect(bricks(w)).toBe(510);
  });

  it('a builder chops a tree in 150 ticks, carries 75 bricks to the castle and goes back for more', () => {
    const w = world();
    placeBuilding(w, 0, CASTLE, 4, 4);
    const b = at(w, 2, 5); // already next to the tree at (1, 5)
    run(w, 1, [{ kind: 'harvest', unitIds: [b.id], cx: 1, cy: 5 }]);
    run(w, CHOP_TICKS - 2);
    expect(b.carrying).toBe(false);
    run(w, 1);
    expect(b.carrying).toBe(true);
    expect(w.grid!.cells[5 * W + 1]).toBe(0); // one chop fells the tree
    run(w, 60);
    expect(bricks(w)).toBe(575);
    expect(b.carrying).toBe(false);
    expect(b.job?.kind).toBe('chop');
  });

  it('a finished Lumber Mill makes each load worth 100', () => {
    const w = world();
    placeBuilding(w, 0, CASTLE, 10, 10);
    placeBuilding(w, 0, LUMBER_MILL, 3, 4);
    const b = at(w, 2, 5);
    run(w, 1, [{ kind: 'harvest', unitIds: [b.id], cx: 1, cy: 5 }]);
    run(w, CHOP_TICKS + 5);
    expect(bricks(w)).toBe(600);
  });

  it('building a Farm costs 75 up front, takes 360 ticks of work, and adds 4 pop and a star', () => {
    const w = world();
    placeBuilding(w, 0, CASTLE, 10, 10);
    const b = at(w, 6, 6);
    expect(popCap(w, 0)).toBe(4);
    expect(starCap(w, 0)).toBe(0);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: FARM.kind, cx: 4, cy: 6 }]);
    expect(bricks(w)).toBe(425);
    const farm = w.units.find((u) => u.kind === FARM.kind)!;
    expect(farm.hp).toBe(1);
    expect(w.grid!.cells[6 * W + 4]).toBe(TERRAIN_BUILDING);
    run(w, 358); // the builder already stands next to the site, so work starts on the order's tick
    expect(farm.progress).toBe(359);
    expect(popCap(w, 0)).toBe(4);
    run(w, 1);
    expect(farm.progress).toBe(360);
    expect(farm.hp).toBe(350);
    expect(popCap(w, 0)).toBe(8);
    expect(starCap(w, 0)).toBe(1);
    expect(b.job).toBeNull();
  });

  it('refuses a building the player cannot afford or that does not fit', () => {
    const w = world(50);
    const b = at(w, 6, 6);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: FARM.kind, cx: 4, cy: 6 }]);
    expect(w.units).toHaveLength(1);
    const w2 = world();
    const b2 = at(w2, 6, 6);
    run(w2, 1, [{ kind: 'build', unitIds: [b2.id], type: FARM.kind, cx: 0, cy: 6 }]); // on trees
    expect(w2.units).toHaveLength(1);
    expect(bricks(w2)).toBe(500);
  });

  it('a Mine only goes on a mine site and pays 25 bricks every 75 ticks once built', () => {
    const w = world(5000, [8 * W + 8]);
    const b = at(w, 7, 7);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: MINE.kind, cx: 5, cy: 5 }]);
    expect(w.units).toHaveLength(1);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: MINE.kind, cx: 8, cy: 8 }]);
    expect(bricks(w)).toBe(4400);
    run(w, 690);
    expect(bricks(w)).toBe(4400);
    run(w, 75);
    expect(bricks(w)).toBe(4425);
    run(w, 75);
    expect(bricks(w)).toBe(4450);
  });

  it('training pays and takes the pop slot at once, and the unit walks out after its build time', () => {
    const w = world();
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    run(w, 1, [{ kind: 'train', building: castle.id, type: BUILDER.kind }]);
    expect(bricks(w)).toBe(450);
    expect(popUsed(w, 0)).toBe(1);
    expect(w.units).toHaveLength(1);
    run(w, 149);
    expect(w.units).toHaveLength(2);
    expect(popUsed(w, 0)).toBe(1);
    const u = w.units[1]!;
    // Out below the castle's middle column, as in the emulator (castle at (10,10) -> builder at (11,13)).
    expect([Math.floor(u.x / 65536 / 24), Math.floor(u.y / 65536 / 16)]).toEqual([11, 13]);
  });

  it('cannot train past the population cap', () => {
    const w = world(5000);
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    for (let i = 0; i < 4; i++) at(w, 2 + i, 20);
    run(w, 1, [{ kind: 'train', building: castle.id, type: BUILDER.kind }]);
    expect(castle.queue).toHaveLength(0);
    expect(bricks(w)).toBe(5000);
  });

  it('is deterministic: an economy replay hash is pinned', () => {
    const w = world();
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    const b = at(w, 3, 5);
    run(w, 1, [
      { kind: 'harvest', unitIds: [b.id], cx: 1, cy: 5 },
      { kind: 'train', building: castle.id, type: BUILDER.kind },
    ]);
    run(w, 900);
    expect(bricks(w)).toBeGreaterThan(450);
    expect(hashWorld(w).toString(16)).toMatchInlineSnapshot(`"f9f2bd08"`);
  });
});
