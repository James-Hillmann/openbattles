import { moveSpeed } from './spells';
import { CELL_H, CELL_W } from './config';
import { fxToInt, type Fx } from './fixed';
import { stepBudget, stepToward } from './motion';
import type { Mover, Unit, World } from './state';
import { cellCenterX, cellCenterY, isWalkable, type TerrainGrid } from './terrain';

/*
 * Unit movement on a map, ported from the game's MoveUnitAction (ARM9, see
 * docs/re-notes/movement.md). Each tick a unit asks its "plotter" for the next
 * cell to head for, then a "seeker" moves it toward that cell's centre:
 *
 *   plotter = A* ⊃ sidestep ⊃ wait-for-obstacle ⊃ segmented vector
 *
 * Normally the unit just walks straight at a point about 5 cells ahead on the
 * line to its goal. Only when the seeker can't enter the next cell does the
 * chain escalate: wait (if the blocker is walking), then sidestep, then a
 * short A* search. Each stage is a small state machine, kept close to the
 * game's so behaviour (and odd corners of it) match.
 *
 * Occupancy: one unit per cell. A unit holds the cell it stands in and has to
 * claim the next one before its position may cross into it.
 */

/** Seeker results (game: 0 moving, 1 entered a new cell, 2 blocked, 3 arrived). */
const MOVING = 0, ENTERED = 1, BLOCKED = 2, ARRIVED = 3;
/** Plotter results (game: 0 wait, 1 head for waypoint, 2 waypoint is the goal, 3 give up). */
const P_WAIT = 0, P_WAYPOINT = 1, P_GOAL = 2, P_FAIL = 3;

/** Ticks a unit waits for a walking unit to clear the way (game: 2 s * 30). */
export const WAIT_TICKS = 60;

// ---------------------------------------------------------------- cells

const cellAt = (g: TerrainGrid, x: Fx, y: Fx): number =>
  Math.floor(fxToInt(y) / CELL_H) * g.width + Math.floor(fxToInt(x) / CELL_W);
const cx = (g: TerrainGrid, c: number) => c % g.width;
const cy = (g: TerrainGrid, c: number) => Math.floor(c / g.width);
/** Chebyshev distance between two cells (game: 0x020F29F4). */
const cheb = (g: TerrainGrid, a: number, b: number) =>
  Math.max(Math.abs(cx(g, a) - cx(g, b)), Math.abs(cy(g, a) - cy(g, b)));
const walkableCell = (g: TerrainGrid, u: Unit, c: number) => isWalkable(g, cx(g, c), cy(g, c), u.moves);
/** Index of cell c in World.occ for u's occupancy layer. */
const slot = (w: World, u: Unit, c: number) => u.layer * w.grid!.width * w.grid!.height + c;

/** The cell a unit's position is in (game: 0x0205BDE4). */
export const unitCell = (w: World, u: Unit): number => cellAt(w.grid!, u.x, u.y);

