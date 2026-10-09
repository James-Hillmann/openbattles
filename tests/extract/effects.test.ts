import { describe, expect, it } from 'vitest';
import { decodeHps, spriteRect } from '@lbw/extract';

const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32le = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

describe('particle effects', () => {
  it('decodes .hps frames of 16-byte particles', () => {
    const p = [...u16le(-3 & 0xffff), ...u16le(5), ...u16le(12), ...u16le(0x4000), 30, 29, 28, 20, ...u32le(0xb610395a)];
    const d = new Uint8Array([...u32le(2), ...u32le(0x28000), ...u32le(0), ...u32le(1), ...p]);
    expect(decodeHps(d)).toEqual([[], [{ x: -3, y: 5, size: 12, rot: 0x4000, r: 30, g: 29, b: 28, a: 20, sprite: 'b610395a' }]]);
  });

  it('rejects trailing bytes', () => {
    expect(() => decodeHps(new Uint8Array([...u32le(0), ...u32le(0), 1]))).toThrow(/trailing/);
  });

  it('finds a sprite rectangle by hash in UIMgrData records', () => {
    const rec = (h: number, x: number, y: number) => [...u32le(h), ...u16le(x), ...u16le(y), ...u16le(16), ...u16le(16), ...new Array(16).fill(0)];
    const ui = new Uint8Array([...rec(0x6e812efd, 0, 48), ...rec(0x6e812efc, 16, 48)]);
    expect(spriteRect(ui, 0x6e812efc)).toEqual({ x: 16, y: 48, w: 16, h: 16 });
    expect(spriteRect(ui, 1)).toBeUndefined();
  });
});
