import { randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BANKS,
  DEFAULT_SETTINGS,
  FACTION_PREFIXES,
  GAME_TYPES,
  MIN_PLAYERS,
  ROOM_SIZE,
  TEAM_COLORS,
  type ClientMsg,
  type ErrorCode,
  type GameSettings,
  type LobbyPlayer,
  type ServerMsg,
} from './protocol';

/** One connection. `slot` moves when the lobby compacts at launch. */
interface Conn {
  ws: WebSocket;
  room: Room | null;
  slot: number;
}

interface Seat {
  conn: Conn;
  player: LobbyPlayer;
}

interface Room {
  code: string;
  rom: string;
  maxPlayers: number;
  /** Index = slot. Null = free (lobby) or left (in game). */
  seats: (Seat | null)[];
  host: number;
  settings: GameSettings;
  started: boolean;
  /** tick -> hash per slot, dropped once every player still in the game has reported. */
  hashes: Map<number, (number | undefined)[]>;
}

export interface RelayOptions {
  port: number;
  /** Match seed; relay-side randomness is fine, the sim only ever sees the number. */
  seed?: () => number;
  /** Room code generator (tests pin it). */
  code?: () => string;
  maxPlayers?: number;
}

/** No 0/O, 1/I/L: codes get read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
/** Inputs are a few commands per tick; anything bigger is abuse. */
const MAX_PAYLOAD = 16 * 1024;

const send = (ws: WebSocket | null | undefined, msg: ServerMsg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

const cleanName = (n: unknown) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 10) : '') || 'Player';

/** Accept only well-formed settings; the relay is the one place both clients agree on them. */
export function parseSettings(s: unknown): GameSettings | null {
  if (typeof s !== 'object' || s === null) return null;
  const o = s as Record<string, unknown>;
  if (!GAME_TYPES.includes(o.game as never) || !BANKS.includes(o.bank as never)) return null;
  if (typeof o.map !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(o.map)) return null;
  if (typeof o.randomStart !== 'boolean' || typeof o.prebase !== 'boolean') return null;
  return { game: o.game as GameSettings['game'], map: o.map, randomStart: o.randomStart, prebase: o.prebase, bank: o.bank as GameSettings['bank'] };
}

