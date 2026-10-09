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
  /** Buildings are selected on their own: a box takes one only when it holds no units. */
  building?: boolean;
  /** Entity role (+0x5C): 0 hero, 1 builder, 2 melee, 3 ranged, 4 mounted, 5-6 transports/specials. */
  role?: number;
}

/**
 * The most units one selection holds. Game: the box select (Thumb, 0x020E2480) stops filling at 9
 * and adding a unit to a full selection (0x020E339C) does nothing. confirmed (code)
 */
export const MAX_SELECTED = 9;

/**
 * Which units a too-full box keeps first: the box select sorts candidates into lists by role and
 * fills from them in this order (hero, transports/specials, mounted, melee, ranged, builders, the
 * rest). confirmed (code); within one role, entity-list order. likely
 */
function rank(role: number | undefined): number {
  switch (role) {
    case 0: return 0;
    case 5: case 6: return 1;
    case 4: return 2;
    case 2: return 3;
    case 3: return 4;
    case 1: return 5;
    default: return 6;
  }
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
      else if (this.ids.size < MAX_SELECTED) this.ids.add(u.id);
    }
  }

  /**
   * Box select: your units whose anchor is inside the rectangle, at most MAX_SELECTED, by role
   * priority. A box with buildings but no units selects one building (game: 0x020E2480 falls back
   * to its building lists when every unit list is empty). confirmed (code)
   */
  box(units: readonly Pickable[], player: number, x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
    const inside = units.filter((u) => u.owner === player && u.x >= l && u.x <= r && u.y >= t && u.y <= b);
    const found = inside.filter((u) => !u.building);
    if (!additive || [...this.ids].some((id) => units.find((p) => p.id === id)?.building)) this.ids.clear();
    if (!found.length) {
      const home = inside.find((u) => u.building);
      if (home && !this.ids.size) this.ids.add(home.id);
      return;
    }
    found.sort((a, c) => rank(a.role) - rank(c.role)); // stable: entity order within a role
    for (const u of found) {
      if (this.ids.size >= MAX_SELECTED) break;
      this.ids.add(u.id);
    }
  }

  /** Drop ids of units that no longer exist. */
  prune(alive: (id: number) => boolean): void {
    for (const id of this.ids) if (!alive(id)) this.ids.delete(id);
  }
}
