import { PLAYING, type GameRules, type Player, type PlayerArmy, type PlayerId, type World } from './state';
import { cellCenterX, cellCenterY } from './terrain';
import { createWorld, placeBuilding, spawnUnit, type UnitType, type WorldInit } from './world';
import { freeCellNear } from './economy';
import { placeUnit } from './movement';
import { nextInt } from './rng';
import { PICKUP_STUD, addPickup } from './pickups';
import { newStats } from './stats';

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
  /**
   * "Random starting positions": each player gets a random free slot of the map instead (0x020A2C48).
   * `slots` then only says how many players there are.
   */
  randomStart?: boolean;
  /** The map's pickup records (EVNT; extract's GameMap.pickups): cell and collectable blueprint index. */
  pickups?: readonly { x: number; y: number; item: number }[];
  /** Each player's picked army (the army screen), if any: limits what they build and train. */
  armies?: (PlayerArmy | undefined)[];
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

/**
 * Random starting positions (0x020A2C48): the map's slots 0..n-1 go in a list; each player in turn
 * draws one at random from what is left (MATH_Rand32 through 0x0208339C, here the world's RNG, so
 * both online clients draw the same). Slots on maps run 0-3 and every skirmish map has all four.
 */
export function randomSlots(w: World, records: readonly StartSpawn[], players: number): number[] {
  const n = records.reduce((m, r) => Math.max(m, r.slot + 1), 0);
  const free = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let p = 0; p < players && free.length > 0; p++) out.push(free.splice(nextInt(w.rng, free.length), 1)[0]!);
  return out;
}

/** A new skirmish world: players, rules and each player's starting units and buildings. */
export function createSkirmish(init: Omit<WorldInit, 'players' | 'rules'>, records: readonly StartSpawn[], opts: SkirmishOptions): World {
  const players: Player[] = opts.slots.map((_, id) => {
    const army = opts.armies?.[id];
    return { id, team: id, bricks: opts.bricks, status: PLAYING, start: -1, reservedPop: 0, reservedStars: 0, stats: newStats(), ...(army ? { army: { units: [...army.units], base: army.base } } : {}) };
  });
  const w = createWorld({ ...init, players, rules: opts.rules });
  const width = init.grid?.width ?? 0;
  const slots = opts.randomStart ? randomSlots(w, records, opts.slots.length) : opts.slots;
  for (const s of startSpawns(records, slots, opts.prebuilt)) {
    // The hero's record also sets where the player's camera starts (0x020A3CEC), first one only.
    const p = players[s.player]!;
    if (s.role === 0 && p.start < 0) p.start = s.y * width + s.x;
    const type = opts.typeFor(s.player, s.role, s.index);
    if (!type) continue;
    // Buildings block their footprint. That the record is the footprint's top-left cell is a guess.
    if (s.role >= 7 && init.grid) placeBuilding(w, s.player, { ...type, role: s.role }, s.x, s.y);
    else {
      const u = spawnUnit(w, s.player, cellCenterX(s.x), cellCenterY(s.y), { ...type, role: s.role });
      // mp29's second slot-0 builder record sits inside its castle's footprint. Guess: the game
      // puts such a unit on the nearest free cell (we can't reach that map in the emulator yet).
      if (init.grid && u.cell < 0) {
        const c = freeCellNear(w, s.x, s.y, 7);
        if (c >= 0) {
          u.x = cellCenterX(c % width);
          u.y = cellCenterY(Math.floor(c / width));
          placeUnit(w, u);
        }
      }
    }
  }
  // Pickup records name a collectable blueprint of the mission; on skirmish maps every one is 8,
  // the BlueStud (read from the mission's blueprint table in RAM; docs/re-notes/pickups.md).
  for (const r of opts.pickups ?? []) {
    const type = SKIRMISH_PICKUPS[r.item];
    if (type !== undefined) addPickup(w, type, r.x, r.y);
  }
  return w;
}

/** Collectable type per skirmish pickup blueprint index. */
const SKIRMISH_PICKUPS: Record<number, number> = { 8: PICKUP_STUD };
