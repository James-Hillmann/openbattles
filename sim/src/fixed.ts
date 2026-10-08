/**
 * Q16.16 fixed-point math. Values are plain JS numbers that always hold an
 * int32, so every operation is exact and identical on every machine.
 *
 * Why not floats: IEEE add/mul are deterministic in JS, but transcendental
 * functions (sin, atan2, ...) and accumulated rounding make cross-browser
 * desyncs easy. The DS itself had no FPU, so the original game used fixed
 * point too, and matching its formats is simpler this way.
 */
export type Fx = number & { readonly __fx: unique symbol };

export const FX_SHIFT = 16;
export const FX_ONE = (1 << FX_SHIFT) as Fx;
export const FX_ZERO = 0 as Fx;

export const fx = (n: number): Fx => ((n | 0) << FX_SHIFT) as Fx;
/** Build from a ratio of integers, e.g. fxRatio(3, 2) === 1.5. */
export const fxRatio = (num: number, den: number): Fx => fxDiv(fx(num), fx(den));
export const fxRaw = (raw: number): Fx => (raw | 0) as Fx;

export const fxAdd = (a: Fx, b: Fx): Fx => ((a + b) | 0) as Fx;
export const fxSub = (a: Fx, b: Fx): Fx => ((a - b) | 0) as Fx;
export const fxNeg = (a: Fx): Fx => (-a | 0) as Fx;

/** a * b. Split b so no intermediate exceeds 2^53. Rounds toward -inf like an ARM asr. */
export function fxMul(a: Fx, b: Fx): Fx {
  const hi = b >> FX_SHIFT;
  const lo = b & 0xffff;
  return ((a * hi + Math.floor((a * lo) / 65536)) | 0) as Fx;
}

/** a / b, truncated toward zero (matches ARM software division). */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) throw new RangeError('fxDiv by zero');
  return (Math.trunc((a * 65536) / b) | 0) as Fx;
}

/** Integer part, truncated toward zero. */
export const fxToInt = (a: Fx): number => Math.trunc(a / 65536);
/** For rendering only. Never feed the result back into the sim. */
export const fxToFloat = (a: Fx): number => a / 65536;

/** Integer square root of a non-negative integer (Newton, exact). */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError('isqrt of negative');
  if (n < 2) return n;
  let x = Math.floor(Math.sqrt(n)); // starting guess only; corrected below
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Length of (dx, dy) in Fx. Exact for short vectors; halves precision as needed for long ones. */
export function fxLen(dx: Fx, dy: Fx): Fx {
  // dx*dx in raw units is 2^32 scale; isqrt brings it back to 2^16 scale.
  // Above 2^53 doubles lose integer precision, so drop low bits first (deterministically).
  let x = Math.abs(dx);
  let y = Math.abs(dy);
  let shift = 0;
  while (x * x + y * y > Number.MAX_SAFE_INTEGER) {
    x >>>= 1;
    y >>>= 1;
    shift++;
  }
  return (isqrt(x * x + y * y) * 2 ** shift) as Fx;
}
