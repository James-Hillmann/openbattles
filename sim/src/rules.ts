import { DEFEATED, LOST, PLAYING, WON, type Player, type PlayerId, type World } from './state';

/**
 * Skirmish win and loss, ported from the game's GameRuleManager
 * (0x020753D4..0x02075E70). See docs/re-notes/skirmish.md.
 */

/** Bricks that win a "Collect 10000 LEGO Bricks" game (0x02075B9C). */
export const BRICKS_TO_WIN = 10000;

// Roles (entity +0x5C) the elimination check looks at (0x02075808).
const ROLE_HERO = 0;
const ROLE_LAST_UNIT = 6;
const ROLE_BASE = 7;
const ROLE_FARM = 10;
const ROLE_BARRACKS = 11;
const ROLE_STABLES = 12;
const ROLE_SHIPYARD = 16;

export function findPlayer(w: World, id: PlayerId): Player | undefined {
  return w.players.find((p) => p.id === id);
}

/** Does the player still have a hero on the field (0x02085BFC)? */
function hasHero(w: World, id: PlayerId): boolean {
  return w.units.some((u) => u.owner === id && u.role === ROLE_HERO && u.hp > 0);
}

/**
 * Out of the game (0x02075808): no units left, and the buildings left can't
 * make one. A base or barracks keeps you in if you can afford its cheapest
 * unit (the game hard-codes 50 and 100 bricks); stables and shipyards need
 * 250 and, when they are all you have, a farm too. Two or more production
 * buildings always keep you in.
 */
function isEliminated(w: World, p: Player): boolean {
  let producers = 0;
  let need = 0;
  let onlyHeavy = true; // no base or barracks
  let farm = false;
  for (const u of w.units) {
    if (u.owner !== p.id || u.hp === 0) continue;
    const r = u.role;
    if (r >= 0 && r <= ROLE_LAST_UNIT) return false;
    if (r === ROLE_BASE || r === ROLE_BARRACKS) {
      producers++;
      onlyHeavy = false;
      need = Math.max(need, r === ROLE_BASE ? 50 : 100);
    } else if (r === ROLE_STABLES || r === ROLE_SHIPYARD) {
      producers++;
      need = Math.max(need, 250);
    } else if (r === ROLE_FARM) farm = true;
  }
  if (producers === 0) return true;
  if (producers === 1 && p.bricks < need) return true;
  return onlyHeavy && !farm;
}

const allies = (a: Player, b: Player) => a.team === b.team;

/**
 * When every player still in the game is on one team, they win (0x02075DAC,
 * then 0x02075CCC sets them to WON). Defeated players keep DEFEATED.
 */
function settle(w: World): void {
  const left = w.players.filter((p) => p.status === PLAYING);
  if (left.length === 0) return;
  if (left.every((p) => allies(p, left[0]!))) for (const p of left) p.status = WON;
}

/** Call after one of `owner`'s units is gone (game event 0x33, unit destroyed). */
export function onUnitLost(w: World, owner: PlayerId): void {
  if (!w.rules) return;
  const p = findPlayer(w, owner);
  if (!p || p.status !== PLAYING) return;
  const out = w.rules.mode === 0 ? !hasHero(w, owner) : isEliminated(w, p);
  if (!out) return;
  p.status = DEFEATED;
  settle(w);
}

/** Brick victory (game event 0x3B, bricks changed): in mode 2, 10000 bricks wins outright. */
export function checkBricks(w: World): void {
  if (w.rules?.mode !== 2) return;
  const winner = w.players.find((p) => p.status === PLAYING && p.bricks >= BRICKS_TO_WIN);
  if (!winner) return;
  winner.status = WON;
  for (const p of w.players) if (p.status === PLAYING) p.status = LOST; // 0x02075D20, allies included
}

/** True once the game has ended for everyone still watching (someone won). */
export const isGameOver = (w: World): boolean => w.players.some((p) => p.status === WON);
