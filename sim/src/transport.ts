import { findById } from './combat';
import { ROLE_TRANSPORT, cellPos, isBuilding, rectDist, standCell } from './economy';
import { orderMove, placeUnit, removeUnit, stopMove, unitCell } from './movement';
import type { EntityId, PlayerId, Unit, World } from './state';
import { MOVES_WATER, isWalkable } from './terrain';

/*
 * Transports: units board a transport ship, ride in it off the map, and get off on the nearest land.
 * Ported from the game's GarrisonEntityCommand / LoadAction / UngarrisonEntityCommand / UnloadAction
 * and UnitContainer (ARM9); see docs/re-notes/transports.md for the trace and the emulator checks.
 */

/** Cargo class per role (table 0x02142840): 0-3 minifigures, 4 specials, 6 everything else. */
const ROLE_CLASS = [0, 1, 2, 3, 2, 6, 4];
const SPECIAL = 4;
const OTHER = 6;

/** A unit's cargo class (0x0205B2A4): hero, builder, melee, ranged and mounted are minifigures (0-3). */
export function cargoClass(u: Unit): number {
  return isBuilding(u) || u.role < 0 ? OTHER : ROLE_CLASS[u.role] ?? OTHER;
}

/**
 * Room for each class (0x020010E0): a transport holds 4 minifigures and 2 specials ("Transports can hold
 * 4 Minifigures and 2 Specials", tip 1028). confirmed: the strip shows 4 round and 2 star slots.
 */
export function capacity(t: Unit, cls: number): number {
  if (t.role !== ROLE_TRANSPORT) return 0;
  return cls <= 3 ? 4 : cls === SPECIAL ? 2 : cls === OTHER ? 6 : 0;
}

/** Cargo that takes up room a unit of class `cls` needs (0x0205B1D8). */
function counts(cls: number, other: number): boolean {
  if (cls <= 3) return other <= 3;
  if (cls === SPECIAL) return other === SPECIAL;
  return cls === OTHER;
}

/** Whether `u` can ever ride in transport `t`: no buildings, and nothing that can sail (0x0205B124). */
function mayBoard(t: Unit, u: Unit): boolean {
  return u.id !== t.id && !isBuilding(u) && u.speed > 0 && (u.moves & MOVES_WATER) === 0;
}

/** Room left in `t` for `u` (0x0205B124). */
export function hasRoom(w: World, t: Unit, u: Unit): boolean {
  if (!mayBoard(t, u)) return false;
  const cls = cargoClass(u);
  let free = capacity(t, cls);
  for (const id of t.cargo) {
    const c = findById(w.units, id);
    if (c && counts(cls, cargoClass(c))) free--;
  }
  return free >= 1;
}

export const isCarried = (u: Unit): boolean => u.carrier !== 0;

const ownTransport = (w: World, player: PlayerId, id: EntityId): Unit | undefined => {
  const t = findById(w.units, id);
  return t && t.owner === player && t.hp > 0 && t.role === ROLE_TRANSPORT && !isCarried(t) ? t : undefined;
};

/**
 * Load order (GarrisonCommand 0x15 -> one GarrisonEntityCommand per unit, 0x02084748): the units walk
 * next to the transport and get on. A unit that can sail refuses at once (0x0206BBBC).
 */
export function orderLoad(w: World, player: PlayerId, ids: readonly EntityId[], transport: EntityId): void {
  const t = ownTransport(w, player, transport);
  if (!t) return;
  for (const u of w.units) {
    if (u.owner !== player || !ids.includes(u.id) || isCarried(u) || !mayBoard(t, u)) continue;
    u.target = null;
    u.ordered = false;
    u.job = null;
    if (w.grid) stopMove(w, u);
    u.board = { transport: t.id, tries: 0 };
  }
}

/**
 * One tick of a boarding unit (GarrisonEntityCommand 0x0206BC20 and LoadAction 0x02053790). It gets on
 * as soon as the cell it holds touches the transport's footprint, 8-way (0x0207F8E4), even mid-step
 * (confirmed: the King boarded before reaching the centre of his cell). Otherwise it walks to a free
 * cell next to the transport; each walk is one try and the order is dropped after the fifth. A full
 * transport, or one that is gone, ends the order.
 */
function boardStep(w: World, u: Unit): void {
  const b = u.board!;
  const t = findById(w.units, b.transport);
  if (!t || t.hp === 0 || isCarried(t) || !w.grid) {
    u.board = null;
    return;
  }
  const g = w.grid;
  const here = u.cell >= 0 ? u.cell : unitCell(w, u);
  if (rectDist(g, here, unitCell(w, t), t.size) === 1) {
    if (hasRoom(w, t, u)) embark(w, t, u);
    else u.board = null;
    return;
  }
  if (u.mv) return;
  if (b.tries > 4) {
    u.board = null;
    return;
  }
  b.tries++;
  // guess: the game picks its cell with 0x0207F99C (not traced); we take the nearest free one, like builders.
  const c = standCell(w, u, unitCell(w, t), t.size);
  if (c >= 0) orderMove(w, u, c);
}

