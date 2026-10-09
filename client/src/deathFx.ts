import type { ParticleAnim, ParticleFx } from '@lbw/extract';
import { drawParticle, type ParticleSprite } from './siteFx';

/**
 * Death effects, traced in docs/re-notes/death.md (DieEntityCommand, 0x0206A2F4). Drawing only:
 * the random dust offsets use Math.random and never reach the sim.
 *
 * The command counts a timer down from 7 ticks (250 ms at 30 Hz) and, by the dead thing's role:
 * - a unit (roles 0-6): LegoSmallStudDestroy at the unit, at timer 7 and 5 (confirmed from code);
 * - a building (roles 7-19): DustConstruction at a random x across the footprint at timer 4 and 0,
 *   and LegoStudDestroy at the middle of the footprint at timer 1 (confirmed from code; where
 *   exactly the anchors sit on the footprint is likely, not lined up with the emulator).
 */

/** Where the dead thing stood, in world pixels: its anchor, and for buildings the footprint box. */
export interface DeathAt {
  x: number;
  y: number;
  building?: { left: number; top: number; w: number; h: number };
}

interface Burst {
  anim: ParticleAnim;
  /** Render tick it starts at. */
  t0: number;
  x: number;
  y: number;
}

/** Room around a burst's anchor: the destroy studs reach about 72 px out. */
const PAD = 80;

export class DeathFx {
  private bursts: Burst[] = [];
  private sprites = new Map<string, ParticleSprite>();
  private canvas = document.createElement('canvas');
  private img: ImageData | null = null;
  private covered = new Uint8Array(0);

  constructor(private readonly fx: ParticleFx) {
    for (const [k, v] of Object.entries(fx.sprites)) this.sprites.set(k, { w: v.width, h: v.height, data: v.data });
  }

  /** Something died at render tick `now`. */
  add(at: DeathAt, now: number): void {
    const b = at.building;
    if (!b) {
      const small = this.fx.smallStudDestroy;
      if (small) for (const dt of [0, 2]) this.bursts.push({ anim: small, t0: now + dt, x: at.x, y: at.y });
      return;
    }
    for (const dt of [3, 7]) this.bursts.push({ anim: this.fx.dust, t0: now + dt, x: b.left + Math.floor(Math.random() * b.w), y: b.top + b.h });
    if (this.fx.studDestroy) this.bursts.push({ anim: this.fx.studDestroy, t0: now + 6, x: b.left + b.w / 2, y: b.top + b.h / 2 });
  }

  /** Draw every live burst at render tick `now` into one canvas; null when nothing plays. */
  draw(now: number): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    this.bursts = this.bursts.filter((b) => now - b.t0 < b.anim.length);
    const live = this.bursts.filter((b) => now >= b.t0);
    if (!live.length) return null;
    const l = Math.floor(Math.min(...live.map((b) => b.x))) - PAD;
    const t = Math.floor(Math.min(...live.map((b) => b.y))) - PAD;
    const w = Math.ceil(Math.max(...live.map((b) => b.x))) + PAD - l;
    const h = Math.ceil(Math.max(...live.map((b) => b.y))) + PAD - t;
    if (!this.img || this.img.width !== w || this.img.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.img = new ImageData(w, h);
      this.covered = new Uint8Array(w * h);
    } else {
      this.img.data.fill(0);
      this.covered.fill(0);
    }
    for (const b of live) {
      const ps = b.anim[Math.floor(now - b.t0)]!;
      for (let i = ps.length - 1; i >= 0; i--) drawParticle(this.img, this.covered, this.sprites.get(ps[i]!.sprite), ps[i]!, b.x - l, b.y - t);
    }
    this.canvas.getContext('2d')!.putImageData(this.img, 0, 0);
    return { canvas: this.canvas, x: l, y: t };
  }
}
