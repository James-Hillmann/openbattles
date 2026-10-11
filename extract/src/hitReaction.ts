import type { UnpackedRom } from './rom';

/**
 * What a unit does when it is hit (docs/re-notes/combat.md "Hit reaction"): a short effect whose
 * frame goes up by one per game tick (0x0201C508). Each frame is a 4-byte record in ARM9: s16 x
 * offset in pixels (the unit shakes sideways), u8 palette bank (12, the grey flash bank), u8 1 if
 * the unit is drawn in that bank. A record with bank 0 ends the list. Minifigures, ships and
 * vehicles (roles 0-6) get it; buildings don't. Only sprite units show it: a 3D model unit runs the
 * same effect but neither moves nor changes colour (emulator: poking the table changed nothing).
 */
export interface HitFrame {
  dx: number;
  flash: boolean;
}

const HIT_TABLE: Record<string, number> = { C5SE: 0x02143460 };

export function readHitReaction(rom: UnpackedRom): HitFrame[] | undefined {
  const addr = HIT_TABLE[rom.header.gameCode];
  if (addr === undefined) return undefined;
  const a = rom.arm9;
  const out: HitFrame[] = [];
  for (let o = addr - rom.header.arm9.ramAddress; out.length < 32; o += 4) {
    if (a[o + 2] === 0) break;
    const dx = (a[o]! | (a[o + 1]! << 8)) << 16 >> 16;
    out.push({ dx, flash: a[o + 3] !== 0 });
  }
  return out;
}
