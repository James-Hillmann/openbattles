import { SPELL_FX_PICS } from '@lbw/extract';
import { CELL_H, CELL_W, cellOf, fpH, fpW, fxToFloat, isBuilding, type ActiveSpell, type Unit, type World } from '@lbw/sim';

/**
 * The damage spells' own pictures (docs/re-notes/spells.md "Spell effects"): EarthQuake's shake,
 * arrows, cluster bombs, artillery and coconut shells, monkeys, crabs, space lasers, Roar, fireball,
 * lightning, Thunder Hammer and the freeze rings. Drawing only: the client watches the sim's spells
 * and runs each effect's update once per game tick as the game does (effect manager 0x020168B8),
 * with its own random numbers (the game draws these from its RNG; the sim keeps the same draws so
 * lockstep stays in step, but the values only move pictures).
 *
 * Positions are world pixels. A quad is a picture centred on (x, y) unless `topLeft` is set: most
 * of the game's effect quads end up centred on their position (0x02015DE0 subtracts half the
 * previous size), a few (explosions, Roar's puffs, the laser) keep their top-left there. Emulator
 * traces (out/re/trace.py) show which.
 */

/** UIMgrData picture ids the effects draw (extract cuts them from the faction's effects sheet). */
export const FX_PICS = SPELL_FX_PICS;

export interface FxQuad {
  pic: number;
  x: number;
  y: number;
  /** Draw size; the picture's own when left out. */
  w?: number;
  h?: number;
  /** (x, y) is the top-left corner instead of the centre. */
  topLeft?: boolean;
  /** 0..31. */
  alpha: number;
  /** Degrees, clockwise on screen. */
  rot?: number;
  flipX?: boolean;
  /** The game's depth bias (0x02015D9C): bigger is drawn over smaller at the same height. */
  bias: number;
}

/** A small deterministic generator for picture randomness (xorshift32); never touches the sim. */
export class FxRng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  }
  /** 0..n-1, like the game's rand(n). */
  int(n: number): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return n > 0 ? x % n : 0;
  }
}

/** What an effect sees each update. */
export interface FxCtx {
  tick: number;
  rng: FxRng;
  /** A unit's anchor as the game's effects take it: the top-left of its cell box, footprint in cells. */
  unit(id: number): { x: number; y: number; w: number; h: number; role: number } | null;
  spawn(fx: Fx): void;
  /** Whether the hero's cast effect shows the spell picture yet (HeroStartSpellEffect +0x10A). */
  iconShown(spellId: number): boolean;
  /** Free cells of the crabs' shared 4 x 4 grid (0x02151020). */
  crabGrid: Uint8Array;
}

/** One effect object; `update` runs once per game tick and returns true when it is done. */
export abstract class Fx {
  /** The spell ended it (vtable slot 8 on the spell's handle list). */
  ended = false;
  abstract update(c: FxCtx): boolean;
  abstract draw(out: FxQuad[]): void;
  /** EarthQuake's camera shake, 0 for the rest. */
  shake(): number {
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// GenericExplosionEffect (0x02019CAC): five 24 x 24 frames, top-left at its position. A new frame
// every 2 updates (the first shows for 1); drawn while the frame is under 5, gone after 11 updates.

export class Explosion extends Fx {
  private n = 0;
  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly bias = 0,
  ) {
    super();
  }
  update(): boolean {
    return ++this.n >= 11;
  }
  frame(): number {
    return Math.floor(this.n / 2);
  }
  draw(out: FxQuad[]): void {
    const f = this.frame();
    if (f < 5) out.push({ pic: FX_PICS.explosion[f]!, x: this.x, y: this.y, topLeft: true, alpha: 31, bias: this.bias });
  }
}

// ---------------------------------------------------------------------------------------------
// EarthQuakeEffect (0x02015880): no picture. It shakes the camera sideways by a table value for
// 35 updates; three slots (effect id mod 3) are summed and capped at 15 px, and the sign flips
// every tick (negative on even ticks). Far from the view (squared cell distance from the camera's
// centre cell to the hero >= 36) the amount is scaled by 36 / that distance.

/** s16 table at 0x02142F4C, indexed 1..35 (index 0 unused). confirmed */
export const QUAKE_TABLE = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 5, 5, 8, 8, 13, 13, 15, 15, 15, 15, 15, 15, 14, 14, 10, 10, 8, 8, 6, 6, 4, 4, 2, 2, 0];
export const QUAKE_UPDATES = 35;

/** The shake for one quake at step n (1..35), squared cell distance d2 from the view centre. */
export function quakeAmount(n: number, d2: number): number {
  const v = QUAKE_TABLE[n] ?? 0;
  return d2 >= 36 ? Math.trunc((v * 36) / d2) : v;
}

export class EarthQuake extends Fx {
  n = 0;
  amount = 0;
  constructor(
    private readonly hero: number,
    readonly slot: number,
    private readonly view: () => { x: number; y: number },
  ) {
    super();
  }
  update(c: FxCtx): boolean {
    const done = this.n >= QUAKE_UPDATES;
    if (!done) this.n++;
    const h = c.unit(this.hero);
    if (h) {
      const v = this.view();
      const hx = Math.floor(h.x / CELL_W);
      const hy = Math.floor(h.y / CELL_H);
      this.amount = quakeAmount(this.n, (v.x - hx) ** 2 + (v.y - hy) ** 2);
    }
    return done || this.ended;
  }
  draw(): void {}
}

