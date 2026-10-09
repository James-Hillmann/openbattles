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
