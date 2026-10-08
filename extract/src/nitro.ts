import { ascii, u16, u32 } from './bytes';

/**
 * Nintendo Nitro SDK graphics containers. All share a header:
 *   0x00 magic (reversed 4CC, e.g. "RGCN" for NCGR), 0x04 BOM 0xFEFF,
 *   0x0C u16 header size, 0x0E u16 section count, then tagged sections.
 */
export function sections(d: Uint8Array): Map<string, { offset: number; size: number }> {
  const out = new Map<string, { offset: number; size: number }>();
  let o = u16(d, 0x0c);
  while (o + 8 <= d.length) {
    const size = u32(d, o + 4);
    out.set(ascii(d, o, 4), { offset: o, size });
    if (size === 0) break;
    o += size;
  }
  return out;
}

function section(d: Uint8Array, tag: string) {
  const s = sections(d).get(tag);
  if (!s) throw new Error(`Missing ${tag} section`);
  return s;
}

/** DS colors are 15-bit BGR555. Returns RGBA, 4 bytes per color, all opaque. */
export function decodePalette(nclr: Uint8Array): Uint8Array {
  const { offset } = section(nclr, 'TTLP');
  const size = u32(nclr, offset + 0x10);
  const start = offset + 8 + u32(nclr, offset + 0x14);
  const n = Math.min(size, nclr.length - start) >> 1;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = u16(nclr, start + i * 2);
    out[i * 4] = ((c & 31) * 255) / 31;
    out[i * 4 + 1] = (((c >> 5) & 31) * 255) / 31;
    out[i * 4 + 2] = (((c >> 10) & 31) * 255) / 31;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export interface CharData {
  /** Width and height in 8x8 tiles, as stored in the header. */
  tilesWide: number;
  tilesHigh: number;
  bpp: 4 | 8;
  /** One palette index per pixel, in storage order (tile-by-tile, or linear for bitmaps). */
  pixels: Uint8Array;
}

/** NCGR / NCBR graphics. 4bpp data is unpacked to one byte per pixel (low nibble first). */
export function decodeChars(ncgr: Uint8Array): CharData {
  const { offset } = section(ncgr, 'RAHC');
  const tilesHigh = u16(ncgr, offset + 8);
  const tilesWide = u16(ncgr, offset + 10);
  const fmt = u32(ncgr, offset + 12);
  const size = u32(ncgr, offset + 0x18);
  const start = offset + 8 + u32(ncgr, offset + 0x1c);
  const raw = ncgr.subarray(start, start + size);
  if (fmt === 3) {
    const pixels = new Uint8Array(raw.length * 2);
    for (let i = 0; i < raw.length; i++) {
      pixels[i * 2] = raw[i]! & 15;
      pixels[i * 2 + 1] = raw[i]! >> 4;
    }
    return { tilesWide, tilesHigh, bpp: 4, pixels };
  }
  if (fmt === 4) return { tilesWide, tilesHigh, bpp: 8, pixels: raw.slice() };
  throw new Error(`Unsupported character format ${fmt}`);
}
