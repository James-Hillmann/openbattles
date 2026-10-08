import { describe, expect, it } from 'vitest';
import {
  MODEL_FRAME_MS,
  basisRotation,
  clipFrame,
  clipFrames,
  modelRow,
  pivotRotation,
  rasterize,
  runClipSelect,
  srtMatrix,
  apply,
  type Material,
  type Triangle,
} from '@lbw/extract';

/** Little-endian u32 words as bytes. */
const words = (ws: number[]) => new Uint8Array(new Uint32Array(ws).buffer);

describe('joint animation rotations', () => {
  it('unpacks a basis rotation: five 13-bit cells, a sixth from the low bits, the rest by cross product', () => {
    // Rows [0, -0.087, 0.996] and [-0.029, 0.996, 0.087]: cell 5 (0x165 = 357) spread over the low 3 bits.
    const cells = [0, -357, 4080, -119, 4079];
    const low = [0, 5, 4, 5, 0]; // word 4's bits are the top of cell 5, then words 0-3
    const d = new Uint8Array(10);
    const v = new DataView(d.buffer);
    cells.forEach((c, i) => v.setInt16(i * 2, (c << 3) | low[i]!, true));
    const m = basisRotation(d, 0);
    expect(m[5]! * 4096).toBeCloseTo(357, 6);
    const r0 = m.slice(0, 3), r1 = m.slice(3, 6), r2 = m.slice(6, 9);
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(r0, r1)).toBeCloseTo(0, 2);
    expect(dot(r0, r2)).toBeCloseTo(0, 2);
    expect(dot(r2, r2)).toBeCloseTo(1, 2);
  });

  it('sign-extends the sixth cell from 13 bits', () => {
    // -133 = 0x1F7B in 13 bits.
    const d = new Uint8Array(10);
    const v = new DataView(d.buffer);
    const low = [7, 5, 7, 3, 1];
    [0, -971, 3977, -4055, -545].forEach((c, i) => v.setInt16(i * 2, (c << 3) | low[i]!, true));
    expect(basisRotation(d, 0)[5]! * 4096).toBeCloseTo(-133, 6);
  });

  it('builds a pivot rotation with the ±1 cell and the 2x2 remainder', () => {
    // Pivot in cell 4 (middle), no negation: rotation about Y.
    const m = pivotRotation(4 << 4, 0.5, 0.25);
    expect(m).toEqual([0.5, 0, 0.25, 0, 1, 0, 0.25, 0, 0.5]);
  });

  it('applies scale before rotation and translation (column-major as stored)', () => {
    const m = srtMatrix({ scale: [2, 2, 2], rot: [0, 1, 0, -1, 0, 0, 0, 0, 1], trans: [10, 0, 0] });
    // Column 0 is (0, 1, 0): x maps to +y.
    expect(apply(m, 1, 0, 0)).toEqual([10, 2, 0]);
  });
});

describe('model clips', () => {
  // A compare tree shaped like the game's (made-up mapping): id 6 -> set 2, 0x1a -> set 4, anything else -> 0.
  const ARM9 = 0x02000000;
  const code = words([
    0xe3500009, // 00 cmp r0, #9
    0xca000003, // 04 bgt (-> 0x18)
    0xe3500006, // 08 cmp r0, #6
    0x0a000004, // 0c beq (-> 0x24)
    0xea000006, // 10 b (-> 0x30)
    0x00000000, // 14 (unused)
    0xe350001a, // 18 cmp r0, #0x1a
    0x0a000005, // 1c beq (-> 0x38)
    0xea000002, // 20 b (-> 0x30)
    0xe3a00002, // 24 mov r0, #2
    0xe12fff1e, // 28 bx lr
    0x00000000, // 2c (unused)
    0xe3a00000, // 30 mov r0, #0
    0xe12fff1e, // 34 bx lr
    0xe3a00004, // 38 mov r0, #4
    0xe12fff1e, // 3c bx lr
  ]);

  it('runs the entity-id switch', () => {
    expect(runClipSelect(code, ARM9, ARM9, 6)).toBe(2);
    expect(runClipSelect(code, ARM9, ARM9, 0x1a)).toBe(4);
    expect(runClipSelect(code, ARM9, ARM9, 3)).toBe(0);
  });

  it('loops clips over [start, end) at 30 fps and holds start == end', () => {
    expect(clipFrames([50, 53])).toEqual([50, 51, 52]);
    expect(clipFrames([60, 60])).toEqual([60]);
    expect(clipFrame([50, 88], 0)).toBe(50);
    expect(clipFrame([50, 88], 37 * MODEL_FRAME_MS)).toBe(87);
    expect(clipFrame([50, 88], 38 * MODEL_FRAME_MS)).toBe(50);
    expect(clipFrame([60, 60], 1e6)).toBe(60);
  });
});

describe('model facing', () => {
  it('turns models to their travel direction in cells, row 0 toward the camera, counter-clockwise', () => {
    expect(modelRow(0, 16, 32)).toBe(0); // down
    expect(modelRow(24, 0, 32)).toBe(8); // right
    expect(modelRow(0, -16, 32)).toBe(16); // up
    expect(modelRow(-24, 0, 32)).toBe(24); // left
    // One cell right and one down is 45 degrees in cells, though not in pixels.
    expect(modelRow(24, 16, 32)).toBe(4);
  });
});

describe('rasterizer', () => {
  it('fills a flat triangle facing the camera with its vertex color', () => {
    const v = (x: number, y: number) => ({ raw: [x, y, 0], pos: [x, y, 0], uv: [0, 0], color: [31, 0, 0], slot: 0 });
    const tri = { material: 0, v: [v(-4, 0), v(4, 0), v(0, 8)] } as unknown as Triangle;
    const mat = { name: 'm', texture: null, source: null, wrap: 0, alpha: 31 } as Material;
    const img = rasterize([tri], [mat], { yaw: 0, pitch: 0, scale: 1, width: 16, height: 16, originX: 8, originY: 12 });
    // Pitch 0 looks straight at it: up in the model is up on screen.
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
    expect(at(8, 9)).toEqual([255, 0, 0, 255]);
    expect(at(1, 1)).toEqual([0, 0, 0, 0]);
  });
});
