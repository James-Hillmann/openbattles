import { describe, expect, it } from 'vitest';
import { createWorld, fx, fxToFloat, spawnUnit, step } from '@lbw/sim';

/**
 * Per-update position deltas of the King (speed 410) read from the game's RAM in
 * DeSmuME. The game stores positions as 20.12 pixels, so these are 1/4096 px.
 * See docs/re-notes/formats.md, "Movement speed and update rate".
 */
const measured = [
  { dir: 'right', cells: [1, 0], step: [9840, 0] },
  { dir: 'down', cells: [0, 1], step: [0, 6560] },
  { dir: 'down-right 1:1 cells', cells: [1, 1], step: [6957, 4638] },
  { dir: 'up-left 3:5 cells', cells: [-3, -5], step: [-5062, -5625] },
] as const;

describe('movement matches the game per update', () => {
  for (const m of measured) {
    it(`moves like the game going ${m.dir}`, () => {
      const w = createWorld({ seed: 1 });
      const u = spawnUnit(w, 0, fx(0), fx(0), 410);
      u.tx = fx(m.cells[0] * 24 * 20);
      u.ty = fx(m.cells[1] * 16 * 20);
      step(w, []);
      // Within 1/4096 px of the game's own step: the formats differ (Q16.16 vs 20.12), the speed does not.
      expect(Math.abs(fxToFloat(u.x) * 4096 - m.step[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(fxToFloat(u.y) * 4096 - m.step[1])).toBeLessThanOrEqual(1);
    });
  }
});
