import { describe, expect, it } from 'vitest';
import { hitFrame } from '../../client/src/hitShake';

// The C5SE table (ARM9 0x02143460) as dx/flash.
const table = [
  [0, 0], [-2, 1], [2, 1], [2, 1], [-2, 0], [-2, 0], [1, 0], [-1, 0], [-1, 0], [1, 0],
].map(([dx, f]) => ({ dx: dx!, flash: f === 1 }));

describe('hit reaction', () => {
  it('steps one record per tick, grey from 2.5 to 5.5 ticks', () => {
    const at = [1, 2, 2.6, 3.5, 4.9, 5.5, 11, 12].map((s) => hitFrame(table, s));
    expect(at.map((h) => h.flash)).toEqual([false, false, true, true, true, false, false, false]);
    expect(at.map((h) => h.dx)).toEqual([0, 0, -2, 2, 2, -2, 1, 0]);
  });

  it('falls back to the measured grey window without the table', () => {
    expect(hitFrame(undefined, 3)).toEqual({ dx: 0, flash: true });
    expect(hitFrame(undefined, 6)).toEqual({ dx: 0, flash: false });
  });
});
