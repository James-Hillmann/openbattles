/**
 * The game's 20.12 helpers and cell geometry that the forest and projectile spells use, ported
 * bit for bit (docs/re-notes/spells.md). 20.12: 4096 = 1.0. These are separate from the sim's own
 * Q16.16 `Fx` because the rounding has to match the game's.
 */

/** 20.12 multiply with rounding (0x0204F2B8): (a * b + 0x800) >> 12. Exact for |a * b| < 2^53. */
export const fx12Mul = (a: number, b: number): number => Math.floor((a * b + 0x800) / 4096);

const M64 = (1n << 64n) - 1n;

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/**
 * Unit vector of (x, y) in 20.12 (0x020F27B8), with the DS divider's and square root's rounding:
 * q = 2^56 / |v|^2, s = sqrt(4 |v|^2), f = q * s mod 2^64, result (f * c + 2^44) >> 45 as int64.
 * confirmed: matches every logged end point and projectile velocity.
 */
export function normalize(x: number, y: number): [number, number] {
  if (x === 0 && y === 0) return [0, 0];
  const bx = BigInt(x);
  const by = BigInt(y);
  const S = bx * bx + by * by;
  const q = (1n << 56n) / S;
  const s = isqrt(S << 2n);
  const f = (q * s) & M64;
  const one = (c: bigint) => Number(BigInt.asIntN(64, BigInt.asIntN(64, f * c) + (1n << 44n)) >> 45n);
  return [one(bx), one(by)];
}

/** A cell as the spells keep it: x and y as bytes, (y << 8) | x, so x = width (an off-map neighbour) stays distinct. */
export const packCell = (x: number, y: number): number => (y << 8) | x;
export const cellXOf = (c: number): number => c & 0xff;
export const cellYOf = (c: number): number => c >> 8;

/**
 * Forest Spawn's thick line (0x020F09DC): the cells strictly between start and end along the major
 * axis, Bresenham style, each with one side neighbour while the error term is non-zero and a
 * diagonal pair (the cell pushed twice) on a minor step. Start == end gives [start, end].
 * The right / down neighbours are allowed at x = width / y = height (a game off-by-one).
 * confirmed: matches 56 logged lists in every octant.
 */
export function thickLine(x0: number, y0: number, x1: number, y1: number, W: number, H: number): number[] {
  const out: number[] = [];
  type Push = (x: number, y: number) => void;
  const P: Push = (x, y) => void out.push(packCell(x, y));
  const PL: Push = (x, y) => (P(x, y), x > 0 && P(x - 1, y), undefined);
  const PU: Push = (x, y) => (P(x, y), y > 0 && P(x, y - 1), undefined);
  const PR: Push = (x, y) => (P(x, y), x < W && P(x + 1, y), undefined);
  const PD: Push = (x, y) => (P(x, y), y < H && P(x, y + 1), undefined);
  const dx = x1 - x0;
  const dy = y1 - y0;
  let err = 0;
  let x = x0;
  let y = y0;
  // One octant: walk the major axis; `grow` adds to the error, `side` pushes the side cell, `minor`
  // steps the minor axis, `diag` pushes the diagonal pair.
  const walk = (d: number, grow: number, more: () => boolean, next: () => void, side: Push, minor: () => void, diag: [Push, Push]) => {
    while (more()) {
      if (err < d) {
        err += grow;
        (err === 0 ? P : side)(x, y);
      } else {
        minor();
        err -= d;
        if (err === 0) P(x, y);
        else {
          diag[0](x, y);
          diag[1](x, y);
        }
      }
      next();
    }
  };
  if (dx >= 0 && dy >= 0 && dy < dx) {
    x = x0 + 1;
    walk(dx - dy, dy, () => x < x1, () => x++, PU, () => y++, [PL, PU]);
  } else if (dx > 0 && dy >= 0 && dy >= dx) {
    y = y0 + 1;
    walk(dy - dx, dx, () => y < y1, () => y++, PR, () => x++, [PD, PR]);
  } else if (dx <= 0 && dy >= 0 && dy > -dx) {
    y = y0 + 1;
    walk(dy + dx, -dx, () => y < y1, () => y++, PL, () => x--, [PD, PL]);
  } else if (dx <= 0 && dy > 0 && dy <= -dx) {
    x = x0 - 1;
    walk(-(dx + dy), dy, () => x > x1, () => x--, PU, () => y++, [PR, PU]);
  } else if (dx <= 0 && dy <= 0 && dy > dx) {
    x = x0 - 1;
    walk(dy - dx, -dy, () => x > x1, () => x--, PD, () => y--, [PR, PD]);
  } else if (dx < 0 && dy <= 0 && dy <= dx) {
    y = y0 - 1;
    walk(dx - dy, -dx, () => y > y1, () => y--, PL, () => x--, [PU, PL]);
  } else if (dx >= 0 && dy <= 0 && -dy > dx) {
    y = y0 - 1;
    walk(-(dy + dx), dx, () => y > y1, () => y--, PR, () => x++, [PU, PR]);
  } else if (dx >= 0 && dy < 0 && -dy <= dx) {
    x = x0 + 1;
    walk(dx + dy, -dy, () => x < x1, () => x++, PD, () => y--, [PL, PD]);
  } else {
    P(x0, y0);
    P(x1, y1);
  }
  return out;
}

/**
 * Forest spells' far end (0x02077FE0): `range` cells from the caster toward the tap (Euclidean, in
 * cells), clamped to the map; the caster's own cell when the tap is on it. confirmed
 */
export function forestEnd(cx: number, cy: number, tx: number, ty: number, range: number, W: number, H: number): [number, number] {
  const [nx, ny] = normalize((tx - cx) * 4096, (ty - cy) * 4096);
  const R = range * 4096;
  let px = cx * 4096 + fx12Mul(nx, R);
  let py = cy * 4096 + fx12Mul(ny, R);
  px = Math.min(Math.max(px, 0), (W - 1) * 4096);
  py = Math.min(Math.max(py, 0), (H - 1) * 4096);
  return [px >> 12, py >> 12];
}
