import { describe, expect, it } from 'vitest';
import {
  BRICKS_TO_WIN,
  DEFEATED,
  LOST,
  MOVES_FLYING,
  MOVES_WATER,
  PLAYING,
  WON,
  cellCenterX,
  cellCenterY,
  cellOf,
  createSkirmish,
  createWorld,
  hashWorld,
  isWalkableCode,
  orderMove,
  spawnUnit,
  startSpawns,
  step,
  terrainMask,
  type SkirmishOptions,
  type StartSpawn,
  type TerrainGrid,
  type UnitType,
  type WinMode,
  type World,
} from '@lbw/sim';

/** '.' open, 'r' rough, 'T' tree, '~' water, '#' plateau. */
function grid(rows: string[]): TerrainGrid {
  const code: Record<string, number> = { '.': 0, T: 1, r: 2, '~': 3, '#': 5 };
  return { width: rows[0]!.length, height: rows.length, cells: Uint8Array.from(rows.join(''), (c) => code[c]!) };
}

// mp01's records for slot 0 and 1, in file order (read from the map with extract's parseMap).
const MP01: StartSpawn[] = [
  [10, 10, 0, 7], [14, 11, 0, 11], [7, 13, 0, 10], [10, 13, 0, 1], [12, 13, 0, 1], [11, 15, 0, 0],
  [52, 48, 1, 0], [55, 49, 1, 10], [51, 50, 1, 1], [53, 50, 1, 1], [48, 51, 1, 11], [51, 51, 1, 7],
].map(([x, y, slot, role]) => ({ x: x!, y: y!, slot: slot!, role: role!, index: 0 }));

const OPEN64 = grid(Array.from({ length: 64 }, () => '.'.repeat(64)));

// Minimal stand-ins: what matters to the rules is role and HP.
const TYPES: Record<number, UnitType> = {
  0: { hp: 1000, speed: 410 }, // hero
  1: { hp: 150, speed: 410 }, // builder
  7: { hp: 1500, speed: 0 }, // base
  10: { hp: 350, speed: 0 }, // farm
  11: { hp: 750, speed: 0 }, // barracks
};
const opts = (mode: WinMode, prebuilt = false): SkirmishOptions => ({
  prebuilt,
  rules: { mode },
  bricks: 500,
  slots: [0, 1],
  typeFor: (_p, role) => TYPES[role] ?? null,
});

const roles = (w: World, p: number) => w.units.filter((u) => u.owner === p).map((u) => u.role);
const kill = (w: World, role: number, owner: number) => {
  for (const u of w.units) if (u.owner === owner && u.role === role) u.hp = 0;
};

describe('skirmish start', () => {
  it('without prebuilt bases keeps the first base, builder and hero (seen in the emulator on mp01)', () => {
    const s = startSpawns(MP01, [0, 1], false).filter((r) => r.player === 0);
    expect(s.map((r) => [r.role, r.x, r.y])).toEqual([[7, 10, 10], [1, 10, 13], [0, 11, 15]]);
  });

  it('with prebuilt bases spawns all six records per player', () => {
    expect(startSpawns(MP01, [0, 1], true)).toHaveLength(12);
    expect(startSpawns(MP01, [1], true).every((r) => r.slot === 1 && r.player === 0)).toBe(true);
  });

  it('puts units on their cells and the camera on the hero', () => {
    const w = createSkirmish({ seed: 1, grid: OPEN64 }, MP01, opts(0, true));
    expect(roles(w, 0)).toEqual([7, 11, 10, 1, 1, 0]);
    const builder = w.units.find((u) => u.owner === 0 && u.role === 1)!;
    expect([builder.x, builder.y]).toEqual([cellCenterX(10), cellCenterY(13)]);
    expect(w.players.map((p) => p.start)).toEqual([15 * 64 + 11, 48 * 64 + 52]);
    expect(w.players.map((p) => p.bricks)).toEqual([500, 500]);
  });
});

