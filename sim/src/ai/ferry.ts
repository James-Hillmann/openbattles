import { ROLE_TRANSPORT } from '../economy';
import { findById } from '../combat';
import { ringSearch } from '../ring';
import { isWalkable } from '../terrain';
import { hasRoom, isCarried } from '../transport';
import type { Unit } from '../state';
import { aiRand, aiTrace, type AiFerry, type AiShip, type AiSquad } from './state';
import { at, cellOfXY, clamp, cx, cy, H, issueMove, manhattan, W, type Ctx } from './ctx';

/*
 * The CPU's ferries: TransportRequestMgr (AIPlayer +0x58, update 0x0209EB48) and its TransportRequestItems
 * (0x0209F10C, state machine 0x0209F234). A squad whose goal lies on another island asks for a ferry; the
 * request takes the CPU's transports, which pick a landing spot by the squad (a shipyard marker, MARK type 6,
 * on the squad's island), wait there while the squad boards, sail to a marker on the goal's island, and put
 * the squad ashore. Numbers and confidence: docs/re-notes/ai.md "Ferries".
 */

export const NONE = -1;
/** Request states (+0x48): waiting for ships, boarding starts, closing, ferrying, done. */
const R_WAIT = 0, R_START = 1, R_CLOSE = 2, R_FERRY = 3, R_DONE = 4;
/** Ship entry states (+0x04): new, to the landing spot, sailing loaded, (unused), boarding, unloading. */
const S_NEW = 0, S_TO_LOAD = 1, S_LOADED = 2, S_BOARD = 4, S_UNLOAD = 5;
/** Tries before a ship gives up on a spot (the counters at +0x28, +0x2C and +0x30 are compared with 12). */
const TRIES = 12;

const regionOf = (c: Ctx, cell: number): number => (c.ai.regions.length ? c.ai.regions[cell] ?? -1 : 0);
const unit = (c: Ctx, id: number): Unit | undefined => {
  const u = findById(c.w.units, id);
  return u && u.hp > 0 ? u : undefined;
};
const squadOf = (c: Ctx, r: AiFerry): AiSquad | undefined => (r.squad < 0 ? undefined : c.ai.squads.find((s) => s.id === r.squad));
const members = (c: Ctx, s: AiSquad | undefined): Unit[] => (s ? s.units.map((id) => unit(c, id)).filter((u): u is Unit => !!u) : []);
/** A unit that walks (no flyers, no ships): the ones a ferry has to carry (entity flags +0x18/+0x1B). */
const walker = (u: Unit) => u.layer === 0 && (u.moves & 0b1000) === 0;
const targetCell = (c: Ctx, s: AiSquad | undefined): number => (s ? c.ai.targets.find((t) => t.id === s.target)?.cell ?? NONE : NONE);
/** Manhattan distance below `d` (0x020A0A6C); never for a spot that isn't set. */
const near = (c: Ctx, u: Unit, cell: number, d: number) => cell !== NONE && manhattan(c, at(c, u), cell) < d;
/**
 * A ship with no order (0x0205A178). guess: a ship only chasing what it spotted on its own (not ordered) counts
 * as idle too; ours can get stuck chasing a target on land.
 */
const idle = (u: Unit) => u.tx === null || (!u.ordered && u.target !== null);
const cargo = (u: Unit) => u.cargo.length;
/** Someone is walking up to board it (the ship's load order, 0x0205A15C(8)). */
const boarding = (c: Ctx, ship: Unit) => c.own.some((u) => u.board?.transport === ship.id);
const inFerry = (c: Ctx, id: number) => c.ai.ferries.some((r) => r.ships.some((e) => e.id === id));
export const transports = (c: Ctx) => c.own.filter((u) => u.role === ROLE_TRANSPORT && !isCarried(u));

/**
 * The squad's members on the land of `cell` that could get on a ship now (0x020A0884): walkers, not aboard,
 * and, unless `all`, not already walking to board. likely (the order-state tests are simplified)
 */
function waitingAt(c: Ctx, r: AiFerry, cell: number, all: boolean): Unit[] {
  if (cell === NONE) return [];
  const area = regionOf(c, cell);
  return members(c, squadOf(c, r)).filter((u) => walker(u) && !isCarried(u) && (all || !u.board) && regionOf(c, at(c, u)) === area);
}

