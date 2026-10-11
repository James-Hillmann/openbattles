import { describe, expect, it } from 'vitest';
import { createFog } from '@lbw/sim';
import { fogCode, type Rgba } from '@lbw/extract';
import { fogMinimap } from '../../client/src/fogMinimap';

const solid = (w: number, h: number, v: number): Rgba => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });

describe('fog on the minimap', () => {
  it('shows the map where seen now, the shroud where seen before, nothing elsewhere', () => {
    const f = createFog(4, 4);
    f.explored.fill(1, 0, 8); // rows 0-1 seen before
    f.visible[0] = 1; // cell (0,0) seen now
    const out = fogMinimap(solid(6, 6, 200), solid(6, 6, 50), f);
    const px = (x: number, y: number) => out.data[(y * 6 + x) * 4];
    // Minimap pixel p covers cell max(0, floor((2p - 1) / 3)): pixels 0-1 are cell 0, 2 is cell 1.
    expect(px(0, 0)).toBe(200);
    expect(px(1, 1)).toBe(200);
    expect(px(2, 0)).toBe(50);
    expect(px(0, 3)).toBe(50); // pixel 3 -> cell 1
    expect(px(0, 4)).toBe(0); // pixel 4 -> cell 2, never seen
  });
});

describe('fog neighbour code', () => {
  it('packs up, left, self, right, down two bits each from the bottom (0x0203A318)', () => {
    expect(fogCode(0, 0, 0, 0, 0)).toBe(0);
    expect(fogCode(2, 2, 2, 2, 2)).toBe(0b1010101010);
    expect(fogCode(1, 0, 0, 0, 0)).toBe(1);
    expect(fogCode(0, 0, 2, 0, 0)).toBe(0b100000);
    expect(fogCode(0, 0, 0, 0, 1)).toBe(1 << 8);
  });
});
