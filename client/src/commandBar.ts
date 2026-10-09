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
  /** The price in the game's digit font (priceLabel), drawn under the icon; text if missing. */
  price?: HTMLCanvasElement | null;
  /** False when the player can't afford it or has no room for it. */
  enabled: boolean;
  /** Drawn as picked (a spell waiting for its target). */
  armed?: boolean;
}

export interface QueueItem {
  icon: HTMLCanvasElement | null;
  /** False for an empty slot. */
  used: boolean;
  /** What's in the slot (for redraws). */
  name: string;
}

/** DS layout, in DS pixels: band at y 32, 24 px icons with a 1 px dark rule between them. Shown at 2x. */
const SCALE = 2;
const ICON = 24;
/**
 * Ours, asked for by players: each icon's price on a dark row under it, in the game's digit font and the
 * Build Costs panel's colour. The DS only lists prices on the top screen (kept too).
 */
const PRICE_H = 9;

export class CommandBar {
  readonly el = document.createElement('div');
  private shown = '';

  constructor(
    parent: HTMLElement,
    private readonly onPick: (key: string) => void,
    /** A queue slot was clicked: cancel that entry (0 = the unit in training). */
    private readonly onCancel: (index: number) => void = () => {},
  ) {
    this.el.className = 'cmdbar';
    this.el.hidden = true;
    parent.appendChild(this.el);
    const css = document.createElement('style');
    css.textContent = `
      .cmdbar { position: absolute; left: 0; right: 0; top: ${32 * SCALE}px; user-select: none; pointer-events: none; font: bold 13px 'Trebuchet MS', sans-serif; color: #fff; }
      .cmdbar[hidden] { display: none; }
      .cmdbar .band { display: flex; width: max-content; max-width: 100%; height: ${(ICON + PRICE_H) * SCALE}px; background: #e82010; border-top: 2px solid #ff8070; border-bottom: 2px solid #600; pointer-events: auto; box-shadow: 0 3px 0 #0006; }
      .cmdbar .band::before { content: ''; width: ${8 * SCALE}px; background: #c00; border-right: 2px solid #600; }
      /* The band stops after the last icon with a short end cap, as on the DS. */
      .cmdbar .band::after { content: ''; width: ${8 * SCALE}px; background: linear-gradient(90deg, #e82010 40%, #ff8070 40% 60%, #c00 60%); }
      .cmdbar button { position: relative; width: ${ICON * SCALE}px; height: ${(ICON + PRICE_H) * SCALE}px; padding: 0; margin: 0; border: 0; border-right: 2px solid #600;
        background: #e82010; cursor: pointer; display: flex; flex-direction: column; }
      .cmdbar .price { height: ${PRICE_H * SCALE}px; display: flex; align-items: center; justify-content: center; background: rgb(40,32,48); border-top: 2px solid #600; box-sizing: border-box;
        font: bold 12px monospace; color: #fff; }
      .cmdbar .price canvas { width: auto; height: ${8 * SCALE}px; }
      .cmdbar button:hover:not(:disabled) { filter: brightness(1.25); }
      .cmdbar button:disabled { cursor: default; }
      /* The game checkers an icon you can't afford; we lay a 2 px checkerboard over it. */
      .cmdbar button:disabled::after { content: ''; position: absolute; inset: 0 0 ${PRICE_H * SCALE}px 0;
        background: repeating-conic-gradient(#600 0 25%, transparent 0 50%) 0 0 / ${2 * SCALE}px ${2 * SCALE}px; opacity: 0.8; }
      .cmdbar button > canvas { width: ${ICON * SCALE}px; height: ${ICON * SCALE}px; display: block; flex: none; }
      .cmdbar button .name { display: flex; height: ${ICON * SCALE}px; align-items: center; justify-content: center; font-size: 10px; line-height: 1; padding: 2px; }
      .cmdbar .under { display: flex; gap: 10px; align-items: center; padding: 6px ${8 * SCALE}px; }
      .cmdbar .hint { text-shadow: 1px 1px 0 #000, -1px 0 0 #000; }
      .cmdbar .queue { display: flex; gap: 2px; }
      /* The hero's spell strip (orange tab): the same band in the strip texture's orange, and a blue 1 px checker
         over spells the hero lacks the charge for (both measured in the emulator). */
      .cmdbar.spell .band, .cmdbar.spell button { background: #f89800; }
      .cmdbar.spell .band { border-top-color: #f8d800; border-bottom-color: #983800; }
      .cmdbar.spell .band::before { background: #d86800; border-right-color: #983800; }
      .cmdbar.spell .band::after { background: linear-gradient(90deg, #f89800 40%, #f8d800 40% 60%, #d86800 60%); }
      .cmdbar.spell button { border-right-color: #983800; }
      .cmdbar.spell .price { border-top-color: #983800; }
      .cmdbar.spell button:disabled::after { background: repeating-conic-gradient(#3080f8 0 25%, transparent 0 50%) 0 0 / ${2 * SCALE}px ${2 * SCALE}px; opacity: 1; }
      /* The blue Actions strip (blue tab, above the red one in the game): order icons, no prices. Colours from the
         strip texture's blue bank. */
      .cmdbar .band.act { height: ${ICON * SCALE}px; background: #68a8f8; border-top-color: #b8d8f8; border-bottom-color: #2058a8; margin-bottom: ${4 * SCALE}px; }
      .cmdbar .band.act::before { background: #4888e0; border-right-color: #2058a8; }
      .cmdbar .band.act::after { background: linear-gradient(90deg, #68a8f8 40%, #b8d8f8 40% 60%, #4888e0 60%); }
      .cmdbar .band.act button { height: ${ICON * SCALE}px; background: #68a8f8; border-right-color: #2058a8; }
      .cmdbar button.armed { outline: 3px solid #fff; outline-offset: -3px; }
      /* The game's three queue slots (top screen, under the portrait): 24x24 recessed boxes, each queued unit's
         head with an 8x8 red no-entry badge at its lower right that cancels it. */
      .cmdbar .queue { pointer-events: auto; }
      .cmdbar .queue button { width: ${ICON * SCALE}px; height: ${ICON * SCALE}px; padding: 0; background: #301010;
        border: 2px solid; border-color: #180808 #604040 #604040 #180808; position: relative; }
      .cmdbar .queue button:disabled::after { display: none; }
      .cmdbar .queue canvas { width: 100%; height: 100%; display: block; }
      .cmdbar .queue b { position: absolute; right: 0; bottom: 0; width: ${8 * SCALE}px; height: ${8 * SCALE}px; border-radius: 50%;
        background: #e01010; border: 1px solid #fff; box-sizing: border-box; }
      .cmdbar .queue b::after { content: ''; position: absolute; left: 3px; right: 3px; top: 50%; height: 2px; margin-top: -1px; background: #fff; }
    `;
    parent.appendChild(css);
  }

