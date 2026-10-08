import { describe, expect, it } from 'vitest';
import { unpackRom } from '@lbw/extract';
import { buildRom } from '../fixtures/syntheticRom';

describe('NDS unpack', () => {
  const r = unpackRom(buildRom());

  it('reads the header', () => {
    expect(r.header.title).toBe('LEGOBATTLES');
    expect(r.header.gameCode).toBe('TEST');
    expect(r.header.arm9.ramAddress).toBe(0x02000000);
    expect(r.arm9.length).toBe(0x10);
    expect(r.arm9WasCompressed).toBe(false);
  });

  it('walks the FNT into paths with correct file ids', () => {
    expect(r.files.map((f) => [f.id, f.path])).toEqual([
      [1, 'readme.txt'],
      [2, 'data/units.bin'],
      [3, 'data/sprites/a.narc'],
    ]);
  });

  it('reads overlays', () => {
    expect(r.overlays).toHaveLength(1);
    expect(r.overlays[0]!.ramAddress).toBe(0x02100000);
    expect([...r.overlays[0]!.data]).toEqual([0xe1, 0x2f, 0xff, 0x1e]);
  });

  it('inventories formats by extension and magic', () => {
    const narc = r.inventory.find((i) => i.ext === 'narc');
    expect(narc?.magic).toBe('NARC');
    expect(r.inventory.find((i) => i.ext === 'bin')?.magic).toBe('?');
  });
});
