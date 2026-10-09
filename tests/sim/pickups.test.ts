import { describe, expect, it } from 'vitest';
import {
  PICKUP_HEALTH,
  PICKUP_MANA,
  PICKUP_STUD,
  addPickup,
  cellCenterX,
  cellCenterY,
  createSkirmish,
  hashWorld,
  randomSlots,
  spawnUnit,
  step,
  type SkirmishOptions,
  type StartSpawn,
  type TerrainGrid,
  type World,
} from '@lbw/sim';

const OPEN: TerrainGrid = { width: 16, height: 16, cells: new Uint8Array(256) };
const opts = (mode: 0 | 1 | 2 = 0, extra: Partial<SkirmishOptions> = {}): SkirmishOptions => ({
  prebuilt: false, rules: { mode }, bricks: 500, slots: [0, 1], typeFor: () => null, ...extra,
});
const world = (mode: 0 | 1 | 2 = 0, extra: Partial<SkirmishOptions> = {}): World =>
  createSkirmish({ seed: 1, grid: { ...OPEN, cells: new Uint8Array(256) } }, [], opts(mode, extra));
const at = (x: number, y: number) => [cellCenterX(x), cellCenterY(y)] as const;

describe('Blue Studs (0x0205F018, collected in the emulator on mp01)', () => {
  it('pay 1000 bricks to whoever steps on them, and count as bricks collected', () => {
    const w = world(0, { pickups: [{ x: 3, y: 3, item: 8 }] });
    expect(w.pickups).toHaveLength(1);
    spawnUnit(w, 1, ...at(3, 3), { role: 2 });
    step(w, []);
    expect(w.pickups).toHaveLength(0);
    expect(w.players.map((p) => p.bricks)).toEqual([500, 1500]);
    expect(w.players[1]!.stats!.bricks).toBe(1000);
  });

  it('pay 150 in a "Collect 10000 LEGO Bricks" game (500 -> 650 in the emulator)', () => {
    const w = world(2, { pickups: [{ x: 3, y: 3, item: 8 }] });
    spawnUnit(w, 0, ...at(3, 3), { role: 1 });
    step(w, []);
    expect(w.players[0]!.bricks).toBe(650);
  });

  it('stay put until someone reaches the cell; unknown blueprint indices are ignored', () => {
    const w = world(0, { pickups: [{ x: 3, y: 3, item: 8 }, { x: 5, y: 5, item: 2 }] });
    expect(w.pickups).toHaveLength(1);
    spawnUnit(w, 0, ...at(4, 3));
    step(w, []);
    expect(w.pickups).toHaveLength(1);
  });
});

describe('powerups (0x0205ED5C / 0x0205EDA0)', () => {
  it('Health adds 100 HP up to the most, and is not taken at full HP', () => {
    const w = world();
    addPickup(w, PICKUP_HEALTH, 3, 3);
    const u = spawnUnit(w, 0, ...at(3, 3), { hp: 300 });
    step(w, []);
    expect(w.pickups).toHaveLength(1);
    u.hp = 250;
    step(w, []);
    expect([u.hp, w.pickups.length]).toEqual([300, 0]);
  });

  it('Mana adds 100 charge to heroes only', () => {
    const w = world();
    addPickup(w, PICKUP_MANA, 3, 3);
    spawnUnit(w, 0, ...at(3, 3), { role: 2 });
    step(w, []);
    expect(w.pickups).toHaveLength(1);
    const hero = spawnUnit(w, 0, ...at(4, 4), { role: 0, charge: 1000 });
    hero.charge = 10;
    w.units = w.units.filter((u) => u.role === 0);
    hero.x = cellCenterX(3); hero.y = cellCenterY(3); hero.cell = 3 * 16 + 3;
    step(w, []);
    expect(w.pickups).toHaveLength(0);
    expect(hero.charge).toBeGreaterThanOrEqual(110);
  });

  it('owner-only pickups (mode 1) ignore other players', () => {
    const w = world();
    addPickup(w, PICKUP_STUD, 3, 3, 0, 1);
    spawnUnit(w, 1, ...at(3, 3));
    step(w, []);
    expect(w.pickups).toHaveLength(1);
  });

  it('pickups are part of the hash; worlds without them hash as before', () => {
    const a = world();
    const b = world();
    expect(hashWorld(a)).toBe(hashWorld(b));
    addPickup(b, PICKUP_STUD, 3, 3);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

describe('Random Start (0x020A2C48)', () => {
  const recs: StartSpawn[] = [0, 1, 2, 3].map((slot) => ({ x: slot * 3, y: 1, slot, role: 0, index: 0 }));

  it('draws distinct slots from the map\'s slots with the seeded RNG', () => {
    for (let seed = 1; seed < 40; seed++) {
      const w = createSkirmish({ seed, grid: OPEN }, [], opts());
      const s = randomSlots(w, recs, 2);
      expect(new Set(s).size).toBe(2);
      expect(s.every((x) => x >= 0 && x < 4)).toBe(true);
    }
    const draw = (seed: number) => randomSlots(createSkirmish({ seed, grid: OPEN }, [], opts()), recs, 2);
    expect(draw(7)).toEqual(draw(7));
    expect(new Set(Array.from({ length: 30 }, (_, i) => draw(i + 1).join())).size).toBeGreaterThan(1);
  });

  it('places players on the drawn slots', () => {
    const w = createSkirmish({ seed: 5, grid: { ...OPEN, cells: new Uint8Array(256) } }, recs, opts(0, { randomStart: true, typeFor: () => ({ hp: 100 }) }));
    const xs = w.units.map((u) => u.x);
    expect(new Set(xs).size).toBe(2);
  });
});

describe('score stats (records at 0x0215711C)', () => {
  it('count losses for the owner and kills for the player who dealt the last damage', () => {
    const w = world();
    const a = spawnUnit(w, 0, ...at(2, 2), { role: 2 });
    const b = spawnUnit(w, 0, ...at(4, 4), { role: 10, speed: 0 });
    a.hp = 0; a.lastHitBy = 1;
    b.hp = 0; b.lastHitBy = -1;
    step(w, []);
    expect(w.players[0]!.stats!.lost).toEqual([1, 0, 1]);
    expect(w.players[1]!.stats!.destroyed).toEqual([1, 0, 0]);
  });

  it('starting units are not counted as built', () => {
    const recs: StartSpawn[] = [{ x: 2, y: 2, slot: 0, role: 1, index: 0 }];
    const w = createSkirmish({ seed: 1, grid: { ...OPEN, cells: new Uint8Array(256) } }, recs, opts(0, { typeFor: () => ({ hp: 100 }) }));
    expect(w.units).toHaveLength(1);
    expect(w.players[0]!.stats!.built).toEqual([0, 0, 0]);
  });
});