/** Every member can walk to `cell` (0x0209C2A0): flyers always can. */
export function allReach(c: Ctx, s: AiSquad, cell: number): boolean {
  if (cell === NONE) return false;
  const area = regionOf(c, cell);
  return members(c, s).every((u) => !walker(u) || (!isCarried(u) && regionOf(c, at(c, u)) === area));
}

/**
 * Water a ship can reach within `r` of `cell` (the pathfinder query 0x020A0520 -> 0x0207F194): the first cell
 * in ring order the ship can sail on. guess: the game asks its pathfinder; we take the ring search.
 */
function waterNear(c: Ctx, ship: Unit, cell: number, r: number): number {
  if (cell === NONE) return NONE;
  const g = c.w.grid!;
  const hit = ringSearch(c.w, cx(c, cell), cy(c, cell), r, (x, y) => isWalkable(g, x, y, ship.moves));
  return hit;
}

/**
 * A shipyard marker (MARK type 6) on the land of `cell` (0x02093AD8 with any role): the nearest (Manhattan,
 * first wins), or with `random` one of them picked with `AI_rand(n - 1)` (so never the last). confirmed (code;
 * emulator: every landing spot the River Crossing ferries used was a marker)
 */
function markerNear(c: Ctx, cell: number, random: boolean): number {
  if (cell === NONE) return NONE;
  const area = regionOf(c, cell);
  const list = c.ai.shipMarks.filter((m) => regionOf(c, m) === area);
  if (!list.length) return NONE;
  if (random) return list[list.length > 1 ? aiRand(c.ai, list.length - 1) : 0]!;
  let best = list[0]!;
  for (const m of list) if (manhattan(c, m, cell) < manhattan(c, best, cell)) best = m;
  return best;
}

function moveShip(c: Ctx, ship: Unit, cell: number): void {
  if (cell !== NONE) issueMove(c, [ship.id], cell, 0);
}

/** Unload order for a ship (0x02005AD0 with its cargo). */
function unload(c: Ctx, ship: Unit): void {
  aiTrace.log?.(c.w.tick, c.ai.player, `ferry ship ${ship.id} unloads ${cargo(ship)} at ${cx(c, at(c, ship))},${cy(c, at(c, ship))}`);
  c.out.push({ kind: 'unload', transports: [ship.id] });
}

/** A stuck ship moves to a random spot within `r` (0x020A0ACC): offsets AI_rand(2r) - r per axis, then water within 4. */
function shove(c: Ctx, ship: Unit, r: number): void {
  const here = at(c, ship);
  const x = clamp(cx(c, here) + aiRand(c.ai, r * 2) - r, 1, W(c) - 1);
  const y = clamp(cy(c, here) + aiRand(c.ai, r * 2) - r, 1, H(c) - 1);
  const w = waterNear(c, ship, cellOfXY(c, x, y), 4);
  if (w !== NONE) moveShip(c, ship, w);
}

function release(c: Ctx, r: AiFerry, e: AiShip): void {
  r.ships.splice(r.ships.indexOf(e), 1);
}

/** Landing spot by the squad (0x020A0CEC): where the first member that can't walk to the goal stands. */
function pickLoad(c: Ctx, r: AiFerry, e: AiShip, ship: Unit, random: boolean): boolean {
  const s = squadOf(c, r);
  if (!s || !s.units.length) return false;
  if (e.load !== NONE && !random && waitingAt(c, r, e.load, false).length) return false;
  const dest = regionOf(c, r.dest);
  const u = members(c, s).find((m) => walker(m) && regionOf(c, at(c, m)) !== dest);
  if (!u) return false;
  // Every third and seventh wait it tries open water by the member, else a marker on its land, else water within 5.
  let pos = at(c, u);
  let w = e.waits === 3 || e.waits === 7 ? waterNear(c, ship, pos, 7) : NONE;
  if (w !== NONE) pos = w;
  else {
    const m = markerNear(c, pos, random);
    if (m !== NONE) pos = m;
    else if ((w = waterNear(c, ship, pos, 5)) !== NONE) pos = w;
  }
  e.stuck = 0;
  e.load = pos;
  e.loadW = waterNear(c, ship, pos, 7);
  if (e.loadW === NONE) e.loadW = pos;
  return true;
}

