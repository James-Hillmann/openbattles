import { describe, expect, it } from 'vitest';
import {
  CHOP_TICKS, DROP_TICKS, SITE_EXIT_TICKS, MOVES_FLYING, canPlace, TERRAIN_BUILDING, isWalkable, TERRAIN_TREE, cellCenterX, cellCenterY, createWorld, getPlayer, hashWorld, placeBuilding,
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
  return createWorld({ seed: 7, grid: grid(), players: [{ id: 0, team: 0, bricks, status: 0, start: -1, reservedPop: 0, reservedStars: 0 }], types: TYPES, mineSites });
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
    // The builder works from inside the site and comes out 18 ticks after it's done, below its right column.
    expect(b.job?.kind).toBe('inside');
    expect(b.cell).toBe(-1);
    run(w, SITE_EXIT_TICKS - 1);
    expect(b.job?.kind).toBe('inside');
    run(w, 1);
    expect(b.job).toBeNull();
    expect([Math.floor(b.x / 65536 / 24), Math.floor(b.y / 65536 / 16)]).toEqual([5, 8]);
  });

  it('a builder drops off inside the castle: paid on entering, out 23 ticks later below the middle column', () => {
    const w = world();
    const castle = placeBuilding(w, 0, CASTLE, 4, 4);
    const b = at(w, 3, 7); // diagonal to the castle's corner
    b.carrying = true;
    run(w, 1, [{ kind: 'harvest', unitIds: [b.id], cx: 1, cy: 7 }]);
    expect(b.job?.kind).toBe('inside'); // arrived this tick
    expect(bricks(w)).toBe(500);
    run(w, 1);
    expect(bricks(w)).toBe(575);
    expect(b.cell).toBe(-1);
    // Inside: no orders, no targeting.
    run(w, 1, [{ kind: 'move', unitIds: [b.id], x: cellCenterX(10), y: cellCenterY(10) }]);
    expect(b.job?.kind).toBe('inside');
    run(w, DROP_TICKS - 3);
    expect(b.job?.kind).toBe('inside');
    run(w, 1);
    expect(b.job?.kind).toBe('chop');
    expect([Math.floor(b.x / 65536 / 24), Math.floor(b.y / 65536 / 16)]).toEqual([5, 7]);
    expect(castle.hp).toBe(castle.maxHp);
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

  it('buildings block walking and other buildings', () => {
    const w = world(5000);
    placeBuilding(w, 0, CASTLE, 10, 10);
    expect(isWalkable(w.grid!, 11, 11)).toBe(false);
    expect(isWalkable(w.grid!, 11, 11, MOVES_FLYING)).toBe(false);
    const b = at(w, 6, 6);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: FARM.kind, cx: 12, cy: 11 }]); // overlaps the castle
    expect(bricks(w)).toBe(5000);
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

  it('training pays and takes the pop slot when it starts, and the unit walks out after its build time', () => {
    const w = world();
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    run(w, 1, [{ kind: 'train', building: castle.id, type: BUILDER.kind }]); // tick 0: the 10-tick check starts it
    expect(bricks(w)).toBe(450);
    expect(popUsed(w, 0)).toBe(1);
    expect(w.units).toHaveLength(1);
    run(w, 149);
    expect(w.units).toHaveLength(1);
    run(w, 1);
    expect(w.units).toHaveLength(2);
    expect(popUsed(w, 0)).toBe(1);
    const u = w.units[1]!;
    // Out below the castle's middle column, as in the emulator (castle at (10,10) -> builder at (11,13)).
    expect([Math.floor(u.x / 65536 / 24), Math.floor(u.y / 65536 / 16)]).toEqual([11, 13]);
  });

  it('a building only trains its own units: the Castle makes Builders, not Swordsmen or Farms', () => {
    const w = world(5000);
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    const SWORDSMAN = t(3, 2, 350, 100, 270, 1);
    w.types[SWORDSMAN.kind] = SWORDSMAN;
    run(w, 1, [
      { kind: 'train', building: castle.id, type: SWORDSMAN.kind },
      { kind: 'train', building: castle.id, type: FARM.kind },
    ]);
    expect(castle.queue).toHaveLength(0);
    expect(bricks(w)).toBe(5000);
  });

  it("a building only makes its own faction's entities (the strip lists one faction)", () => {
    const w = world(5000);
    w.types[CASTLE.kind] = { ...CASTLE, faction: 'K' }; // the faction is read off the building's type
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    const P_BUILDER = t(22, 1, 150, 45, 150, 1, { faction: 'P' });
    const K_BUILDER = t(23, 1, 150, 50, 150, 1, { faction: 'K' });
    const P_FARM = t(24, 10, 350, 75, 360, 2, { faction: 'P' });
    for (const x of [P_BUILDER, K_BUILDER, P_FARM]) w.types[x.kind] = x;
    const builder = spawnUnit(w, 0, cellCenterX(15), cellCenterY(15), K_BUILDER);
    run(w, 1, [
      { kind: 'train', building: castle.id, type: P_BUILDER.kind },
      { kind: 'train', building: castle.id, type: K_BUILDER.kind },
      { kind: 'build', unitIds: [builder.id], type: P_FARM.kind, cx: 18, cy: 18 },
    ]);
    expect(castle.queue).toEqual([K_BUILDER.kind]);
    expect(bricks(w)).toBe(4950);
  });

  it("with a picked army, buildings train only the army's units and Builders build its base faction", () => {
    const w = world(5000);
    w.types[CASTLE.kind] = { ...CASTLE, faction: 'K' };
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    const P_BUILDER = t(22, 1, 150, 45, 150, 1, { faction: 'P' });
    const K_BUILDER = t(23, 1, 150, 50, 150, 1, { faction: 'K' });
    const P_FARM = t(24, 10, 350, 75, 360, 2, { faction: 'P' });
    const K_FARM = t(25, 10, 350, 75, 360, 2, { faction: 'K' });
    for (const x of [P_BUILDER, K_BUILDER, P_FARM, K_FARM]) w.types[x.kind] = x;
    // A King army with the Pirates' builder: the King's Castle trains it, and it builds King buildings.
    getPlayer(w, 0)!.army = { units: [0, P_BUILDER.kind, -1, -1, -1, -1, -1, -1, -1], base: 'K' };
    const builder = spawnUnit(w, 0, cellCenterX(15), cellCenterY(15), P_BUILDER);
    run(w, 1, [
      { kind: 'train', building: castle.id, type: K_BUILDER.kind },
      { kind: 'train', building: castle.id, type: P_BUILDER.kind },
      { kind: 'build', unitIds: [builder.id], type: P_FARM.kind, cx: 18, cy: 18 },
      { kind: 'build', unitIds: [builder.id], type: K_FARM.kind, cx: 18, cy: 18 },
    ]);
    expect(castle.queue).toEqual([P_BUILDER.kind]);
    expect(bricks(w)).toBe(5000 - 45 - 75);
    expect(w.units.some((u) => u.kind === K_FARM.kind)).toBe(true);
  });

  it('at the population cap the front unit waits unpaid and holds up the queue', () => {
    const w = world(5000);
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    const full = Array.from({ length: 4 }, (_, i) => at(w, 2 + i, 20));
    run(w, 1, [{ kind: 'train', building: castle.id, type: BUILDER.kind }]);
    run(w, 200);
    expect(castle.queue).toHaveLength(1);
    expect(castle.prod).toBeLessThan(0);
    expect(bricks(w)).toBe(5000);
    full[0]!.hp = 0; // a slot frees: it starts on the next tick
    run(w, 1);
    expect(castle.prod).toBe(0);
    expect(bricks(w)).toBe(4950);
  });

  it('caps pop at 20 and stars at 4 however many Farms there are', () => {
    const w = world(5000);
    for (let i = 0; i < 6; i++) placeBuilding(w, 0, FARM, 4 + 3 * i, 2);
    expect(popCap(w, 0)).toBe(20);
    expect(starCap(w, 0)).toBe(4);
  });

  it('a building queues at most 3 units, the one in training included, and pays for each as it starts', () => {
    const w = world(5000);
    placeBuilding(w, 0, FARM, 4, 2);
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    run(w, 1, Array.from({ length: 5 }, () => ({ kind: 'train' as const, building: castle.id, type: BUILDER.kind })));
    expect(castle.queue).toHaveLength(3);
    expect(bricks(w)).toBe(5000 - 50); // only the first has started
    expect(popUsed(w, 0)).toBe(1);
    run(w, 150); // the first comes out on tick 150, the next starts on tick 151
    expect(w.units.filter((u) => u.kind === BUILDER.kind)).toHaveLength(1);
    expect(castle.queue).toHaveLength(2);
    run(w, 1);
    expect(bricks(w)).toBe(5000 - 100);
  });

  it('cancelling refunds the unit in training in full; a waiting one just leaves the queue', () => {
    const w = world(5000);
    placeBuilding(w, 0, FARM, 4, 2);
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    run(w, 1, Array.from({ length: 3 }, () => ({ kind: 'train' as const, building: castle.id, type: BUILDER.kind })));
    run(w, 100);
    run(w, 1, [{ kind: 'cancel', building: castle.id, index: 2 }]);
    expect(castle.queue).toHaveLength(2);
    expect(bricks(w)).toBe(4950);
    run(w, 1, [{ kind: 'cancel', building: castle.id, index: 0 }]);
    expect(castle.queue).toHaveLength(1);
    expect(bricks(w)).toBe(5000);
    expect(popUsed(w, 0)).toBe(0);
    run(w, 10); // the next starts at the following 10-tick check
    expect(bricks(w)).toBe(4950);
    run(w, 1, [{ kind: 'cancel', building: castle.id, index: -1 }]);
    expect(castle.queue).toHaveLength(0);
    expect(bricks(w)).toBe(5000);
  });

  it('places buildings only on the terrain their flags allow; a Shipyard sits in water touching land', () => {
    const OPEN = 0b0001;
    const WATER = 0b1000;
    const farm = { ...FARM, moves: OPEN };
    const yard = t(14, 16, 750, 350, 600, 2, { moves: WATER });
    const w = world(5000);
    w.types[yard.kind] = yard;
    w.types[farm.kind] = farm;
    const g = w.grid!;
    for (let y = 10; y < 24; y++) for (let x = 14; x < 24; x++) g.cells[y * W + x] = 3; // a lake in the corner
    for (const c of [6 * W + 6, 6 * W + 7]) g.cells[c] = 2; // rough
    expect(canPlace(w, farm, 6, 6)).toBe(false); // rough under it
    expect(canPlace(w, farm, 8, 6)).toBe(true);
    expect(canPlace(w, farm, 14, 10)).toBe(false); // water
    expect(canPlace(w, yard, 8, 6)).toBe(false); // land
    expect(canPlace(w, yard, 18, 16)).toBe(false); // open water, no land next to it
    expect(canPlace(w, yard, 14, 10)).toBe(true); // in the water at the shore
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
    expect(hashWorld(w).toString(16)).toMatchInlineSnapshot(`"547797cf"`);
  });
});
