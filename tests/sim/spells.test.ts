import { describe, expect, it } from 'vitest';
import {
  BUFF_TICKS,
  CELL_H,
  CELL_W,
  cloneWorld,
  createWorld,
  fx,
  hashWorld,
  moveSpeed,
  sanitizeCommand,
  spawnUnit,
  spellTarget,
  step,
  type Command,
  type SpellDef,
  type UnitType,
  type World,
} from '@lbw/sim';

// Spell records 0..9 as the C5SE table has them (docs/re-notes/spells.md).
const def = (id: number, range: number, b7: number, flags: number, cost: number): SpellDef => ({
  id, icon: 0, params: [0, 0, 0, 0], range, b7, flags, cost, category: 0, time: 30,
});
const DEFS: SpellDef[] = [
  def(0, 0, 0, 0, 0),
  def(1, 1, 5, 0x40, 0),
  def(2, 1, 3, 0x40, 0),
  def(3, 5, 5, 1, 100),
  def(4, 5, 5, 2, 100),
  def(5, 5, 5, 1, 100),
  def(6, 5, 5, 2, 100),
  def(7, 5, 5, 1, 100),
  def(8, 5, 5, 2, 100),
  def(9, 5, 5, 1, 100),
];

const melee = (damage: number, damageRand: number, cooldown: number) => ({
  damage, damageRand, cooldown, minRange: 1, maxRange: 1, sight: 0, projectile: null,
});
const HERO: UnitType = { kind: 0, role: 0, speed: 410, hp: 1000, attack: melee(40, 0, 20), charge: 1000, spells: [5, 7, 9] };
const GUARD: UnitType = { kind: 3, role: 2, speed: 410, hp: 350, attack: melee(5, 0, 30) };

const at = (cx: number, cy: number) => [fx(cx * CELL_W + 12), fx(cy * CELL_H + 8)] as const;

function world(): World {
  return createWorld({ seed: 1, spellDefs: DEFS });
}

function cast(w: World, caster: number, spell: number, cx: number, cy: number, target = 0): void {
  const [x, y] = at(cx, cy);
  step(w, [{ tick: w.tick, player: 0, cmd: { kind: 'cast', caster, spell, target, x, y } }]);
}

const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) step(w, []);
};

describe('hero charge', () => {
  it('starts full and refills one point a tick', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    expect(hero.charge).toBe(1000);
    cast(w, hero.id, 5, 6, 5);
    expect(hero.charge).toBe(900 + 1); // paid on the cast tick, +1 for that tick's update
    run(w, 3);
    expect(hero.charge).toBe(904); // the emulator: 1000 -> 904 four ticks after a cast
  });

  it('needs more charge than the cost', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    hero.charge = 100;
    cast(w, hero.id, 5, 6, 5);
    expect(w.spells.filter((s) => s.spell === 5)).toHaveLength(0);
    expect(hero.charge).toBe(101);
  });

  it('checks the range in whole cells', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    cast(w, hero.id, 5, 9, 8); // 4^2 + 3^2 = 25 <= 5^2
    cast(w, hero.id, 5, 10, 8); // 34 > 25
    expect(w.spells.filter((s) => s.spell === 5)).toHaveLength(1);
  });

  it('ignores spells the hero does not have and units that are not heroes', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    const guard = spawnUnit(w, 0, ...at(6, 5), { ...GUARD, spells: [5] });
    cast(w, hero.id, 3, 6, 5);
    cast(w, guard.id, 5, 6, 5);
    expect(w.spells.filter((s) => s.spell !== 2)).toHaveLength(0);
  });
});

