import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRelay } from '@lbw/server';
import type { ServerMsg } from '@lbw/server/protocol';
import { fx, hashWorld, makeRng, nextInt, type Command } from '@lbw/sim';
import { Match, RelayClient, bareWorld, type Socket } from '../../client/src/match';

const PORT = 18788;
const wss = startRelay({ port: PORT, seed: () => 4242, code: (() => { let n = 0; return () => `R${n++}`; })() });
afterAll(() => new Promise<void>((r) => {
  for (const c of wss.clients) c.terminate();
  wss.close(() => r());
}));

/**
 * A `ws` socket whose outgoing messages each wait a random 0-40 ms, so they also
 * arrive out of order: the lockstep layer must not care.
 */
function laggySocket(seed: number): Socket {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const rng = makeRng(seed);
  const send = ws.send.bind(ws);
  return Object.assign(ws, {
    send: (d: string) => {
      setTimeout(() => ws.readyState === ws.OPEN && send(d), nextInt(rng, 40));
    },
  }) as unknown as Socket;
}

const next = (c: RelayClient, t: ServerMsg['t']) =>
  new Promise<ServerMsg>((resolve) => {
    const off = c.on((m) => {
      if (m.t === t) {
        off();
        resolve(m);
      }
    });
  });

/** Connect two clients through the lobby and return the start message each one saw. */
async function startPair(seedA: number, seedB: number) {
  const a = new RelayClient(laggySocket(seedA));
  const b = new RelayClient(laggySocket(seedB));
  await Promise.all([a.opened, b.opened]);
  const lobbyA = next(a, 'lobby');
  a.send({ t: 'host', name: 'Ann', rom: 'test' });
  const { code } = (await lobbyA) as Extract<ServerMsg, { t: 'lobby' }>;
  const lobbyB = next(b, 'lobby');
  b.send({ t: 'join', code, name: 'Bob', rom: 'test' });
  await lobbyB;
  const ready = next(a, 'lobby');
  b.send({ t: 'me', ready: true });
  await ready;
  const starts = Promise.all([next(a, 'start'), next(b, 'start')]);
  a.send({ t: 'launch' });
  const [sa, sb] = (await starts) as Extract<ServerMsg, { t: 'start' }>[];
  return { a, b, sa: sa!, sb: sb! };
}

/** Run both matches until each reaches `ticks`, each issuing its own random orders. */
async function play(ma: Match, mb: Match, ticks: number, perturb?: (m: Match) => void) {
  const hashes: number[][] = [[], []];
  const orderRng = [makeRng(1), makeRng(2)];
  const drive = (m: Match, i: number) => {
    while (m.world.tick < ticks) {
      const r = m.tick();
      if (!r) return;
      hashes[i]!.push(hashWorld(m.world));
      if (nextInt(orderRng[i]!, 10) === 0) {
        const mine = m.world.units.filter((u) => u.owner === m.local).map((u) => u.id);
        const cmd: Command = { kind: 'move', unitIds: mine, x: fx(nextInt(orderRng[i]!, 600)), y: fx(nextInt(orderRng[i]!, 440)) };
        m.issue(cmd);
      }
      if (i === 1 && perturb) perturb(m);
    }
  };
  for (let spins = 0; spins < 20000 && (ma.world.tick < ticks || mb.world.tick < ticks); spins++) {
    drive(ma, 0);
    drive(mb, 1);
    if (ma.desynced || mb.desynced) break;
    await new Promise((r) => setTimeout(r, 1));
  }
  return hashes;
}

describe('lockstep over the relay', () => {
  it('two clients with jittery links run the same match tick for tick', async () => {
    const { a, b, sa, sb } = await startPair(11, 22);
    expect({ ...sa, you: 1 }).toEqual(sb);
    expect(sa.you).toBe(0);
    expect(sa.seed).toBe(4242);
    const ma = new Match(bareWorld(sa.seed), 0, [0, 1], a);
    const mb = new Match(bareWorld(sb.seed), 1, [0, 1], b);
    const [ha, hb] = await play(ma, mb, 300);
    expect(ha).toHaveLength(300);
    expect(hb).toEqual(ha);
    // Both sides' orders actually ran: every unit has moved off its spawn.
    expect(ma.world.units.every((u, i) => u.x !== bareWorld(1).units[i]!.x || u.y !== bareWorld(1).units[i]!.y)).toBe(true);
    // Let the last hash reports land, then confirm the relay saw no mismatch.
    await new Promise((r) => setTimeout(r, 100));
    expect(ma.desynced).toBeNull();
    expect(mb.desynced).toBeNull();
    a.socket.close();
    b.socket.close();
  });

  it('a client that is slow to build its world still gets the inputs sent meanwhile', async () => {
    const { a, b, sa } = await startPair(77, 88);
    const ma = new Match(bareWorld(sa.seed), 0, [0, 1], a);
    // A races ahead to the end of its free delay window and sends its first inputs...
    while (ma.tick()) {}
    await new Promise((r) => setTimeout(r, 150));
    // ...before B (still "loading the map") has a Match to receive them.
    const mb = new Match(bareWorld(sa.seed), 1, [0, 1], b);
    const [ha, hb] = await play(ma, mb, 120);
    expect(hb!.slice(-ha!.length)).toEqual(ha);
    expect(hashWorld(mb.world)).toBe(hashWorld(ma.world));
    expect(mb.world.tick).toBe(120);
    a.socket.close();
    b.socket.close();
  });

    it('the relay flags a client whose state drifts', async () => {
    const { a, b, sa } = await startPair(33, 44);
    const ma = new Match(bareWorld(sa.seed), 0, [0, 1], a);
    const mb = new Match(bareWorld(sa.seed), 1, [0, 1], b);
    let nudged = false;
    await play(ma, mb, 200, (m) => {
      if (!nudged && m.world.tick === 40) {
        m.world.units[0]!.x = (m.world.units[0]!.x + 1) as typeof m.world.units[0]['x'];
        nudged = true;
      }
    });
    for (let i = 0; i < 100 && !(ma.desynced && mb.desynced); i++) await new Promise((r) => setTimeout(r, 10));
    // The first hash after the nudge (tick 60) is where both learn of it, and both stop.
    expect(ma.desynced?.tick).toBe(60);
    expect(mb.desynced?.tick).toBe(60);
    expect(ma.tick()).toBeNull();
    a.socket.close();
    b.socket.close();
  });

  it('stops and reports when the other player leaves', async () => {
    const { a, b, sa } = await startPair(55, 66);
    const ma = new Match(bareWorld(sa.seed), 0, [0, 1], a);
    const gone = new Promise<number>((r) => a.on((m) => m.t === 'peer-left' && r(m.player)));
    b.socket.close();
    expect(await gone).toBe(1);
    expect(ma.left).toEqual([1]);
    expect(ma.tick()).toBeNull();
    a.socket.close();
  });
});
