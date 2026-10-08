/**
 * The build / train strip. In the game, selecting a Builder or a production building and
 * tapping the red tab at the left edge of the bottom screen opens a row of 24x24 red icons
 * at bottom-screen y 32, one per thing it can make, while the top screen lists the costs
 * (emulator, docs/re-notes/build-ui.md). We draw the row over the battlefield at 2x with
 * each icon's cost under it. Icons are our stand-ins (the building's or unit's own picture)
 * until the game's icon sheet is decoded.
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

/** DS layout, in DS pixels: strip at x 8, y 32; 24 px icons. Shown at 2x. */
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
      .cmdbar { position: absolute; left: ${8 * SCALE}px; top: ${32 * SCALE}px; display: flex; flex-direction: column; gap: 4px;
        font: bold 11px/1 monospace; color: #fff; user-select: none; pointer-events: none; }
      .cmdbar .row { display: flex; background: #e01010; border-top: 2px solid #ff6a5a; border-bottom: 2px solid #7a0000; pointer-events: auto; }
      .cmdbar .title { text-shadow: 1px 1px 0 #000; pointer-events: none; }
      .cmdbar button { width: ${ICON * SCALE}px; height: ${ICON * SCALE + 12}px; padding: 0; margin: 0; border: 0; border-right: 2px solid #7a0000;
        background: #e01010; color: #fff; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; font: inherit; }
      .cmdbar button:hover { background: #ff3020; }
      .cmdbar button:disabled { filter: grayscale(0.8) brightness(0.7); cursor: default; }
      .cmdbar button canvas { width: ${ICON * SCALE}px; height: ${ICON * SCALE}px; image-rendering: pixelated; object-fit: contain; }
      .cmdbar button .name { height: ${ICON * SCALE}px; display: flex; align-items: center; font-size: 10px; white-space: normal; }
      .cmdbar .queue { display: flex; gap: 2px; pointer-events: none; }
      .cmdbar .queue div { width: 32px; height: 36px; background: #400; position: relative; }
      .cmdbar .queue canvas { width: 32px; height: 32px; image-rendering: pixelated; object-fit: contain; }
      .cmdbar .queue i { position: absolute; left: 0; bottom: 0; height: 3px; background: #3e3; }
    `;
    parent.appendChild(css);
  }

  hide(): void {
    this.el.hidden = true;
    this.shown = '';
  }

  show(title: string, items: readonly CommandItem[], queue: readonly QueueItem[] = []): void {
    const key = JSON.stringify([title, items.map((i) => [i.key, i.enabled]), queue.map((q) => q.pct)]);
    this.el.hidden = items.length === 0 && queue.length === 0;
    if (key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren();
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = title;
    this.el.appendChild(t);
    if (items.length) {
      const row = document.createElement('div');
      row.className = 'row';
      for (const it of items) {
        const b = document.createElement('button');
        b.title = it.label;
        b.disabled = !it.enabled;
        if (it.icon) b.appendChild(copy(it.icon));
        else b.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: it.label.split(':')[0]! }));
        b.appendChild(document.createTextNode(String(it.cost)));
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPick(it.key);
        });
        row.appendChild(b);
      }
      this.el.appendChild(row);
    }
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
      this.el.appendChild(q);
    }
  }
}

function copy(c: HTMLCanvasElement): HTMLCanvasElement {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d')!.drawImage(c, 0, 0);
  return n;
}
