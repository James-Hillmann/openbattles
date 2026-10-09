import { describe, expect, it } from 'vitest';
import { listUnlockables, readDefaultUnlocks, type EntityRecord } from '@lbw/extract';

function rec(index: number, kind: number, name: string, bit: number, target = 0, price = 0): EntityRecord {
  const raw = new Uint8Array(0x70);
  const v = new DataView(raw.buffer);
  v.setUint16(0x6c, bit, true);
  v.setUint16(0x60, target, true);
  v.setUint16(0x68, price, true);
  raw[8] = kind;
  return { index, kind, name, sprite: '', raw };
}

describe('unlockables', () => {
  it('lists kind-2 unlock records by bit, with category, target and default state', () => {
    const recs = [
      rec(0, 0, 'K_King', 0),
      rec(1, 2, 'HealthPowerup', 0),
      rec(2, 2, 'Minifig_K_King', 96, 0, 0),
      rec(3, 2, 'Map_01', 0),
      rec(4, 2, 'RedBrick_TurnOffFow', 196),
    ];
    const u = listUnlockables(recs, new Set([2, 3]));
    expect(u.map((x) => [x.bit, x.name, x.category, x.unlockedAtStart])).toEqual([
      [0, 'Map_01', 'map', true],
      [96, 'Minifig_K_King', 'minifig', true],
      [196, 'RedBrick_TurnOffFow', 'red-brick', false],
    ]);
  });

  it('reads the default table as u32 entity indices', () => {
    const arm9 = new Uint8Array(0x128528 + 27 * 4);
    new DataView(arm9.buffer).setUint32(0x128528, 0x164, true);
    const d = readDefaultUnlocks(arm9, 0x02000000, 'C5SE')!;
    expect(d.has(0x164)).toBe(true);
    expect(readDefaultUnlocks(arm9, 0x02000000, 'XXXX')).toBeNull();
  });
});
