import { describe, expect, it } from 'vitest';
import { lzDecompress, pmocDecompress, sniff } from '@lbw/extract';

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** LZ11: "ABCD" literals, then a 2-byte ref (len 3+1=4... ind=3 -> len 4, disp 4), then a 3-byte ref (len 0x11, disp 4). */
const LZ11 = [0x11, 4 + 4 + 17, 0, 0, 0b0000_1100, ...bytes('ABCD'), 0x30, 0x03, 0x00, 0x00, 0x03];
const LZ11_OUT = 'ABCD'.repeat(2) + 'ABCDABCDABCDABCDA';

describe('LZ', () => {
  it('decodes LZ11 short and medium references', () => {
    expect(String.fromCharCode(...lzDecompress(new Uint8Array(LZ11)))).toBe(LZ11_OUT);
  });
  it('decodes LZ10', () => {
    // "XYZ" then ref len (3+3)=6 disp 3
    const lz10 = [0x10, 9, 0, 0, 0b0001_0000, ...bytes('XYZ'), 0x30, 0x02];
    expect(String.fromCharCode(...lzDecompress(new Uint8Array(lz10)))).toBe('XYZXYZXYZ');
  });
  it('rejects other types', () => {
    expect(() => lzDecompress(new Uint8Array([0x24, 0, 0, 0]))).toThrow();
  });
});

describe('PMOC', () => {
  function pmoc(chunks: { lz?: number[]; raw?: number[] }[], total: number): Uint8Array {
    const sizes = chunks.map((c) => (c.lz ? c.lz.length : -c.raw!.length));
    const body = chunks.flatMap((c) => c.lz ?? c.raw!);
    const head = new DataView(new ArrayBuffer(0x10 + sizes.length * 4));
    bytes('PMOC').forEach((b, i) => head.setUint8(i, b));
    head.setUint32(4, total, true);
    head.setUint32(8, sizes.length, true);
    head.setUint32(12, Math.max(...sizes.map(Math.abs)), true);
    sizes.forEach((s, i) => head.setInt32(0x10 + i * 4, s, true));
    return new Uint8Array([...new Uint8Array(head.buffer), ...body]);
  }

  it('concatenates LZ11 and raw (negative-size) chunks', () => {
    const data = pmoc([{ lz: LZ11 }, { raw: bytes('RGCN!') }], LZ11_OUT.length + 5);
    expect(String.fromCharCode(...pmocDecompress(data))).toBe(LZ11_OUT + 'RGCN!');
  });

  it('sniff reports the inner magic', () => {
    expect(sniff(pmoc([{ raw: bytes('MAPTERR') }], 7))).toBe('PMOC>MAPT');
  });

  it('rejects a size mismatch', () => {
    expect(() => pmocDecompress(pmoc([{ raw: [1, 2] }], 3))).toThrow();
  });
});
