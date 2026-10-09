import { Container, Sprite, Texture } from 'pixi.js';
import { BLUE_STUD_VBLANKS, FE_TEXT, type ParticleFx, type Rgba } from '@lbw/extract';
import { CELL_H, CELL_W, PICKUP_STUD, STAT_BUILDING, STAT_MINIFIG, STAT_SPECIAL, TICK_HZ, fxToFloat, isBuilding, type Unit, type World } from '@lbw/sim';
import { DeathFx, type DeathAt } from './deathFx';

/**
 * Match extras the renderer draws on top of the sim: Blue Studs lying on the map, death bursts,
 * and the score table at the end. Drawing only; nothing here feeds back into the sim.
 */
export class MatchExtras {
  private deathFx: DeathFx | null = null;
  private deathSprite = new Sprite();
  private studFrames: Texture[] = [];
  private pickupSprites = new Map<number, Sprite>();

  constructor(private readonly layer: Container) {
    layer.addChild(this.deathSprite);
    this.deathSprite.visible = false;
  }

  /** New ROM effects; also drops anything still playing. */
  setParticles(fx: ParticleFx | undefined, textureFrom: (img: Rgba) => Texture): void {
    this.deathFx = fx ? new DeathFx(fx) : null;
    this.studFrames = (fx?.blueStud ?? []).map(textureFrom);
    this.reset();
  }

  reset(): void {
    for (const s of this.pickupSprites.values()) s.destroy();
    this.pickupSprites.clear();
  }

  /** After each sim tick: start the bursts for whatever died in it. `now` is the render tick. */
  onTick(w: World, now: number, visible: (u: Unit) => boolean): void {
    if (!this.deathFx) return;
    for (const u of w.lastDead ?? []) if (visible(u)) this.deathFx.add(deathAt(u), now);
  }

  /** Draw the pickups and bursts for render tick `now`. `seen(cell)` hides pickups under fog. */
  render(w: World, now: number, seen: (cell: number) => boolean): void {
    const width = w.grid?.width ?? 0;
    const live = new Set<number>();
    for (const p of w.pickups) {
      if (p.type !== PICKUP_STUD || !this.studFrames.length || !width) continue;
      let s = this.pickupSprites.get(p.id);
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5, 0.5);
        this.layer.addChild(s);
        this.pickupSprites.set(p.id, s);
      }
      live.add(p.id);
      // One picture per 3 VBlanks (render ticks are 2 VBlanks at 30 Hz).
      s.texture = this.studFrames[Math.floor((now * 2) / BLUE_STUD_VBLANKS) % this.studFrames.length]!;
      const cx = p.cell % width;
      const cy = Math.floor(p.cell / width);
      s.position.set(cx * CELL_W + CELL_W / 2, cy * CELL_H + CELL_H / 2);
      s.zIndex = cy * CELL_H + CELL_H / 2;
      s.visible = seen(p.cell);
    }
    for (const [id, s] of this.pickupSprites) {
      if (live.has(id)) continue;
      s.destroy();
      this.pickupSprites.delete(id);
    }
    const burst = this.deathFx?.draw(now);
    this.deathSprite.visible = !!burst;
    if (burst) {
      if (this.deathSprite.texture.source?.resource !== burst.canvas) {
        this.deathSprite.texture = Texture.from(burst.canvas);
        this.deathSprite.texture.source.scaleMode = 'nearest';
      } else this.deathSprite.texture.source.update();
      this.deathSprite.position.set(burst.x, burst.y);
      this.deathSprite.zIndex = 1e6;
    }
  }
}

function deathAt(u: Unit): DeathAt {
  const x = fxToFloat(u.x);
  const y = fxToFloat(u.y);
  if (!isBuilding(u)) return { x, y };
  // A building's x, y is the middle of its footprint's top-left cell (world.ts placeBuilding).
  return { x, y, building: { left: x - CELL_W / 2, top: y - CELL_H / 2, w: u.size * CELL_W, h: u.size * CELL_H } };
}

/** "<1>:<2>:<3>" with hours, minutes, seconds of play. */
function playTime(ticks: number, format: string): string {
  const s = Math.floor(ticks / TICK_HZ);
  const two = (n: number) => String(n).padStart(2, '0');
  return format.replace('<1>', String(Math.floor(s / 3600))).replace('<2>', two(Math.floor(s / 60) % 60)).replace('<3>', two(s % 60));
}

/**
 * The end-of-match score table: the game's SkirmishScore rows (LANG 323-335, values from the
 * per-player stat records; docs/re-notes/score.md), one column per player. The layout is ours.
 */
export function scoreTable(w: World, text: Record<number, string>, online: boolean, names: string[]): string {
  const t = (id: number, fallback: string) => text[id] || fallback;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows: [string, (i: number) => string | number][] = [
    [t(FE_TEXT.minifigsBuilt, 'Minifigures Built'), (i) => stat(w, i, 'built', STAT_MINIFIG)],
    [t(FE_TEXT.specialsBuilt, 'Specials Built'), (i) => stat(w, i, 'built', STAT_SPECIAL)],
    [t(FE_TEXT.buildingsBuilt, 'Buildings Built'), (i) => stat(w, i, 'built', STAT_BUILDING)],
    [t(FE_TEXT.minifigsLost, 'Minifigures Lost'), (i) => stat(w, i, 'lost', STAT_MINIFIG)],
    [t(FE_TEXT.specialsLost, 'Specials Lost'), (i) => stat(w, i, 'lost', STAT_SPECIAL)],
    [t(FE_TEXT.buildingsLost, 'Buildings Lost'), (i) => stat(w, i, 'lost', STAT_BUILDING)],
    [t(FE_TEXT.minifigsDestroyed, 'Minifigures Destroyed'), (i) => stat(w, i, 'destroyed', STAT_MINIFIG)],
    [t(FE_TEXT.specialsDestroyed, 'Specials Destroyed'), (i) => stat(w, i, 'destroyed', STAT_SPECIAL)],
    [t(FE_TEXT.buildingsDestroyed, 'Buildings Destroyed'), (i) => stat(w, i, 'destroyed', STAT_BUILDING)],
    [t(FE_TEXT.bricksCollected, 'Bricks Collected'), (i) => w.players[i]?.stats?.bricks ?? 0],
    [t(FE_TEXT.bricksBalance, 'Bricks Balance'), (i) => w.players[i]?.bricks ?? 0],
  ];
  const head = w.players.map((_, i) => `<th>${esc(names[i] ?? `P${i + 1}`)}</th>`).join('');
  const body = rows.map(([label, v]) => `<tr><td>${esc(label)}</td>${w.players.map((_, i) => `<td>${v(i)}</td>`).join('')}</tr>`).join('');
  const time = `<tr><td>${esc(t(FE_TEXT.time, 'Time'))}</td><td colspan="${w.players.length}">${esc(playTime(w.tick, t(FE_TEXT.timeFormat, '<1>:<2>:<3>')))}</td></tr>`;
  const title = online ? t(FE_TEXT.multiplayerScore, 'Multiplayer Score') : t(FE_TEXT.freePlayScore, 'Free Play Score');
  return `<h2>${esc(title)}</h2><table><tr><th>${esc(t(FE_TEXT.stats, 'Stats'))}</th>${head}</tr>${body}${time}</table>`;
}

const stat = (w: World, i: number, key: 'built' | 'lost' | 'destroyed', c: number) => w.players[i]?.stats?.[key][c] ?? 0;