/** Sum of the three quake slots, capped, with the tick's sign. */
export function quakeShake(slots: readonly number[], tick: number): number {
  const s = Math.min(15, slots.reduce((a, b) => a + b, 0));
  return tick & 1 ? s : -s;
}

// ---------------------------------------------------------------------------------------------
// Effects that sit on a unit follow its anchor each update: x + 12 px per footprint cell, the box's
// top (0x0201D7FC and friends); without the unit they stay put.

abstract class OnUnit extends Fx {
  x = 0;
  y = 0;
  constructor(protected readonly target: number, at: { x: number; y: number } | null) {
    super();
    if (at) {
      this.x = at.x;
      this.y = at.y;
    }
  }
  protected follow(c: FxCtx): void {
    const u = c.unit(this.target);
    if (!u) return;
    this.x = u.x + 12 * u.w;
    this.y = u.y;
  }
}

// ArrowVolleyEffect (0x0200EE44): an arrow every 6 updates, 5 in all, each from x = rand(10) - 5,
// y = -(rand(40) + 40). It falls from speed 1, x1.25 an update, until y >= 15, then sticks (the
// 8 x 8 picture, same top-left) and fades: alpha 31, 15, 7, 3, 1, gone. Depth bias 50.
interface Arrow {
  x: number;
  y: number;
  v: number;
  alpha: number;
  stuck: boolean;
}

export class ArrowVolley extends OnUnit {
  private n = 0;
  private made = 0;
  private arrows: Arrow[] = [];
  update(c: FxCtx): boolean {
    if (this.target) this.follow(c);
    if (!this.ended && this.made < 5 && this.n % 6 === 0) {
      this.arrows.push({ x: c.rng.int(10) - 5, y: -(c.rng.int(40) + 40), v: 1, alpha: 31, stuck: false });
      this.made++;
    }
    this.n++;
    for (const a of this.arrows) {
      if (a.stuck) a.alpha >>= 1;
      else {
        a.y += a.v;
        a.v *= 1.25;
        if (a.y >= 15) a.stuck = true;
      }
    }
    this.arrows = this.arrows.filter((a) => a.alpha > 0);
    return this.arrows.length === 0 && (this.made >= 5 || this.ended);
  }
  draw(out: FxQuad[]): void {
    for (const a of this.arrows) {
      if (a.stuck) out.push({ pic: FX_PICS.arrowStuck, x: this.x + a.x, y: this.y + a.y - 4, alpha: a.alpha, bias: 50 });
      else out.push({ pic: FX_PICS.arrowFall, x: this.x + a.x, y: this.y + a.y, alpha: 31, bias: 50 });
    }
  }
}

// ClusterBombEffect (0x02012338): a bomb drops from 64 px up, speed 1 x1.15 an update, blinking
// (a counter from 11 down; shown on odd values). When it lands (y > 0) it goes, and on the next
// counter 7, 5, 3, 1 an explosion bursts within +-20 px. Bomb depth bias 200.
export class ClusterBomb extends Fx {
  private y = -64;
  private v = 1;
  private blink = 11;
  private boom = -1;
  constructor(
    private readonly x: number,
    private readonly y0: number,
  ) {
    super();
  }
  update(c: FxCtx): boolean {
    if (this.boom < 0) {
      this.y += this.v;
      this.v *= 1.15;
      this.blink--;
      if (this.y > 0) this.boom = 7;
      return false;
    }
    if (this.boom & 1) c.spawn(new Explosion(this.x + c.rng.int(41) - 20, this.y0 + c.rng.int(41) - 20));
    return --this.boom <= 0;
  }
  draw(out: FxQuad[]): void {
    if (this.boom < 0 && (this.blink < 1 || this.blink & 1)) out.push({ pic: FX_PICS.bomb, x: this.x, y: this.y0 + this.y, alpha: 31, bias: 200 });
  }
}

// ---------------------------------------------------------------------------------------------
// Artillery (0x0200FB88) and Coconut Storm (0x02012CC4): an effect on the hero lobs shells along a
// quadratic curve. It waits until the hero's cast effect shows the spell picture.
// Shell path (0x0200FC80 on): E = target - start; the control point is E/2 pushed sideways by
// r * (Ey, -Ex) toward the sky (mirrored when the target is to the left), r = rand(0x800) + 0x800
// in 20.12 (0.5 to 1); artillery only bends shots longer than 30 px that aren't steeply upward.
// t goes 0 to 1 in n steps.

export interface Shot {
  ex: number;
  ey: number;
  cx: number;
  cy: number;
  n: number;
  k: number;
}

/** Point on the shell's curve at step k of n, relative to its start. */
export function shotAt(s: Shot, k: number): { x: number; y: number } {
  const t = Math.min(1, k / s.n);
  return { x: 2 * t * (1 - t) * s.cx + t * t * s.ex, y: 2 * t * (1 - t) * s.cy + t * t * s.ey };
}

/** Artillery flight steps: max(7, 30 * min(1, (len / 128)^2)). */
export function artilleryFlight(len: number): number {
  return Math.max(7, Math.floor(30 * Math.min(1, (len / 128) ** 2)));
}

function aim(ex: number, ey: number, r: number, bend: boolean): Shot {
  let cx = ex / 2;
  let cy = ey / 2;
  if (bend) {
    const left = ex < 0;
    cx += (left ? -ey : ey) * r;
    cy += (left ? ex : -ex) * r;
  }
  return { ex, ey, cx, cy, n: 1, k: 0 };
}

