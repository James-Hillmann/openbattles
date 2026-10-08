import { describe, expect, it } from 'vitest';
import { buildUnitSprites, parseEntities, spriteLayout, type EntityInfo } from '@lbw/extract';

const u16le = (v: number) => [v & 0xff, v >> 8];

/** Synthetic BPNZ: records of 0x7C bytes, strings at 0xFA08. Made-up names. */
function ebp(entries: { name: string; asset: string; speed: number }[]): Uint8Array {
  const d = new Uint8Array(0xfa08 + 256);
  d.set([0x42, 0x50, 0x4e, 0x5a], 0);
  let str = 0;
  entries.forEach((e, i) => {
    const r = 4 + i * 0x7c;
    d.set(u16le(str), r);
    d.set(u16le(0x100 + i), r + 6);
    d.set(u16le(e.speed), r + 0x0c);
    for (const s of [e.name, e.asset]) {
      d.set([...s].map((c) => c.charCodeAt(0)), 0xfa08 + str);
      str += s.length + 1;
    }
  });
  return d;
}

describe('entity table', () => {
  it('reads names, asset paths and speeds', () => {
    const list = parseEntities(ebp([
      { name: 'X_Hero', asset: 'Sprites/x_hrm', speed: 410 },
      { name: 'X_Ship', asset: 'Models/X_Ship', speed: 600 },
    ]));
    expect(list.map((e) => [e.name, e.asset, e.speed, e.id])).toEqual([
      ['X_Hero', 'Sprites/x_hrm', 410, 0x100],
      ['X_Ship', 'Models/X_Ship', 600, 0x101],
    ]);
  });

  it('picks the sprite layout from the asset path', () => {
    expect(spriteLayout('Sprites/k_hrm')).toBe('hero');
    expect(spriteLayout('Sprites/k_eng')).toBe('infantry');
    expect(spriteLayout('Sprites/k_rgd')).toBe('infantry');
    expect(spriteLayout('Sprites/k_bld_mtd')).toBe('mounted');
    expect(spriteLayout('Models/K_Ballista')).toBeNull();
  });
});

describe('unit atlases', () => {
  /** Linear 4bpp-style CharData stand-in, filled with one palette index. */
  const sheet = (w: number, h: number, v: number) => ({ tilesWide: w / 8, tilesHigh: h / 8, bpp: 4 as const, pixels: new Uint8Array(w * h).fill(v) });

  it('packs infantry idle, walk and attack into facing rows', () => {
    const e: EntityInfo = { index: 0, id: 1, name: 'X_Mel', asset: 'Sprites/x_mel', speed: 410 };
    // Idle strip = index 1, walk sheet = 2, attack sheet = 3.
    const files: Record<string, ReturnType<typeof sheet>> = {
      'Sprites/x_mel_0.NCBR': sheet(128, 32, 1),
      'Sprites/x_mel_1.NCBR': sheet(128, 128, 2),
      'Sprites/x_mel_2.NCBR': sheet(128, 128, 3),
    };
    // Palette: bank 0 color v = (v, 0, 0); bank 2 color v = (0, v, 0).
    const pal = new Uint8Array(48 * 4);
    for (let v = 0; v < 16; v++) {
      pal.set([v, 0, 0, 255], v * 4);
      pal.set([0, v, 0, 255], (32 + v) * 4);
    }
    const out = buildUnitSprites([e], (p) => files[p], pal, [0, 2]);
    expect(out.map((s) => s.key)).toEqual(['X_Mel@0', 'X_Mel@2']);
    const s = out[0]!;
    expect([s.atlas.width, s.atlas.height, s.frame]).toEqual([11 * 24, 5 * 24, 24]);
    const px = (col: number, row: number) => s.atlas.data[((row * 24 + 12) * s.atlas.width + col * 24 + 12) * 4];
    expect([px(0, 0), px(1, 4), px(5, 2), px(6, 1), px(10, 3)]).toEqual([1, 2, 2, 3, 3]);
    expect(s.walk).toEqual([1, 2, 3, 4, 5, 0]);
    expect(out[1]!.atlas.data[((12) * s.atlas.width + 12) * 4 + 1]).toBe(1);
  });
});
