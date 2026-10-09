import { cellCenterX, cellCenterY, cellOf } from './terrain';
import { findById } from './combat';
import { nextInt } from './rng';
import { isBuilding, isFinished, ROLE_BASE, ROLE_HERO, ROLE_SIEGE, ROLE_TRANSPORT, starCap } from './economy';
import { freeCellAround, placeUnit, removeUnit, stopMove, unitCell } from './movement';
import type { Fx } from './fixed';
import type { ActiveSpell, EntityId, PlayerId, SpellDef, Unit, World } from './state';

/**
 * Hero spells: charge, the cast check and the spells' effects, ported from the game's
 * SpellPool / SpellBase classes (ARM9 0x0207A890..0x0207C270). docs/re-notes/spells.md.
 */

/**
 * A live hero below full charge gains one point a tick (0x0205F104; the "alive" flag at unit +0x227
 * is cleared when it dies). confirmed: 900 -> 901 after one update in the emulator.
 */
export function regenCharge(u: Unit): void {
  if (u.role === ROLE_HERO && u.hp > 0 && u.charge < u.maxCharge) u.charge++;
}

/** Whole-cell squared distance between two positions, as the cast range check measures it (0x020F2B5C). */
function cellDist2(ax: Fx, ay: Fx, bx: Fx, by: Fx): number {
  const [acx, acy] = cellOf(ax, ay);
  const [bcx, bcy] = cellOf(bx, by);
  return (acx - bcx) ** 2 + (acy - bcy) ** 2;
}

/**
 * The game's can-cast check (0x0207B810): the caster is a hero, the target is within the spell's
 * range (whole-cell squared distance <= range^2; 0x0207B8A8) and the hero has more charge than
 * the cost. On success the cost is paid. Spells without a target skip the range check (0x0207B668).
 */
export function payForSpell(caster: Unit, def: SpellDef, target: { x: Fx; y: Fx } | null): boolean {
  if (caster.role !== ROLE_HERO || caster.hp <= 0) return false;
  if (target && cellDist2(caster.x, caster.y, target.x, target.y) > def.range * def.range) return false;
  if (caster.charge <= def.cost) return false;
  caster.charge -= def.cost;
  return true;
}

// What the player may tap (record +0x08, the spell UI's tap filter 0x020A9330).
export const TAP_POINT = 1;
export const TAP_OWN_UNIT = 2;
export const TAP_ENEMY = 4;
export const TAP_OWN_BUILDER = 8;
export const TAP_OWN_MINE = 0x10;
export const TAP_ENEMY_VEHICLE = 0x20;
export const TAP_SELF = 0x40;
const TAP_UNIT = TAP_OWN_UNIT | TAP_ENEMY | TAP_OWN_BUILDER | TAP_OWN_MINE | TAP_ENEMY_VEHICLE;

/**
 * What the player taps after picking the spell: nothing (0x40: it goes off around the hero at once),
 * a unit (2 own unit, 4 enemy, 8 own builder, 0x10 own mine, 0x20 enemy transport or siege unit), or a
 * spot (1). A unit spell with bit 1 also takes a spot (Fireball, Thunder Hammer). likely; seen: 1 for
 * 5/7/9/25, 0x40 for 13, 4 for 20.
 */
export function spellTarget(def: SpellDef): 'unit' | 'point' | 'none' {
  if (def.flags & TAP_SELF) return 'none';
  if (def.flags & TAP_UNIT) return 'unit';
  return 'point';
}

