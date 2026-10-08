import { CELL_H, CELL_W } from './config';
import { fx, fxToInt, type Fx } from './fixed';

/**
 * The map's walkability, one terrain code per cell (the baked grid from the
 * map file). Static for now; tree chopping will mutate it later, so it lives
 * in the World and is hashed.
 */
export interface TerrainGrid {
  width: number;
  height: number;
  cells: Uint8Array;
}

/**
 * Terrain codes units can stand on. Checked in the emulator: forest (1), water (3)
 * and rock plateaus (5) stop a walking hero at their edge; open (0) and rough (2)
 * ground are walked on. See docs/re-notes/formats.md.
 */
export const isWalkableCode = (code: number): boolean => code === 0 || code === 2;

export function isWalkable(g: TerrainGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < g.width && cy < g.height && isWalkableCode(g.cells[cy * g.width + cx]!);
}

/** Cell containing a world position (px). Positions are never negative on a map. */
export const cellOf = (x: Fx, y: Fx): [number, number] => [Math.floor(fxToInt(x) / CELL_W), Math.floor(fxToInt(y) / CELL_H)];
export const cellCenterX = (cx: number): Fx => fx(cx * CELL_W + CELL_W / 2);
export const cellCenterY = (cy: number): Fx => fx(cy * CELL_H + CELL_H / 2);

// 8 neighbours in a fixed order. Straight steps cost 10, diagonals 14 (cell space is isotropic).
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];
const COST = [10, 10, 10, 10, 14, 14, 14, 14];

/** Octile distance in the same units as COST. */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
}

/** Binary min-heap of cell indices keyed by (f, h, index): a total order, so ties never depend on insertion. */
class Heap {
  private items: number[] = [];
  constructor(private readonly f: Int32Array, private readonly h: Int32Array) {}
  get size() {
    return this.items.length;
  }
  private less(a: number, b: number): boolean {
    const f = this.f, h = this.h;
    return f[a]! !== f[b]! ? f[a]! < f[b]! : h[a]! !== h[b]! ? h[a]! < h[b]! : a < b;
  }
  push(i: number) {
    const it = this.items;
    it.push(i);
    let k = it.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.less(it[k]!, it[p]!)) break;
      [it[k], it[p]] = [it[p]!, it[k]!];
      k = p;
    }
  }
  pop(): number {
    const it = this.items;
    const top = it[0]!;
    const last = it.pop()!;
    if (it.length > 0) {
      it[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < it.length && this.less(it[l]!, it[m]!)) m = l;
        if (r < it.length && this.less(it[r]!, it[m]!)) m = r;
        if (m === k) break;
        [it[k], it[m]] = [it[m]!, it[k]!];
        k = m;
      }
    }
    return top;
  }
}

/**
 * A* from one cell to another over walkable cells, 8-way, never cutting a
 * blocked corner. If the goal can't be reached (blocked or walled off), the
 * path ends at the reachable cell closest to it, which is what the game does
 * (a hero sent into a forest stops at its edge).
 *
 * Returns the cells to visit after `from`, ending with the cell it stops in;
 * empty when it is already there. Fully deterministic: integer costs and a
 * total order on the open set.
 */
export function findPath(g: TerrainGrid, fromX: number, fromY: number, toX: number, toY: number): number[] {
  const n = g.width * g.height;
  const gCost = new Int32Array(n).fill(-1);
  const f = new Int32Array(n);
  const h = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new Heap(f, h);
  const start = fromY * g.width + fromX;
  gCost[start] = 0;
  h[start] = heuristic(fromX, fromY, toX, toY);
  f[start] = h[start]!;
  open.push(start);
  let best = start; // closest-to-goal cell reached so far
  const goal = toY * g.width + toX;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (h[cur]! < h[best]! || (h[cur] === h[best] && gCost[cur]! < gCost[best]!)) best = cur;
    if (cur === goal) break;
    const cx = cur % g.width;
    const cy = (cur - cx) / g.width;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d]!;
      const ny = cy + DY[d]!;
      if (!isWalkable(g, nx, ny)) continue;
      // No squeezing diagonally between two blocked cells or past a blocked corner.
      if (d >= 4 && (!isWalkable(g, cx + DX[d]!, cy) || !isWalkable(g, cx, cy + DY[d]!))) continue;
      const ni = ny * g.width + nx;
      if (closed[ni]) continue;
      const ng = gCost[cur]! + COST[d]!;
      if (gCost[ni] !== -1 && ng >= gCost[ni]!) continue;
      gCost[ni] = ng;
      h[ni] = heuristic(nx, ny, toX, toY);
      f[ni] = ng + h[ni]!;
      parent[ni] = cur;
      open.push(ni);
    }
  }
  const path: number[] = [];
  for (let c = best; c !== start; c = parent[c]!) path.push(c);
  return path.reverse();
}

/** Drop waypoints in the middle of straight runs, so units walk each leg in one line. */
export function simplifyPath(g: TerrainGrid, from: number, path: readonly number[]): number[] {
  const out: number[] = [];
  let prev = from;
  for (let i = 0; i < path.length; i++) {
    const cur = path[i]!;
    const next = path[i + 1];
    if (next !== undefined) {
      const d1 = cur - prev;
      const d2 = next - cur;
      if (d1 === d2 && Math.abs(d1) <= g.width + 1) {
        prev = cur;
        continue;
      }
    }
    out.push(cur);
    prev = cur;
  }
  return out;
}

/** Can a unit step from cell (x, y) in direction d? Same rule as findPath. */
function canStep(g: TerrainGrid, x: number, y: number, d: number): boolean {
  if (!isWalkable(g, x + DX[d]!, y + DY[d]!)) return false;
  return d < 4 || (isWalkable(g, x + DX[d]!, y) && isWalkable(g, x, y + DY[d]!));
}

/** Every cell a unit standing in one of `starts` can walk to (1 = reachable). */
export function reachableFrom(g: TerrainGrid, starts: readonly number[]): Uint8Array {
  const out = new Uint8Array(g.width * g.height);
  const queue: number[] = [];
  for (const s of starts) if (!out[s]) (out[s] = 1), queue.push(s);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    const x = cur % g.width;
    const y = (cur - x) / g.width;
    for (let d = 0; d < 8; d++) {
      if (!canStep(g, x, y, d)) continue;
      const ni = (y + DY[d]!) * g.width + x + DX[d]!;
      if (!out[ni]) (out[ni] = 1), queue.push(ni);
    }
  }
  return out;
}

/**
 * Up to `count` distinct walkable cells around (cx, cy), nearest first, in a
 * fixed order: the goal cells for a group move, so units don't all stack on
 * one spot. With `allowed`, only cells marked 1 are taken (pass the group's
 * reachable area so a click on water or an island still spreads the group
 * along the near shore instead of stacking it on one cell).
 */
export function spreadCells(g: TerrainGrid, cx: number, cy: number, count: number, allowed?: Uint8Array): number[] {
  const out: number[] = [];
  const seen = new Uint8Array(g.width * g.height);
  const start = cy * g.width + cx;
  const queue = [start];
  seen[start] = 1;
  // BFS over the whole grid, but only walkable cells are taken (and expanded from, once we've found one).
  for (let qi = 0; qi < queue.length && out.length < count; qi++) {
    const cur = queue[qi]!;
    const x = cur % g.width;
    const y = (cur - x) / g.width;
    const walk = isWalkable(g, x, y) && (!allowed || allowed[cur] === 1);
    if (walk) out.push(cur);
    if (out.length > 0 && !walk) continue;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
      const ni = ny * g.width + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return out;
}