/** Landing spot on the goal's island (0x020A0F98): a marker there, else water by the goal. */
function pickUnload(c: Ctx, r: AiFerry, e: AiShip, ship: Unit, random: boolean): boolean {
  const tgt = targetCell(c, squadOf(c, r));
  if (e.unload !== NONE && tgt !== NONE && regionOf(c, e.unload) === regionOf(c, tgt) && !random) return true;
  let pos = markerNear(c, tgt, random);
  if (pos === NONE && (pos = waterNear(c, ship, tgt, 18)) === NONE) return false;
  e.unload = pos;
  e.unloadW = waterNear(c, ship, pos, 7);
  if (e.unloadW === NONE) e.unloadW = pos;
  return true;
}

/**
 * Whether a loaded ship should leave (0x020A0978): nobody left to board, no room for anyone left, or everyone
 * left standing idle.
 */
function ready(c: Ctx, r: AiFerry, e: AiShip, ship: Unit): boolean {
  if (!cargo(ship)) return false;
  const left = waitingAt(c, r, e.load, true);
  if (!left.length || !left.some((u) => hasRoom(c.w, ship, u))) return true;
  return left.every((u) => u.tx === null && !u.board);
}

/** Bring a ship to the landing spot and call the squad aboard (0x020A03B0); true when it should sail. */
function goLoad(c: Ctx, r: AiFerry, e: AiShip, ship: Unit): boolean {
  if (ready(c, r, e, ship)) {
    e.waits = 0;
    return true;
  }
  if (!idle(ship)) return false;
  if (!waitingAt(c, r, e.load, true).length && e.waits > TRIES) pickLoad(c, r, e, ship, true);
  if (!near(c, ship, e.loadW, 1)) {
    e.state = S_TO_LOAD;
    moveShip(c, ship, e.loadW);
    if (e.sails++ > TRIES) e.stuck = 1;
  } else {
    const us = waitingAt(c, r, e.load, false);
    if (!us.length) {
      if (e.waits > TRIES) pickLoad(c, r, e, ship, true);
    } else {
      e.state = S_BOARD;
      aiTrace.log?.(c.w.tick, c.ai.player, `ferry ship ${ship.id} calls ${us.length} aboard at ${cx(c, at(c, ship))},${cy(c, at(c, ship))}`);
      c.out.push({ kind: 'load', unitIds: us.map((u) => u.id), transport: ship.id });
    }
    e.waits++;
  }
  return false;
}

/** Sail a loaded ship to the far landing spot and unload there (0x020A029C); true once it is empty. */
function sailUnload(c: Ctx, r: AiFerry, e: AiShip, ship: Unit): boolean {
  if (cargo(ship) < 1) return true;
  if (e.unload === NONE) pickUnload(c, r, e, ship, false);
  if (idle(ship)) {
    e.state = S_LOADED;
    if (!near(c, ship, e.unloadW, 2)) {
      moveShip(c, ship, e.unloadW);
      e.sails++;
    } else {
      e.state = S_UNLOAD;
      unload(c, ship);
      e.drops++;
    }
  }
  return false;
}

/**
 * Pick a random ship of the request (0x020A05A8): with `empty` an idle empty one, else a loaded one that is
 * idle or under way with nobody boarding. Ships that died leave the request.
 */
function pickShip(c: Ctx, r: AiFerry, empty: boolean): [AiShip, Unit] | undefined {
  const hits: [AiShip, Unit][] = [];
  for (let i = r.ships.length - 1; i >= 0; i--) {
    const e = r.ships[i]!;
    const u = unit(c, e.id);
    if (!u) {
      r.ships.splice(i, 1);
      continue;
    }
    const n = cargo(u);
    if (empty ? idle(u) && n === 0 : n > 0 && (idle(u) || !boarding(c, u))) hits.push([e, u]);
  }
  return hits.length ? hits[hits.length > 1 ? aiRand(c.ai, hits.length) : 0] : undefined;
}

/** Any ship of the request, or with `empty` an empty one (0x020A06EC). */
function anyShip(c: Ctx, r: AiFerry, empty: boolean): [AiShip, Unit] | undefined {
  const hits: [AiShip, Unit][] = [];
  for (let i = r.ships.length - 1; i >= 0; i--) {
    const e = r.ships[i]!;
    const u = unit(c, e.id);
    if (!u) r.ships.splice(i, 1);
    else if (!empty || cargo(u) === 0) hits.push([e, u]);
  }
  return hits.length ? hits[hits.length > 1 ? aiRand(c.ai, hits.length) : 0] : undefined;
}