  /** Called when the strip opens with `icons` icons (the game plays a click per icon sliding in). */
  onOpen: ((icons: number) => void) | null = null;
  private icons = 0;

  hide(): void {
    this.el.hidden = true;
    this.icons = 0;
    this.shown = '';
  }

  /** `hint` is a line under the band (e.g. where to place a building); the title belongs to the top screen. */
  show(hint: string, items: readonly CommandItem[], queue: readonly QueueItem[] = [], theme: 'build' | 'spell' = 'build', actions: readonly CommandItem[] = []): void {
    const key = JSON.stringify([hint, items.map((i) => [i.key, i.enabled, i.cost, i.armed]), queue.map((q) => q.name), theme, actions.map((i) => [i.key, i.armed, !!i.icon])]);
    const wasOpen = !this.el.hidden && this.icons > 0;
    this.el.hidden = items.length === 0 && queue.length === 0 && actions.length === 0 && !hint;
    this.icons = items.length;
    if (!wasOpen && items.length) this.onOpen?.(items.length);
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.toggle('spell', theme === 'spell');
    this.el.replaceChildren();
    if (actions.length) {
      const band = document.createElement('div');
      band.className = 'band act';
      for (const it of actions) {
        const b = document.createElement('button');
        b.title = it.label;
        b.dataset.key = it.key;
        b.classList.toggle('armed', !!it.armed);
        if (it.icon) b.appendChild(copy(it.icon));
        else b.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: it.label }));
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPick(it.key);
        });
        band.appendChild(b);
      }
      this.el.appendChild(band);
    }
    if (items.length) {
      const band = document.createElement('div');
      band.className = 'band';
      for (const it of items) {
        const b = document.createElement('button');
        b.title = it.label;
        b.dataset.key = it.key;
        b.disabled = !it.enabled;
        b.classList.toggle('armed', !!it.armed);
        if (it.icon) b.appendChild(copy(it.icon));
        else b.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: it.label.split(':')[0]! }));
        const price = document.createElement('span');
        price.className = 'price';
        if (it.price) {
          const c = copy(it.price);
          c.style.width = `${it.price.width * SCALE}px`;
          price.appendChild(c);
        } else price.textContent = String(it.cost);
        b.appendChild(price);
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
      queue.forEach((it, i) => {
        const d = document.createElement('button');
        d.disabled = !it.used;
        if (it.used) {
          d.title = 'Cancel';
          if (it.icon) d.appendChild(copy(it.icon));
          d.appendChild(document.createElement('b'));
          d.addEventListener('pointerdown', (e) => e.stopPropagation());
          d.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onCancel(i);
          });
        }
        q.appendChild(d);
      });
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
