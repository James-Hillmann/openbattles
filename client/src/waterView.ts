import { Container, Sprite, Texture } from 'pixi.js';
import type { GroundCycles } from '@lbw/extract';
import { CELL_H, CELL_W } from '@lbw/sim';

/**
 * Water and lava moving on the ground (docs/re-notes/fog.md "Colour cycling"): the game turns a few
 * colour ranges of the tileset palette one step every 2 or 3 ticks (0x02028590). The ground picture
 * is baked once, so this lays a sprite over each cell that uses a turning colour, drawing only those
 * pixels, and redraws the few shared cell pictures when a range turns. Drawing only.
 */
export class WaterView {
  private readonly sprites: Sprite[] = [];
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly textures: Texture[] = [];
  private steps: number[] = [];

  constructor(
    private readonly layer: Container,
    private readonly g: GroundCycles,
    width: number,
  ) {
    for (const _ of g.pictures) {
      const c = document.createElement('canvas');
      c.width = CELL_W;
      c.height = CELL_H;
      const t = Texture.from(c);
      t.source.scaleMode = 'nearest';
      this.canvases.push(c);
      this.textures.push(t);
    }
    g.cells.forEach((p, i) => {
      if (!p) return;
      const s = new Sprite(this.textures[p - 1]!);
      s.position.set((i % width) * CELL_W, Math.floor(i / width) * CELL_H);
      layer.addChild(s);
      this.sprites.push(s);
    });
    this.setTick(0);
  }

  destroy(): void {
    for (const s of this.sprites) s.destroy();
    for (const t of this.textures) t.destroy(true);
  }

  /** Turn the colours to game tick `tick` (where the game's turning starts against our ticks isn't known). */
  setTick(tick: number): void {
    const steps = this.g.cycles.map((c) => Math.floor(tick / c.period) % (c.last - c.first + 1));
    if (steps.every((s, i) => s === this.steps[i])) return;
    this.steps = steps;
    const map = new Uint8Array(256).map((_, i) => i);
    this.g.cycles.forEach((c, k) => {
      // Colour i shows what colour i + step had at the start (fogView.ts does the same for the fog's range).
      for (let i = c.first; i <= c.last; i++) map[i] = c.first + ((i - c.first + steps[k]!) % (c.last - c.first + 1));
    });
    const pal = this.g.palette;
    this.g.pictures.forEach((pic, p) => {
      const img = new ImageData(CELL_W, CELL_H);
      for (let i = 0; i < pic.length; i++) {
        const v = pic[i]!;
        if (!v) continue;
        const o = map[v]! * 4;
        img.data.set([pal[o]!, pal[o + 1]!, pal[o + 2]!, 255], i * 4);
      }
      this.canvases[p]!.getContext('2d')!.putImageData(img, 0, 0);
      this.textures[p]!.source.update();
    });
  }
}
