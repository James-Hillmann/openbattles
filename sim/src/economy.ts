import { cellCenterX, cellCenterY, isWalkableCode, type TerrainGrid } from './terrain';
import type { EntityId, EntityType, Player, PlayerId, Unit, World } from './state';
import { orderMove, stopMove, unitCell } from './movement';
import { findById } from './combat';

/**
 * Bricks, gathering, construction and production, ported from the game's
 * HarvestAction / ConstructProgressAction / ProduceUnitEntityCommand and the
 * player object in ARM9. Numbers and confidence: docs/re-notes/economy.md.
 */

/** Skirmish starting bricks (HUD and RAM at match start). confirmed */
export const START_BRICKS = 500;
/** addBricks (0x020866C0) clamps here. confirmed (code) */
export const MAX_BRICKS = 500000;
/** Every player gets TRICKLE_BRICKS every 60 s of game time (0x02083720). confirmed */
export const TRICKLE_TICKS = 1800;
export const TRICKLE_BRICKS = 5;
/** One tree takes 150 ticks to chop (0x020531D8). confirmed */
export const CHOP_TICKS = 150;
/** Bricks per delivered load, +25 once the player has a finished Lumber Mill (0x0206D0C0). confirmed */
export const LOAD_BRICKS = 75;
export const LUMBER_MILL_BONUS = 25;
/** A finished Mine pays its +0x6C (25) every 2.5 s (0x0206D6C8). likely (code, not watched) */
export const MINE_TICKS = 75;
/** Population cap = 4 + 4 per finished Farm; star cap = finished Farms (0x02085D90). confirmed */
export const BASE_POP = 4;
export const POP_PER_FARM = 4;
/** Production queue length. guess */
export const QUEUE_MAX = 5;
/** How far a builder looks for the next tree after a delivery. guess */
export const TREE_SEARCH_RADIUS = 10;

/** Terrain codes the economy writes into the grid. */
export const TERRAIN_OPEN = 0;
export const TERRAIN_TREE = 1;
/**
 * Our code for cells under a building. 4 is unused in the skirmish maps and the
 * game's terrain check (0x02001510) refuses it for every unit, so it blocks
 * ground units and flyers alike. How the game itself blocks footprints (its
 * occupancy grid?) is not traced; whether flyers cross buildings is open.
 */
export const TERRAIN_BUILDING = 4;

export const ROLE_HERO = 0;
export const ROLE_BUILDER = 1;
export const ROLE_TRANSPORT = 5;
export const ROLE_SIEGE = 6;
export const ROLE_BASE = 7;
export const ROLE_LUMBER_MILL = 8;
export const ROLE_MINE = 9;
export const ROLE_FARM = 10;

export const ROLE_BARRACKS = 11;
export const ROLE_STABLES = 12;
export const ROLE_SHIPYARD = 16;

/**
 * Unit roles each production building trains, by building role. Castle (hero, builder) and
 * Barracks (melee, ranged, mounted) are confirmed from their build strips in the emulator;
 * Stables (the star units) and Shipyard (transport) are a guess from their icons and costs.
 */
export const TRAINS: Readonly<Record<number, readonly number[]>> = {
  [ROLE_BASE]: [ROLE_HERO, ROLE_BUILDER],
  [ROLE_BARRACKS]: [2, 3, 4],
  [ROLE_STABLES]: [ROLE_SIEGE],
  [ROLE_SHIPYARD]: [ROLE_TRANSPORT],
};

export const isBuilding = (u: Unit): boolean => u.role >= ROLE_BASE;
export const isFinished = (u: Unit): boolean => u.progress >= u.buildTime;

export function getPlayer(w: World, id: PlayerId): Player | undefined {
  return w.players.find((p) => p.id === id);
}

export function addBricks(p: Player, n: number): void {
  p.bricks = Math.min(MAX_BRICKS, p.bricks + n);
}

/** Pay n bricks if the player has them (0x020866F0). */
export function spendBricks(p: Player, n: number): boolean {
  if (p.bricks < n) return false;
  p.bricks -= n;
  return true;
}

