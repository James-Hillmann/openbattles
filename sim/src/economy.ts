import { MOVES_GROUND, cellCenterX, cellCenterY, isWalkableCode, type TerrainGrid } from './terrain';
import type { EntityId, EntityType, Job, Player, PlayerId, Unit, World } from './state';
import { orderMove, placeUnit, removeUnit, stopMove, unitCell } from './movement';
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
/**
 * Hard ceilings on those caps, from the per-player limit table at 0x02126CA4 (hero 1, pop 20, stars 4),
 * applied by 0x020863B8 and the HUD (0x020E018C). confirmed (code; matches a playtester's report)
 */
export const MAX_HEROES = 1;
export const MAX_POP = 20;
export const MAX_STARS = 4;
/**
 * Production queue per building: 3 entries, the one in training included (0x02084A08 drops a 4th order).
 * confirmed (code and emulator; docs/re-notes/economy.md "Training queue")
 */
export const QUEUE_MAX = 3;
/** An idle building looks at its queue every 10 ticks (0x0206DA60). confirmed (code); phase guess */
export const PROD_IDLE_CHECK = 10;
/** `prod` while the front unit hasn't started: wait for the next 10-tick check, or try every tick. */
export const PROD_IDLE = -2;
export const PROD_READY = -1;
/**
 * A Builder dropping off a load goes inside the building: in the tick after it arrives (bricks paid then),
 * out DROP_TICKS ticks after it arrived, at the building's exit cell. confirmed (emulator, 10 drop-offs;
 * HarvestEngineerEntityCommand 0x0206C780: enter, a 20-tick DelayAction, come out)
 */
export const DROP_TICKS = 24;
/**
 * A Builder builds from inside the site and comes out this many ticks after it is finished (the building's
 * 20-tick bounce, 0x02051C40, then the exit). confirmed (emulator, one Farm: 17-18 ticks)
 */
export const SITE_EXIT_TICKS = 18;
/** How far a builder looks for the next tree after a delivery. guess */
export const TREE_SEARCH_RADIUS = 10;

/** Terrain codes the economy writes into the grid. */
export const TERRAIN_OPEN = 0;
export const TERRAIN_TREE = 1;
export const TERRAIN_WATER = 3;
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
/** A Builder inside a building (dropping off or building): off the map, not drawn, not targetable. */
export const isInside = (u: Unit): boolean => u.job?.kind === 'inside';
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

export const popCap = (w: World, owner: PlayerId): number => Math.min(MAX_POP, BASE_POP + POP_PER_FARM * finishedOfRole(w, owner, ROLE_FARM));
export const starCap = (w: World, owner: PlayerId): number => Math.min(MAX_STARS, finishedOfRole(w, owner, ROLE_FARM));

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

/**
 * Can a building of type t stand with its top-left at (cx, cy)? Every footprint cell must be free and
 * of a terrain the building's own flags allow (entity +0x16 open, +0x17 rough, +0x18 water, +0x19 tree,
 * the same per-code test units move by, 0x02001510): Castles, Farms, Barracks... open ground only,
 * Mines rough only (and on one of the map's mine sites), Shipyards water only. likely (entity data)
 * A Shipyard must also touch land: some cell around it that isn't water. likely (a playtester of the
 * DS game; the code isn't traced).
 */
export function canPlace(w: World, t: EntityType, cx: number, cy: number): boolean {
  const g = w.grid;
  if (!g || cx < 0 || cy < 0 || cx + t.size > g.width || cy + t.size > g.height) return false;
  if (t.role === ROLE_MINE && !w.mineSites.includes(cy * g.width + cx)) return false;
  const moves = t.moves ?? MOVES_GROUND;
  for (let y = cy; y < cy + t.size; y++) {
    for (let x = cx; x < cx + t.size; x++) {
      const c = y * g.width + x;
      if (!isWalkableCode(g.cells[c]!, moves) || w.occ![c] !== 0) return false;
    }
  }
  if (t.role !== ROLE_SHIPYARD) return true;
  for (let y = Math.max(0, cy - 1); y <= Math.min(g.height - 1, cy + t.size); y++) {
    for (let x = Math.max(0, cx - 1); x <= Math.min(g.width - 1, cx + t.size); x++) {
      if (g.cells[y * g.width + x] !== TERRAIN_WATER) return true; // footprint cells are water, so this is the edge
    }
  }
  return false;
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
  // One hero at a time (limit table at 0x02126CA4, MAX_HEROES). confirmed (code). The game's strip greys the
  // icon instead; refusing the order here keeps a second hero out of the queue the same way.
  if (t.role === ROLE_HERO && (heroAlive(w, player) || w.units.some((u) => u.owner === player && u.queue.some((k) => w.types[k]?.role === ROLE_HERO)))) return;
  // Nothing is paid or reserved yet: that happens when the unit starts training (0x02071E94). confirmed
  if (b.queue.length === 0) b.prod = PROD_IDLE;
  b.queue.push(type);
}

const heroAlive = (w: World, player: PlayerId): boolean => w.units.some((u) => u.owner === player && u.hp > 0 && u.role === ROLE_HERO);

/**
 * Cancel queue entry `index` (0 = the front) of a building, or the whole queue with -1
 * (CancelProduceQueueItemCommand, 0x02084A60). A waiting unit just goes; the one in training is refunded in
 * full and frees its pop or star slot. confirmed (emulator). The game refunds the front unit even when it
 * was never paid (stuck at the pop cap: a free 50 bricks); we refund only what was paid.
 */