describe('start records on blocked cells', () => {
  // mp29, slot 0: the second builder record (12, 51) is inside the 3x3 castle at (11, 50).
  const MP29: StartSpawn[] = [
    [6, 50, 0, 10], [11, 50, 0, 7], [14, 50, 0, 11], [10, 51, 0, 1], [12, 51, 0, 1], [8, 53, 0, 0],
  ].map(([x, y, slot, role]) => ({ x: x!, y: y!, slot: slot!, role: role!, index: 0 }));
  const SIZED: Record<number, UnitType> = { ...TYPES, 7: { hp: 1500, speed: 0, size: 3 }, 10: { hp: 350, speed: 0, size: 2 }, 11: { hp: 750, speed: 0, size: 2 } };

  it('a builder whose record sits inside its castle spawns on the nearest free cell (guess)', () => {
    // Own grid: footprints are written into the grid, and OPEN64 is shared with the pinned-hash test below.
    const w = createSkirmish({ seed: 1, grid: grid(Array.from({ length: 64 }, () => '.'.repeat(64))) }, MP29, { ...opts(0, true), slots: [0], typeFor: (_p, role) => SIZED[role] ?? null });
    const builders = w.units.filter((u) => u.role === 1);
    expect(builders).toHaveLength(2);
    expect(builders.every((u) => u.cell >= 0)).toBe(true);
    const [x, y] = cellOf(builders[1]!.x, builders[1]!.y);
    // Nearest free cell by Chebyshev rings, row-major: ring 2 around (12, 51) starts at (10, 49).
    expect([x, y]).toEqual([10, 49]);
    expect(isWalkableCode(w.grid!.cells[y * 64 + x]!)).toBe(true);
  });
});

