import type { CharData } from './nitro';
import { CELL_H, CELL_W, type GameMap } from './map';

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Draw one 8x8 tile from tile-ordered character data. `entry` is a DS BG
 * screen entry: bits 0-9 tile, 10 h-flip, 11 v-flip, 12-15 palette bank
 * (bank only matters for 4bpp). Pixel value 0 is transparent.
 */
function blitTile(out: Rgba, chars: CharData, pal: Uint8Array, entry: number, px: number, py: number): void {
  const tile = entry & 0x3ff;
  const hf = (entry >> 10) & 1;
  const vf = (entry >> 11) & 1;
  const bank = chars.bpp === 4 ? (entry >> 12) * 16 : 0;
  const base = tile * 64;
  if (base + 64 > chars.pixels.length) return;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = chars.pixels[base + (vf ? 7 - y : y) * 8 + (hf ? 7 - x : x)]!;
      if (v === 0) continue;
      const o = ((py + y) * out.width + px + x) * 4;
      const c = (bank + v) * 4;
      out.data[o] = pal[c]!;
      out.data[o + 1] = pal[c + 1]!;
      out.data[o + 2] = pal[c + 2]!;
      out.data[o + 3] = 255;
    }
  }
}

/**
 * Render the ground layer. Cells whose metatile is fully transparent stay
 * transparent: those are where trees and other objects sit (drawn separately later).
 */
export function renderMap(map: GameMap, chars: CharData, pal: Uint8Array, metatiles: Uint16Array): Rgba {
  const out: Rgba = { width: map.width * CELL_W, height: map.height * CELL_H, data: new Uint8ClampedArray(map.width * CELL_W * map.height * CELL_H * 4) };
  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const m = map.ground[cy * map.width + cx]! * 6;
      for (let k = 0; k < 6; k++) {
        const entry = metatiles[m + k];
        if (entry === undefined) continue;
        blitTile(out, chars, pal, entry, cx * CELL_W + (k % 3) * 8, cy * CELL_H + Math.floor(k / 3) * 8);
      }
    }
  }
  return out;
}

/** Unit sprite sheets (Sprites/*.NCBR) are linear 4bpp bitmaps cut into 24x24 frames. */
export const FRAME = 24;

/**
 * Render a whole unit sheet with one palette bank. Bank = team color:
 * even banks are the team colors (0 red, 2 blue, 4 green, 6 orange, 8 magenta,
 * 10 grey), odd banks the same with a selection outline.
 */
export function renderSheet(sheet: CharData, pal: Uint8Array, bank: number): Rgba {
  const width = sheet.tilesWide * 8;
  const height = sheet.tilesHigh * 8;
  const out: Rgba = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let i = 0; i < width * height; i++) {
    const v = sheet.pixels[i]!;
    if (v === 0) continue;
    const c = (bank * 16 + v) * 4;
    out.data.set([pal[c]!, pal[c + 1]!, pal[c + 2]!, 255], i * 4);
  }
  return out;
}
