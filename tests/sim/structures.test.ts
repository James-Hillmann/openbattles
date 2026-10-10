import { describe, expect, it } from 'vitest';
import {
  MAX_BUILDINGS, MAX_TOWERS, TERRAIN_BUILDING, atBuildLimit, cellCenterX, cellCenterY, createWorld, getPlayer, hashWorld, missingPrerequisites,
  placeBuilding, sanitizeCommand, spawnUnit, step, type Command, type EntityType, type ScheduledCommand, type TerrainGrid, type World,
} from '@lbw/sim';

/**
 * Tower upgrades, repair and build prerequisites against the emulator (docs/re-notes/structures.md).
 * King values written out here; no ROM data is read.
 */
const t = (kind: number, role: number, hp: number, cost: number, buildTime: number, size: number, extra: Partial<EntityType> = {}): EntityType => ({
  kind, role, hp, cost, buildTime, size, speed: role >= 7 ? 0 : 410, yield: 0, priority: 0, attack: null, faction: 'K', ...extra,
});
const KING = t(0, 0, 1000, 500, 600, 1);
const BUILDER = t(2, 1, 150, 50, 150, 1);
const CASTLE = t(10, 7, 1500, 1000, 900, 3);
const FARM = t(13, 10, 350, 75, 360, 2);
const BARRACKS = t(14, 11, 750, 200, 750, 2);
const STABLES = t(15, 12, 1000, 350, 1000, 2);
const TOWER = t(16, 13, 400, 300, 420, 1);
const TOWER2 = t(17, 14, 500, 500, 840, 1);
const TOWER3 = t(18, 15, 700, 800, 1260, 1);
const SHIPYARD = t(19, 16, 1000, 350, 1000, 2);
const W_TOWER2 = t(37, 14, 520, 500, 840, 1, { faction: 'W' });
const TYPES: EntityType[] = [];
for (const x of [KING, BUILDER, CASTLE, FARM, BARRACKS, STABLES, W_TOWER2, TOWER, TOWER2, TOWER3, SHIPYARD]) TYPES[x.kind] = x;

const N = 40;
function world(bricks = 5000): World {
  const grid: TerrainGrid = { width: N, height: N, cells: new Uint8Array(N * N) };
  return createWorld({ seed: 3, grid, players: [{ id: 0, team: 0, bricks, status: 0, start: -1, reservedPop: 0, reservedStars: 0 }], types: TYPES });
}
const at = (w: World, type: EntityType, cx: number, cy: number) => spawnUnit(w, 0, cellCenterX(cx), cellCenterY(cy), type);
const bricks = (w: World) => getPlayer(w, 0)!.bricks;

function run(w: World, ticks: number, cmds: Command[] = []): void {
  for (let i = 0; i < ticks; i++) {
    const sc: ScheduledCommand[] = i === 0 ? cmds.map((cmd) => ({ tick: w.tick, player: 0, cmd })) : [];
    step(w, sc);
  }
}
const ofRole = (w: World, role: number) => w.units.filter((u) => u.role === role);

