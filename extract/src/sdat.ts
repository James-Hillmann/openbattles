import { ascii, s16, u16, u32, u8 } from './bytes';

/**
 * Nitro SDK sound archive (`Sound/sound_data.sdat`). See docs/re-notes/sound.md.
 *
 * DS background: the DS has 16 hardware sound channels that play 8-bit/16-bit PCM or
 * IMA-ADPCM samples at a programmable rate. Nintendo's sound library drives them from
 * an "SDAT" bundle: sequences (MIDI-like scripts, SSEQ / SSAR = sequence archive), instrument
 * banks (SBNK) that point into wave archives (SWAR of SWAV samples), and streams (STRM,
 * long PCM tracks for music). The ARM7 runs the sequencer; the ARM9 game just says
 * "play sequence N of archive M".
 *
 * LEGO Battles keeps every sound effect in sequence archives (no plain sequences) and every
 * piece of music as a stream.
 */

export interface SdatSeqArc {
  name: string;
  fileId: number;
  /** Sequence names inside the archive, by index (from the SYMB block). */
  seqNames: string[];
}
export interface SdatBank {
  name: string;
  fileId: number;
  /** Wave archive numbers this bank's instruments index into (0xFFFF = unused). */
  waveArcs: number[];
}
export interface SdatStrm {
  name: string;
  fileId: number;
  volume: number;
  priority: number;
  player: number;
}
export interface Sdat {
  data: Uint8Array;
  seqArcs: SdatSeqArc[];
  banks: SdatBank[];
  waveArcs: { name: string; fileId: number }[];
  strms: SdatStrm[];
  /** Byte ranges of the archive's files, by file id. */
  files: { offset: number; size: number }[];
}

const expectMagic = (b: Uint8Array, o: number, magic: string) => {
  const m = ascii(b, o, 4);
  if (m !== magic) throw new Error(`Expected ${magic} at 0x${o.toString(16)}, got ${JSON.stringify(m)}`);
};

function cstr(b: Uint8Array, o: number): string {
  let s = '';
  while (b[o]) s += String.fromCharCode(b[o++]!);
  return s;
}

export function parseSdat(data: Uint8Array): Sdat {
  expectMagic(data, 0, 'SDAT');
  const symb = u32(data, 0x10);
  const info = u32(data, 0x18);
  const fat = u32(data, 0x20);
  expectMagic(data, info, 'INFO');
  expectMagic(data, fat, 'FAT ');

  // SYMB: per record type, a count and offsets (relative to SYMB) of NUL-terminated names.
  const names = (rec: number): string[] => {
    if (!symb) return [];
    const ro = symb + u32(data, symb + 8 + 4 * rec);
    const n = u32(data, ro);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const o = u32(data, ro + 4 + 4 * i);
      out.push(o ? cstr(data, symb + o) : '');
    }
    return out;
  };
  // The SEQARC record holds pairs: archive name, then a sub-record of sequence names.
  const seqArcNames = (): { name: string; seqs: string[] }[] => {
    if (!symb) return [];
    const ro = symb + u32(data, symb + 8 + 4);
    const n = u32(data, ro);
    const out: { name: string; seqs: string[] }[] = [];
    for (let i = 0; i < n; i++) {
      const no = u32(data, ro + 4 + 8 * i);
      const so = u32(data, ro + 8 + 8 * i);
      const seqs: string[] = [];
      if (so) {
        const sn = u32(data, symb + so);
        for (let j = 0; j < sn; j++) {
          const o = u32(data, symb + so + 4 + 4 * j);
          seqs.push(o ? cstr(data, symb + o) : '');
        }
      }
      out.push({ name: no ? cstr(data, symb + no) : '', seqs });
    }
    return out;
  };
  // INFO: per record type, a count and offsets (relative to INFO) of fixed-size entries; 0 = unused slot.
  const entries = (rec: number): (number | null)[] => {
    const ro = info + u32(data, info + 8 + 4 * rec);
    const n = u32(data, ro);
    const out: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const o = u32(data, ro + 4 + 4 * i);
      out.push(o ? info + o : null);
    }
    return out;
  };

  const arcNames = seqArcNames();
  const seqArcs = entries(1).map((e, i) => ({
    name: arcNames[i]?.name ?? '',
    fileId: e === null ? -1 : u16(data, e),
    seqNames: arcNames[i]?.seqs ?? [],
  }));
  const bankNames = names(2);
  const banks = entries(2).map((e, i) => ({
    name: bankNames[i] ?? '',
    fileId: e === null ? -1 : u16(data, e),
    waveArcs: e === null ? [] : [0, 1, 2, 3].map((k) => u16(data, e + 4 + 2 * k)),
  }));
  const waveNames = names(3);
  const waveArcs = entries(3).map((e, i) => ({ name: waveNames[i] ?? '', fileId: e === null ? -1 : u16(data, e) }));
  const strmNames = names(7);
  const strms = entries(7).map((e, i) => ({
    name: strmNames[i] ?? '',
    fileId: e === null ? -1 : u16(data, e),
    volume: e === null ? 0 : u8(data, e + 4),
    priority: e === null ? 0 : u8(data, e + 5),
    player: e === null ? 0 : u8(data, e + 6),
  }));

  const files: { offset: number; size: number }[] = [];
  const nFiles = u32(data, fat + 8);
  for (let i = 0; i < nFiles; i++) files.push({ offset: u32(data, fat + 12 + 16 * i), size: u32(data, fat + 16 + 16 * i) });
  return { data, seqArcs, banks, waveArcs, strms, files };
}

