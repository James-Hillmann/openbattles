import { describe, expect, it } from 'vitest';
import { heroFxFrame, iconFrame, iconLift, ICON_BLINK_TICKS } from '../../client/src/spellFx';

describe('hero cast effect', () => {
  it('plays the swirl once, then loops it; the dome grows and leaves the picture', () => {
    const run = Array.from({ length: 12 }, (_, s) => heroFxFrame(s, null));
    expect(run.map((f) => f.swirl)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 3, 4, 5]);
    expect(run.map((f) => f.dome)).toEqual([-1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1]);
    expect(run.map((f) => f.icon)).toEqual([false, false, false, false, true, true, true, true, true, true, true, true]);
  });

  it('ends on a sparkle and a second dome, then is done', () => {
    const run = Array.from({ length: 10 }, (_, k) => heroFxFrame(20 + k, 20));
    // The swirl's counter restarts at 1, so the sparkle shows frame 10 alone (0x0201B6B0).
    expect(run.map((f) => f.swirl)).toEqual([2, 3, 10, -1, -1, -1, -1, -1, -1, -1]);
    expect(run.map((f) => f.dome)).toEqual([-1, 10, 11, 12, 13, 14, 15, -1, -1, -1]);
    expect(run.map((f) => f.icon)).toEqual([true, true, true, true, false, false, false, false, false, false]);
    expect(run.map((f) => f.done)).toEqual([false, false, false, false, false, false, false, true, true, true]);
  });
});

describe('unit icons', () => {
  const bob = [
    { x: 0, y: 0 },
    { x: 3, y: -1 },
    { x: 5, y: -2 },
  ];
  it('bobs along the path, then blinks out between alpha 31 and 5', () => {
    expect([0, 1, 2, 3].map((a) => iconFrame(bob, a, null))).toEqual([
      { x: 0, y: 0, alpha: 31 },
      { x: 3, y: -1, alpha: 31 },
      { x: 5, y: -2, alpha: 31 },
      { x: 0, y: 0, alpha: 31 },
    ]);
    expect([0, 1, 2].map((b) => iconFrame(bob, 9, b)?.alpha)).toEqual([31, 5, 31]);
    expect(iconFrame(bob, 9, ICON_BLINK_TICKS)).toBeNull();
  });

  it('sits 28 px up on minifigures and 40 px on vehicles', () => {
    expect(iconLift(0)).toBe(28);
    expect(iconLift(6)).toBe(40);
  });
});
