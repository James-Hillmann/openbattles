/**
 * Sim ticks per second. The DS game's main loop aims for one update every 2nd VBlank
 * (60 Hz / 2 = 30 Hz) but sometimes runs them 1 VBlank apart, averaging ~30.7 in the
 * emulator. Lockstep needs a fixed rate, so we use 30; see docs/re-notes/formats.md,
 * "Movement speed and update rate".
 */
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ; // render-side only
/**
 * Inputs are scheduled this many ticks ahead to hide network latency (200 ms). The DS
 * game's own value isn't known (docs/re-notes/multiplayer.md); this one is ours.
 */
export const INPUT_DELAY_TICKS = 6;
/** Clients exchange a state hash every N ticks for desync detection (once a second). */
export const HASH_INTERVAL_TICKS = 30;
/** Map cell size in pixels. Positions in the sim are pixels (Fx). */
export const CELL_W = 24;
export const CELL_H = 16;
/** Speed used when a unit has no table entry: King/Swordsman walk speed. */
export const DEFAULT_SPEED = 410;