export function sdatFile(s: Sdat, fileId: number): Uint8Array {
  const f = s.files[fileId];
  if (!f) throw new Error(`SDAT has no file ${fileId}`);
  return s.data.subarray(f.offset, f.offset + f.size);
}

/** Finds a sound effect by its label (e.g. `SE_UI_CLICK1`): archive and index within it. */
export function findSeq(s: Sdat, label: string): { arc: number; index: number } | undefined {
  for (let arc = 0; arc < s.seqArcs.length; arc++) {
    const index = s.seqArcs[arc]!.seqNames.indexOf(label);
    if (index >= 0) return { arc, index };
  }
  return undefined;
}

// ---------------------------------------------------------------- sequence archives

export interface SsarSeq {
  /** Offset of the first command in `data`, or -1 for an empty slot. */
  offset: number;
  bank: number;
  volume: number;
  /** Channel priority and player priority. */
  channelPriority: number;
  playerPriority: number;
  player: number;
}
export interface Ssar {
  /** Sequence data; commands address it by offset. */
  data: Uint8Array;
  seqs: SsarSeq[];
}

/** SSAR: a DATA block with the command stream offset, then 12-byte records per sequence. */
export function parseSsar(b: Uint8Array): Ssar {
  expectMagic(b, 0, 'SSAR');
  expectMagic(b, 0x10, 'DATA');
  const dataOffset = u32(b, 0x18);
  const n = u32(b, 0x1c);
  const seqs: SsarSeq[] = [];
  for (let i = 0; i < n; i++) {
    const o = 0x20 + 12 * i;
    const off = u32(b, o);
    seqs.push({
      offset: off === 0xffffffff ? -1 : off,
      bank: u16(b, o + 4),
      volume: u8(b, o + 6),
      channelPriority: u8(b, o + 7),
      playerPriority: u8(b, o + 8),
      player: u8(b, o + 9),
    });
  }
  return { data: b.subarray(dataOffset), seqs };
}

// ---------------------------------------------------------------- instrument banks

/** One playable region: which sample, its root key and envelope (ADSR 0..127) and pan. */
export interface NoteDef {
  /** 1 PCM sample, 2 PSG square wave, 3 noise. */
  type: number;
  /** Sample number within the wave archive (PCM), or duty cycle (PSG). */
  wave: number;
  /** Index into the bank's `waveArcs`. */
  waveArc: number;
  key: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  pan: number;
}
/** Instrument: note defs with the key range each covers. */
export type Instrument = { lo: number; hi: number; def: NoteDef }[];

function noteDef(b: Uint8Array, type: number, o: number): NoteDef {
  return {
    type,
    wave: u16(b, o),
    waveArc: u16(b, o + 2),
    key: u8(b, o + 4),
    attack: u8(b, o + 5),
    decay: u8(b, o + 6),
    sustain: u8(b, o + 7),
    release: u8(b, o + 8),
    pan: u8(b, o + 9),
  };
}