/** A ship joins a request (0x020A016C): spots by the squad and on the goal's island. */
function join(c: Ctx, r: AiFerry, ship: Unit): void {
  if (r.ships.some((e) => e.id === ship.id)) return;
  const e: AiShip = { id: ship.id, state: S_NEW, unload: NONE, load: NONE, unloadW: NONE, loadW: NONE, sails: 0, drops: 0, waits: 0, stuck: 0 };
  pickLoad(c, r, e, ship, false);
  pickUnload(c, r, e, ship, true);
  r.ships.push(e);
  if (r.state === R_WAIT) r.state = R_START;
  aiTrace.log?.(c.w.tick, c.ai.player, `ferry ${r.id} takes ship ${ship.id}: load ${cx(c, e.load)},${cy(c, e.load)} unload ${cx(c, e.unload)},${cy(c, e.unload)}`);
}

/**
 * A squad asks for a ferry (0x0209C604 -> 0x0209ECA4): every own transport not on another request joins it.
 * Returns the request id.
 */
export function requestFerry(c: Ctx, s: AiSquad): number {
  const ai = c.ai;
  const r: AiFerry = { id: ++ai.nextFerry, state: R_WAIT, done: 0, squad: s.id, born: c.w.tick, dest: targetCell(c, s), ships: [] };
  aiTrace.log?.(c.w.tick, ai.player, `ferry ${r.id} asked by squad ${s.id} to ${cx(c, r.dest)},${cy(c, r.dest)}`);
  for (const t of transports(c)) if (!inFerry(c, t.id)) join(c, r, t);
  ai.ferries.push(r);
  return r.id;
}

/** The squad lets go of its ferry (0x0209C5C8(squad, 0) -> 0x0209C604 -> 0x0209EDAC). */
export function dropFerry(c: Ctx, s: AiSquad): void {
  const r = c.ai.ferries.find((x) => x.id === s.ferry);
  if (r) {
    r.done = 1;
    r.squad = -1;
    r.state = R_CLOSE;
  }
  s.ferryNeed = 0;
  s.ferry = -1;
  s.ferryLoad = NONE;
  s.ferryDrop = NONE;
}

/** The squad's own step of its request while it still needs one (0x0209C704). */
export function squadFerryStep(c: Ctx, s: AiSquad): void {
  if (s.ferry < 0) return;
  const r = c.ai.ferries.find((x) => x.id === s.ferry);
  if (!r || !members(c, s).length) return dropFerry(c, s);
  if (s.state === 1) return dropFerry(c, s);
  stepRequest(c, r);
  if (r.state === R_DONE) dropFerry(c, s);
}

/** TransportRequestMgr_update (0x0209EB48), on the dispatcher's flag-8 ticks. */
export function ferryUpdate(c: Ctx): void {
  const ai = c.ai;
  if (c.w.tick % 6 === 0) {
    for (const t of transports(c)) {
      if (inFerry(c, t.id)) continue;
      if (ai.ferries.length) assignShip(c, t);
      else homeShip(c, t);
    }
    return;
  }
  for (const r of [...ai.ferries]) {
    if (r.state === R_DONE) {
      ai.ferries.splice(ai.ferries.indexOf(r), 1);
      continue;
    }
    if (r.done) {
      if (r.state === R_WAIT) r.state = R_CLOSE;
      stepRequest(c, r);
    } else if (!(squadOf(c, r)?.ferryNeed ?? 0)) stepRequest(c, r);
  }
}

/** A free ship joins the oldest request still waiting on ships for a squad (0x0209EEF8). */
function assignShip(c: Ctx, ship: Unit): void {
  const r = c.ai.ferries.find((x) => {
    const s = squadOf(c, x);
    return !x.done && x.state !== R_DONE && s && s.units.length > 0 && s.ferryNeed;
  });
  if (r) join(c, r, ship);
}

/**
 * With no requests, a free ship carrying troops takes them to a marker on the home island and puts them
 * ashore (0x0209EE18). likely (the game gives one move-and-unload order; ours unloads once there)
 */
function homeShip(c: Ctx, ship: Unit): void {
  if (!idle(ship) || cargo(ship) < 1) return;
  const spot = markerNear(c, c.ai.home, true);
  const w = waterNear(c, ship, spot, 8);
  if (w === NONE) return;
  if (manhattan(c, at(c, ship), w) < 2) unload(c, ship);
  else moveShip(c, ship, w);
}

