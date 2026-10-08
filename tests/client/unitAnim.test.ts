import { describe, expect, it } from 'vitest';
import { ANIM_FRAME_MS, animate, attack, facing, type AnimState } from '../../client/src/unitAnim';

/** Infantry: walk = 5 sheet frames then the idle pose (col 0). */
const seq = { idle: 0, walk: [1, 2, 3, 4, 5, 0], attack: [6, 7, 8, 9, 10, 0] };
const t = (frames: number) => frames * ANIM_FRAME_MS + 1;

function run(steps: { at: number; moving: boolean }[], s: AnimState = { mode: 'idle' }): number[] {
  return steps.map(({ at, moving }) => {
    const r = animate(seq, s, moving, at);
    s = r.state;
    return r.col;
  });
}

describe('unit animation', () => {
  it('loops the walk cycle at 15 fps while moving', () => {
    const cols = run([0, 1, 2, 3, 4, 5, 6, 7].map((f) => ({ at: t(f), moving: true })));
    expect(cols).toEqual([1, 2, 3, 4, 5, 0, 1, 2]);
  });

  it('finishes the current walk pass after arriving, then idles', () => {
    const steps = [0, 1, 2].map((f) => ({ at: t(f), moving: true }));
    steps.push(...[3, 4, 5, 6, 7].map((f) => ({ at: t(f), moving: false })));
    expect(run(steps)).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
  });

  it('keeps the cycle running if the unit sets off again while stopping', () => {
    const cols = run([
      { at: t(0), moving: true },
      { at: t(1), moving: false },
      { at: t(2), moving: true },
      { at: t(3), moving: true },
    ]);
    expect(cols).toEqual([1, 2, 3, 4]);
  });

  it('plays an attack once and ends on idle', () => {
    const cols = run([0, 1, 2, 3, 4, 5, 6].map((f) => ({ at: t(f), moving: false })), attack(0));
    expect(cols).toEqual([6, 7, 8, 9, 10, 0, 0]);
  });

  it('maps movement to facing rows, mirroring left', () => {
    expect(facing(1, 0)).toEqual({ row: 2, flip: false });
    expect(facing(-1, 0)).toEqual({ row: 2, flip: true });
    expect(facing(0, 1)).toEqual({ row: 4, flip: false });
    expect(facing(0, -1)).toEqual({ row: 0, flip: false });
    expect(facing(-1, 1)).toEqual({ row: 3, flip: true });
  });
});
