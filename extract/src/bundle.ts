import { isPmoc, pmocDecompress } from './pmoc';
import { detailTilesPath, metatilePath, parseMap, parseMetatiles, withDetailTiles } from './map';
import { decodeChars, decodePalette } from './nitro';
import { renderMap, renderSheet, type Rgba } from './render';
import type { UnpackedRom } from './rom';
import { bakeTrees, readTreeTable, type TreeTable } from './trees';
import { findUnitStats, parseEntities, readCombatBonus, type CombatBonus, type UnitStats } from './entities';

/** Everything the M1 client needs to show one map with units. Built in the worker. */
export interface MapBundle {
  name: string;
  width: number;
  height: number;
  /** Logical terrain code per cell; will drive pathing in M2. */
  terrain: Uint8Array;
  ground: Rgba;
  /**
   * Unit sheets keyed "<sheet>@<bank>". `_1` (walk): 5 rows (back, back-right, right,
   * front-right, front) x 5 frames of 24x24. `_0` (idle): one row, one 24x24 frame per facing.
   * `_2` (attack): same layout as `_1`.
   */
  units: Record<string, Rgba>;
  /** Combat stats per unit sheet prefix (e.g. "k_mel"), from BP/Entities.ebp. */
  stats: Record<string, UnitStats>;
  /** Melee bonus tables from ARM9; null for game versions we haven't mapped. */
  combatBonus: CombatBonus | null;
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

/** Idle, walk and attack sheets and faction palette for the units the client shows, keyed by "<sheet>@<bank>". */
const M1_UNITS = ['k_mel_0', 'k_mel_1', 'k_mel_2'].flatMap((sheet) =>
  [0, 2].map((bank) => ({ sheet, palette: 'KingFaction.NCLR', bank })),
);
/** Which entity each shown sprite prefix is. */
const M1_ENTITIES: Record<string, string> = { k_mel: 'K_Swordsman' };

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
  const entities = parseEntities(romFile(rom, 'BP/Entities.ebp'));
  const stats: Record<string, UnitStats> = {};
  for (const [prefix, entity] of Object.entries(M1_ENTITIES)) stats[prefix] = findUnitStats(entities, entity);
  const combatBonus = readCombatBonus(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode);
  return { name, width: map.width, height: map.height, terrain: map.terrain, ground: renderMap(map, chars, pal, metatiles), units, stats, combatBonus };
}
