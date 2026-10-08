/**
 * Seeded PRNG (xorshift32). The state lives inside the sim state so it is
 * hashed, snapshotted and replayed like everything else. Never use Math.random.
 */
export interface Rng {
  s: number;
}

export function makeRng(seed: number): Rng {
  const s = seed | 0;
  return { s: s === 0 ? 0x6d2b79f5 : s };
}

/** Next uint32. */
export function nextU32(rng: Rng): number {
  let x = rng.s;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.s = x | 0;
  return x >>> 0;
}

/** Integer in [0, n). Uses rejection sampling so there is no modulo bias. */
export function nextInt(rng: Rng, n: number): number {
  if (n <= 0 || n > 0x100000000) throw new RangeError('nextInt range');
  const limit = 0x100000000 - (0x100000000 % n);
  let v: number;
  do v = nextU32(rng);
  while (v >= limit);
  return v % n;
}