abstract class Lobber extends Fx {
  x = 0;
  y = 0;
  protected started = false;
  protected wait = 0;
  protected shots: Shot[] = [];
  constructor(
    protected readonly hero: number,
    protected readonly spell: number,
    protected readonly at: () => { x: number; y: number },
  ) {
    super();
  }
  /** On the hero: its box's centre column, 15 px left or 5 px right toward the target, raised H/15. */
  protected follow(c: FxCtx): void {
    const h = c.unit(this.hero);
    if (!h) return;
    const sw = 24; // sprite width and height, minifigure heroes (entity record +0x1E / +0x1F tiles x 8)
    this.x = h.x + sw / 2;
    this.x += this.at().x < this.x ? -15 : 5;
    this.y = h.y - sw / 15;
  }
}

export class Artillery extends Lobber {
  update(c: FxCtx): boolean {
    this.follow(c);
    if (!this.started) {
      if (!c.iconShown(this.spell)) return this.ended;
      this.started = true;
    }
    for (const s of this.shots) {
      if (++s.k >= s.n) c.spawn(new Explosion(this.x + s.ex, this.y + s.ey, 200));
    }
    this.shots = this.shots.filter((s) => s.k < s.n);
    if (!this.ended && this.wait-- === 0) {
      c.spawn(new Explosion(this.x, this.y, 200));
      const t = this.at();
      const ex = t.x - this.x;
      const ey = t.y - this.y;
      const len = Math.hypot(ex, ey);
      const r = (c.rng.int(0x800) + 0x800) / 4096;
      // Steeply up (|dx| / |dy| under tan 30) shoots straight.
      const steep = ey < 0 && Math.abs(ex) < Math.abs(ey) * 0.577;
      const s = aim(ex, ey, r, len > 30 && !steep);
      s.n = artilleryFlight(len);
      this.shots.push(s);
      this.wait = Math.min(s.n, 10);
    }
    return this.ended && this.shots.length === 0;
  }
  draw(out: FxQuad[]): void {
    for (const s of this.shots) {
      const p = shotAt(s, s.k);
      out.push({ pic: FX_PICS.shell, x: this.x + p.x, y: this.y + p.y, alpha: 31, bias: 200 });
    }
  }
}

/** Coconut flight steps and the landing pictures (one an update). */
const COCONUT_FLIGHT = 20;

export class Coconut extends Lobber {
  private landed: { x: number; y: number; f: number }[] = [];
  update(c: FxCtx): boolean {
    this.follow(c);
    if (!this.started) {
      if (!c.iconShown(this.spell)) return this.ended;
      this.started = true;
    }
    for (const l of this.landed) l.f++;
    this.landed = this.landed.filter((l) => l.f < 6);
    for (const s of this.shots) {
      if (++s.k >= s.n) this.landed.push({ x: this.x + s.ex, y: this.y + s.ey, f: 1 });
    }
    this.shots = this.shots.filter((s) => s.k < s.n);
    if (!this.ended && this.wait-- === 0) {
      this.wait = 10;
      const t = this.at();
      const ex = t.x + c.rng.int(21) - 10 - this.x;
      const ey = t.y + c.rng.int(21) - 10 - this.y;
      const s = aim(ex, ey, (c.rng.int(0x800) + 0x800) / 4096, true);
      s.n = COCONUT_FLIGHT;
      this.shots.push(s);
    }
    return this.ended && this.shots.length === 0 && this.landed.length === 0;
  }
  draw(out: FxQuad[]): void {
    for (const s of this.shots) {
      const p = shotAt(s, s.k);
      out.push({ pic: FX_PICS.coconut[0], x: this.x + p.x, y: this.y + p.y, alpha: 31, bias: 200 });
    }
    for (const l of this.landed) out.push({ pic: FX_PICS.coconut[l.f]!, x: l.x, y: l.y, alpha: 31, bias: 200 });
  }
}

// ---------------------------------------------------------------------------------------------
// MonkeySwarmEffect (0x0201D7FC), one per enemy joining spell 20: two monkeys 11-20 px left and
// right of the unit drop from 20-39 px up (speed 1 x1.15 until y >= 15), flickering between alpha 31
// and 15; then they sit, swapping pictures every 3 updates. When the spell ends each turns to a
// puff for 5 updates and the last explosion frame for 5. Depth bias 40.

interface Monkey {
  x: number;
  y: number;
  v: number;
  sat: boolean;
}