/** Whether a spell may be cast at this unit (the tap filter, plus Hot Wire's special-cap check 0x0207B71C). */
export function canTarget(w: World, def: SpellDef, player: PlayerId, t: Unit): boolean {
  if (t.hp <= 0) return false;
  const f = def.flags;
  const own = t.owner === player;
  const enemy = !allied(w, t.owner, player);
  if (f & TAP_OWN_UNIT && own && !isBuilding(t)) return true;
  if (f & TAP_OWN_BUILDER && own && t.role === 1) return true;
  if (f & TAP_OWN_MINE && own && t.role === 9) return true;
  if (f & TAP_ENEMY && enemy) return true;
  if (f & TAP_ENEMY_VEHICLE && enemy && (t.role === ROLE_TRANSPORT || t.role === ROLE_SIEGE)) {
    // A siege unit only when the caster's player has room under its special cap (likely).
    return t.role !== ROLE_SIEGE || w.units.filter((u) => u.owner === player && u.hp > 0 && u.role === ROLE_SIEGE).length < starCap(w, player);
  }
  return false;
}

/** Players on one team are allies (0x02085D38). */
function allied(w: World, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return true;
  const pa = w.players.find((p) => p.id === a);
  const pb = w.players.find((p) => p.id === b);
  return !!pa && !!pb && pa.team === pb.team;
}

/** A player's cast order: the hero, the spell, and a target unit (0 for none) or point. */
export interface CastOrder {
  caster: EntityId;
  spell: number;
  target: EntityId;
  x: Fx;
  y: Fx;
}

export function orderCast(w: World, player: PlayerId, o: CastOrder): void {
  const caster = findById(w.units, o.caster);
  const def = w.spellDefs[o.spell];
  if (!caster || caster.owner !== player || !def || !caster.spells.includes(o.spell) || !spellWorks(def.id)) return;
  let mode = spellTarget(def);
  const t = mode === 'unit' && o.target ? findById(w.units, o.target) : undefined;
  if (mode === 'unit') {
    if (t ? !canTarget(w, def, player, t) : !(def.flags & TAP_POINT)) return;
    if (!t) mode = 'point';
  }
  const at = mode === 'none' ? null : t ? { x: t.x, y: t.y } : { x: o.x, y: o.y };
  if (!payForSpell(caster, def, at)) return;
  startSpell(w, caster, def, mode, t, at ?? { x: caster.x, y: caster.y });
}

// Stat buff slots (game: StatBufMagicInfluence +0x14).
export const BUFF_SPEED = 0;
export const BUFF_DAMAGE = 1;
export const BUFF_ARMOR = 2;
export const BUFF_CHOP = 3;
export const BUFF_MINE = 4;
export const BUFF_SLOTS = 5;

// Spell classes, picked by the record's type byte in the factory (0x0207BBEC).
const HEAL = new Set([1, 2, 3]);
/** StatBufSpell (ctor 0x0207C270): spell id -> buff slot. */
const STAT_BUF: Record<number, number> = { 4: 0, 5: 0, 24: 0, 6: 1, 7: 1, 8: 2, 9: 2, 19: 3, 17: 4 };
/** DamageSpell (ctor 0x02076020): spell id -> its extra ticks, also the grace hits it gives (0x02076EF4). */
const DAMAGE: Record<number, number> = { 13: 0, 18: 0, 20: 15, 21: 0, 22: 20, 23: 20, 25: 10, 28: 20, 31: 20 };
/** Damage spells made by the helper 0x02076A50: a hit zone that grows from 0 to the radius, and no hits in transports. */
const GROWS = new Set([18, 20, 21, 22]);
/** EAttackSpell (ctor 0x02077110): a ring that freezes enemy minifigures (29) or vehicles (27). */
const FREEZE = new Set([27, 29]);
const CLUSTER_BOMB = 31;

/** Every buff lasts ms->ticks(10000) = 300 ticks, whatever the record says. confirmed */
export const BUFF_TICKS = 300;
/** Heals pulse every ms->ticks(250) = 7 ticks. confirmed */
const HEAL_PULSE = 7;
const AURA_BASE = 1;
const AURA_HERO = 2;
// Target modes (SpellBase +0x1C).
const MODE_UNIT = 1;
const MODE_CASTER = 2;
const MODE_POINT = 3;

