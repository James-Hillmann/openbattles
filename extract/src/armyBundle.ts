import { ARMY_SLOT_TEXT, armyChoices, defaultArmies, parseArmies, readIconTable, stripIcon, type Army } from './armies';
import { listMaps, romFile, tryRomFile } from './bundle';
import { parseEntityRecords, unitStats, type EntityRecord, type UnitStats } from './entities';
import { entityLabels, parseLang } from './lang';
import { readSpellTable, SPELL_NAME_TEXT, spellIcons, type SpellDef } from './spells';
import { decodeCells, decodeChars, decodePalette, type CharData } from './nitro';
import { renderCell, type Rgba } from './render';
import type { UnpackedRom } from './rom';
import { listUnlockables } from './unlocks';
import { mapTitleId, minimapPalettes, renderMapPreview } from './minimap';
import { parseMap } from './map';

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
  /** Skirmish maps (mp01..) with their name and the map picker's preview picture. */
  maps: Record<string, { title: string; preview?: Rgba }>;
  /** 24x24 army screen heads (UI/MiniHeads) by entity name. */
  heads: Record<string, Rgba>;
  /**
   * 24x24 build/train strip icons by entity name. Units: UI/MiniHeadsGame through the icon table.
   * Buildings: their own selection portrait (UI/GamePlayerCards) shrunk 4x, ours (the game shows a
   * type icon there; armies.md "Building icons").
   */
  stripIcons: Record<string, Rgba>;
  /** Army screen pictures (UI/FEPlayerCards) by entity name. */
  cards: Record<string, Rgba>;
  /** The game's spell table (spells.ts); empty for an unknown game version. */
  spells: SpellDef[];
  /** 24x24 spell strip icons by icon number (SpellDef.icon). */
  spellIcons: Record<number, Rgba>;
  /** Spell names by spell id (SPELL_NAME_TEXT). */
  spellNames: Record<number, string>;
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
  magicCosts: 100,
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
  freePlayScore: 64,
  multiplayerScore: 65,
  minifigsBuilt: 323,
  specialsBuilt: 324,
  buildingsBuilt: 325,
  minifigsLost: 326,
  specialsLost: 327,
  buildingsLost: 328,
  minifigsDestroyed: 329,
  specialsDestroyed: 330,
  buildingsDestroyed: 331,
  time: 332,
  timeFormat: 333,
  bricksCollected: 334,
  bricksBalance: 335,
  stats: 336,
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

/** First cell of a character picture: UI/FEPlayerCards (army screen) or UI/GamePlayerCards (in-game portrait). */
function card(rom: UnpackedRom, id: string, dir = 'UI/FEPlayerCards'): Rgba | undefined {
  const base = `${dir}/${id}`;
  const ncer = tryRomFile(rom, `${base}.NCER`);
  if (!ncer) return undefined;
  const cell = decodeCells(ncer)[0];
  if (!cell?.length) return undefined;
  return renderCell(cell, decodeChars(romFile(rom, `${base}.NCGR`)), decodePalette(romFile(rom, `${base}.NCLR`)));
}

/** Box-filter `img` down by `f` (alpha-weighted, so transparent pixels don't darken the edges). */
export function shrink(img: Rgba, f: number): Rgba {
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const s = ((y * f + dy) * img.width + x * f + dx) * 4;
          const a = img.data[s + 3]!;
          for (let c = 0; c < 3; c++) sum[c]! += img.data[s + c]! * a;
          sum[3]! += a;
        }
      }
      const a = sum[3]!;
      if (a) data.set([sum[0]! / a, sum[1]! / a, sum[2]! / a, a / (f * f)], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
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
  // Buildings get a small copy of their own portrait instead of the type icon, so a Farm and a
  // Barracks look different on the strip (asked for in playtesting).
  for (const name of new Set(Object.values(armies).flatMap((a) => a.buildings))) {
    const p = card(rom, name, 'UI/GamePlayerCards');
    if (p) stripIcons[name] = shrink(p, 4);
  }
  const cards: Record<string, Rgba> = {};
  for (const name of Object.keys(units)) {
    const c = card(rom, name);
    if (c) cards[name] = c;
  }
  const text: Record<number, string> = {};
  for (const id of Object.values(FE_TEXT)) text[id] = lang[id] ?? '';
  const maps: ArmyBundle['maps'] = {};
  const miniPals = minimapPalettes(rom);
  for (const m of listMaps(rom)) {
    const id = mapTitleId(m);
    if (id === undefined) continue;
    const pal = miniPals?.[parseMap(romFile(rom, `Maps/${m}.map`)).tileset];
    maps[m] = { title: lang[id] || m, preview: pal && renderMapPreview(rom, m, pal) };
  }
  const spells = readSpellTable(rom.arm9, rom.header.arm9.ramAddress, rom.header.gameCode) ?? [];
  const spellIconImages = spells.length ? spellIcons(rom) : {};
  return {
    armies, prefixes, choices, slotLabels: ARMY_SLOT_TEXT.map((id) => lang[id] ?? ''), text, units, maps, heads, stripIcons, cards, spells,
    spellIcons: spellIconImages,
    spellNames: Object.fromEntries(Object.entries(SPELL_NAME_TEXT).map(([id, t]) => [id, lang[t] ?? ''])),
  };
}