export function orderCancel(w: World, player: PlayerId, building: EntityId, index: number): void {
  const b = findById(w.units, building);
  if (!b || b.owner !== player || !isBuilding(b) || index < -1 || index >= b.queue.length) return;
  const all = index === -1;
  if ((all || index === 0) && b.prod >= 0 && b.queue.length) {
    const t = w.types[b.queue[0]!];
    const p = getPlayer(w, player);
    if (t && p) {
      addBricks(p, t.cost);
      if (takesPop(t.role)) p.reservedPop--;
      if (takesStar(t.role)) p.reservedStars--;
    }
  }
  if (all) b.queue.length = 0;
  else b.queue.splice(index, 1);
  // A new front waits for the building's next 10-tick look at its queue. confirmed (emulator)
  if (all || index === 0) b.prod = PROD_IDLE;
}

/** Start the front unit if the player can take it now: pay, and reserve its pop or star slot. */
function startTraining(w: World, b: Unit, t: EntityType): boolean {
  const p = getPlayer(w, b.owner);
  if (!p) return false;
  if (t.role === ROLE_HERO && heroAlive(w, b.owner)) return false;
  if (takesPop(t.role) && popUsed(w, b.owner) + 1 > popCap(w, b.owner)) return false;
  if (takesStar(t.role) && starsUsed(w, b.owner) + 1 > starCap(w, b.owner)) return false;
  if (!spendBricks(p, t.cost)) return false;
  if (takesPop(t.role)) p.reservedPop++;
  if (takesStar(t.role)) p.reservedStars++;
  return true;
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
      u.job = { kind: 'inside', building: d.id, timer: DROP_TICKS, tree: job.tree };
      return;
    }
    case 'build': {
      const s = findById(w.units, job.site);
      if (!s || s.hp <= 0 || isFinished(s)) {
        u.job = null;
        return;
      }
      const a = approach(w, u, originCell(w, s), s.size);
      if (a === 'stuck') u.job = null;
      if (a !== 'there') return;
      // In through the site's wall; the work starts this tick (emulator: progress starts on entry).
      removeUnit(w, u);
      u.job = { kind: 'inside', building: s.id, timer: -1, tree: -1 };
      return;
    }
    case 'inside': {
      const b = findById(w.units, job.building);
      if (!b || b.hp <= 0) {
        // The building is gone: out where we stand (our rule; the game's is not traced).
        comeOut(w, u, freeCellNear(w, cellX(g, unitCell(w, u)), cellY(g, unitCell(w, u)), 7), null);
        return;
      }
      if (job.tree < 0) {
        // Building a site: wait for it to finish, then for the exit (stepConstruction sets the timer).
        if (job.timer < 0 || --job.timer > 0) return;
        comeOut(w, u, exitCell(w, b), null);
        return;
      }
      if (job.timer === DROP_TICKS) {
        // The tick after arriving: in, and the load is paid.
        removeUnit(w, u);
        const p = getPlayer(w, u.owner);
        // The logging buff (spell 19, buff slot 3) doubles the load; it counts only if still on at drop-off (0x0206D1A0).
        if (p) addBricks(p, loadValue(w, u.owner) * (u.boost & (1 << 3) ? 2 : 1));
        u.carrying = false;
      }
      if (--job.timer > 0) return;
      const next = g.cells[job.tree] === TERRAIN_TREE ? job.tree : nearestTree(g, job.tree);
      comeOut(w, u, exitCell(w, b), next < 0 ? null : { kind: 'chop', tree: next, timer: CHOP_TICKS });
      return;
    }
  }
}

/**
 * Put a Builder back on the map at cell c (the first free cell below the building's middle column,
 * as for trained units: emulator, Castle and Farm). No room: stay in and try again next tick.
 */
function comeOut(w: World, u: Unit, c: number, next: Job | null): void {
  if (c < 0) {
    if (u.job?.kind === 'inside') u.job.timer = 1;
    return;
  }
  const g = w.grid!;
  u.x = cellCenterX(cellX(g, c));
  u.y = cellCenterY(cellY(g, c));
  u.tx = u.ty = null;
  placeUnit(w, u);
  u.job = next;
}

/** A builder inside the site, working on it. */
const isBuildingOn = (u: Unit, s: Unit): boolean =>
  u.hp > 0 && u.owner === s.owner && u.job?.kind === 'inside' && u.job.building === s.id && u.job.tree < 0;

/**
 * One tick of construction: a site with at least one builder at work gains a
 * tick of progress, and HP follows progress (seen in the emulator on a Farm:
 * 360 ticks, HP rising ~1 a tick). Whether more builders build faster: open.
 */
function stepConstruction(w: World, s: Unit): void {
  if (!w.units.some((u) => isBuildingOn(u, s))) return;
  const before = Math.max(1, Math.floor((s.maxHp * s.progress) / s.buildTime));
  s.progress++;
  const after = Math.max(1, Math.floor((s.maxHp * s.progress) / s.buildTime));
  s.hp = Math.min(s.maxHp, s.hp + after - before);
  if (!isFinished(s)) return;
  if (s.role === ROLE_MINE) s.payout = MINE_TICKS;
  for (const u of w.units) {
    if (u.job?.kind === 'build' && u.job.site === s.id) u.job = null;
    if (isBuildingOn(u, s) && u.job?.kind === 'inside') u.job.timer = SITE_EXIT_TICKS;
  }
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
  if (b.prod < 0) {
    // Not started: an idle building checks every 10 ticks; right after a unit comes out, or while the front
    // waits for a free slot (pop cap: it blocks the rest of the queue), every tick. confirmed (emulator)
    if (b.prod === PROD_IDLE && w.tick % PROD_IDLE_CHECK !== 0) return;
    if (!startTraining(w, b, t)) {
      b.prod = PROD_READY;
      return;
    }
    b.prod = 0;
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
  b.prod = PROD_READY;
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