export class MonkeySwarm extends OnUnit {
  private n = 0;
  private gone = -1;
  private monkeys: Monkey[] = [];
  update(c: FxCtx): boolean {
    this.follow(c);
    if (this.n === 0) {
      this.monkeys = [
        { x: -(c.rng.int(10) + 11), y: -(c.rng.int(20) + 20), v: 1, sat: false },
        { x: c.rng.int(10) + 11, y: -(c.rng.int(20) + 20), v: 1, sat: false },
      ];
    }
    this.n++;
    for (const m of this.monkeys) {
      if (m.sat) continue;
      m.y += m.v;
      m.v *= 1.15;
      if (m.y >= 15) {
        m.y = 15;
        m.sat = true;
      }
    }
    if (this.ended && this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone++;
    return this.gone > 10;
  }
  draw(out: FxQuad[]): void {
    for (const m of this.monkeys) {
      const at = { x: this.x + m.x, y: this.y + m.y, bias: 40 };
      if (this.gone > 5) out.push({ ...at, pic: FX_PICS.explosion[4], alpha: 31 });
      else if (this.gone > 0) out.push({ ...at, pic: FX_PICS.monkeyPuff, alpha: 31 });
      else if (!m.sat) out.push({ ...at, pic: FX_PICS.monkey[0], alpha: (5 - this.n) & 1 ? 31 : 15 });
      else out.push({ ...at, pic: FX_PICS.monkey[Math.floor(this.n / 3) & 1]!, alpha: 31 });
    }
  }
}

// CrabSwarmEffect (0x02013B88), one per enemy joining spell 21: up to 4 crabs, one an update, each
// in a free cell of a 4 x 4 grid shared by every crab swarm (x = -12 + 12 col, y = -8 + 8 row;
// 16 tries, else (36, 24)). A crab climbs out over 9 updates (its picture squashed to k px high
// while it rises 1 px an update, a dust cloud flickering 4 px above), then turns about every
// 3 updates. When the spell ends it climbs back in.

interface Crab {
  x: number;
  y: number;
  cell: number;
  k: number;
  state: 0 | 1 | 2;
  n: number;
  /** Where it started climbing; the dust stays there. */
  y0: number;
}

export class CrabSwarm extends OnUnit {
  private crabs: Crab[] = [];
  private made = 0;
  update(c: FxCtx): boolean {
    this.follow(c);
    if (!this.ended && this.made < 4) {
      this.made++;
      let cell = -1;
      for (let i = 0; i < 16; i++) {
        const col = c.rng.int(4);
        const row = c.rng.int(4);
        if (!c.crabGrid[row * 4 + col]) {
          cell = row * 4 + col;
          break;
        }
      }
      const col = cell < 0 ? 4 : cell % 4;
      const row = cell < 0 ? 4 : cell >> 2;
      if (cell >= 0) c.crabGrid[cell] = 1;
      this.crabs.push({ x: -12 + 12 * col, y: -8 + 8 * row, cell, k: 0, state: 0, n: 0, y0: -8 + 8 * row });
    }
    for (const k of this.crabs) {
      if (this.ended && k.state === 1) k.state = 2;
      k.n++;
      if (k.state === 0) {
        if (k.k <= 8) {
          k.k++;
          k.y -= 1;
        } else k.state = 1;
      } else if (k.state === 2) {
        k.k--;
        k.y += 1;
      }
    }
    for (const k of this.crabs) if (k.state === 2 && k.k <= 0 && k.cell >= 0) c.crabGrid[k.cell] = 0;
    this.crabs = this.crabs.filter((k) => !(k.state === 2 && k.k <= 0));
    if (this.ended) for (const k of this.crabs) if (k.state === 0) k.state = 2;
    return this.ended && this.crabs.length === 0;
  }
  /** Free the shared grid when the effect is dropped early. */
  release(c: FxCtx): void {
    for (const k of this.crabs) if (k.cell >= 0) c.crabGrid[k.cell] = 0;
  }
  draw(out: FxQuad[]): void {
    for (const k of this.crabs) {
      const x = this.x + k.x;
      if (k.state === 1) out.push({ pic: FX_PICS.crab, x, y: this.y + k.y, alpha: 31, bias: 0, flipX: Math.floor(k.n / 3) % 2 === 1 });
      else {
        out.push({ pic: FX_PICS.crab, x, y: this.y + k.y, h: Math.max(1, k.k), alpha: 31, bias: 0 });
        out.push({ pic: FX_PICS.crabDust[k.n & 1]!, x, y: this.y + k.y0 - 4, alpha: 31, bias: 0 });
      }
    }
  }
}

// SpaceLaserEffect (0x0201F45C), one per enemy joining spell 28: a beam of 7 segments falls on the
// unit, segment i (top-left 56 - 8i px above) starting i updates in and playing frames 0..min(i, 3);
// from update 7 the impact (15 x 15, top-left 2 px left and 4 px up) loops 3 frames. After 70
// updates, or when the spell ends, everything fades by 4 alpha an update: segment i goes after
// 8 - i fading updates, the impact after 1. Depth bias 200 (beam), 220 (impact).
export const LASER_TIME = 70;

export class SpaceLaser extends OnUnit {
  private n = 0;
  private fade = 0;
  update(c: FxCtx): boolean {
    this.follow(c);
    this.n++;
    if (this.fade > 0 || this.ended || this.n > LASER_TIME) this.fade++;
    return this.fade >= 8;
  }
  draw(out: FxQuad[]): void {
    const alpha = this.fade > 0 ? 31 - 4 * this.fade : 31;
    for (let i = 0; i < 7; i++) {
      const age = this.n - 1 - i;
      if (age < 0 || (this.fade > 0 && this.fade >= 8 - i)) continue;
      out.push({ pic: FX_PICS.laser[Math.min(age, i, 3)]!, x: this.x, y: this.y - 56 + 8 * i, topLeft: true, alpha, bias: 200 });
    }
    if (this.n > 7 && this.fade < 1) out.push({ pic: FX_PICS.laserHit[(this.n - 8) % 3]!, x: this.x - 2, y: this.y - 4, w: 15, h: 15, topLeft: true, alpha, bias: 220 });
  }
}

// RoarEffect (0x0201E704): on the hero (the middle of its box), once the cast effect shows the
// spell picture. Rings of puffs spread out: 5 on the axes (radius 25 + 15k px, starting 8 + k
// updates in) and 6 on the diagonals at 26.5 degrees off the x axis (radius 25 + 15k, 12 + k in).
// Each puff plays 7 frames, one an update, top-left on its spot. Depth bias 240.
interface Puff {
  dx: number;
  dy: number;
  f: number;
}

const ROAR_AXES = [0, 90, 180, 270];
const ROAR_DIAGONALS = [26.5, 153.5, 206.5, 333.5];

export function roarPuffs(): Puff[] {
  const puffs: Puff[] = [];
  const ring = (angles: number[], count: number, wait: number) => {
    for (let k = 0; k < count; k++)
      for (const a of angles) {
        const t = (a * Math.PI) / 180;
        const r = 25 + 15 * k;
        puffs.push({ dx: Math.round(r * Math.cos(t)), dy: Math.round(r * Math.sin(t)), f: -wait - k });
      }
  };
  ring(ROAR_AXES, 5, 8);
  ring(ROAR_DIAGONALS, 6, 12);
  return puffs;
}

export class Roar extends Fx {
  private x = 0;
  private y = 0;
  private started = false;
  private puffs = roarPuffs();
  constructor(
    private readonly hero: number,
    private readonly spell: number,
  ) {
    super();
  }
  update(c: FxCtx): boolean {
    const h = c.unit(this.hero);
    if (h) {
      this.x = h.x + 12 * h.w;
      this.y = h.y + 8 * h.h;
    }
    if (!this.started) {
      if (!c.iconShown(this.spell)) return this.ended;
      this.started = true;
    }
    for (const p of this.puffs) p.f++;
    return this.puffs.every((p) => p.f >= 7);
  }
  draw(out: FxQuad[]): void {
    for (const p of this.puffs) if (p.f >= 0 && p.f < 7) out.push({ pic: FX_PICS.roar[p.f]!, x: this.x + p.dx, y: this.y + p.dy, w: 15, h: 15, topLeft: true, alpha: 31, bias: 240 });
  }
}

// ---------------------------------------------------------------------------------------------
// Pieces thrown out of an impact (FireBall and ThunderHammer fragments, the freeze rings' flakes):
// a straight line from start to target in `life` updates.

interface Flyer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number;
}

