import type { UnpackedRom } from './rom';
import { romFile, tryRomFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import { blitTile, type Rgba } from './render';

/**
 * Minimap on the HUD's right panel (see docs/re-notes/hud.md):
 * `<map>miniNT.NCGR` ("no trees", 4bpp, 16x16 tiles) with palette
 * `UI/AllInOne/LS_Maps.NCLR` bank 9, drawn 1:1 at (136,40). A map cell is
 * 1.5 px. The game draws trees itself from the live terrain, as a 4x4 pattern
 * of dark green over tree cells, so chopped trees disappear.
 */
export const MINI_PX_PER_CELL = 1.5;
const MINI_BANK = 9;
/** Measured on mp01 (17 of 874 pixels off, all on tree/terrain borders): likely. */
const TREE_PATTERN = [0b0100, 0b1110, 0b0001, 0b1011];
/** BGR555 0x11E5 (r 5, g 15, b 4), expanded like the rest of the repo. */
const TREE_RGB = [5, 15, 4].map((c) => Math.floor((c * 255) / 31)) as [number, number, number];

export function renderMinimap(rom: UnpackedRom, mapName: string, width: number, height: number, terrain: Uint8Array): Rgba | undefined {
  const file = tryRomFile(rom, `${mapName}miniNT.NCGR`);
  if (!file) return undefined;
  const chars = decodeChars(file);
  const pal = decodePalette(romFile(rom, 'UI/AllInOne/LS_Maps.NCLR'));
  const w = Math.ceil(width * MINI_PX_PER_CELL);
  const h = Math.ceil(height * MINI_PX_PER_CELL);
  const out: Rgba = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let ty = 0; ty * 8 < h; ty++) {
    for (let tx = 0; tx * 8 < w; tx++) {
      if (ty < chars.tilesHigh && tx < chars.tilesWide) blitTile(out, chars, pal, (ty * chars.tilesWide + tx) | (MINI_BANK << 12), tx * 8, ty * 8);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.floor((x * 2) / 3);
      const cy = Math.floor((y * 2) / 3);
      if (terrain[cy * width + cx] !== 1 || !((TREE_PATTERN[y & 3]! >> (3 - (x & 3))) & 1)) continue;
      out.data.set([...TREE_RGB, 255], (y * w + x) * 4);
    }
  }
  return out;
}
