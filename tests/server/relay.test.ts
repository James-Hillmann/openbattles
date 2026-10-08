import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRelay } from '@lbw/server';
import type { ServerMsg } from '@lbw/server/protocol';

const PORT = 18787;
const wss = startRelay({ port: PORT, seed: () => 99 });
afterAll(() => new Promise<void>((r) => wss.close(() => r())));

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const inbox: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    inbox.push(JSON.parse(String(d)));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (t: ServerMsg['t']): Promise<ServerMsg> => {
    for (;;) {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const open = new Promise<void>((r) => ws.on('open', () => r()));
  return { ws, next, open, send: (m: object) => ws.send(JSON.stringify(m)) };
}

describe('relay', () => {
  it('pairs two players, forwards inputs and flags a hash mismatch', async () => {
    const a = client();
    const b = client();
    await Promise.all([a.open, b.open]);
    a.send({ t: 'join', room: 'r1' });
    expect(await a.next('joined')).toMatchObject({ player: 0 });
    b.send({ t: 'join', room: 'r1' });
    expect(await b.next('joined')).toMatchObject({ player: 1 });
    expect(await a.next('start')).toEqual({ t: 'start', seed: 99, players: 2 });
    await b.next('start');

    a.send({ t: 'input', tick: 3, cmds: [{ kind: 'move' }] });
    expect(await b.next('input')).toEqual({ t: 'input', player: 0, tick: 3, cmds: [{ kind: 'move' }] });

    a.send({ t: 'hash', tick: 15, hash: 1 });
    b.send({ t: 'hash', tick: 15, hash: 2 });
    expect(await a.next('desync')).toEqual({ t: 'desync', tick: 15, hashes: [1, 2] });
    a.ws.close();
    b.ws.close();
  });
});