function flyer(x: number, y: number, tx: number, ty: number, life: number): Flyer {
  return { x, y, vx: (tx - x) / life, vy: (ty - y) / life, left: life };
}

/** Where a projectile spell's projectile is, in world pixels (its 20.12 position). */
export function projectilePx(s: { px: number; py: number }): { x: number; y: number } {
  return { x: s.px / 4096, y: s.py / 4096 };
}

/** Six pieces at 0, 60 .. 300 degrees flying out R cells (24 x 16 px a cell) in 30 updates. */
export function fragments(x: number, y: number, r: number, start: number): Flyer[] {
  const out: Flyer[] = [];
  for (let k = 0; k < 6; k++) {
    const t = (k * 60 * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push(flyer(x + start * c, y + start * s, x + 24 * r * c, y + 16 * r * s, 30));
  }
  return out;
}

// FireBallEffect (0x2E): five trail particles made on its first five updates; particle k plays
// frames 0..k and holds there, the head (k = 4) plays 0..8 and loops 3..8 (depth 220, the rest 200).
// Every particle is a 15 x 15 quad (the scale the game also keeps, 0.6 to 0.7 at 0x02151088, doesn't
// change the quad's size in the emulator trace). They sit ahead of the fireball along its velocity by
// v * FIREBALL_LEAD[age] (fitted to the emulator trace: likely). At impact an explosion goes off
// 16 px right and 8 px below, and 3 updates later six more fireballs, trails and all, fly out record
// 34's radius in 30 updates (no explosion at their end).

export const FIREBALL_LEAD = [0.25, 0.5, 1.25, 2, 2.5, 2.5, 2.5, 2.75];

interface Ember {
  k: number;
  age: number;
  frame: number;
}

/** A fireball and its trail; `move` once per update with where it is now. */
class FireTrail {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  private embers: Ember[] = [];
  move(x: number, y: number): void {
    if (this.embers.length) {
      this.vx = x - this.x;
      this.vy = y - this.y;
    }
    this.x = x;
    this.y = y;
    for (const e of this.embers) {
      e.age++;
      if (e.k === 4) e.frame = e.frame >= 8 ? 3 : e.frame + 1;
      else if (e.frame < e.k) e.frame++;
    }
    if (this.embers.length < 5) this.embers.push({ k: this.embers.length, age: 0, frame: 0 });
  }
  draw(out: FxQuad[]): void {
    for (const e of this.embers) {
      const lead = FIREBALL_LEAD[Math.min(e.age, FIREBALL_LEAD.length - 1)]!;
      out.push({ pic: FX_PICS.fireball[e.frame]!, x: this.x + this.vx * lead, y: this.y + this.vy * lead, w: 15, h: 15, alpha: 31, bias: e.k === 4 ? 220 : 200 });
    }
  }
}

export class FireBall extends Fx {
  private head: FireTrail | null = new FireTrail();
  private x = 0;
  private y = 0;
  private pieces: (Flyer & { trail: FireTrail })[] = [];
  private landed = -1;
  constructor(
    private readonly where: () => { x: number; y: number; phase: number } | null,
    private readonly radius: number,
  ) {
    super();
  }
  update(c: FxCtx): boolean {
    const p = this.where();
    if (this.landed < 0) {
      if (p && p.phase === 0) return false; // launched on the spell's first update
      if (p && p.phase === 1) {
        this.x = p.x;
        this.y = p.y;
        this.head!.move(p.x, p.y);
        return false;
      }
      // Landed (phase 2) or fizzled (3), or the spell is gone.
      this.landed = 0;
      this.head = null;
      c.spawn(new Explosion(this.x + 16, this.y + 8));
      if (!p || p.phase !== 2) return true;
    }
    this.landed++;
    if (this.landed === 3) this.pieces = fragments(this.x, this.y, this.radius, 0).map((f) => ({ ...f, trail: new FireTrail() }));
    for (const f of this.pieces) {
      if (f.left <= 0) continue;
      f.trail.move(f.x, f.y);
      f.x += f.vx;
      f.y += f.vy;
      f.left--;
    }
    return this.landed > 3 && this.pieces.every((f) => f.left <= 0);
  }
  draw(out: FxQuad[]): void {
    this.head?.draw(out);
    for (const f of this.pieces) if (f.left > 0) f.trail.draw(out);
  }
}

// LightningBoltEffect (0x1E, made by 0x02079C88 when the spell strikes): 8 bolts from the hero's
// cell corner to cells R = spell 15's range away at 0, 45 .. 315 degrees clockwise from up
// (cell offset floor(R sin), floor(-R cos)), in 30 updates; then 4 more updates moving while the
// 16 x 16 quad halves in size and alpha, then an explosion with its top-left on the bolt. The quad's
// top-left is 8 px right of the bolt. Up/down bolts use 0x4D6, sideways ones 0x4D6 turned 90
// degrees, diagonals 0x4D8 (flipped for up-right / down-left). Depth bias 200.

/** Cell offsets of the 8 bolts for range r. */
export function boltOffsets(r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const t = (i * 45 * Math.PI) / 180;
    out.push([Math.floor(r * Math.sin(t)) + 0, Math.floor(-r * Math.cos(t)) + 0]); // + 0 turns -0 into 0
  }
  return out;
}

