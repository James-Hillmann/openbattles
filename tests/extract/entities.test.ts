import { describe, expect, it } from 'vitest';
import { findUnitStats, parseEntityRecords, readCombatBonus } from '@lbw/extract';

/** A tiny synthetic BPNZ: one melee unit, one ranged unit, one projectile. No game data. */
function syntheticEbp(): Uint8Array {
  const recs: Uint8Array[] = [];
  const names = ['T_Melee\0spr/m\0', 'T_Ranged\0spr/r\0', 'T_Bolt\0spr/b\0'];
  let strOff = 0;
  const offs = names.map((n) => ((strOff += n.length), strOff - n.length));
  const unit = (i: number, f: (r: DataView) => void) => {
    const r = new Uint8Array(0x7c);
    const v = new DataView(r.buffer);
    v.setUint16(0, offs[i]!, true);
    v.setUint16(4, i, true);
    r[8] = 0;
    v.setUint16(0x66, 0xffff, true);
    f(v);
    recs.push(r);
  };
  unit(0, (v) => {
    v.setUint16(0x0c, 410, true);
    v.setUint16(0x62, 350, true);
    v.setUint16(0x68, 10, true);
    v.setUint16(0x6a, 5, true);
    v.setUint8(0x6d, 30);
    v.setUint8(0x6e, 1);
    v.setUint8(0x6f, 1);
    v.setUint8(0x71, 5);
    v.setUint8(0x5c, 2);
    v.setUint8(0x70, 15);
  });
  unit(1, (v) => {
    v.setUint16(0x66, 2, true);
    v.setUint8(0x6f, 5);
    v.setUint16(0x60, 270, true);
    v.setUint8(0x1d, 2);
    v.setUint8(0x6c, 25);
  });
  const p = new Uint8Array(0x74);
  const pv = new DataView(p.buffer);
  pv.setUint16(0, offs[2]!, true);
  p[8] = 1;
  pv.setUint16(0x0c, 2048, true);
  pv.setUint16(0x70, 15, true);
  pv.setUint16(0x72, 20, true);
  p[0x6b] = 1;
  recs.push(p);
  // The parser walks the game's fixed record count; pad with empty kind-2 records.
  while (recs.length < 0x227) recs.push(new Uint8Array(0x70).fill(0).map((_, i) => (i === 8 ? 2 : 0)));
  const strings = new TextEncoder().encode(names.join(''));
  const total = 4 + recs.reduce((n, r) => n + r.length, 0) + strings.length;
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode('BPNZ'));
  let o = 4;
  for (const r of recs) (out.set(r, o), (o += r.length));
  out.set(strings, o);
  return out;
}

describe('Entities.ebp', () => {
  const recs = parseEntityRecords(syntheticEbp());

  it('walks variable-size records and resolves names and sprite paths', () => {
    expect(recs).toHaveLength(0x227);
    expect(recs.slice(0, 3).map((r) => [r.name, r.sprite, r.kind])).toEqual([
      ['T_Melee', 'spr/m', 0],
      ['T_Ranged', 'spr/r', 0],
      ['T_Bolt', 'spr/b', 1],
    ]);
  });

  it('reads melee and ranged combat stats', () => {
    expect(findUnitStats(recs, 'T_Melee')).toMatchObject({
      index: 0, speed: 410, hp: 350, damage: 10, damageRand: 5, cooldown: 30, minRange: 1, maxRange: 1, sight: 5, role: 2, priority: 15, projectile: null,
    });
    expect(findUnitStats(recs, 'T_Ranged').projectile).toEqual({ speed: 2048, minDamage: 15, maxDamage: 20, splash: true });
  });

  it('reads the economy fields: build time, footprint and mine yield', () => {
    expect(findUnitStats(recs, 'T_Ranged')).toMatchObject({ buildTime: 270, size: 2, yield: 25 });
  });

  it('returns null bonus tables for unknown game versions', () => {
    expect(readCombatBonus(new Uint8Array(16), 0x02000000, 'XXXX')).toBeNull();
  });
});
