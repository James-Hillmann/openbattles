import { isPmoc, pmocDecompress } from './pmoc';
import { detailTilesPath, metatilePath, parseMap, parseMetatiles, withDetailTiles, type StartRecord } from './map';
import { decodeChars, decodePalette } from './nitro';
import { renderMap, type Rgba } from './render';
import type { UnpackedRom } from './rom';
import { renderMinimap } from './minimap';
import { TERRAIN_TREE, bakeTrees, readTreeTable, type TreeTable } from './trees';
import { readCombatBonus, type CombatBonus } from './entities';
import { buildStructureArt, type StructureArt } from './structures';

/** Everything the M1 client needs to show one map with units. Built in the worker. */
export interface MapBundle {
  name: string;
  width: number;
  height: number;
  /** Logical terrain code per cell; will drive pathing in M2. */
  terrain: Uint8Array;
  ground: Rgba;
  /** HUD minimap, 1.5 px per cell, trees drawn from `terrain`; undefined if the map has no minimap file. */
  minimap?: Rgba;
  /** Melee bonus tables from ARM9; null for game versions we haven't mapped. */
  combatBonus: CombatBonus | null;
  /** Skirmish start records from the map's EVNT section (see docs/re-notes/skirmish.md). */
  starts: StartRecord[];
  /** Cells where a Mine may stand (top-left of its footprint). */
  mineSites: { x: number; y: number }[];
  /** Bridge sites from the MARK section (top-left of the span). */
  bridgeMarks: { x: number; y: number; vertical: boolean }[];
  /** Wall and bridge tiles in every team colour; null for game versions we haven't mapped. */
  structures: StructureArt | null;
}

export function romFile(rom: UnpackedRom, path: string): Uint8Array {
  const d = tryRomFile(rom, path);
  if (!d) throw new Error(`File not in ROM: ${path}`);
  return d;
}

export function tryRomFile(rom: UnpackedRom, path: string): Uint8Array | undefined {
  const f = rom.files.find((x) => x.path.toLowerCase() === path.toLowerCase());
  if (!f) return undefined;
  return isPmoc(f.data) ? pmocDecompress(f.data) : f.data;
}

export const listMaps = (rom: UnpackedRom): string[] =>
  rom.files.map((f) => /^Maps\/(.+)\.map$/i.exec(f.path)?.[1]).filter((n): n is string => !!n);

const treeTables = new WeakMap<UnpackedRom, TreeTable | null>();

/** The game's tree tile lookup, read once per ROM. Null if this game version isn't mapped yet. */
export function romTreeTable(rom: UnpackedRom): TreeTable | null {
  if (!treeTables.has(rom)) treeTables.set(rom, readTreeTable(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode));
  return treeTables.get(rom)!;
}

function mapGraphics(rom: UnpackedRom, name: string, tileset: string) {
  const chars = decodeChars(romFile(rom, `${tileset}.NCGR`));
  const pal = decodePalette(romFile(rom, `${tileset}.NCLR`));
  let metatiles = parseMetatiles(romFile(rom, metatilePath(tileset)));
  const detail = tryRomFile(rom, detailTilesPath(name));
  if (detail) metatiles = withDetailTiles(metatiles, parseMetatiles(detail));
  return { chars, pal, metatiles };
}

/**
 * The ground again after trees were chopped or planted: `terrain` is the live terrain grid; a
 * start tree whose cell is no longer a tree shows the ground under it, a planted tree gets its
 * tree tile (only on ground that was open in the map), and the trees around it
 * pick their edge tiles anew (the game rewrites the map as a chop ends; that it re-picks
 * neighbours the same way bakeTrees does is likely).
 */
export function rebakeGround(rom: UnpackedRom, name: string, terrain: Uint8Array): Rgba {
  const parsed = parseMap(romFile(rom, `Maps/${name}.map`));
  const trees = romTreeTable(rom);
  if (!trees) throw new Error('no tree table for this game version');
  // Every tree in the live grid: the map's own that still stand and any a forest spell planted.
  const standing = parsed.trees.map((_, i) => (terrain[i] === TERRAIN_TREE ? 1 : 0));
  const map = { ...parsed, trees: standing, ...bakeTrees({ ...parsed, trees: standing }, trees) };
  const g = mapGraphics(rom, name, map.tileset);
  return renderMap(map, g.chars, g.pal, g.metatiles);
}

export function buildMapBundle(rom: UnpackedRom, name: string): MapBundle {
  const parsed = parseMap(romFile(rom, `Maps/${name}.map`));
  const trees = romTreeTable(rom);
  const map = trees ? { ...parsed, ...bakeTrees(parsed, trees) } : parsed;
  const { chars, pal, metatiles } = mapGraphics(rom, name, map.tileset);
  const minimap = renderMinimap(rom, name, map.width, map.height, map.terrain);
  const combatBonus = readCombatBonus(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode);
  // Bridges come from the tileset's own metatiles, not the map's detail table.
  const structures = buildStructureArt(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode, chars, pal, parseMetatiles(romFile(rom, metatilePath(map.tileset))));
  return {
    name, width: map.width, height: map.height, terrain: map.terrain, ground: renderMap(map, chars, pal, metatiles), minimap, combatBonus,
    starts: map.starts, mineSites: map.mineSites, bridgeMarks: map.bridgeMarks, structures,
  };
}
