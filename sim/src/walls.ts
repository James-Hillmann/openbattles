import type { EntityId, EntityType, Job, PlayerId, Unit, World } from './state';
import { findById } from './combat';
import { fxDivRound } from './spells';
import { fpH, fpW } from './footprint';
import { orderMove, placeUnit, removeUnit, stopMove, unitCell } from './movement';
import { MOVES_GROUND, cellCenterX, cellCenterY, isWalkableCode } from './terrain';
import {
  ROLE_BRIDGE, ROLE_WALL, TERRAIN_WATER, allowed, approach, freeCellNear, getPlayer, isFinished, originCell, ownBuilders, rectDist,
  spendBricks, type PlaceFn,
} from './economy';

/**
 * Walls and bridges, ported from ConstructMultipleCommand (walls) and
 * ConstructStructureCommand (bridges) in ARM9. Numbers and confidence:
 * docs/re-notes/walls-bridges.md.
 */

/** Terrain code a finished bridge writes over its footprint (0x02058730): rough ground. confirmed (code + emulator) */
export const TERRAIN_ROUGH = 2;
/**
 * A Builder comes out of a finished bridge this many ticks later, at the cell past its far end.
 * confirmed (emulator, one BridgeMediumH: 22 ticks, out at the cell right of the top row)
 */
export const BRIDGE_EXIT_TICKS = 22;

/**
 * Cells of a wall line dragged from (x0, y0) to (x1, y1), in build order (0x020679D0). The longer
 * axis steps one footprint at a time (x if |dx| > |dy|, else y), the other follows by a 20.12
 * fixed-point step (FX_Div), floored. confirmed (code; a 5-wall drag in the emulator matches)
 */
export function wallLine(x0: number, y0: number, x1: number, y1: number, fw = 1, fh = 1): [number, number][] {
  const dx = x1 - x0, dy = y1 - y0;
  const xMajor = Math.abs(dx) > Math.abs(dy);
  const n = fxDivRound((xMajor ? Math.abs(dx) : Math.abs(dy)) << 12, (xMajor ? fw : fh) << 12) >> 12;
  if (n <= 0) return [[x0, y0]];
  const sx = fxDivRound(dx << 12, n << 12), sy = fxDivRound(dy << 12, n << 12);
  const out: [number, number][] = [];
  for (let i = 0, ax = 0, ay = 0; i <= n; i++, ax += sx, ay += sy) out.push([x0 + (ax >> 12), y0 + (ay >> 12)]);
  return out;
}

/** Terrain under a whole footprint suits type t (walls: open ground; bridges: water or rough). */
function terrainFits(w: World, t: EntityType, cx: number, cy: number): boolean {
  const g = w.grid!;
  const fw = fpW(t.size), fh = fpH(t.size);
  if (cx < 0 || cy < 0 || cx + fw > g.width || cy + fh > g.height) return false;
  for (let y = cy; y < cy + fh; y++)
    for (let x = cx; x < cx + fw; x++) if (!isWalkableCode(g.cells[y * g.width + x]!, t.moves ?? MOVES_GROUND)) return false;
  return true;
}

/** The live structure of `role` whose top-left is cell c, if any. */
const structureAt = (w: World, role: number, c: number): Unit | undefined =>
  w.units.find((u) => u.hp > 0 && u.role === role && originCell(w, u) === c);

// ---- walls ----

/**
 * Builders build a wall line from (fx, fy) to (tx, ty). Cells whose terrain can't take a wall are
 * dropped from the line when it is made, as the game's per-cell check (0x020016AC) does; units in
 * the way are dealt with when the builder gets there. Nothing is paid yet.
 */
export function orderWall(w: World, player: PlayerId, ids: readonly EntityId[], type: number, fx: number, fy: number, tx: number, ty: number): void {
  const g = w.grid;
  const t = w.types[type];
  const builders = ownBuilders(w, player, ids);
  if (!g || !t || t.role !== ROLE_WALL || builders.length === 0 || !allowed(w, player, builders[0]!, t)) return;
  const onMap = (x: number, y: number) => x >= 0 && y >= 0 && x < g.width && y < g.height;
  if (!onMap(fx, fy) || !onMap(tx, ty)) return; // both ends are tapped on the map
  const cells: number[] = [];
  for (const [x, y] of wallLine(fx, fy, tx, ty, fpW(t.size), fpH(t.size))) {
    const c = y * g.width + x;
    if (terrainFits(w, t, x, y) && !cells.includes(c)) cells.push(c);
  }
  if (cells.length === 0) return;
  for (const u of builders) setJob(w, u, { kind: 'wall', type, cells, i: 0, site: 0 });
}

