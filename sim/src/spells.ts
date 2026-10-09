import { cellOf } from './terrain';
import { findById } from './combat';
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
 * What the player taps after picking the spell (record +0x08): 0x40 nothing (it goes off around the
 * hero at once), 2 a unit, 1 a spot. likely: the AI's chooser (0x020979F0) reads the flags this way,
 * and spells 5/7/9 (flags 1) and 13 (0x40) behave so in the emulator.
 */
export function spellTarget(def: SpellDef): 'unit' | 'point' | 'none' {
  if (def.flags & 0x40) return 'none';
  if (def.flags & 2) return 'unit';
  return 'point';
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
  if (mode === 'unit' && (!t || t.hp <= 0)) return;
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

/** Spell classes, picked by the record's type byte in the factory (0x0207BBEC). */
const HEAL = new Set([1, 2, 3]);
/** StatBufSpell (ctor 0x0207C270): spell id -> buff slot. */
const STAT_BUF: Record<number, number> = { 4: 0, 5: 0, 24: 0, 6: 1, 7: 1, 8: 2, 9: 2, 19: 3, 17: 4 };
/** Every buff lasts ms->ticks(10000) = 300 ticks, whatever the record says. confirmed */
export const BUFF_TICKS = 300;
/** Heals pulse every ms->ticks(250) = 7 ticks. confirmed */
const HEAL_PULSE = 7;
/** The passive auras: every base heals its heroes (spell 1), every hero its army (spell 2). */
const AURA_BASE = 1;
const AURA_HERO = 2;

/** True for the spells this sim runs (the rest are paid for and do nothing yet). */
export function spellWorks(id: number): boolean {
  return HEAL.has(id) || id in STAT_BUF;
}

/**
 * Create a spell and start it (game: factory 0x0207BBEC, then SpellBase start 0x0207AC44 spot /
 * 0x0207AB50 unit / 0x0207ABA0 around the caster). A unit spell holds its target at once; an area
 * spell waits in the scan queue for its units.
 */
function startSpell(w: World, caster: Unit, def: SpellDef, mode: 'unit' | 'point' | 'none', t: Unit | undefined, at: { x: Fx; y: Fx }): ActiveSpell {
  let cx: number;
  let cy: number;
  if (mode === 'none') {
    // Around the caster: its cell plus half its footprint, so a castle's aura is centred on it (0x0207AD54).
    [cx, cy] = cellOf(caster.x, caster.y);
    cx += caster.size >> 1;
    cy += caster.size >> 1;
  } else [cx, cy] = cellOf(at.x, at.y);
  const s: ActiveSpell = {
    id: w.nextSpell++, owner: caster.owner, spell: def.id, caster: caster.id, target: t?.id ?? 0, x: at.x, y: at.y, start: w.tick,
    left: def.id in STAT_BUF ? BUFF_TICKS : def.id === 3 ? 1 : -1,
    cx, cy, radius: mode === 'unit' ? -1 : def.b7, units: [], timer: 1,
  };
  w.spells.push(s);
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
 * Who a spell takes in its area (0x0207AFF0 with filter 1, 0x020785B0 / 0x0207C44C): the caster's
 * own units, not the caster, not buildings (spell 17 takes mines). The base aura takes only heroes.
 */
function takes(s: ActiveSpell, u: Unit): boolean {
  if (u.owner !== s.owner || u.id === s.caster || u.hp <= 0) return false;
  if (s.spell === AURA_BASE) return u.role === ROLE_HERO;
  if (s.spell === 17) return !isBuilding(u) || u.role === 9;
  return !isBuilding(u);
}

/** A unit joins a spell's area: buffs take hold (0x0205ED28). */
function enter(w: World, s: ActiveSpell, u: Unit): void {
  s.units.push(u.id);
  const slot = STAT_BUF[s.spell];
  if (slot !== undefined) u.buffs[slot]!++;
}

/** The spell lets go of its units: buffs lift (0x0205F06C). */
function leaveAll(w: World, s: ActiveSpell): void {
  const slot = STAT_BUF[s.spell];
  if (slot !== undefined)
    for (const id of s.units) {
      const u = findById(w.units, id);
      if (u) u.buffs[slot]!--;
    }
  s.units = [];
}

/**
 * Area scan (0x0207AD54): own units whose cell is within |dx| + |dy| <= radius of the centre.
 * Buffs scan once; the passive heals rescan every time their turn comes round (0x0207AFE8).
 */
function scan(w: World, s: ActiveSpell): void {
  if (s.radius < 0) return;
  leaveAll(w, s);
  for (const u of w.units) {
    if (!takes(s, u)) continue;
    const [ux, uy] = cellOf(u.x, u.y);
    if (Math.abs(ux - s.cx) + Math.abs(uy - s.cy) <= s.radius) enter(w, s, u);
  }
}

/** Heal pulse (0x02078750): passives +30 to heroes (base) or +10 (hero), the one-off spell 3 maxHp/4. */
function pulse(w: World, s: ActiveSpell): void {
  const caster = findById(w.units, s.caster);
  if (s.spell === AURA_BASE && caster && !isFinished(caster)) return;
  for (const id of s.units) {
    const u = findById(w.units, id);
    if (!u || u.hp <= 0 || u.hp >= u.maxHp) continue;
    const add = s.spell === AURA_BASE ? 30 : s.spell === AURA_HERO ? 10 : (u.maxHp << 14) >> 16;
    u.hp = Math.min(u.maxHp, u.hp + add);
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
    for (const s of w.spells) if (done.has(s.id)) leaveAll(w, s);
    w.spells = w.spells.filter((s) => !done.has(s.id));
    w.scanQueue = w.scanQueue.filter((id) => !done.has(id));
  }
  const next = w.scanQueue.shift();
  if (next === undefined) return;
  const s = w.spells.find((x) => x.id === next)!;
  scan(w, s);
  if (s.left === -1) w.scanQueue.push(s.id); // passive heals go round again
}

/** One tick of one spell (SpellBase update 0x0207A9E0, then the class's); true when it is over. */
function stepSpell(w: World, s: ActiveSpell): boolean {
  const caster = findById(w.units, s.caster);
  if (!caster || caster.hp <= 0) s.left = 0;
  if (s.left === 0) return true;
  if (s.left > 0) s.left--;
  if (HEAL.has(s.spell) && --s.timer === 0) {
    pulse(w, s);
    s.timer = HEAL_PULSE;
  }
  return false;
}

/** Bring a unit's stats up to date with its buffs; call at the start of its update. */
export function refreshBoost(u: Unit): void {
  let b = 0;
  for (let i = 0; i < BUFF_SLOTS; i++) if (u.buffs[i]! > 0) b |= 1 << i;
  u.boost = b;
}

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
