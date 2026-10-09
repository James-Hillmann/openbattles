import { romFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import type { Rgba } from './render';
import type { UnpackedRom } from './rom';

/**
 * The blue Actions strip's icons and the battle alert's crossed swords, from the strip texture
 * UI/AllInOne/UI_MainCastle (256x256). The order icons sit in one row at y 144, 24 px apart:
 * attack, rally (single arrow), patrol (double arrow), harvest, move, repair, ?, ?, stop, stand
 * ground. docs/re-notes/orders.md
 * confirmed (emulator): the Castle's strip shows the single arrow then the octagon; the King's
 * shows target, wrench, shield, double arrow, stairs, octagon. The alert icon's cell is likely
 * (it matches the emulator's bottom-right icon by eye).
 */
export const ACTION_CELLS = {
  attack: [0, 144],
  rally: [24, 144],
  patrol: [48, 144],
  move: [96, 144],
  // The stairs at 96 are the Load button (transports.md: tapping it, then a ship, loaded the King), and
  // the box on a crane next to the wrench is Unload (likely, by its picture; the transport's strip shows both).
  load: [96, 144],
  repair: [120, 144],
  unload: [144, 144],
  stop: [192, 144],
  stand: [216, 144],
  alert: [136, 24],
} as const satisfies Record<string, readonly [number, number]>;

export type ActionIcon = keyof typeof ACTION_CELLS;

/** The Actions strip uses the texture's palette bank 1 (blue). confirmed (emulator, by colour) */
const ACTION_BANK = 1;

/** 24x24 icons by name; empty when the ROM lacks the texture. */
export function actionIcons(rom: UnpackedRom): Partial<Record<ActionIcon, Rgba>> {
  let chars: ReturnType<typeof decodeChars>;
  let pal: Uint8Array;
  try {
    chars = decodeChars(romFile(rom, 'UI/AllInOne/UI_MainCastle.NCGR'));
    pal = decodePalette(romFile(rom, 'UI/AllInOne/UI_MainCastle.NCLR'));
  } catch {
    return {};
  }
  const out: Partial<Record<ActionIcon, Rgba>> = {};
  for (const [name, [x0, y0]] of Object.entries(ACTION_CELLS) as [ActionIcon, readonly [number, number]][]) {
    const img: Rgba = { width: 24, height: 24, data: new Uint8ClampedArray(24 * 24 * 4) };
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        const v = chars.pixels[((sy >> 3) * chars.tilesWide + (sx >> 3)) * 64 + (sy & 7) * 8 + (sx & 7)] ?? 0;
        const o = (ACTION_BANK * 16 + v) * 4;
        // Index 0 is the strip colour; the alert icon floats over the map, so its index 0 is clear.
        img.data.set([pal[o]!, pal[o + 1]!, pal[o + 2]!, name === 'alert' && v === 0 ? 0 : 255], (y * 24 + x) * 4);
      }
    out[name] = img;
  }
  return out;
}
