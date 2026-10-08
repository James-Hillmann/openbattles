import { u8 } from './bytes';

/**
 * Nintendo BIOS-style LZ77 (type 0x10) and its extended variant LZ11 (0x11).
 * Header: 1 type byte + u24 decompressed size (if 0, a u32 size follows).
 * Then groups of 8 blocks, each preceded by a flag byte read MSB-first:
 * 0 = literal byte, 1 = back-reference into already-decoded output.
 */
export function lzDecompress(src: Uint8Array): Uint8Array {
  const type = u8(src, 0);
  if (type !== 0x10 && type !== 0x11) throw new Error(`Not LZ10/LZ11 (type 0x${type.toString(16)})`);
  let size = u8(src, 1) | (u8(src, 2) << 8) | (u8(src, 3) << 16);
  let p = 4;
  if (size === 0) {
    size = (u8(src, 4) | (u8(src, 5) << 8) | (u8(src, 6) << 16) | (u8(src, 7) << 24)) >>> 0;
    p = 8;
  }
  const out = new Uint8Array(size);
  let o = 0;
  while (o < size) {
    const flags = u8(src, p++);
    for (let bit = 0x80; bit && o < size; bit >>= 1) {
      if (!(flags & bit)) {
        out[o++] = u8(src, p++);
        continue;
      }
      let len: number;
      let disp: number;
      const b0 = u8(src, p++);
      if (type === 0x10) {
        const b1 = u8(src, p++);
        len = (b0 >> 4) + 3;
        disp = (((b0 & 0xf) << 8) | b1) + 1;
      } else {
        const ind = b0 >> 4;
        if (ind === 0) {
          const b1 = u8(src, p++);
          const b2 = u8(src, p++);
          len = (((b0 & 0xf) << 4) | (b1 >> 4)) + 0x11;
          disp = (((b1 & 0xf) << 8) | b2) + 1;
        } else if (ind === 1) {
          const b1 = u8(src, p++);
          const b2 = u8(src, p++);
          const b3 = u8(src, p++);
          len = (((b0 & 0xf) << 12) | (b1 << 4) | (b2 >> 4)) + 0x111;
          disp = (((b2 & 0xf) << 8) | b3) + 1;
        } else {
          const b1 = u8(src, p++);
          len = ind + 1;
          disp = (((b0 & 0xf) << 8) | b1) + 1;
        }
      }
      if (disp > o) throw new Error('LZ back-reference before start of output');
      for (; len > 0 && o < size; len--, o++) out[o] = out[o - disp]!;
    }
  }
  return out;
}
