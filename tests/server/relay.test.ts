import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { parseSettings, startRelay } from '@lbw/server';
import { DEFAULT_SETTINGS, type ServerMsg } from '@lbw/server/protocol';

const PORT = 18787;
let codes = 0;
const wss = startRelay({ port: PORT, seed: () => 99, code: () => `C${codes++}` });
afterAll(() => new Promise<void>((r) => {
  for (const c of wss.clients) c.terminate();
  wss.close(() => r());
}));

type Of<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const inbox: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    inbox.push(JSON.parse(String(d)));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async <T extends ServerMsg['t']>(t: T): Promise<Of<T>> => {
    for (;;) {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return inbox.splice(i, 1)[0] as Of<T>;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  /** Drop queued lobby updates and wait for the newest one. */
  const settle = async () => {
    let last = await next('lobby');
    await new Promise((r) => setTimeout(r, 20));
    for (let i; (i = inbox.findIndex((m) => m.t === 'lobby')) >= 0; ) last = inbox.splice(i, 1)[0] as Of<'lobby'>;
    return last;
  };
  const open = new Promise<void>((r) => ws.on('open', () => r()));
  return { ws, next, settle, open, send: (m: object) => ws.send(JSON.stringify(m)) };
}

async function pair() {
  const a = client();
  const b = client();
  await Promise.all([a.open, b.open]);
  a.send({ t: 'host', name: 'Ann', rom: 'r' });
  const { code } = await a.next('lobby');
  b.send({ t: 'join', code: code.toLowerCase(), name: 'Bob', rom: 'r' });
  await b.next('lobby');
  await a.next('lobby');
  return { a, b, code };
}

describe('relay lobby', () => {
  it('hosts a room, lets a second player join by code, and gives each a distinct color', async () => {
    const { a, b, code } = await pair();
    a.send({ t: 'me', faction: 'W' });
    const lobby = await b.settle();
    expect(lobby).toMatchObject({ code, you: 1, host: 0, maxPlayers: 2, settings: DEFAULT_SETTINGS });
    expect(lobby.players).toEqual([
      { slot: 0, name: 'Ann', color: 0, faction: 'W', ready: false },
      { slot: 1, name: 'Bob', color: 1, faction: 'K', ready: false },
    ]);
    // Taken colors can't be stolen.
    b.send({ t: 'me', color: 0 });
    expect((await b.settle()).players[1]!.color).toBe(1);
    // An army from the army screen: nine entity names; anything else is ignored.
    const army = ['DwarfKing', 'P_Builder', 'Troll', 'K_Archer', 'W_Skeleknight', 'K_Ballista', 'WarJunk', 'A_SiegeThree', 'I_TransportShip'];
    b.send({ t: 'me', army });
    expect((await b.settle()).players[1]!.army).toEqual(army);
    b.send({ t: 'me', army: ['<script>', ...army.slice(1)] });
    expect((await b.settle()).players[1]!.army).toEqual(army);
    b.send({ t: 'me', army: null });
    expect((await b.settle()).players[1]!.army).toBeUndefined();
    a.ws.close();
    b.ws.close();
  });

  it('refuses a third player, a wrong code and a different ROM', async () => {
    const { a, b, code } = await pair();
    const c = client();
    await c.open;
    c.send({ t: 'join', code, name: 'Cy', rom: 'r' });
    expect(await c.next('error')).toMatchObject({ code: 'room-full' });
    const d = client();
    await d.open;
    d.send({ t: 'join', code: 'NOPE', name: 'Di', rom: 'r' });
    expect(await d.next('error')).toMatchObject({ code: 'no-room' });
    a.ws.close();
    await b.settle(); // Ann left: Bob becomes host of an open room
    const e = client();
    await e.open;
    e.send({ t: 'join', code, name: 'Ed', rom: 'other' });
    expect(await e.next('error')).toMatchObject({ code: 'rom-mismatch' });
    for (const x of [b, c, d, e]) x.ws.close();
  });

  it('only the host changes settings, which clears ready, and launch waits for ready', async () => {
    const { a, b } = await pair();
    b.send({ t: 'settings', settings: { ...DEFAULT_SETTINGS, bank: 2500 } });
    expect(await b.next('error')).toMatchObject({ code: 'not-host' });
    b.send({ t: 'me', ready: true });
    await a.settle();
    a.send({ t: 'settings', settings: { ...DEFAULT_SETTINGS, map: 'mp07', bank: 1000, game: 'gold-rush' } });
    const l = await a.settle();
    expect(l.settings).toMatchObject({ map: 'mp07', bank: 1000, game: 'gold-rush' });
    expect(l.players[1]!.ready).toBe(false);
    a.send({ t: 'launch' });
    expect(await a.next('error')).toMatchObject({ code: 'not-ready' });
    b.send({ t: 'me', ready: true });
    await a.settle();
    a.send({ t: 'launch' });
    const s = await b.next('start');
    expect(s).toMatchObject({ seed: 99, settings: { map: 'mp07', bank: 1000 } });
    expect(s.players.map((p) => p.slot)).toEqual([0, 1]);
    a.ws.close();
    b.ws.close();
  });

  it('host can remove a player', async () => {
    const { a, b } = await pair();
    a.send({ t: 'kick', slot: 1 });
    await b.next('kicked');
    expect((await a.settle()).players).toHaveLength(1);
    a.ws.close();
  });

  it('in game: forwards inputs to the other player only and flags a hash mismatch', async () => {
    const { a, b } = await pair();
    b.send({ t: 'me', ready: true });
    await a.settle();
    a.send({ t: 'launch' });
    await a.next('start');
    await b.next('start');

    a.send({ t: 'input', tick: 6, cmds: [{ kind: 'move' }] });
    expect(await b.next('input')).toEqual({ t: 'input', player: 0, tick: 6, cmds: [{ kind: 'move' }] });

    a.send({ t: 'hash', tick: 30, hash: 1 });
    b.send({ t: 'hash', tick: 30, hash: 2 });
    expect(await a.next('desync')).toEqual({ t: 'desync', tick: 30, hashes: [1, 2] });
    b.ws.close();
    expect(await a.next('peer-left')).toEqual({ t: 'peer-left', player: 1 });
    a.ws.close();
  });
});

describe('parseSettings', () => {
  it('accepts the defaults and rejects anything off the menu', () => {
    expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ ...DEFAULT_SETTINGS, bank: 750 })).toBeNull();
    expect(parseSettings({ ...DEFAULT_SETTINGS, game: 'chess' })).toBeNull();
    expect(parseSettings({ ...DEFAULT_SETTINGS, map: '../x' })).toBeNull();
    expect(parseSettings({ ...DEFAULT_SETTINGS, extra: 1 })).toEqual(DEFAULT_SETTINGS);
  });
});
