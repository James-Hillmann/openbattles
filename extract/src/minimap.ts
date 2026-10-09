import type { UnpackedRom } from './rom';
import { romFile, tryRomFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import type { GameMap } from './map';
import { blitTile, type Rgba } from './render';

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
/** `LS_Maps.NCLR` bank whose colors 1-7 match the King minimap palette; used to find the palettes in other game versions. */
const MINI_BANK = 9;

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

/**
 * Minimap colours per tileset. ARM9 holds three 16-colour BGR555 palettes in a row, for the King,
 * Pirate and Mars tilesets (C5SE 0x0212799C; colours 1-7 of the first equal `LS_Maps` bank 9's). We find them by
 * those seven colours, so other versions work too. Entry 5 is the tree colour.
 */
export const MINI_TILESETS = ['KingTileset', 'PirateTileset', 'MarsTileset'] as const;
export function minimapPalettes(rom: UnpackedRom): Record<string, Uint8Array> | undefined {
  const lsMaps = decodePalette(romFile(rom, 'UI/AllInOne/LS_Maps.NCLR'));
  const want: number[] = [];
  for (let i = 1; i < 8; i++) {
    const o = (MINI_BANK * 16 + i) * 4;
    want.push((lsMaps[o]! >> 3) | ((lsMaps[o + 1]! >> 3) << 5) | ((lsMaps[o + 2]! >> 3) << 10));
  }
  const a = rom.arm9;
  const u16 = (i: number) => (a[i]! | (a[i + 1]! << 8)) & 0x7fff;
  for (let i = 0; i + 32 * MINI_TILESETS.length <= a.length; i += 2) {
    if (!want.every((c, k) => u16(i + 2 + k * 2) === c)) continue;
    const out: Record<string, Uint8Array> = {};
    MINI_TILESETS.forEach((t, n) => {
      const pal = new Uint8Array(64);
      for (let k = 0; k < 16; k++) {
        const c = u16(i + n * 32 + k * 2);
        pal.set([((c & 31) * 255) / 31, (((c >> 5) & 31) * 255) / 31, (((c >> 10) & 31) * 255) / 31, 255], k * 4);
      }
      out[t] = pal;
    });
    return out;
  }
  return undefined;
}

/**
 * The map picker's preview (skirmish and multiplayer map select, docs/re-notes/armies.md "Map
 * select"): `<map>mini.NCGR`, the same 1.5 px per cell picture with the trees baked in, in its
 * tileset's minimap colours (`minimapPalettes`). The file is 128x128; the map fills its top left,
 * so we crop to what's drawn.
 */
export function renderMapPreview(rom: UnpackedRom, mapName: string, pal: Uint8Array): Rgba | undefined {
  const file = tryRomFile(rom, `${mapName}mini.NCGR`);
  if (!file) return undefined;
  const chars = decodeChars(file);
  const full: Rgba = { width: chars.tilesWide * 8, height: chars.tilesHigh * 8, data: new Uint8ClampedArray(chars.tilesWide * chars.tilesHigh * 256) };
  for (let ty = 0; ty < chars.tilesHigh; ty++) {
    for (let tx = 0; tx < chars.tilesWide; tx++) blitTile(full, chars, pal, ty * chars.tilesWide + tx, tx * 8, ty * 8);
  }
  let w = 0;
  let h = 0;
  for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < full.width; x++) {
      if (!full.data[(y * full.width + x) * 4 + 3]) continue;
      w = Math.max(w, x + 1);
      h = Math.max(h, y + 1);
    }
  }
  if (!w) return undefined;
  const out: Rgba = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) out.data.set(full.data.subarray(y * full.width * 4, (y * full.width + w) * 4), y * w * 4);
  return out;
}

/** LOC id of skirmish map mpNN's name: "The Pond" (mp01) at 1241, then every other string (the one between is its unused description). */
export const MAP_TITLE_FIRST = 1241;
export function mapTitleId(mapName: string): number | undefined {
  const m = /^mp(\d+)$/.exec(mapName);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 30 ? MAP_TITLE_FIRST + 2 * (Number(m[1]) - 1) : undefined;
}