// Spell class kinds (SpellBase +0x08 holds the game's own).
const C_NONE = 0;
const C_HEAL = 1;
const C_BUFF = 2;
const C_DAMAGE = 3;
const C_FREEZE = 4;
const C_LIGHTNING = 5;
const C_TELEPORT = 6;
const C_TRACKING = 7;
const C_HOTWIRE = 8;

/** The class the factory (0x0207BBEC) makes for a spell id; C_NONE for the ones not ported yet. */
function classOf(id: number): number {
  if (HEAL.has(id)) return C_HEAL;
  if (id in STAT_BUF) return C_BUFF;
  if (id in DAMAGE) return C_DAMAGE;
  if (FREEZE.has(id)) return C_FREEZE;
  if (id === 15) return C_LIGHTNING;
  if (id === 26) return C_TELEPORT;
  if (id === 30) return C_TRACKING;
  if (id === 32) return C_HOTWIRE;
  return C_NONE;
}

/** True for the spells this sim runs (the rest are paid for and do nothing yet). */
export function spellWorks(id: number): boolean {
  return classOf(id) !== C_NONE;
}

/**
 * a * 4096 / b in 20.12, rounded to nearest the way the DS divider helper FX_Div does (0x0210A604):
 * the quotient truncates toward zero with 32 fraction bits, then rounds half up to 12.
 */
export function fxDivRound(a: number, b: number): number {
  const q = Math.trunc((a * 4096 * 0x100000) / b);
  return Math.floor((q + 0x80000) / 0x100000);
}

/** Cell of a unit as the spells see it (unit +0x128): its position's cell, a building's top-left. */
const cellOfUnit = (u: Unit) => cellOf(u.x, u.y);

/**
 * Create a spell and start it (game: factory 0x0207BBEC, then SpellBase start 0x0207AC44 spot /
 * 0x0207AB50 unit / 0x0207ABA0 around the caster). A unit spell holds its target at once; an area
 * spell waits in the scan queue for its units.
 */
function startSpell(
  w: World, caster: Unit, def: SpellDef, mode: 'unit' | 'point' | 'none', t: Unit | undefined, at: { x: Fx; y: Fx }, cls = classOf(def.id),
): ActiveSpell {
  const [cx, cy] = cellOf(at.x, at.y);
  const [end, , start, startChance] = [def.params[0], def.params[1], def.params[2], def.params[3]];
  const D = def.time + (DAMAGE[def.id] ?? 0);
  // Classes that work on one target or on the caster have no area (radius -1).
  const area = cls === C_HEAL || cls === C_BUFF || cls === C_DAMAGE;
  const s: ActiveSpell = {
    id: w.nextSpell++, owner: caster.owner, spell: def.id, cls, caster: caster.id, target: t?.id ?? 0, x: at.x, y: at.y, start: w.tick,
    mode: mode === 'unit' ? MODE_UNIT : mode === 'none' ? MODE_CASTER : MODE_POINT,
    left: cls === C_BUFF ? BUFF_TICKS : def.id === 3 ? 1 : cls === C_DAMAGE ? D : cls === C_TRACKING ? def.time : -1,
    cx, cy, radius: mode === 'unit' || !area ? -1 : def.b7, units: [], phase: 0,
    timer: cls === C_FREEZE ? def.time : cls === C_LIGHTNING ? LIGHTNING_DELAY : cls === C_TELEPORT ? TELEPORT_DELAY : cls === C_HOTWIRE ? def.time : 1,
    dmg: 0, dmgStep: 0, chance: 0, chanceStep: 0, ring: 0, ringStep: 0,
  };
  if (cls === C_DAMAGE) {
    // Damage and hit chance move in a straight line from the record's start to end values over D ticks.
    s.dmg = start << 12;
    s.dmgStep = fxDivRound(end - start, D);
    if (startChance === 0xff) s.chance = 100 << 12; // 0xFF: always hits
    else {
      s.chance = startChance << 12;
      s.chanceStep = fxDivRound(def.params[1] - startChance, D);
    }
    if (GROWS.has(def.id)) s.ringStep = fxDivRound(def.b7, D);
    if (def.id === CLUSTER_BOMB) {
      // 1 or 2 bombs, each nudged up to +-30 px (0x020763C0..0x0207640C). Only the picture uses the
      // numbers, but they come from the game RNG, so they are drawn here too.
      const bombs = 1 + nextInt(w.rng, 2);
      for (let i = 0; i < bombs * 2; i++) nextInt(w.rng, 61);
    }
  }
  if (cls === C_FREEZE) s.ringStep = fxDivRound(def.b7, def.time);
  if (cls === C_TRACKING && t) t.tracked = 1; // unit +0x155 (0x0205A990)
  w.spells.push(s);
  if (!area) return s;
  if (t) enter(w, s, t);
  else w.scanQueue.push(s.id);
  return s;
}

