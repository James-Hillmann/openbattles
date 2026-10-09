import { describe, expect, it } from 'vitest';
import {
  addAi, createSkirmish, hashWorld, step, TERRAIN_TREE, type Command, type EntityType, type StartSpawn, type TerrainGrid, type World,
} from '@lbw/sim';

/**
 * The computer opponent (docs/re-notes/ai.md) on a made-up map with made-up types; no ROM data is
 * read. These check that it plays (builders, lumber, buildings, soldiers, an attack) and stays
 * deterministic, not the game's exact timings, which tools/ai/run.ts compares on real maps.
 */
const t = (kind: number, role: number, hp: number, cost: number, buildTime: number, size: number, extra: Partial<EntityType> = {}): EntityType => ({
  kind, role, hp, cost, buildTime, size, speed: size > 1 || role >= 7 ? 0 : 410, yield: 0, priority: 10, attack: null, faction: 'K', ...extra,
});
const hit = (damage: number) => ({ damage, damageRand: 0, cooldown: 30, minRange: 0, maxRange: 1, sight: 6, projectile: null });
const HERO = t(1, 0, 1000, 0, 0, 1, { attack: hit(40), priority: 30 });
const BUILDER = t(2, 1, 150, 50, 150, 1, { priority: 1 });
const SWORD = t(3, 2, 200, 100, 200, 1, { attack: hit(20), priority: 12 });
const CASTLE = t(10, 7, 1500, 1000, 900, 3);
const MILL = t(11, 8, 750, 400, 540, 2);
const MINE = t(12, 9, 1250, 600, 690, 2, { yield: 25 });
const FARM = t(13, 10, 350, 75, 360, 2);
const BARRACKS = t(14, 11, 750, 300, 600, 2);
const TYPES: EntityType[] = [];
for (const x of [HERO, BUILDER, SWORD, CASTLE, MILL, MINE, FARM, BARRACKS]) TYPES[x.kind] = x;

const N = 48;
/** Open 48x48 map, a forest strip near each corner base. */
function grid(): TerrainGrid {
  const cells = new Uint8Array(N * N);
  for (let y = 2; y < 18; y++) for (const x of [1, 2, N - 3, N - 2]) cells[y * N + x] = TERRAIN_TREE;
  for (let y = N - 18; y < N - 2; y++) for (const x of [1, 2, N - 3, N - 2]) cells[y * N + x] = TERRAIN_TREE;
  return { width: N, height: N, cells };
}
const STARTS: StartSpawn[] = [
  [8, 8, 0, 7], [9, 12, 0, 1], [10, 13, 0, 0],
  [36, 36, 1, 7], [37, 40, 1, 1], [38, 41, 1, 0],
].map(([x, y, slot, role]) => ({ x: x!, y: y!, slot: slot!, role: role!, index: 0 }));
const MARKS = [5 * N + 3, 40 * N + 44];

function world(seed = 5): World {
  const byRole = (role: number) => TYPES.find((x) => x?.role === role) ?? null;
  return createSkirmish({ seed, grid: grid(), types: TYPES, mineSites: [] }, STARTS, {
    prebuilt: false, rules: { mode: 0 }, bricks: 500, slots: [0, 1],
    armies: [0, 1].map(() => ({ units: [HERO.kind, BUILDER.kind, SWORD.kind], base: 'K' })),
    typeFor: (_p, role) => byRole(role),
  });
}

const owned = (w: World, p: number, role: number) => w.units.filter((u) => u.owner === p && u.role === role && u.hp > 0);

describe('computer opponent', () => {
  it('gets the 100 bonus bricks', () => {
    const w = world();
    addAi(w, 1, 0);
    expect(w.players[1]!.bricks).toBe(600);
    expect(w.players[0]!.bricks).toBe(500);
  });

  it('trains builders, chops wood, builds a barracks and a farm, and trains soldiers', () => {
    const w = world();
    addAi(w, 1, 0, MARKS);
    for (let i = 0; i < 4000; i++) step(w, []);
    expect(owned(w, 1, 1).length).toBeGreaterThanOrEqual(3);
    expect(owned(w, 1, 11).length).toBeGreaterThanOrEqual(1);
    expect(owned(w, 1, 10).length).toBeGreaterThanOrEqual(1);
    expect(w.units.some((u) => u.owner === 1 && u.role === 2)).toBe(true);
    // Player 0 did nothing and is untouched by the AI's economy.
    expect(owned(w, 0, 1).length).toBe(1);
  });

  it('two computers play the same game twice from the same seed', () => {
    const run = (seed: number) => {
      const w = world(seed);
      addAi(w, 0, 1, MARKS);
      addAi(w, 1, 0, MARKS);
      const hashes: number[] = [];
      for (let i = 0; i < 3000; i++) {
        step(w, []);
        if (i % 500 === 0) hashes.push(hashWorld(w));
      }
      return hashes;
    };
    expect(run(9)).toEqual(run(9));
    expect(run(9)).not.toEqual(run(10));
  });

  it('only gives commands for its own units', async () => {
    const { aiStep } = await import('@lbw/sim');
    const w = world();
    const ai = addAi(w, 1, 0, MARKS);
    for (let i = 0; i < 2000; i++) {
      const cmds: Command[] = aiStep(w, ai);
      for (const cmd of cmds) {
        const ids = 'unitIds' in cmd ? cmd.unitIds : 'unitId' in cmd ? [cmd.unitId as number] : [];
        for (const id of ids) expect(w.units.find((u) => u.id === id)?.owner).toBe(1);
      }
      w.ai = []; // stop step() running it a second time this tick
      step(w, cmds.map((cmd) => ({ tick: w.tick, player: 1, cmd })));
      w.ai = [ai];
    }
  });
});
