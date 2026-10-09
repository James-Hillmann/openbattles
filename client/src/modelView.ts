import { Texture } from 'pixi.js';
import { renderModelFrame, type ModelUnit, type Rgba } from '@lbw/extract';

/** Which of the game's three model clips a unit plays. */
export type ModelClipName = 'idle' | 'move' | 'attack';

/**
 * Draws a model unit's poses on demand and keeps them. A pose is one facing row x one
 * animation frame (x selected or not), so a unit only ever renders what is shown.
 */
export class ModelView {
  private readonly cache = new Map<number, Texture>();

  constructor(
    readonly unit: ModelUnit,
    private readonly toTexture: (img: Rgba) => Texture,
  ) {}

  texture(row: number, frame: number, outline?: readonly [number, number, number]): Texture {
    const key = (outline ? 1 << 20 : 0) | (row << 10) | frame;
    let t = this.cache.get(key);
    if (!t) {
      t = this.toTexture(renderModelFrame(this.unit, row, frame, outline));
      this.cache.set(key, t);
    }
    return t;
  }

  destroy(): void {
    for (const t of this.cache.values()) t.destroy(true);
    this.cache.clear();
  }
}