/**
 * A hero and a base each start their passive heal when they are created (0x0205E224). Call after
 * spawning a unit; no-op without the spell table or for other units.
 */
export function startAura(w: World, u: Unit): void {
  const id = u.role === ROLE_HERO ? AURA_HERO : u.role === ROLE_BASE ? AURA_BASE : 0;
  const def = id ? w.spellDefs[id] : undefined;
  if (def) startSpell(w, u, def, 'none', undefined, u);
}

/**
 * Who a spell takes in its area (0x0207AFF0): heals and buffs the caster's own units but not the
 * caster or buildings (0x020785B0 / 0x0207C44C; spell 17 takes mines), and the base aura only
 * heroes. Damage spells take every other player's units, buildings too.
 */
function takes(s: ActiveSpell, u: Unit): boolean {
  if (u.hp <= 0) return false;
  if (s.cls === C_DAMAGE) return u.owner !== s.owner;
  if (u.owner !== s.owner || u.id === s.caster) return false;
  if (s.spell === AURA_BASE) return u.role === ROLE_HERO;
  if (s.spell === 17) return !isBuilding(u) || u.role === 9;
  return !isBuilding(u);
}

/** A unit joins a spell's area: into the first free slot (0x0207B124); buffs take hold (0x0205ED28). */
function enter(w: World, s: ActiveSpell, u: Unit): void {
  const free = s.units.indexOf(0);
  if (free >= 0) s.units[free] = u.id;
  else s.units.push(u.id);
  const slot = s.cls === C_BUFF ? STAT_BUF[s.spell] : undefined;
  if (slot !== undefined) u.buffs[slot]!++;
  if (s.cls === C_DAMAGE) u.grace = DAMAGE[s.spell] ?? 0; // 0x02076B9C; the last spell to take a unit sets it
}

/** A unit leaves: its slot stays, empty (0x0207B1F4). */
function leave(w: World, s: ActiveSpell, i: number): void {
  const u = findById(w.units, s.units[i]!);
  s.units[i] = 0;
  if (!u) return;
  const slot = s.cls === C_BUFF ? STAT_BUF[s.spell] : undefined;
  if (slot !== undefined) u.buffs[slot]!--;
  if (s.cls === C_DAMAGE) u.grace = 0;
}

/** The spell is over: every unit leaves (SpellBase dtor 0x0207ACE8). */
function leaveAll(w: World, s: ActiveSpell): void {
  for (let i = 0; i < s.units.length; i++) if (s.units[i]) leave(w, s, i);
}

/**
 * Area scan (0x0207AD54): units whose cell is within |dx| + |dy| <= radius of the centre. Units no
 * longer inside leave, new ones take the first free slot. Around a caster the centre is its cell
 * plus half its footprint, so a castle's aura is centred on it and a hero's follows the hero.
 * Buffs scan once; the others rescan every time their turn comes round (0x0207AFE8).
 * guess: newcomers are taken in row order (y, then x), then by id within a cell.
 */
