/**
 * Wire protocol between clients and the relay. JSON for now. The relay is not
 * authoritative: it runs the lobby, stamps each input with its sender's slot,
 * forwards it, and compares state hashes. Commands are opaque to it (unknown[]),
 * so it never needs /sim; clients sanitize them before they reach the sim.
 *
 * The lobby mirrors the DS game's wireless flow (docs/re-notes/multiplayer.md):
 * Host picks a map and the game settings, players pick one of six team colors and
 * get ready, then the host launches.
 */

/** Win conditions offered by the DS lobby settings screen. */
export const GAME_TYPES = ['hunt-the-hero', 'gold-rush', 'elimination'] as const;
export type GameType = (typeof GAME_TYPES)[number];
/** Starting bricks the DS lobby cycles through. */
export const BANKS = [500, 1000, 2500] as const;
export type Bank = (typeof BANKS)[number];
/** Team colors in lobby order; index c is unit palette bank 2c (red, blue, green, orange, magenta, grey). */
export const TEAM_COLORS = 6;
/** Faction prefixes, as in @lbw/extract FACTIONS. */
export const FACTION_PREFIXES = ['K', 'W', 'P', 'I', 'E', 'A'] as const;

export interface GameSettings {
  game: GameType;
  /** Map file name, e.g. "mp01". */
  map: string;
  randomStart: boolean;
  prebase: boolean;
  bank: Bank;
}

/** The DS lobby's defaults: Hunt the Hero on the first map, no random start, no prebase, 500 bricks. */
export const DEFAULT_SETTINGS: GameSettings = { game: 'hunt-the-hero', map: 'mp01', randomStart: false, prebase: false, bank: 500 };

export interface LobbyPlayer {
  /** Slot = sim PlayerId once the game starts. */
  slot: number;
  name: string;
  /** 0..TEAM_COLORS-1, unique within a room. */
  color: number;
  faction: string;
  ready: boolean;
}

export type ClientMsg =
  /** Open a room. `rom` fingerprints the player's ROM; everyone in a room must match. */
  | { t: 'host'; name: string; rom: string }
  | { t: 'join'; code: string; name: string; rom: string }
  /** Host only, before launch. */
  | { t: 'settings'; settings: GameSettings }
  /** Change your own lobby entry. */
  | { t: 'me'; color?: number; faction?: string; ready?: boolean }
  /** Host only: remove a player from the lobby. */
  | { t: 'kick'; slot: number }
  /** Host only: start the match once everyone else is ready. */
  | { t: 'launch' }
  /** This player's commands for `tick` (already offset by input delay). One per tick; empty = "nothing this tick". */
  | { t: 'input'; tick: number; cmds: unknown[] }
  | { t: 'hash'; tick: number; hash: number };

export type ErrorCode = 'bad-message' | 'no-room' | 'room-full' | 'rom-mismatch' | 'not-host' | 'not-ready' | 'not-started' | 'in-room';

export type ServerMsg =
  | { t: 'lobby'; code: string; you: number; host: number; maxPlayers: number; settings: GameSettings; players: LobbyPlayer[] }
  /** `you` is this client's slot (= sim PlayerId); slots are renumbered 0..n-1 at launch. */
  | { t: 'start'; seed: number; you: number; settings: GameSettings; players: LobbyPlayer[] }
  | { t: 'input'; player: number; tick: number; cmds: unknown[] }
  | { t: 'desync'; tick: number; hashes: number[] }
  | { t: 'peer-left'; player: number }
  | { t: 'kicked' }
  | { t: 'error'; code: ErrorCode; message: string };

/**
 * Bump whenever the protocol or the sim rules change: clients on different builds would
 * desync, so the lobby only pairs equal versions (sent as part of the `rom` fingerprint).
 */
export const PROTOCOL_VERSION = 1;

/** Players per room. 1v1 for now; the protocol and relay work for any count up to TEAM_COLORS. */
export const ROOM_SIZE = 2;
/** Players needed before the host can launch. */
export const MIN_PLAYERS = 2;
