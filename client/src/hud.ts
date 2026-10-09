import type { Graphics } from 'pixi.js';
import { COST_PANEL, TOP_H, TOP_W, composeTopScreen, iconFrame, type HudBundle, type TopScreenState } from '@lbw/extract';
import { HP_BANDS, POWER_COLORS, barCells, hpBand, litCells } from './bars';

/**
 * The DS top screen (status bar, selected unit's name, portrait and HP) as a
 * 256x192 canvas shown at 2x above the sidebar, the way the DS shows it above
 * the battlefield. Recomposed only when what it shows changes.
 */
export interface CostAction {
  key: string;
  label: string;
  enabled: boolean;
}

/** On-screen scale of the top screen (CSS px per DS px). */
const TOP_SCALE = 2;

export class HudView {
  readonly canvas = document.createElement('canvas');
  /** The canvas plus a layer of buttons over the Build Costs icons. */
  private readonly wrap = document.createElement('div');
  private readonly hits = document.createElement('div');
  private hud: HudBundle | null = null;
  private shown = '';
  private shownHits = '';

  constructor(parent: HTMLElement, private readonly onPick: (key: string) => void) {
    this.canvas.width = TOP_W;
    this.canvas.height = TOP_H;
    this.canvas.className = 'topscreen';
    this.wrap.className = 'topwrap';
    this.wrap.hidden = true;
    this.hits.className = 'costhits';
    this.wrap.append(this.canvas, this.hits);
    parent.prepend(this.wrap);
  }

  setBundle(hud: HudBundle): void {
    this.hud = hud;
    this.shown = '';
    this.wrap.hidden = false;
  }

  /**
   * Make the Build Costs icons work like their strip buttons (ours: on the DS that panel is only a
   * list). `actions` lines up with the panel's items; empty when the panel isn't shown.
   */
  setActions(actions: readonly CostAction[]): void {
    const key = JSON.stringify(actions);
    if (key === this.shownHits) return;
    this.shownHits = key;
    this.hits.replaceChildren(
      ...actions.map((a, i) => {
        const b = document.createElement('button');
        b.title = a.label;
        b.disabled = !a.enabled;
        const x = COST_PANEL.iconX + COST_PANEL.step * (i % COST_PANEL.cols);
        const y = COST_PANEL.iconY + COST_PANEL.step * Math.floor(i / COST_PANEL.cols);
        Object.assign(b.style, { left: `${x * TOP_SCALE}px`, top: `${y * TOP_SCALE}px`, width: `${24 * TOP_SCALE}px`, height: `${24 * TOP_SCALE}px` });
        b.onclick = () => this.onPick(a.key);
        return b;
      }),
    );
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

/**
 * A building's training progress: a red row above its health bar while selected, lit cells =
 * floor(percent x cells / 100); lit is BGR555 0x001F (emulator). The unlit shade is our guess.
 */
export const TRAIN_COLORS = { lit: 0xff0000, unlit: 0x500000 };

function drawRow(g: Graphics, left: number, top: number, cells: number, lit: number, colors: { lit: number; unlit: number }): void {
  g.rect(left, top, 3 * cells + 1, 4).fill(0x000000);
  for (let k = 0; k < cells; k++) g.rect(left + 1 + 3 * k, top + 1, 2, 2).fill(k < lit ? colors.lit : colors.unlit);
}

/**
 * Health bar (and hero charge bar) over a unit; rules in ./bars.ts.
 * `frameLeft`/`frameTop`: the unit's 24x24 sprite frame. The health row sits at
 * frameTop - 6 (a 2 px gap), the hero row 4 px above it.
 */
export function drawUnitBars(g: Graphics, frameLeft: number, frameTop: number, hp: number, maxHp: number, power?: { value: number; max: number; colors?: { lit: number; unlit: number } }): void {
  const cells = barCells(24);
  drawRow(g, frameLeft, frameTop - 6, cells, litCells(hp, maxHp, cells), HP_BANDS[hpBand(hp, maxHp)]!);
  if (power) drawRow(g, frameLeft, frameTop - 10, cells, litCells(power.value, power.max, cells), power.colors ?? POWER_COLORS);
}
