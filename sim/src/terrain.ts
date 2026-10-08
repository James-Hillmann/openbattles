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

// 8 neighbours in a fixed order.
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];

/**
 * Can a unit step from cell (x, y) in direction d? Diagonals may pass between
 * two blocked cells, as in the game's path search (0x02082078 has no corner check).
 */
function canStep(g: TerrainGrid, x: number, y: number, d: number): boolean {
  return isWalkable(g, x + DX[d]!, y + DY[d]!);
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
