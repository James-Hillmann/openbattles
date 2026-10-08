import { u8, u32 } from './bytes';

/**
 * "BLZ" / backwards LZ77, Nintendo's code compression for ARM9 and overlays.
 * It's ordinary LZ77 run from the end of the buffer toward the start, so the
 * game can decompress in place. Layout (from the end of the data):
 *
 *   [-4..-1] u32 extra bytes the output grows by
 *   [-5]     header (footer) length, usually 8 plus padding
 *   [-8..-6] u24 length of the compressed region, footer included
 *
 * Bytes before the compressed region are stored raw and copied as-is.
 * Implementation follows the well-known CUE "blz" decoder: reverse the
 * compressed region, decode it forwards, reverse the output.
 */
export function blzDecompress(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n < 8) throw new Error('BLZ data too short');
  const incLen = u32(data, n - 4);
  if (incLen === 0) return data.slice(); // stored uncompressed
  const hdrLen = u8(data, n - 5);
  const encLen = u32(data, n - 8) & 0xffffff;
  if (hdrLen < 8 || hdrLen > 0x0b || encLen > n || encLen < hdrLen) throw new Error('BLZ footer looks invalid');

  const decLen = n - encLen; // raw prefix
  const pakLen = encLen - hdrLen;
  const rawLen = n + incLen;
  const out = new Uint8Array(rawLen);
  out.set(data.subarray(0, decLen));

  const pak = data.slice(decLen, decLen + pakLen).reverse();
  const raw = new Uint8Array(rawLen - decLen);
  let pi = 0;
  let ri = 0;
  let flags = 0;
  let mask = 0;
  while (ri < raw.length) {
    mask >>>= 1;
    if (mask === 0) {
      if (pi >= pak.length) break;
      flags = pak[pi++]!;
      mask = 0x80;
    }
    if ((flags & mask) === 0) {
      if (pi >= pak.length) break;
      raw[ri++] = pak[pi++]!;
    } else {
      if (pi + 1 >= pak.length) break;
      const info = (pak[pi]! << 8) | pak[pi + 1]!;
      pi += 2;
      let len = (info >>> 12) + 3;
      const disp = (info & 0xfff) + 3;
      if (disp > ri) throw new Error('BLZ back-reference before start of output');
      if (ri + len > raw.length) len = raw.length - ri;
      for (; len > 0; len--, ri++) raw[ri] = raw[ri - disp]!;
    }
  }
  if (ri !== raw.length) throw new Error(`BLZ decoded ${ri} of ${raw.length} bytes`);
  out.set(raw.reverse(), decLen);
  return out;
}
