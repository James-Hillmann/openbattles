import { describe, expect, it } from 'vitest';
import { ICON_ANIMS, decodeCells, decodeScreen, entityLabels, iconFrame, miniCell, parseFont, parseLang, renderCell, renderText, type CharData } from '@lbw/extract';

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32le = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

/** Nitro file with the given sections, each [tag, body]. */
function nitro(magic: string, secs: [string, number[]][]): Uint8Array {
  const body = secs.flatMap(([tag, b]) => [...bytes(tag), ...u32le(8 + b.length), ...b]);
  return new Uint8Array([...bytes(magic), 0xff, 0xfe, 0, 1, ...u32le(16 + body.length), ...u16le(16), ...u16le(secs.length), ...body]);
}

describe('LANG text', () => {
  it('reads the offset table and NUL-terminated strings', () => {
    const strings = ['King', 'Queen'];
    const tableEnd = 0x10 + strings.length * 4;
    const offs: number[] = [];
    let o = tableEnd;
    for (const s of strings) {
      offs.push(o);
      o += s.length + 1;
    }
    const d = new Uint8Array([...bytes('LANG'), ...u32le(0), ...u32le(0), ...u32le(0), ...offs.flatMap(u32le), ...strings.flatMap((s) => [...bytes(s), 0])]);
    expect(parseLang(d)).toEqual(strings);
  });

  it('names entities by global id - 1 and stops where the record index stops counting', () => {
    const d = new Uint8Array(0xfa08 + 16);
    const rec = (i: number, nameOff: number, gid: number, hp: number) => {
      const o = 4 + i * 0x7c;
      d.set(u16le(nameOff), o);
      d.set(u16le(i), o + 4);
      d.set(u16le(gid), o + 6);
      d.set(u16le(hp), o + 0x62);
    };
    rec(0, 0, 2, 1000);
    rec(1, 7, 3, 350);
    d.set(u16le(9), 4 + 2 * 0x7c + 4); // third record's index is wrong: table ends
    d.set([...bytes('K_King'), 0, ...bytes('K_Sw'), 0], 0xfa08);
    expect(entityLabels(d, ['x', 'King', 'Guardsman'])).toEqual([
      { id: 'K_King', display: 'King', maxHp: 1000 },
      { id: 'K_Sw', display: 'Guardsman', maxHp: 350 },
    ]);
  });
});

describe('NSCR / NCER', () => {
  it('decodes screen entries row-major', () => {
    const s = decodeScreen(nitro('RCSN', [['NRCS', [...u16le(16), ...u16le(8), ...u32le(0), ...u32le(4), ...u16le(0x6001), ...u16le(0x0402)]]]));
    expect(s).toMatchObject({ tilesWide: 2, tilesHigh: 1 });
    expect([...s.entries]).toEqual([0x6001, 0x0402]);
  });

  it('assembles a cell from OAM entries with flips and 1D tile numbers', () => {
    // One cell, 8-byte entries, two 8x8 4bpp sprites: tile 0 at (-8,-8), tile 1 h-flipped at (0,-8).
    const oam = (y: number, x: number, flags1: number, tile: number) => [...u16le(y & 0xff), ...u16le((x & 0x1ff) | flags1), ...u16le(tile)];
    const kbec = [...u16le(1), ...u16le(0), ...u32le(16), ...u32le(0), ...u32le(0), ...u16le(2), ...u16le(0), ...u32le(0), ...oam(-8, -8, 0, 0), ...oam(-8, 0, 0x1000, 1)];
    const cells = decodeCells(nitro('RECN', [['KBEC', kbec]]));
    expect(cells[0]!.map((p) => [p.x, p.y, p.w, p.h, p.tile, p.hflip])).toEqual([
      [-8, -8, 8, 8, 0, false],
      [0, -8, 8, 8, 1, true],
    ]);
    const pixels = new Uint8Array(128);
    pixels[0] = 1; // tile 0, top-left
    pixels[64] = 2; // tile 1, top-left -> top-right after the flip
    const chars: CharData = { tilesWide: 2, tilesHigh: 1, bpp: 4, pixels };
    const pal = new Uint8Array(16 * 4);
    pal.set([255, 0, 0, 255], 4);
    pal.set([0, 0, 255, 255], 8);
    const img = renderCell(cells[0]!, chars, pal);
    expect([img.width, img.height]).toEqual([16, 8]);
    expect([...img.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...img.data.slice(15 * 4, 16 * 4)]).toEqual([0, 0, 255, 255]);
    expect(img.data[1 * 4 + 3]).toBe(0);
  });
});

describe('NFTR fonts', () => {
  it('draws 1bpp glyphs with per-glyph advance and 1 px spacing', () => {
    // 3x2 cells, 1 byte per glyph. Glyph 0 'A': top row filled; glyph 1 'B': bottom-left pixel.
    const plgc = [3, 2, ...u16le(1), 2, 3, 1, 0, 0b11100000, 0b00010000];
    const hdwc = [...u16le(0), ...u16le(1), ...u32le(0), 0, 3, 3, 0, 1, 2];
    const pamc = [...u16le(65), ...u16le(66), ...u16le(0), 0, 0, ...u32le(0), ...u16le(0), 0, 0];
    const f = parseFont(nitro('RTFN', [['FNIF', [0, 0, 0, 0]], ['PLGC', plgc], ['HDWC', hdwc], ['PAMC', pamc]]));
    expect(f.map.get(66)).toBe(1);
    const img = renderText(f, 'AB', [255, 255, 255]);
    expect(img.width).toBe(3 + 1 + 2);
    const lit = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3] === 255;
    expect([lit(0, 0), lit(2, 0), lit(3, 0), lit(4, 1)]).toEqual([true, true, false, true]);
  });
});

describe('minimap and icon timing', () => {
  it('maps minimap pixels to map cells at 1.5 px per cell', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(miniCell)).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });

  it('steps the status icons through their measured frame tables', () => {
    expect([0, 124, 125, 499, 500].map((t) => iconFrame('bricks', t))).toEqual([0, 0, 1, 3, 0]);
    expect(iconFrame('star', 999)).toBe(11);
    expect(iconFrame('minifigs', 800 + 400)).toBe(6);
    expect(ICON_ANIMS.minifigs.frames[6]).toBe(4);
  });
});
