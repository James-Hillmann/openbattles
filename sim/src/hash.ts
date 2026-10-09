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
    mix(u.moves);
    mix(u.layer);
    mix(u.role);
    mix(u.path.length);
    for (const c of u.path) mix(c);
    for (const v of [u.stance, u.post, u.leg, u.since, u.back, u.rally, u.route.length]) mix(v);
    for (const c of u.route) mix(c);
    if (!w.grid) continue; // bare test worlds have no occupancy or plotters
    mix(u.cell);
    const m = u.mv;
    mix(m ? 1 : 0);
    if (m) {
      for (const v of [m.goal, m.wp, m.blocked, m.wait, m.waitLeft, m.side, m.sideCell, m.astar, m.pathIdx]) mix(v);
      mix(m.align ? 1 : 0);
      mix(m.sideReset ? 1 : 0);
    }
  }
  mix(w.projectiles.length);
  for (const p of w.projectiles) {
    mix(p.id);
    mix(p.owner);
    mix(p.x);
    mix(p.y);
    mix(p.target);
  }
  // Economy state. Mixed only when the world has entity types (the economy is
  // on), so worlds without it keep the hashes they had before it existed.
  if (w.types.length > 0) {
    for (const p of w.players) {
      mix(p.reservedPop);
      mix(p.reservedStars);
    }
    for (const u of w.units) {
      mix(u.role);
      mix(u.size);
      mix(u.buildTime);
      mix(u.progress);
      mix(u.carrying ? 1 : 0);
      mix(u.prod);
      mix(u.payout);
      mix(u.queue.length);
      for (const k of u.queue) mix(k);
      const j = u.job;
      if (!j) mix(0);
      else if (j.kind === 'chop') (mix(1), mix(j.tree), mix(j.timer));
      else if (j.kind === 'deliver') (mix(2), mix(j.tree), mix(j.drop));
      else if (j.kind === 'build') (mix(3), mix(j.site));
      else if (j.kind === 'inside') (mix(4), mix(j.building), mix(j.timer), mix(j.tree));
      else if (j.kind === 'wall') {
        mix(5), mix(j.type), mix(j.i), mix(j.site), mix(j.cells.length);
        for (const c of j.cells) mix(c);
      } else (mix(6), mix(j.type), mix(j.cell));
    }
  }
  if (w.grid) {
    mix(w.grid.width);
    mix(w.grid.height);
    for (const c of w.grid.cells) mix(c);
  }
  if (w.occ) for (const c of w.occ) mix(c);
  mix(w.players.length);
  for (const p of w.players) for (const v of [p.id, p.team, p.bricks, p.status, p.start]) mix(v);
  // Armies only when someone has one, so worlds without them keep their hashes.
  if (w.players.some((p) => p.army)) {
    for (const p of w.players) {
      if (!p.army) {
        mix(-1);
        continue;
      }
      for (const k of p.army.units) mix(k);
      for (let i = 0; i < p.army.base.length; i++) mix(p.army.base.charCodeAt(i));
    }
  }
  mix(w.rules ? w.rules.mode : -1);
  // Bridge sites only on maps that have them, so other worlds keep their hashes.
  for (const b of w.bridgeSites) (mix(b.cell), mix(b.type));
  // Spells: only when a hero is on the field or a spell is running, so other worlds keep their hashes.
  if (w.spells.length > 0 || w.units.some((u) => u.maxCharge > 0)) {
    for (const u of w.units) {
      mix(u.charge);
      mix(u.boost);
      mix(u.grace);
      mix(u.frozen);
      mix(u.tracked);
      for (const b of u.buffs) mix(b);
    }
    mix(w.nextSpell);
    mix(w.spells.length);
    for (const s of w.spells) {
      for (const v of [s.id, s.owner, s.spell, s.cls, s.phase, s.caster, s.target, s.x, s.y, s.start, s.left, s.mode, s.cx, s.cy, s.radius, s.timer, s.dmg, s.dmgStep, s.chance, s.chanceStep, s.ring, s.ringStep, s.idx, s.px, s.py, s.vx, s.vy]) mix(v);
      mix(s.units.length);
      for (const id of s.units) mix(id);
    }
    mix(w.scanQueue.length);
    for (const id of w.scanQueue) mix(id);
  }
  return h >>> 0;
}
