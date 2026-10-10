import { nextU32 } from './rng';
import type { World } from './state';

/*
 * The game's "nearest cell" search (0x02080430), used for the CPU's tree search (0x0207FEF0) and building
 * placement (0x0207F194). It walks out ring by ring from a cell, and within ring d by k = 0..d, the offset
 * along the ring's side from its middle. Each k tests a few symmetric points in an order taken from one of
 * three small tables, and the game swaps two entries of each table at the start of every tick with its
 * shared RNG (0x02080398, from the tick function 0x02083680). So among the cells at the same (d, k) the pick
 * is random, but a cell with smaller k (nearer the ring's middle) is always tried first. confirmed (code;
 * tables read from RAM in the emulator)
 *
 * Quirk kept: the k = 0 table should hold codes 2..5 (the four points straight above, below, left and right;
 * its random setup 0x0208019C writes them), but at match start 0x0208014C resets it to 0..3, which only name
 * the points above and below, twice each. So the cells straight left and right of the start, at any distance,
 * are never tried. confirmed (RAM: the table held a permutation of 0..3 all match)
 */

/** Table sizes and their offsets in `World.ring`: A (d = 0 and the corners k = d), B (k = 0), C (the rest). */
const A = 0;
const B = 4;
const C = 8;

/** The tables as a match starts (0x0208014C): A = 0..3, B = 0..3, C = 0..7. */
export function newRing(): number[] {
  return [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7];
}

/** Start of a tick (0x02080398): one draw from the shared RNG swaps a pair in each table. */
export function shuffleRing(w: World): void {
  const r = nextU32(w.rng);
  const t = w.ring;
  const swap = (i: number, j: number) => {
    const v = t[i]!;
    t[i] = t[j]!;
    t[j] = v;
  };
  swap(B + (r & 3), B + ((r >>> 2) & 3));
  swap(A + ((r >>> 4) & 3), A + ((r >>> 6) & 3));
  swap(C + ((r >>> 8) & 7), C + ((r >>> 11) & 7));
}

/** Offset for direction code `code` at ring d, side offset k (the switch in 0x02080430). */
function offset(code: number, d: number, k: number): [number, number] {
  switch (code) {
    case 0: return [-k, -d];
    case 1: return [-k, d];
    case 2: return [k, -d];
    case 3: return [k, d];
    case 4: return [-d, k];
    case 5: return [d, k];
    case 6: return [-d, -k];
    default: return [d, -k];
  }
}

/**
 * The first cell, in the game's order, within `radius` rings (d < radius) of (x0, y0) inside the map for which
 * `test` holds, as y * width + x, or -1. Coordinates wrap like the game's bytes, so cells left of or above the
 * map edge are never tried.
 */
export function ringSearch(w: World, x0: number, y0: number, radius: number, test: (x: number, y: number) => boolean): number {
  const g = w.grid;
  if (!g) return -1;
  const t = w.ring;
  for (let d = 0; d < radius; d++) {
    for (let k = 0; k <= d; k++) {
      const [from, n] = d === 0 || k === d ? [A, 4] : k === 0 ? [B, 4] : [C, 8];
      for (let i = 0; i < n; i++) {
        const [dx, dy] = offset(t[from + i]!, d, k);
        const x = (x0 + dx) & 0xff, y = (y0 + dy) & 0xff;
        if (x < g.width && y < g.height && test(x, y)) return y * g.width + x;
      }
    }
  }
  return -1;
}
