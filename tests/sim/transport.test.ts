import { describe, expect, it } from 'vitest';
import {
  MOVES_FLYING, MOVES_GROUND, MOVES_WATER, cellCenterX, cellCenterY, createWorld, exitCell, hashWorld, isInside, spawnUnit, step,
  type Command, type ScheduledCommand, type TerrainGrid, type Unit, type UnitType, type World,
} from '@lbw/sim';

/**
 * Transports against the ARM9 trace and the emulator (docs/re-notes/transports.md).
 * Map: land in columns 0-9, water from column 10 on.
 */
const W = 24;
const WATER = 3;
function grid(): TerrainGrid {
  const cells = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 10; x < W; x++) cells[y * W + x] = WATER;
  return { width: W, height: W, cells };
}
const world = (): World => createWorld({ seed: 3, grid: grid() });

const SHIP: UnitType = { kind: 9, role: 5, hp: 850, speed: 300, size: 2, moves: MOVES_WATER };
const HERO: UnitType = { kind: 0, role: 0, hp: 1000, speed: 410 };
const BUILDER: UnitType = { kind: 2, role: 1, hp: 150, speed: 410 };
const SWORD: UnitType = { kind: 3, role: 2, hp: 200, speed: 410 };
const CATAPULT: UnitType = { kind: 7, role: 6, hp: 300, speed: 200 };
const GRYPHON: UnitType = { kind: 8, role: 6, hp: 300, speed: 500, size: 2, moves: MOVES_FLYING, layer: 1 };

const put = (w: World, t: UnitType, cx: number, cy: number, owner = 0): Unit => spawnUnit(w, owner, cellCenterX(cx), cellCenterY(cy), t);
const cellOf = (u: Unit) => [Math.floor(u.x / (24 << 16)), Math.floor(u.y / (16 << 16))];

function run(w: World, ticks: number, cmds: Command[] = [], player = 0): void {
  for (let i = 0; i < ticks; i++) {
    const sc: ScheduledCommand[] = i === 0 ? cmds.map((cmd) => ({ tick: w.tick, player, cmd })) : [];
    step(w, sc);
  }
}

