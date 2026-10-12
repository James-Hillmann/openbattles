import { describe, expect, it } from 'vitest';
import { addAi, createSkirmish, hashWorld, step, TERRAIN_WATER, type EntityType, type StartSpawn, type TerrainGrid, type World } from '@lbw/sim';

/**
 * CPU ferries (docs/re-notes/ai.md "Ferries") on a made-up map: two islands with a strait between them, a
 * squad on the CPU's island sent to a goal on the other one, and a transport in the water.
 */
const t = (kind: number, role: number, hp: number, size: number, extra: Partial<EntityType> = {}): EntityType => ({
  kind, role, hp, cost: 100, buildTime: 200, size, speed: size > 1 || role >= 7 ? 0 : 410, yield: 0, priority: 10, attack: null, faction: 'K', ...extra,
});
const HERO = t(1, 0, 1000, 1, { priority: 30 });
const BUILDER = t(2, 1, 150, 1, { priority: 1 });
const SWORD = t(3, 2, 200, 1, { priority: 12 });
const SHIP = t(4, 5, 850, 1, { moves: 0b1000 });
const CASTLE = t(10, 7, 1500, 3);
const TYPES: EntityType[] = [];
for (const x of [HERO, BUILDER, SWORD, SHIP, CASTLE]) TYPES[x.kind] = x;

const N = 48;
/** Land west of x = 20 and east of x = 27, water between. */
function grid(): TerrainGrid {
  const cells = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 20; x < 28; x++) cells[y * N + x] = TERRAIN_WATER;
  return { width: N, height: N, cells };
}
const regions = Array.from({ length: N * N }, (_, i) => (i % N < 20 ? 1 : i % N < 28 ? 0 : 2));
/** Shipyard markers (MARK type 6) on each shore. */
const SHIP_MARKS = [24 * N + 19, 10 * N + 19, 24 * N + 28, 36 * N + 28];
const STARTS: StartSpawn[] = [
  [38, 8, 0, 7], [40, 12, 0, 1], [41, 13, 0, 0],
  [6, 36, 1, 7], [8, 40, 1, 1],
].map(([x, y, slot, role]) => ({ x: x!, y: y!, slot: slot!, role: role!, index: 0 }));

function world(): World {
  const byRole = (role: number) => TYPES.find((x) => x?.role === role) ?? null;
  const w = createSkirmish({ seed: 9, grid: grid(), types: TYPES, mineSites: [] }, STARTS, {
    prebuilt: false, rules: { mode: 0 }, bricks: 0, slots: [0, 1],
    armies: [0, 1].map(() => ({ units: [HERO.kind, BUILDER.kind, SWORD.kind, SHIP.kind], base: 'K' })),
    typeFor: (_p, role) => byRole(role),
  });
  return w;
}

/** Add a unit of `type` for `owner` at a cell, the way the world spawns them. */
function put(w: World, owner: number, type: EntityType, x: number, y: number): number {
  const id = w.units.reduce((m, u) => Math.max(m, u.id), 0) + 1;
  const proto = w.units.find((u) => u.owner === owner && u.role === 1)!;
  const u = structuredClone(proto);
  Object.assign(u, {
    id, kind: type.kind, role: type.role, hp: type.hp, maxHp: type.hp, moves: type.moves ?? 0b0101, priority: type.priority,
    x: (x * 24 + 12) * 65536, y: (y * 16 + 8) * 65536, tx: null, ty: null, path: [], job: null, cargo: [], board: null, carrier: 0,
  });
  w.units.push(u);
  return id;
}

describe('computer ferries', () => {
  it('ferries a squad across the strait to its goal', () => {
    const w = world();
    const ai = addAi(w, 1, 0, [], [], SHIP_MARKS, regions);
    const swords = [put(w, 1, SWORD, 12, 22), put(w, 1, SWORD, 13, 23), put(w, 1, SWORD, 12, 24)];
    put(w, 1, SHIP, 22, 30);
    const goal = 20 * N + 36;
    ai.targets.push({ id: 50, cat: 0, cell: goal, radius: 4, required: 1, prio: 80, born: 0 });
    ai.squads.push({ id: 60, state: 2, prev: 12, timer: 0, units: swords, job: 5, jobState: 0, target: 50, goal: -1, last: -1, need: 1, strength: 0, ferryNeed: 0, ferry: -1, ferryLoad: -1, ferryDrop: -1 });
    let asked = false;
    let across = 0;
    for (let i = 0; i < 6000 && across < swords.length; i++) {
      step(w, []);
      if (ai.ferries.length) asked = true;
      across = swords.filter((id) => {
        const u = w.units.find((v) => v.id === id && v.hp > 0);
        return u && u.carrier === 0 && Math.floor(u.x / 65536 / 24) >= 28;
      }).length;
    }
    expect(asked).toBe(true);
    expect(across).toBe(swords.length);
  });

  it('plays the same ferry twice from the same seed', () => {
    const run = () => {
      const w = world();
      const ai = addAi(w, 1, 0, [], [], SHIP_MARKS, regions);
      const swords = [put(w, 1, SWORD, 12, 22), put(w, 1, SWORD, 13, 23)];
      put(w, 1, SHIP, 22, 30);
      ai.targets.push({ id: 50, cat: 0, cell: 20 * N + 36, radius: 4, required: 1, prio: 80, born: 0 });
      ai.squads.push({ id: 60, state: 2, prev: 12, timer: 0, units: swords, job: 5, jobState: 0, target: 50, goal: -1, last: -1, need: 1, strength: 0, ferryNeed: 0, ferry: -1, ferryLoad: -1, ferryDrop: -1 });
      for (let i = 0; i < 3000; i++) step(w, []);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});
