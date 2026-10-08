import { describe, expect, it } from 'vitest';
import {
  CELL_H,
  CELL_W,
  createWorld,
  fx,
  hashWorld,
  meleeBonus,
  replay,
  spawnUnit,
  step,
  type AttackStats,
  type InputLog,
  type MeleeBonusTable,
  type UnitType,
  type World,
} from '@lbw/sim';

// Values as they appear in Entities.ebp for a few King units (see docs/re-notes/combat.md).
const melee = (damage: number, damageRand: number, cooldown: number): AttackStats => ({
  damage, damageRand, cooldown, minRange: 1, maxRange: 1, sight: 5, projectile: null,
});
const SWORDSMAN: UnitType = { kind: 3, speed: 410, hp: 350, priority: 15, attack: melee(10, 5, 30) };
const KING: UnitType = { kind: 0, speed: 410, hp: 1000, priority: 30, attack: melee(40, 10, 20) };
const ARROW = { speed: 2048, minDamage: 15, maxDamage: 20, splash: false };
const ARCHER: UnitType = {
  kind: 4, speed: 478, hp: 300, priority: 18,
  attack: { damage: 0, damageRand: 0, cooldown: 24, minRange: 1, maxRange: 5, sight: 7, projectile: ARROW },
};
const BOULDER = { speed: 1092, minDamage: 50, maxDamage: 60, splash: true };
const CATAPULT: UnitType = {
  kind: 8, speed: 273, hp: 300, priority: 55,
  attack: { damage: 0, damageRand: 0, cooldown: 60, minRange: 1, maxRange: 8, sight: 8, projectile: BOULDER },
};
/** Units scan for targets at age 2, then every 30 ticks. */
const FIRST_SCAN = 2;

/** Centre of cell (cx, cy) in Fx pixels. */
const at = (cx: number, cy: number) => [fx(cx * CELL_W + 12), fx(cy * CELL_H + 8)] as const;

function hpLog(w: World, id: number, ticks: number): { tick: number; hp: number }[] {
  const out: { tick: number; hp: number }[] = [];
  let last = w.units.find((u) => u.id === id)?.hp;
  for (let i = 0; i < ticks; i++) {
    step(w, []);
    const hp = w.units.find((u) => u.id === id)?.hp ?? 0;
    if (hp !== last) out.push({ tick: w.tick - 1, hp });
    last = hp;
  }
  return out;
}

describe('melee', () => {
  it('hits once per cooldown for damage + rand(damageRand)', () => {
    const w = createWorld({ seed: 7 });
    spawnUnit(w, 0, ...at(10, 10), SWORDSMAN);
    const victim = spawnUnit(w, 1, ...at(11, 10), { hp: 350 }); // can't fight back
    const hits = hpLog(w, victim.id, 125);
    expect(hits.map((h) => h.tick)).toEqual([2, 32, 62, 92, 122]);
    let hp = 350;
    for (const h of hits) {
      const dmg = hp - h.hp;
      expect(dmg).toBeGreaterThanOrEqual(10);
      expect(dmg).toBeLessThan(15);
      hp = h.hp;
    }
  });

  it('adds the bonus table entry, never below 1', () => {
    const t: MeleeBonusTable = {
      attackerClass: new Uint8Array([0, 0xff]),
      defenderClass: new Uint8Array([1, 0]),
      matrix: new Int8Array([-50, 0, 15, 0]),
      stride: 2,
    };
    expect(meleeBonus(t, 0, 0)).toBe(15);
    expect(meleeBonus(t, 0, 1)).toBe(-50);
    expect(meleeBonus(t, 1, 0)).toBe(0);
    const w = createWorld({ seed: 1, bonus: t });
    spawnUnit(w, 0, ...at(5, 5), { kind: 0, attack: melee(10, 0, 30) });
    const a = spawnUnit(w, 1, ...at(6, 5), { kind: 0, hp: 100 });
    const b = spawnUnit(w, 1, ...at(4, 5), { kind: 1, hp: 100 });
    for (let i = 0; i <= FIRST_SCAN; i++) step(w, []);
    // Same priority and distance: the lower id (a, defender class 1, bonus +15) is picked.
    expect([a.hp, b.hp]).toEqual([75, 100]);
  });

  it('only reaches adjacent cells (diagonals count: 1 + 1 > 1)', () => {
    const w = createWorld({ seed: 1 });
    const u = spawnUnit(w, 0, ...at(5, 5), { ...SWORDSMAN, attack: { ...melee(10, 0, 30), sight: 0 } });
    const diag = spawnUnit(w, 1, ...at(6, 6), {});
    u.target = diag.id;
    step(w, []);
    expect(diag.hp).toBe(100);
    expect(u.tx).not.toBeNull(); // walks to the side to get in range instead
    for (let i = 0; i < 20; i++) step(w, []);
    expect(diag.hp).toBe(90);
  });
});

