import type { PaletteCycle } from './fogArt';
import type { CharData } from './nitro';

/**
 * Animated water and lava (docs/re-notes/fog.md "Colour cycling"): the game turns some colours of
 * the map's tileset palette every few ticks (0x02028590), so every ground pixel drawn in those
 * colours moves. The baked ground is one still picture; this keeps, for each cell picture that uses
 * a turning colour, which of its pixels do and in which colour, so the client can redraw just those.
 */
export interface GroundCycles {
  cycles: readonly PaletteCycle[];
  /** The tileset palette, 256 RGBA colours. */
  palette: Uint8Array;
  /** Cell pictures (24 x 16 palette indices, row by row) with 0 where the colour doesn't turn. */
  pictures: Uint8Array[];
  /** Per map cell: 1 + its index in `pictures`, or 0 when nothing in it turns. */
  cells: Uint16Array;
}

const CELL_W = 24;
const CELL_H = 16;

/** Palette index of each pixel the way blitTile draws it (4bpp tiles add their bank), 0 = see-through. */
function tileIndex(chars: CharData, entry: number, x: number, y: number): number {
  const tile = entry & 0x3ff;
  const hf = (entry >> 10) & 1;
  const vf = (entry >> 11) & 1;
  const v = chars.pixels[tile * 64 + (vf ? 7 - y : y) * 8 + (hf ? 7 - x : x)] ?? 0;
  if (v === 0) return 0;
  return chars.bpp === 4 ? (entry >> 12) * 16 + v : v;
}

export function groundCycles(
  map: { width: number; height: number; ground: Uint16Array },
  chars: CharData,
  pal: Uint8Array,
  metatiles: Uint16Array,
  cycles: readonly PaletteCycle[],
): GroundCycles | undefined {
  if (!cycles.length) return undefined;
  const turns = new Uint8Array(256);
  for (const c of cycles) for (let i = c.first; i <= c.last; i++) turns[i] = 1;
  const pictures: Uint8Array[] = [];
  const byMetatile = new Map<number, number>();
  const cells = new Uint16Array(map.width * map.height);
  for (let c = 0; c < cells.length; c++) {
    const m = map.ground[c]!;
    let p = byMetatile.get(m);
    if (p === undefined) {
      const pic = new Uint8Array(CELL_W * CELL_H);
      let any = false;
      for (let k = 0; k < 6; k++) {
        const entry = metatiles[m * 6 + k];
        if (entry === undefined) continue;
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const i = tileIndex(chars, entry, x, y);
            if (!turns[i]) continue;
            pic[(Math.floor(k / 3) * 8 + y) * CELL_W + (k % 3) * 8 + x] = i;
            any = true;
          }
      }
      p = any ? pictures.push(pic) : 0;
      byMetatile.set(m, p);
    }
    cells[c] = p;
  }
  return pictures.length ? { cycles, palette: pal.slice(0, 256 * 4), pictures, cells } : undefined;
}
