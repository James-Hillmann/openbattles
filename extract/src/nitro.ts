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

export interface ScreenData {
  /** Size in 8x8 tiles. */
  tilesWide: number;
  tilesHigh: number;
  /** DS BG screen entries, row-major: bits 0-9 tile, 10 h-flip, 11 v-flip, 12-15 palette bank. */
  entries: Uint16Array;
}

/** NSCR tile maps: section `NRCS`, +0x08 u16 width px, +0x0A u16 height px, +0x10 u32 data size, +0x14 entries. */
export function decodeScreen(nscr: Uint8Array): ScreenData {
  const { offset } = section(nscr, 'NRCS');
  const width = u16(nscr, offset + 8);
  const height = u16(nscr, offset + 10);
  const size = u32(nscr, offset + 0x10);
  const entries = new Uint16Array(size >> 1);
  for (let i = 0; i < entries.length; i++) entries[i] = u16(nscr, offset + 0x14 + i * 2);
  return { tilesWide: width >> 3, tilesHigh: height >> 3, entries };
}

/** One hardware sprite (OAM entry) inside a cell. */
export interface CellPart {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tile number in 32-byte units (an 8bpp tile counts as 2). */
  tile: number;
  bpp8: boolean;
  hflip: boolean;
  vflip: boolean;
  bank: number;
}

/** OAM shape x size -> [w, h] in pixels. */
const OBJ_SIZES: Record<number, [number, number][]> = {
  0: [[8, 8], [16, 16], [32, 32], [64, 64]],
  1: [[16, 8], [32, 8], [32, 16], [64, 32]],
  2: [[8, 16], [8, 32], [16, 32], [32, 64]],
};

/**
 * NCER cell banks (section `KBEC`). Header at section +8: u16 cell count, u16 attr
 * (1 = 16-byte cell entries with a bounding box, else 8), u32 offset of the cell
 * table from +8. Each cell entry: u16 OAM count, u16 attr, u32 offset of its OAM
 * entries from the end of the cell table. OAM entries are the hardware's 3 x u16.
 */
export function decodeCells(ncer: Uint8Array): CellPart[][] {
  const { offset } = section(ncer, 'KBEC');
  const b = offset + 8;
  const n = u16(ncer, b);
  const entrySize = u16(ncer, b + 2) === 1 ? 16 : 8;
  const table = b + u32(ncer, b + 4);
  const oamBase = table + n * entrySize;
  const cells: CellPart[][] = [];
  for (let i = 0; i < n; i++) {
    const count = u16(ncer, table + i * entrySize);
    const at = oamBase + u32(ncer, table + i * entrySize + 4);
    const parts: CellPart[] = [];
    for (let k = 0; k < count; k++) {
      const a0 = u16(ncer, at + k * 6);
      const a1 = u16(ncer, at + k * 6 + 2);
      const a2 = u16(ncer, at + k * 6 + 4);
      const [w, h] = OBJ_SIZES[a0 >> 14]![a1 >> 14]!;
      const affine = (a0 & 0x100) !== 0;
      parts.push({
        x: (a1 & 0x1ff) >= 256 ? (a1 & 0x1ff) - 512 : a1 & 0x1ff,
        y: (a0 & 0xff) >= 128 ? (a0 & 0xff) - 256 : a0 & 0xff,
        w,
        h,
        tile: a2 & 0x3ff,
        bpp8: (a0 & 0x2000) !== 0,
        hflip: !affine && (a1 & 0x1000) !== 0,
        vflip: !affine && (a1 & 0x2000) !== 0,
        bank: a2 >> 12,
      });
    }
    cells.push(parts);
  }
  return cells;
}
