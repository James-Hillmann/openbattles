import { cellOf } from './terrain';
import { findById } from './combat';
import type { Fx } from './fixed';
import type { ActiveSpell, EntityId, PlayerId, SpellDef, Unit, World } from './state';

/**
 * Hero spells: charge, the cast check and the spells' effects, ported from the game's
 * SpellPool / SpellBase classes (ARM9 0x0207A890..0x0207C270). docs/re-notes/spells.md.
 */

const ROLE_HERO = 0;

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
 * What the player taps after picking the spell: a unit, a spot, or nothing (cast at once).
 * guess until the targeting flags (+0x08) are traced: 0x40 cast at once (the King's spell 13 does in
 * the emulator), 2 a unit, the rest a spot.
 */
export function spellTarget(def: SpellDef): 'unit' | 'point' | 'none' {
  if (def.flags & 0x40) return 'none';
  if (def.flags === 2) return 'unit';
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
  const t = o.target ? findById(w.units, o.target) : undefined;
  if (o.target && (!t || t.hp <= 0)) return;
  const at = t ? { x: t.x, y: t.y } : { x: o.x, y: o.y };
  if (!payForSpell(caster, def, at)) return;
  const s: ActiveSpell = { id: w.nextId++, owner: player, spell: def.id, caster: caster.id, target: t?.id ?? 0, x: at.x, y: at.y, start: w.tick };
  w.spells.push(s);
}

/** Run every active spell for one tick and drop the finished ones. */
export function spellsStep(w: World): void {
  if (w.spells.length === 0) return;
  w.spells = w.spells.filter((s) => !stepSpell(w, s));
}

/** One tick of one spell; true when it is over. */
function stepSpell(_w: World, _s: ActiveSpell): boolean {
  return true;
}