describe('transports', () => {
  it('takes 4 minifigures and 2 specials; the rest give up', () => {
    const w = world();
    const ship = put(w, SHIP, 10, 8);
    const figs = [put(w, HERO, 9, 7), put(w, BUILDER, 9, 8), put(w, SWORD, 9, 9), put(w, SWORD, 9, 10), put(w, SWORD, 8, 8)];
    const specials = [put(w, CATAPULT, 8, 6), put(w, CATAPULT, 7, 9), put(w, CATAPULT, 7, 7)];
    run(w, 200, [{ kind: 'load', unitIds: [...figs, ...specials].map((u) => u.id), transport: ship.id }]);
    const aboard = (us: Unit[]) => us.filter((u) => u.carrier === ship.id).length;
    expect(aboard(figs)).toBe(4);
    expect(aboard(specials)).toBe(2);
    expect(ship.cargo).toHaveLength(6);
    for (const u of [...figs, ...specials]) expect(u.board).toBeNull();
  });

  it('a unit next to the ship boards on the next tick; others walk over first', () => {
    const w = world();
    const ship = put(w, SHIP, 10, 8);
    const near = put(w, HERO, 9, 9);
    const far = put(w, SWORD, 2, 8);
    run(w, 1, [{ kind: 'load', unitIds: [near.id, far.id], transport: ship.id }]);
    expect(near.carrier).toBe(ship.id);
    expect(isInside(near)).toBe(true);
    expect(near.cell).toBe(-1);
    expect(far.carrier).toBe(0);
    run(w, 300);
    expect(far.carrier).toBe(ship.id);
    expect(ship.cargo).toEqual([near.id, far.id]);
  });

  it('nothing that can sail or fly boards, and only your own transport', () => {
    const w = world();
    const ship = put(w, SHIP, 10, 8);
    const other = put(w, SHIP, 10, 12);
    const gryphon = put(w, GRYPHON, 8, 8);
    const enemyShip = put(w, SHIP, 10, 4, 1);
    const hero = put(w, HERO, 9, 4);
    run(w, 60, [
      { kind: 'load', unitIds: [gryphon.id, other.id], transport: ship.id },
      { kind: 'load', unitIds: [hero.id], transport: enemyShip.id },
    ]);
    expect(ship.cargo).toEqual([]);
    expect(enemyShip.cargo).toEqual([]);
    expect(hero.carrier).toBe(0);
  });

  it('riders move with the ship and get off on the game ring order, lowest id first', () => {
    const w = world();
    const ship = put(w, SHIP, 10, 8);
    const a = put(w, BUILDER, 9, 9);
    const b = put(w, HERO, 9, 8);
    const c = put(w, SWORD, 9, 10);
    const d = put(w, SWORD, 9, 7);
    run(w, 1, [{ kind: 'load', unitIds: [b.id, a.id, c.id, d.id], transport: ship.id }]);
    expect(ship.cargo).toHaveLength(4);
    run(w, 400, [{ kind: 'move', unitIds: [ship.id], x: cellCenterX(10), y: cellCenterY(4) }]);
    expect(cellOf(ship)).toEqual([10, 4]);
    expect([a.x, a.y]).toEqual([ship.x, ship.y]);
    run(w, 1, [{ kind: 'unload', transports: [ship.id] }]);
    expect(ship.cargo).toEqual([]);
    // Ring 0 round the 2x2 at (10, 4): above-left (9, 3), below-left (9, 6), then the left side (9, 4);
    // the right side and the rest of ring 0 are water, so ring 1 starts at (8, 2).
    expect([a, b, c, d].map(cellOf)).toEqual([[9, 3], [9, 6], [9, 4], [8, 2]]);
    for (const u of [a, b, c, d]) expect(u.cell).toBe(cellOf(u)[1]! * W + cellOf(u)[0]!);
  });

  it('exit cells reach four rings out, even onto an island, and none further', () => {
    const w = world();
    const ship = put(w, SHIP, 16, 10);
    const hero = put(w, HERO, 9, 10);
    expect(exitCell(w, ship, hero)).toBe(-1);
    w.grid!.cells[6 * W + 12] = 0; // an islet in ring 3 (top-left corner is (12, 6))
    expect(exitCell(w, ship, hero)).toBe(6 * W + 12);
    w.grid!.cells[6 * W + 12] = WATER;
    w.grid!.cells[5 * W + 11] = 0; // ring 4: too far
    expect(exitCell(w, ship, hero)).toBe(-1);
  });

  it('unloading in open water leaves everyone aboard', () => {
    const w = world();
    const ship = put(w, SHIP, 10, 8);
    const hero = put(w, HERO, 9, 8);
    run(w, 1, [{ kind: 'load', unitIds: [hero.id], transport: ship.id }]);
    run(w, 600, [{ kind: 'move', unitIds: [ship.id], x: cellCenterX(18), y: cellCenterY(8) }]);
    run(w, 1, [{ kind: 'unload', transports: [ship.id] }]);
    expect(hero.carrier).toBe(ship.id);
  });

  it('a sinking ship puts riders ashore, or takes them down with it in open water', () => {
    const near = world();
    const s1 = put(near, SHIP, 10, 8);
    const h1 = put(near, HERO, 9, 8);
    run(near, 1, [{ kind: 'load', unitIds: [h1.id], transport: s1.id }]);
    s1.hp = 0;
    run(near, 1);
    expect(near.units.includes(h1)).toBe(true);
    expect(h1.carrier).toBe(0);
    expect(cellOf(h1)).toEqual([9, 7]);

    const far = world();
    const s2 = put(far, SHIP, 10, 8);
    const h2 = put(far, HERO, 9, 8);
    const b2 = put(far, BUILDER, 9, 9);
    run(far, 1, [{ kind: 'load', unitIds: [h2.id, b2.id], transport: s2.id }]);
    run(far, 600, [{ kind: 'move', unitIds: [s2.id], x: cellCenterX(18), y: cellCenterY(8) }]);
    s2.hp = 0;
    run(far, 1);
    expect(far.units).toHaveLength(0);
  });

  it('riders can not be attacked or ordered about', () => {
    const w = world();
    const ship = put(w, SHIP, 10, 8);
    const hero = put(w, HERO, 9, 8);
    const foe = put(w, SWORD, 5, 8, 1);
    run(w, 1, [{ kind: 'load', unitIds: [hero.id], transport: ship.id }]);
    run(w, 1, [{ kind: 'attack', unitIds: [foe.id], target: hero.id }], 1);
    expect(foe.target).toBeNull();
    run(w, 30, [{ kind: 'move', unitIds: [hero.id], x: cellCenterX(2), y: cellCenterY(2) }]);
    expect(hero.carrier).toBe(ship.id);
    expect(hero.mv).toBeNull();
  });

  it('a new order cancels boarding, and the same commands give the same hash', () => {
    const go = () => {
      const w = world();
      const ship = put(w, SHIP, 10, 8);
      const sw = put(w, SWORD, 2, 8);
      const hero = put(w, HERO, 3, 3);
      run(w, 5, [{ kind: 'load', unitIds: [sw.id, hero.id], transport: ship.id }]);
      run(w, 5, [{ kind: 'move', unitIds: [sw.id], x: cellCenterX(2), y: cellCenterY(14) }]);
      expect(sw.board).toBeNull();
      run(w, 300);
      expect(sw.carrier).toBe(0);
      expect(hero.carrier).toBe(ship.id);
      return hashWorld(w);
    };
    expect(go()).toBe(go());
  });

  it('ground units still default to walking terrain', () => {
    expect(MOVES_GROUND & MOVES_WATER).toBe(0);
  });
});
