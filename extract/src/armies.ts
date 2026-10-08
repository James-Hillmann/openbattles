import { u16 } from './bytes';
import type { EntityRecord } from './entities';
import type { Unlockable } from './unlocks';

/**
 * Armies: BP/Factions.fbp (FANZ) and the army select screen. See docs/re-notes/armies.md.
 *
 * Every army record has 19 entity slots. Slots 0-8 are the nine units the army select
 * screen shows (hero, builder, close combat, ranged, mounted, three specials, transport),
 * slots 9-18 its buildings (base, mill, mine, farm, barracks, special factory, shipyard,
 * three tower levels). confirmed: the six playable armies list exactly what the emulator's
 * army screen shows for them.
 */

/** One FANZ record. */
export interface ArmyRecord {
  name: string;
  /** +0x04 (u8): 0x7C King, 0x7D Wizard, 0x7E Pirates, 0x7F Imperial, 0x80 Earth, 0x81 Aliens. */
  faction: number;
  /** Entity index per slot, -1 for an empty slot (0xFFFF in the file). */
  slots: number[];
}

/** Units on the army select screen, in the game's slot order. */
export const ARMY_SLOTS = 9;
/** Text ids (LOC .lng) for each unit slot's label on the army screen: Hero, Builder, Close Combat, Ranged, Mounted, Special x3, Transport. */
export const ARMY_SLOT_TEXT = [244, 245, 241, 242, 243, 246, 246, 246, 250] as const;
/** The six playable armies, by record name, in the game's faction order. */
export const PLAYABLE_ARMIES = ['King', 'Wizard', 'Pirates', 'Imperial', 'Earth', 'Aliens'] as const;

/** u32 name offset, u8 id, u8 faction, u16 flags, u32 0, then 26 u16 slots (19 army + 7 shared: wall, bridges). */
const RECORD_SIZE = 64;

/** Parse a decompressed Factions.fbp. */
export function parseArmies(fbp: Uint8Array): ArmyRecord[] {
  if (String.fromCharCode(...fbp.subarray(0, 4)) !== 'FANZ') throw new Error('not a FANZ file');
  const recs: { name: number; faction: number; slots: number[] }[] = [];
  // Records run until the id byte stops counting up; the string table follows.
  for (let o = 4; o + RECORD_SIZE <= fbp.length && fbp[o + 4] === (recs.length & 0xff); o += RECORD_SIZE) {
    const slots: number[] = [];
    for (let i = 0; i < 19; i++) {
      const v = u16(fbp, o + 12 + i * 2);
      slots.push(v === 0xffff ? -1 : v);
    }
    recs.push({ name: fbp[o]! | (fbp[o + 1]! << 8) | (fbp[o + 2]! << 16), faction: fbp[o + 5]!, slots });
  }
  const strings = 4 + recs.length * RECORD_SIZE;
  return recs.map((r) => {
    let s = '';
    for (let i = strings + r.name; i < fbp.length && fbp[i] !== 0; i++) s += String.fromCharCode(fbp[i]!);
    return { name: s, faction: r.faction, slots: r.slots };
  });
}

/** An army as the client uses it: entity names per unit slot, and the army whose buildings it keeps. */
export interface Army {
  /** Army whose buildings (slots 9-18) this one uses: a PLAYABLE_ARMIES entry. */
  base: string;
  /** Entity name per unit slot (ARMY_SLOTS long); '' for an empty slot. */
  units: string[];
}

/** The six playable armies as the game ships them. */
export function defaultArmies(armies: readonly ArmyRecord[], recs: readonly EntityRecord[]): Record<string, Army & { buildings: string[] }> {
  const out: Record<string, Army & { buildings: string[] }> = {};
  const name = (i: number) => (i >= 0 ? (recs[i]?.name ?? '') : '');
  for (const a of armies) {
    if (!(PLAYABLE_ARMIES as readonly string[]).includes(a.name)) continue;
    out[a.name] = { base: a.name, units: a.slots.slice(0, ARMY_SLOTS).map(name), buildings: a.slots.slice(ARMY_SLOTS).map(name) };
  }
  return out;
}