describe('build prerequisites', () => {
  it('a Stables or Shipyard needs a finished Barracks and a finished Farm', () => {
    const w = world();
    const b = at(w, BUILDER, 2, 2);
    expect(missingPrerequisites(w, 0, STABLES)).toEqual([11, 10]);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: STABLES.kind, cx: 10, cy: 10 }]);
    expect(ofRole(w, 12)).toHaveLength(0);
    expect(bricks(w)).toBe(5000);

    placeBuilding(w, 0, FARM, 20, 20);
    placeBuilding(w, 0, BARRACKS, 24, 20, false); // still a site: doesn't count
    expect(missingPrerequisites(w, 0, SHIPYARD)).toEqual([11]);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: STABLES.kind, cx: 10, cy: 10 }]);
    expect(ofRole(w, 12)).toHaveLength(0);

    placeBuilding(w, 0, BARRACKS, 28, 20);
    expect(missingPrerequisites(w, 0, STABLES)).toEqual([]);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: STABLES.kind, cx: 10, cy: 10 }]);
    run(w, 200); // walk there; the site goes down on arrival
    expect(ofRole(w, 12)).toHaveLength(1);
    expect(bricks(w)).toBe(5000 - 350);
  });

  it('caps a player at 7 towers and 14 other buildings, sites included', () => {
    const w = world(100000);
    for (let i = 0; i < MAX_TOWERS - 1; i++) placeBuilding(w, 0, TOWER, 2 + 2 * i, 30);
    expect(atBuildLimit(w, 0, TOWER)).toBe(false);
    placeBuilding(w, 0, TOWER3, 30, 30, false);
    expect(atBuildLimit(w, 0, TOWER)).toBe(true);
    const b = at(w, BUILDER, 2, 2);
    run(w, 1, [{ kind: 'build', unitIds: [b.id], type: TOWER.kind, cx: 10, cy: 10 }]);
    expect(w.units.filter((u) => u.role >= 13 && u.role <= 15)).toHaveLength(MAX_TOWERS);

    // Towers don't count toward the other limit.
    expect(atBuildLimit(w, 0, FARM)).toBe(false);
    for (let i = 0; i < MAX_BUILDINGS; i++) placeBuilding(w, 0, FARM, 2 + 2 * (i % 7), 4 + 3 * Math.floor(i / 7));
    expect(atBuildLimit(w, 0, FARM)).toBe(true);
    expect(atBuildLimit(w, 0, CASTLE)).toBe(true);
  });
});

describe('tower upgrades', () => {
  it('pays the next level at once, takes its build time and carries the damage over', () => {
    const w = world();
    const tower = placeBuilding(w, 0, TOWER, 10, 10);
    tower.hp = 300;
    run(w, 1, [{ kind: 'upgrade', building: tower.id }]);
    expect(bricks(w)).toBe(4500);
    run(w, TOWER2.buildTime - 2);
    expect(w.units).toContain(tower);
    run(w, 1); // the emulator: ordered at tick 2992, swapped at tick 3831
    expect(w.units).not.toContain(tower);
    const [t2] = ofRole(w, 14);
    expect(t2!.kind).toBe(TOWER2.kind); // its own faction's Tower II, not the Wizard's
    expect([t2!.hp, t2!.maxHp]).toEqual([400, 500]);
    expect(w.grid!.cells[10 * N + 10]).toBe(TERRAIN_BUILDING);
    expect(t2!.id).toBeGreaterThan(tower.id);

    const before = bricks(w);
    run(w, 1, [{ kind: 'upgrade', building: t2!.id }]);
    expect(bricks(w)).toBe(before - 800);
    run(w, TOWER3.buildTime);
    expect(ofRole(w, 15)[0]!.hp).toBe(600);
    // Tower III is the last level.
    const left = bricks(w);
    run(w, 1, [{ kind: 'upgrade', building: ofRole(w, 15)[0]!.id }]);
    expect(bricks(w)).toBe(left);
  });

  it('needs the bricks, a finished tower and no upgrade already running', () => {
    const w = world(499);
    const tower = placeBuilding(w, 0, TOWER, 10, 10);
    run(w, 1, [{ kind: 'upgrade', building: tower.id }]);
    expect(tower.queue).toEqual([]);
    getPlayer(w, 0)!.bricks = 2000;
    const site = placeBuilding(w, 0, TOWER, 12, 10, false);
    run(w, 1, [{ kind: 'upgrade', building: site.id }, { kind: 'upgrade', building: tower.id }, { kind: 'upgrade', building: tower.id }]);
    expect(site.queue).toEqual([]);
    expect(tower.queue).toEqual([TOWER2.kind]);
    expect(bricks(w)).toBe(1500);
  });

  it('cancelling the upgrade refunds its full price (0x020733DC)', () => {
    const w = world();
    const tower = placeBuilding(w, 0, TOWER, 10, 10);
    run(w, 100, [{ kind: 'upgrade', building: tower.id }]);
    expect(bricks(w)).toBe(4500);
    run(w, 1, [{ kind: 'cancel', building: tower.id, index: 0 }]);
    expect(bricks(w)).toBe(5000);
    expect(tower.queue).toEqual([]);
    run(w, TOWER2.buildTime);
    expect(ofRole(w, 14)).toHaveLength(0);
  });
});

