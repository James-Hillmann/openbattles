import type { World } from './state';

/**
 * FNV-1a over every sim field in a fixed order. Clients compare this every
 * HASH_INTERVAL_TICKS; a mismatch means a desync. Add new state fields here.
 */
export function hashWorld(w: World): number {
  let h = 0x811c9dc5;
  const mix = (v: number | null) => {
    let x = v === null ? 0x7fffffff : v | 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  };
  mix(w.tick);
  mix(w.rng.s);
  mix(w.nextId);
  mix(w.units.length);
  for (const u of w.units) {
    mix(u.id);
    mix(u.owner);
    mix(u.x);
    mix(u.y);
    mix(u.tx);
    mix(u.ty);
    mix(u.speed);
    mix(u.kind);
    mix(u.hp);
    mix(u.maxHp);
    mix(u.target);
    mix(u.ordered ? 1 : 0);
    mix(u.lastAttack);
    mix(u.lastHit);
    mix(u.born);
    mix(u.priority);
    mix(u.path.length);
    for (const c of u.path) mix(c);
  }
  mix(w.projectiles.length);
  for (const p of w.projectiles) {
    mix(p.id);
    mix(p.owner);
    mix(p.x);
    mix(p.y);
    mix(p.target);
  }
  if (w.grid) {
    mix(w.grid.width);
    mix(w.grid.height);
    for (const c of w.grid.cells) mix(c);
  }
  return h >>> 0;
}
