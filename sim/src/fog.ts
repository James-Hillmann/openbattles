import type { PlayerId, Unit, World } from './state';
import { cellOf } from './terrain';

/**
 * Fog of war, as the game's `User::FogCircle` manager does it (0x020A15B8).
 * See docs/re-notes/fog.md.
 *
 * Each of the local player's units has a vision circle at its map cell with
 * radius = sight (entity +0x71, in cells). Every update the game clears the
 * "visible" bit grid (one bit per cell), stamps every circle into it, and stamps
 * circles that moved into the "explored" grid, which is never cleared.
 *
 * This lives on the presentation side in the game (namespace `User`), so it
 * isn't part of the lockstep state or the hash: each client keeps its own Fog
 * for its own player and updates it from the World.
 */
export interface Fog {
  width: number;
  height: number;
  /** 1 = a unit sees this cell now. */
  visible: Uint8Array;
  /** 1 = some unit has seen this cell since the game started. */
  explored: Uint8Array;
}

export function createFog(width: number, height: number): Fog {
  return { width, height, visible: new Uint8Array(width * height), explored: new Uint8Array(width * height) };
}

/** Set cells x0..x1 of row y, clipped to the grid (0x020A1650). */
function span(f: Fog, grid: Uint8Array, x0: number, x1: number, y: number): void {
  if (y < 0 || y >= f.height) return;
  const a = Math.max(x0, 0);
  const b = Math.min(x1, f.width - 1);
  for (let x = a; x <= b; x++) grid[y * f.width + x] = 1;
}

/**
 * Filled midpoint circle (0x020A1694), step for step: four spans per step, so
 * rows near the centre are written more than once. `wideA`/`wideB` add one cell
 * on the right of the cy±x and cy±y rows (circle flags +0x12/+0x13; not yet
 * known which units set them, so the sim passes 0).
 */
export function stampCircle(f: Fog, grid: Uint8Array, cx: number, cy: number, r: number, wideA = 0, wideB = 0): void {
  let x = r;
  let y = 0;
  let err = (1 - r) * 2;
  let dx = 2 * r - 1;
  let dy = 1;
  while (x >= y) {
    span(f, grid, cx - y, cx + y + wideA, cy - x);
    span(f, grid, cx - y, cx + y + wideA, cy + x);
    span(f, grid, cx - x, cx + x + wideB, cy + y);
    span(f, grid, cx - x, cx + x + wideB, cy - y);
    if (err + x > 0) {
      x--;
      dx -= 2;
      err -= dx;
    }
    if (y > err) {
      y++;
      dy += 2;
      err += dy;
    }
  }
}

/** Sight radius in cells (entity +0x71). Buildings see too: a castle's 11 cells is the circle around the start. */
const sightOf = (u: Unit): number => u.sight;

/**
 * Recompute `visible` from the player's units and add it to `explored`. The game
 * only re-stamps a circle into `explored` when its cell changed; stamping every
 * circle every time gives the same grid.
 */
export function updateFog(f: Fog, w: World, player: PlayerId): void {
  f.visible.fill(0);
  for (const u of w.units) {
    if (u.owner !== player || u.hp <= 0) continue;
    const r = sightOf(u);
    if (r === 0) continue;
    const [cx, cy] = visionCell(u);
    stampCircle(f, f.visible, cx, cy, r);
  }
  for (let i = 0; i < f.visible.length; i++) if (f.visible[i]) f.explored[i] = 1;
}

/**
 * The cell a unit's vision circle is centred on: the cell it stands in, or for a
 * building the middle of its footprint (the castle at mp01's (10, 10) has its
 * circle at (11, 11) in RAM). Read from the position, which buildings also have.
 */
export const visionCell = (u: Unit): [number, number] => {
  const [cx, cy] = cellOf(u.x, u.y);
  const mid = u.size >> 1;
  return [cx + mid, cy + mid];
};

export const isVisible = (f: Fog, cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < f.width && cy < f.height && f.visible[cy * f.width + cx] === 1;
export const isExplored = (f: Fog, cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < f.width && cy < f.height && f.explored[cy * f.width + cx] === 1;
