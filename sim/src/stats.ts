import type { Player, PlayerId, PlayerStats, Unit, World } from './state';

/**
 * Per-player match statistics for the score screen ("Minifigures Built" ... "Bricks Collected"),
 * ported from the game's per-player stat records (0x0215711C + player * 0xA4) and the functions that
 * bump them: built 0x020A7A38, lost 0x020A7E58, destroyed 0x020A7C68, bricks 0x020A6660.
 * See docs/re-notes/score.md.
 *
 * Write-only: nothing in the simulation reads these, so they are not part of hashWorld.
 */

/** Stat classes by role (the switch tables in the functions above): minifigures, specials, buildings. */
export const STAT_MINIFIG = 0;
export const STAT_SPECIAL = 1;
export const STAT_BUILDING = 2;

/** Counters are u16 and stop at 0xFFFF; bricks are u32 and stop at 0xFFFFFFFF. */
const MAX_COUNT = 0xffff;
const MAX_BRICKS_STAT = 0xffffffff;

export const newStats = (): PlayerStats => ({ built: [0, 0, 0], lost: [0, 0, 0], destroyed: [0, 0, 0], bricks: 0 });

/** Roles 0-4 (hero, builder, close combat, ranged, mounted) are minifigures, 5-6 specials, 7-16 buildings. Walls and up count nowhere. */
export function statClass(role: number): number {
  if (role >= 0 && role <= 4) return STAT_MINIFIG;
  if (role === 5 || role === 6) return STAT_SPECIAL;
  if (role >= 7 && role <= 16) return STAT_BUILDING;
  return -1;
}

const bump = (counts: number[], role: number) => {
  const c = statClass(role);
  if (c >= 0 && counts[c]! < MAX_COUNT) counts[c]!++;
};

const playerOf = (w: World, id: PlayerId): Player | undefined => w.players.find((p) => p.id === id);

/** Bricks earned (harvest drop-offs, Mine payouts, the 60 s trickle and Blue Studs; not refunds). */
export function countBricks(p: Player, n: number): void {
  const s = (p.stats ??= newStats());
  s.bricks = Math.min(MAX_BRICKS_STAT, s.bricks + n);
}

/** A unit trained (0x02072228) or a building finished (ConstructStructureEntityCommand). Starting units don't count. */
export function countBuilt(w: World, owner: PlayerId, role: number): void {
  const p = playerOf(w, owner);
  if (p) bump((p.stats ??= newStats()).built, role);
}

/**
 * A unit or building died (DieEntityCommand 0x0206A078): its owner lost one, and the player whose
 * damage killed it destroyed one. The game credits every other team in the dead unit's list of current
 * attackers (unit +0x1CC); we credit the player who dealt the last damage (guess; the same in 1v1
 * unless a unit dies to a spell with nobody attacking it).
 */
export function countDeath(w: World, u: Unit): void {
  const owner = playerOf(w, u.owner);
  if (owner) bump((owner.stats ??= newStats()).lost, u.role);
  if (u.lastHitBy < 0 || u.lastHitBy === u.owner) return;
  const killer = playerOf(w, u.lastHitBy);
  if (killer) bump((killer.stats ??= newStats()).destroyed, u.role);
}
