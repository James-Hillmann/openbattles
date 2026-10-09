import type { EntityId, EntityType, PlayerId, Unit, World } from './state';
import { findById } from './combat';
import { stopMove } from './movement';
import {
  ROLE_BASE, ROLE_BUILDER, ROLE_HERO, ROLE_SHIPYARD, ROLE_STABLES, approach, getPlayer, isBuilding,
  isFinished, originCell, spendBricks, type PlaceFn,
} from './economy';

/**
 * Tower upgrades, repair, and what a player must own before building something. Ported from
 * ResearchUpgradeEntityCommand, RepairStructureEntityCommand / RepairStructureAction and
 * ConstructStructureEntityCommand in ARM9; numbers and confidence in docs/re-notes/structures.md.
 */

export const ROLE_TOWER = 13;
export const ROLE_TOWER2 = 14;
export const ROLE_TOWER3 = 15;
export const ROLE_BRIDGE = 17;
export const ROLE_GATE = 18;
export const ROLE_WALL = 19;

export const isTower = (role: number): boolean => role >= ROLE_TOWER && role <= ROLE_TOWER3;

// ---- prerequisites and limits ----

/**
 * Stables and Shipyard need a finished Barracks and a finished Farm (ConstructStructureEntityCommand
 * start 0x02068B74, and the strip's button check 0x020DA150, both counting finished buildings only).
 * confirmed (code; emulator: both buttons checkered with only a Farm, and with a Farm and a Barracks
 * still being built; lit once the Barracks finished)
 */
export const PREREQUISITES: Readonly<Record<number, readonly number[]>> = {
  // Literal roles (Stables 12, Shipyard 16; Barracks 11, Farm 10): economy.ts imports this module.
  12: [11, 10],
  16: [11, 10],
};

/**
 * Per-player ceilings from the limit table at 0x02126CA4, checked before a build (0x02086088):
 * entry 3 = 7 towers (roles 13-15), entry 4 = 14 other buildings (roles 7-12, 16 and gates 18;
 * bridges and walls have their own entries). Sites count. likely (code; not reached in the emulator)
 */
export const MAX_TOWERS = 7;
export const MAX_BUILDINGS = 14;

const countsAsBuilding = (role: number) => (role >= ROLE_BASE && role <= ROLE_STABLES) || role === ROLE_SHIPYARD || role === ROLE_GATE;

const finishedOfRole = (w: World, owner: PlayerId, role: number): number =>
  w.units.filter((u) => u.owner === owner && u.hp > 0 && u.role === role && isFinished(u)).length;

/** Roles of the finished buildings `player` still lacks before it may build type t (empty when none). */
export function missingPrerequisites(w: World, player: PlayerId, t: EntityType): number[] {
  return (PREREQUISITES[t.role] ?? []).filter((r) => finishedOfRole(w, player, r) === 0);
}

/** Has `player` reached the ceiling for type t's group (towers, or other buildings)? */
export function atBuildLimit(w: World, player: PlayerId, t: EntityType): boolean {
  const own = w.units.filter((u) => u.owner === player && u.hp > 0);
  if (isTower(t.role)) return own.filter((u) => isTower(u.role)).length >= MAX_TOWERS;
  if (countsAsBuilding(t.role)) return own.filter((u) => countsAsBuilding(u.role)).length >= MAX_BUILDINGS;
  return false;
}

/** Everything but bricks, terrain and faction that decides whether `player` may build type t. */
export const mayBuild = (w: World, player: PlayerId, t: EntityType): boolean =>
  missingPrerequisites(w, player, t).length === 0 && !atBuildLimit(w, player, t);

// ---- tower upgrades ----

/**
 * The type a tower upgrades to: the next level (role 13 -> 14 -> 15) of its own faction
 * (0x02073080 looks the role up in the player's faction list). Undefined for Tower III and non-towers.
 */
export function upgradeOf(w: World, b: Unit): EntityType | undefined {
  if (b.role !== ROLE_TOWER && b.role !== ROLE_TOWER2) return undefined;
  const faction = w.types[b.kind]?.faction;
  return w.types.find((t) => t !== undefined && t.role === b.role + 1 && t.faction === faction);
}

/**
 * Start upgrading a finished tower (ResearchUpgradeEntityCommand, 0x02073080): pays the next level's
 * full cost (+0x5E: 500 for Tower II, 800 for Tower III) at once. The upgrade runs in the tower's
 * production slot (`queue`/`prod`) for the next level's build time (+0x60). confirmed (emulator)
 */
export function orderUpgrade(w: World, player: PlayerId, building: EntityId): void {
  const b = findById(w.units, building);
  const p = getPlayer(w, player);
  if (!b || !p || b.owner !== player || b.hp <= 0 || !isFinished(b) || b.queue.length > 0) return;
  const t = upgradeOf(w, b);
  if (!t || !spendBricks(p, t.cost)) return;
  b.queue.push(t.kind);
  b.prod = 0;
}

