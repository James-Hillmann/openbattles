import { orderCancel, isBuilding } from './economy';
import { orderMove, stopMove } from './movement';
import type { EntityId, PlayerId, Unit, World } from './state';
import { cellOf } from './terrain';

/**
 * Unit stances and the plain orders that set them: Stop, Stand Ground, Patrol, and rally points.
 * Game: every unit runs one entity command at a time (unit +0xF4). With no order of its own a
 * fighting unit runs CombatHoldPositionEntityCommand (type 2) on the cell it stopped on: it attacks
 * what comes near, chases it, and walks back afterwards. docs/re-notes/orders.md
 */

/** Guard `post`: scan, chase, walk back (CombatHoldPositionEntityCommand, type 2). confirmed (emulator: idle units run type 2). */
export const STANCE_HOLD = 0;
/** Stand ground: attack only what is in range, never move (CombatStandGroundEntityCommand, type 4). confirmed */
export const STANCE_STAND = 1;
/** Walk between two cells, fighting on the way (PatrolEntityCommand, type 0x14). confirmed */
export const STANCE_PATROL = 2;
/** A player's move order (MoveEntities): no target scan until it arrives, then hold there. confirmed */
export const STANCE_MOVE = 3;

/**
 * After losing a target a holding unit stands still this long, then walks back to its post
 * (hold state 4, 0x02063634: 20 updates). confirmed (code)
 */
export const RETURN_WAIT = 20;

/** The map cell a unit stands in, or -1 in a bare test world. */
export function cellUnder(w: World, u: Unit): number {
  if (!w.grid) return -1;
  const [x, y] = cellOf(u.x, u.y);
  return y * w.grid.width + x;
}

/**
 * Start guarding the cell the unit stands on: the idle command the game gives a unit when an
 * order ends (a move arrives, an attack's target dies, Stop). Restarts the scan clock.
 */
export function holdHere(w: World, u: Unit): void {
  u.stance = STANCE_HOLD;
  u.post = cellUnder(w, u);
  u.route = [];
  u.leg = 0;
  u.since = w.tick;
  u.back = 0;
}

const own = (w: World, player: PlayerId, ids: readonly EntityId[]): Unit[] =>
  w.units.filter((u) => u.owner === player && u.hp > 0 && ids.includes(u.id));

/**
 * Stop (StopCommand 0x1F -> StopEntityCommand): drop the order and target and stand still, then hold
 * the cell. Builders drop their job too. On a building it cancels the unit in training, refunded
 * (the entity command it replaces is the production; emulator: 450 -> 500 bricks, pop slot freed).
 * likely for a building with more queued behind it: only the front was seen going.
 */
export function orderStop(w: World, player: PlayerId, ids: readonly EntityId[]): void {
  for (const u of own(w, player, ids)) {
    if (isBuilding(u)) {
      if (u.queue.length && u.prod >= 0) orderCancel(w, player, u.id, 0);
      continue;
    }
    u.target = null;
    u.ordered = false;
    u.job = null;
    stopMove(w, u);
    holdHere(w, u);
  }
}

/**
 * Stand Ground (CombatStandGroundCommand 0x12): stop on the spot; from now on attack only enemies in
 * attack range, never chase (0x02067258: search radius = max range, candidates must be in range).
 * confirmed (emulator: the King stood still while swordsmen fought him; an idle King chased them).
 */
export function orderStand(w: World, player: PlayerId, ids: readonly EntityId[]): void {
  for (const u of own(w, player, ids)) {
    if (isBuilding(u) || !u.attack || u.speed === 0) continue;
    u.target = null;
    u.ordered = false;
    u.job = null;
    stopMove(w, u);
    u.stance = STANCE_STAND;
    u.post = cellUnder(w, u);
    u.route = [];
    u.since = w.tick;
    u.back = 0;
  }
}

/**
 * Patrol (PatrolCommand 0x18): the player taps two points; the units walk to the first, then back and
 * forth, turning at each end without a pause. They fight what they meet like a holding unit and pick
 * the route up again afterwards. confirmed (emulator: (12,15) <-> (9,15), left the route to fight at
 * (7,16), came back to it).
 */
export function orderPatrol(w: World, player: PlayerId, ids: readonly EntityId[], a: number, b: number): void {
  const g = w.grid;
  if (!g || a < 0 || b < 0 || a >= g.width * g.height || b >= g.width * g.height) return;
  for (const u of own(w, player, ids)) {
    if (isBuilding(u) || u.speed === 0) continue;
    u.target = null;
    u.ordered = false;
    u.job = null;
    u.stance = STANCE_PATROL;
    u.post = -1;
    u.route = [a, b];
    u.leg = 0;
    u.since = w.tick;
    u.back = 0;
    orderMove(w, u, a);
  }
}

/**
 * Set Rally Point (RallyPointCommand 0x1B, handler 0x02084B1C): every listed building of the player
 * stores the cell (building +0x1AC/+0x1AD). Cell (0, 0) means none, as in the game (0x020724F4
 * compares with a zero point). confirmed (emulator: the Castle stored (14,19))
 */
export function orderRally(w: World, player: PlayerId, ids: readonly EntityId[], cx: number, cy: number): void {
  const g = w.grid;
  if (!g || cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) return;
  for (const b of own(w, player, ids)) if (isBuilding(b)) b.rally = cx === 0 && cy === 0 ? -1 : cy * g.width + cx;
}

/**
 * A unit just trained walks to its building's rally point, if set (0x02072530: a plain move order,
 * MoveEngineer for Builders). confirmed (emulator: the new Builder walked to the rally cell)
 */
export function sendToRally(w: World, b: Unit, u: Unit): void {
  if (b.rally < 0 || !w.grid || u.speed === 0) return;
  u.stance = STANCE_MOVE;
  orderMove(w, u, b.rally);
}

/**
 * Per tick, before combat: a finished move order becomes a hold on the arrival cell; an idle
 * holding or patrolling unit with no target heads back (to its post, or on along its route)
 * once RETURN_WAIT is over.
 */
export function stanceStep(w: World, u: Unit): void {
  if (u.stance === STANCE_MOVE) {
    if (u.tx === null) holdHere(w, u);
    return;
  }
  if (u.target !== null || u.stance === STANCE_STAND) return;
  if (u.back > 0) {
    if (w.tick < u.back) return;
    u.back = 0;
    if (u.stance === STANCE_HOLD && u.post >= 0 && cellUnder(w, u) !== u.post) orderMove(w, u, u.post);
    if (u.stance === STANCE_PATROL) orderMove(w, u, u.route[u.leg]!);
    return;
  }
  if (u.stance === STANCE_PATROL && u.tx === null && w.grid) {
    // Arrived at one end (or as near as it got): turn round.
    u.leg ^= 1;
    orderMove(w, u, u.route[u.leg]!);
  }
}

/** The cell a holding unit measures its leash from: its post, or where it stands (patrol, towers, test worlds). */
export function leashCentre(w: World, u: Unit): [number, number] | null {
  if (u.stance !== STANCE_HOLD || u.post < 0 || !w.grid) return null;
  return [u.post % w.grid.width, Math.floor(u.post / w.grid.width)];
}
