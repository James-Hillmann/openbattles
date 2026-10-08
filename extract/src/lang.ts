import { ascii, u16, u32 } from './bytes';

/**
 * LOC/<Language>.lng text tables (not PMOC-wrapped). Layout, confirmed on
 * American_English.lng:
 *   0x00 "LANG", 0x04 u32 (unknown), 0x08 u32 0, 0x0C u32 (unknown),
 *   0x10 u32[n] absolute offsets of NUL-terminated Latin-1 strings, where
 *   n = (first offset - 0x10) / 4.
 */
export function parseLang(d: Uint8Array): string[] {
  if (ascii(d, 0, 4) !== 'LANG') throw new Error('Not a LANG file');
  const first = u32(d, 0x10);
  const n = (first - 0x10) >> 2;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let o = u32(d, 0x10 + i * 4);
    let s = '';
    while (o < d.length && d[o] !== 0) s += String.fromCharCode(d[o++]!);
    out.push(s);
  }
  return out;
}

/** Entities.ebp records: 0x7C bytes from offset 4; names at 0xFA08 + u16 at +0x00. */
const ENTITY_SIZE = 0x7c;
const ENTITY_NAMES = 0xfa08;

export interface EntityLabel {
  /** Internal name, e.g. `K_Swordsman`. Also the portrait file name under UI/GamePlayerCards/. */
  id: string;
  /** Name shown in the HUD, e.g. `Guardsman`. */
  display: string;
  /** +0x62 u16: hit points (confirmed for the King: 1000). */
  maxHp: number;
}

/**
 * Display name of each entity: LANG string (global id at +0x06) - 1. Likely: it holds for every
 * King-faction record (K_King -> "King", K_Swordsman -> "Guardsman", K_Stables -> "Special Factory").
 */
export function entityLabels(entities: Uint8Array, lang: readonly string[]): EntityLabel[] {
  const out: EntityLabel[] = [];
  // +0x04 u16 is the record's own index; the table ends where that stops counting up.
  for (let i = 0, o = 4; o + ENTITY_SIZE <= ENTITY_NAMES && u16(entities, o + 4) === i; i++, o += ENTITY_SIZE) {
    let p = ENTITY_NAMES + u16(entities, o);
    let id = '';
    while (p < entities.length && entities[p] !== 0) id += String.fromCharCode(entities[p++]!);
    out.push({ id, display: lang[u16(entities, o + 6) - 1] ?? id, maxHp: u16(entities, o + 0x62) });
  }
  return out;
}
