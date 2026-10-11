import { describe, expect, it } from 'vitest';
import { createWorld, fx, spawnUnit, type ActiveSpell, type World } from '@lbw/sim';
import { groundCycles } from '@lbw/extract';
import {
  Explosion, FX_PICS, QUAKE_TABLE, SpellAnims, artilleryFlight, boltOffsets, fragments, quakeAmount, quakeShake, roarPuffs, shotAt, type FxQuad,
} from '../../client/src/spellAnims';



describe('spell effect pieces', () => {
  it('shakes by the quake table, scaled down far from the view, capped and flipping sign', () => {
    expect(QUAKE_TABLE.length).toBe(36);
    expect(Math.max(...QUAKE_TABLE)).toBe(15);
    expect(quakeAmount(17, 0)).toBe(15);
    expect(quakeAmount(17, 72)).toBe(7);
    expect(quakeShake([10, 10, 0], 3)).toBe(15);
    expect(quakeShake([4, 0, 0], 4)).toBe(-4);
  });

  it('plays an explosion a frame every 2 updates and drops it after 11', () => {
    const e = new Explosion(10, 20);
    const frames: number[] = [];
    let done = false;
    let n = 0;
    while (!done) {
      done = e.update();
      n++;
      const q: FxQuad[] = [];
      e.draw(q);
      frames.push(q.length ? FX_PICS.explosion.indexOf(q[0]!.pic as never) : -1);
    }
    expect(n).toBe(11);
    expect(frames).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, -1, -1]);
  });

  it("aims lightning's 8 bolts like the game (range 10)", () => {
    expect(boltOffsets(10)).toEqual([[0, -10], [7, -8], [10, -1], [7, 7], [0, 10], [-8, 7], [-10, 0], [-8, -8]]);
  });

  it('throws six fragments out R cells, 24 x 16 px a cell, in 30 updates', () => {
    const f = fragments(100, 100, 5, 10);
    expect(f).toHaveLength(6);
    expect(f[0]!.x).toBeCloseTo(110);
    expect(f[0]!.x + 30 * f[0]!.vx).toBeCloseTo(220);
    expect(f[3]!.x + 30 * f[3]!.vx).toBeCloseTo(-20);
    expect(f[0]!.left).toBe(30);
  });

  it("lays Roar's rings out on the axes, then the diagonals", () => {
    const p = roarPuffs();
    expect(p).toHaveLength(5 * 4 + 6 * 4);
    expect(p[0]).toEqual({ dx: 25, dy: 0, f: -8 });
    expect(p[1]).toEqual({ dx: 0, dy: 25, f: -8 });
    expect(p[20]).toMatchObject({ dx: 22, dy: 11, f: -12 });
  });

  it('flies shells along a curve to the target', () => {
    expect(artilleryFlight(10)).toBe(7);
    expect(artilleryFlight(128)).toBe(30);
    const s = { ex: 100, ey: 0, cx: 50, cy: -50, n: 10, k: 0 };
    expect(shotAt(s, 10)).toEqual({ x: 100, y: 0 });
    expect(shotAt(s, 5).y).toBeLessThan(0);
  });

});

function spell(w: World, over: Partial<ActiveSpell>): ActiveSpell {
  const s: ActiveSpell = {
    id: w.nextSpell++, owner: 0, spell: 13, cls: 3, phase: 0, caster: 0, target: 0, x: fx(100), y: fx(100), start: w.tick, left: 60, mode: 2, cx: 4, cy: 6, radius: 5,
    units: [], timer: 1, dmg: 0, dmgStep: 0, chance: 0, chanceStep: 0, ring: 0, ringStep: 0, idx: 0, px: 0, py: 0, vx: 0, vy: 0, ...over,
  };
  w.spells.push(s);
  return s;
}