/** TransportRequestItem_update (0x0209F234). */
function stepRequest(c: Ctx, r: AiFerry): void {
  const s = squadOf(c, r);
  if (!r.done && s?.state === 1) {
    r.done = 1;
    r.state = R_CLOSE;
  }
  if (r.state !== R_WAIT && r.state !== R_DONE && r.ships.length === 0) {
    r.state = R_DONE;
    return;
  }
  if (!s) {
    r.done = 1;
    if (r.state !== R_DONE) r.state = R_CLOSE;
  }
  switch (r.state) {
    case R_WAIT:
      return stepWait(c, r);
    case R_START:
      return stepStart(c, r);
    case R_CLOSE:
      return stepClose(c, r);
    case R_FERRY:
      return stepFerry(c, r);
    case R_DONE:
      if (r.squad >= 0) {
        r.done = 1;
        r.squad = -1;
      }
  }
}

/** State 0 (0x0209F2A2): ships head for the landing spot until the squad is ready. */
function stepWait(c: Ctx, r: AiFerry): void {
  for (const e of [...r.ships]) {
    const ship = unit(c, e.id);
    if (!ship) continue;
    switch (e.state) {
      case S_NEW:
      case S_TO_LOAD:
        if (e.state === S_TO_LOAD && !idle(ship)) break;
        pickLoad(c, r, e, ship, false);
        if (!near(c, ship, e.loadW, 6)) {
          goLoad(c, r, e, ship);
          e.state = S_TO_LOAD;
        } else e.state = S_NEW;
        break;
      case S_LOADED:
        if (cargo(ship) < 1) e.state = S_TO_LOAD;
        else if (!near(c, ship, e.unloadW, 11)) {
          if (e.loadW === NONE) release(c, r, e);
          else {
            moveShip(c, ship, e.loadW);
            e.state = S_TO_LOAD;
          }
        } else sailUnload(c, r, e, ship);
        break;
      case 3:
        goLoad(c, r, e, ship);
        break;
      default:
        e.state = S_TO_LOAD;
    }
  }
}

/** State 1 (0x0209F410): the squad gets its landing spots from a ship and ferrying starts. */
function stepStart(c: Ctx, r: AiFerry): void {
  r.state = R_FERRY;
  const hit = anyShip(c, r, false);
  const s = squadOf(c, r);
  if (!hit || !s) return;
  s.ferryLoad = hit[0].load;
  s.ferryDrop = hit[0].unload;
}

/** State 3 (0x0209F9A8): load, sail, unload, until the squad stands on the goal's island. */
function stepFerry(c: Ctx, r: AiFerry): void {
  const s = squadOf(c, r);
  const tgt = targetCell(c, s);
  let hit = pickShip(c, r, true);
  if (hit) {
    const [e, ship] = hit;
    let done = false;
    let wait = false;
    e.drops = 0;
    if (e.load === NONE || e.waits > TRIES) {
      if (!pickLoad(c, r, e, ship, true)) {
        if (r.ships.length < 2) {
          if (s && allReach(c, s, tgt)) {
            r.state = R_CLOSE;
            return;
          }
        } else {
          if (e.load !== NONE && near(c, ship, e.unloadW, 4)) moveShip(c, ship, e.loadW);
          release(c, r, e);
          done = true;
        }
      }
    }
    if (!done && e.load === NONE && !pickLoad(c, r, e, ship, true)) {
      done = true;
      if (e.waits > 2 * TRIES) release(c, r, e);
    }
    if (!done && waitingAt(c, r, e.load, true).length > 0) {
      if (!goLoad(c, r, e, ship)) {
        e.waits++;
        if (e.waits <= TRIES || e.waits % 6 !== 0) wait = true;
        else {
          shove(c, ship, 6);
          if (e.waits > 2 * TRIES) e.waits = 1;
        }
      } else e.state = S_LOADED;
    } else if (!done) {
      if (!pickLoad(c, r, e, ship, false)) {
        if (s && allReach(c, s, tgt)) {
          r.state = R_CLOSE;
          return;
        }
        if (e.loadW !== NONE) {
          moveShip(c, ship, e.loadW);
          if (r.ships.length > 1) {
            release(c, r, e);
            return;
          }
        }
      } else goLoad(c, r, e, ship);
    }
    if (!done && !wait && near(c, ship, e.loadW, 1) && e.waits > TRIES && e.waits % 3 === 0) pickLoad(c, r, e, ship, true);
  }
  hit = pickShip(c, r, false);
  if (!hit) {
    const any = anyShip(c, r, true);
    if (any && near(c, any[1], any[0].unloadW, 7)) {
      moveShip(c, any[1], any[0].loadW);
      if (landed(c, r, any[0], s, tgt)) return;
    }
    return;
  }
  const [e, ship] = hit;
  if (near(c, ship, e.unloadW, 1)) {
    if (e.drops > TRIES && e.drops % 6 === 1) return shove(c, ship, 6);
    unload(c, ship);
    e.drops++;
    return;
  }
  if (!ready(c, r, e, ship)) {
    if (e.waits > TRIES && e.waits % 3 === 0) {
      pickLoad(c, r, e, ship, true);
      return;
    }
    if (waitingAt(c, r, e.load, false).length > 0) goLoad(c, r, e, ship);
    return;
  }
  if (e.sails > TRIES && e.sails % 3 === 1) shove(c, ship, 10);
  if (!sailUnload(c, r, e, ship)) return;
  if (landed(c, r, e, s, tgt)) return;
  moveShip(c, ship, e.loadW);
}