export class LightningBolt extends Fx {
  private n = 0;
  private x: number;
  private y: number;
  private readonly vx: number;
  private readonly vy: number;
  constructor(
    private readonly dir: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    super();
    this.x = from.x;
    this.y = from.y;
    this.vx = (to.x - from.x) / 30;
    this.vy = (to.y - from.y) / 30;
  }
  update(c: FxCtx): boolean {
    this.n++;
    if (this.n <= 34) {
      this.x += this.vx;
      this.y += this.vy;
      return false;
    }
    c.spawn(new Explosion(this.x, this.y));
    return true;
  }
  draw(out: FxQuad[]): void {
    if (this.n > 34) return;
    const shrink = Math.max(0, this.n - 30);
    const size = 16 >> shrink;
    const alpha = 31 >> shrink;
    const d = this.dir % 4;
    const turned = d === 2;
    const diagonal = d === 1 || d === 3;
    // Top-left 8 px right of the bolt, kept there as the quad shrinks; turned bolts turn that offset too.
    const ox = turned ? -size / 2 : 8 + size / 2;
    const oy = turned ? 8 + size / 2 : size / 2;
    out.push({
      pic: diagonal ? FX_PICS.bolt[2] : FX_PICS.bolt[0],
      x: this.x + ox, y: this.y + oy, w: size, h: size, alpha, bias: 200,
      ...(turned ? { rot: 90 } : {}),
      ...(d === 1 ? { flipX: true } : {}),
    });
  }
}

// ThunderHammerEffect (0x1F): a 24 x 24 hammer on the projectile, its picture swapping every update
// and turning 90 degrees every 2 (starting at 90 * rand(8)); an explosion where it stops. 6 updates
// after a real impact (not a fizzle) six more hammers fly out 10 px from it to record 16's radius
// in 30 updates, each ending in an explosion. Depth bias 200.

interface Spinner {
  n: number;
  rot: number;
}

function spin(s: Spinner): void {
  s.n++;
  if (s.n % 2 === 0) s.rot = (s.rot + 90) % 360;
}

function hammerQuad(s: Spinner, x: number, y: number): FxQuad {
  return { pic: FX_PICS.hammer[s.n & 1]!, x, y, alpha: 31, rot: s.rot, bias: 200 };
}

export class ThunderHammer extends Fx {
  x = 0;
  y = 0;
  private flying = false;
  private head: Spinner | null = null;
  private landed = -1;
  private pieces: (Flyer & Spinner)[] = [];
  constructor(
    private readonly where: () => { x: number; y: number; phase: number } | null,
    private readonly radius: number,
  ) {
    super();
  }
  update(c: FxCtx): boolean {
    const p = this.where();
    if (this.landed < 0) {
      if (p && p.phase === 0) return false; // launched on the spell's first update
      if (p && p.phase === 1) {
        this.x = p.x;
        this.y = p.y;
        if (!this.head) this.head = { n: 0, rot: 90 * c.rng.int(8) };
        else spin(this.head);
        this.flying = true;
        return false;
      }
      this.landed = 0;
      if (this.flying) c.spawn(new Explosion(this.x, this.y));
      this.head = null;
      if (!p || p.phase !== 2) return true;
    }
    this.landed++;
    if (this.landed === 6) this.pieces = fragments(this.x, this.y, this.radius, 10).map((f) => ({ ...f, n: 0, rot: 90 * c.rng.int(8) }));
    for (const f of this.pieces) {
      if (f.left <= 0) continue;
      f.x += f.vx;
      f.y += f.vy;
      spin(f);
      if (--f.left === 0) c.spawn(new Explosion(f.x, f.y));
    }
    return this.landed > 6 && this.pieces.every((f) => f.left <= 0);
  }
  draw(out: FxQuad[]): void {
    if (this.head) out.push(hammerQuad(this.head, this.x, this.y));
    for (const f of this.pieces) if (f.left > 0) out.push(hammerQuad(f, f.x, f.y));
  }
}

