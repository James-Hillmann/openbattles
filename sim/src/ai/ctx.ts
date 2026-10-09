import type { Command } from '../commands';
import { cellCenterX, cellCenterY } from '../terrain';
import type { EntityType, Player, Unit, World } from '../state';
import { getPlayer, isBuilding, isFinished, isInside, popCap, popUsed, ROLE_BASE, ROLE_BUILDER, ROLE_HERO, ROLE_TRANSPORT, TERRAIN_TREE } from '../economy';
import { unitCell } from '../movement';
import { fpH, fpW } from '../footprint';
import type { AiPlayer, AiRequest } from './state';

/** One AI pass: the world, the AI, and the commands it gives this tick. */
export interface Ctx {
  w: World;
  ai: AiPlayer;
  me: Player;
  out: Command[];
  /** Own live units and buildings, by id. */
  own: Unit[];
}

export const W = (c: Ctx) => c.w.grid!.width;
export const H = (c: Ctx) => c.w.grid!.height;
export const cx = (c: Ctx, cell: number) => cell % W(c);
export const cy = (c: Ctx, cell: number) => Math.floor(cell / W(c));
export const cellOfXY = (c: Ctx, x: number, y: number) => y * W(c) + x;
export const manhattan = (c: Ctx, a: number, b: number) => Math.abs(cx(c, a) - cx(c, b)) + Math.abs(cy(c, a) - cy(c, b));
export const cheb = (c: Ctx, a: number, b: number) => Math.max(Math.abs(cx(c, a) - cx(c, b)), Math.abs(cy(c, a) - cy(c, b)));

/** The cell a unit stands on, or a building's top-left cell. */
export const at = (c: Ctx, u: Unit) => unitCell(c.w, u);

export const isArmy = (u: Unit) => u.role === ROLE_HERO || (u.role >= 2 && u.role <= 6 && u.role !== ROLE_TRANSPORT);
export const builders = (c: Ctx) => c.own.filter((u) => u.role === ROLE_BUILDER);
export const ofRole = (c: Ctx, role: number) => c.own.filter((u) => u.role === role);
export const finishedOfRole = (c: Ctx, role: number) => c.own.filter((u) => u.role === role && isFinished(u));
export const enemies = (c: Ctx) => c.w.units.filter((u) => u.owner !== c.ai.player && u.hp > 0 && !isInside(u));

/** A builder with nothing to do (game: squad task 0x22, idle). */
export const isIdleBuilder = (u: Unit) => u.role === ROLE_BUILDER && u.job === null && u.tx === null;
export const isHarvesting = (u: Unit) => u.job !== null && (u.job.kind === 'chop' || u.job.kind === 'deliver' || (u.job.kind === 'inside' && u.job.tree >= 0));

/** Entity kinds of a role the player may make: its army's units, or its base faction's buildings. */
export function kindsOfRole(c: Ctx, role: number): number[] {
  const army = c.me.army;
  const base = army?.base ?? c.w.types[c.own.find((u) => u.role === ROLE_BASE)?.kind ?? -1]?.faction;
  const out: number[] = [];
  if (role < ROLE_BASE && army) {
    for (const k of army.units) if (k >= 0 && c.w.types[k]?.role === role && !out.includes(k)) out.push(k);
    return out;
  }
  c.w.types.forEach((t, k) => {
    if (t && t.role === role && t.faction === base) out.push(k);
  });
  return out;
}

export const typeOf = (c: Ctx, kind: number): EntityType | undefined => c.w.types[kind];

/**
 * Free slots in the game's per-player limit table (Team_freeSlots 0x02086088): category 1 is the
 * 20 builders and soldiers (roles 1-4), category 2 the 4 transports and specials (roles 5-6). Units
 * paid for and in training count. confirmed (code and RAM)
 */
export function freeSlots(c: Ctx, cat: 1 | 2): number {
  const inCat = (role: number) => (cat === 1 ? role >= 1 && role <= 4 : role === 5 || role === 6);
  let n = c.own.filter((u) => inCat(u.role)).length;
  for (const b of c.own) {
    if (b.prod >= 0 && b.queue.length) {
      const t = c.w.types[b.queue[0]!];
      if (t && inCat(t.role)) n++;
    }
  }
  return Math.max(0, (cat === 1 ? 20 : 4) - n);
}

/** Room under the farm-based population cap (Team_freePopulation). */
export const freePop = (c: Ctx) => popCap(c.w, c.ai.player) - popUsed(c.w, c.ai.player);

/** Push a request into a queue of `cap` (BuildQueue_push 0x0208CA30). */
export function pushRequest(q: AiRequest[], cap: number, item: AiRequest, force: boolean): void {
  if (q.length < cap) {
    q.push(item);
    return;
  }
  let lo = 0;
  for (let i = 1; i < q.length; i++) if (q[i]!.prio < q[lo]!.prio) lo = i;
  if (q[lo]!.prio < item.prio || force) {
    q.splice(lo, 1);
    q.push(item);
  }
}

/** Requests of a role pending in a queue, plus units of that role already training for this player. */
export function queuedOfRole(c: Ctx, q: readonly AiRequest[], role: number): number {
  let n = q.filter((r) => c.w.types[r.kind]?.role === role).length;
  for (const b of c.own) for (const k of b.queue) if (c.w.types[k]?.role === role) n++;
  return n;
}

/** Nearest cell to `from` (rings 0..r-1, row-major within a ring) of terrain `code` (FindNearestGroundType 0x0207FEF0). */
export function nearestTerrain(c: Ctx, from: number, code: number, r: number): number {
  const g = c.w.grid!;
  const x0 = cx(c, from), y0 = cy(c, from);
  for (let d = 0; d < r; d++) {
    for (let y = y0 - d; y <= y0 + d; y++) {
      for (let x = x0 - d; x <= x0 + d; x++) {
        if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== d || x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
        if (g.cells[y * g.width + x] === code) return y * g.width + x;
      }
    }
  }
  return -1;
}
export const nearestTree = (c: Ctx, from: number, r: number) => nearestTerrain(c, from, TERRAIN_TREE, r);

/** Sum of the strength (+0x70, our `priority`) of `owner`'s enemies within `r` cells (Chebyshev) of a cell. */
export function strengthNear(c: Ctx, cell: number, r: number, of: 'enemy' | 'own' = 'enemy'): number {
  let s = 0;
  for (const u of c.w.units) {
    if (u.hp === 0 || isInside(u) || (of === 'enemy') === (u.owner === c.ai.player)) continue;
    if (cheb(c, at(c, u), cell) <= r) s += u.priority;
  }
  return s;
}

export function issueMove(c: Ctx, ids: number[], cell: number, mode: number): void {
  if (!ids.length) return;
  const cmd: Command = { kind: 'move', unitIds: ids, x: cellCenterX(cx(c, cell)), y: cellCenterY(cy(c, cell)) };
  if (mode === 2) cmd.mode = 2;
  c.out.push(cmd);
}

/** Middle cell of a building's footprint (where the game measures from). */
export function centre(c: Ctx, u: Unit): number {
  const o = at(c, u);
  if (!isBuilding(u)) return o;
  return cellOfXY(c, cx(c, o) + (fpW(u.size) >> 1), cy(c, o) + (fpH(u.size) >> 1));
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export { getPlayer };
