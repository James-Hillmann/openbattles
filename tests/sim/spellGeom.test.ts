import { describe, expect, it } from 'vitest';
import { cellXOf, cellYOf, forestEnd, fx12Mul, normalize, thickLine } from '@lbw/sim';

// Values logged in the emulator (out of the RE notes, docs/re-notes/spells.md).
const cells = (l: number[]) => l.map((c) => [cellXOf(c), cellYOf(c)]);

describe('spell geometry', () => {
  it('forest end points: always `range` cells toward the tap, clamped to the map', () => {
    expect(forestEnd(11, 15, 12, 14, 10, 64, 64)).toEqual([18, 7]);
    expect(forestEnd(11, 15, 12, 15, 10, 64, 64)).toEqual([21, 15]);
    expect(forestEnd(60, 60, 63, 63, 10, 64, 64)).toEqual([63, 63]);
    expect(forestEnd(62, 1, 0, 0, 10, 64, 64)).toEqual([52, 0]);
    expect(forestEnd(11, 15, 11, 15, 10, 64, 64)).toEqual([11, 15]);
  });

  it('thick line: strictly between the ends, side cells and doubled diagonal cells', () => {
    expect(cells(thickLine(11, 15, 18, 22, 64, 64))).toEqual([[12, 16], [13, 17], [14, 18], [15, 19], [16, 20], [17, 21]]);
    expect(thickLine(11, 15, 3, 22, 64, 64)).toHaveLength(26);
    expect(thickLine(62, 1, 63, 0, 64, 64)).toEqual([]);
    expect(cells(thickLine(5, 5, 5, 5, 64, 64))).toEqual([[5, 5], [5, 5]]);
  });

  it('projectile velocity: normalize (dx, 1.5 dy), times (24, 16) px, times 0.5', () => {
    const vel = (dx: number, dy: number) => {
      const [nx, ny] = normalize(dx * 4096, fx12Mul(dy * 4096, 0x1800));
      return [fx12Mul(fx12Mul(nx, 24 << 12), 2048), fx12Mul(fx12Mul(ny, 16 << 12), 2048)];
    };
    expect(vel(312, 176)).toEqual([37524, 21168]);
    expect(vel(-48, -64)).toEqual([-21984, -29312]);
    expect(vel(96, 0)).toEqual([49152, 0]);
  });
});
