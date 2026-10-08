import { u16 } from './bytes';
import type { EntityRecord } from './entities';

/**
 * The game's unlockables: kind-2 records in Entities.ebp that carry a bit
 * index (+0x6C) into the save's unlock bit arrays (289 bits,
 * `User::UnlockableManager`). See docs/re-notes/unlocks.md.
 *
 * OpenBattles gates none of these: every faction, unit and map is available
 * from the start. This list exists so we know what the game would gate.
 */
export type UnlockCategory = 'map' | 'concept-art' | 'minifig' | 'red-brick' | 'minikit';

export interface Unlockable {
  /** Bit in the unlock arrays (+0x6C). */
  bit: number;
  /** Entity index of the unlock record itself. */
  entity: number;
  name: string;
  category: UnlockCategory;
  /** +0x60: for minifigs, the entity index of the unit it unlocks; for maps, a text id. */
  target: number;
  /** +0x68: a price or requirement, meaning not traced (heroes 30, bonus heroes 40, Santa 50). guess */
  price: number;
  /** Unlocked on a new profile (the 27-entry default table in ARM9). */
  unlockedAtStart: boolean;
}

function category(name: string): UnlockCategory | null {
  if (name.startsWith('Map_')) return 'map';
  if (name.startsWith('ConceptArt_')) return 'concept-art';
  if (name.startsWith('Minifig_')) return 'minifig';
  if (name.startsWith('RedBrick_')) return 'red-brick';
  if (name.startsWith('Minikit')) return 'minikit';
  return null;
}

/** USA (C5SE): table of 27 u32 entity indices the game unlocks on a new profile (read by 0x020EB464). */
const DEFAULT_TABLE: Record<string, { addr: number; count: number }> = {
  C5SE: { addr: 0x02128528, count: 27 },
};

/** Entity indices unlocked on a new profile, or null for an unknown game version. */
export function readDefaultUnlocks(arm9: Uint8Array, ramAddress: number, gameCode: string): Set<number> | null {
  const t = DEFAULT_TABLE[gameCode];
  if (!t) return null;
  const out = new Set<number>();
  const at = t.addr - ramAddress;
  for (let i = 0; i < t.count; i++) out.add(u16(arm9, at + i * 4) | (u16(arm9, at + i * 4 + 2) << 16));
  return out;
}

export function listUnlockables(recs: readonly EntityRecord[], defaults: ReadonlySet<number> = new Set()): Unlockable[] {
  const out: Unlockable[] = [];
  for (const r of recs) {
    if (r.kind !== 2) continue;
    const cat = category(r.name);
    if (!cat) continue;
    out.push({
      bit: u16(r.raw, 0x6c),
      entity: r.index,
      name: r.name,
      category: cat,
      target: u16(r.raw, 0x60),
      price: u16(r.raw, 0x68),
      unlockedAtStart: defaults.has(r.index),
    });
  }
  return out.sort((a, b) => a.bit - b.bit);
}
