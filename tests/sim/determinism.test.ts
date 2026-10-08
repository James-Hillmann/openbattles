import { describe, expect, it } from 'vitest';
import { createWorld, fx, hashWorld, replay, spawnUnit, type InputLog, type World } from '@lbw/sim';

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
    expect(hashWorld(w).toString(16)).toMatchInlineSnapshot(`"230c69f2"`);
  });

  it('units actually arrive', () => {
    const w = setup(log.seed);
    replay(w, log);
    const u3 = w.units.find((u) => u.id === 3)!;
    expect([u3.x, u3.y]).toEqual([fx(300), fx(250)]);
  });
});
