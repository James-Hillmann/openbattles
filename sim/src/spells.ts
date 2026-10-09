import { cellOf } from './terrain';
import { findById } from './combat';
import { nextInt } from './rng';
import { isBuilding, isFinished, ROLE_BASE, ROLE_HERO } from './economy';
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

/**
 * What the player taps after picking the spell (record +0x08, read by the spell UI 0x020A9330): 0x40
 * nothing (it goes off around the hero at once), 2 one of your units, 4 an enemy unit, 1 a spot.
 * confirmed for 1 (5/7/9, 25), 0x40 (13) and 4 (20) in the emulator; 2 likely.
 */
export function spellTarget(def: SpellDef): 'unit' | 'point' | 'none' {
  if (def.flags & 0x40) return 'none';
  if (def.flags & 6) return 'unit';
  return 'point';
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
  if (!caster || caster.owner !== player || !def || !caster.spells.includes(o.spell)) return;
  const mode = spellTarget(def);
  const t = mode === 'unit' ? findById(w.units, o.target) : undefined;
  if (mode === 'unit') {
    if (!t || t.hp <= 0) return;
    // 2 takes one of your own units, 4 an enemy's (the strip's tap filter; likely).
    if (def.flags & 4 ? allied(w, t.owner, player) : t.owner !== player) return;
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

/** True for the spells this sim runs (the rest are paid for and do nothing yet). */
export function spellWorks(id: number): boolean {
  return HEAL.has(id) || id in STAT_BUF || id in DAMAGE || FREEZE.has(id);
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
function startSpell(w: World, caster: Unit, def: SpellDef, mode: 'unit' | 'point' | 'none', t: Unit | undefined, at: { x: Fx; y: Fx }): ActiveSpell {
  const [cx, cy] = cellOf(at.x, at.y);
  const [end, , start, startChance] = [def.params[0], def.params[1], def.params[2], def.params[3]];
  const D = def.time + (DAMAGE[def.id] ?? 0);
  const s: ActiveSpell = {
    id: w.nextSpell++, owner: caster.owner, spell: def.id, caster: caster.id, target: t?.id ?? 0, x: at.x, y: at.y, start: w.tick,
    mode: mode === 'unit' ? MODE_UNIT : mode === 'none' ? MODE_CASTER : MODE_POINT,
    left: def.id in STAT_BUF ? BUFF_TICKS : def.id === 3 ? 1 : def.id in DAMAGE ? D : -1,
    cx, cy, radius: mode === 'unit' ? -1 : def.b7, units: [], timer: FREEZE.has(def.id) ? def.time : 1,
    dmg: 0, dmgStep: 0, chance: 0, chanceStep: 0, ring: 0, ringStep: 0,
  };
  if (def.id in DAMAGE) {
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
  if (FREEZE.has(def.id)) s.ringStep = fxDivRound(def.b7, def.time);
  w.spells.push(s);
  if (FREEZE.has(def.id)) return s; // collects its own units as the ring grows
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
  if (s.spell in DAMAGE) return u.owner !== s.owner;
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
  const slot = STAT_BUF[s.spell];
  if (slot !== undefined) u.buffs[slot]!++;
  if (s.spell in DAMAGE) u.grace = DAMAGE[s.spell]!; // 0x02076B9C; the last spell to take a unit sets it
}

/** A unit leaves: its slot stays, empty (0x0207B1F4). */
function leave(w: World, s: ActiveSpell, i: number): void {
  const u = findById(w.units, s.units[i]!);
  s.units[i] = 0;
  if (!u) return;
  const slot = STAT_BUF[s.spell];
  if (slot !== undefined) u.buffs[slot]!--;
  if (s.spell in DAMAGE) u.grace = 0;
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
  const grows = GROWS.has(s.spell);
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
    for (const s of w.spells) if (done.has(s.id) && !FREEZE.has(s.spell)) leaveAll(w, s);
    w.spells = w.spells.filter((s) => !done.has(s.id));
    w.scanQueue = w.scanQueue.filter((id) => !done.has(id));
  }
  const next = w.scanQueue.shift();
  if (next === undefined) return;
  const s = w.spells.find((x) => x.id === next)!;
  scan(w, s);
  if (!(s.spell in STAT_BUF)) w.scanQueue.push(s.id); // all but buffs go round again
}

/**
 * One tick of one spell: the class's update, then SpellBase's (0x0207A9E0): with its caster gone
 * the spell is over; otherwise it counts down and is over at 0. So a damage spell hits D + 1 times
 * (confirmed: 61, 71, 76 updates). Returns true when it is over.
 */
function stepSpell(w: World, s: ActiveSpell): boolean {
  const caster = findById(w.units, s.caster);
  const alive = !!caster && caster.hp > 0;
  if (HEAL.has(s.spell) && --s.timer === 0) {
    pulse(w, s);
    s.timer = HEAL_PULSE;
  }
  if (s.spell in DAMAGE && alive) damageTick(w, s, caster);
  if (FREEZE.has(s.spell)) {
    if (s.timer === 0 || !alive) return true; // its own timer; SpellBase never times it out
    freezeTick(w, s);
    s.timer--;
    return false;
  }
  if (!alive) s.left = 0;
  if (s.left === 0) return true;
  if (s.left > 0) s.left--;
  return false;
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
