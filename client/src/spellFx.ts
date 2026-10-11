import { Container, Sprite, Texture } from 'pixi.js';
import type { Rgba, SpellFxArt, UnitIcon } from '@lbw/extract';
import { HERO_SPELL_KIND } from '@lbw/extract';
import type { FxQuad } from './spellAnims';

/**
 * Spell pictures as the game draws them (docs/re-notes/spells.md "Pictures"). All of it is drawing:
 * the client works out from the world when an effect starts and ends, nothing goes back to the sim.
 */

/** The hero effect advances one step every 3 game ticks (0x0201B410 adds 33.3 ms a tick and steps at 66.7 ms + 1). */
export const HERO_STEP_TICKS = 3;

export interface HeroFxFrame {
  /** Swirl frame round the body (drawn 5 px up), or -1. */
  swirl: number;
  /** Dome frame over the head (30 px up), or -1. */
  dome: number;
  /** Whether the gold spell picture shows over the head (30 px up). */
  icon: boolean;
  /** The effect is over. */
  done: boolean;
}

/**
 * The hero effect after `steps` steps, the spell having ended on step `endStep` (or not yet: null).
 * Two little state machines in 0x0201B410, run step by step: the swirl plays frames 0-7 once, then
 * loops 2-7 until the spell ends and finishes on the sparkles 9-10; the dome grows (10-16), and the
 * picture shows from its fourth frame until the spell ends, when the dome plays again and the effect
 * is removed.
 */
export function heroFxFrame(steps: number, endStep: number | null): HeroFxFrame {
  let a = 0;
  let aN = 0;
  let swirl = 0;
  let swirlOn = true;
  let b = 0;
  let bN = 0;
  let dome = 0;
  let domeOn = false;
  let icon = false;
  let done = false;
  for (let s = 1; s <= steps && !done; s++) {
    const ending = endStep !== null && s > endStep;
    if (a === 0) {
      swirl = aN % 9;
      if (swirl === 7) {
        a = 1;
        aN = 0;
      }
    } else if (a === 1) {
      swirl = (aN % 6) + 2;
      if (ending) {
        a = 2;
        aN = 0;
      }
    } else if (a === 2) {
      const m = aN % 3;
      if (m === 2) {
        a = -1;
        swirlOn = false;
      }
      swirl = m + 9;
    }
    aN++;
    if (b === 0) {
      dome = 10;
      domeOn = true;
      b = 1;
    } else if (b === 1) {
      const m = bN % 7;
      if (m > 2) icon = true;
      dome = m + 10;
      if (m === 6) {
        domeOn = false;
        b = 2;
      }
    } else if (b === 2) {
      if (ending) {
        bN = 0;
        domeOn = true;
        dome = 10;
        b = 3;
      }
    } else if (b === 3) {
      const m = bN % 7;
      dome = m + 10;
      if (m > 2) icon = false;
      if (m === 6) {
        domeOn = false;
        done = true;
      }
    }
    bN++;
  }
  return { swirl: swirlOn ? swirl : -1, dome: domeOn ? dome : -1, icon, done };
}

/** How long a unit icon blinks before it goes (0x0201FBF8: 11 drawn ticks, then removed). */
export const ICON_BLINK_TICKS = 11;

/**
 * A unit icon `age` ticks after it appeared, `blink` ticks into its blink-out (or null): the offset
 * from its spot and the alpha (0..31). It bobs round a 14-step path; blinking it sits still and
 * flicks between alpha 31 and 5 every tick.
 */
export function iconFrame(bob: readonly { x: number; y: number }[], age: number, blink: number | null): { x: number; y: number; alpha: number } | null {
  if (blink !== null) {
    if (blink >= ICON_BLINK_TICKS) return null;
    return { ...bob[0]!, alpha: blink & 1 ? 5 : 31 };
  }
  return { ...bob[age % bob.length]!, alpha: 31 };
}

/**
 * Where a unit's icons sit above its spot (0x020200B8): its height (24 px a cell) plus 8 px for
 * minifigures (roles 0-4), 20 px for vehicles and ships (5, 6). The spot is 4 px below our unit
 * position (the game's is 12 px into the cell from its top-left corner; ours is the cell centre).
 */
export function iconLift(role: number, cellsHigh = 1): number {
  return 24 * cellsHigh + (role <= 4 ? 8 : role <= 6 ? 20 : 0) - 4;
}

interface HeroFx {
  caster: number;
  kind: number;
  start: number;
  end: number | null;
}

interface IconFx {
  start: number;
  end: number | null;
}

export interface FxUnit {
  id: number;
  role: number;
  x: number;
  y: number;
}

/** What `SpellFxView.tick` needs per game tick. */
export interface FxWorld {
  tick: number;
  spells: readonly { id: number; spell: number; caster: number }[];
}

export class SpellFxView {
  private readonly heroes = new Map<number, HeroFx>();
  private readonly icons = new Map<number, Map<UnitIcon, IconFx>>();
  private readonly sprites: Sprite[] = [];
  private readonly textures = new Map<Rgba, Texture>();
  private used = 0;

  constructor(
    private readonly layer: Container,
    private readonly art: SpellFxArt,
  ) {}