const finishedOfRole = (w: World, owner: PlayerId, role: number): number =>
  w.units.filter((u) => u.owner === owner && u.hp > 0 && u.role === role && isFinished(u)).length;

export const popCap = (w: World, owner: PlayerId): number => BASE_POP + POP_PER_FARM * finishedOfRole(w, owner, ROLE_FARM);
export const starCap = (w: World, owner: PlayerId): number => finishedOfRole(w, owner, ROLE_FARM);

/** Pop counts roles 1-5; the hero and siege units don't (0x02086524). */
const takesPop = (role: number) => role >= ROLE_BUILDER && role <= ROLE_TRANSPORT;
/** Stars count transports and siege units (0x02085F54). */
const takesStar = (role: number) => role === ROLE_TRANSPORT || role === ROLE_SIEGE;

export function popUsed(w: World, owner: PlayerId): number {
  const n = w.units.filter((u) => u.owner === owner && u.hp > 0 && takesPop(u.role)).length;
  return n + (getPlayer(w, owner)?.reservedPop ?? 0);
}

export function starsUsed(w: World, owner: PlayerId): number {
  const n = w.units.filter((u) => u.owner === owner && u.hp > 0 && takesStar(u.role)).length;
  return n + (getPlayer(w, owner)?.reservedStars ?? 0);
}

// ---- cells ----

const cellX = (g: TerrainGrid, c: number) => c % g.width;
const cellY = (g: TerrainGrid, c: number) => Math.floor(c / g.width);

/** Top-left footprint cell of a building (its position is that cell's centre). */
export const originCell = (w: World, b: Unit): number => unitCell(w, b);

/** Chebyshev distance from cell c to a size x size rectangle at `origin` (0 = inside). */
function rectDist(g: TerrainGrid, c: number, origin: number, size: number): number {
  const x = cellX(g, c), y = cellY(g, c);
  const ox = cellX(g, origin), oy = cellY(g, origin);
  const dx = x < ox ? ox - x : x >= ox + size ? x - (ox + size - 1) : 0;
  const dy = y < oy ? oy - y : y >= oy + size ? y - (oy + size - 1) : 0;
  return Math.max(dx, dy);
}

const freeFor = (w: World, c: number, u: Unit | null): boolean =>
  isWalkableCode(w.grid!.cells[c]!) && (w.occ![c] === 0 || (u !== null && w.occ![c] === u.id));

/**
 * Cells (y * width + x) at Chebyshev distance r from (cx, cy), on the map,
 * row-major. A fixed order, so ties are the same on every client.
 */
function ring(g: TerrainGrid, cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 0 || y >= g.height) continue;
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= g.width) continue;
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === r) out.push(y * g.width + x);
    }
  }
  return out;
}

