import { romFile } from './bundle';
import type { UnpackedRom } from './rom';
import { decodeStrm, findSeq, parseSbnk, parseSdat, parseSsar, parseSwar, sdatFile, type Instrument, type Sdat, type Ssar } from './sdat';
import { holdResample, renderSeq } from './sseq';

export const SDAT_PATH = 'Sound/sound_data.sdat';

/** Stereo PCM at the DS mixer rate (`OUT_RATE`). */
export interface Pcm {
  left: Float32Array;
  right: Float32Array;
}

export interface SoundArchive {
  sdat: Sdat;
  /** Every effect label (SE_...) and music label (STRM_...). */
  labels(): string[];
  /** Renders effect `index` of sequence archive `arc` (or by label); undefined for empty slots. */
  effect(label: string | { arc: number; index: number }, extraLevel?: number): Pcm | undefined;
  /** Sound player an effect plays on (0 PLAYER_EFFECTS, 1 PLAYER_INTERFACE), from its SSAR record. */
  effectPlayer(at: { arc: number; index: number }): number;
  /** Decodes a music stream (by label or number), as the mixer plays it. */
  music(label: string | number): Pcm | undefined;
}

/** Sound access on top of the SDAT; banks, wave archives and archives are parsed on first use. */
export function soundArchive(data: Uint8Array): SoundArchive {
  const sdat = parseSdat(data);
  const ssars = new Map<number, Ssar>();
  const banks = new Map<number, (Instrument | null)[]>();
  const swars = new Map<number, ReturnType<typeof parseSwar>>();
  const ssar = (arc: number) => {
    let s = ssars.get(arc);
    if (!s) ssars.set(arc, (s = parseSsar(sdatFile(sdat, sdat.seqArcs[arc]!.fileId))));
    return s;
  };
  const bank = (n: number) => {
    let b = banks.get(n);
    if (!b) banks.set(n, (b = parseSbnk(sdatFile(sdat, sdat.banks[n]!.fileId))));
    return b;
  };
  const swar = (n: number) => {
    let w = swars.get(n);
    if (!w) swars.set(n, (w = parseSwar(sdatFile(sdat, sdat.waveArcs[n]!.fileId))));
    return w;
  };
  return {
    sdat,
    labels: () => [...sdat.seqArcs.flatMap((a) => a.seqNames.filter(Boolean)), ...sdat.strms.map((s) => s.name)],
    effect(label, extraLevel) {
      const at = typeof label === 'string' ? findSeq(sdat, label) : label;
      if (!at || !sdat.seqArcs[at.arc] || sdat.seqArcs[at.arc]!.fileId < 0) return undefined;
      const a = ssar(at.arc);
      const seq = a.seqs[at.index];
      if (!seq || seq.offset < 0) return undefined;
      const info = sdat.banks[seq.bank]!;
      return renderSeq(
        {
          data: a.data,
          offset: seq.offset,
          volume: seq.volume,
          instruments: bank(seq.bank),
          sample: (slot, wave) => swar(info.waveArcs[slot]!).get(wave),
        },
        { extraLevel },
      );
    },
    effectPlayer: (at) => ssar(at.arc).seqs[at.index]?.player ?? 0,
    music(label) {
      const n = typeof label === 'number' ? label : sdat.strms.findIndex((s) => s.name === label);
      const s = sdat.strms[n];
      if (!s || s.fileId < 0) return undefined;
      const st = decodeStrm(sdatFile(sdat, s.fileId));
      // Stereo streams play left on a channel panned hard left, right hard right (guess: NNS default).
      const l = holdResample(st.pcm[0]!, st.rate);
      const r = st.channels > 1 ? holdResample(st.pcm[1]!, st.rate) : l;
      return { left: l, right: r };
    },
  };
}

export const loadSoundArchive = (rom: UnpackedRom): SoundArchive => soundArchive(romFile(rom, SDAT_PATH));
