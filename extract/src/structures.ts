import type { CharData } from './nitro';
import { CELL_H, CELL_W } from './map';
import { blitTile, type Rgba } from './render';

/**
 * Wall and bridge graphics. Both are drawn into the map's BG layer, not as
 * sprites: a wall swaps a cell's six 8x8 tiles for wall tiles picked by which
 * neighbours are walls (0x02034B44), a finished bridge swaps its cells'
 * metatiles (0x0200D8A8). Team colour comes from palette entries 0x37 + 3s ..
 * 0x39 + 3s, which the game overwrites with a 3-colour ramp per palette slot s
 * (0x02034D84). See docs/re-notes/walls-bridges.md.
 *
 * Every slot's tiles are the same art on that slot's own palette entries, so
 * we render slot 0's tiles once per team colour.
 */

/** Where the tables sit in ARM9 RAM, per game code. */
const WALL_TABLE_ADDRS: Record<string, { tileBase: number; ramps: number; odd: number; even: number }> = {
  C5SE: { tileBase: 0x02127cc4, ramps: 0x02127ccc, odd: 0x02127cf0, even: 0x02127d50 },
};

/** First BG palette entry of slot 0's team ramp. confirmed (code + BG palette in the emulator) */
const RAMP_ENTRY = 0x37;
/** Damage offsets added to a wall tile: below 33% HP and below 66%. confirmed (code; tiles seen in the tileset) */
export const WALL_DAMAGE = [0, 0x18, 0x20] as const;
/** Wall tile bytes used by the tables (top row 00/01, bottom row 10/11). */
const WALL_BYTES = [0x00, 0x01, 0x10, 0x11] as const;

/**
 * Bridge metatiles for palette slot 0 (0x0200D8A8): horizontal spans use one for the top row and
 * one for the bottom, vertical spans one for the left column and one for the right. Each slot adds
 * 15. confirmed (code; drawn in the emulator)
 */
export const BRIDGE_METATILES = { hTop: 0xd5, hBottom: 0xda, vLeft: 0xd0, vRight: 0xd1 } as const;
const BRIDGE_ORDER = [BRIDGE_METATILES.hTop, BRIDGE_METATILES.hBottom, BRIDGE_METATILES.vLeft, BRIDGE_METATILES.vRight];

export interface StructureArt {
  /**
   * Wall tiles, one row of 8x8 tiles per team colour (0..5): for each damage step in
   * WALL_DAMAGE, the bytes 00, 01, 10, 11 (12 tiles, 96 px wide).
   */
  wallTiles: Rgba;
  /** Tile bytes per neighbour mask (16 x 6: top row then bottom row; 0xFF = keep the ground) for odd and even x. */
  wallOdd: Uint8Array;
  wallEven: Uint8Array;
  /** Bridge cells, one row per team colour: horizontal top, horizontal bottom, vertical left, vertical right (24x16 each). */
  bridgeCells: Rgba;
}

const bgr555 = (c: number): [number, number, number] => [((c & 31) * 255) / 31, (((c >> 5) & 31) * 255) / 31, (((c >> 10) & 31) * 255) / 31];

/** Read the wall tables from a decompressed ARM9 and draw the tiles. Null for game versions we haven't mapped. */
export function buildStructureArt(
  arm9: Uint8Array, ramAddress: number, gameCode: string, chars: CharData, pal: Uint8Array, metatiles: Uint16Array,
): StructureArt | null {
  const a = WALL_TABLE_ADDRS[gameCode];
  if (!a) return null;
  const at = (addr: number) => addr - ramAddress;
  const u16 = (addr: number) => arm9[at(addr)]! | (arm9[at(addr) + 1]! << 8);
  const base = u16(a.tileBase); // tile = byte + this table's entry; for slot 0 that is entry 0 for every byte
  const wallOdd = arm9.slice(at(a.odd), at(a.odd) + 96);
  const wallEven = arm9.slice(at(a.even), at(a.even) + 96);
  const tilesPerColour = WALL_DAMAGE.length * WALL_BYTES.length;
  const wallTiles: Rgba = { width: tilesPerColour * 8, height: 6 * 8, data: new Uint8ClampedArray(tilesPerColour * 8 * 6 * 8 * 4) };
  const bridgeCells: Rgba = { width: 4 * CELL_W, height: 6 * CELL_H, data: new Uint8ClampedArray(4 * CELL_W * 6 * CELL_H * 4) };
  for (let colour = 0; colour < 6; colour++) {
    const p = pal.slice();
    for (let k = 0; k < 3; k++) p.set([...bgr555(u16(a.ramps + (colour * 3 + k) * 2)), 255], (RAMP_ENTRY + k) * 4);
    let i = 0;
    for (const dmg of WALL_DAMAGE)
      for (const b of WALL_BYTES) blitTile(wallTiles, chars, p, base + b + dmg, i++ * 8, colour * 8);
    BRIDGE_ORDER.forEach((m, j) => {
      for (let k = 0; k < 6; k++) {
        const entry = metatiles[m * 6 + k];
        if (entry !== undefined) blitTile(bridgeCells, chars, p, entry, j * CELL_W + (k % 3) * 8, colour * CELL_H + Math.floor(k / 3) * 8);
      }
    });
  }
  return { wallTiles, wallOdd, wallEven, bridgeCells };
}

/**
 * Neighbour mask of a wall at (x, y) (0x0205DFE0): bit 0 east, 1 north, 2 west, 3 south, set when
 * that cell holds a wall of the same palette slot. The game ORs in the wall's previous mask
 * without the south bit, so a link to the east, north or west stays drawn after that neighbour
 * is gone; a wall left with nothing points north if it used to point south.
 */
export function wallMask(isWall: (x: number, y: number) => boolean, x: number, y: number, old: number): number {
  let m = 0;
  if (isWall(x + 1, y)) m |= 1;
  if (isWall(x, y - 1)) m |= 2;
  if (isWall(x - 1, y)) m |= 4;
  if (isWall(x, y + 1)) m |= 8;
  m |= old & ~8 & 0xf;
  if (m === 0 && old & 8) m = 2;
  return m;
}

/** Damage step (index into WALL_DAMAGE) for a wall's HP: under 33% and under 66%. */
export function wallDamage(hp: number, maxHp: number): number {
  const pct = Math.floor((hp * 100) / Math.max(1, maxHp));
  return pct < 33 ? 2 : pct < 66 ? 1 : 0;
}

/** Index into a StructureArt wall row for a table byte and damage step. */
export const wallTileIndex = (b: number, damage: number): number => damage * WALL_BYTES.length + WALL_BYTES.indexOf(b as (typeof WALL_BYTES)[number]);
