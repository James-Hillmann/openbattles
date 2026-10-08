/** Sim ticks per second. Placeholder until the original rate is found in M0/M4. */
export const TICK_HZ = 15;
export const TICK_MS = 1000 / TICK_HZ; // render-side only
/** Inputs are scheduled this many ticks ahead to hide network latency. */
export const INPUT_DELAY_TICKS = 3;
/** Clients exchange a state hash every N ticks for desync detection. */
export const HASH_INTERVAL_TICKS = 15;
