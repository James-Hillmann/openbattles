/**
 * Bars over a unit, as the game draws them (ARM9 0x0203BED0, checked in the
 * emulator by poking HP): rows of 2x2 cells at a 3 px pitch inside a black box,
 * each row 4 px tall. Lit cells = floor(floor(100 * value / max) * 7 / 100) for a
 * 24 px unit. Unlit cells are drawn too, in a dark version of the color. The
 * health row turns orange below 40% and red below 20%. Heroes get a second,
 * orange row above it: their special-ability charge.
 * Colors are BGR555, expanded like the rest of the repo (c * 255 / 31).
 */
export const HP_BANDS = [
  { minPct: 40, lit: 0x00ff00, unlit: 0x005200 }, // 0x03E0 / 0x0140
  { minPct: 20, lit: 0xff5200, unlit: 0x101800 }, // 0x015F / 0x0062
  { minPct: 0, lit: 0xff0000, unlit: 0x520000 }, // 0x001F / 0x000A
] as const;
export const POWER_COLORS = { lit: 0xff9c00, unlit: 0x523100 }; // 0x027F / 0x00CA

/** Cell count for a bar `w` px wide (w = min(24 * footprint, 64)); drawn width is 3 * cells + 1. */
export const barCells = (w: number): number => Math.floor(w / 3) - ((w - 1) & 1);

export const litCells = (value: number, max: number, cells: number): number => {
  if (max <= 0) return 0;
  const pct = Math.floor((100 * Math.max(0, Math.min(value, max))) / max);
  return Math.floor((pct * cells) / 100);
};

/** Index into HP_BANDS for this much health. */
export const hpBand = (hp: number, maxHp: number): number => {
  const pct = maxHp > 0 ? Math.floor((100 * Math.max(0, hp)) / maxHp) : 0;
  return HP_BANDS.findIndex((b) => pct >= b.minPct);
};
