import { ascii, u16 } from './bytes';

/**
 * A LEGO Battles map (the MAPT payload of Maps/*.map, after PMOC unwrapping).
 * See docs/re-notes/formats.md. Only the parts we understand are decoded.
 */
export interface GameMap {
  width: number;
  height: number;
  /** e.g. "KingTileset"; graphics are <name>.NCGR/.NCLR, metatiles BP/<King>Tiles.tbp */
  tileset: string;
  /** One logical terrain code per cell (0 open ground, 3 water, ... see notes). */
  terrain: Uint8Array;
  /** One metatile index per cell into the tileset's .tbp table. */
  ground: Uint16Array;
}

/** Each map cell is a 3x2 block of 8x8 tiles. */
export const CELL_W = 24;
export const CELL_H = 16;

export function parseMap(d: Uint8Array): GameMap {
  if (ascii(d, 0, 7) !== 'MAPTERR') throw new Error('Not a MAPT map');
  const width = d[7]!;
  const height = d[8]!;
  const tileset = ascii(d, 0x0b, 32);
  const n = width * height;
  const terrain = d.slice(0x2b, 0x2b + n);
  // The ground layer is the last block of the TERR section, which is closed by "RRET".
  const end = indexOfTag(d, 'RRET');
  const groundStart = end - n * 2;
  if (groundStart < 0x2b + n) throw new Error('TERR section too short');
  const ground = new Uint16Array(n);
  for (let i = 0; i < n; i++) ground[i] = u16(d, groundStart + i * 2);
  return { width, height, tileset, terrain, ground };
}

function indexOfTag(d: Uint8Array, tag: string): number {
  const t = [...tag].map((c) => c.charCodeAt(0));
  for (let i = 0; i + 4 <= d.length; i++) {
    if (d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2] && d[i + 3] === t[3]) return i;
  }
  throw new Error(`Tag ${tag} not found`);
}

/** Metatile table (BP/<X>Tiles.tbp): u16 count, then count x 6 BG screen entries (3 wide, 2 high). */
export function parseMetatiles(tbp: Uint8Array): Uint16Array {
  const count = u16(tbp, 0);
  const out = new Uint16Array(count * 6);
  for (let i = 0; i < out.length; i++) out[i] = u16(tbp, 2 + i * 2);
  return out;
}

/** "KingTileset" -> "BP/KingTiles.tbp" */
export const metatilePath = (tileset: string) => `BP/${tileset.replace(/Tileset$/, 'Tiles')}.tbp`;
