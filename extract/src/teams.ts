/**
 * Unit palette fix-ups the game applies at load (read from a savestate's texture
 * palette VRAM; confirmed for the red and blue teams on C5SE):
 *
 * - Colors 12-14 of each team's two banks (2t, 2t+1) come from a 6 x 3 table of
 *   BGR555 colors in ARM9, not from `<Faction>Faction.NCLR`.
 * - Color 15 of the odd ("selected") bank is the outline: yellow 0x03FF for the
 *   local player's team, red 0x001F for the others (red for others is likely).
 */
const TEAM_COLOR_ADDRS: Record<string, number> = { C5SE: 0x02127e48 };

export const OUTLINE_OWN = 0x03ff;
export const OUTLINE_OTHER = 0x001f;

function bgr555(c: number): [number, number, number] {
  return [((c & 31) * 255) / 31, (((c >> 5) & 31) * 255) / 31, (((c >> 10) & 31) * 255) / 31];
}

/** Patch a decoded faction palette (RGBA, 16 banks of 16) in place. */
export function applyTeamColors(pal: Uint8Array, arm9: Uint8Array, ramAddress: number, gameCode: string, localTeam: number): void {
  const addr = TEAM_COLOR_ADDRS[gameCode];
  for (let t = 0; t < 6; t++) {
    for (const bank of [2 * t, 2 * t + 1]) {
      if (addr !== undefined) {
        for (let k = 0; k < 3; k++) {
          const o = addr - ramAddress + (t * 3 + k) * 2;
          pal.set(bgr555(arm9[o]! | (arm9[o + 1]! << 8)), (bank * 16 + 12 + k) * 4);
        }
      }
      if (bank & 1) pal.set(bgr555(t === localTeam ? OUTLINE_OWN : OUTLINE_OTHER), (bank * 16 + 15) * 4);
    }
  }
}
