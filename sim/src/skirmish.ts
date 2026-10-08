import { PLAYING, type GameRules, type Player, type PlayerId, type World } from './state';
import { cellCenterX, cellCenterY } from './terrain';
import { createWorld, spawnUnit, type UnitType, type WorldInit } from './world';

/**
 * One starting unit or building from a map's EVNT section (read by
 * extract's parseMap; see docs/re-notes/skirmish.md). Same shape as extract's
 * StartRecord, which the sim can't import.
 */
export interface StartSpawn {
  x: number;
  y: number;
  /** Map start slot, 0-3. */
  slot: number;
  /** Entity role (+0x5C) to spawn from the player's faction: 0 hero, 1 builder, 7 base, 10 farm, 11 barracks. */
  role: number;
  /** Which entity of that role (0 = first). */
  index: number;
}

export interface SkirmishOptions {
  /** "Prebuilt bases" option. Off (the game's default) leaves each player a base, one builder and the hero. */
  prebuilt: boolean;
  rules: GameRules;
  /** Bricks each player starts with (options screen; 500 by default). */
  bricks: number;
  /** Map slot per player: slots[playerId]. Fixed starting positions put player 0 on slot 0, player 1 on slot 1. */
  slots: number[];
  /** Unit type for a player's faction entity of this role and index, or null when there is none. */
  typeFor: (player: PlayerId, role: number, index: number) => UnitType | null;
}

// Roles a player keeps one of when bases aren't prebuilt (0x020A2FD4).
const KEPT_WITHOUT_PREBUILT = [0, 1, 7];

/**
 * The map's start records that actually spawn for these players, in file
 * order (0x020A5C0C reading, 0x020A2FD4 filtering). Without prebuilt bases the
 * game keeps only the first hero, builder and base of each player.
 */
export function startSpawns(records: readonly StartSpawn[], slots: readonly number[], prebuilt: boolean): (StartSpawn & { player: PlayerId })[] {
  const seen = new Set<string>(); // our bookkeeping for the game's per-role player bitmasks
  const out: (StartSpawn & { player: PlayerId })[] = [];
  for (const r of records) {
    const player = slots.indexOf(r.slot);
    if (player < 0) continue; // nobody plays this slot
    if (!prebuilt) {
      if (!KEPT_WITHOUT_PREBUILT.includes(r.role)) continue;
      const key = `${player}:${r.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({ ...r, player });
  }
  return out;
}

/** A new skirmish world: players, rules and each player's starting units and buildings. */
export function createSkirmish(init: Omit<WorldInit, 'players' | 'rules'>, records: readonly StartSpawn[], opts: SkirmishOptions): World {
  const players: Player[] = opts.slots.map((_, id) => ({ id, team: id, bricks: opts.bricks, status: PLAYING, start: -1, reservedPop: 0, reservedStars: 0 }));
  const w = createWorld({ ...init, players, rules: opts.rules });
  const width = init.grid?.width ?? 0;
  for (const s of startSpawns(records, opts.slots, opts.prebuilt)) {
    // The hero's record also sets where the player's camera starts (0x020A3CEC), first one only.
    const p = players[s.player]!;
    if (s.role === 0 && p.start < 0) p.start = s.y * width + s.x;
    const type = opts.typeFor(s.player, s.role, s.index);
    if (type) spawnUnit(w, s.player, cellCenterX(s.x), cellCenterY(s.y), { ...type, role: s.role });
  }
  return w;
}
