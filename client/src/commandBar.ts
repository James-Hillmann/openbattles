/**
 * The build / train strip. In the game, selecting a Builder or a production building and
 * tapping the red tab at the left edge of the bottom screen opens a red band across the
 * bottom screen at y 32: one 24x24 icon per thing it can make, from UI/MiniHeadsGame,
 * checkered over when you can't afford it. The top screen shows the costs meanwhile
 * ("Build Costs"; HudView). Emulator: docs/re-notes/build-ui.md. We draw the band at 2x
 * from the left edge of the battlefield and open it as soon as something is selected.
 */
export interface CommandItem {
  /** Passed back to `onPick`. */
  key: string;
  /** Tooltip: name and cost. */
  label: string;
  cost: number;
  icon: HTMLCanvasElement | null;
  /** False when the player can't afford it or has no room for it. */
  enabled: boolean;
}

export interface QueueItem {
  icon: HTMLCanvasElement | null;
  /** 0..100 for the unit in training, -1 for one still waiting. */
  pct: number;
}

/** DS layout, in DS pixels: band at y 32, 24 px icons with a 1 px dark rule between them. Shown at 2x. */
const SCALE = 2;
const ICON = 24;

export class CommandBar {
  readonly el = document.createElement('div');
  private shown = '';

  constructor(parent: HTMLElement, private readonly onPick: (key: string) => void) {
    this.el.className = 'cmdbar';
    this.el.hidden = true;
    parent.appendChild(this.el);
    const css = document.createElement('style');
    css.textContent = `
      .cmdbar { position: absolute; left: 0; right: 0; top: ${32 * SCALE}px; user-select: none; pointer-events: none; font: bold 13px 'Trebuchet MS', sans-serif; color: #fff; }
      .cmdbar[hidden] { display: none; }
      .cmdbar .band { display: flex; width: max-content; max-width: 100%; height: ${ICON * SCALE}px; background: #e82010; border-top: 2px solid #ff8070; border-bottom: 2px solid #600; pointer-events: auto; box-shadow: 0 3px 0 #0006; }
      .cmdbar .band::before { content: ''; width: ${8 * SCALE}px; background: #c00; border-right: 2px solid #600; }
      /* The band stops after the last icon with a short end cap, as on the DS. */
      .cmdbar .band::after { content: ''; width: ${8 * SCALE}px; background: linear-gradient(90deg, #e82010 40%, #ff8070 40% 60%, #c00 60%); }
      .cmdbar button { position: relative; width: ${ICON * SCALE}px; height: ${ICON * SCALE}px; padding: 0; margin: 0; border: 0; border-right: 2px solid #600;
        background: #e82010; cursor: pointer; }
      .cmdbar button:hover:not(:disabled) { filter: brightness(1.25); }
      .cmdbar button:disabled { cursor: default; }
      /* The game checkers an icon you can't afford; we lay a 2 px checkerboard over it. */
      .cmdbar button:disabled::after { content: ''; position: absolute; inset: 0;
        background: repeating-conic-gradient(#600 0 25%, transparent 0 50%) 0 0 / ${2 * SCALE}px ${2 * SCALE}px; opacity: 0.8; }
      .cmdbar button canvas { width: ${ICON * SCALE}px; height: ${ICON * SCALE}px; display: block; }
      .cmdbar button .name { display: flex; height: 100%; align-items: center; justify-content: center; font-size: 10px; line-height: 1; padding: 2px; }
      .cmdbar .under { display: flex; gap: 10px; align-items: center; padding: 6px ${8 * SCALE}px; }
      .cmdbar .hint { text-shadow: 1px 1px 0 #000, -1px 0 0 #000; }
      .cmdbar .queue { display: flex; gap: 2px; }
      .cmdbar .queue div { width: 32px; height: 36px; background: #400; position: relative; border: 1px solid #000; }
      .cmdbar .queue canvas { width: 32px; height: 32px; display: block; }
      .cmdbar .queue i { position: absolute; left: 0; bottom: 0; height: 4px; background: #3e3; }
    `;
    parent.appendChild(css);
  }

  hide(): void {
    this.el.hidden = true;
    this.shown = '';
  }

  /** `hint` is a line under the band (e.g. where to place a building); the title belongs to the top screen. */
  show(hint: string, items: readonly CommandItem[], queue: readonly QueueItem[] = []): void {
    const key = JSON.stringify([hint, items.map((i) => [i.key, i.enabled]), queue.map((q) => q.pct)]);
    this.el.hidden = items.length === 0 && queue.length === 0 && !hint;
    if (key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren();
    if (items.length) {
      const band = document.createElement('div');
      band.className = 'band';
      for (const it of items) {
        const b = document.createElement('button');
        b.title = it.label;
        b.disabled = !it.enabled;
        if (it.icon) b.appendChild(copy(it.icon));
        else b.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: it.label.split(':')[0]! }));
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPick(it.key);
        });
        band.appendChild(b);
      }
      this.el.appendChild(band);
    }
    const under = document.createElement('div');
    under.className = 'under';
    if (queue.length) {
      const q = document.createElement('div');
      q.className = 'queue';
      for (const it of queue) {
        const d = document.createElement('div');
        if (it.icon) d.appendChild(copy(it.icon));
        const bar = document.createElement('i');
        bar.style.width = `${Math.max(0, it.pct) * 0.32}px`;
        d.appendChild(bar);
        q.appendChild(d);
      }
      under.appendChild(q);
    }
    if (hint) under.appendChild(Object.assign(document.createElement('span'), { className: 'hint', textContent: hint }));
    if (under.childElementCount) this.el.appendChild(under);
  }
}

function copy(c: HTMLCanvasElement): HTMLCanvasElement {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d')!.drawImage(c, 0, 0);
  return n;
}
