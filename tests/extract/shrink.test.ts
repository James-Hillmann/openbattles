import { describe, expect, it } from 'vitest';
import { shrink } from '@lbw/extract';

describe('shrink (building strip icons)', () => {
  it('averages each block, ignoring transparent pixels', () => {
    // 2x2 → 1x1: one red, one blue, two transparent.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0, 9, 9, 9, 0]);
    const out = shrink({ width: 2, height: 2, data }, 2);
    expect(out.width).toBe(1);
    expect([...out.data]).toEqual([128, 0, 128, 128]);
  });
  it('keeps a fully transparent block transparent', () => {
    const out = shrink({ width: 4, height: 4, data: new Uint8ClampedArray(64) }, 4);
    expect([...out.data]).toEqual([0, 0, 0, 0]);
  });
});
