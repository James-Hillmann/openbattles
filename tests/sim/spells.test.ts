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
  def(0, 1, 0, 0, 0),
  def(1, 1, 5, 2, 100),
  def(2, 1, 3, 0x40, 100),
  def(3, 5, 5, 1, 100),
  def(4, 5, 5, 2, 100),
  def(5, 5, 5, 1, 100),
  def(6, 5, 5, 2, 100),
  def(7, 5, 5, 1, 100),
  def(8, 5, 5, 2, 100),
  def(9, 5, 5, 1, 100),
];
// The damage and freeze spells, as in the table: params are +0x02..+0x05 (end damage, end chance, start damage, start chance).
const big = (id: number, params: [number, number, number, number], flags: number, cost: number): SpellDef => ({
  id, icon: 0, params, range: 10, b7: 5, flags, cost, category: 0, time: 60,
});
DEFS[13] = big(13, [5, 50, 12, 50], 0x40, 600);
DEFS[20] = big(20, [3, 50, 6, 60], 4, 400);
DEFS[25] = big(25, [5, 50, 10, 60], 1, 600);
DEFS[29] = big(29, [0, 0, 0, 0], 1, 400);
for (let i = 0; i < 35; i++) DEFS[i] ??= def(i, 10, 5, 1, 300);

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

describe('damage spells', () => {
  const KING: UnitType = { ...HERO, spells: [5, 9, 10, 13] };

  it('Earthquake: 61 ticks of damage sliding from 12 to 4, one roll per slot a tick', () => {
    const w = world();
    const king = spawnUnit(w, 0, ...at(5, 5), KING);
    const foes = [spawnUnit(w, 1, ...at(7, 5), GUARD), spawnUnit(w, 1, ...at(5, 8), GUARD)];
    cast(w, king.id, 13, 0, 0);
    const quake = w.spells.find((s) => s.spell === 13)!;
    const dmg: number[] = [];
    while (w.spells.includes(quake)) {
      step(w, []);
      dmg.push(quake.dmg);
    }
    expect(dmg).toHaveLength(61);
    // Logged after each tick's step, so dmg[k] is the value for hit k + 1: 4.998 on the last hit.
    expect(dmg[0]! >> 12).toBe(11); // 12 - 0.117
    expect(dmg[59]! >> 12).toBe(4);
    expect(foes.every((f) => f.hp < 350)).toBe(true);
  });

  it('a sure hit takes exactly the damage, no armor, after the grace hits', () => {
    const w = world();
    w.spellDefs[25] = big(25, [10, 100, 10, 0xff], 1, 600); // always hits for 10
    const hero = spawnUnit(w, 0, ...at(5, 5), { ...HERO, spells: [25] });
    const foe = spawnUnit(w, 1, ...at(9, 5), GUARD);
    foe.buffs[2] = 1; // armor does not help
    cast(w, hero.id, 25, 9, 5);
    const hp: number[] = [];
    for (let i = 0; i < 20; i++) {
      step(w, []);
      hp.push(foe.hp);
    }
    // Scanned at the end of the 2nd tick (behind the hero's aura); then 10 grace hits; then 10 a tick.
    expect(hp.slice(0, 11)).toEqual(new Array(11).fill(350));
    expect(hp.slice(11, 14)).toEqual([340, 330, 320]);
  });

  it('allies and own units are never hit', () => {
    const w = world();
    w.spellDefs[25] = big(25, [10, 100, 10, 0xff], 1, 600);
    const hero = spawnUnit(w, 0, ...at(5, 5), { ...HERO, spells: [25] });
    const own = spawnUnit(w, 0, ...at(9, 5), GUARD);
    run(w, 1);
    cast(w, hero.id, 25, 9, 5);
    run(w, 70);
    expect(own.hp).toBe(350);
  });

  it('Monkey Swarm takes only an enemy unit', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), { ...HERO, spells: [20] });
    const own = spawnUnit(w, 0, ...at(6, 5), GUARD);
    const foe = spawnUnit(w, 1, ...at(7, 5), GUARD);
    cast(w, hero.id, 20, 0, 0, own.id);
    expect(w.spells.some((s) => s.spell === 20)).toBe(false);
    cast(w, hero.id, 20, 0, 0, foe.id);
    const s = w.spells.find((x) => x.spell === 20)!;
    expect(s.units).toEqual([foe.id]);
    expect(foe.grace).toBe(15);
  });
});

describe('freeze ring', () => {
  it('29 freezes enemy minifigures the ring reaches, for 60 ticks', () => {
    const w = world();
    const hero = spawnUnit(w, 0, ...at(5, 5), { ...HERO, spells: [29] });
    const near = spawnUnit(w, 1, ...at(10, 5), { ...GUARD, attack: null });
    const far = spawnUnit(w, 1, ...at(10, 9), { ...GUARD, attack: null }); // Chebyshev 4: caught on update 38
    const castTick = w.tick;
    cast(w, hero.id, 29, 10, 6);
    run(w, 2); // update 2: radius 1
    expect(near.frozen).toBe(castTick + 2 + 60);
    expect(far.frozen).toBe(0);
    // A frozen unit ignores its move order.
    const [x, y] = at(15, 5);
    step(w, [{ tick: w.tick, player: 1, cmd: { kind: 'move', unitIds: [near.id], x, y } }]);
    run(w, 10);
    expect(near.x).toBe(at(10, 5)[0]);
    run(w, 30);
    expect(far.frozen).toBeGreaterThan(w.tick);
    run(w, 30);
    expect(w.spells.some((s) => s.spell === 29)).toBe(false);
  });
});