function scan(w: World, s: ActiveSpell): void {
  if (s.radius < 0) return;
  if (s.mode === MODE_CASTER) {
    const c = findById(w.units, s.caster);
    if (c) {
      const [x, y] = cellOfUnit(c);
      s.cx = x + (c.size >> 1);
      s.cy = y + (c.size >> 1);
    }
  }
  const inside = (u: Unit) => {
    const [ux, uy] = cellOfUnit(u);
    return Math.abs(ux - s.cx) + Math.abs(uy - s.cy) <= s.radius;
  };
  for (let i = 0; i < s.units.length; i++) {
    if (!s.units[i]) continue;
    const u = findById(w.units, s.units[i]!);
    if (!u || !takes(s, u) || !inside(u)) leave(w, s, i);
  }
  const fresh = w.units.filter((u) => takes(s, u) && inside(u) && !s.units.includes(u.id));
  fresh.sort((a, b) => {
    const [ax, ay] = cellOfUnit(a);
    const [bx, by] = cellOfUnit(b);
    return ay - by || ax - bx || a.id - b.id;
  });
  for (const u of fresh) enter(w, s, u);
}

/** Heal pulse (0x02078750): passives +30 to heroes (base) or +10 (hero), the one-off spell 3 maxHp/4. */
function pulse(w: World, s: ActiveSpell): void {
  const caster = findById(w.units, s.caster);
  if (s.spell === AURA_BASE && caster && !isFinished(caster)) return;
  for (const id of s.units) {
    const u = id ? findById(w.units, id) : undefined;
    if (!u || u.hp <= 0 || u.hp >= u.maxHp) continue;
    const add = s.spell === AURA_BASE ? 30 : s.spell === AURA_HERO ? 10 : (u.maxHp << 14) >> 16;
    u.hp = Math.min(u.maxHp, u.hp + add);
  }
}

const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);

/**
 * One damage tick (0x02076D64): a rand(100) + 1 roll per slot, drawn before any check, even for empty
 * slots. A unit is hit when it is not an ally, stands within the spell's range of where the hero is
 * now (0x02076F74), and the roll is at most the hit chance. The hit is the damage value straight off
 * its HP: no armor, no class bonus. A unit's grace count soaks up its first hits.
 */
function damageTick(w: World, s: ActiveSpell, caster: Unit): void {
  const def = w.spellDefs[s.spell]!;
  const grows = GROWS.has(s.spell) && s.cls === C_DAMAGE;
  if (grows) s.ring += s.ringStep;
  const [hx, hy] = cellOfUnit(caster);
  for (const id of s.units) {
    const roll = nextInt(w.rng, 100) + 1;
    const u = id ? findById(w.units, id) : undefined;
    if (!u || u.hp <= 0 || allied(w, u.owner, s.owner)) continue;
    const [ux, uy] = cellOfUnit(u);
    if (manhattan(ux, uy, hx, hy) > def.range) continue;
    if (grows && s.mode === MODE_POINT && manhattan(ux, uy, s.cx, s.cy) >= s.ring >> 12) continue;
    if (roll > s.chance >> 12) continue;
    if (u.grace > 0) {
      u.grace--;
      continue;
    }
    const d = s.dmg >> 12;
    u.hp = Math.max(0, u.hp - d);
    u.lastHit = w.tick;
  }
  s.chance += s.chanceStep;
  s.dmg += s.dmgStep;
}

/**
 * EAttack update (0x020772FC): the ring starts just under 1 cell and grows by b7/D a tick; each time
 * it reaches a new whole cell, enemy units in the square of that radius around the spot
 * (0x0207E66C, all layers) are frozen for D ticks (0x020775D0, 0x020774F0). 29 takes minifigures
 * (roles 0-4), 27 vehicles (role 6). Two game quirks kept: after its first catch 29 no longer takes
 * ranged units, and units already caught are caught again (and so refrozen) on later steps unless
 * they are all the ring holds. likely; the refreeze restarting the timer is a guess.
 */