/**
 * Members stand on the goal's island and the goal is there: the squad carries on without the ferry
 * (0x0209C484). likely (the game also asks that fewer than 20 strength guard the goal, 0x02088190)
 */
function landed(c: Ctx, r: AiFerry, e: AiShip, s: AiSquad | undefined, tgt: number): boolean {
  if (!s || tgt === NONE || e.unload === NONE || regionOf(c, tgt) !== regionOf(c, e.unload)) return false;
  if (!waitingAt(c, r, e.unload, true).length) return false;
  aiTrace.log?.(c.w.tick, c.ai.player, `ferry ${r.id} landed squad ${s.id}`);
  dropFerry(c, s);
  return true;
}

/** State 2 (0x0209F450): the squad goes on alone; ships bring back whoever is still aboard, then leave. */
function stepClose(c: Ctx, r: AiFerry): void {
  const s = squadOf(c, r);
  if (!r.done && s) {
    s.ferry = -1;
    s.ferryNeed = 0;
    s.ferryLoad = NONE;
    s.ferryDrop = NONE;
    if (s.state !== 7 && s.state !== 1) {
      s.prev = s.state;
      s.state = 7;
      s.timer = 0;
    }
  } else if (!s) r.done = 1;
  let hit = pickShip(c, r, true);
  if (hit) {
    const [e, ship] = hit;
    e.drops = 0;
    if (r.done && e.loadW === NONE) return release(c, r, e);
    if (e.loadW === NONE) {
      if (!pickLoad(c, r, e, ship, true)) release(c, r, e);
      return;
    }
    if (near(c, ship, e.loadW, 9)) return release(c, r, e);
    e.state = 3;
    moveShip(c, ship, e.loadW);
    e.sails++;
    return;
  }
  hit = pickShip(c, r, false);
  if (hit) {
    const [e, ship] = hit;
    if (near(c, ship, e.unloadW, 11)) {
      e.state = S_LOADED;
      sailUnload(c, r, e, ship);
      return;
    }
    if (e.loadW === NONE) return release(c, r, e);
    if (!near(c, ship, e.loadW, 1)) {
      moveShip(c, ship, e.loadW);
      if (e.sails++ > TRIES) pickLoad(c, r, e, ship, true);
    } else if (e.drops > TRIES) {
      if (!pickUnload(c, r, e, ship, true)) release(c, r, e);
    } else {
      unload(c, ship);
      e.sails = 0;
      e.drops++;
    }
    return;
  }
  if (!anyShip(c, r, false)) r.state = R_DONE;
  else if (!r.done && s && allReach(c, s, targetCell(c, s))) r.state = R_DONE;
}

/**
 * Squad side: does the squad need a ferry to reach its goal (0x0209C328 / 0x0209C42C)? Some walker can't get
 * there by land.
 */
export function needsFerry(c: Ctx, s: AiSquad, cell: number): boolean {
  if (!c.ai.regions.length || cell === NONE) return false;
  return !allReach(c, s, cell);
}

/**
 * Where a member of a squad waiting for a ferry walks (0x0209C754 states 7 and 9): the landing spot by the squad
 * if it stands on that land, else the far one if it's already across, else the goal.
 */
export function ferryGoal(c: Ctx, s: AiSquad, u: Unit, goal: number): number {
  const here = regionOf(c, at(c, u));
  if (s.ferryLoad !== NONE && regionOf(c, s.ferryLoad) === here) return s.ferryLoad;
  if (s.ferryDrop !== NONE && regionOf(c, s.ferryDrop) === here) return s.ferryDrop;
  return goal;
}