function findUnit(w: World, id: number): Unit | undefined {
  // units are sorted by id
  let lo = 0, hi = w.units.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = w.units[mid]!.id;
    if (v === id) return w.units[mid];
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** The other unit holding cell c, if any. */
function occupant(w: World, u: Unit, c: number): Unit | undefined {
  const id = w.occ![slot(w, u, c)]!;
  if (id === 0 || (u && id === u.id)) return undefined;
  return findUnit(w, id);
}

/**
 * Claim cell c for u and give up the one it held (game: Unit_reserveCell
 * 0x02059C40 then the switch-over in setPosition). Fails on unwalkable cells
 * and cells another unit holds.
 */
function claim(w: World, u: Unit, c: number): boolean {
  if (!walkableCell(w.grid!, u, c) || occupant(w, u, c)) return false;
  if (u.cell >= 0 && w.occ![slot(w, u, u.cell)] === u.id) w.occ![slot(w, u, u.cell)] = 0;
  w.occ![slot(w, u, c)] = u.id;
  u.cell = c;
  return true;
}

/** Register a unit in the cell it stands in, if free. Called on spawn. */
export function placeUnit(w: World, u: Unit): void {
  if (!w.grid || !w.occ) return;
  const c = unitCell(w, u);
  if (c >= 0 && c < w.grid.width * w.grid.height && w.occ[slot(w, u, c)] === 0 && walkableCell(w.grid, u, c)) {
    w.occ[slot(w, u, c)] = u.id;
    u.cell = c;
  }
}

/** Free a unit's cell (death or removal). */
export function removeUnit(w: World, u: Unit): void {
  if (w.occ && u.cell >= 0 && w.occ[slot(w, u, u.cell)] === u.id) w.occ[slot(w, u, u.cell)] = 0;
  u.cell = -1;
}

// ---------------------------------------------------------------- seeker


/**
 * Aligned = within the middle of the cell: 6..17 px across, 6..9 px down,
 * measured from the cell's top-left (game: 0x020559CC with the align flag).
 */
function inAlignWindow(u: Unit): boolean {
  const px = fxToInt(u.x) % CELL_W;
  const py = fxToInt(u.y) % CELL_H;
  return px >= 6 && px < 18 && py >= 6 && py < 10;
}

/**
 * One tick of the game's seeker (0x0205571C): head for the centre of cell
 * `target`. With `claimCells`, crossing into a new cell needs that cell; if it
 * is taken but the unit is next to its target, it may claim the target
 * instead (this is how a diagonal step past a corner gets through, even a
 * corner of unwalkable terrain: confirmed in the emulator, see movement.md).
 * `align` is the end-of-move variant: done once inside the align window.
 */
function seek(w: World, u: Unit, m: Mover, target: number, claimCells: boolean, align: boolean): number {
  const g = w.grid!;
  const here = unitCell(w, u);
  if (here === target && (!align || inAlignWindow(u))) return ARRIVED;
  const n = stepToward(u.x, u.y, cellCenterX(cx(g, target)), cellCenterY(cy(g, target)), stepBudget(moveSpeed(u)));
  const st = n.arrived ? ARRIVED : MOVING;
  const next = cellAt(g, n.x, n.y);
  if (next !== here && claimCells && next !== u.cell) {
    if (claim(w, u, next)) {
      u.x = n.x;
      u.y = n.y;
      return st === MOVING ? ENTERED : st;
    }
    if (cheb(g, here, target) <= 1 && claim(w, u, target)) {
      u.x = n.x;
      u.y = n.y;
      return st;
    }
    m.blocked = next;
    return BLOCKED;
  }
  u.x = n.x;
  u.y = n.y;
  return st;
}

// ---------------------------------------------------------------- segmented vector

/**
 * Ring search around a cell, radius 0..maxR-1, in the game's order
 * (0x02080430). Within ring r it tries (0, -r), (0, r) twice (a quirk: the
 * table for the axis points never yields (±r, 0)), then pairs (±s, ±r) /
 * (±r, ±s) for 0 < s < r, then the four corners.
 */
function ringSearch(g: TerrainGrid, centre: number, maxR: number, match: (c: number) => boolean): number {
  const x0 = cx(g, centre), y0 = cy(g, centre);
  const AXIS = [2, 3, 0, 1];
  const CORNER = [2, 1, 3, 0];
  const MID = [4, 6, 0, 5, 2, 1, 7, 3];
  for (let r = 0; r < maxR; r++) {
    for (let s = 0; s <= r; s++) {
      const order = r === 0 ? [2] : s === 0 ? AXIS : s === r ? CORNER : MID;
      for (const k of order) {
        const [ox, oy] = ringOffset(k, s, r);
        const x = x0 + ox, y = y0 + oy;
        // the game adds as bytes: anything off the map's left/top wraps past its right/bottom
        if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
        const c = y * g.width + x;
        if (match(c)) return c;
      }
    }
  }
  return -1;
}
function ringOffset(k: number, s: number, r: number): [number, number] {
  switch (k) {
    case 0: return [-s, -r];
    case 1: return [-s, r];
    case 2: return [s, -r];
    case 3: return [s, r];
    case 4: return [-r, s];
    case 5: return [r, s];
    case 6: return [-r, -s];
    case 7: return [r, -s];
    default: return [s, r];
  }
}

/** Scale for a step of about 5 cells along a line `len` cells long (Q12, game: 0x02056A54). */
const segmentScale = (len: number): number =>
  len >= 64 ? 0x143 : len >= 32 ? 0x28a : len >= 16 ? 0x529 : len >= 8 ? 0xaab : 0x1000;

/**
 * Segmented vector plotter (0x02056994): aim at a point about 5 cells along
 * the line to the goal, nudged to a free walkable cell near it.
 */
function segmentedUpdate(w: World, u: Unit, m: Mover, goal: number): number {
  const g = w.grid!;
  const here = unitCell(w, u);
  const dx = cx(g, goal) - cx(g, here);
  const dy = cy(g, goal) - cy(g, here);
  let wp = goal;
  if (dx !== 0 || dy !== 0) {
    const len = Math.max(Math.abs(dx), Math.abs(dy));
    const k = segmentScale(len);
    const sx = (dx * k) >> 12; // arithmetic shift: rounds toward -inf like the game
    const sy = (dy * k) >> 12;
    const x = cx(g, here) + sx, y = cy(g, here) + sy;
    const found = ringSearch(g, y * g.width + x, Math.min(len, 5), (c) => walkableCell(g, u, c) && !occupant(w, u, c));
    if (found >= 0) wp = found;
  }
  m.wp = wp;
  return wp === goal ? P_GOAL : P_WAYPOINT;
}

// ---------------------------------------------------------------- wait for obstacle

/** A unit with an active move order (game: has a MoveUnitAction, 0x0205A088). */
const isMoving = (u: Unit): boolean => u.mv !== null;

/**
 * Who is in the cell we bumped into (0x02057568). Returns:
 *   - a unit: it is walking, so it's worth waiting for;
 *   - null: blocked by terrain, a standing unit, or a unit waiting on us;
 *   - undefined: nothing there any more.
 * With `only`, answers whether that particular unit is the blocker.
 */
function findBlocker(w: World, u: Unit, m: Mover, only?: Unit): Unit | null | undefined | boolean {
  const g = w.grid!;
  if (!walkableCell(g, u, m.blocked)) return only ? true : null;
  const e = occupant(w, u, m.blocked);
  if (only) return e === only;
  if (!e) return undefined;
  if (!isMoving(e)) return null;
  if (isWaitingOn(w, e, u)) return null;
  return e;
}

/** Is `e` waiting for `u` to move? (game: plotter vtable +0x10, 0x020578A8) */
function isWaitingOn(w: World, e: Unit, u: Unit): boolean {
  const m = e.mv;
  return !!m && m.wait === 1 && findBlocker(w, e, m, u) === true;
}

function setWait(m: Mover, s: number): void {
  m.wait = s;
  if (s === 1) m.waitLeft = WAIT_TICKS;
}

function waitOnBlocked(w: World, u: Unit, m: Mover): boolean {
  if (m.wait !== 0) {
    setWait(m, 2);
    return false;
  }
  const b = findBlocker(w, u, m);
  setWait(m, b ? 1 : 2);
  return !!b;
}

function waitUpdate(w: World, u: Unit, m: Mover, goal: number): number {
  if (m.wait === 0) return segmentedUpdate(w, u, m, goal);
  if (m.wait === 2) return P_FAIL;
  const b = findBlocker(w, u, m);
  if (b) {
    if (--m.waitLeft !== 0) return P_WAIT;
    setWait(m, 2);
    return P_FAIL;
  }
  if (b === null) {
    setWait(m, 2);
    return P_FAIL;
  }
  setWait(m, 0);
  return segmentedUpdate(w, u, m, goal);
}

// ---------------------------------------------------------------- sidestep

/**
 * Sidestep offsets by direction to the waypoint: [CCW 45°, straight, CW 45°]
 * (screen axes, y down). Sidestep state 1 tries straight, 2 CCW, 3 CW.
 * Read from RAM (tables at 0x021490D8..0x02149198, filled at boot).
 */
const SIDESTEP: Record<string, [number, number][]> = {
  '-1,0': [[-1, 1], [-1, 0], [-1, -1]],
  '1,0': [[1, -1], [1, 0], [1, 1]],
  '0,-1': [[-1, -1], [0, -1], [1, -1]],
  '0,1': [[1, 1], [0, 1], [-1, 1]],
  '-1,-1': [[-1, 0], [-1, -1], [0, -1]],
  '1,-1': [[0, -1], [1, -1], [1, 0]],
  '-1,1': [[0, 1], [-1, 1], [-1, 0]],
  '1,1': [[1, 0], [1, 1], [0, 1]],
};
const SIDE_ENTRY = [1, 1, 0, 2]; // sidestep state -> table column

function setSide(m: Mover, s: number): void {
  m.side = s;
  if (s >= 1 && s <= 4) m.sideReset = true;
}

/** Try the next sidestep direction (0x02056E24): a new cell restarts at "straight". */
function advanceSide(w: World, u: Unit, m: Mover): void {
  const here = unitCell(w, u);
  if (here === m.sideCell) {
    if (m.side !== 4) setSide(m, m.side + 1);
  } else {
    m.sideCell = here;
    setSide(m, 1);
  }
}

function sideOnBlocked(w: World, u: Unit, m: Mover): boolean {
  if (m.side === 0) {
    if (waitOnBlocked(w, u, m)) return true;
    setWait(m, 0);
    m.sideCell = unitCell(w, u);
    setSide(m, 1);
  } else {
    advanceSide(w, u, m);
  }
  return m.side !== 4;
}

/** Pick a free cell next to the unit in the current sidestep direction (0x02057104). */
function sidestepStep(w: World, u: Unit, m: Mover, goal: number): number {
  const r = waitUpdate(w, u, m, goal);
  if (r === P_WAIT) return P_WAIT;
  if (r === P_FAIL) return P_FAIL;
  const g = w.grid!;
  for (;;) {
    const here = unitCell(w, u);
    const key = `${Math.sign(cx(g, m.wp) - cx(g, here))},${Math.sign(cy(g, m.wp) - cy(g, here))}`;
    const row = SIDESTEP[key];
    if (!row) return P_FAIL; // waypoint is our own cell; the game reads a null table here
    const [ox, oy] = row[SIDE_ENTRY[m.side]!]!;
    const x = cx(g, here) + ox, y = cy(g, here) + oy;
    const c = y * g.width + x;
    if (isWalkable(g, x, y, u.moves) && !occupant(w, u, c)) {
      m.wp = c;
      return P_WAYPOINT;
    }
    advanceSide(w, u, m);
    if (m.side === 4) return P_FAIL;
  }
}

function sideUpdate(w: World, u: Unit, m: Mover, goal: number): number {
  const g = w.grid!;
  if (m.sideReset) {
    m.wp = -1;
    m.sideReset = false;
  }
  const here = unitCell(w, u);
  if (m.side >= 1 && m.side <= 3) {
    if (cheb(g, goal, here) === 1) return P_FAIL;
    if (m.wp >= 0 && here === m.wp) {
      if (m.side === 1) {
        m.wp = -1;
        setSide(m, 0);
      } else {
        setSide(m, 1);
      }
    }
  }
  if (m.wp >= 0 && m.side !== 0) return m.wp === goal ? P_GOAL : P_WAYPOINT;
  switch (m.side) {
    case 0: {
      const r = waitUpdate(w, u, m, goal);
      if (r !== P_FAIL) return r;
      setWait(m, 0);
      m.sideCell = here;
      setSide(m, 1);
      return astarUpdate(w, u, m, goal); // the game re-enters through the vtable: the outermost plotter
    }
    case 1:
    case 2:
    case 3:
      return sidestepStep(w, u, m, goal);
    default:
      return P_FAIL;
  }
}

// ---------------------------------------------------------------- A*

/** Cell cost for the game's path search (0x02082BC4): 200 = impassable. */
function pathCost(w: World, u: Unit, c: number): number {
  if (!walkableCell(w.grid!, u, c)) return 200;
  const e = occupant(w, u, c);
  if (!e) return 1;
  return isMoving(e) ? 3 : 150;
}

// Neighbour order of the game's expansion (0x020820F4).
const NX = [-1, 0, 1, -1, 1, -1, 0, 1];
const NY = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * Path search from the unit's cell to `goal` with the game's costs: a free
 * cell costs 1, one with a walking unit 3, a standing unit 150, terrain is a
 * wall. Diagonals cost the same as straight steps and may cut corners; the
 * heuristic is Chebyshev distance. Returns the cells after the start, or null
 * if the goal can't be reached or another unit ends up in it (0x020826E4).
 */
export function unitPath(w: World, u: Unit, goal: number): number[] | null {
  const g = w.grid!;
  const n = g.width * g.height;
  const start = unitCell(w, u);
  if (start === goal) return [];
  const cost = new Int32Array(n).fill(-1); // memoised cell cost
  const gs = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: number[] = []; // binary heap of cells by (f, h, cell)
  const f = new Int32Array(n);
  const h = new Int32Array(n);
  const less = (a: number, b: number) => (f[a] !== f[b] ? f[a]! < f[b]! : h[a] !== h[b] ? h[a]! < h[b]! : a < b);
  const push = (c: number) => {
    open.push(c);
    for (let k = open.length - 1; k > 0; ) {
      const p = (k - 1) >> 1;
      if (!less(open[k]!, open[p]!)) break;
      [open[k], open[p]] = [open[p]!, open[k]!];
      k = p;
    }
  };
  const pop = () => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1, r = l + 1;
        let s = k;
        if (l < open.length && less(open[l]!, open[s]!)) s = l;
        if (r < open.length && less(open[r]!, open[s]!)) s = r;
        if (s === k) break;
        [open[k], open[s]] = [open[s]!, open[k]!];
        k = s;
      }
    }
    return top;
  };
  gs[start] = 0;
  h[start] = cheb(g, start, goal);
  f[start] = h[start]!;
  push(start);
  while (open.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const x = cx(g, cur), y = cy(g, cur);
    for (let d = 0; d < 8; d++) {
      const nx = x + NX[d]!, ny = y + NY[d]!;
      if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
      const nc = ny * g.width + nx;
      if (closed[nc]) continue;
      if (cost[nc] === -1) cost[nc] = pathCost(w, u, nc);
      if (cost[nc]! >= 200) continue;
      const ng = gs[cur]! + cost[nc]!;
      if (gs[nc] !== -1 && ng >= gs[nc]!) continue;
      gs[nc] = ng;
      h[nc] = cheb(g, nc, goal);
      f[nc] = ng + h[nc]!;
      parent[nc] = cur;
      push(nc);
    }
  }
  if (!closed[goal]) return null;
  if (occupant(w, u, goal)) return null;
  const path: number[] = [];
  for (let c = goal; c !== start; c = parent[c]!) path.push(c);
  return path.reverse();
}

