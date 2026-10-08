import type { Particle, ParticleAnim, ParticleFx } from '@lbw/extract';

/**
 * The dust cloud and flying LEGO studs the game plays over a building site, traced in
 * docs/re-notes/build-ui.md "Construction effect". Drawing only: the timing and the random start
 * frames live here, never in the sim.
 *
 * Per site, while it is under 95% done:
 * - three dust effects at 0.2, 0.5 and 0.9 of the box width, each started at a random frame 10..14,
 *   with the next one starting in a slot when its effect reaches frame 45 (confirmed / likely);
 * - one stud effect at the middle from frame 0, the next one 15 ticks after it ends, only while a
 *   Builder works the site (likely);
 * - the dust follows the anchor, which climbs the picture as the work goes on; studs keep the
 *   height they started at (confirmed).
 * Puffs are see-through and don't draw over each other (the DS draws them with one polygon ID), so
 * we rasterise each site's cloud ourselves, first particle to touch a pixel wins (likely).
 */

/** The site's box in world pixels, as the game computes it from the picture and footprint. */
export interface SiteBox {
  left: number;
  top: number;
  w: number;
  h: number;
}

interface Live {
  kind: 'dust' | 'studs';
  /** Fraction of the box width. */
  at: number;
  /** Render tick it started at, and the frame it started on. */
  t0: number;
  f0: number;
  /** Studs: the anchor y they started at. */
  y?: number;
}

interface Site {
  live: Live[];
  /** Render tick the last stud effect ended. */
  studsEnded: number;
  canvas: HTMLCanvasElement;
  img: ImageData;
  covered: Uint8Array;
}

const DUST_SLOTS = [0.2, 0.5, 0.9];
/** A slot starts its next dust effect once the current one gets here (of 50 frames). likely */
const DUST_NEXT = 45;
/** Ticks between one stud effect ending and the next (about 30 VBlanks). likely */
const STUD_GAP = 15;
/** Room around the box for studs flying out (they reach about 64 px from the anchor). */
const PAD_X = 80;
const PAD_TOP = 90;
const PAD_BOTTOM = 40;

export class SiteFx {
  private sites = new Map<number, Site>();
  private sprites = new Map<string, { w: number; h: number; data: Uint8ClampedArray }>();

  constructor(private readonly fx: ParticleFx) {
    for (const [k, v] of Object.entries(fx.sprites)) this.sprites.set(k, { w: v.width, h: v.height, data: v.data });
  }

  /** Anchor y: the cloud sits at the done line, climbing from the bottom of the box. */
  static anchorY(box: SiteBox, pct: number): number {
    return box.top + Math.floor((box.h * (100 - pct)) / 100);
  }

  /**
   * Advance the site's effects to render tick `now` and draw them. Returns the canvas and where its
   * top-left goes in the world, or null when nothing is playing.
   */
  draw(id: number, box: SiteBox, pct: number, working: boolean, now: number): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    let s = this.sites.get(id);
    const active = pct < 95;
    if (!s) {
      if (!active) return null;
      const canvas = document.createElement('canvas');
      canvas.width = box.w + PAD_X * 2;
      canvas.height = box.h + PAD_TOP + PAD_BOTTOM;
      const img = new ImageData(canvas.width, canvas.height);
      s = { live: [], studsEnded: -Infinity, canvas, img, covered: new Uint8Array(canvas.width * canvas.height) };
      this.sites.set(id, s);
    }
    const ay = SiteFx.anchorY(box, pct);
    const frame = (l: Live) => l.f0 + Math.floor(now - l.t0);
    const anim = (l: Live): ParticleAnim => (l.kind === 'dust' ? this.fx.dust : this.fx.studs);
    // Drop finished effects.
    s.live = s.live.filter((l) => {
      if (frame(l) < anim(l).length) return true;
      if (l.kind === 'studs') s.studsEnded = l.t0 + anim(l).length - l.f0;
      return false;
    });
    if (active) {
      for (const at of DUST_SLOTS) {
        if (!s.live.some((l) => l.kind === 'dust' && l.at === at && frame(l) < DUST_NEXT)) s.live.push({ kind: 'dust', at, t0: now, f0: 10 + Math.floor(Math.random() * 5) });
      }
      if (working && !s.live.some((l) => l.kind === 'studs') && now - s.studsEnded >= STUD_GAP) s.live.push({ kind: 'studs', at: 0.5, t0: now, f0: 0, y: ay });
    }
    if (!s.live.length) {
      if (!active) this.sites.delete(id);
      return null;
    }

    // Dust first, newest effect first, and within a frame the last particle first: the order that
    // matched the emulator best.
    const order = [...s.live].sort((a, b) => (a.kind === b.kind ? frame(a) - frame(b) : a.kind === 'dust' ? -1 : 1));
    s.img.data.fill(0);
    s.covered.fill(0);
    const ox = box.left - PAD_X;
    const oy = box.top - PAD_TOP;
    for (const l of order) {
      const ps = anim(l)[frame(l)]!;
      const ax = box.left + box.w * l.at - ox;
      const y = (l.y ?? ay) - oy;
      for (let i = ps.length - 1; i >= 0; i--) this.particle(s, ps[i]!, ax, y);
    }
    s.canvas.getContext('2d')!.putImageData(s.img, 0, 0);
    return { canvas: s.canvas, x: ox, y: oy };
  }

  /** Forget sites that are gone. */
  prune(keep: (id: number) => boolean): void {
    for (const id of this.sites.keys()) if (!keep(id)) this.sites.delete(id);
  }

  /** One textured square: `size` px, centred on the particle, turned by rot, tinted by (c + 1) / 32. */
  private particle(s: Site, p: Particle, ax: number, ay: number): void {
    if (p.a === 0) return;
    const sp = this.sprites.get(p.sprite);
    if (!sp) return;
    const { width, height, data } = s.img;
    const half = p.size / 2;
    const th = (p.rot * 2 * Math.PI) / 65536;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const cx = ax + p.x;
    const cy = ay + p.y;
    const r = Math.ceil(half * Math.SQRT2) + 1;
    const alpha = Math.min(255, Math.round((p.a * 255) / 31));
    for (let py = Math.max(0, Math.floor(cy - r)); py <= Math.min(height - 1, cy + r); py++) {
      for (let px = Math.max(0, Math.floor(cx - r)); px <= Math.min(width - 1, cx + r); px++) {
        const k = py * width + px;
        if (s.covered[k]) continue;
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const lx = c * dx + sn * dy;
        const ly = -sn * dx + c * dy;
        if (lx < -half || lx >= half || ly < -half || ly >= half) continue;
        const u = Math.floor(((lx + half) / p.size) * sp.w);
        const v = Math.floor(((ly + half) / p.size) * sp.h);
        const t = (v * sp.w + u) * 4;
        if (!sp.data[t + 3]) continue;
        s.covered[k] = 1;
        data[k * 4] = (sp.data[t]! * (p.r + 1)) >> 5;
        data[k * 4 + 1] = (sp.data[t + 1]! * (p.g + 1)) >> 5;
        data[k * 4 + 2] = (sp.data[t + 2]! * (p.b + 1)) >> 5;
        data[k * 4 + 3] = alpha;
      }
    }
  }
}
