import { Lockstep, createWorld, fx, sanitizeCommand, spawnUnit, type Command, type PlayerId, type StepResult, type World } from '@lbw/sim';
import type { ClientMsg, GameSettings, LobbyPlayer, ServerMsg } from '@lbw/server/protocol';

/**
 * The parts of WebSocket we use, so the same code runs on the browser's WebSocket
 * and on `ws` in Node tests. No DOM in this file.
 */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'close', fn: () => void): void;
}

/** Typed wrapper over the relay connection. */
export class RelayClient {
  private handlers: ((m: ServerMsg) => void)[] = [];
  /**
   * In-game messages that arrived before a Match took them. The other side can start
   * sending inputs while we're still loading the map; dropping those would deadlock.
   */
  private backlog: ServerMsg[] = [];
  private claimed = false;
  readonly opened: Promise<void>;
  closed = false;

  constructor(readonly socket: Socket) {
    this.opened = new Promise((resolve) => (socket.readyState === 1 ? resolve() : socket.addEventListener('open', () => resolve())));
    socket.addEventListener('message', (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (!this.claimed && (m.t === 'input' || m.t === 'desync' || m.t === 'peer-left')) this.backlog.push(m);
      for (const h of [...this.handlers]) h(m);
    });
    socket.addEventListener('close', () => {
      this.closed = true;
    });
  }

  on(h: (m: ServerMsg) => void): () => void {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }

  /** Subscribe a match: it first gets every in-game message it missed. */
  claim(h: (m: ServerMsg) => void): () => void {
    this.claimed = true;
    const missed = this.backlog;
    this.backlog = [];
    for (const m of missed) h(m);
    return this.on(h);
  }

  send(m: ClientMsg): void {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(m));
  }
}

/** What a client needs to build the same starting world as everyone else. */
export interface MatchStart {
  seed: number;
  /** This client's player. */
  you: number;
  settings: GameSettings;
  players: LobbyPlayer[];
}

export interface MatchEvents {
  desync?: (tick: number, hashes: number[]) => void;
  peerLeft?: (player: PlayerId) => void;
}

/**
 * Drives one match: buffers the local player's commands, sends one input per tick,
 * runs a tick once everyone's input is in, and reports hashes. Without a relay it is
 * the offline sandbox: only the local player sends input, and it never waits.
 */
export class Match {
  readonly lockstep: Lockstep;
  private buffered: Command[] = [];
  /** Highest tick we've sent (or recorded) our own input for. */
  private sentThrough: number;
  desynced: { tick: number; hashes: number[] } | null = null;
  left: PlayerId[] = [];
  private off: (() => void) | null = null;

  constructor(
    world: World,
    readonly local: PlayerId,
    players: readonly PlayerId[],
    readonly relay: RelayClient | null = null,
    events: MatchEvents = {},
    inputDelay?: number,
  ) {
    this.lockstep = new Lockstep(world, inputDelay === undefined ? { players } : { players, inputDelay });
    this.sentThrough = this.lockstep.inputDelay - 1;
    if (relay) {
      this.off = relay.claim((m) => {
        if (m.t === 'input') this.lockstep.addInput(m.player, m.tick, m.cmds);
        else if (m.t === 'desync') {
          this.desynced ??= { tick: m.tick, hashes: m.hashes };
          events.desync?.(m.tick, m.hashes);
        } else if (m.t === 'peer-left') {
          this.left.push(m.player);
          events.peerLeft?.(m.player);
        }
      });
    }
  }

  get world(): World {
    return this.lockstep.world;
  }

  /** Queue a command; it goes out with the next input and runs `inputDelay` ticks later. */
  issue(cmd: Command): void {
    const c = sanitizeCommand(cmd);
    if (c) this.buffered.push(c);
  }

  /** Players the current tick is waiting on (never the local player). */
  waitingFor(): PlayerId[] {
    this.flushInput();
    return this.lockstep.waitingFor();
  }

  /** Try to run one tick. Returns null while waiting for someone's input, or once the match is over. */
  tick(): StepResult | null {
    if (this.desynced || this.left.length) return null;
    this.flushInput();
    if (!this.lockstep.canStep()) return null;
    const r = this.lockstep.step();
    // The hash is of the state after the tick, i.e. at world.tick.
    if (r.hash !== null) this.relay?.send({ t: 'hash', tick: this.world.tick, hash: r.hash });
    return r;
  }

  /** Send our input for `inputTick` once; the buffer goes with it. */
  private flushInput(): void {
    const t = this.lockstep.inputTick;
    if (t <= this.sentThrough) return;
    // Only one tick can be pending: we send for tick+delay right before running tick.
    const cmds = this.buffered;
    this.buffered = [];
    this.sentThrough = t;
    this.lockstep.addInput(this.local, t, cmds);
    this.relay?.send({ t: 'input', tick: t, cmds });
  }

  dispose(): void {
    this.off?.();
    this.off = null;
  }
}

/** Map-less world for a game without a ROM (and for tests): four units a side around (cx, cy). */
export function bareWorld(seed: number, cx = 300, cy = 220): World {
  const w = createWorld({ seed });
  for (let i = 0; i < 4; i++) spawnUnit(w, 0, fx(cx - 120 + i * 28), fx(cy - 60));
  for (let i = 0; i < 4; i++) spawnUnit(w, 1, fx(cx + 40 + i * 28), fx(cy + 60));
  return w;
}
