import { WebSocketServer, type WebSocket } from 'ws';
import { ROOM_SIZE, type ClientMsg, type ServerMsg } from './protocol';

interface Room {
  players: (WebSocket | null)[];
  started: boolean;
  /** tick -> hash per player, dropped once every player has reported. */
  hashes: Map<number, (number | undefined)[]>;
}

const send = (ws: WebSocket | null, msg: ServerMsg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

export function startRelay(opts: { port: number; seed?: () => number }): WebSocketServer {
  const rooms = new Map<string, Room>();
  const seed = opts.seed ?? (() => (Math.random() * 0x7fffffff) | 0); // relay-side randomness is fine; the sim only sees the seed
  const wss = new WebSocketServer({ port: opts.port });

  wss.on('connection', (ws) => {
    let room: Room | null = null;
    let player = -1;

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return send(ws, { t: 'error', message: 'bad json' });
      }
      if (msg.t === 'join') {
        if (room) return send(ws, { t: 'error', message: 'already in a room' });
        const r: Room = rooms.get(msg.room) ?? { players: [], started: false, hashes: new Map() };
        rooms.set(msg.room, r);
        if (r.started || r.players.length >= ROOM_SIZE) return send(ws, { t: 'error', message: 'room full' });
        room = r;
        player = r.players.length;
        r.players.push(ws);
        send(ws, { t: 'joined', room: msg.room, player });
        if (r.players.length === ROOM_SIZE) {
          r.started = true;
          const s = seed();
          for (const p of r.players) send(p, { t: 'start', seed: s, players: ROOM_SIZE });
        }
        return;
      }
      if (!room || !room.started) return send(ws, { t: 'error', message: 'not in a started room' });
      if (msg.t === 'input') {
        for (const p of room.players) send(p, { t: 'input', player, tick: msg.tick, cmds: msg.cmds });
      } else if (msg.t === 'hash') {
        const row = room.hashes.get(msg.tick) ?? [];
        row[player] = msg.hash;
        room.hashes.set(msg.tick, row);
        const reported = row.filter((h) => h !== undefined) as number[];
        if (reported.length === ROOM_SIZE) {
          room.hashes.delete(msg.tick);
          if (reported.some((h) => h !== reported[0])) {
            for (const p of room.players) send(p, { t: 'desync', tick: msg.tick, hashes: reported });
          }
        }
      }
    });

    ws.on('close', () => {
      if (!room) return;
      room.players[player] = null;
      for (const p of room.players) send(p, { t: 'peer-left', player });
      if (room.players.every((p) => p === null)) {
        for (const [k, v] of rooms) if (v === room) rooms.delete(k);
      }
    });
  });

  return wss;
}
