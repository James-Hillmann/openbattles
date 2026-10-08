import { ascii, u32 } from './bytes';
import { lzDecompress } from './lz';

/**
 * "PMOC" container ("COMP" read as a little-endian u32), used by LEGO Battles
 * for most of its own data (maps, blueprints, tile graphics). Layout (confirmed
 * on C5SE by decoding every PMOC file to its stated size):
 *
 *   0x00 "PMOC"
 *   0x04 u32 total decompressed size
 *   0x08 u32 chunk count N
 *   0x0C u32 largest compressed chunk size (a buffer-size hint)
 *   0x10 i32[N] size of each chunk in the file
 *   then N chunks back to back, each an LZ11 stream of up to 0x1000 bytes.
 *   A negative size -n means n bytes stored raw (seen on files that don't compress).
 */
export function isPmoc(data: Uint8Array): boolean {
  return data.length >= 0x10 && ascii(data, 0, 4) === 'PMOC';
}

export function pmocDecompress(data: Uint8Array): Uint8Array {
  if (!isPmoc(data)) throw new Error('Not a PMOC container');
  const total = u32(data, 4);
  const count = u32(data, 8);
  if (count > 0x10000) throw new Error('PMOC chunk count implausible');
  const out = new Uint8Array(total);
  let p = 0x10 + count * 4;
  let o = 0;
  for (let i = 0; i < count; i++) {
    const raw = u32(data, 0x10 + i * 4) | 0;
    const size = Math.abs(raw);
    const chunk = raw < 0 ? data.subarray(p, p + size) : lzDecompress(data.subarray(p, p + size));
    if (o + chunk.length > total) throw new Error('PMOC chunks exceed stated size');
    out.set(chunk, o);
    o += chunk.length;
    p += size;
  }
  if (o !== total) throw new Error(`PMOC decoded ${o} of ${total} bytes`);
  return out;
}
