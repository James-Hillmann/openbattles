import type { Graphics } from 'pixi.js';
import { TOP_H, TOP_W, composeTopScreen, iconFrame, type HudBundle, type TopScreenState } from '@lbw/extract';
import { HP_BANDS, POWER_COLORS, barCells, hpBand, litCells } from './bars';

/**
 * The DS top screen (status bar, selected unit's name, portrait and HP) as a
 * 256x192 canvas shown at 2x above the sidebar, the way the DS shows it above
 * the battlefield. Recomposed only when what it shows changes.
 */
export class HudView {
  readonly canvas = document.createElement('canvas');
  private hud: HudBundle | null = null;
  private shown = '';

  constructor(parent: HTMLElement) {
    this.canvas.width = TOP_W;
    this.canvas.height = TOP_H;
    this.canvas.className = 'topscreen';
    this.canvas.hidden = true;
    parent.prepend(this.canvas);
  }

  setBundle(hud: HudBundle): void {
    this.hud = hud;
    this.shown = '';
    this.canvas.hidden = false;
  }

  /** The HUD's label (name, max HP) for an entity, by internal id (e.g. `K_Swordsman`). */
  label(id: string): HudBundle['labels'][number] | undefined {
    return this.hud?.labels.find((l) => l.id === id);
  }

  /** Index into the HUD's entity labels, by internal id (e.g. `K_Swordsman`). */
  entityIndex(id: string): number {
    return this.hud?.labels.findIndex((l) => l.id === id) ?? -1;
  }

  update(state: TopScreenState): void {
    if (!this.hud) return;
    // The minimap image only changes with the map, and setBundle() resets `shown` then.
    const key = JSON.stringify({
      ...state,
      // Repaint when an icon frame changes, not on every tick of the clock.
      timeMs: (['bricks', 'minifigs', 'star'] as const).map((n) => iconFrame(n, state.timeMs)),
      minimap: state.minimap && { ...state.minimap, image: undefined },
    });
    if (key === this.shown) return;
    this.shown = key;
    const img = composeTopScreen(this.hud, state);
    this.canvas.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  }
}

function drawRow(g: Graphics, left: number, top: number, cells: number, lit: number, colors: { lit: number; unlit: number }): void {
  g.rect(left, top, 3 * cells + 1, 4).fill(0x000000);
  for (let k = 0; k < cells; k++) g.rect(left + 1 + 3 * k, top + 1, 2, 2).fill(k < lit ? colors.lit : colors.unlit);
}

/**
 * Health bar (and hero charge bar) over a unit; rules in ./bars.ts.
 * `frameLeft`/`frameTop`: the unit's 24x24 sprite frame. The health row sits at
 * frameTop - 6 (a 2 px gap), the hero row 4 px above it.
 */
export function drawUnitBars(g: Graphics, frameLeft: number, frameTop: number, hp: number, maxHp: number, power?: { value: number; max: number }): void {
  const cells = barCells(24);
  drawRow(g, frameLeft, frameTop - 6, cells, litCells(hp, maxHp, cells), HP_BANDS[hpBand(hp, maxHp)]!);
  if (power) drawRow(g, frameLeft, frameTop - 10, cells, litCells(power.value, power.max, cells), POWER_COLORS);
}