  /** Whether the spell effects' pictures are there to draw. */
  get hasEffects(): boolean {
    return !!this.art.effects;
  }

  destroy(): void {
    for (const s of this.sprites) s.destroy();
    for (const t of this.textures.values()) t.destroy(true);
  }

  /**
   * Call once per game tick. `wanted` gives each unit's icons this tick (buffs, a heal); an icon that
   * is no longer wanted blinks out.
   */
  tick(w: FxWorld, wanted: Map<number, Set<UnitIcon>>): void {
    const live = new Set<number>();
    for (const s of w.spells) {
      live.add(s.id);
      const kind = HERO_SPELL_KIND[s.spell];
      if (kind !== undefined && !this.heroes.has(s.id)) this.heroes.set(s.id, { caster: s.caster, kind, start: w.tick, end: null });
    }
    for (const [id, h] of this.heroes) {
      if (h.end === null && !live.has(id)) h.end = w.tick;
      if (heroFxFrame(this.heroSteps(h, w.tick), this.endStep(h)).done) this.heroes.delete(id);
    }
    for (const [unit, want] of wanted) {
      let m = this.icons.get(unit);
      for (const icon of want) {
        if (!m) this.icons.set(unit, (m = new Map()));
        const fx = m.get(icon);
        if (!fx || fx.end !== null) m.set(icon, { start: w.tick, end: null });
      }
    }
    for (const [unit, m] of this.icons) {
      const want = wanted.get(unit);
      for (const [icon, fx] of m) {
        if (fx.end === null && !want?.has(icon)) fx.end = w.tick;
        if (fx.end !== null && w.tick - fx.end >= ICON_BLINK_TICKS) m.delete(icon);
      }
      if (!m.size) this.icons.delete(unit);
    }
  }

  /**
   * Whether spell `spellId`'s hero effect shows the gold picture yet (HeroStartSpellEffect +0x10A,
   * which Artillery, Coconut Storm and Roar wait for). True when the spell has no hero effect.
   */
  iconShown(spellId: number, tick: number): boolean {
    const h = this.heroes.get(spellId);
    return !h || heroFxFrame(this.heroSteps(h, tick), this.endStep(h)).icon;
  }

  private heroSteps(h: HeroFx, tick: number): number {
    return Math.floor((tick - h.start + 1) / HERO_STEP_TICKS);
  }

  private endStep(h: HeroFx): number | null {
    return h.end === null ? null : Math.floor((h.end - h.start + 1) / HERO_STEP_TICKS);
  }

  /**
   * Draw for game tick `tick`; `units` are where units are drawn now (dead or hidden ones left out),
   * `quads` the spell effects' pictures (spellAnims.ts; the fog layer above covers them as in the game).
   */
  draw(tick: number, units: Map<number, FxUnit>, quads: readonly FxQuad[] = []): void {
    this.used = 0;
    for (const q of quads) {
      const img = this.art.effects?.[q.pic];
      if (!img || q.alpha <= 0) continue;
      const w = q.w ?? img.width;
      const h = q.h ?? img.height;
      const x = q.topLeft ? q.x + w / 2 : q.x;
      const y = q.topLeft ? q.y + h / 2 : q.y;
      const s = this.put(img, x, y, q.alpha, y + q.bias);
      if (!s) continue;
      s.scale.set(((q.flipX ? -1 : 1) * w) / img.width, h / img.height);
      s.angle = q.rot ?? 0;
    }
    for (const h of this.heroes.values()) {
      const u = units.get(h.caster);
      if (!u) continue;
      const f = heroFxFrame(this.heroSteps(h, tick), this.endStep(h));
      if (f.done) continue;
      const x = u.x + 4;
      const y = u.y + 4;
      if (f.icon) this.put(this.art.heroIcons[h.kind], x, y - 30, 31, u.y);
      if (f.dome >= 0) this.put(this.art.heroFrames[f.dome], x, y - 30, 31, u.y);
      if (f.swirl >= 0) this.put(this.art.heroFrames[f.swirl], x, y - 5, 31, u.y);
    }
    for (const [unit, m] of this.icons) {
      const u = units.get(unit);
      if (!u) continue;
      const lift = iconLift(u.role);
      for (const [icon, fx] of m) {
        const f = iconFrame(this.art.bob, tick - fx.start, fx.end === null ? null : tick - fx.end);
        if (f) this.put(this.art.units[icon], u.x + f.x, u.y - lift + f.y, f.alpha, u.y);
      }
    }
    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }

  private put(img: Rgba | undefined, x: number, y: number, alpha: number, z: number): Sprite | undefined {
    if (!img) return undefined;
    let s = this.sprites[this.used];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.layer.addChild(s);
      this.sprites.push(s);
    }
    this.used++;
    s.texture = this.texture(img);
    s.position.set(Math.round(x), Math.round(y));
    s.alpha = alpha / 31;
    s.zIndex = z;
    s.visible = true;
    s.scale.set(1);
    s.angle = 0;
    return s;
  }

  private texture(img: Rgba): Texture {
    let t = this.textures.get(img);
    if (t) return t;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    t = Texture.from(canvas);
    t.source.scaleMode = 'nearest';
    this.textures.set(img, t);
    return t;
  }
}
