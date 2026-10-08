import type { GameMap } from './map';

/**
 * The game picks each tree cell's metatile from a lookup keyed by its 3x3
 * neighbourhood. The lookup tables live in the ARM9 binary; we read them from
 * the player's own ROM at load time (nothing is copied into this repo).
 * See docs/re-notes/formats.md "Trees".
 */
export interface TreeTable {
  /** Sorted start keys of each sub-table. */
  bases: Uint32Array;
  lengths: Uint16Array;
  /** One byte array per sub-table: metatile id, 0xff = use fallback. */
  tables: Uint8Array[];
  fallback: number;
}

/** Where the tables sit in RAM, per game code. Addresses are ARM9 RAM addresses (base 0x02000000). */
const TREE_TABLE_ADDRS: Record<string, { bases: number; lengths: number; ptrs: number; fallback: number; count: number }> = {
  C5SE: { bases: 0x02140cb8, lengths: 0x02140aec, ptrs: 0x02141050, fallback: 0x0214b8f0, count: 230 },
};

/** Read the tree lookup from a decompressed ARM9 image. Returns null for game versions we haven't mapped. */
export function readTreeTable(arm9: Uint8Array, ramAddress: number, gameCode: string): TreeTable | null {
  const a = TREE_TABLE_ADDRS[gameCode];
  if (!a) return null;
  const v = new DataView(arm9.buffer, arm9.byteOffset, arm9.byteLength);
  const at = (addr: number) => addr - ramAddress;
  const bases = new Uint32Array(a.count);
  const lengths = new Uint16Array(a.count);
  const tables: Uint8Array[] = [];
  for (let i = 0; i < a.count; i++) {
    bases[i] = v.getUint32(at(a.bases) + i * 4, true);
    lengths[i] = v.getUint16(at(a.lengths) + i * 2, true);
    const p = at(v.getUint32(at(a.ptrs) + i * 4, true));
    if (p < 0 || p + lengths[i]! > arm9.length) return null;
    tables.push(arm9.slice(p, p + lengths[i]!));
    if (i > 0 && bases[i]! <= bases[i - 1]!) return null; // not sorted: wrong addresses
  }
  return { bases, lengths, tables, fallback: arm9[at(a.fallback)]! };
}

/** Terrain code the game gives a cell with a tree on it. */
export const TERRAIN_TREE = 1;

/**
 * Neighbourhood key for a tree cell: 9 cells (row-major, NW..SE), 2 bits each.
 * 0 = open ground (terrain 0), 2 = rough edge (from the cell's edges bitmask),
 * 1 = anything else (trees, water, cliffs) or off-map.
 */
export function treeKey(map: GameMap, terrain: Uint8Array, x: number, y: number): number {
  const edge = map.edges[y * map.width + x]!;
  let key = 0;
  let bit = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const center = dx === 0 && dy === 0;
      const yy = y + dy;
      const xx = x + dx;
      let s = 1;
      if (yy >= 0 && yy < map.height) {
        if (!center && (edge >> bit) & 1) s = 2;
        else if (xx >= 0 && xx < map.width && terrain[yy * map.width + xx] === 0) s = 0;
      }
      key |= s << (2 * ((dy + 1) * 3 + dx + 1));
      if (!center) bit++;
    }
  }
  return key;
}

export function treeMetatile(t: TreeTable, key: number): number {
  if (key < t.bases[0]!) return t.fallback;
  let lo = 0;
  let hi = t.bases.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.bases[mid]! <= key) lo = mid;
    else hi = mid - 1;
  }
  const off = key - t.bases[lo]!;
  if (off >= t.lengths[lo]!) return t.fallback;
  const id = t.tables[lo]![off]!;
  return id === 0xff ? t.fallback : id;
}

/**
 * Apply the map's starting trees the way the game does at load: a tree only
 * takes on open ground (terrain 0), then every tree cell gets its metatile.
 * Returns new terrain + ground arrays.
 */
export function bakeTrees(map: GameMap, t: TreeTable): { terrain: Uint8Array; ground: Uint16Array } {
  const terrain = map.terrain.slice();
  const ground = map.ground.slice();
  for (let i = 0; i < terrain.length; i++) if (map.trees[i] && terrain[i] === 0) terrain[i] = TERRAIN_TREE;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      if (terrain[i] === TERRAIN_TREE) ground[i] = treeMetatile(t, treeKey(map, terrain, x, y));
    }
  }
  return { terrain, ground };
}
