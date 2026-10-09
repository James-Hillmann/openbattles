/**
 * Which of the local player's units are selected. Render/input side only:
 * the sim never sees selection, only the move commands built from it.
 */
export interface Pickable {
  id: number;
  owner: number;
  /** Where the unit is drawn this frame, in world pixels (sprite anchor point). */
  x: number;
  y: number;
  /** Hit box in world pixels, for buildings; units use HIT around their anchor. */
  box?: { l: number; t: number; r: number; b: number };
  /** Buildings are picked by click only, never by a box drag. */
  building?: boolean;
}

/**
 * Hit box around a unit's anchor, in world pixels. Unit frames are 24x24 with
 * the anchor at (12, 19); the figure itself is about 16 px wide.
 */
const HIT = { left: 8, right: 8, up: 19, down: 5 };

export class Selection {
  readonly ids = new Set<number>();

  /** Topmost unit under a world point, or undefined. Lower on screen draws on top. */
  pick(units: readonly Pickable[], x: number, y: number): Pickable | undefined {
    let best: Pickable | undefined;
    for (const u of units) {
      const b = u.box ?? { l: u.x - HIT.left, r: u.x + HIT.right, t: u.y - HIT.up, b: u.y + HIT.down };
      if (x < b.l || x > b.r || y < b.t || y > b.b) continue;
      if (!best || u.y >= best.y) best = u;
    }
    return best;
  }

  /** Tap/click: select one of your units, add with `additive`, or clear on empty ground. */
  click(units: readonly Pickable[], player: number, x: number, y: number, additive: boolean): void {
    const u = this.pick(units, x, y);
    if (!additive) this.ids.clear();
    if (u && u.owner === player) {
      // A building is selected on its own, like in the game.
      if (u.building || [...this.ids].some((id) => units.find((p) => p.id === id)?.building)) this.ids.clear();
      if (additive && this.ids.has(u.id)) this.ids.delete(u.id);
      else this.ids.add(u.id);
    }
  }

  /** Box select: every unit of yours whose anchor is inside the rectangle. */
  box(units: readonly Pickable[], player: number, x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
    if (!additive) this.ids.clear();
    for (const u of units) if (u.owner === player && !u.building && u.x >= l && u.x <= r && u.y >= t && u.y <= b) this.ids.add(u.id);
  }

  /** Drop ids of units that no longer exist. */
  prune(alive: (id: number) => boolean): void {
    for (const id of this.ids) if (!alive(id)) this.ids.delete(id);
  }
}