/** SBNK: per program, a type byte and offset. Types 1-5 are one region, 16 a drum set, 17 a key split. */
export function parseSbnk(b: Uint8Array): (Instrument | null)[] {
  expectMagic(b, 0, 'SBNK');
  const n = u32(b, 0x38);
  const out: (Instrument | null)[] = [];
  for (let i = 0; i < n; i++) {
    const type = u8(b, 0x3c + 4 * i);
    const off = u16(b, 0x3d + 4 * i);
    if (type === 0) out.push(null);
    else if (type < 16) out.push([{ lo: 0, hi: 127, def: noteDef(b, type, off) }]);
    else if (type === 16) {
      // Drum set: one region per key from low to high.
      const lo = u8(b, off);
      const hi = u8(b, off + 1);
      const ins: Instrument = [];
      for (let k = lo; k <= hi; k++) {
        const o = off + 2 + 12 * (k - lo);
        ins.push({ lo: k, hi: k, def: noteDef(b, u16(b, o), o + 2) });
      }
      out.push(ins);
    } else if (type === 17) {
      // Key split: up to 8 ascending top keys, then that many regions.
      const ins: Instrument = [];
      for (let r = 0; r < 8; r++) {
        const top = u8(b, off + r);
        if (top === 0) break;
        const o = off + 8 + 12 * r;
        ins.push({ lo: r ? ins[r - 1]!.hi + 1 : 0, hi: top, def: noteDef(b, u16(b, o), o + 2) });
      }
      out.push(ins);
    } else throw new Error(`SBNK instrument ${i}: unknown type ${type}`);
  }
  return out;
}

export function instrumentRegion(ins: Instrument, key: number): NoteDef | undefined {
  return ins.find((r) => key >= r.lo && key <= r.hi && r.def.type !== 0)?.def;
}

// ---------------------------------------------------------------- samples

export interface Swav {
  /** 0 PCM8, 1 PCM16, 2 IMA-ADPCM. */
  format: number;
  loop: boolean;
  rate: number;
  /** Hardware timer period: the channel steps one sample every `timer` ticks of 16.756991 MHz. */
  timer: number;
  /** Loop start in samples. */
  loopStart: number;
  /** Decoded samples, -1..1. */
  pcm: Float32Array;
}

export const ADPCM_STEP = (() => {
  // IMA-ADPCM step sizes: 7, 8, 9, ... growing ~10% per index, 89 entries (standard table).
  const t = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190,
    209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
    2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500,
    20350, 22385, 24623, 27086, 29794, 32767,
  ];
  return Int32Array.from(t);
})();
const ADPCM_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8];

/**
 * DS IMA-ADPCM (GBATEK "DS Sound"): a 4-byte header (initial sample, step index), then
 * nibbles, low nibble first. Clamps to +-0x7FFF like the hardware.
 */
export function decodeAdpcm(b: Uint8Array, o: number, end: number, out: Float32Array, at = 0): number {
  let pcm = s16(b, o);
  let index = Math.min(88, u8(b, o + 2) & 0x7f);
  let n = at;
  for (let p = o + 4; p < end; p++) {
    const byte = b[p]!;
    for (const nib of [byte & 15, byte >> 4]) {
      const step = ADPCM_STEP[index]!;
      let diff = step >> 3;
      if (nib & 1) diff += step >> 2;
      if (nib & 2) diff += step >> 1;
      if (nib & 4) diff += step;
      pcm = nib & 8 ? Math.max(pcm - diff, -0x7fff) : Math.min(pcm + diff, 0x7fff);
      index = Math.min(88, Math.max(0, index + ADPCM_INDEX[nib & 7]!));
      if (n < out.length) out[n++] = pcm / 32768;
    }
  }
  return n;
}