function setAstar(m: Mover, s: number): void {
  m.astar = s;
}

function astarOnBlocked(w: World, u: Unit, m: Mover): boolean {
  switch (m.astar) {
    case 0:
      if (sideOnBlocked(w, u, m)) return true;
      setSide(m, 0);
      setAstar(m, 1);
      break;
    case 2:
      if (m.pathIdx < u.path.length - 1) {
        m.pathIdx++;
        setAstar(m, 3);
      } else {
        setAstar(m, 4);
      }
      break;
    case 3:
      setAstar(m, 0);
      break;
  }
  return m.astar !== 4;
}

/** Outermost plotter (AstarPlotter, 0x02056074). */
function astarUpdate(w: World, u: Unit, m: Mover, goal: number): number {
  const here = unitCell(w, u);
  if (here === goal) {
    m.wp = goal;
    return P_GOAL;
  }
  const toWp = () => (m.wp === goal ? P_GOAL : P_WAYPOINT);
  switch (m.astar) {
    case 0: {
      const r = sideUpdate(w, u, m, goal);
      if (r !== P_FAIL) return r;
      setSide(m, 0);
      setAstar(m, 1);
      return astarUpdate(w, u, m, goal);
    }
    case 1: {
      // Search to the next segment point, not the goal. The game runs the search as a background
      // job over several ticks; we finish it at once (see movement.md).
      segmentedUpdate(w, u, m, goal);
      const p = unitPath(w, u, m.wp);
      if (!p) {
        setAstar(m, 4);
        return P_FAIL;
      }
      u.path = p;
      m.pathIdx = 0;
      setAstar(m, 2);
      if (p.length === 0) {
        m.wp = goal;
        return P_GOAL;
      }
      m.wp = p[0]!;
      return toWp();
    }
    case 2: {
      if (here === m.wp) {
        if (m.pathIdx < u.path.length - 1) {
          m.wp = u.path[++m.pathIdx]!;
        } else {
          setAstar(m, 0);
          return sideUpdate(w, u, m, goal);
        }
      }
      return toWp();
    }
    case 3: {
      const pc = u.path[m.pathIdx]!;
      if (here === pc) {
        setAstar(m, 2);
        return astarUpdate(w, u, m, goal);
      }
      const r = sideUpdate(w, u, m, pc);
      if (r === P_WAIT || r === P_WAYPOINT) return r;
      if (r === P_GOAL) {
        if (here !== m.wp) return toWp();
        m.pathIdx++;
        setAstar(m, m.pathIdx > u.path.length - 1 ? 0 : 2);
        return astarUpdate(w, u, m, goal);
      }
      setSide(m, 0);
      setAstar(m, 1);
      return astarUpdate(w, u, m, goal);
    }
    default:
      return P_FAIL;
  }
}

