import { Container, Sprite, Texture } from 'pixi.js';
import type { FogArt, FogState, PaletteCycle } from '@lbw/extract';
import { fogCode } from '@lbw/extract';
import type { Fog } from '@lbw/sim';

/**
 * Fog of war as the game draws it on main BG2 (docs/re-notes/fog.md "Drawing"): every map cell is
 * a 24 x 16 picture of `FoWTileset` tiles, picked by the cell's and its four neighbours' fog
 * state. Cells never seen get the grey cloud, cells seen before but not now a see-through
 * checker of it, cells seen now nothing; the soft bumpy edges come from the same pictures.
 * The cloud's colours 8-15 cycle, which makes it shimmer.
 */
export class FogView {
  private readonly sprites: (Sprite | null)[];
  /** Picture per cell, -1 before the first update. */
  private readonly picture: Int16Array;
  /** Textures per picture and palette step, made on first use. */
  private readonly textures = new Map<number, Texture>();
  /** Pictures whose six tiles are all see-through (the clear cell). */
  private readonly empty: boolean[];
  private readonly cycle: PaletteCycle | undefined;
  private step = 0;

  constructor(
    private readonly layer: Container,
    private readonly art: FogArt,
    private readonly width: number,
    private readonly height: number,
    private readonly cellW: number,
    private readonly cellH: number,
  ) {
    this.sprites = new Array<Sprite | null>(width * height).fill(null);
    this.picture = new Int16Array(width * height).fill(-1);
    const n = art.cells.length / 6;
    this.empty = Array.from({ length: n }, (_, p) => [...art.cells.subarray(p * 6, p * 6 + 6)].every((t) => art.tiles.subarray(t * 64, t * 64 + 64).every((v) => v === 0)));
    // The fog tiles use colours 0-15; only the cycle inside that range matters here.
    this.cycle = art.cycles.find((c) => c.last < 16);
  }

  destroy(): void {
    for (const s of this.sprites) s?.destroy();
    for (const t of this.textures.values()) t.destroy(true);
    this.textures.clear();
  }

  /** Re-pick every cell's picture from the fog grids. Cells off the map count as never seen (0x0203A318). */
  update(fog: Fog): void {
    const { width: w, height: h } = this;
    const state = (x: number, y: number): FogState => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const i = y * w + x;
      return fog.visible[i] ? 2 : fog.explored[i] ? 1 : 0;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = this.art.codes[fogCode(state(x, y - 1), state(x - 1, y), state(x, y), state(x + 1, y), state(x, y + 1))] ?? 0;
        if (p === this.picture[i]) continue;
        this.picture[i] = p;
        let s = this.sprites[i];
        if (this.empty[p]) {
          if (s) s.visible = false;
          continue;
        }
        if (!s) {
          s = new Sprite();
          s.position.set(x * this.cellW, y * this.cellH);
          this.layer.addChild(s);
          this.sprites[i] = s;
        }
        s.visible = true;
        s.texture = this.texture(p, this.step);
      }
    }
  }

  /**
   * Turn the colour cycle to game tick `tick`: one step every `period` ticks (0x02028590). Where
   * the game's cycle starts against our tick count isn't known; a whole turn is 16 ticks.
   */
  setTick(tick: number): void {
    const c = this.cycle;
    if (!c) return;
    const step = Math.floor(tick / c.period) % (c.last - c.first + 1);
    if (step === this.step) return;
    this.step = step;
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (s?.visible) s.texture = this.texture(this.picture[i]!, step);
    }
  }

  private texture(p: number, step: number): Texture {
    const key = p * 256 + step;
    let t = this.textures.get(key);
    if (t) return t;
    const { art } = this;
    const pal = art.palette;
    const c = this.cycle;
    // Colour index after `step` turns: colour i shows what colour i + step had at the start.
    const colour = (v: number) => (c && v >= c.first && v <= c.last ? c.first + ((v - c.first + step) % (c.last - c.first + 1)) : v);
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 16;
    const img = new ImageData(24, 16);
    for (let k = 0; k < 6; k++) {
      const tile = art.cells[p * 6 + k]!;
      const ox = (k % 3) * 8;
      const oy = Math.floor(k / 3) * 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = art.tiles[tile * 64 + y * 8 + x]!;
          if (v === 0) continue;
          const o = ((oy + y) * 24 + ox + x) * 4;
          const q = colour(v) * 4;
          img.data[o] = pal[q]!;
          img.data[o + 1] = pal[q + 1]!;
          img.data[o + 2] = pal[q + 2]!;
          img.data[o + 3] = 255;
        }
      }
    }
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    t = Texture.from(canvas);
    t.source.scaleMode = 'nearest';
    this.textures.set(key, t);
    return t;
  }
}