describe('stat buffs', () => {
  it('speed: x1.5 for the own units in the area, not the hero, for 300 ticks', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    const near = spawnUnit(w, 0, ...at(8, 6), GUARD); // |3| + |1| = 4 from the spot (5, 5)
    const far = spawnUnit(w, 0, ...at(9, 7), GUARD); // 4 + 2 = 6 > 5
    const foe = spawnUnit(w, 1, ...at(6, 5), GUARD);
    const castTick = w.tick;
    cast(w, hero.id, 5, 5, 5);
    // Queue: the hero's aura first, then the buff; one scan a tick, then the stats rebuild next update.
    run(w, 3);
    expect(moveSpeed(near)).toBe(615);
    for (const u of [hero, far, foe]) expect(moveSpeed(u)).toBe(410);
    run(w, castTick + BUFF_TICKS - w.tick);
    expect(moveSpeed(near)).toBe(615);
    run(w, 3);
    expect(moveSpeed(near)).toBe(410); // spell ends on cast + 301, the stats rebuild on the next update
    expect(w.spells.filter((s) => s.spell === 5)).toHaveLength(0);
  });

  it('does not stack, and keeps the buff on until the last spell ends', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    const g = spawnUnit(w, 0, ...at(6, 5), GUARD);
    cast(w, hero.id, 5, 5, 5);
    run(w, 10);
    cast(w, hero.id, 5, 5, 5);
    run(w, 10);
    expect(g.buffs[0]).toBe(2);
    expect(moveSpeed(g)).toBe(615);
    run(w, BUFF_TICKS - 15);
    expect(g.buffs[0]).toBe(1);
    expect(moveSpeed(g)).toBe(615);
  });

  it('damage x2 on melee hits and armor halves the damage taken', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(3, 5), HERO); // out of its own heal aura's reach
    const g = spawnUnit(w, 0, ...at(8, 5), { ...GUARD, attack: { ...melee(5, 0, 30), sight: 1 } });
    cast(w, hero.id, 7, 7, 5);
    cast(w, hero.id, 9, 7, 5);
    run(w, 10);
    const foe = spawnUnit(w, 1, ...at(9, 5), { ...GUARD, attack: { ...melee(11, 0, 30), sight: 1 } });
    const hp = [g.hp, foe.hp];
    run(w, 25); // one hit each
    expect(hp[0]! - g.hp).toBe(5); // floor(11 / 2)
    expect(hp[1]! - foe.hp).toBe(10); // 5 * 2
  });

  it('keeps the units it took even when they leave, and never takes newcomers', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    const g = spawnUnit(w, 0, ...at(6, 5), GUARD);
    cast(w, hero.id, 5, 5, 5);
    run(w, 5);
    [g.x, g.y] = at(20, 20);
    const late = spawnUnit(w, 0, ...at(6, 6), GUARD);
    run(w, 20);
    expect(moveSpeed(g)).toBe(615);
    expect(moveSpeed(late)).toBe(410);
  });

  it('ends early when the hero dies', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    const g = spawnUnit(w, 0, ...at(6, 5), GUARD);
    cast(w, hero.id, 5, 5, 5);
    run(w, 5);
    hero.hp = 0;
    run(w, 3);
    expect(w.spells).toHaveLength(0);
    expect(moveSpeed(g)).toBe(410);
  });
});

describe('passive heals', () => {
  it('a hero heals its own units within 3 cells by 10 every 7 ticks, not itself', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    const g = spawnUnit(w, 0, ...at(7, 6), GUARD);
    const far = spawnUnit(w, 0, ...at(8, 6), GUARD);
    g.hp = far.hp = 20;
    hero.hp = 500;
    const log: number[] = [];
    for (let i = 0; i < 30; i++) {
      const before = g.hp;
      step(w, []);
      if (g.hp !== before) log.push(g.hp);
    }
    expect(log.slice(0, 4)).toEqual([30, 40, 50, 60]);
    expect(far.hp).toBe(20);
    expect(hero.hp).toBe(500);
  });

  it('a finished base heals its heroes within 5 cells by 30', () => {
    const w = world();
    const base = spawnUnit(w, 0, ...at(5, 5), { kind: 10, role: 7, size: 3, hp: 3000, speed: 0xffff });
    const hero = spawnUnit(w, 0, ...at(9, 7), HERO); // centre (6, 6): 3 + 1
    const g = spawnUnit(w, 0, ...at(8, 6), GUARD);
    hero.hp = 500;
    g.hp = 20;
    run(w, 20); // pulses on ticks 1, 8, 15
    expect(hero.hp).toBe(590);
    expect(g.hp).toBe(40); // the hero's own aura, not the base's
    base.progress = 0;
    base.buildTime = 100;
    run(w, 20);
    expect(hero.hp).toBe(590);
  });
});

describe('spell commands', () => {
  it('targets: 0x40 none, 2 a unit, 1 a spot', () => {
    expect(spellTarget(DEFS[2]!)).toBe('none');
    expect(spellTarget(DEFS[4]!)).toBe('unit');
    expect(spellTarget(DEFS[5]!)).toBe('point');
  });

  it('sanitizes cast commands', () => {
    const ok: Command = { kind: 'cast', caster: 1, spell: 5, target: 0, x: fx(10), y: fx(20) };
    expect(sanitizeCommand(ok)).toEqual(ok);
    expect(sanitizeCommand({ ...ok, spell: 'x' })).toBeNull();
  });

  it('stays deterministic through a clone', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), HERO);
    spawnUnit(w, 0, ...at(6, 5), GUARD);
    cast(w, hero.id, 5, 5, 5);
    const c = cloneWorld(w);
    run(w, 50);
    run(c, 50);
    expect(hashWorld(c)).toBe(hashWorld(w));
  });
});
