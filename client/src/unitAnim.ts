/**
 * Which animation frame a unit shows. Render-side only, never feeds the sim.
 *
 * Seen in the emulator (docs/re-notes/formats.md "Unit animation"):
 * - every unit animation advances one frame per 4 VBlanks (15 fps);
 * - the walk cycle keeps running across facing changes;
 * - when a unit arrives it finishes the current pass of its walk cycle before going idle.
 */
export const ANIM_FRAME_MS = (4 * 1000) / 60;

export interface Sequences {
  idle: number;
  walk: readonly number[];
  attack: readonly number[];
}

export type AnimState =
  | { mode: 'idle' }
  | { mode: 'walk'; start: number }
  /** Arrived; playing out the walk pass that was running. */
  | { mode: 'stopping'; start: number; endPass: number }
  | { mode: 'attack'; start: number };

const frameIndex = (start: number, now: number) => Math.floor((now - start) / ANIM_FRAME_MS);

/** Advance the state for this render frame and return it with the atlas column to draw. */
export function animate(seq: Sequences, s: AnimState, moving: boolean, now: number): { state: AnimState; col: number } {
  if (s.mode === 'attack') {
    const i = frameIndex(s.start, now);
    if (i < seq.attack.length) return { state: s, col: seq.attack[i]! };
    s = { mode: 'idle' };
  }
  if (moving) {
    const start = s.mode === 'walk' || s.mode === 'stopping' ? s.start : now;
    const w: AnimState = { mode: 'walk', start };
    return { state: w, col: seq.walk[frameIndex(start, now) % seq.walk.length]! };
  }
  if (s.mode === 'walk') {
    const pass = Math.floor(frameIndex(s.start, now) / seq.walk.length);
    s = { mode: 'stopping', start: s.start, endPass: pass + 1 };
  }
  if (s.mode === 'stopping') {
    const i = frameIndex(s.start, now);
    if (i < s.endPass * seq.walk.length) return { state: s, col: seq.walk[i % seq.walk.length]! };
    s = { mode: 'idle' };
  }
  return { state: s, col: seq.idle };
}

/** Start an attack swing now. It plays once and ends on the idle pose. */
export const attack = (now: number): AnimState => ({ mode: 'attack', start: now });

/**
 * Facing row + mirror from a movement vector. Rows are back, back-right, right,
 * front-right, front; sprites natively face right, left facings are mirrored.
 */
export function facing(dx: number, dy: number): { row: number; flip: boolean } {
  const a = Math.atan2(dy, dx); // render-side only; never feeds the sim
  const oct = Math.round(a / (Math.PI / 4)); // -4..4, 0 = right, 2 = down
  const rowByOct: Record<number, number> = { [-4]: 2, [-3]: 1, [-2]: 0, [-1]: 1, 0: 2, 1: 3, 2: 4, 3: 3, 4: 2 };
  return { row: rowByOct[oct] ?? 4, flip: Math.abs(oct) >= 3 };
}
