import type { HitFrame } from '@lbw/extract';

/** Fallback when the game's table isn't mapped: grey from 2.5 to 5.5 ticks after the damage tick, no shake. */
const FLASH_FROM = 2.5;
const FLASH_TO = 5.5;

/**
 * The hit reaction to draw `sinceHit` ticks after the tick the damage landed (fractional, with the
 * render's interpolation). The effect starts the tick after the hit and steps one record per tick
 * (0x0201C508); record k shows from k + 1.5 to k + 2.5 ticks, which puts the grey records 1-3 on
 * the 2.5-5.5 window measured in the emulator.
 */
export function hitFrame(frames: readonly HitFrame[] | undefined, sinceHit: number): HitFrame {
  if (!frames) return { dx: 0, flash: sinceHit >= FLASH_FROM && sinceHit < FLASH_TO };
  const k = Math.floor(sinceHit - 1.5);
  return frames[k] ?? { dx: 0, flash: false };
}