describe('repair', () => {
  it('a Builder repairs 100 HP of a Tower II for 50 bricks, 2 HP per brick, as in the emulator', () => {
    const w = world();
    const tower = placeBuilding(w, 0, TOWER2, 10, 10);
    tower.hp = 400;
    const b = at(w, BUILDER, 9, 11); // already next to it
    const steps: number[] = [];
    run(w, 1, [{ kind: 'repair', unitIds: [b.id], target: tower.id }]);
    for (let i = 0; i < 200 && tower.hp < 500; i++) {
      const before = tower.hp;
      run(w, 1);
      if (tower.hp !== before) steps.push(w.tick);
    }
    expect(tower.hp).toBe(500);
    expect(bricks(w)).toBe(4950);
    expect(steps).toHaveLength(50);
    // Emulator: a step every 3 or 4 ticks (3, 4, 3, 3, 4, ...), 165 ticks from the first to the last.
    expect(steps.slice(1, 9).map((s, i) => s - steps[i]!)).toEqual([3, 4, 3, 3, 4, 3, 3, 4]);
    expect(steps[49]! - steps[0]!).toBe(165);
    run(w, 1);
    expect(b.job).toBeNull();
  });

  it('heroes repair too; other units, sites and full buildings are refused', () => {
    const w = world();
    const castle = placeBuilding(w, 0, CASTLE, 10, 10);
    castle.hp = 1000;
    const king = at(w, KING, 5, 5);
    const site = placeBuilding(w, 0, FARM, 20, 20, false);
    const full = placeBuilding(w, 0, FARM, 24, 20);
    const b = at(w, BUILDER, 6, 6);
    run(w, 1, [
      { kind: 'repair', unitIds: [b.id], target: site.id },
      { kind: 'repair', unitIds: [b.id], target: full.id },
    ]);
    expect(b.job).toBeNull();
    run(w, 1, [{ kind: 'repair', unitIds: [king.id], target: castle.id }]);
    expect(king.job?.kind).toBe('repair');
    run(w, 400);
    expect(castle.hp).toBeGreaterThan(1000);
    expect(bricks(w)).toBeLessThan(5000);
  });

  it('stops paying and healing while the player is out of bricks', () => {
    const w = world(0);
    const tower = placeBuilding(w, 0, TOWER2, 10, 10);
    tower.hp = 400;
    const b = at(w, BUILDER, 9, 11);
    run(w, 100, [{ kind: 'repair', unitIds: [b.id], target: tower.id }]);
    expect(tower.hp).toBe(400);
    expect(b.job?.kind).toBe('repair');
    getPlayer(w, 0)!.bricks = 10;
    run(w, 40);
    expect(tower.hp).toBeGreaterThan(400);
  });

  it('round-trips the new orders through the wire format and hashes repair state', () => {
    expect(sanitizeCommand({ kind: 'upgrade', building: 5, x: 1 })).toEqual({ kind: 'upgrade', building: 5 });
    expect(sanitizeCommand({ kind: 'repair', unitIds: [1, 2], target: 9 })).toEqual({ kind: 'repair', unitIds: [1, 2], target: 9 });
    expect(sanitizeCommand({ kind: 'repair', unitIds: 'x', target: 9 })).toBeNull();
    const a = world();
    const b = world();
    for (const w of [a, b]) {
      const tower = placeBuilding(w, 0, TOWER2, 10, 10);
      tower.hp = 400;
      at(w, BUILDER, 9, 11);
    }
    run(a, 2, [{ kind: 'repair', unitIds: [a.units[1]!.id], target: a.units[0]!.id }]);
    run(b, 2);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});
