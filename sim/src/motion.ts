import { fxAdd, fxLen, fxMulDiv, fxRaw, type Fx } from './fixed';

/**
 * The game moves units in cell space: a cell is 24x16 px, but a unit covers the
 * same number of cells per tick in any direction, so it is faster in px going
 * sideways than up/down. We measure distance in 48ths of a cell (48 = lcm(24,16)):
 * 1 px across = 2/48 cell, 1 px down = 3/48 cell.
 * Moves (x, y) toward (tx, ty) by at most `budget` (48ths of a cell, Fx).
 */
export function stepToward(x: Fx, y: Fx, tx: Fx, ty: Fx, budget: Fx): { x: Fx; y: Fx; arrived: boolean; left: Fx } {
  const dx = (tx - x) as Fx;
  const dy = (ty - y) as Fx;
  const dist48 = fxLen((dx * 2) as Fx, (dy * 3) as Fx);
  if (dist48 <= budget) return { x: tx, y: ty, arrived: true, left: (budget - dist48) as Fx };
  // Scale by budget/dist in one go. A Q16.16 ratio budget/dist is tiny on long moves and truncating it
  // made units slower the farther away their target was (0.4% at 20 cells).
  return { x: fxAdd(x, fxMulDiv(dx, budget, dist48)), y: fxAdd(y, fxMulDiv(dy, budget, dist48)), arrived: false, left: 0 as Fx };
}

/** speed/4096 cell = speed*48/4096 48ths = speed*768 in Fx raw units. */
export const stepBudget = (speed: number): Fx => fxRaw(speed * 768);