/** The free cell next to a rectangle closest to unit u (ties: lowest cell index), or -1. */
function standCell(w: World, u: Unit, origin: number, size: number): number {
  const g = w.grid!;
  const here = unitCell(w, u);
  let best = -1;
  let bestD = Infinity;
  const ox = cellX(g, origin), oy = cellY(g, origin);
  for (let y = oy - 1; y <= oy + size; y++) {
    for (let x = ox - 1; x <= ox + size; x++) {
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
      const c = y * g.width + x;
      if (rectDist(g, c, origin, size) !== 1 || !freeFor(w, c, u)) continue;
      const d = Math.max(Math.abs(x - cellX(g, here)), Math.abs(y - cellY(g, here)));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/**
 * Walk next to a rectangle, or report that u is standing next to it.
 * Returns false when there is nowhere to stand.
 */
function approach(w: World, u: Unit, origin: number, size: number): 'there' | 'walking' | 'stuck' {
  const g = w.grid!;
  if (rectDist(g, unitCell(w, u), origin, size) === 1) return u.mv ? 'walking' : 'there';
  if (u.mv) return 'walking';
  const c = standCell(w, u, origin, size);
  if (c < 0) return 'stuck';
  orderMove(w, u, c);
  return 'walking';
}

/** Nearest tree to cell c within TREE_SEARCH_RADIUS (Chebyshev rings, row-major), or -1. */
function nearestTree(g: TerrainGrid, c: number): number {
  for (let r = 0; r <= TREE_SEARCH_RADIUS; r++)
    for (const t of ring(g, cellX(g, c), cellY(g, c), r)) if (g.cells[t] === TERRAIN_TREE) return t;
  return -1;
}

/**
 * Where a builder drops its load: the owner's finished building with the
 * smallest Manhattan distance from the builder's cell to the building's
 * top-left cell (0x0206CD70). Ties: lowest id.
 */
function nearestDrop(w: World, u: Unit): Unit | undefined {
  const g = w.grid!;
  const here = unitCell(w, u);
  let best: Unit | undefined;
  let bestD = Infinity;
  for (const b of w.units) {
    if (b.owner !== u.owner || b.hp <= 0 || !isBuilding(b) || !isFinished(b)) continue;
    const o = originCell(w, b);
    const d = Math.abs(cellX(g, o) - cellX(g, here)) + Math.abs(cellY(g, o) - cellY(g, here));
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Bricks for one delivered load (0x0206D0C0). */
const loadValue = (w: World, owner: PlayerId): number =>
  LOAD_BRICKS + (finishedOfRole(w, owner, ROLE_LUMBER_MILL) > 0 ? LUMBER_MILL_BONUS : 0);

// ---- commands ----

const ownBuilders = (w: World, player: PlayerId, ids: readonly EntityId[]) =>
  w.units.filter((u) => u.owner === player && u.role === ROLE_BUILDER && ids.includes(u.id));

export function orderHarvest(w: World, player: PlayerId, ids: readonly EntityId[], cx: number, cy: number): void {
  const g = w.grid;
  if (!g || cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) return;
  const tree = cy * g.width + cx;
  if (g.cells[tree] !== TERRAIN_TREE) return;
  for (const u of ownBuilders(w, player, ids)) {
    u.target = null;
    stopMove(w, u); // a new order replaces the walk in progress (our rule)
    u.job = u.carrying ? { kind: 'deliver', tree, drop: 0 } : { kind: 'chop', tree, timer: CHOP_TICKS };
  }
}

/** Can a building of type t stand with its top-left at (cx, cy)? */
export function canPlace(w: World, t: EntityType, cx: number, cy: number): boolean {
  const g = w.grid;
  if (!g || cx < 0 || cy < 0 || cx + t.size > g.width || cy + t.size > g.height) return false;
  if (t.role === ROLE_MINE && !w.mineSites.includes(cy * g.width + cx)) return false;
  for (let y = cy; y < cy + t.size; y++)
    for (let x = cx; x < cx + t.size; x++) if (!freeFor(w, y * g.width + x, null)) return false;
  return true;
}

export type SpawnFn = (w: World, owner: PlayerId, t: EntityType, cell: number) => Unit;
export type PlaceFn = (w: World, owner: PlayerId, t: EntityType, cx: number, cy: number, finished: boolean) => Unit;

/**
 * May `player` build or train type t from `by`? With an army (picked on the army screen),
 * units must be in it and buildings of its base faction. Without one, a faction's strip only
 * lists its own entities (build-ui.md); types without a faction are unrestricted.
 */
const allowed = (w: World, player: PlayerId, by: Unit, t: EntityType): boolean => {
  const army = getPlayer(w, player)?.army;
  if (army) return t.role >= ROLE_BASE ? t.faction === army.base : army.units.includes(t.kind);
  const f = w.types[by.kind]?.faction;
  return f === undefined || t.faction === undefined || f === t.faction;
};

export function orderBuild(w: World, player: PlayerId, ids: readonly EntityId[], type: number, cx: number, cy: number, place: PlaceFn): void {
  const t = w.types[type];
  const p = getPlayer(w, player);
  const builders = ownBuilders(w, player, ids);
  if (!t || !p || t.role < ROLE_BASE || builders.length === 0 || !allowed(w, player, builders[0]!, t) || !canPlace(w, t, cx, cy)) return;
  if (!spendBricks(p, t.cost)) return;
  const site = place(w, player, t, cx, cy, false);
  for (const u of builders) setBuildJob(w, u, site);
}

function setBuildJob(w: World, u: Unit, site: Unit): void {
  u.target = null;
  stopMove(w, u); // a new order replaces the walk in progress (our rule)
  u.job = { kind: 'build', site: site.id };
}

export function orderConstruct(w: World, player: PlayerId, ids: readonly EntityId[], site: EntityId): void {
  const s = findById(w.units, site);
  if (!s || s.owner !== player || !isBuilding(s) || isFinished(s)) return;
  for (const u of ownBuilders(w, player, ids)) setBuildJob(w, u, s);
}

export function orderTrain(w: World, player: PlayerId, building: EntityId, type: number): void {
  const b = findById(w.units, building);
  const t = w.types[type];
  const p = getPlayer(w, player);
  if (!b || !t || !p || b.owner !== player || !isBuilding(b) || !isFinished(b)) return;
  if (!(TRAINS[b.role] ?? []).includes(t.role) || !allowed(w, player, b, t) || b.queue.length >= QUEUE_MAX) return;
  // One hero at a time: the Castle only offers it while the hero is down. guess
  if (t.role === ROLE_HERO && (w.units.some((u) => u.owner === player && u.hp > 0 && u.role === ROLE_HERO) || w.units.some((u) => u.owner === player && u.queue.some((k) => w.types[k]?.role === ROLE_HERO)))) return;
  if (takesPop(t.role) && popUsed(w, player) + 1 > popCap(w, player)) return;
  if (takesStar(t.role) && starsUsed(w, player) + 1 > starCap(w, player)) return;
  if (!spendBricks(p, t.cost)) return;
  if (takesPop(t.role)) p.reservedPop++;
  if (takesStar(t.role)) p.reservedStars++;
  b.queue.push(type);
}

// ---- per tick ----

function stepJob(w: World, u: Unit): void {
  const g = w.grid!;
  const job = u.job!;
  switch (job.kind) {
    case 'chop': {
      if (g.cells[job.tree] !== TERRAIN_TREE) {
        const next = nearestTree(g, job.tree);
        if (next < 0) u.job = null;
        else u.job = { kind: 'chop', tree: next, timer: CHOP_TICKS };
        return;
      }
      const a = approach(w, u, job.tree, 1);
      if (a === 'stuck') u.job = null;
      if (a !== 'there') return;
      if (--job.timer > 0) return;
      g.cells[job.tree] = TERRAIN_OPEN;
      u.carrying = true;
      u.job = { kind: 'deliver', tree: job.tree, drop: 0 };
      return;
    }
    case 'deliver': {
      let d = findById(w.units, job.drop);
      if (!d || d.hp <= 0 || d.owner !== u.owner || !isFinished(d)) {
        d = nearestDrop(w, u);
        if (!d) return; // nowhere to take it: hold the load
        job.drop = d.id;
      }
      if (approach(w, u, originCell(w, d), d.size) !== 'there') return;
      const p = getPlayer(w, u.owner);
      // The logging buff (spell 19, buff slot 3) doubles the load; it counts only if still on at drop-off (0x0206D1A0).
      if (p) addBricks(p, loadValue(w, u.owner) * (u.boost & (1 << 3) ? 2 : 1));
      u.carrying = false;
      const next = g.cells[job.tree] === TERRAIN_TREE ? job.tree : nearestTree(g, job.tree);
      u.job = next < 0 ? null : { kind: 'chop', tree: next, timer: CHOP_TICKS };
      return;
    }
    case 'build': {
      const s = findById(w.units, job.site);
      if (!s || s.hp <= 0 || isFinished(s)) {
        u.job = null;
        return;
      }
      if (approach(w, u, originCell(w, s), s.size) === 'stuck') u.job = null;
      return;
    }
  }
}

/** A builder standing next to the site, not walking, with a build job on it. */
function isBuildingOn(w: World, u: Unit, s: Unit): boolean {
  return (
    u.hp > 0 && u.owner === s.owner && u.job?.kind === 'build' && u.job.site === s.id && !u.mv &&
    rectDist(w.grid!, unitCell(w, u), originCell(w, s), s.size) === 1
  );
}

/**
 * One tick of construction: a site with at least one builder at work gains a
 * tick of progress, and HP follows progress (seen in the emulator on a Farm:
 * 360 ticks, HP rising ~1 a tick). Whether more builders build faster: open.
 */
function stepConstruction(w: World, s: Unit): void {
  if (!w.units.some((u) => isBuildingOn(w, u, s))) return;
  const before = Math.max(1, Math.floor((s.maxHp * s.progress) / s.buildTime));
  s.progress++;
  const after = Math.max(1, Math.floor((s.maxHp * s.progress) / s.buildTime));
  s.hp = Math.min(s.maxHp, s.hp + after - before);
  if (!isFinished(s)) return;
  if (s.role === ROLE_MINE) s.payout = MINE_TICKS;
  for (const u of w.units) if (u.job?.kind === 'build' && u.job.site === s.id) u.job = null;
}

/** First free walkable cell around the spot below a building's bottom row, by Chebyshev rings. */
/** Nearest free, walkable ground cell to (cx, cy) by Chebyshev rings, or -1 within `radius`. */
export function freeCellNear(w: World, cx: number, cy: number, radius: number): number {
  const g = w.grid!;
  for (let r = 0; r <= radius; r++) for (const c of ring(g, cx, cy, r)) if (freeFor(w, c, null)) return c;
  return -1;
}

function exitCell(w: World, b: Unit): number {
  const g = w.grid!;
  const o = originCell(w, b);
  const cx = cellX(g, o) + (b.size >> 1);
  const cy = cellY(g, o) + b.size;
  return freeCellNear(w, cx, cy, 7);
}

function stepProduction(w: World, b: Unit, spawn: SpawnFn): void {
  const kind = b.queue[0];
  if (kind === undefined) return;
  const t = w.types[kind];
  if (!t) {
    b.queue.shift();
    return;
  }
  if (b.prod < t.buildTime) b.prod++;
  if (b.prod < t.buildTime) return;
  const c = exitCell(w, b);
  if (c < 0) return; // no room: wait
  const p = getPlayer(w, b.owner);
  if (p && takesPop(t.role)) p.reservedPop--;
  if (p && takesStar(t.role)) p.reservedStars--;
  b.queue.shift();
  b.prod = 0;
  spawn(w, b.owner, t, c);
}

function stepMine(w: World, m: Unit): void {
  if (--m.payout > 0) return;
  m.payout = MINE_TICKS;
  const t = w.types[m.kind];
  const p = getPlayer(w, m.owner);
  // The mining buff (spell 17, buff slot 4) doubles the payout, not the interval (0x0206D7D0; likely).
  if (t && p) addBricks(p, t.yield * (m.boost & (1 << 4) ? 2 : 1));
}

/** Economy for one tick, after combat and movement. */
export function economyStep(w: World, spawn: SpawnFn): void {
  if (w.grid && w.occ) {
    for (const u of w.units) if (u.hp > 0 && u.job && u.frozen <= w.tick) stepJob(w, u); // frozen builders wait (spells.ts)
    for (const b of w.units) {
      if (b.hp <= 0 || !isBuilding(b)) continue;
      if (!isFinished(b)) stepConstruction(w, b);
      else if (b.role === ROLE_MINE) stepMine(w, b);
      else stepProduction(w, b, spawn);
    }
  }
  // The game bumps its time counter, then pays out when it is a multiple of 60 s.
  if ((w.tick + 1) % TRICKLE_TICKS === 0) for (const p of w.players) addBricks(p, TRICKLE_BRICKS);
}

/** Free a destroyed building's footprint. */
export function clearFootprint(w: World, b: Unit): void {
  const g = w.grid;
  if (!g || !isBuilding(b)) return;
  const o = originCell(w, b);
  for (let y = cellY(g, o); y < Math.min(g.height, cellY(g, o) + b.size); y++)
    for (let x = cellX(g, o); x < Math.min(g.width, cellX(g, o) + b.size); x++)
      if (g.cells[y * g.width + x] === TERRAIN_BUILDING) g.cells[y * g.width + x] = TERRAIN_OPEN;
}

/** Position for a unit spawned in a cell: the cell's centre. */
export const cellPos = (g: TerrainGrid, c: number) => ({ x: cellCenterX(cellX(g, c)), y: cellCenterY(cellY(g, c)) });

