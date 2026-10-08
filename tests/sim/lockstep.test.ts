import { describe, expect, it } from 'vitest';
import { Lockstep, createWorld, fx, hashWorld, sanitizeCommand, spawnUnit } from '@lbw/sim';

function world() {
  const w = createWorld({ seed: 7 });
  spawnUnit(w, 0, fx(10), fx(10));
  spawnUnit(w, 1, fx(200), fx(10));
  return w;
}

describe('Lockstep', () => {
  it('runs the delay ticks freely, then waits for every player', () => {
    const ls = new Lockstep(world(), { players: [0, 1], inputDelay: 2, hashInterval: 3 });
    expect(ls.step().tick).toBe(0);
    expect(ls.step().tick).toBe(1);
    expect(ls.waitingFor()).toEqual([0, 1]);
    expect(ls.addInput(1, 2, [])).toBe(true);
    expect(ls.waitingFor()).toEqual([0]);
    expect(() => ls.step()).toThrow(/waiting/);
    ls.addInput(0, 2, []);
    // Tick 2 brings the world to tick 3: a hash tick.
    expect(ls.step()).toEqual({ tick: 2, hash: hashWorld(ls.world) });
  });

  it('applies each player\'s commands on the scheduled tick, whatever order they arrive in', () => {
    const run = (order: 'ab' | 'ba') => {
      const ls = new Lockstep(world(), { players: [0, 1], inputDelay: 1 });
      ls.step();
      const a = () => ls.addInput(0, 1, [{ kind: 'move', unitIds: [1], x: fx(50), y: fx(50) }]);
      const b = () => ls.addInput(1, 1, [{ kind: 'move', unitIds: [2], x: fx(150), y: fx(50) }]);
      if (order === 'ab') { a(); b(); } else { b(); a(); }
      for (let t = 2; t < 40; t++) {
        ls.addInput(0, t, []);
        ls.addInput(1, t, []);
      }
      while (ls.canStep() && ls.world.tick < 40) ls.step();
      return ls.world;
    };
    const w = run('ab');
    expect(w.units[0]!.x).toBe(fx(50));
    expect(hashWorld(run('ba'))).toBe(hashWorld(w));
  });

  it('ignores late, duplicate, unknown-player and pre-delay input', () => {
    const ls = new Lockstep(world(), { players: [0, 1], inputDelay: 2 });
    expect(ls.addInput(0, 1, [])).toBe(false); // inside the free delay window
    expect(ls.addInput(5, 4, [])).toBe(false);
    expect(ls.addInput(0, 4, [])).toBe(true);
    expect(ls.addInput(0, 4, [{ kind: 'move', unitIds: [1], x: 0, y: 0 }])).toBe(false);
    ls.step();
    ls.step();
    ls.addInput(0, 2, []);
    ls.addInput(1, 2, []);
    ls.step();
    expect(ls.addInput(1, 2, [])).toBe(false);
  });

  it('a player can\'t move the other player\'s units through lockstep either', () => {
    const ls = new Lockstep(world(), { players: [0, 1], inputDelay: 1 });
    ls.step();
    ls.addInput(0, 1, []);
    ls.addInput(1, 1, [{ kind: 'move', unitIds: [1], x: fx(0), y: fx(300) }]);
    ls.step();
    expect(ls.world.units[0]!.ty).toBeNull();
  });
});

describe('sanitizeCommand', () => {
  it('keeps well-formed commands and strips extra fields', () => {
    expect(sanitizeCommand({ kind: 'move', unitIds: [1, 2], x: 5, y: -3, junk: 1 })).toEqual({ kind: 'move', unitIds: [1, 2], x: 5, y: -3 });
    expect(sanitizeCommand({ kind: 'attack', unitIds: [1], target: 9 })).toEqual({ kind: 'attack', unitIds: [1], target: 9 });
    expect(sanitizeCommand({ kind: 'harvest', unitIds: [1], cx: 4, cy: 5, x: 1 })).toEqual({ kind: 'harvest', unitIds: [1], cx: 4, cy: 5 });
    expect(sanitizeCommand({ kind: 'build', unitIds: [1], type: 13, cx: 4, cy: 5 })).toEqual({ kind: 'build', unitIds: [1], type: 13, cx: 4, cy: 5 });
    expect(sanitizeCommand({ kind: 'construct', unitIds: [1], site: 7 })).toEqual({ kind: 'construct', unitIds: [1], site: 7 });
    expect(sanitizeCommand({ kind: 'train', building: 7, type: 2 })).toEqual({ kind: 'train', building: 7, type: 2 });
    expect(sanitizeCommand({ kind: 'train', building: 7, type: 2.5 })).toBeNull();
  });
  it('drops anything the sim could choke on', () => {
    for (const bad of [null, 3, 'move', {}, { kind: 'move', unitIds: [1], x: 1.5, y: 0 }, { kind: 'move', unitIds: 'all', x: 0, y: 0 },
      { kind: 'move', unitIds: [1], x: 2 ** 40, y: 0 }, { kind: 'attack', unitIds: [1] }, { kind: 'nuke' }])
      expect(sanitizeCommand(bad)).toBeNull();
  });
});
