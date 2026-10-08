import { describe, expect, it } from 'vitest';
import { FX_ONE, fx, fxDiv, fxLen, fxMul, fxRatio, fxToFloat, fxToInt, isqrt } from '@lbw/sim';

describe('fixed point', () => {
  it('multiplies and divides exactly', () => {
    expect(fxMul(fx(3), fx(4))).toBe(fx(12));
    expect(fxMul(fxRatio(1, 2), fxRatio(1, 2))).toBe(fxRatio(1, 4));
    expect(fxDiv(fx(7), fx(2))).toBe(fxRatio(7, 2));
    expect(fxToFloat(fxMul(fx(-3), fxRatio(3, 2)))).toBe(-4.5);
  });
  it('does not lose precision on large operands', () => {
    const a = fx(30000);
    expect(fxMul(a, FX_ONE)).toBe(a);
    expect(fxToInt(fxMul(fx(200), fx(150)))).toBe(30000);
  });
  it('isqrt is exact', () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 1 << 30, 2 ** 52 - 1]) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
  });
  it('fxLen of a 3-4-5 triangle', () => {
    expect(fxLen(fx(3), fx(4))).toBe(fx(5));
  });
  it('fxLen handles map-sized distances', () => {
    // A 96x96-cell map is 2304x1536 px; its diagonal must not overflow.
    expect(fxToInt(fxLen(fx(2304), fx(1536)))).toBe(2769);
    expect(Math.abs(fxLen(fx(-3000), fx(4000)) - fx(5000))).toBeLessThanOrEqual(2);
  });
});