/** Get on (UnitContainer add 0x0205B2DC): off the map, orders dropped. */
function embark(w: World, t: Unit, u: Unit): void {
  removeUnit(w, u);
  u.mv = null;
  u.tx = u.ty = null;
  u.path = [];
  u.target = null;
  u.ordered = false;
  u.job = null;
  u.board = null;
  u.carrier = t.id;
  u.x = t.x;
  u.y = t.y;
  t.cargo.push(u.id);
}

/**
 * Where a unit gets off (0x0207F378 -> ring search 0x0207FF24 with the matcher 0x02080708). Rings
 * k = 0 .. size + 2 around the transport's footprint (2x2 for every transport ship). In ring k it tries,
 * for x from left to right, the cell on the row above and then the one on the row below; then for each
 * row the cell on the left and then the one on the right. The game's side loop stops one row short
 * (its bound uses the footprint's width minus 1), so ring 0 has no side cells for a 2x2 transport below
 * its top row; kept. A cell must lie on the map with room for the unit (x + size < width: the last
 * column never qualifies), be terrain the unit can walk, and be free. Any land qualifies, even an
 * island cut off from everything else. confirmed in the emulator: two units off a ship at the shore
 * and two from open water (ring 3) landed on exactly the cells this order gives.
 */
export function exitCell(w: World, t: Unit, p: Unit): number {
  const g = w.grid!;
  const tc = unitCell(w, t);
  const cx = tc % g.width, cy = Math.floor(tc / g.width);
  const cw = t.size, ch = t.size, pw = 1, ph = 1;
  const plane = p.layer * g.width * g.height;
  const ok = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x + pw < g.width && y + ph < g.height && isWalkable(g, x, y, p.moves) && w.occ![plane + y * g.width + x] === 0;
  const rings = pw + 3;
  for (let k = 0; k < rings; k++) {
    for (let dx = -(k + pw); dx <= k + cw; dx++) {
      if (ok(cx + dx, cy - (k + ph))) return (cy - (k + ph)) * g.width + cx + dx;
      if (ok(cx + dx, cy + ch + k)) return (cy + ch + k) * g.width + cx + dx;
    }
    for (let dy = -(k + ph - 1); dy < k + cw - 1; dy++) {
      if (ok(cx - (k + pw), cy + dy)) return (cy + dy) * g.width + cx - (k + pw);
      if (ok(cx + cw + k, cy + dy)) return (cy + dy) * g.width + cx + cw + k;
    }
  }
  return -1;
}

/** Get off onto the first exit cell (UnitContainer remove 0x0205B704). False when there is none. */
function disembark(w: World, t: Unit, p: Unit): boolean {
  const c = exitCell(w, t, p);
  if (c < 0) return false;
  const { x, y } = cellPos(w.grid!, c);
  p.x = x;
  p.y = y;
  p.carrier = 0;
  t.cargo.splice(t.cargo.indexOf(p.id), 1);
  placeUnit(w, p);
  return true;
}

/**
 * Unload order (UngarrisonCommand 0x20 -> one UngarrisonEntityCommand per passenger, 0x02084DF8): every
 * unit in the given transports gets off at once, in unit order (confirmed: the Builder, the lower id, got
 * the first cell though the King boarded first). A passenger with no exit cell (deep water) stays on.
 */
export function orderUnload(w: World, player: PlayerId, transports: readonly EntityId[]): void {
  if (!w.grid) return;
  const riders = w.units.filter((u) => u.owner === player && u.hp > 0 && isCarried(u) && transports.includes(u.carrier));
  for (const p of riders) {
    const t = findById(w.units, p.carrier);
    if (t) disembark(w, t, p);
  }
}

/** Board, and keep riders on their transport's spot (the game reads their cell through the carrier, 0x0205BDE4). */
export function transportStep(w: World): void {
  for (const u of w.units) {
    if (u.hp === 0) continue;
    if (u.board) boardStep(w, u);
    if (isCarried(u)) {
      const t = findById(w.units, u.carrier);
      if (t) {
        u.x = t.x;
        u.y = t.y;
      }
    }
  }
}

/**
 * Before the dead are removed: a sinking transport puts everyone it can ashore, last aboard first
 * (0x0205B788 from the death handler 0x0206A078). If nobody gets off, everyone on board dies (0x0205E76C).
 * guess: when only some get off, the game leaves the rest in the wreck; we count them as dead.
 * Riders who died aboard (spells reach them) leave the cargo list.
 */
export function transportDeaths(w: World): void {
  if (!w.grid) return;
  for (const t of w.units) {
    if (t.hp !== 0 || t.cargo.length === 0) continue;
    for (let i = t.cargo.length - 1; i >= 0; i--) {
      const p = findById(w.units, t.cargo[i]!);
      if (p && p.hp > 0) disembark(w, t, p);
    }
    for (const id of t.cargo) {
      const p = findById(w.units, id);
      if (p) p.hp = 0;
    }
  }
  for (const u of w.units) {
    if (u.hp !== 0 || !isCarried(u)) continue;
    const t = findById(w.units, u.carrier);
    if (t) t.cargo.splice(t.cargo.indexOf(u.id), 1);
    u.carrier = 0;
  }
}
