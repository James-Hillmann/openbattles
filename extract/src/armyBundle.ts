import { ARMY_SLOT_TEXT, armyChoices, defaultArmies, parseArmies, readIconTable, stripIcon, type Army } from './armies';
import { romFile, tryRomFile } from './bundle';
import { parseEntityRecords, unitStats, type EntityRecord, type UnitStats } from './entities';
import { entityLabels, parseLang } from './lang';
import { decodeCells, decodeChars, decodePalette, type CharData } from './nitro';
import { renderCell, type Rgba } from './render';
import type { UnpackedRom } from './rom';
import { listUnlockables } from './unlocks';

/**
 * Everything the army select screen and the in-game build/train strip draw, read from the
 * player's ROM. See docs/re-notes/armies.md.
 */
export interface ArmyBundle {
  /** The six playable armies as shipped, by army name (King, Wizard, Pirates, Imperial, Earth, Aliens). */
  armies: Record<string, Army & { buildings: string[] }>;
  /** Faction prefix (K, W, ...) per army name. */
  prefixes: Record<string, string>;
  /** What each unit slot can hold, in the game's order. */
  choices: string[][];
  /** Label per unit slot (Hero, Builder, Close Combat, Ranged, Mounted, Special, Special, Special, Transport). */
  slotLabels: string[];
  /** Screen text by LOC id, for the few labels the front end shows. */
  text: Record<number, string>;
  /** Per entity on the screen: display name and the four stats the top screen shows. */
  units: Record<string, ArmyUnitInfo>;
  /** 24x24 army screen heads (UI/MiniHeads) by entity name. */
  heads: Record<string, Rgba>;
  /** 24x24 build/train strip icons (UI/MiniHeadsGame) by entity name, for every unit and building with an icon. */
  stripIcons: Record<string, Rgba>;
  /** Army screen pictures (UI/FEPlayerCards) by entity name. */
  cards: Record<string, Rgba>;
}

export interface ArmyUnitInfo {
  name: string;
  hp: number;
  cost: number;
  /** Attack and speed as the screen's five pips (1-5). */
  attackPips: number;
  speedPips: number;
}

/** LOC ids of the front-end labels we show. */
export const FE_TEXT = {
  selectArmy: 0,
  buildCosts: 99,
  continue: 143,
  back: 147,
  army: 149,
  ready: 137,
  notReady: 138,
  launch: 139,
  waiting: 140,
  gameLobby: 55,
  multiplayer: 30,
  singlePlayer: 29,
  host: 33,
  join: 34,
  skirmish: 150,
  remove: 162,
  start: 15,
  victory: 12,
  defeated: 13,
  connectionLost: 14,
} as const;

/**
 * Attack pips: ceil(average damage per second / 20), 1-5. guess, but it reproduces all nine
 * King units on the emulator's army screen (King 4, Builder 1, Guardsman 1, Archer 2, Knight 3,
 * Ballista 5, Catapult 3, Dragon 3, Transport 1). The game's own formula isn't traced.
 */
export function attackPips(s: UnitStats): number {
  if (!s.cooldown) return 1;
  const hit = s.projectile ? (s.projectile.minDamage + s.projectile.maxDamage) / 2 : s.damage + s.damageRand / 2;
  return Math.min(5, Math.max(1, Math.ceil(((hit / s.cooldown) * 30) / 20)));
}

/**
 * Speed pips: floor(speed / 157), 1-5. guess fitted to the same nine King units (speeds 410,
 * 478, 614, 683, 819 show 2, 3, 3, 4, 5); any divisor from 154 to 159 fits.
 */
export function speedPips(s: UnitStats): number {
  return Math.min(5, Math.max(1, Math.floor(s.speed / 157)));
}

/** Army screen heads are drawn with this bank of WorldViewTop_Back.NCLR. likely: its colors match the emulator's heads within rounding. */
const HEAD_PALETTE = 'UI/WorldViewTop_Back.NCLR';
const HEAD_BANK = 5;
/** Strip icons: bank 7, the strip's red (as in hud.ts). confirmed */
const STRIP_BANK = 7;