/** One tick of an upgrade; true when it is done and the tower should be replaced. */
export function stepUpgrade(w: World, b: Unit): boolean {
  const kind = b.queue[0];
  if (kind === undefined) return false;
  const t = w.types[kind];
  if (!t) {
    b.queue.shift();
    return false;
  }
  b.prod++;
  return b.prod >= Math.max(1, t.buildTime);
}

/**
 * The upgrade is done (0x02073620): the old tower goes without dying (no loss is counted) and a new
 * entity of the next level stands in its cell, with the old tower's damage carried over
 * (new HP = new max - (old max - old HP)). confirmed (emulator: a Tower at 300/400 became a Tower II at 400/500)
 */
export function finishUpgrade(w: World, b: Unit, place: PlaceFn): Unit | undefined {
  const t = w.types[b.queue[0] ?? -1];
  if (!t || !w.grid) return undefined;
  const damage = b.maxHp - b.hp;
  const o = originCell(w, b);
  w.units = w.units.filter((u) => u !== b);
  const nb = place(w, b.owner, t, o % w.grid.width, Math.floor(o / w.grid.width), true);
  nb.hp = Math.max(1, nb.maxHp - damage);
  return nb;
}

// ---- repair ----

/** 20.12 fixed point, the game's own format (FX32). */
const ONE = 4096;
/** FX_Div (0x0210A604) for positive a, b: (a << 32) / b rounded to 12 fraction bits. Exact in doubles. */
const div12 = (a: number, b: number): number => Math.floor((a * 8192 + b) / (2 * b));
/** FX_Mul (0x0200D984): rounded product. */
const mul12 = (a: number, b: number): number => Math.floor((a * b + 0x800) / ONE);

/**
 * Builders and heroes repair (RepairStructureEntityCommand start 0x020728CC accepts roles 0 and 1;
 * both have the Repair button). An order on a finished building that isn't at full HP: the unit walks
 * next to it and works from outside. confirmed (emulator: a Builder and the King each repaired a Tower II)
 */
export function orderRepair(w: World, player: PlayerId, ids: readonly EntityId[], target: EntityId): void {
  const b = findById(w.units, target);
  // Own buildings only: in 1v1 there are no allies (the game's command doesn't check the owner).
  if (!b || b.owner !== player || b.hp <= 0 || !isBuilding(b) || !isFinished(b) || b.hp >= b.maxHp) return;
  for (const u of w.units) {
    if (u.owner !== player || u.hp <= 0 || (u.role !== ROLE_HERO && u.role !== ROLE_BUILDER) || !ids.includes(u.id)) continue;
    u.target = null;
    stopMove(w, u);
    u.job = { kind: 'repair', building: b.id, hp: 0, bricks: 0 };
  }
}

/**
 * One tick of RepairStructureAction (0x02054B64), next to the building. The rates come out as max HP / build
 * time HP and cost / (2 x build time) bricks a tick: a full repair costs half the building's price and takes
 * its build time. Both accumulate in 20.12; nothing happens until both reach a whole point, then the bricks
 * are paid and the HP added (a Tower II heals 2 HP per brick, every 3-4 ticks). Short of bricks, that tick's
 * work is lost and the unit keeps trying. confirmed (emulator: 100 HP for 50 bricks, +2 HP / -1 brick steps)
 */
export function stepRepair(w: World, u: Unit): void {
  const job = u.job;
  if (job?.kind !== 'repair') return;
  const b = findById(w.units, job.building);
  const t = b && w.types[b.kind];
  if (!b || !t || b.hp <= 0 || b.owner !== u.owner || !isFinished(b) || b.hp >= b.maxHp) {
    u.job = null;
    return;
  }
  const a = approach(w, u, originCell(w, b), b.size);
  if (a === 'stuck') u.job = null;
  if (a !== 'there') return;
  const missing = b.maxHp - b.hp;
  const share = div12(missing * ONE, b.maxHp * ONE);
  const ticks = Math.max(ONE, mul12(share, Math.max(1, t.buildTime) * ONE));
  const price = mul12(mul12(0x800, t.cost * ONE), share);
  const bricks = div12(price, ticks) + job.bricks;
  const hp = div12(missing * ONE, ticks) + job.hp;
  const nb = Math.floor(bricks / ONE);
  const nh = Math.floor(hp / ONE);
  job.bricks = bricks % ONE;
  job.hp = hp % ONE;
  if (nb === 0 || nh === 0) {
    job.bricks += nb * ONE;
    job.hp += nh * ONE;
    return;
  }
  const p = getPlayer(w, u.owner);
  if (!p || !spendBricks(p, nb)) return;
  b.hp += Math.min(nh, missing);
}