function decodeSwav(b: Uint8Array, o: number): Swav {
  const format = u8(b, o);
  const loop = u8(b, o + 1) !== 0;
  const rate = u16(b, o + 2);
  const timer = u16(b, o + 4);
  // Loop start and length after it are in 32-bit words of sample data.
  const loopWords = u16(b, o + 6);
  const restWords = u32(b, o + 8);
  const start = o + 12;
  const bytes = 4 * (loopWords + restWords);
  let pcm: Float32Array;
  let loopStart: number;
  if (format === 0) {
    pcm = new Float32Array(bytes);
    for (let i = 0; i < bytes; i++) pcm[i] = ((b[start + i]! << 24) >> 24) / 128;
    loopStart = 4 * loopWords;
  } else if (format === 1) {
    pcm = new Float32Array(bytes / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = s16(b, start + 2 * i) / 32768;
    loopStart = 2 * loopWords;
  } else if (format === 2) {
    // The header word counts as part of the loop start, but holds no samples.
    pcm = new Float32Array(2 * (bytes - 4));
    decodeAdpcm(b, start, start + bytes, pcm);
    loopStart = Math.max(0, 8 * (loopWords - 1));
  } else throw new Error(`SWAV: unknown format ${format}`);
  return { format, loop, rate, timer, loopStart, pcm };
}

/** SWAR: a list of offsets to SWAV sample headers. Decodes lazily. */
export function parseSwar(b: Uint8Array): { count: number; get(i: number): Swav } {
  expectMagic(b, 0, 'SWAR');
  const n = u32(b, 0x38);
  const cache = new Map<number, Swav>();
  return {
    count: n,
    get(i: number) {
      let w = cache.get(i);
      if (!w) {
        if (i < 0 || i >= n) throw new Error(`SWAR has no sample ${i}`);
        w = decodeSwav(b, u32(b, 0x3c + 4 * i));
        cache.set(i, w);
      }
      return w;
    },
  };
}

// ---------------------------------------------------------------- streams (music)

export interface StrmInfo {
  /** 0 PCM8, 1 PCM16, 2 IMA-ADPCM. */
  format: number;
  loop: boolean;
  channels: number;
  /** Samples per second, as stored. */
  rate: number;
  loopStart: number;
  samples: number;
}

export function strmInfo(b: Uint8Array): StrmInfo {
  expectMagic(b, 0, 'STRM');
  expectMagic(b, 0x10, 'HEAD');
  return {
    format: u8(b, 0x18),
    loop: u8(b, 0x19) !== 0,
    channels: u8(b, 0x1a),
    rate: u16(b, 0x1c),
    loopStart: u32(b, 0x20),
    samples: u32(b, 0x24),
  };
}

/**
 * Decodes a STRM to one Float32Array per channel. Sample data is split into blocks; each
 * block holds every channel's slice back to back (ADPCM slices start with their own header).
 */
export function decodeStrm(b: Uint8Array): StrmInfo & { pcm: Float32Array[] } {
  const info = strmInfo(b);
  const dataOffset = u32(b, 0x28);
  const nBlocks = u32(b, 0x2c);
  const blockLen = u32(b, 0x30);
  const blockSamples = u32(b, 0x34);
  const lastLen = u32(b, 0x38);
  const lastSamples = u32(b, 0x3c);
  const pcm = Array.from({ length: info.channels }, () => new Float32Array(info.samples));
  let o = dataOffset;
  for (let blk = 0; blk < nBlocks; blk++) {
    const last = blk === nBlocks - 1;
    const len = last ? lastLen : blockLen;
    const ns = last ? lastSamples : blockSamples;
    const at = blk * blockSamples;
    for (let c = 0; c < info.channels; c++) {
      const out = pcm[c]!;
      const n = Math.min(ns, info.samples - at);
      if (info.format === 0) for (let i = 0; i < n; i++) out[at + i] = ((b[o + i]! << 24) >> 24) / 128;
      else if (info.format === 1) for (let i = 0; i < n; i++) out[at + i] = s16(b, o + 2 * i) / 32768;
      else if (info.format === 2) decodeAdpcm(b, o, o + len, out.subarray(0, at + n), at);
      else throw new Error(`STRM: unknown format ${info.format}`);
      // Slices are padded to 4 bytes.
      o += last ? (len + 3) & ~3 : len;
    }
  }
  return { ...info, pcm };
}
