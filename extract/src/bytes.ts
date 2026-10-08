/** Little-endian readers. The DS (ARM9/ARM7) is little-endian throughout. */
export const u8 = (b: Uint8Array, o: number): number => {
  if (o < 0 || o >= b.length) throw new RangeError(`u8 read out of range at 0x${o.toString(16)}`);
  return b[o]!;
};
export const u16 = (b: Uint8Array, o: number): number => u8(b, o) | (u8(b, o + 1) << 8);
export const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/** ASCII/latin1, stopping at the first NUL. Avoids TextDecoder so it runs anywhere. */
export function ascii(b: Uint8Array, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = b[o + i];
    if (c === undefined || c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export const hex = (n: number, width = 8): string => '0x' + (n >>> 0).toString(16).padStart(width, '0');

export function indexOf(hay: Uint8Array, needle: readonly number[], from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
export const s16 = (b: Uint8Array, o: number): number => (u16(b, o) << 16) >> 16;
export const s32 = (b: Uint8Array, o: number): number => u32(b, o) | 0;
