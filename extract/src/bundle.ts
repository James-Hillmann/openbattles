import { isPmoc, pmocDecompress } from './pmoc';
import { detailTilesPath, metatilePath, parseMap, parseMetatiles, withDetailTiles } from './map';
import { decodeChars, decodePalette } from './nitro';
import { renderMap, renderSheet, type Rgba } from './render';
import type { UnpackedRom } from './rom';
import { bakeTrees, readTreeTable, type TreeTable } from './trees';

/** Everything the M1 client needs to show one map with units. Built in the worker. */
export interface MapBundle {
  name: string;
  width: number;
  height: number;
  /** Logical terrain code per cell; will drive pathing in M2. */
  terrain: Uint8Array;
  ground: Rgba;
  /** Unit walk sheets: 5 rows (back, back-right, right, front-right, front) x 5 frames of 24x24. */
  units: Record<string, Rgba>;
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

/** Walk sheet + faction palette for the units M1 shows, keyed by "<sheet>@<bank>". */
const M1_UNITS = [
  { sheet: 'k_mel_1', palette: 'KingFaction.NCLR', bank: 0 },
  { sheet: 'k_mel_1', palette: 'KingFaction.NCLR', bank: 2 },
];

const treeTables = new WeakMap<UnpackedRom, TreeTable | null>();

/** The game's tree tile lookup, read once per ROM. Null if this game version isn't mapped yet. */
export function romTreeTable(rom: UnpackedRom): TreeTable | null {
  if (!treeTables.has(rom)) treeTables.set(rom, readTreeTable(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode));
  return treeTables.get(rom)!;
}

export function buildMapBundle(rom: UnpackedRom, name: string): MapBundle {
  const parsed = parseMap(romFile(rom, `Maps/${name}.map`));
  const trees = romTreeTable(rom);
  const map = trees ? { ...parsed, ...bakeTrees(parsed, trees) } : parsed;
  const chars = decodeChars(romFile(rom, `${map.tileset}.NCGR`));
  const pal = decodePalette(romFile(rom, `${map.tileset}.NCLR`));
  let metatiles = parseMetatiles(romFile(rom, metatilePath(map.tileset)));
  const detail = tryRomFile(rom, detailTilesPath(name));
  if (detail) metatiles = withDetailTiles(metatiles, parseMetatiles(detail));
  const units: Record<string, Rgba> = {};
  for (const u of M1_UNITS) {
    const sheet = decodeChars(romFile(rom, `Sprites/${u.sheet}.NCBR`));
    units[`${u.sheet}@${u.bank}`] = renderSheet(sheet, decodePalette(romFile(rom, u.palette)), u.bank);
  }
  return { name, width: map.width, height: map.height, terrain: map.terrain, ground: renderMap(map, chars, pal, metatiles), units };
}
