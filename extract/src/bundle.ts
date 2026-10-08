import { isPmoc, pmocDecompress } from './pmoc';
import { metatilePath, parseMap, parseMetatiles } from './map';
import { decodeChars, decodePalette } from './nitro';
import { renderMap, renderSheet, type Rgba } from './render';
import type { UnpackedRom } from './rom';

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
  const f = rom.files.find((x) => x.path.toLowerCase() === path.toLowerCase());
  if (!f) throw new Error(`File not in ROM: ${path}`);
  return isPmoc(f.data) ? pmocDecompress(f.data) : f.data;
}

export const listMaps = (rom: UnpackedRom): string[] =>
  rom.files.map((f) => /^Maps\/(.+)\.map$/i.exec(f.path)?.[1]).filter((n): n is string => !!n);

/** Walk sheet + faction palette for the units M1 shows, keyed by "<sheet>@<bank>". */
const M1_UNITS = [
  { sheet: 'k_mel_1', palette: 'KingFaction.NCLR', bank: 0 },
  { sheet: 'k_mel_1', palette: 'KingFaction.NCLR', bank: 2 },
];

export function buildMapBundle(rom: UnpackedRom, name: string): MapBundle {
  const map = parseMap(romFile(rom, `Maps/${name}.map`));
  const chars = decodeChars(romFile(rom, `${map.tileset}.NCGR`));
  const pal = decodePalette(romFile(rom, `${map.tileset}.NCLR`));
  const metatiles = parseMetatiles(romFile(rom, metatilePath(map.tileset)));
  const units: Record<string, Rgba> = {};
  for (const u of M1_UNITS) {
    const sheet = decodeChars(romFile(rom, `Sprites/${u.sheet}.NCBR`));
    units[`${u.sheet}@${u.bank}`] = renderSheet(sheet, decodePalette(romFile(rom, u.palette)), u.bank);
  }
  return { name, width: map.width, height: map.height, terrain: map.terrain, ground: renderMap(map, chars, pal, metatiles), units };
}
