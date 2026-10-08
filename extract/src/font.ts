import { u16, u32, u8 } from './bytes';
import type { Rgba } from './render';

/**
 * Nitro NFTR fonts. The HUD's variable-width text (unit names) uses
 * `Font/MSMincho-12.NFTR`, despite the name: 11x12 cells, 1bpp. Sections:
 *   PLGC (glyphs): +8 u8 cell w, u8 cell h, u16 bytes per glyph, s8 baseline,
 *     u8 max width, u8 bpp, u8 rotation; glyph bitmaps from +0x10, MSB first,
 *     rows packed with no padding.
 *   HDWC (widths): +8 u16 first glyph, u16 last glyph; from +0x10, 3 bytes per
 *     glyph: s8 left, u8 width, u8 advance.
 *   PAMC (char maps, one per block): +8 u16 first char, u16 last char, u16 type;
 *     data from +0x14. Type 0: u16 first glyph (consecutive); type 1: u16 glyph per
 *     char (0xFFFF none); type 2: u16 count, then (u16 char, u16 glyph) pairs.
 */
export interface Font {
  cellW: number;
  cellH: number;
  bpp: number;
  /** One palette-style value per pixel (0 = empty) per glyph. */
  glyphs: Uint8Array[];
  widths: { left: number; width: number; advance: number }[];
  map: Map<number, number>;
}

export function parseFont(d: Uint8Array): Font {
  // Walk sections by hand: there can be several PAMC blocks.
  const secs = new Map<string, number[]>();
  let o = u16(d, 0x0c);
  for (let i = 0; i < u16(d, 0x0e) && o + 8 <= d.length; i++) {
    const tag = String.fromCharCode(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!);
    secs.set(tag, [...(secs.get(tag) ?? []), o]);
    const size = u32(d, o + 4);
    if (size === 0) break;
    o += size;
  }
  const c = secs.get('PLGC')?.[0];
  const w = secs.get('HDWC')?.[0];
  if (c === undefined || w === undefined) throw new Error('Not an NFTR font');
  const cellW = u8(d, c + 8);
  const cellH = u8(d, c + 9);
  const glyphSize = u16(d, c + 10);
  const bpp = u8(d, c + 14);
  const n = Math.floor((u32(d, c + 4) - 0x10) / glyphSize);
  const glyphs: Uint8Array[] = [];
  for (let g = 0; g < n; g++) {
    const at = c + 0x10 + g * glyphSize;
    const px = new Uint8Array(cellW * cellH);
    for (let p = 0; p < px.length; p++) {
      const bit = p * bpp;
      px[p] = (d[at + (bit >> 3)]! >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
    }
    glyphs.push(px);
  }
  const first = u16(d, w + 8);
  const last = u16(d, w + 10);
  const widths: Font['widths'] = [];
  for (let g = 0; g < n; g++) {
    if (g < first || g > last) {
      widths.push({ left: 0, width: cellW, advance: cellW });
      continue;
    }
    const at = w + 0x10 + (g - first) * 3;
    widths.push({ left: (u8(d, at) << 24) >> 24, width: u8(d, at + 1), advance: u8(d, at + 2) });
  }
  const map = new Map<number, number>();
  for (const m of secs.get('PAMC') ?? []) {
    const lo = u16(d, m + 8);
    const hi = u16(d, m + 10);
    const type = u16(d, m + 12);
    if (type === 0) {
      const g0 = u16(d, m + 0x14);
      for (let k = lo; k <= hi; k++) map.set(k, g0 + k - lo);
    } else if (type === 1) {
      for (let k = lo; k <= hi; k++) {
        const g = u16(d, m + 0x14 + 2 * (k - lo));
        if (g !== 0xffff) map.set(k, g);
      }
    } else {
      const count = u16(d, m + 0x14);
      for (let j = 0; j < count; j++) map.set(u16(d, m + 0x16 + 4 * j), u16(d, m + 0x18 + 4 * j));
    }
  }
  return { cellW, cellH, bpp, glyphs, widths, map };
}

/**
 * Draw a line of text in one color. The HUD adds 1 px between glyphs
 * (confirmed against the in-game "King" label). Returns a cellH-high image.
 */
export function renderText(font: Font, text: string, rgb: [number, number, number], spacing = 1): Rgba {
  const chars = [...text].map((ch) => font.map.get(ch.codePointAt(0)!)).filter((g): g is number => g !== undefined);
  const width = Math.max(1, chars.reduce((s, g) => s + font.widths[g]!.advance + spacing, 0) - spacing);
  const out: Rgba = { width, height: font.cellH, data: new Uint8ClampedArray(width * font.cellH * 4) };
  let cur = 0;
  for (const g of chars) {
    const { left, advance } = font.widths[g]!;
    const px = font.glyphs[g]!;
    for (let p = 0; p < px.length; p++) {
      if (!px[p]) continue;
      const x = cur + left + (p % font.cellW);
      const y = Math.floor(p / font.cellW);
      if (x < 0 || x >= width) continue;
      out.data.set([...rgb, 255], (y * width + x) * 4);
    }
    cur += advance + spacing;
  }
  return out;
}
