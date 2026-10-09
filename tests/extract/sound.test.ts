import { describe, expect, it } from 'vitest';
import {
  adjustTimer,
  attackRate,
  decibel,
  decibelSquare,
  decodeAdpcm,
  decodeStrm,
  fallRate,
  holdResample,
  levelGain,
  OUT_RATE,
  soundArchive,
} from '@lbw/extract';

/** Little-endian byte builder with patchable offsets. */
class W {
  b: number[] = [];
  get at() {
    return this.b.length;
  }
  u8(...v: number[]) {
    for (const x of v) this.b.push(x & 0xff);
    return this;
  }
  u16(...v: number[]) {
    for (const x of v) this.u8(x, x >> 8);
    return this;
  }
  u32(...v: number[]) {
    for (const x of v) this.u16(x & 0xffff, x >>> 16);
    return this;
  }
  str(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  put32(o: number, v: number) {
    for (let i = 0; i < 4; i++) this.b[o + i] = (v >>> (8 * i)) & 0xff;
  }
  bytes() {
    return new Uint8Array(this.b);
  }
}

/** A 16-byte Nitro file header plus a block tag. */
const header = (w: W, magic: string) => w.str(magic).u32(0x0100feff, 0).u16(0x10, 1);

/** SWAR with one PCM8 sample. */
function swar(samples: number[], timer: number): Uint8Array {
  const w = header(new W(), 'SWAR').str('DATA').u32(0).u32(...new Array(8).fill(0)).u32(1).u32(0x40);
  w.u8(0, 0).u16(Math.round(16756991 / timer), timer, 0).u32(samples.length / 4);
  w.u8(...samples.map((s) => s & 0xff));
  return w.bytes();
}

/** SBNK with one single-region PCM instrument (root key 60, ADSR 127/127/127/125, pan 64). */
function sbnk(): Uint8Array {
  const w = header(new W(), 'SBNK').str('DATA').u32(0).u32(...new Array(8).fill(0)).u32(1);
  w.u8(1).u16(0x40).u8(0);
  w.u16(0, 0).u8(60, 127, 127, 127, 125, 64);
  return w.bytes();
}

/** SSAR with one sequence: program 0, note `key` velocity 127 length 0, end. */
function ssar(key: number, volume: number): Uint8Array {
  const w = header(new W(), 'SSAR').str('DATA').u32(0).u32(0x2c, 1);
  w.u32(0).u16(0).u8(volume, 64, 64, 0, 0, 0);
  w.u8(0x81, 0, key, 127, 0, 0xff);
  return w.bytes();
}

function sdat(files: Uint8Array[], arcName: string, seqName: string): Uint8Array {
  const w = header(new W(), 'SDAT');
  w.u32(...new Array(10).fill(0)).u32(0, 0, 0, 0, 0, 0); // block table + padding to 0x40
  w.b.length = 0x40;
  // SYMB: only the SEQARC record has names.
  const symb = w.at;
  w.str('SYMB').u32(0);
  const recs = w.at;
  w.u32(...new Array(8).fill(0)).u32(...new Array(6).fill(0));
  const empty = w.at - symb;
  w.u32(0);
  const arcRec = w.at - symb;
  w.u32(1, 0, 0);
  const sub = w.at - symb;
  w.u32(1, 0);
  const arcStr = w.at - symb;
  w.str(arcName).u8(0);
  const seqStr = w.at - symb;
  w.str(seqName).u8(0);
  w.put32(symb + arcRec + 4, arcStr);
  w.put32(symb + arcRec + 8, sub);
  w.put32(symb + sub + 4, seqStr);
  for (let r = 0; r < 8; r++) w.put32(recs + 4 * r, r === 1 ? arcRec : empty);
  // INFO: one SEQARC (file 0), one BANK (file 1, wave archive 0), one WAVEARC (file 2).
  while (w.at % 4) w.u8(0);
  const info = w.at;
  w.str('INFO').u32(0);
  const irecs = w.at;
  w.u32(...new Array(8).fill(0)).u32(...new Array(6).fill(0));
  const rec = (entry: (w: W) => void) => {
    const r = w.at - info;
    w.u32(1, w.at - info + 8);
    entry(w);
    return r;
  };
  const noRec = w.at - info;
  w.u32(0);
  const ri = [noRec, rec((w) => w.u16(0, 0)), rec((w) => w.u16(1, 0, 0, 0xffff, 0xffff, 0xffff)), rec((w) => w.u16(2, 0)), noRec, noRec, noRec, noRec];
  ri.forEach((r, i) => w.put32(irecs + 4 * i, r));
  // FAT, then the files.
  const fat = w.at;
  w.str('FAT ').u32(0, files.length);
  const ents = w.at;
  for (let i = 0; i < files.length; i++) w.u32(0, 0, 0, 0);
  files.forEach((f, i) => {
    while (w.at % 4) w.u8(0);
    w.put32(ents + 16 * i, w.at);
    w.put32(ents + 16 * i + 4, f.length);
    w.u8(...f);
  });
  w.put32(0x10, symb);
  w.put32(0x18, info);
  w.put32(0x20, fat);
  return w.bytes();
}

describe('sound driver math', () => {
  it('matches the ARM7 driver tables', () => {
    // Spot values read from the USA ROM's ARM7 binary (docs/re-notes/sound.md).
    expect([0, 1, 2, 3, 64, 127].map(decibel)).toEqual([-32768, -421, -361, -325, -60, 0]);
    expect([0, 1, 2, 3, 4, 127].map(decibelSquare)).toEqual([-32768, -722, -721, -651, -601, 0]);
    expect([127, 126, 109, 108, 0].map(attackRate)).toEqual([0, 1, 143, 147, 255]);
    expect([127, 126, 125, 49, 0].map(fallRate)).toEqual([0xffff, 0x3c00, 0x1e00, 99, 1]);
  });

  it('scales timers by 64ths of a semitone', () => {
    expect(adjustTimer(1000, 0)).toBe(1000);
    expect(adjustTimer(1000, 768)).toBe(500); // an octave up halves the period
    expect(adjustTimer(1000, -768)).toBe(2000);
    expect(adjustTimer(1000, 64)).toBe(Math.floor((1000 * (Math.round((2 ** (-64 / 768 + 1) - 1) * 65536) + 0x10000)) / 2 ** 17));
  });

  it('turns levels into gain', () => {
    expect(levelGain(723)).toBeCloseTo(127 / 128);
    expect(levelGain(723 - 60)).toBeCloseTo((127 / 128) * 0.5, 2);
    expect(levelGain(0)).toBe(0);
  });
});

describe('IMA-ADPCM', () => {
  it('decodes low nibble first from the header sample', () => {
    // Header: sample 0, index 0. Nibble 7 adds 7/8 + 7/4 + 7/2 + 7 in integer steps (0+1+3+7 = 11)
    // and moves the index up 8 (step 16); nibble 8 subtracts 16/8 = 2.
    const out = new Float32Array(2);
    decodeAdpcm(new Uint8Array([0, 0, 0, 0, 0x87]), 0, 5, out);
    expect([...out].map((v) => Math.round(v * 32768))).toEqual([11, 9]);
  });
});

describe('sound archive', () => {
  const pcm = [0, 64, 127, 64, 0, -64, -128, -64];
  const arc = soundArchive(sdat([ssar(60, 127), sbnk(), swar(pcm, 512)], 'SEQARC__TEST', 'SE_TEST_BEEP'));

  it('reads labels', () => {
    expect(arc.labels()).toEqual(['SE_TEST_BEEP']);
    expect(arc.sdat.banks[0]!.waveArcs[0]).toBe(0);
  });

  it('renders a one-note effect at the root key: one source sample per output sample, centered', () => {
    const out = arc.effect('SE_TEST_BEEP')!;
    // The note starts on the frame after it is played (the driver starts channels on its next update).
    const lead = Math.floor((64 * 2728) / 1024);
    expect(out.left.length).toBe(lead + pcm.length);
    const expected = pcm.map((s) => (s / 128) * (127 / 128) * 0.5);
    for (let i = 0; i < pcm.length; i++) {
      expect(out.left[lead + i]).toBeCloseTo(expected[i]!, 5);
      expect(out.right[lead + i]).toBeCloseTo(expected[i]!, 5);
    }
    expect(arc.effectPlayer({ arc: 0, index: 0 })).toBe(0);
  });

  it('plays a note an octave up at twice the rate', () => {
    const up = soundArchive(sdat([ssar(72, 127), sbnk(), swar(pcm, 512)], 'A', 'B')).effect('B')!;
    const lead = Math.floor((64 * 2728) / 1024);
    expect(up.left.length).toBe(lead + pcm.length / 2);
  });

  it('applies the sequence volume through the decibel-square curve', () => {
    const quiet = soundArchive(sdat([ssar(60, 32), sbnk(), swar(pcm, 512)], 'A', 'B')).effect('B')!;
    const lead = Math.floor((64 * 2728) / 1024);
    expect(quiet.left[lead + 2]! / ((127 / 128) * 0.5 * (127 / 128))).toBeCloseTo(levelGain(723 + decibelSquare(32)) / (127 / 128), 4);
  });
});

describe('streams', () => {
  it('decodes stereo PCM8 blocks and plays them through the mixer', () => {
    const w = header(new W(), 'STRM').str('HEAD').u32(0x50);
    w.u8(0, 0, 2, 0).u16(OUT_RATE >> 1, 0).u32(0, 4, 0x68, 1, 4, 4, 4, 4);
    w.b.length = 0x68;
    w.u8(1, 2, 3, 4, 0xff, 0xfe, 0xfd, 0xfc);
    const s = decodeStrm(w.bytes());
    expect(s.channels).toBe(2);
    expect([...s.pcm[0]!].map((v) => v * 128)).toEqual([1, 2, 3, 4]);
    expect([...s.pcm[1]!].map((v) => v * 128)).toEqual([-1, -2, -3, -4]);
    // Half the mixer rate: each sample is held for two output samples.
    expect([...holdResample(s.pcm[0]!, OUT_RATE / 2)].map((v) => v * 128)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});