/** Armies the bonus characters come from: their units sit in these records' slots. */
const BONUS_ARMIES = ['Trolls', 'Dwarves', 'Islanders', 'Ninjas', 'SpacePolice', 'SpaceCriminals'];
/** The army screen lists the bonus armies' specials under the second Special slot. confirmed (emulator: 11 choices there, 5 in the others) */
const BONUS_SPECIAL_SLOT = 6;

/**
 * What the army screen offers for each unit slot: every character the game lets you
 * unlock (the `Minifig_*` records), in their unlock-table order. The screen leaves out the
 * one already in the slot; we keep it so the list is the same whatever is picked.
 *
 * confirmed (emulator, everything unlocked): hero 25, builder 6, close combat 8, ranged 10,
 * mounted 6, specials 6 / 12 / 6, transport 6, counting the one in the slot. Order confirmed
 * for heroes.
 */
export function armyChoices(armies: readonly ArmyRecord[], recs: readonly EntityRecord[], unlockables: readonly Unlockable[]): string[][] {
  const slotOf = new Map<number, number>();
  for (const a of armies) {
    const playable = (PLAYABLE_ARMIES as readonly string[]).includes(a.name);
    if (!playable && !BONUS_ARMIES.includes(a.name)) continue;
    a.slots.slice(0, ARMY_SLOTS).forEach((e, s) => {
      if (e < 0 || slotOf.has(e)) return;
      slotOf.set(e, playable || s < 5 ? s : BONUS_SPECIAL_SLOT);
    });
  }
  const out: string[][] = Array.from({ length: ARMY_SLOTS }, () => []);
  for (const u of unlockables) {
    if (u.category !== 'minifig') continue;
    const rec = recs[u.target];
    if (!rec) continue;
    // Heroes not in any army record (female heroes, the bonus heroes) are heroes by role.
    const s = slotOf.get(u.target) ?? (rec.raw[0x5c] === 0 ? 0 : -1);
    if (s >= 0 && !out[s]!.includes(rec.name)) out[s]!.push(rec.name);
  }
  return out;
}

/**
 * The game's entity -> icon table: the n-th u32 is the entity whose icon is cell n of
 * UI/MiniHeads (army screen heads) and UI/MiniHeadsGame (in-game strip icons), 24x24 cells,
 * 16 a row. likely: matches every head on the army screen and every building in the
 * Builder's strip in the emulator.
 */
const ICON_TABLE: Record<string, { addr: number; count: number }> = {
  C5SE: { addr: 0x0214e400, count: 166 },
};

/** Icon cell per entity index, or null for an unknown game version. */
export function readIconTable(arm9: Uint8Array, ramAddress: number, gameCode: string): Map<number, number> | null {
  const t = ICON_TABLE[gameCode];
  if (!t) return null;
  const out = new Map<number, number>();
  const at = t.addr - ramAddress;
  for (let i = 0; i < t.count; i++) {
    const e = u16(arm9, at + i * 4) | (u16(arm9, at + i * 4 + 2) << 16);
    if (e !== 0xffffffff && !out.has(e)) out.set(e, i);
  }
  return out;
}

/**
 * In-game strip icon for a unit: the game's build/train strip shows a tool icon rather than
 * the head for the first five units of an army. confirmed for the King's hero (cell 104) and
 * builder (105); the same +104 offset gives the Wizard's hat (120) and the Pirate captain's hat
 * (136) and their units' weapons, which is likely. Imperial, Earth and Alien units would land
 * on other icons that way, so they keep their heads: guess.
 */
export function stripIcon(cell: number, slot: number): number {
  const faction = cell >> 4;
  if (slot >= 0 && slot < 5 && faction < 3 && (cell & 15) === slot) return cell + 104;
  return cell;
}
