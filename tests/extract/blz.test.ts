import { describe, expect, it } from 'vitest';
import { blzDecompress, decompressArm9, findModuleParams } from '@lbw/extract';

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Hand-built BLZ stream. Forward (pre-inversion) token stream:
 *   flags 0b0001_0000 -> 3 literals "ABC", then a match
 *   match 0xF000      -> length 15+3 = 18, distance 0+3 = 3
 * Decoded forward = "ABC" * 7 (21 bytes); BLZ stores both streams reversed.
 */
function sample(prefix: number[]): Uint8Array {
  const pak = [0x10, ...bytes('ABC'), 0xf0, 0x00];
  const hdrLen = 8;
  const encLen = pak.length + hdrLen;
  const incLen = 21 - encLen;
  const footer = [encLen & 0xff, (encLen >> 8) & 0xff, (encLen >> 16) & 0xff, hdrLen, incLen, 0, 0, 0];
  return new Uint8Array([...prefix, ...pak.reverse(), ...footer]);
}

describe('BLZ', () => {
  it('decodes a hand-built stream and keeps the raw prefix', () => {
    const out = blzDecompress(sample(bytes('XY')));
    const expected = 'XY' + 'ABC'.repeat(7).split('').reverse().join('');
    expect(String.fromCharCode(...out)).toBe(expected);
  });

  it('returns data unchanged when the increase field is 0', () => {
    const d = new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]);
    expect([...blzDecompress(d)]).toEqual([...d]);
  });

  it('rejects a corrupt footer', () => {
    expect(() => blzDecompress(new Uint8Array([0, 0, 0, 0x20, 1, 0, 0, 0]))).toThrow();
  });

  it('decompresses an ARM9 via its module params', () => {
    const ram = 0x02000000;
    // 0x40 bytes of "code", module params at 0x10, then the compressed tail.
    const head = new Uint8Array(0x40);
    head.set([0x21, 0x06, 0xc0, 0xde, 0xde, 0xc0, 0x06, 0x21], 0x10 + 0x1c);
    const tail = sample([]);
    const arm9 = new Uint8Array([...head, ...tail]);
    new DataView(arm9.buffer).setUint32(0x10 + 0x14, ram + arm9.length, true);
    expect(findModuleParams(arm9)?.moduleParamsOffset).toBe(0x10);
    const { data, wasCompressed } = decompressArm9(arm9, ram);
    expect(wasCompressed).toBe(true);
    expect(data.length).toBe(0x40 + 21);
    expect(findModuleParams(data)?.compressedEnd).toBe(0);
  });
});
