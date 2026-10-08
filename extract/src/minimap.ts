import type { UnpackedRom } from './rom';
import { tryRomFile } from './bundle';
import { decodeChars } from './nitro';
import type { GameMap } from './map';
import type { Rgba } from './render';

/**
 * Minimap on the HUD's right panel (see docs/re-notes/hud.md):
 * `<map>miniNT.NCGR` ("no trees", 4bpp tiles) drawn 1:1 at (136,40), 1.5 px
 * per map cell, with a 16-color palette per tileset kept in ARM9. The game
 * draws trees itself from the live terrain, as a 4x4 pattern in palette
 * color 5 over tree cells, so chopped trees disappear. Checked against the
 * emulator on mp01 (King, exact), mp02 (Mars, 3 of 863 pixels off) and
 * mp03 (Pirate, 4 of 839 off).
 */
export const MINI_PX_PER_CELL = 1.5;
const TREE_PATTERN = [0b0100, 0b1110, 0b0001, 0b1011];
const TREE_COLOR = 5;

/** ARM9 RAM addresses per game code: 16 BGR555 colors each. */
const MINIMAP_ADDRS: Record<string, { palettes: Record<string, number>; dots: number }> = {
  C5SE: {
    palettes: { KingTileset: 0x0212799c, PirateTileset: 0x021279bc, MarsTileset: 0x021279dc },
    // Dot colors: 4 red (measured on the red team), 5 blue (likely); 0 green, 1 yellow, 2 magenta, 3 black (team order a guess).
    dots: 0x0212797c,
  },
};

const bgr555 = (c: number): [number, number, number] => [((c & 31) * 255) / 31, (((c >> 5) & 31) * 255) / 31, (((c >> 10) & 31) * 255) / 31].map(Math.floor) as [number, number, number];

function arm9Colors(rom: UnpackedRom, addr: number, n: number): [number, number, number][] {
  const o = addr - rom.header.arm9.ramAddress;
  return Array.from({ length: n }, (_, i) => bgr555(rom.arm9[o + 2 * i]! | (rom.arm9[o + 2 * i + 1]! << 8)));
}

/** Minimap dot color per palette index (see MINIMAP_ADDRS), or undefined for unmapped game versions. */
export function minimapDotColors(rom: UnpackedRom): [number, number, number][] | undefined {
  const a = MINIMAP_ADDRS[rom.header.gameCode];
  return a && arm9Colors(rom, a.dots, 8);
}

/** Map cell under minimap pixel `p` (same rule on both axes): max(0, floor((2p - 1) / 3)). */
export const miniCell = (p: number): number => Math.max(0, Math.floor((2 * p - 1) / 3));

/**
 * Tree cells bordering rough ground to the east or south (edges bits 4 and 6) are left out.
 * That matches every pixel on mp01 and all but 3-4 per map on mp02/mp03, whose misses sit on such borders: likely.
 */
const NO_TREE_EDGES = (1 << 4) | (1 << 6);

export function renderMinimap(rom: UnpackedRom, mapName: string, map: Pick<GameMap, 'tileset' | 'width' | 'height' | 'terrain' | 'edges'>): Rgba | undefined {
  const { tileset, width, height, terrain, edges } = map;
  const file = tryRomFile(rom, `${mapName}miniNT.NCGR`);
  const addr = MINIMAP_ADDRS[rom.header.gameCode]?.palettes[tileset];
  if (!file || addr === undefined) return undefined;
  const chars = decodeChars(file);
  const pal = arm9Colors(rom, addr, 16);
  const w = Math.ceil(width * MINI_PX_PER_CELL);
  const h = Math.ceil(height * MINI_PX_PER_CELL);
  const out: Rgba = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number;
      const i = miniCell(y) * width + miniCell(x);
      if (terrain[i] === 1 && !(edges[i]! & NO_TREE_EDGES) && (TREE_PATTERN[y & 3]! >> (3 - (x & 3))) & 1) v = TREE_COLOR;
      else {
        // 8x8 tiles, row-major across the sheet.
        const tx = x >> 3;
        const ty = y >> 3;
        if (tx >= chars.tilesWide || ty >= chars.tilesHigh) continue;
        v = chars.pixels[(ty * chars.tilesWide + tx) * 64 + (y & 7) * 8 + (x & 7)] ?? 0;
      }
      if (v === 0) continue;
      out.data.set([...pal[v]!, 255], (y * w + x) * 4);
    }
  }
  return out;
}