describe('SpellAnims', () => {
  const world = () => {
    const w = createWorld({ seed: 1 });
    w.spellDefs[15] = { id: 15, range: 10, b7: 0, time: 0 } as never;
    w.spellDefs[29] = { id: 29, range: 10, b7: 5, time: 60 } as never;
    return w;
  };
  const view = { x: 0, y: 0 };

  it('shakes the view while an Earthquake runs', () => {
    const w = world();
    const hero = spawnUnit(w, 0, fx(100), fx(100), { kind: 0, role: 0 });
    spell(w, { caster: hero.id });
    const a = new SpellAnims();
    const shakes: number[] = [];
    for (let t = 0; t < 40; t++) {
      w.tick++;
      a.tick(w, { x: 4, y: 6 }, () => true);
      shakes.push(Math.abs(a.shake(w.tick)));
    }
    expect(Math.max(...shakes)).toBe(15);
    expect(shakes.at(-1)).toBe(0);
  });

  it('puts monkeys on every unit that joins Monkey Swarm and ends them with the spell', () => {
    const w = world();
    const hero = spawnUnit(w, 0, fx(100), fx(100), { kind: 0, role: 0 });
    const foe = spawnUnit(w, 1, fx(150), fx(100), { kind: 23, role: 2 });
    const s = spell(w, { spell: 20, caster: hero.id, units: [foe.id, 0] });
    const a = new SpellAnims();
    w.tick++;
    a.tick(w, view, () => true);
    expect(a.count).toBe(1);
    w.spells = w.spells.filter((x) => x !== s);
    for (let t = 0; t < 12; t++) {
      w.tick++;
      a.tick(w, view, () => true);
    }
    expect(a.count).toBe(0);
  });

  it('fires 8 lightning bolts when the strike comes, then explosions', () => {
    const w = world();
    const hero = spawnUnit(w, 0, fx(240), fx(160), { kind: 0, role: 0 });
    const s = spell(w, { spell: 15, cls: 5, caster: hero.id });
    const a = new SpellAnims();
    w.tick++;
    a.tick(w, view, () => true);
    expect(a.quads()).toHaveLength(0);
    s.phase = 1;
    w.tick++;
    a.tick(w, view, () => true);
    const q = a.quads();
    expect(q).toHaveLength(8);
    expect(q.filter((x) => x.rot === 90)).toHaveLength(2);
    for (let t = 0; t < 34; t++) {
      w.tick++;
      a.tick(w, view, () => true);
    }
    expect(a.quads().every((x) => (FX_PICS.explosion as readonly number[]).includes(x.pic))).toBe(true);
  });

  it('sends freeze flakes out from the spot', () => {
    const w = world();
    const hero = spawnUnit(w, 0, fx(100), fx(100), { kind: 0, role: 0 });
    spell(w, { spell: 29, cls: 4, caster: hero.id, cx: 10, cy: 10 });
    const a = new SpellAnims();
    w.tick++;
    a.tick(w, view, () => true);
    const q = a.quads();
    expect(q).toHaveLength(8);
    expect(q[0]).toMatchObject({ pic: FX_PICS.freezeMinifig, x: 240, y: 160 });
  });

  it('reports a buff burst when a unit gains a buff', () => {
    const w = world();
    const u = spawnUnit(w, 0, fx(100), fx(100), { kind: 0, role: 0 });
    const a = new SpellAnims();
    w.tick++;
    expect(a.tick(w, view, () => true)).toEqual([]);
    u.buffs[0] = 1;
    w.tick++;
    expect(a.tick(w, view, () => true)).toEqual([{ unit: u.id, tick: w.tick }]);
    w.tick++;
    expect(a.tick(w, view, () => true)).toEqual([]);
  });
});

describe('ground colour cycles', () => {
  it('keeps only the turning pixels of each distinct cell picture', () => {
    // One 8bpp tile (tile 1) with colour 20 in its first pixel and 5 elsewhere; tile 0 empty.
    const pixels = new Uint8Array(128);
    pixels.fill(5, 64);
    pixels[64] = 20;
    const chars = { tilesWide: 2, tilesHigh: 1, bpp: 8 as const, pixels };
    const metatiles = new Uint16Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const map = { width: 3, height: 1, ground: new Uint16Array([0, 1, 0]) };
    const g = groundCycles(map, chars, new Uint8Array(1024), metatiles, [{ first: 16, last: 39, period: 3 }])!;
    expect(g.pictures).toHaveLength(1);
    expect([...g.cells]).toEqual([1, 0, 1]);
    expect(g.pictures[0]![0]).toBe(20);
    expect(g.pictures[0]!.filter((v) => v)).toHaveLength(1);
    expect(groundCycles(map, chars, new Uint8Array(1024), metatiles, [{ first: 100, last: 110, period: 3 }])).toBeUndefined();
  });
});
