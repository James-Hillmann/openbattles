import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { BRIDGE_TYPES, CELL_H, CELL_W, ROLE_BRIDGE, ROLE_WALL, fpH, fpW, isFinished, unitCell, type BridgeSite, type Unit, type World } from '@lbw/sim';
import { wallDamage, wallMask, wallTileIndex, type StructureArt } from '@lbw/extract';

/**
 * Walls and bridges, drawn the way the game draws them into its map layer
 * (extract/src/structures.ts): a wall cell's tiles follow its neighbour mask,
 * its x parity and its HP; a finished bridge covers its cells with the bridge
 * metatiles. A bridge under construction draws nothing (the game shows only a
 * dust cloud moving along it, BridgeConstructionEffect, not ported yet).
 */
export class StructureView {
  private art: StructureArt | null = null;
  private atlas: HTMLCanvasElement | null = null;
  private bridgeTex: Texture[] = [];
  private wallTex = new Map<string, Texture>();
  private views = new Map<number, Container>();
  /** Last neighbour mask per wall (the game keeps it at unit +0x224). */
  private masks = new Map<number, number>();

  constructor(private layer: Container) {}

  setArt(art: StructureArt | null): void {
    for (const t of this.wallTex.values()) t.destroy(true);
    for (const t of this.bridgeTex) t.destroy();
    this.wallTex.clear();
    this.bridgeTex = [];
    this.clear();
    this.art = art;
    this.atlas = art ? canvasOf(art.wallTiles.width, art.wallTiles.height, art.wallTiles.data) : null;
    if (!art) return;
    const src = Texture.from(canvasOf(art.bridgeCells.width, art.bridgeCells.height, art.bridgeCells.data));
    src.source.scaleMode = 'nearest';
    for (let colour = 0; colour < 6; colour++)
      for (let part = 0; part < 4; part++)
        this.bridgeTex.push(new Texture({ source: src.source, frame: new Rectangle(part * CELL_W, colour * CELL_H, CELL_W, CELL_H) }));
  }

  clear(): void {
    for (const v of this.views.values()) v.destroy({ children: true });
    this.views.clear();
    this.masks.clear();
  }

  /** Draw every wall and finished bridge; `colour` is a player's team colour (0..5). */
  draw(w: World, colour: (owner: number) => number, hidden: (u: Unit) => boolean): void {
    const g = w.grid;
    const seen = new Set<number>();
    if (!g || !this.art) return;
    const wallAt = new Map<number, number>(); // cell -> owner
    for (const u of w.units) if (u.role === ROLE_WALL && u.hp > 0) wallAt.set(unitCell(w, u), u.owner);
    for (const u of w.units) {
      if (u.hp <= 0 || (u.role !== ROLE_WALL && u.role !== ROLE_BRIDGE)) continue;
      const c = unitCell(w, u);
      const cx = c % g.width, cy = Math.floor(c / g.width);
      let v = this.views.get(u.id);
      if (u.role === ROLE_WALL) {
        const same = (x: number, y: number) => x >= 0 && y >= 0 && x < g.width && y < g.height && wallAt.get(y * g.width + x) === u.owner;
        const mask = wallMask(same, cx, cy, this.masks.get(u.id) ?? 0);
        this.masks.set(u.id, mask);
        if (!v) this.views.set(u.id, (v = this.add(new Sprite())));
        (v as Sprite).texture = this.wallTexture(colour(u.owner), mask, cx & 1, wallDamage(u.hp, u.maxHp));
      } else {
        if (!isFinished(u)) {
          v?.destroy({ children: true });
          this.views.delete(u.id);
          continue;
        }
        if (!v) {
          v = this.add(new Container());
          const fw = fpW(u.size), fh = fpH(u.size);
          const k = colour(u.owner) * 4;
          for (let y = 0; y < fh; y++)
            for (let x = 0; x < fw; x++) {
              const part = fw > fh ? (y === 0 ? 0 : 1) : x === 0 ? 2 : 3;
              const s = new Sprite(this.bridgeTex[k + part]);
              s.position.set(x * CELL_W, y * CELL_H);
              v.addChild(s);
            }
          this.views.set(u.id, v);
        }
      }
      v.position.set(cx * CELL_W, cy * CELL_H);
      v.visible = !hidden(u);
      seen.add(u.id);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.destroy({ children: true });
      this.views.delete(id);
      this.masks.delete(id);
    }
  }

  private add<T extends Container>(c: T): T {
    this.layer.addChild(c);
    return c;
  }

  /** One wall cell: six tiles from the table row for its mask and x parity, 0xFF left see-through. */
  private wallTexture(colour: number, mask: number, odd: number, damage: number): Texture {
    const key = `${colour}:${mask}:${odd}:${damage}`;
    let t = this.wallTex.get(key);
    if (t) return t;
    const art = this.art!;
    const table = odd ? art.wallOdd : art.wallEven;
    const c = document.createElement('canvas');
    c.width = CELL_W;
    c.height = CELL_H;
    const ctx = c.getContext('2d')!;
    for (let k = 0; k < 6; k++) {
      const b = table[mask * 6 + k]!;
      if (b === 0xff) continue;
      const i = wallTileIndex(b, damage);
      ctx.drawImage(this.atlas!, i * 8, colour * 8, 8, 8, (k % 3) * 8, Math.floor(k / 3) * 8, 8, 8);
    }
    t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    this.wallTex.set(key, t);
    return t;
  }
}

function canvasOf(width: number, height: number, data: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d')!.putImageData(new ImageData(data.slice(), width, height), 0, 0);
  return c;
}

/** The map's bridge sites with the bridge that fits each (sim sizeBridge). */
export const bridgeSitesOf = (marks: readonly { x: number; y: number; vertical: boolean }[], sizeOf: (x: number, y: number, vertical: boolean) => number, width: number): BridgeSite[] =>
  marks.map((m) => ({ cell: m.y * width + m.x, type: sizeOf(m.x, m.y, m.vertical) }));

/**
 * The bridge site a tap at cell (cx, cy) picks (0x020AAD50): the nearest one whose start or end
 * is under 4 cells away (Manhattan). confirmed (code; tried on mp04 in the emulator)
 */
export function siteNear(w: World, cx: number, cy: number): BridgeSite | null {
  const g = w.grid;
  if (!g) return null;
  let best: BridgeSite | null = null;
  let bestD = 4;
  for (const s of w.bridgeSites) {
    const t = w.types[s.type];
    if (!t) continue;
    const x = s.cell % g.width, y = Math.floor(s.cell / g.width);
    const vertical = (BRIDGE_TYPES.v as readonly number[]).includes(s.type);
    const ex = vertical ? x : x + fpW(t.size), ey = vertical ? y + fpH(t.size) : y;
    const d = Math.min(Math.abs(cx - x) + Math.abs(cy - y), Math.abs(cx - ex) + Math.abs(cy - ey));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
