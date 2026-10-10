import { describe, expect, it } from 'vitest';
import { createWorld } from '../../sim/src/world';
import { newRing, ringSearch, shuffleRing } from '../../sim/src/ring';

const grid = (w: number, h: number) => ({ width: w, height: h, cells: new Uint8Array(w * h) });

describe('ring search (0x02080430)', () => {
  it('goes out ring by ring, nearer the side middle first', () => {
    const w = createWorld({ seed: 1, grid: grid(20, 20) });
    const order: number[] = [];
    ringSearch(w, 10, 10, 3, (x, y) => (order.push(y * 20 + x), false));
    const ring = (c: number) => Math.max(Math.abs((c % 20) - 10), Math.abs(Math.floor(c / 20) - 10));
    for (let i = 1; i < order.length; i++) expect(ring(order[i]!)).toBeGreaterThanOrEqual(ring(order[i - 1]!));
  });

  it('never tries the cells straight left or right of the start', () => {
    const w = createWorld({ seed: 1, grid: grid(20, 20) });
    for (let t = 0; t < 50; t++) {
      shuffleRing(w);
      const tried = new Set<number>();
      ringSearch(w, 10, 10, 5, (x, y) => (tried.add(y * 20 + x), false));
      for (let d = 1; d < 5; d++) {
        expect(tried.has(10 * 20 + 10 + d)).toBe(false);
        expect(tried.has(10 * 20 + 10 - d)).toBe(false);
        expect(tried.has((10 - d) * 20 + 10)).toBe(true);
        expect(tried.has((10 + d) * 20 + 10)).toBe(true);
      }
    }
  });

  it('shuffles by swapping, so each table keeps its codes', () => {
    const w = createWorld({ seed: 7, grid: grid(8, 8) });
    for (let t = 0; t < 100; t++) shuffleRing(w);
    const fresh = newRing();
    expect([...w.ring.slice(0, 4)].sort()).toEqual(fresh.slice(0, 4));
    expect([...w.ring.slice(4, 8)].sort()).toEqual(fresh.slice(4, 8));
    expect([...w.ring.slice(8)].sort()).toEqual(fresh.slice(8));
  });

  it('skips cells off the map edges', () => {
    const w = createWorld({ seed: 1, grid: grid(5, 5) });
    const tried: number[] = [];
    ringSearch(w, 0, 0, 3, (x, y) => (tried.push(y * 5 + x), false));
    for (const c of tried) expect(c).toBeLessThan(25);
  });
});
