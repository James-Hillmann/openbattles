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
const SWORDSMAN: UnitType = { kind: 3, speed: 410, hp: 350, attack: melee(10, 5, 30) };
const KING: UnitType = { kind: 0, speed: 410, hp: 1000, attack: melee(40, 10, 20) };
const ARCHER: UnitType = {
  kind: 4, speed: 478, hp: 300,
  attack: { damage: 0, damageRand: 0, cooldown: 24, minRange: 1, maxRange: 5, sight: 7, projectile: { speed: 2048, minDamage: 15, maxDamage: 20 } },
};

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
    expect(hits.map((h) => h.tick)).toEqual([0, 30, 60, 90, 120]);
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
    step(w, []);
    // Nearest-in-sight tie goes to the lower id: unit a, defender class 1, bonus +15.
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
  it('fires a projectile that deals min + rand(max - min) on arrival', () => {
    const w = createWorld({ seed: 3 });
    spawnUnit(w, 0, ...at(5, 5), ARCHER);
    const t = spawnUnit(w, 1, ...at(10, 5), { hp: 300 }); // 5 cells away = max range
    step(w, []);
    expect(w.projectiles).toHaveLength(1);
    expect(t.hp).toBe(300);
    // 5 cells at 2048/4096 cell per tick = 10 ticks of flight.
    for (let i = 0; i < 10; i++) step(w, []);
    expect(w.projectiles).toHaveLength(0);
    expect(300 - t.hp).toBeGreaterThanOrEqual(15);
    expect(300 - t.hp).toBeLessThan(20);
  });

  it('fizzles when the target is gone', () => {
    const w = createWorld({ seed: 3 });
    spawnUnit(w, 0, ...at(5, 5), ARCHER);
    const t = spawnUnit(w, 1, ...at(10, 5), {});
    step(w, []);
    t.hp = 0;
    step(w, []);
    expect(w.projectiles).toHaveLength(0);
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
    expect(hashWorld(w).toString(16)).toMatchInlineSnapshot(`"3352e976"`);
  });
});