// EAttackEffect (0x25 for spell 27, 0x27 for 29): from the spot's cell corner 8 flakes fly out at
// 45-degree steps, each b7 cells (24 x 16 px a cell) in D = the record's time updates, turning
// 90 degrees every other update; drawn where they were before the move. Depth bias 0.
export class EAttack extends Fx {
  private flakes: Flyer[] = [];
  private n = 0;
  constructor(
    x: number,
    y: number,
    private readonly pic: number,
    cells: number,
    life: number,
  ) {
    super();
    for (let k = 0; k < 8; k++) {
      const t = (k * 45 * Math.PI) / 180;
      this.flakes.push(flyer(x, y, x + 24 * cells * Math.cos(t), y + 16 * cells * Math.sin(t), Math.max(1, life)));
    }
  }
  private drawn: { x: number; y: number }[] = [];
  update(): boolean {
    this.n++;
    this.drawn = this.flakes.map((f) => ({ x: f.x, y: f.y }));
    for (const f of this.flakes) {
      f.x += f.vx;
      f.y += f.vy;
      f.left--;
    }
    return this.flakes[0]!.left < 0 || this.ended;
  }
  draw(out: FxQuad[]): void {
    const rot = (Math.floor(this.n / 2) * 90) % 360;
    for (const d of this.drawn) out.push({ pic: this.pic, x: d.x, y: d.y, w: 15, h: 15, alpha: 31, rot, bias: 0 });
  }
}

// ---------------------------------------------------------------------------------------------
// Which spell makes which effect, and when (each spell class's start, update and member-join code).

const C_DAMAGE = 3;
const C_FREEZE = 4;
const C_LIGHTNING = 5;
const C_FIREBALL = 10;
const C_HAMMER = 11;
const FIREBALL_DAMAGE = 34;
const HAMMER_DAMAGE = 16;
const LIGHTNING_SPELL = 15;

/** A buff's count went up on a unit: SpellIncreaseEffect plays on it from `tick` (0x0205F6A0). */
export interface BuffBurst {
  unit: number;
  tick: number;
}

interface Tracked {
  /** Effects tied to the whole spell. */
  own: Fx[];
  /** Effects on each member unit. */
  members: Map<number, Fx>;
  phase: number;
}

/** The game corner of a unit's box (our position is its cell's centre) and its footprint. */
export function unitCorner(u: Unit): { x: number; y: number; w: number; h: number; role: number } {
  if (isBuilding(u)) {
    const [cx, cy] = cellOf(u.x, u.y);
    return { x: cx * CELL_W, y: cy * CELL_H, w: fpW(u.size), h: fpH(u.size), role: u.role };
  }
  return { x: fxToFloat(u.x) - CELL_W / 2, y: fxToFloat(u.y) - CELL_H / 2, w: fpW(u.size), h: fpH(u.size), role: u.role };
}

export class SpellAnims {
  private fxs: Fx[] = [];
  private readonly spells = new Map<number, Tracked>();
  private readonly rng: FxRng;
  private readonly crabGrid = new Uint8Array(16);
  private quakes = 0;
  private world: World | null = null;
  private units = new Map<number, Unit>();
  private readonly buffCounts = new Map<number, number[]>();

  constructor(seed = 1) {
    this.rng = new FxRng(seed);
  }

  /**
   * Run one game tick, after the sim's. `view` is the cell at the middle of the screen (for the
   * quake's fall-off); `iconShown` says whether a spell's hero effect shows its picture yet.
   * Returns the buff bursts that start this tick.
   */
  tick(w: World, view: { x: number; y: number }, iconShown: (spellId: number) => boolean): BuffBurst[] {
    this.world = w;
    this.units = new Map(w.units.map((u) => [u.id, u]));
    const ctx: FxCtx = {
      tick: w.tick,
      rng: this.rng,
      unit: (id) => {
        const u = this.units.get(id);
        return u && u.hp > 0 ? unitCorner(u) : null;
      },
      spawn: (fx) => this.fxs.push(fx),
      iconShown,
      crabGrid: this.crabGrid,
    };
    const live = new Set<number>();
    for (const s of w.spells) {
      live.add(s.id);
      let t = this.spells.get(s.id);
      if (!t) {
        t = { own: [], members: new Map(), phase: -1 };
        this.spells.set(s.id, t);
        for (const fx of this.started(s, w, view)) this.add(t.own, fx);
      }
      if (s.cls === C_LIGHTNING && t.phase === 0 && s.phase === 1) for (const fx of this.bolts(s, w)) this.add(t.own, fx);
      t.phase = s.phase;
      this.joins(s, t);
    }
    for (const [id, t] of this.spells) {
      if (live.has(id)) continue;
      for (const fx of [...t.own, ...t.members.values()]) fx.ended = true;
      this.spells.delete(id);
    }
    const done = new Set<Fx>();
    for (const fx of [...this.fxs]) {
      if (fx.update(ctx)) done.add(fx);
    }
    for (const fx of done) if (fx instanceof CrabSwarm) fx.release(ctx);
    this.fxs = this.fxs.filter((fx) => !done.has(fx));
    return this.buffs(w);
  }