function freezeTick(w: World, s: ActiveSpell): void {
  const def = w.spellDefs[s.spell]!;
  if (s.ring === 0) {
    s.ring = 4092;
    return;
  }
  const r0 = s.ring >> 12;
  s.ring += s.ringStep;
  const r = s.ring >> 12;
  if (r === r0) return;
  const first = s.units.length === 0;
  const roles = s.spell === 27 ? [6] : first ? [0, 1, 2, 3, 4] : [0, 1, 2, 4];
  for (const u of w.units) {
    if (u.hp <= 0 || allied(w, u.owner, s.owner) || !roles.includes(u.role)) continue;
    const [ux, uy] = cellOfUnit(u);
    if (Math.max(Math.abs(ux - s.cx), Math.abs(uy - s.cy)) > r) continue;
    if (!first && s.units.every((id) => id === u.id)) continue;
    s.units.push(u.id);
    u.frozen = w.tick + def.time;
  }
}

/**
 * One tick of every spell (game: 0x02083680): each spell's update, the finished ones go, then the
 * front of the scan queue is scanned. A spell cast this tick waits for the next update (the game
 * runs commands after the spell pool), so a buff ends 301 ticks after its cast, as in the emulator.
 */
export function spellsStep(w: World): void {
  if (w.spells.length === 0) return;
  const done = new Set<number>();
  for (const s of w.spells) {
    if (s.start === w.tick) continue;
    if (stepSpell(w, s)) done.add(s.id);
  }
  if (done.size) {
    for (const s of w.spells) if (done.has(s.id)) endSpell(w, s);
    w.spells = w.spells.filter((s) => !done.has(s.id));
    w.scanQueue = w.scanQueue.filter((id) => !done.has(id));
  }
  const next = w.scanQueue.shift();
  if (next === undefined) return;
  const s = w.spells.find((x) => x.id === next)!;
  scan(w, s);
  if (s.cls !== C_BUFF) w.scanQueue.push(s.id); // all but buffs go round again
}

/**
 * One tick of one spell: the class's update, then SpellBase's (0x0207A9E0): with its caster gone
 * the spell is over; otherwise it counts down and is over at 0. So a damage spell hits D + 1 times
 * (confirmed: 61, 71, 76 updates). Returns true when it is over.
 */
function stepSpell(w: World, s: ActiveSpell): boolean {
  const caster = findById(w.units, s.caster);
  const alive = !!caster && caster.hp > 0;
  switch (s.cls) {
    case C_HEAL:
      if (--s.timer === 0) {
        pulse(w, s);
        s.timer = HEAL_PULSE;
      }
      break;
    case C_DAMAGE:
      if (alive) damageTick(w, s, caster);
      break;
    case C_FREEZE:
      if (s.timer === 0 || !alive) return true; // its own timer; SpellBase never times it out
      freezeTick(w, s);
      s.timer--;
      return false;
    case C_LIGHTNING:
    case C_TELEPORT:
    case C_HOTWIRE:
      if (alive && classTick(w, s, caster)) return true;
      break;
  }
  if (!alive) s.left = 0;
  if (s.left === 0) return true;
  if (s.left > 0) s.left--;
  return false;
}

/** Lightning strikes this many ticks after the cast, when the hero's cast animation is done. confirmed: 14 */
const LIGHTNING_DELAY = 14;
/** Lightning's damage record (33). confirmed */
const LIGHTNING_DAMAGE = 33;
/** The lightning spell lingers this long after the strike. confirmed */
const LIGHTNING_LINGER = 30;
/** Teleport moves the hero this many ticks after the cast, when its picture says so. confirmed: 23 */
const TELEPORT_DELAY = 23;
/** How far Teleport looks for a free cell around the base (guess; the fallback search is 20 per the notes). */
const TELEPORT_SEARCH = 20;

