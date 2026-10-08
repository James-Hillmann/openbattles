/**
 * Wire protocol between clients and the relay. JSON for now; the relay is not
 * authoritative, it only groups players into rooms and forwards inputs.
 * Commands are opaque to the relay (typed as unknown) so it never needs /sim.
 */
export type ClientMsg =
  | { t: 'join'; room: string }
  /** Commands this player issued for `tick` (already offset by input delay). Empty array = "nothing this tick". */
  | { t: 'input'; tick: number; cmds: unknown[] }
  | { t: 'hash'; tick: number; hash: number };

export type ServerMsg =
  | { t: 'joined'; room: string; player: number }
  | { t: 'start'; seed: number; players: number }
  | { t: 'input'; player: number; tick: number; cmds: unknown[] }
  | { t: 'desync'; tick: number; hashes: number[] }
  | { t: 'peer-left'; player: number }
  | { t: 'error'; message: string };

export const ROOM_SIZE = 2;
