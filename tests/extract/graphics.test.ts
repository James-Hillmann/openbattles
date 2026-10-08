import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, DETAIL_BASE, bakeTrees, treeKey, treeMetatile, type GameMap, type TreeTable, detailTilesPath, withDetailTiles, decodeChars, decodePalette, metatilePath, parseMap, parseMetatiles, renderMap, renderSheet } from '@lbw/extract';

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
    const edges = [0, 0];
    const regions = [0, 0];
    const treeRuns = [...u16le(2), 1, 1]; // 1 open cell, then 1 tree
    const ground = [...u16le(1), ...u16le(0)];
    return new Uint8Array([...bytes('MAPTERR'), 2, 1, 3, 2, ...name, ...terrain, ...edges, ...regions, ...treeRuns, ...ground, ...bytes('RRET'), ...bytes('MINE'), 0x4c, 0, 0x4c, 1, 5, 7, 0x4c, 0, 0x4c, 0, ...bytes('!PAM')]);
  }

  it('parses size, tileset, terrain and the ground layer', () => {
    const m = parseMap(mapBytes());
    expect([m.width, m.height, m.tileset]).toEqual([2, 1, 'KingTileset']);
    expect([...m.terrain]).toEqual([0, 3]);
    expect([...m.ground]).toEqual([1, 0]);
    expect([...m.trees]).toEqual([0, 1]);
    expect(m.mineSites).toEqual([{ x: 5, y: 7 }]);
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

describe('detail tiles', () => {
  it('overlays the map detail table from id 440', () => {
    const base = new Uint16Array(500 * 6).fill(1);
    const detail = new Uint16Array([7, 7, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9]);
    const t = withDetailTiles(base, detail);
    expect(t[439 * 6]).toBe(1);
    expect(t[DETAIL_BASE * 6]).toBe(7);
    expect(t[(DETAIL_BASE + 1) * 6 + 5]).toBe(9);
    expect(t[(DETAIL_BASE + 2) * 6]).toBe(1);
    expect(base[DETAIL_BASE * 6]).toBe(1);
    expect(detailTilesPath('mp01')).toBe('BP/DetailTiles_mp01.tbp');
  });
});

describe('trees', () => {
  /** 3x3 map, everything a tree except the top-left cell (terrain already baked: 1 = tree). */
  const map: GameMap = {
    width: 3, height: 3, tileset: 'KingTileset',
    terrain: new Uint8Array([0, 1, 1, 1, 1, 1, 1, 1, 1]), edges: new Uint8Array(9), regions: new Uint8Array(9),
    trees: new Uint8Array([0, 1, 1, 1, 1, 1, 1, 1, 1]), ground: new Uint16Array(9).fill(116), mineSites: [],
  };

  it('keys a cell by its 3x3 neighbourhood, 2 bits per cell, off-map counts as tree', () => {
    // Centre cell: only NW (slot 0) is open, every other slot is tree (1).
    expect(treeKey(map, map.terrain, 1, 1)).toBe(0b010101010101010100);
    // Bottom-right corner: off-map neighbours count as tree, so all nine slots are 1.
    expect(treeKey(map, map.terrain, 2, 2)).toBe(0b010101010101010101);
    // A rough-edge bit turns that neighbour into 2. Bit 1 = N.
    const rough = { ...map, edges: new Uint8Array(9).fill(0b10) };
    expect(treeKey(rough, map.terrain, 1, 2) >> 2 & 3).toBe(2);
  });

  it('looks keys up in range tables with a fallback', () => {
    const t: TreeTable = { bases: new Uint32Array([0, 100]), lengths: new Uint16Array([2, 3]), tables: [new Uint8Array([5, 0xff]), new Uint8Array([7, 8, 9])], fallback: 6 };
    expect(treeMetatile(t, 0)).toBe(5);
    expect(treeMetatile(t, 1)).toBe(6); // 0xff entry
    expect(treeMetatile(t, 50)).toBe(6); // past the first table's length
    expect(treeMetatile(t, 102)).toBe(9);
  });

  it('bakes trees into terrain and ground, but only on open ground', () => {
    const t: TreeTable = { bases: new Uint32Array([0]), lengths: new Uint16Array([0]), tables: [new Uint8Array()], fallback: 6 };
    const raw = { ...map, terrain: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 3]) }; // a "tree" on water stays water
    const b = bakeTrees(raw, t);
    expect([...b.terrain]).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 3]);
    expect(b.ground[8]).toBe(116);
    expect(b.ground[0]).toBe(116);
    expect(b.ground[4]).toBe(6);
    expect(map.ground[4]).toBe(116);
  });
});