describe('ranged', () => {
  it('fires a projectile that flies until it enters the target cell, then deals min + rand(max - min)', () => {
    const w = createWorld({ seed: 3 });
    spawnUnit(w, 0, ...at(5, 5), ARCHER);
    const t = spawnUnit(w, 1, ...at(10, 5), { hp: 300 }); // 5 cells away = max range
    const hits = hpLog(w, t.id, 20);
    // Fired at the first scan; 108 px to the edge of the target cell at 12 px a tick, moving
    // from the firing tick: 9 moves, so it lands 8 ticks later.
    expect(hits.map((h) => h.tick)).toEqual([FIRST_SCAN + 8]);
    expect(300 - hits[0]!.hp).toBeGreaterThanOrEqual(15);
    expect(300 - hits[0]!.hp).toBeLessThan(20);
    expect(t.lastHit).toBe(FIRST_SCAN + 8);
  });

  it('hits an adjacent target on the firing tick', () => {
    const w = createWorld({ seed: 3 });
    spawnUnit(w, 0, ...at(5, 5), ARCHER);
    const t = spawnUnit(w, 1, ...at(6, 5), { hp: 300 });
    expect(hpLog(w, t.id, 4).map((h) => h.tick)).toEqual([FIRST_SCAN]);
  });

  it('follows a moving target', () => {
    const w = createWorld({ seed: 3 });
    const archer = spawnUnit(w, 0, ...at(5, 5), ARCHER);
    const t = spawnUnit(w, 1, ...at(9, 5), { hp: 300, speed: 410 });
    for (let i = 0; i <= FIRST_SCAN; i++) step(w, []);
    expect(w.projectiles).toHaveLength(1);
    step(w, [{ tick: w.tick, player: 1, cmd: { kind: 'move', unitIds: [t.id], x: at(9, 12)[0], y: at(9, 12)[1] } }]);
    for (let i = 0; i < 20 && t.hp === 300; i++) step(w, []);
    expect(t.hp).toBeLessThan(300);
    expect(archer.target).toBe(t.id);
  });

  it('does nothing when the target is gone', () => {
    const w = createWorld({ seed: 3 });
    spawnUnit(w, 0, ...at(5, 5), ARCHER);
    const t = spawnUnit(w, 1, ...at(10, 5), {});
    for (let i = 0; i <= FIRST_SCAN; i++) step(w, []);
    t.hp = 0;
    step(w, []);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('splash', () => {
  it('hits enemies up to 2 cells from the impact at 100 / 80 / 60 % and spares its own side', () => {
    const w = createWorld({ seed: 5 });
    spawnUnit(w, 0, ...at(2, 5), CATAPULT);
    const hp = 1000;
    const centre = spawnUnit(w, 1, ...at(8, 5), { hp, priority: 10 });
    const ring1 = spawnUnit(w, 1, ...at(9, 6), { hp });
    const ring2 = spawnUnit(w, 1, ...at(8, 7), { hp });
    const ring3 = spawnUnit(w, 1, ...at(11, 5), { hp });
    const friend = spawnUnit(w, 0, ...at(7, 5), { hp });
    for (let i = 0; i < 40 && centre.hp === hp; i++) step(w, []);
    const dmg = (u: { hp: number }) => hp - u.hp;
    expect(dmg(centre)).toBeGreaterThanOrEqual(50);
    expect(dmg(centre)).toBeLessThan(60);
    // 50 * 0.8 = 40 (3277/4096 truncated), 60 * 0.8 = 48.
    expect(dmg(ring1)).toBeGreaterThanOrEqual(40);
    expect(dmg(ring1)).toBeLessThan(48);
    // 50 * 0.6 = 30, 60 * 0.6 = 36.
    expect(dmg(ring2)).toBeGreaterThanOrEqual(30);
    expect(dmg(ring2)).toBeLessThan(36);
    expect(dmg(ring3)).toBe(0);
    expect(dmg(friend)).toBe(0);
  });
});

describe('auto-targeting', () => {
  it('scans at age 2 and then once every 30 ticks', () => {
    const w = createWorld({ seed: 1 });
    const u = spawnUnit(w, 0, ...at(5, 5), SWORDSMAN);
    for (let i = 0; i <= FIRST_SCAN; i++) step(w, []);
    const foe = spawnUnit(w, 1, ...at(8, 5), { hp: 100 }); // in sight, spawned after the first scan
    while (w.tick < FIRST_SCAN + 30) step(w, []);
    expect(u.target).toBeNull();
    step(w, []);
    expect(u.target).toBe(foe.id);
  });

  it('prefers an enemy in attack range, then higher priority, then the nearer one', () => {
    const w = createWorld({ seed: 1 });
    const archer = spawnUnit(w, 0, ...at(5, 5), ARCHER); // range 5, sight 7
    spawnUnit(w, 1, ...at(11, 5), { hp: 100, priority: 65 }); // 6 cells: in sight, out of range
    const builder = spawnUnit(w, 1, ...at(5, 9), { hp: 100, priority: 11 });
    const knight = spawnUnit(w, 1, ...at(9, 5), { hp: 100, priority: 20 });
    spawnUnit(w, 1, ...at(5, 1), { hp: 100, priority: 20 }); // same priority, same distance, higher id
    for (let i = 0; i <= FIRST_SCAN; i++) step(w, []);
    expect(archer.target).toBe(knight.id);
    expect(builder.hp).toBe(100);
  });

  it('switches to a better target on a later scan, but not away from an attack order', () => {
    const w = createWorld({ seed: 1 });
    const archer = spawnUnit(w, 0, ...at(5, 5), { ...ARCHER, hp: 10000 });
    const ordered = spawnUnit(w, 0, ...at(5, 6), { ...ARCHER, hp: 10000 });
    const low = spawnUnit(w, 1, ...at(8, 5), { hp: 10000, priority: 2 });
    step(w, [{ tick: 0, player: 0, cmd: { kind: 'attack', unitIds: [ordered.id], target: low.id } }]);
    for (let i = 0; i < FIRST_SCAN; i++) step(w, []);
    expect(archer.target).toBe(low.id);
    const high = spawnUnit(w, 1, ...at(8, 6), { hp: 10000, priority: 55 });
    while (w.tick <= FIRST_SCAN + 30) step(w, []);
    expect(archer.target).toBe(high.id);
    expect(ordered.target).toBe(low.id);
  });
});

describe('orders and death', () => {
  it('attack order chases, kills, then the unit stops', () => {
    const w = createWorld({ seed: 11 });
    const king = spawnUnit(w, 0, ...at(2, 2), { ...KING, attack: { ...KING.attack!, sight: 0 } });
    const foe = spawnUnit(w, 1, ...at(12, 2), { hp: 120 });
    step(w, [{ tick: 0, player: 0, cmd: { kind: 'attack', unitIds: [king.id], target: foe.id } }]);
    for (let i = 0; i < 200 && w.units.length > 1; i++) step(w, []);
    expect(w.units.map((u) => u.id)).toEqual([king.id]);
    step(w, []); // the dead target is noticed on the next tick
    expect(king.target).toBeNull();
    expect(king.tx).toBeNull();
  });

  it('a move order cancels the attack', () => {
    const w = createWorld({ seed: 11 });
    const u = spawnUnit(w, 0, ...at(2, 2), { ...SWORDSMAN, attack: { ...melee(10, 0, 30), sight: 0 } });
    const foe = spawnUnit(w, 1, ...at(3, 2), {});
    step(w, [{ tick: 0, player: 0, cmd: { kind: 'attack', unitIds: [u.id], target: foe.id } }]);
    step(w, [{ tick: 1, player: 0, cmd: { kind: 'move', unitIds: [u.id], x: fx(0), y: fx(0) } }]);
    expect(u.target).toBeNull();
    expect(foe.hp).toBe(90);
  });

  it('cannot order attacks on your own units or with enemy units', () => {
    const w = createWorld({ seed: 1 });
    const a = spawnUnit(w, 0, ...at(2, 2), SWORDSMAN);
    const b = spawnUnit(w, 0, ...at(3, 2), SWORDSMAN);
    const c = spawnUnit(w, 1, ...at(9, 9), SWORDSMAN);
    step(w, [
      { tick: 0, player: 0, cmd: { kind: 'attack', unitIds: [a.id], target: b.id } },
      { tick: 0, player: 1, cmd: { kind: 'attack', unitIds: [a.id], target: c.id } },
    ]);
    expect(a.target).toBeNull();
  });
});

describe('combat determinism', () => {
  function battle(seed: number): World {
    const w = createWorld({ seed });
    for (let i = 0; i < 3; i++) spawnUnit(w, 0, ...at(4 + i, 4), SWORDSMAN);
    spawnUnit(w, 0, ...at(3, 5), ARCHER);
    spawnUnit(w, 0, ...at(4, 6), KING);
    for (let i = 0; i < 3; i++) spawnUnit(w, 1, ...at(14 + i, 9), SWORDSMAN);
    spawnUnit(w, 1, ...at(17, 10), ARCHER);
    spawnUnit(w, 1, ...at(16, 11), KING);
    return w;
  }
  const log: InputLog = {
    seed: 99,
    ticks: 900,
    commands: [
      { tick: 2, player: 0, cmd: { kind: 'move', unitIds: [1, 2, 3, 4, 5], x: fx(15 * CELL_W), y: fx(9 * CELL_H) } },
      { tick: 2, player: 1, cmd: { kind: 'attack', unitIds: [6, 7, 8, 9], target: 5 } },
      { tick: 200, player: 0, cmd: { kind: 'attack', unitIds: [1, 2], target: 10 } },
    ],
  };

  it('replays identically and is independent of command arrival order', () => {
    const a = replay(battle(log.seed), log);
    const b = replay(battle(log.seed), { ...log, commands: [...log.commands].reverse() });
    expect(a).toEqual(b);
  });

  it('final battle hash is pinned (update deliberately when combat rules change)', () => {
    const w = battle(log.seed);
    replay(w, log);
    expect(w.units.length).toBeLessThan(10);
    expect(hashWorld(w).toString(16)).toMatchInlineSnapshot(`"f39e6718"`);
  });
});