// ---------------------------------------------------------------- move action

export function newMover(goal: number): Mover {
  return { goal, align: false, wp: -1, blocked: -1, wait: 0, waitLeft: 0, side: 0, sideCell: -1, sideReset: false, astar: 0, pathIdx: 0 };
}

/** Order a unit to walk to a cell. */
export function orderMove(w: World, u: Unit, goal: number): void {
  const g = w.grid!;
  u.mv = newMover(goal);
  u.tx = cellCenterX(cx(g, goal));
  u.ty = cellCenterY(cy(g, goal));
  u.path = [];
}

/**
 * Drop the move order on the spot. A unit that stepped past a blocked corner
 * stands in a cell it does not hold (see `seek`); it keeps an aligning-only
 * order so it finishes walking into its own cell instead of staying on top
 * of the corner cell's occupant (guess: not seen in the game; keeps one unit per cell).
 */
export function stopMove(w: World, u: Unit): void {
  if (w.grid && u.cell >= 0 && u.cell !== unitCell(w, u)) {
    if (!u.mv?.align) u.mv = { ...newMover(u.cell), align: true };
    u.mv.goal = u.cell;
    u.tx = cellCenterX(cx(w.grid, u.cell));
    u.ty = cellCenterY(cy(w.grid, u.cell));
    u.path = [];
    return;
  }
  u.mv = null;
  u.tx = u.ty = null;
  u.path = [];
}

/**
 * One tick of MoveActionBase (0x02053C44) for a unit with a move order:
 * travel until the plotter reports the goal reached (or gives up), then
 * centre on the cell it ended in.
 */
export function moveOnMap(w: World, u: Unit): void {
  const m = u.mv;
  if (!m) return;
  if (!m.align) {
    const r = astarUpdate(w, u, m, m.goal);
    if (r === P_WAIT) return;
    if (r === P_FAIL) {
      m.align = true; // takes effect next tick
      return;
    }
    const s = seek(w, u, m, m.wp, true, false);
    if (s === BLOCKED) {
      if (!astarOnBlocked(w, u, m)) m.align = true;
      return;
    }
    if (!(r === P_GOAL && s === ARRIVED)) return;
    m.align = true; // arrived: start centring this same tick
  }
  // Centre on the cell the unit holds. After a corner step (see `seek`) that is next to the
  // cell it stands in, so this also walks it off the corner cell's occupant.
  if (seek(w, u, m, u.cell >= 0 ? u.cell : unitCell(w, u), false, true) === ARRIVED) {
    u.mv = null;
    u.tx = u.ty = null;
    u.path = [];
  }
}
