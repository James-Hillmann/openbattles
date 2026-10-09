import { u16, u32 } from './bytes';
import { romFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import type { Rgba } from './render';
import type { UnpackedRom } from './rom';

/**
 * Hero spells ("Gold Spells Brick"). The game keeps one 0x14-byte record per spell id in a static
 * ARM9 table; heroes list the ids they can cast at entity +0x72..+0x76. See docs/re-notes/spells.md.
 */
export interface SpellDef {
  /** Spell id: the record's index, which is also its type byte (+0x00) that picks the spell class. */
  id: number;
  /** +0x01: which button of the spell strip shows it, i.e. its icon (spellIconCells). 0 = none. */
  icon: number;
  /** +0x02..+0x05: four class-specific parameters. */
  params: [number, number, number, number];
  /** +0x06: cast range in cells (squared distance from the hero). */
  range: number;
  /** +0x07: unknown yet. */
  b7: number;
  /** +0x08: flags (targeting). */
  flags: number;
  /** +0x0C: charge the hero spends; the hero needs more than this. */
  cost: number;
  /** +0x10: unknown yet (same for a spell's unit and area versions). */
  category: number;
  /** +0x12: unknown yet (30, 60 or 240: ticks). */
  time: number;
}

const SPELL_TABLE: Record<string, { addr: number; count: number }> = {
  C5SE: { addr: 0x02126cb0, count: 35 },
};
const SPELL_SIZE = 0x14;

/** The spell table, or null for an unknown game version. confirmed (factory 0x0207BBEC, cast check 0x0207B810) */
export function readSpellTable(arm9: Uint8Array, ramAddress: number, gameCode: string): SpellDef[] | null {
  const t = SPELL_TABLE[gameCode];
  if (!t) return null;
  const out: SpellDef[] = [];
  for (let i = 0; i < t.count; i++) {
    const o = t.addr - ramAddress + i * SPELL_SIZE;
    if (arm9[o] !== i) return null; // the type byte equals the index in this table; anything else is the wrong address
    out.push({
      id: i,
      icon: arm9[o + 1]!,
      params: [arm9[o + 2]!, arm9[o + 3]!, arm9[o + 4]!, arm9[o + 5]!],
      range: arm9[o + 6]!,
      b7: arm9[o + 7]!,
      flags: arm9[o + 8]!,
      cost: u32(arm9, o + 0x0c),
      category: u16(arm9, o + 0x10),
      time: u16(arm9, o + 0x12),
    });
  }
  return out;
}

/**
 * Where each spell icon sits in the strip texture UI/AllInOne/UI_MainCastle (256x256): the spell
 * strip's buttons in UI/Game/UIMgrData.bin, in order, are the 24x24 image elements (marker u16s
 * 0x0100 0x0901 0 0, then x, y, w, h as u16). Button n (1-based) is icon n: the strip
 * code (0x020DC062) shows the button numbered by the record's +0x01.
 * likely: the King's four icons (3, 7, 8, 11) match the emulator; the element format is not traced.
 */
export function spellIconCells(uiMgr: Uint8Array, count = 30): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let o = 0; o + 16 <= uiMgr.length && out.length < count; o += 2) {
    if (u16(uiMgr, o) !== 0x0100 || u16(uiMgr, o + 2) !== 0x0901 || u32(uiMgr, o + 4) !== 0) continue;
    const [x, y, w, h] = [u16(uiMgr, o + 8), u16(uiMgr, o + 10), u16(uiMgr, o + 12), u16(uiMgr, o + 14)];
    if (w === 24 && h === 24) out.push({ x, y });
  }
  return out;
}

/**
 * The spell strip draws these cells with UI_MainCastle.NCLR bank 0, index 0 included (opaque).
 * confirmed: the King's four icons match the emulator's strip pixel for pixel (5-bit color).
 */
const SPELL_BANK = 0;

/** 24x24 spell icons keyed by icon number (SpellDef.icon). */
export function spellIcons(rom: UnpackedRom): Record<number, Rgba> {
  const chars = decodeChars(romFile(rom, 'UI/AllInOne/UI_MainCastle.NCGR'));
  const pal = decodePalette(romFile(rom, 'UI/AllInOne/UI_MainCastle.NCLR'));
  const out: Record<number, Rgba> = {};
  spellIconCells(romFile(rom, 'UI/Game/UIMgrData.bin')).forEach(({ x: x0, y: y0 }, i) => {
    const img: Rgba = { width: 24, height: 24, data: new Uint8ClampedArray(24 * 24 * 4) };
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        const v = chars.pixels[((sy >> 3) * chars.tilesWide + (sx >> 3)) * 64 + (sy & 7) * 8 + (sx & 7)] ?? 0;
        const o = (SPELL_BANK * 16 + v) * 4;
        img.data.set([pal[o]!, pal[o + 1]!, pal[o + 2]!, 255], (y * 24 + x) * 4);
      }
    out[i + 1] = img;
  });
  return out;
}

/**
 * LOC string naming each spell. No code maps a record to a name (the strip shows none), so this is
 * by meaning: the effect classes each spell creates (EarthQuakeEffect...), its class and its heroes.
 * likely, except 11 (Crystal Cache: the alien heroes' Forrest spell) and 29 (ESP or Lockdown) which are guesses.
 */
export const SPELL_NAME_TEXT: Record<number, number> = {
  3: 294, 4: 287, 5: 288, 6: 289, 7: 290, 8: 291, 9: 292,
  10: 262, 11: 281, 12: 271, 13: 263, 14: 265, 15: 264, 16: 266, 17: 267, 18: 268, 19: 269,
  20: 270, 21: 277, 22: 276, 23: 272, 24: 273, 25: 275, 26: 274, 27: 278, 28: 279, 29: 283,
  30: 282, 31: 285, 32: 284,
};
