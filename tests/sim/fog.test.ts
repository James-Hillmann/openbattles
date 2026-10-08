import { describe, expect, it } from 'vitest';
import { cellCenterX, cellCenterY, createFog, createWorld, isExplored, isVisible, spawnUnit, stampCircle, updateFog, type AttackStats, type TerrainGrid } from '@lbw/sim';

const open = (w: number, h: number): TerrainGrid => ({ width: w, height: h, cells: new Uint8Array(w * h) });
const sight = (r: number): AttackStats => ({ damage: 1, damageRand: 0, cooldown: 30, minRange: 0, maxRange: 1, sight: r, projectile: null });

/** Rows of the visible grid as [y, first x, last x]. */
function spans(f: ReturnType<typeof createFog>): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < f.height; y++) {
    const row = [...f.visible.subarray(y * f.width, (y + 1) * f.width)];
    const a = row.indexOf(1);
    if (a < 0) continue;
    const b = row.lastIndexOf(1);
    expect(row.slice(a, b + 1).every((v) => v === 1)).toBe(true);
    out.push([y, a, b]);
  }
  return out;
}

describe('fog of war', () => {
  it('stamps circles exactly like the game (mp01 start, read from RAM)', () => {
    // Castle (11, 11) sight 11, King (11, 15) sight 7, builder (10, 13) sight 5, on the 64x64 mp01 grid.
    const f = createFog(64, 64);
    for (const [x, y, r] of [[11, 15, 7], [10, 13, 5], [11, 11, 11]] as const) stampCircle(f, f.visible, x, y, r);
    expect(spans(f)).toEqual([
      [0, 8, 14], [1, 6, 16], [2, 5, 17], [3, 3, 19], [4, 3, 19], [5, 2, 20], [6, 1, 21], [7, 1, 21], [8, 0, 22], [9, 0, 22], [10, 0, 22],
      [11, 0, 22], [12, 0, 22], [13, 0, 22], [14, 0, 22], [15, 1, 21], [16, 1, 21], [17, 2, 20], [18, 3, 19], [19, 3, 19], [20, 5, 17],
      [21, 6, 16], [22, 8, 14],
    ]);
  });

  it('keeps explored cells after the unit walks away, but not visible ones', () => {
    const w = createWorld({ seed: 1, grid: open(40, 20) });
    const u = spawnUnit(w, 0, cellCenterX(5), cellCenterY(5), { attack: sight(3) });
    spawnUnit(w, 1, cellCenterX(30), cellCenterY(5), { attack: sight(3) });
    const f = createFog(40, 20);
    updateFog(f, w, 0);
    expect(isVisible(f, 5, 8)).toBe(true);
    expect(isVisible(f, 5, 9)).toBe(false);
    expect(isExplored(f, 30, 5)).toBe(false); // the enemy's own circle isn't ours
    // Teleport the unit (placement is the sim's business; fog only reads the cell).
    u.cell = 5 * 40 + 20;
    updateFog(f, w, 0);
    expect(isVisible(f, 5, 5)).toBe(false);
    expect(isExplored(f, 5, 5)).toBe(true);
    expect(isVisible(f, 20, 5)).toBe(true);
  });

  it('buildings see without attacking: a castle with no damage still lights its sight circle', () => {
    const w = createWorld({ seed: 1, grid: open(40, 40) });
    // Entities.ebp gives a castle melee fields of 0 and no projectile, with sight 11.
    const castle = spawnUnit(w, 0, cellCenterX(20), cellCenterY(20), { attack: { ...sight(11), damage: 0, damageRand: 0 }, role: 7 });
    expect(castle.attack).toBeNull();
    expect(castle.sight).toBe(11);
    const f = createFog(40, 40);
    updateFog(f, w, 0);
    expect(isVisible(f, 20, 9)).toBe(true);
    expect(isVisible(f, 20, 8)).toBe(false);
  });
});
