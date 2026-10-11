import type { UnpackedRom } from './rom';
import { romFile, tryRomFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';

/**
 * Fog of war pictures (docs/re-notes/fog.md "Drawing"). The game draws fog on main BG2 from
 * `FoWTileset.NCGR` (256 8bpp tiles), in colours 0-15 of the map's tileset palette. Each map cell
 * is 3 x 2 tiles; which six tiles it gets comes from the fog state of the cell and its four
 * neighbours, through two tables in ARM9.
 */
export interface FogArt {
  /** FoWTileset: 256 tiles of 8 x 8 palette indices (0 = see-through), tile after tile. */
  tiles: Uint8Array;
  /** Cell pictures: 6 tile numbers each, the top row left to right, then the bottom row. */
  cells: Uint8Array;
  /** Neighbour code (see `fogCode`) -> cell picture. 1024 entries. */
  codes: Uint8Array;
  /** Colours 0-15 of the map's tileset palette, RGBA. */
  palette: Uint8Array;
  /** Colour cycles of the map's tileset palette (see `TILESET_CYCLES`). */
  cycles: readonly PaletteCycle[];
}

/** Colours first..last turn one step every `period` game ticks: colour i takes colour i + 1's value, last takes first's. */
export interface PaletteCycle {
  first: number;
  last: number;
  period: number;
}

/**
 * Palette cycles per tileset, set up when a map loads (C5SE 0x02038980; the tileset is picked by
 * name at 0x020A44A0) and run by 0x02028590. Colours 8-15 are the fog's; the others are water
 * and lava on the ground layer. Confirmed: rotation and rate watched in palette RAM on mp01.
 */
export const TILESET_CYCLES: Record<string, readonly PaletteCycle[]> = {
  KingTileset: [
    { first: 8, last: 15, period: 2 },
    { first: 16, last: 39, period: 3 },
    { first: 40, last: 47, period: 3 },
    { first: 67, last: 71, period: 3 },
    { first: 239, last: 244, period: 2 },
  ],
  PirateTileset: [
    { first: 8, last: 15, period: 2 },
    { first: 16, last: 39, period: 3 },
    { first: 40, last: 47, period: 3 },
    { first: 199, last: 204, period: 3 },
  ],
  MarsTileset: [
    { first: 8, last: 15, period: 2 },
    { first: 16, last: 39, period: 3 },
    { first: 40, last: 47, period: 3 },
    { first: 71, last: 79, period: 3 },
  ],
};

/** ARM9 addresses per game code: the cell pictures (48 x 6 bytes) and the code table (1024 bytes). */
const FOG_TABLES: Record<string, { cells: number; codes: number; count: number }> = {
  C5SE: { cells: 0x0213c6fc, codes: 0x0213c81c, count: 48 },
};

/** Fog state of one cell: 0 never seen, 1 seen before, 2 seen now. */
export type FogState = 0 | 1 | 2;

/**
 * The game's neighbour code for a cell (0x0203A318): two bits per cell for the cell above, left,
 * itself, right and below, lowest bits first. Cells off the map count as never seen.
 */
export function fogCode(up: FogState, left: FogState, self: FogState, right: FogState, down: FogState): number {
  return up | (left << 2) | (self << 4) | (right << 6) | (down << 8);
}

export function readFogArt(rom: UnpackedRom, tileset: string): FogArt | undefined {
  const t = FOG_TABLES[rom.header.gameCode];
  const file = tryRomFile(rom, 'FoWTileset.NCGR');
  if (!t || !file) return undefined;
  const chars = decodeChars(file);
  if (chars.bpp !== 8) return undefined;
  const base = rom.header.arm9.ramAddress;
  const cells = rom.arm9.slice(t.cells - base, t.cells - base + t.count * 6);
  const codes = rom.arm9.slice(t.codes - base, t.codes - base + 1024);
  const palette = decodePalette(romFile(rom, `${tileset}.NCLR`)).slice(0, 16 * 4);
  return { tiles: chars.pixels, cells, codes, palette, cycles: TILESET_CYCLES[tileset] ?? [] };
}
