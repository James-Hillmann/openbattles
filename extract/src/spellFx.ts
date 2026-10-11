import type { UnpackedRom } from './rom';
import { tryRomFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import type { Rgba } from './render';

/**
 * Spell pictures (docs/re-notes/spells.md "Pictures"): the hero's cast effect (HeroStartSpellEffect)
 * and the icons over buffed and healed units (SpellIcons*Effect). Both draw 24 x 24 quads cut from the
 * faction's effects sheet, `UI/AllInOne/<Castle|Pirate|Mars>Effects` (256 x 256, 4bpp, stored
 * linearly), through `UI/Game/UIMgrData.bin`: record n (28 bytes) holds at +8 the file offset of a
 * picture record whose +0x0F byte is the palette bank and +0x14 the s16 x, y, w, h in the sheet.
 */

/** Effects sheet per faction letter (0x0202EC9C picks it from the local player's faction). */
export const EFFECT_SHEETS = { K: 'Castle', W: 'Castle', P: 'Pirate', I: 'Pirate', E: 'Mars', A: 'Mars' } as const;
export type EffectSheet = (typeof EFFECT_SHEETS)[keyof typeof EFFECT_SHEETS];

/** Unit icons (0x020200B8): UIMgrData ids. */
export const UNIT_ICON_IDS = { heart: 0x4ce, speed: 0x4d0, sword: 0x4d2, armour: 0x4d4, chop: 0x4c5, mine: 0x4c4, wheel: 0x4b8, wind: 0x4cb } as const;
export type UnitIcon = keyof typeof UNIT_ICON_IDS;

/** The hero effect's 18 frames (0x0201BA50): swirl 0-7, sparkles 8-9, the dome 10-16 (17 unused). */
const HERO_FRAME_FIRST = 0x495;
const HERO_FRAMES = 18;
/** Gold spell pictures over the hero: id 0x4A7 + kind (`HERO_SPELL_KIND`). */
const HERO_ICON_FIRST = 0x4a7;
const HERO_ICONS = 32;

/**
 * Which picture the hero shows for each spell (the kind passed to 0x02016BFC by each spell class).
 * Confirmed from code: 4-9, 17, 19, 24 (StatBufSpell 0x0207C5C0), 14-16 (projectiles), 18, 20-23, 25,
 * 26, 27, 28, 29, 30, 31, 32 (DamageSpell 0x02076234 and the effect classes); 13 seen in the emulator;
 * 10-12 likely (three calls in a row in ForrestSpell). Heals (1-3) start none.
 */
export const HERO_SPELL_KIND: Record<number, number> = {
  4: 0, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 6, 11: 7, 12: 8, 13: 9, 14: 0xa, 15: 0xb, 16: 0xc, 17: 0x1d, 18: 0x1f,
  19: 0x1e, 20: 0xd, 21: 0xe, 22: 0xf, 23: 0x10, 24: 0x11, 25: 0x12, 26: 0x13, 27: 0x15, 28: 0x16, 29: 0x17,
  30: 0x18, 31: 0x1a, 32: 0x1b,
};

/** The damage and freeze spells' own pictures (client/src/spellAnims.ts): UIMgrData ids. */
export const SPELL_FX_PICS = {
  explosion: [0x4d9, 0x4da, 0x4db, 0x4dc, 0x4dd],
  arrowFall: 0x4ee,
  arrowStuck: 0x4ef,
  bomb: 0x4ed,
  shell: 0x4f0,
  coconut: [0x445, 0x446, 0x447, 0x448, 0x449, 0x44a],
  monkey: [0x4f4, 0x4f5],
  monkeyPuff: 0x432,
  crab: 0x4f6,
  crabDust: [0x4f7, 0x4f8],
  laser: [0x4e5, 0x4e6, 0x4e7, 0x4e8],
  laserHit: [0x4e9, 0x4ea, 0x4eb],
  roar: [0x45f, 0x460, 0x461, 0x462, 0x463, 0x464, 0x465],
  fireball: [0x456, 0x457, 0x458, 0x459, 0x45a, 0x45b, 0x45c, 0x45d, 0x45e],
  bolt: [0x4d6, 0x4d7, 0x4d8],
  hammer: [0x4f1, 0x4f2],
  freezeMinifig: 0x493,
  freezeVehicle: 0x494,
} as const;

/** Every picture id above, for extract. */
export const SPELL_FX_PIC_IDS: number[] = Object.values(SPELL_FX_PICS).flatMap((v) => (typeof v === 'number' ? [v] : [...v]));

/** ARM9 address of the icons' 14-step bob path (12-byte records: vtable, s32 x, s32 y in 20.12). */
const BOB_TABLE: Record<string, number> = { C5SE: 0x0215118c };
const BOB_STEPS = 14;

export interface SpellFxArt {
  /** Hero cast effect frames. */
  heroFrames: Rgba[];
  /** Gold spell pictures by kind. */
  heroIcons: Rgba[];
  units: Record<UnitIcon, Rgba>;
  /** Icon offset per tick, pixels (0x0201FBF8). */
  bob: { x: number; y: number }[];
  /** The spell effects' pictures by UIMgrData id (SPELL_FX_PIC_IDS). */
  effects?: Record<number, Rgba>;
}

export function buildSpellFx(rom: UnpackedRom, sheet: EffectSheet): SpellFxArt | undefined {
  const ui = tryRomFile(rom, 'UI/Game/UIMgrData.bin');
  const bitmap = tryRomFile(rom, `UI/AllInOne/${sheet}Effects.NCBR`);
  const palFile = tryRomFile(rom, `UI/AllInOne/${sheet}Effects.NCLR`);
  const bobAt = BOB_TABLE[rom.header.gameCode];
  if (!ui || !bitmap || !palFile || bobAt === undefined) return undefined;
  const v = new DataView(ui.buffer, ui.byteOffset, ui.length);
  const chars = decodeChars(bitmap);
  const pal = decodePalette(palFile);
  const stride = chars.tilesWide * 8;
  const picture = (id: number): Rgba => {
    const rec = v.getUint32(id * 28 + 8, true);
    const bank = ui[rec + 0xf]!;
    const r = v.getUint32(rec, true);
    const [x0, y0, w, h] = [v.getInt16(r, true), v.getInt16(r + 2, true), v.getUint16(r + 4, true), v.getUint16(r + 6, true)];
    const img: Rgba = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = chars.pixels[(y0 + y) * stride + x0 + x] ?? 0;
        if (!c) continue;
        const o = (bank * 16 + c) * 4;
        img.data.set([pal[o]!, pal[o + 1]!, pal[o + 2]!, 255], (y * w + x) * 4);
      }
    }
    return img;
  };
  const a = rom.arm9;
  const base = bobAt - rom.header.arm9.ramAddress;
  const s32 = (o: number) => a[o]! | (a[o + 1]! << 8) | (a[o + 2]! << 16) | (a[o + 3]! << 24);
  const bob = Array.from({ length: BOB_STEPS }, (_, k) => ({ x: s32(base + k * 12 + 4) >> 12, y: s32(base + k * 12 + 8) >> 12 }));
  const units = Object.fromEntries(Object.entries(UNIT_ICON_IDS).map(([k, id]) => [k, picture(id)])) as Record<UnitIcon, Rgba>;
  return {
    heroFrames: Array.from({ length: HERO_FRAMES }, (_, i) => picture(HERO_FRAME_FIRST + i)),
    heroIcons: Array.from({ length: HERO_ICONS }, (_, i) => picture(HERO_ICON_FIRST + i)),
    units,
    bob,
    effects: Object.fromEntries(SPELL_FX_PIC_IDS.map((id) => [id, picture(id)])),
  };
}
