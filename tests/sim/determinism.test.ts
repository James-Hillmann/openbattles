import { describe, expect, it } from 'vitest';
import { createWorld, fx, fxToFloat, hashWorld, replay, spawnUnit, step, type InputLog, type World } from '@lbw/sim';

function setup(seed: number): World {
  const w = createWorld({ seed });
  for (let i = 0; i < 4; i++) spawnUnit(w, 0, fx(80 + i * 24), fx(120));
  for (let i = 0; i < 4; i++) spawnUnit(w, 1, fx(400 + i * 24), fx(300));
  return w;
}

/** A recorded input log. Real ones get dumped by clients on desync and dropped in tests/replays/. */
const log: InputLog = {
  seed: 1234,
  ticks: 300,
  commands: [
    { tick: 3, player: 0, cmd: { kind: 'move', unitIds: [1, 2, 3, 4], x: fx(300), y: fx(250) } },
    { tick: 3, player: 1, cmd: { kind: 'move', unitIds: [5, 6, 7, 8], x: fx(100), y: fx(90) } },
    { tick: 60, player: 1, cmd: { kind: 'move', unitIds: [5, 6], x: fx(321), y: fx(17) } },
    { tick: 61, player: 0, cmd: { kind: 'move', unitIds: [1], x: fx(5), y: fx(400) } },
    // Player 1 trying to move player 0's unit must be ignored.
    { tick: 90, player: 1, cmd: { kind: 'move', unitIds: [2], x: fx(0), y: fx(0) } },
  ],
};

describe('determinism', () => {
  it('two independent runs of the same log produce identical hashes every tick', () => {
    const a = replay(setup(log.seed), log);
    const b = replay(setup(log.seed), log);
    expect(a).toHaveLength(log.ticks);
    expect(a).toEqual(b);
  });

  it('command arrival order within a tick does not matter', () => {
    const shuffled: InputLog = { ...log, commands: [...log.commands].reverse() };
    expect(replay(setup(log.seed), shuffled)).toEqual(replay(setup(log.seed), log));
  });

  it('final state hash is pinned (update deliberately when sim rules change)', () => {
    const w = setup(log.seed);
    replay(w, log);
    expect(hashWorld(w).toString(16)).toMatchInlineSnapshot(`"42c4e64a"`);
  });

  it('moves the same number of cells per tick in every direction', () => {
    // Speed 410 = 410/4096 cell per tick, so 30 ticks (1 s) is ~3 cells:
    // 72 px sideways (24 px cells) but only 48 px down (16 px cells).
    const w = createWorld({ seed: 1 });
    spawnUnit(w, 0, fx(0), fx(0));
    spawnUnit(w, 0, fx(0), fx(0));
    const far = fx(1000);
    w.units[0]!.tx = far; w.units[0]!.ty = fx(0);
    w.units[1]!.tx = fx(0); w.units[1]!.ty = far;
    for (let i = 0; i < 30; i++) step(w, []);
    expect(Math.round(fxToFloat(w.units[0]!.x))).toBe(72);
    expect(Math.round(fxToFloat(w.units[1]!.y))).toBe(48);
  });

  it('units actually arrive', () => {
    const w = setup(log.seed);
    replay(w, log);
    const u3 = w.units.find((u) => u.id === 3)!;
    expect([u3.x, u3.y]).toEqual([fx(300), fx(250)]);
  });
});