export function startRelay(opts: RelayOptions): WebSocketServer {
  const rooms = new Map<string, Room>();
  const seed = opts.seed ?? (() => randomInt(0x7fffffff));
  const newCode = opts.code ?? randomCode;
  const maxPlayers = Math.min(TEAM_COLORS, opts.maxPlayers ?? ROOM_SIZE);
  const wss = new WebSocketServer({ port: opts.port, maxPayload: MAX_PAYLOAD });

  const players = (r: Room) => r.seats.filter((s): s is Seat => s !== null).map((s) => s.player);
  const broadcastLobby = (r: Room) => {
    r.seats.forEach((s, you) => {
      if (s) send(s.conn.ws, { t: 'lobby', code: r.code, you, host: r.host, maxPlayers: r.maxPlayers, settings: r.settings, players: players(r) });
    });
  };
  const freeColor = (r: Room) => {
    const used = new Set(players(r).map((p) => p.color));
    for (let c = 0; c < TEAM_COLORS; c++) if (!used.has(c)) return c;
    return 0;
  };

  wss.on('connection', (ws) => {
    const conn: Conn = { ws, room: null, slot: -1 };
    const fail = (code: ErrorCode, message: string) => send(ws, { t: 'error', code, message });

    const seat = (r: Room, name: unknown) => {
      let s = r.seats.indexOf(null);
      if (s < 0) s = r.seats.length;
      r.seats[s] = { conn, player: { slot: s, name: cleanName(name), color: freeColor(r), faction: FACTION_PREFIXES[0], ready: false } };
      conn.room = r;
      conn.slot = s;
      broadcastLobby(r);
    };

    const leave = () => {
      const r = conn.room;
      const slot = conn.slot;
      if (!r) return;
      r.seats[slot] = null;
      conn.room = null;
      if (r.seats.every((s) => s === null)) {
        rooms.delete(r.code);
        return;
      }
      if (r.started) {
        for (const s of r.seats) send(s?.conn.ws, { t: 'peer-left', player: slot });
        // Hash rows only wait for players still connected.
        for (const [tick, row] of r.hashes) checkHashes(r, tick, row);
        return;
      }
      if (r.host === slot) r.host = r.seats.findIndex((s) => s !== null);
      broadcastLobby(r);
    };

    const checkHashes = (r: Room, tick: number, row: (number | undefined)[]) => {
      const live = r.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
      if (live.some((i) => row[i] === undefined)) return;
      r.hashes.delete(tick);
      const reported = live.map((i) => row[i]!);
      if (reported.some((h) => h !== reported[0])) {
        for (const s of r.seats) send(s?.conn.ws, { t: 'desync', tick, hashes: row.map((h) => h ?? 0) });
      }
    };

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return fail('bad-message', 'bad json');
      }
      if (typeof msg !== 'object' || msg === null) return fail('bad-message', 'bad message');
      const r = conn.room;
      const slot = conn.slot;

      switch (msg.t) {
        case 'host': {
          if (r) return fail('in-room', 'already in a room');
          let code = newCode();
          for (let i = 0; rooms.has(code) && i < 100; i++) code = newCode();
          if (rooms.has(code)) return fail('room-full', 'no free room codes');
          const nr: Room = {
            code, rom: String(msg.rom ?? ''), maxPlayers, seats: [], host: 0,
            settings: { ...DEFAULT_SETTINGS }, started: false, hashes: new Map(),
          };
          rooms.set(code, nr);
          return seat(nr, msg.name);
        }
        case 'join': {
          if (r) return fail('in-room', 'already in a room');
          const jr = rooms.get(String(msg.code ?? '').toUpperCase().trim());
          if (!jr) return fail('no-room', 'Could not join this game, please try another.');
          if (jr.started || players(jr).length >= jr.maxPlayers) return fail('room-full', 'That game is full or has already started.');
          if (jr.rom !== String(msg.rom ?? '')) return fail('rom-mismatch', 'Your ROM does not match the host\'s. Both players need the same game version.');
          return seat(jr, msg.name);
        }
      }

      if (!r) return fail('no-room', 'not in a room');
      const me = r.seats[slot]!.player;

      if (!r.started) {
        switch (msg.t) {
          case 'settings': {
            if (r.host !== slot) return fail('not-host', 'only the host can change settings');
            const s = parseSettings(msg.settings);
            if (!s) return fail('bad-message', 'bad settings');
            r.settings = s;
            // Changed terms: everyone confirms again.
            for (const p of players(r)) p.ready = false;
            return broadcastLobby(r);
          }
          case 'me': {
            if (Number.isInteger(msg.color) && msg.color! >= 0 && msg.color! < TEAM_COLORS && !players(r).some((p) => p !== me && p.color === msg.color)) me.color = msg.color!;
            if (FACTION_PREFIXES.includes(msg.faction as never)) me.faction = msg.faction!;
            if (typeof msg.ready === 'boolean') me.ready = msg.ready;
            return broadcastLobby(r);
          }
          case 'kick': {
            if (r.host !== slot) return fail('not-host', 'only the host can remove players');
            const target = r.seats[msg.slot];
            if (!target || msg.slot === slot) return;
            send(target.conn.ws, { t: 'kicked' });
            target.conn.ws.close();
            return;
          }
          case 'launch': {
            if (r.host !== slot) return fail('not-host', 'only the host can launch');
            const ps = players(r);
            if (ps.length < MIN_PLAYERS) return fail('not-ready', 'Waiting for another player.');
            if (ps.some((p) => p.slot !== r.host && !p.ready)) return fail('not-ready', 'Some players are still not ready!');
            // Compact slots so sim player ids are 0..n-1 in lobby order.
            r.seats = r.seats.filter((s) => s !== null);
            r.seats.forEach((s, i) => (s!.player.slot = s!.conn.slot = i));
            r.host = 0;
            r.started = true;
            const s = seed();
            r.seats.forEach((st, you) => send(st?.conn.ws, { t: 'start', seed: s, you, settings: r.settings, players: players(r) }));
            return;
          }
        }
        return fail('not-started', 'the game has not started');
      }

      if (msg.t === 'input') {
        if (!Number.isInteger(msg.tick) || !Array.isArray(msg.cmds)) return fail('bad-message', 'bad input');
        r.seats.forEach((s, i) => {
          if (i !== slot) send(s?.conn.ws, { t: 'input', player: slot, tick: msg.tick, cmds: msg.cmds });
        });
      } else if (msg.t === 'hash') {
        if (!Number.isInteger(msg.tick) || !Number.isInteger(msg.hash)) return fail('bad-message', 'bad hash');
        const row = r.hashes.get(msg.tick) ?? [];
        row[slot] = msg.hash;
        r.hashes.set(msg.tick, row);
        checkHashes(r, msg.tick, row);
      }
    });

    ws.on('close', leave);
  });

  return wss;
}