function setJob(w: World, u: Unit, job: Job): void {
  u.target = null;
  stopMove(w, u); // a new order replaces the walk in progress (our rule, as for other orders)
  u.job = job;
}

/** A wall builder standing next to its piece, working on it from outside. */
export const isWallingOn = (w: World, u: Unit, s: Unit): boolean =>
  u.hp > 0 && u.owner === s.owner && u.job?.kind === 'wall' && u.job.site === s.id && u.mv === null &&
  rectDist(w.grid!, unitCell(w, u), originCell(w, s), 1) === 1;

/**
 * One tick of a wall job (ConstructMultipleEntityCommand, 0x02067C30). Pieces go up one at a time
 * in line order: walk next to the piece, pay for it and put down a 1 HP site, build it from outside
 * (stepConstruction), then on to the next. A piece another builder already started is helped
 * instead; a finished or blocked cell is skipped.
 */
export function stepWallJob(w: World, u: Unit, place: PlaceFn): void {
  const job = u.job;
  if (job?.kind !== 'wall') return;
  const g = w.grid!;
  const t = w.types[job.type]!;
  for (;;) {
    if (job.site !== 0) {
      const s = findById(w.units, job.site);
      if (!s || s.hp <= 0 || isFinished(s)) {
        job.site = 0;
        job.i++;
        continue;
      }
      if (approach(w, u, originCell(w, s), 1) === 'stuck') u.job = null;
      return;
    }
    const c = job.cells[job.i];
    if (c === undefined) {
      u.job = null;
      return;
    }
    const there = structureAt(w, ROLE_WALL, c);
    if (there) {
      if (there.owner === u.owner && !isFinished(there)) job.site = there.id;
      else job.i++;
      continue;
    }
    const cx = c % g.width, cy = Math.floor(c / g.width);
    if (!terrainFits(w, t, cx, cy)) {
      job.i++;
      continue;
    }
    const a = approach(w, u, c, 1);
    if (a === 'stuck') {
      job.i++; // nowhere to stand next to this piece. guess: the game gives up after 5 tries
      continue;
    }
    if (a !== 'there') return;
    const blocker = w.occ![c]!;
    if (blocker !== 0) {
      // Someone stands where the piece goes. The game nudges units off (state 2); we move our
      // own idle units and skip the piece for anyone else's. guess
      const b = findById(w.units, blocker);
      if (b && b.owner === u.owner && b.mv === null && b.job === null && b.speed > 0) {
        const to = freeCellNear(w, cx, cy, 3);
        if (to >= 0) orderMove(w, b, to);
        return;
      }
      if (b && b.mv !== null) return; // walking through: wait
      job.i++;
      continue;
    }
    const p = getPlayer(w, u.owner);
    if (!p || !spendBricks(p, t.cost)) {
      u.job = null; // can't pay: the order ends (state 0)
      return;
    }
    job.site = place(w, u.owner, t, cx, cy, false).id;
    return;
  }
}

// ---- bridges ----

/** Bridge entities by size (small, medium, large) and direction, in Entities.ebp order (121-126). */
export const BRIDGE_TYPES = { h: [121, 123, 125], v: [122, 124, 126] } as const;

/**
 * Which bridge fits a map bridge mark (MARK type 7 = horizontal, 8 = vertical) at (x, y)
 * (0x020A36E4): small, medium and large in turn; the first whose far end (start + its length
 * along the span) is not water (3) or code 4 wins, large if none. confirmed (code; mp04's four
 * sites match what the game offers in the emulator)
 */
export function sizeBridge(g: { width: number; height: number; cells: ArrayLike<number> }, x: number, y: number, vertical: boolean): number {
  const types = vertical ? BRIDGE_TYPES.v : BRIDGE_TYPES.h;
  const lengths = [3, 6, 9];
  for (let k = 0; k < 2; k++) {
    const ex = vertical ? x : x + lengths[k]!;
    const ey = vertical ? y + lengths[k]! : y;
    const code = ex < g.width && ey < g.height ? g.cells[ey * g.width + ex]! : 0;
    if (code !== TERRAIN_WATER && code !== 4) return types[k]!;
  }
  return types[2];
}

/**
 * Builders go build the bridge for site (cx, cy). Only the map's bridge sites take one, and only
 * the bridge sized for that site. Nothing is paid yet.
 */