/** The classes driven by a timer and a phase. True when the spell is over. */
function classTick(w: World, s: ActiveSpell, caster: Unit): boolean {
  if (s.cls === C_LIGHTNING) {
    // 0x02079B74: wait for the cast animation, strike (the 8 beams are only a picture) with record 33's
    // damage area around the hero, linger 30 ticks, end.
    if (--s.timer > 0) return false;
    if (s.phase === 1) return true;
    const def = w.spellDefs[LIGHTNING_DAMAGE];
    if (def) startSpell(w, caster, def, 'none', undefined, caster, C_DAMAGE);
    s.phase = 1;
    s.timer = LIGHTNING_LINGER;
    return false;
  }
  if (s.cls === C_TELEPORT) {
    // 0x0207C7FC: after the animation, the hero lands next to its player's first base, else near its
    // start spot (0x020A3D24), via TeleportUnitCommand (0x0206B684). Over the tick after.
    if (s.phase === 1) return true;
    if (--s.timer > 0) return false;
    teleportHome(w, caster);
    s.phase = 1;
    return false;
  }
  // Hot Wire (0x02078D3C): on its first update the target changes sides for good and drops its
  // orders (0x020598A4); the spell then shows its picture for the record's +0x12 ticks.
  if (s.phase === 0) {
    s.phase = 1;
    const t = findById(w.units, s.target);
    if (t && t.hp > 0 && !allied(w, t.owner, s.owner)) {
      t.owner = s.owner;
      t.target = null;
      t.ordered = false;
      t.job = null;
      stopMove(w, t);
    }
  }
  return --s.timer <= 0;
}

/** Move a hero next to its player's first base, or near its start cell without one. */
function teleportHome(w: World, u: Unit): void {
  const g = w.grid;
  if (!g || !w.occ) return;
  const base = w.units.find((b) => b.owner === u.owner && b.role === ROLE_BASE && b.hp > 0);
  const start = w.players.find((p) => p.id === u.owner)?.start ?? -1;
  const centre = base ? unitCell(w, base) : start;
  if (centre < 0) return;
  const to = freeCellAround(w, u, centre, TELEPORT_SEARCH);
  if (to < 0) return;
  removeUnit(w, u);
  u.x = cellCenterX(to % g.width);
  u.y = cellCenterY(Math.floor(to / g.width));
  u.mv = null;
  u.tx = u.ty = null;
  u.path = [];
  u.target = null;
  u.ordered = false;
  placeUnit(w, u);
}

/** The spell is over: let go of its units (SpellBase dtor 0x0207ACE8), clear a tracking mark. */
function endSpell(w: World, s: ActiveSpell): void {
  leaveAll(w, s);
  if (s.cls === C_TRACKING) {
    const t = findById(w.units, s.target);
    if (t && t.hp > 0) t.tracked = 0; // not counted: the first tracking to end clears it (likely)
  }
}

/** Bring a unit's stats up to date with its buffs; call at the start of its update. */
export function refreshBoost(u: Unit): void {
  let b = 0;
  for (let i = 0; i < BUFF_SLOTS; i++) if (u.buffs[i]! > 0) b |= 1 << i;
  u.boost = b;
}

/** A frozen unit does nothing until the freeze runs out (FreezeEntityCommand 0x0206B248). */
export const isFrozen = (w: World, u: Unit): boolean => u.frozen > w.tick;

/** Walking speed with the speed buff: x1.5 in 20.12, rounded (0x0205CCA4, 0x0204F2B8). 410 -> 615 confirmed */
export function moveSpeed(u: Unit): number {
  return u.boost & (1 << BUFF_SPEED) ? (u.speed * 0x1800 + 0x800) >> 12 : u.speed;
}

/** Melee base damage with the damage buff: x2 (ranged attacks don't use it). 5 -> 10 confirmed */
export function meleeDamage(u: Unit, base: number): number {
  return u.boost & (1 << BUFF_DAMAGE) ? base * 2 : base;
}

/**
 * Damage a unit takes: times its multiplier, 0.5 with the armor buff. The game multiplies the hit
 * in 20.12 with rounding and then truncates to whole HP (0x02050B80..0x02050BAC), i.e. floor(hit / 2).
 */
export function damageTaken(u: Unit, hit: number): number {
  return u.boost & (1 << BUFF_ARMOR) ? hit >> 1 : hit;
}