describe('win and loss', () => {
  it('"Defeat the enemy\'s Hero": losing the hero loses, the other player wins', () => {
    const w = createSkirmish({ seed: 1, grid: OPEN64 }, MP01, opts(0, true));
    kill(w, 1, 1); // builders don't matter
    step(w, []);
    expect(w.players.map((p) => p.status)).toEqual([PLAYING, PLAYING]);
    kill(w, 0, 1);
    step(w, []);
    expect(w.players.map((p) => p.status)).toEqual([WON, DEFEATED]);
  });

  it('"Defeat all enemy units": a base you can afford to use keeps you in', () => {
    const w = createSkirmish({ seed: 1, grid: OPEN64 }, MP01, opts(1, true));
    for (const r of [0, 1, 10]) kill(w, r, 1);
    step(w, []);
    expect(w.players[1]!.status).toBe(PLAYING); // base + barracks
    kill(w, 11, 1);
    step(w, []);
    expect(w.players[1]!.status).toBe(PLAYING); // base alone, 500 bricks >= 50
    w.players[1]!.bricks = 49;
    // the check runs when the player loses something; give them a unit to lose
    spawnUnit(w, 1, cellCenterX(40), cellCenterY(40), { hp: 1, role: 2 }).hp = 0;
    step(w, []);
    expect(w.players.map((p) => p.status)).toEqual([WON, DEFEATED]);
  });

  it('"Defeat all enemy units": losing the last unit and building loses', () => {
    const w = createSkirmish({ seed: 1, grid: OPEN64 }, MP01, opts(1));
    for (const r of [0, 1, 7]) kill(w, r, 0);
    step(w, []);
    expect(w.players.map((p) => p.status)).toEqual([DEFEATED, WON]);
  });

  it('"Collect 10000 LEGO Bricks": reaching it wins at once (seen in the emulator)', () => {
    const w = createSkirmish({ seed: 1, grid: OPEN64 }, MP01, opts(2));
    w.players[0]!.bricks = BRICKS_TO_WIN - 1;
    step(w, []);
    expect(w.players[0]!.status).toBe(PLAYING);
    w.players[0]!.bricks = BRICKS_TO_WIN;
    step(w, []);
    expect(w.players.map((p) => p.status)).toEqual([WON, LOST]);
  });

  it('sandbox worlds never end', () => {
    const w = createSkirmish({ seed: 1, grid: OPEN64 }, MP01, opts(0));
    w.rules = null;
    kill(w, 0, 1);
    step(w, []);
    expect(w.players.map((p) => p.status)).toEqual([PLAYING, PLAYING]);
  });

  it('is deterministic (hash pinned; update deliberately when sim rules change)', () => {
    const run = () => {
      const w = createSkirmish({ seed: 3, grid: OPEN64 }, MP01, opts(0, true));
      for (let t = 0; t < 60; t++) step(w, []);
      kill(w, 0, 0);
      step(w, []);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
    expect(run().toString(16)).toMatchInlineSnapshot(`"b6d86c4b"`);
  });
});

describe('terrain per unit type', () => {
  // Entity flags as in Entities.ebp: +0x16 open, +0x17 rough, +0x18 water, +0x19 tree.
  it('decodes the record flags like the game (0x02001510)', () => {
    const ship = terrainMask(0, 0, 1, 0);
    const gryphon = terrainMask(1, 1, 1, 1);
    expect(ship).toBe(MOVES_WATER);
    expect(gryphon).toBe(MOVES_FLYING);
    expect([0, 1, 2, 3, 4, 5].map((c) => isWalkableCode(c, ship))).toEqual([false, false, false, true, false, false]);
    expect([0, 1, 2, 3, 4, 5].map((c) => isWalkableCode(c, gryphon))).toEqual([true, true, true, true, false, false]);
  });

  const LAKE = grid(['......', '.~~~~.', '.~~~~.', '.~~~~.', '......']);

  it('a ship stays on the water', () => {
    const w = createSkirmish({ seed: 1, grid: LAKE }, [], opts(0));
    const ship = spawnUnit(w, 0, cellCenterX(1), cellCenterY(1), { speed: 600, moves: MOVES_WATER });
    orderMove(w, ship, 4 * 6 + 5); // a land cell beyond the lake
    for (let t = 0; t < 400 && ship.mv; t++) step(w, []);
    const [x, y] = cellOf(ship.x, ship.y);
    expect(LAKE.cells[y! * 6 + x!]).toBe(3);
  });

  it('a flyer crosses the lake; walkers and flyers don\'t block each other', () => {
    const w = createSkirmish({ seed: 1, grid: LAKE }, [], opts(0));
    const flyer = spawnUnit(w, 0, cellCenterX(0), cellCenterY(2), { speed: 819, moves: MOVES_FLYING, layer: 1 });
    spawnUnit(w, 1, cellCenterX(5), cellCenterY(2)); // a walker on the far shore, in the flyer's goal cell
    orderMove(w, flyer, 2 * 6 + 5);
    for (let t = 0; t < 400 && flyer.mv; t++) step(w, []);
    expect(cellOf(flyer.x, flyer.y)).toEqual([5, 2]);
  });
});

describe('ships and diagonal land', () => {
  it('slip through a one-cell diagonal line like the game does, but not a thick one', () => {
    // Confirmed in DeSmuME with the King and a poked diagonal line of water (movement.md); ships use the same code with the masks swapped.
    const sea = (thick: boolean) => grid(Array.from({ length: 12 }, (_, y) => Array.from({ length: 20 }, (_, x) => (x === y + 4 || (thick && x === y + 5) ? '.' : '~')).join('')));
    for (const thick of [false, true]) {
      const g = sea(thick);
      const w = createWorld({ seed: 1, grid: g });
      const ship = spawnUnit(w, 0, cellCenterX(3), cellCenterY(8), { moves: MOVES_WATER, speed: 400 });
      orderMove(w, ship, 3 * g.width + 16);
      for (let t = 0; t < 2000 && ship.mv; t++) step(w, []);
      const crossed = cellOf(ship.x, ship.y)[0] > 9;
      expect(crossed).toBe(!thick);
      expect(g.cells[ship.cell]).toBe(3);
    }
  });
});