export function orderBridge(w: World, player: PlayerId, ids: readonly EntityId[], type: number, cx: number, cy: number): void {
  const g = w.grid;
  const t = w.types[type];
  const builders = ownBuilders(w, player, ids);
  if (!g || !t || t.role !== ROLE_BRIDGE || builders.length === 0) return;
  const cell = cy * g.width + cx;
  if (!w.bridgeSites.some((s) => s.cell === cell && s.type === type)) return;
  const there = structureAt(w, ROLE_BRIDGE, cell);
  if (there && (there.owner !== player || isFinished(there))) return;
  for (const u of builders) setJob(w, u, { kind: 'bridge', type, cell });
}

/**
 * One tick of a bridge job: walk next to the site; the first builder there pays and puts down the
 * 1 HP bridge (emulator: bricks go when the builder arrives, not when the order is given), then
 * every builder goes inside it to build, as for other buildings.
 */
export function stepBridgeJob(w: World, u: Unit, place: PlaceFn): void {
  const job = u.job;
  if (job?.kind !== 'bridge') return;
  const g = w.grid!;
  const t = w.types[job.type]!;
  let s = structureAt(w, ROLE_BRIDGE, job.cell);
  if (s && (s.owner !== u.owner || isFinished(s))) {
    u.job = null;
    return;
  }
  const a = approach(w, u, job.cell, fpW(t.size), fpH(t.size));
  if (a === 'stuck') u.job = null;
  if (a !== 'there') return;
  if (!s) {
    const p = getPlayer(w, u.owner);
    if (!p || !spendBricks(p, t.cost)) {
      u.job = null;
      return;
    }
    s = place(w, u.owner, t, job.cell % g.width, Math.floor(job.cell / g.width), false);
  }
  removeUnit(w, u);
  u.job = { kind: 'inside', building: s.id, timer: -1, tree: -1 };
}

/** A finished bridge turns the cells under it into rough ground: walkers cross, ships can't. */
export function finishBridge(w: World, b: Unit): void {
  const g = w.grid!;
  const o = originCell(w, b);
  const ox = o % g.width, oy = Math.floor(o / g.width);
  for (let y = oy; y < oy + fpH(b.size); y++) for (let x = ox; x < ox + fpW(b.size); x++) g.cells[y * g.width + x] = TERRAIN_ROUGH;
}

/**
 * A destroyed bridge (Bridge vtable slot 5, 0x02058364 → 0x0205878C): the cells go back to water
 * and ground units on it are killed, except heroes, who are put back on the nearest bank.
 * likely (code; not watched in the emulator)
 */
export function collapseBridge(w: World, b: Unit): void {
  const g = w.grid!;
  const o = originCell(w, b);
  const ox = o % g.width, oy = Math.floor(o / g.width);
  const fw = fpW(b.size), fh = fpH(b.size);
  const on = (u: Unit) => {
    if (u === b || u.hp <= 0 || u.layer !== 0 || u.cell < 0) return false;
    const x = u.cell % g.width, y = Math.floor(u.cell / g.width);
    return x >= ox && y >= oy && x < ox + fw && y < oy + fh;
  };
  const riders = w.units.filter(on);
  if (isFinished(b)) for (let y = oy; y < oy + fh; y++) for (let x = ox; x < ox + fw; x++) g.cells[y * g.width + x] = TERRAIN_WATER;
  for (const u of riders) {
    if (isWalkableCode(TERRAIN_WATER, u.moves)) continue; // can swim: stays
    if (u.role !== 0) {
      u.hp = 0;
      continue;
    }
    const to = freeCellNear(w, u.cell % g.width, Math.floor(u.cell / g.width), 10);
    if (to < 0) {
      u.hp = 0;
      continue;
    }
    removeUnit(w, u);
    u.mv = null;
    u.path = [];
    u.tx = u.ty = null;
    const cx = to % g.width, cy = Math.floor(to / g.width);
    u.x = cellCenterX(cx);
    u.y = cellCenterY(cy);
    placeUnit(w, u);
  }
}

/** The cell past a bridge's far end, where its builders come out (H: right of the top row). */
export function bridgeExit(w: World, b: Unit): number {
  const g = w.grid!;
  const o = originCell(w, b);
  const ox = o % g.width, oy = Math.floor(o / g.width);
  const fw = fpW(b.size), fh = fpH(b.size);
  // Vertical bridges: below the left column. guess (only a horizontal one was watched)
  return fw > fh ? freeCellNear(w, ox + fw, oy, 7) : freeCellNear(w, ox, oy + fh, 7);
}