function iconCell(chars: CharData, pal: Uint8Array, bank: number, i: number): Rgba {
  const out: Rgba = { width: 24, height: 24, data: new Uint8ClampedArray(24 * 24 * 4) };
  const x0 = (i % 16) * 24;
  const y0 = Math.floor(i / 16) * 24;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      const v = chars.pixels[((sy >> 3) * chars.tilesWide + (sx >> 3)) * 64 + (sy & 7) * 8 + (sx & 7)]!;
      if (!v) continue;
      const o = (bank * 16 + v) * 4;
      out.data.set([pal[o]!, pal[o + 1]!, pal[o + 2]!, 255], (y * 24 + x) * 4);
    }
  return out;
}

function card(rom: UnpackedRom, id: string): Rgba | undefined {
  const base = `UI/FEPlayerCards/${id}`;
  const ncer = tryRomFile(rom, `${base}.NCER`);
  if (!ncer) return undefined;
  const cell = decodeCells(ncer)[0];
  if (!cell?.length) return undefined;
  return renderCell(cell, decodeChars(romFile(rom, `${base}.NCGR`)), decodePalette(romFile(rom, `${base}.NCLR`)));
}

export function buildArmyBundle(rom: UnpackedRom, language = 'American_English'): ArmyBundle {
  const recs = parseEntityRecords(romFile(rom, 'BP/Entities.ebp'));
  const armyRecs = parseArmies(romFile(rom, 'BP/Factions.fbp'));
  const armies = defaultArmies(armyRecs, recs);
  const choices = armyChoices(armyRecs, recs, listUnlockables(recs));
  const lang = parseLang(romFile(rom, `LOC/${language}.lng`));
  const labels = entityLabels(romFile(rom, 'BP/Entities.ebp'), lang);
  const prefixes: Record<string, string> = {};
  for (const [name, a] of Object.entries(armies)) prefixes[name] = a.units[0]!.slice(0, a.units[0]!.indexOf('_'));

  const byName = new Map<string, EntityRecord>(recs.map((r) => [r.name, r]));
  const units: Record<string, ArmyUnitInfo> = {};
  for (const name of new Set(choices.flat())) {
    const rec = byName.get(name);
    if (!rec || rec.kind !== 0) continue;
    const s = unitStats(recs, rec);
    units[name] = { name: labels[rec.index]?.display ?? name, hp: s.hp, cost: s.cost, attackPips: attackPips(s), speedPips: speedPips(s) };
  }

  const pal = decodePalette(romFile(rom, HEAD_PALETTE));
  const icons = readIconTable(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode) ?? new Map<number, number>();
  const headChars = decodeChars(romFile(rom, 'UI/MiniHeads.NCGR'));
  const stripChars = decodeChars(romFile(rom, 'UI/MiniHeadsGame.NCGR'));
  // A unit's slot in its own army decides its strip icon (stripIcon).
  const slotIn = new Map<string, number>();
  for (const a of Object.values(armies)) a.units.forEach((u, s) => slotIn.set(u, s));
  const heads: Record<string, Rgba> = {};
  const stripIcons: Record<string, Rgba> = {};
  for (const rec of recs) {
    const cell = icons.get(rec.index);
    if (cell === undefined) continue;
    heads[rec.name] = iconCell(headChars, pal, HEAD_BANK, cell);
    stripIcons[rec.name] = iconCell(stripChars, pal, STRIP_BANK, stripIcon(cell, slotIn.get(rec.name) ?? -1));
  }
  const cards: Record<string, Rgba> = {};
  for (const name of Object.keys(units)) {
    const c = card(rom, name);
    if (c) cards[name] = c;
  }
  const text: Record<number, string> = {};
  for (const id of Object.values(FE_TEXT)) text[id] = lang[id] ?? '';
  return { armies, prefixes, choices, slotLabels: ARMY_SLOT_TEXT.map((id) => lang[id] ?? ''), text, units, heads, stripIcons, cards };
}