  private add(list: Fx[], fx: Fx): void {
    list.push(fx);
    this.fxs.push(fx);
  }

  /** The effects a spell makes when it starts. */
  private started(s: ActiveSpell, w: World, view: { x: number; y: number }): Fx[] {
    const corner = { x: s.cx * CELL_W, y: s.cy * CELL_H };
    const spot = () => ({ x: fxToFloat(s.x), y: fxToFloat(s.y) });
    const def = w.spellDefs[s.spell];
    if (s.cls === C_DAMAGE) {
      switch (s.spell) {
        case 13:
          return [new EarthQuake(s.caster, this.quakes++ % 3, () => view)];
        case 18:
          return [new Roar(s.caster, s.id)];
        case 22: {
          const at = () => {
            const u = this.units.get(s.target);
            return u && u.hp > 0 ? { x: fxToFloat(u.x), y: fxToFloat(u.y) } : spot();
          };
          return [new Coconut(s.caster, s.id, at)];
        }
        case 23:
          return [new Artillery(s.caster, s.id, spot)];
        case 25:
          return [new ArrowVolley(0, corner)];
        case 31: {
          const n = this.rng.int(2) + 1;
          const out: Fx[] = [];
          for (let i = 0; i < n; i++) out.push(new ClusterBomb(corner.x + this.rng.int(61) - 30, corner.y + this.rng.int(61) - 30));
          return out;
        }
      }
      return [];
    }
    if (s.cls === C_FREEZE && def) return [new EAttack(corner.x, corner.y, s.spell === 27 ? FX_PICS.freezeVehicle : FX_PICS.freezeMinifig, def.b7, def.time)];
    const where = () => {
      const now = this.world?.spells.find((x) => x.id === s.id);
      return now ? { ...projectilePx(now), phase: now.phase } : null;
    };
    if (s.cls === C_FIREBALL) return [new FireBall(where, w.spellDefs[FIREBALL_DAMAGE]?.b7 ?? 5)];
    if (s.cls === C_HAMMER) return [new ThunderHammer(where, w.spellDefs[HAMMER_DAMAGE]?.b7 ?? 5)];
    return [];
  }

  /** Lightning's 8 bolts when it strikes, from the hero's cell corner (targets kept on the map). */
  private bolts(s: ActiveSpell, w: World): Fx[] {
    const hero = this.units.get(s.caster);
    if (!hero) return [];
    const [hx, hy] = cellOf(hero.x, hero.y);
    const r = w.spellDefs[LIGHTNING_SPELL]?.range ?? 10;
    const gw = w.grid?.width ?? Infinity;
    const gh = w.grid?.height ?? Infinity;
    return boltOffsets(r).map(([dx, dy], i) => {
      const tx = Math.max(0, Math.min(gw - 1, hx + dx));
      const ty = Math.max(0, Math.min(gh - 1, hy + dy));
      return new LightningBolt(i, { x: hx * CELL_W, y: hy * CELL_H }, { x: tx * CELL_W, y: ty * CELL_H });
    });
  }

  /** Per-member effects: one for each unit that joins, ended when it leaves. */
  private joins(s: ActiveSpell, t: Tracked): void {
    if (s.cls !== C_DAMAGE) return;
    const make = (id: number): Fx | null => {
      const u = this.units.get(id);
      const at = u ? unitCorner(u) : null;
      const p = at && { x: at.x + 12 * at.w, y: at.y };
      switch (s.spell) {
        case 20:
          return new MonkeySwarm(id, p);
        case 21:
          return new CrabSwarm(id, p);
        case 25:
          return new ArrowVolley(id, p);
        case 28:
          return new SpaceLaser(id, p);
      }
      return null;
    };
    const now = new Set(s.units.filter((id) => id !== 0));
    for (const id of now) {
      if (t.members.has(id)) continue;
      const fx = make(id);
      if (!fx) continue;
      t.members.set(id, fx);
      this.fxs.push(fx);
    }
    for (const [id, fx] of t.members) {
      if (now.has(id)) continue;
      fx.ended = true;
      t.members.delete(id);
    }
  }

  /** A burst for each unit with more of some buff than last tick (0x0205D06C compares the counts). */
  private buffs(w: World): BuffBurst[] {
    const out: BuffBurst[] = [];
    for (const u of w.units) {
      const before = this.buffCounts.get(u.id) ?? [];
      if (u.buffs.some((n, i) => n > (before[i] ?? 0))) out.push({ unit: u.id, tick: w.tick });
      if (u.buffs.some((n) => n > 0)) this.buffCounts.set(u.id, [...u.buffs]);
      else this.buffCounts.delete(u.id);
    }
    for (const id of this.buffCounts.keys()) if (!this.units.has(id)) this.buffCounts.delete(id);
    return out;
  }

  /** Every quad to draw now. */
  quads(): FxQuad[] {
    const out: FxQuad[] = [];
    for (const fx of this.fxs) fx.draw(out);
    return out;
  }

  /** The camera's sideways shake this tick, in pixels. */
  shake(tick: number): number {
    const slots = [0, 0, 0];
    for (const fx of this.fxs) if (fx instanceof EarthQuake) slots[fx.slot]! += fx.amount;
    return quakeShake(slots, tick);
  }

  get count(): number {
    return this.fxs.length;
  }
}
