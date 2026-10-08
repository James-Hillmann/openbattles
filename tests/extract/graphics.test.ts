import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, decodeChars, decodePalette, metatilePath, parseMap, parseMetatiles, renderMap, renderSheet } from '@lbw/extract';

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16le = (v: number) => [v & 0xff, v >> 8];
const u32le = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

/** Minimal Nitro file: header + one section. */
function nitro(magic: string, tag: string, body: number[]): Uint8Array {
  const sec = [...bytes(tag), ...u32le(8 + body.length), ...body];
  return new Uint8Array([...bytes(magic), 0xff, 0xfe, 0, 1, ...u32le(16 + sec.length), ...u16le(16), ...u16le(1), ...sec]);
}

/** NCLR with the given BGR555 colors. */
const nclr = (colors: number[]) => nitro('RLCN', 'TTLP', [...u32le(3), ...u32le(0), ...u32le(colors.length * 2), ...u32le(0x10), ...colors.flatMap(u16le)]);

/** NCGR with 8bpp (fmt 4) or 4bpp (fmt 3) data. */
const ncgr = (tilesHigh: number, tilesWide: number, fmt: 3 | 4, data: number[]) =>
  nitro('RGCN', 'RAHC', [...u16le(tilesHigh), ...u16le(tilesWide), ...u32le(fmt), ...u32le(0), ...u32le(0), ...u32le(data.length), ...u32le(0x18), ...data]);

describe('Nitro graphics', () => {
  it('decodes BGR555 palettes to RGBA', () => {
    const pal = decodePalette(nclr([0x001f, 0x03e0, 0x7c00]));
    expect([...pal]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it('unpacks 4bpp low nibble first', () => {
    const c = decodeChars(ncgr(1, 1, 3, [0x21, ...new Array(31).fill(0)]));
    expect(c.bpp).toBe(4);
    expect([...c.pixels.slice(0, 3)]).toEqual([1, 2, 0]);
    expect(c.pixels.length).toBe(64);
  });
});

describe('maps', () => {
  /** 2x1 map: terrain [0,3], ground metatiles [1,0]. */
  function mapBytes(): Uint8Array {
    const name = bytes('KingTileset').concat(new Array(32 - 11).fill(0));
    const terrain = [0, 3];
    const extra = [9, 9, 9, 9]; // unknown planes between terrain and ground
    const ground = [...u16le(1), ...u16le(0)];
    return new Uint8Array([...bytes('MAPTERR'), 2, 1, 3, 2, ...name, ...terrain, ...extra, ...ground, ...bytes('RRET'), ...bytes('!PAM')]);
  }

  it('parses size, tileset, terrain and the ground layer', () => {
    const m = parseMap(mapBytes());
    expect([m.width, m.height, m.tileset]).toEqual([2, 1, 'KingTileset']);
    expect([...m.terrain]).toEqual([0, 3]);
    expect([...m.ground]).toEqual([1, 0]);
    expect(metatilePath(m.tileset)).toBe('BP/KingTiles.tbp');
  });

  it('renders 3x2-tile cells with flips and transparency', () => {
    const m = parseMap(mapBytes());
    // Tile 0 fully transparent; tile 1 has color 1 at its top-left pixel only.
    const tile1 = [1, ...new Array(63).fill(0)];
    const chars = decodeChars(ncgr(1, 2, 4, [...new Array(64).fill(0), ...tile1]));
    const pal = decodePalette(nclr([0, 0x001f]));
    // Metatile 0: all transparent. Metatile 1: tile 1 h-flipped in slot 0, rest transparent.
    const tbp = new Uint8Array([...u16le(2), ...new Array(12).fill(0), ...u16le(0x400 | 1), ...new Array(10).fill(0)]);
    const img = renderMap(m, chars, pal, parseMetatiles(tbp));
    expect([img.width, img.height]).toEqual([2 * CELL_W, CELL_H]);
    const at = (x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    expect(at(7, 0)).toEqual([255, 0, 0, 255]); // flipped to the right edge of the tile
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(CELL_W + 7, 0)).toEqual([0, 0, 0, 0]); // metatile 0 is empty
  });
});

describe('unit sheets', () => {
  it('renders a linear 4bpp sheet with a team palette bank', () => {
    const sheet = decodeChars(ncgr(1, 1, 3, [0x10, ...new Array(31).fill(0)]));
    const pal = decodePalette(nclr(new Array(48).fill(0).map((_, i) => (i === 33 ? 0x7c00 : 0))));
    const img = renderSheet(sheet, pal, 2); // bank 2 -> colors 32..47
    expect([...img.data.slice(4, 8)]).toEqual([0, 0, 255, 255]); // pixel 1 = index 1 in bank 2
    expect(img.data[3]).toBe(0); // index 0 transparent
  });
});
