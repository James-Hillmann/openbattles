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
  /** Per-cell 8-neighbour bitmask of rough-ground edges (bit order: NW, N, NE, W, E, SW, S, SE). */
  edges: Uint8Array;
  /** Per-cell region/feature id (meaning partly open, see notes). */
  regions: Uint8Array;
  /** 1 where a tree stands at map start. Trees are baked into terrain and ground by bakeTrees(). */
  trees: Uint8Array;
  /** One metatile index per cell into the tileset's .tbp table. */
  ground: Uint16Array;
  /** Cells where a Mine can be built (top-left of the site). The site marking itself is part of the ground tiles. */
  mineSites: { x: number; y: number }[];
  /** Bridge sites (MARK lists 7 and 8): the top-left cell of the span and its direction. */
  bridgeMarks: { x: number; y: number; vertical: boolean }[];
  /** Starting units and buildings per start slot, in file order (EVNT section). */
  starts: StartRecord[];
  /** Pickups placed at map start (EVNT section): cell and collectable blueprint index. */
  pickups: { x: number; y: number; item: number }[];
}

/**
 * One EVNT spawn record (0x020A5C0C): 9 bytes x, y, slot, role, index, then
 * four bytes we keep but don't understand yet (always 100, 1, 1, 1 on the
 * skirmish maps). The game spawns the `index`th entity with role `role` from
 * the slot's faction. See docs/re-notes/skirmish.md.
 */
export interface StartRecord {
  x: number;
  y: number;
  slot: number;
  role: number;
  index: number;
  extra: [number, number, number, number];
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
  const edges = d.slice(0x2b + n, 0x2b + 2 * n);
  const regions = d.slice(0x2b + 2 * n, 0x2b + 3 * n);
  const trees = decodeTreeRuns(d, 0x2b + 3 * n, n);
  // The ground layer is the last block of the TERR section, which is closed by "RRET".
  const end = indexOfTag(d, 'RRET');
  const groundStart = end - n * 2;
  if (groundStart < 0x2b + n) throw new Error('TERR section too short');
  const ground = new Uint16Array(n);
  for (let i = 0; i < n; i++) ground[i] = u16(d, groundStart + i * 2);
  return { width, height, tileset, terrain, edges, regions, trees, ground, mineSites: readMineSites(d), bridgeMarks: readBridgeMarks(d), ...readEvents(d) };
}

/** MINE section: four lists of `L`, u8 count, count x (u8 x, u8 y). Only the second is ever non-empty. */
function readMineSites(d: Uint8Array): { x: number; y: number }[] {
  let p = indexOfTag(d, 'MINE') + 4;
  const lists: { x: number; y: number }[][] = [];
  for (let l = 0; l < 4; l++) {
    if (d[p] !== 0x4c) throw new Error('Bad MINE list');
    const count = d[p + 1]!;
    const list = [];
    for (let i = 0; i < count; i++) list.push({ x: d[p + 2 + i * 2]!, y: d[p + 3 + i * 2]! });
    lists.push(list);
    p += 2 + count * 2;
  }
  return lists[1]!;
}

/**
 * MARK section: lists of 'L', u8 type, u8 count, count x (u8 x, u8 y, u8 ?). Types 7 and 8 are
 * horizontal and vertical bridge sites (site builder 0x020A36E4). confirmed (mp04 in the emulator)
 */
function readBridgeMarks(d: Uint8Array): { x: number; y: number; vertical: boolean }[] {
  const out: { x: number; y: number; vertical: boolean }[] = [];
  let p: number;
  try {
    p = indexOfTag(d, 'MARK') + 4;
  } catch {
    return out;
  }
  while (d[p] === 0x4c) {
    const type = d[p + 1]!, n = d[p + 2]!;
    if (type === 7 || type === 8) for (let i = 0; i < n; i++) out.push({ x: d[p + 3 + i * 3]!, y: d[p + 4 + i * 3]!, vertical: type === 8 });
    p += 3 + n * 3;
  }
  return out;
}

/**
 * EVNT section (reader 0x020A3BB0): groups of 'L', u8 group id, then a group
 * body (0x020A4B70), until '!'. Body: u8 n + n points (x, y); u8 flag + 4 bytes
 * if set; u8 n + n spawn records (9 bytes); u8 n + n pickup records (8 bytes);
 * u8 n + n records of a kind no skirmish map uses (we stop if one appears).
 */
function readEvents(d: Uint8Array): { starts: StartRecord[]; pickups: { x: number; y: number; item: number }[] } {
  const starts: StartRecord[] = [];
  const pickups: { x: number; y: number; item: number }[] = [];
  let p = indexOfTag(d, 'EVNT') + 4;
  while (d[p] !== 0x21) {
    if (d[p] !== 0x4c) throw new Error('Bad EVNT group');
    p += 2; // 'L', group id
    p += 1 + d[p]! * 2;
    p += d[p] ? 5 : 1;
    const nSpawn = d[p++]!;
    for (let i = 0; i < nSpawn; i++, p += 9)
      starts.push({ x: d[p]!, y: d[p + 1]!, slot: d[p + 2]!, role: d[p + 3]!, index: d[p + 4]!, extra: [d[p + 5]!, d[p + 6]!, d[p + 7]!, d[p + 8]!] });
    const nPickup = d[p++]!;
    for (let i = 0; i < nPickup; i++, p += 8) pickups.push({ x: d[p]!, y: d[p + 1]!, item: d[p + 4]! });
    if (d[p++] !== 0) return { starts, pickups }; // campaign-only records; not needed for skirmish
  }
  return { starts, pickups };
}

/** Tree mask: u16 byte count, then run lengths alternating no-tree / tree, starting with no-tree. */
function decodeTreeRuns(d: Uint8Array, at: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const count = u16(d, at);
  let p = 0;
  for (let i = 0; i < count; i++) {
    const run = d[at + 2 + i]!;
    if (i & 1) out.fill(1, p, Math.min(n, p + run));
    p += run;
  }
  if (p !== n) throw new Error(`Tree runs cover ${p} cells, expected ${n}`);
  return out;
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

/** Ground ids at or above this index come from the map's own DetailTiles table, not the tileset's. */
export const DETAIL_BASE = 440;

/**
 * Overlay a map's detail metatiles (BP/DetailTiles_<map>.tbp, same format) onto the
 * tileset table from DETAIL_BASE. Returns a new table; the inputs are untouched.
 */
export function withDetailTiles(base: Uint16Array, detail: Uint16Array): Uint16Array {
  const out = new Uint16Array(Math.max(base.length, DETAIL_BASE * 6 + detail.length));
  out.set(base);
  out.set(detail, DETAIL_BASE * 6);
  return out;
}

export const detailTilesPath = (mapName: string) => `BP/DetailTiles_${mapName}.tbp`;

/** "KingTileset" -> "BP/KingTiles.tbp" */
export const metatilePath = (tileset: string) => `BP/${tileset.replace(/Tileset$/, 'Tiles')}.tbp`;
