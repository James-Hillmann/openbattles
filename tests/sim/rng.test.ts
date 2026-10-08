import { describe, expect, it } from 'vitest';
import { makeRng, nextInt, nextU32 } from '@lbw/sim';

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const xs = Array.from({ length: 100 }, () => nextU32(a));
    const ys = Array.from({ length: 100 }, () => nextU32(b));
    expect(xs).toEqual(ys);
  });
  it('has a pinned sequence so an accidental algorithm change fails loudly', () => {
    const r = makeRng(1);
    expect([nextU32(r), nextU32(r), nextU32(r)]).toMatchInlineSnapshot(`
      [
        270369,
        67634689,
        2647435461,
      ]
    `);
  });
  it('nextInt stays in range', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = nextInt(r, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});
