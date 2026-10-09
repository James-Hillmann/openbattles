import { ascii, s16, s32, u16, u32 } from './bytes';
import { identity, pivotRotation, readDict, sections3d, type Mat4 } from './nsbmd';

/**
 * Nitro joint animations (BCA0 / JNT0): per-object translation, rotation and scale
 * tracks, sampled per frame. Layout follows the documented Nitro format
 * (docs/re-notes/formats.md "3D models").
 */

const fx = (v: number) => v / 4096;

/** One component track: a constant, or values sampled every `step` frames. */
interface Track {
  values: number[];
  step: number;
  /** From this frame on, values are stored for every frame. */
  lastInterp: number;
}

interface RotTrack {
  values: number[][]; // 3x3 column-major per sample
  step: number;
  lastInterp: number;
}

export interface JointAnim {
  name: string;
  frames: number;
  /** Per object: null = use the model's bind pose for that part. */
  objects: {
    trans: (Track | null)[] | null;
    rot: RotTrack | null;
    scale: (Track | null)[] | null;
    identity: boolean;
  }[];
}

const STEP = [1, 2, 4];

function info(word: number): { start: number; lastInterp: number; fx16: boolean; step: number } {
  return { start: word & 0xffff, lastInterp: (word >>> 16) & 0x1fff, fx16: !!(word & 0x20000000), step: STEP[(word >>> 30) & 3] ?? 1 };
}

/** Samples stored for a track over `frames` frames. */
function sampleCount(frames: number, step: number, lastInterp: number): number {
  if (step === 1) return frames;
  return Math.ceil(lastInterp / step) + 1 + Math.max(0, frames - 1 - lastInterp);
}

/**
 * Basis-compressed 3x3, in the same cell order as model rotations: cells 0-4 are the
 * top 13 bits of five s16, cell 5 is a 13-bit value spread over their low 3 bits
 * (word 4's first, then words 0-3), cells 6-8 are the cross product of the first two triples.
 * Checked: all 4389 entries the unit animations use come out orthonormal.
 */
export function basisRotation(d: Uint8Array, o: number): number[] {
  const w = [0, 1, 2, 3, 4].map((i) => s16(d, o + i * 2));
  const a = w.map((v) => fx(v >> 3));
  const low = ((w[4]! & 7) << 12) | ((w[0]! & 7) << 9) | ((w[1]! & 7) << 6) | ((w[2]! & 7) << 3) | (w[3]! & 7);
  const a5 = fx((low << 19) >> 19); // sign-extended from 13 bits
  const r0 = [a[0]!, a[1]!, a[2]!];
  const r1 = [a[3]!, a[4]!, a5];
  const r2 = [r0[1]! * r1[2]! - r0[2]! * r1[1]!, r0[2]! * r1[0]! - r0[0]! * r1[2]!, r0[0]! * r1[1]! - r0[1]! * r1[0]!];
  return [...r0, ...r1, ...r2];
}

export function parseNsbca(d: Uint8Array): JointAnim[] {
  if (ascii(d, 0, 4) !== 'BCA0') throw new Error('Not a BCA0 animation');
  const jnt = sections3d(d).get('JNT0');
  if (!jnt) throw new Error('No JNT0');
  return readDict(d, jnt.offset + 8).map((e) => {
    const a = jnt.offset + u32(d, e.data);
    const frames = u16(d, a + 4);
    const count = u16(d, a + 6);
    const pivots = a + u32(d, a + 12);
    const bases = a + u32(d, a + 16);
    const rotAt = (idx: number) => (idx & 0x8000 ? pivotRotation(u16(d, pivots + (idx & 0x7fff) * 6) << 4, fx(s16(d, pivots + (idx & 0x7fff) * 6 + 2)), fx(s16(d, pivots + (idx & 0x7fff) * 6 + 4))) : basisRotation(d, bases + (idx & 0x7fff) * 10));
    const objects = Array.from({ length: count }, (_, i) => {
      let p = a + u16(d, a + 0x14 + i * 2);
      const flags = u16(d, p);
      p += 4;
      const obj: JointAnim['objects'][number] = { trans: null, rot: null, scale: null, identity: !!(flags & 1) };
      if (flags & 1) return obj;
      if (!(flags & 6)) {
        obj.trans = [8, 16, 32].map((bit) => {
          if (flags & bit) {
            const v = fx(s32(d, p));
            p += 4;
            return { values: [v], step: 1, lastInterp: 0 };
          }
          const t = info(u32(d, p));
          const o = a + u32(d, p + 4);
          p += 8;
          const n = sampleCount(frames, t.step, t.lastInterp);
          return { values: Array.from({ length: n }, (_, k) => fx(t.fx16 ? s16(d, o + k * 2) : s32(d, o + k * 4))), step: t.step, lastInterp: t.lastInterp };
        });
      } else if (flags & 2) obj.trans = [null, null, null].map(() => ({ values: [0], step: 1, lastInterp: 0 }));
      if (!(flags & 0xc0)) {
        if (flags & 0x100) {
          obj.rot = { values: [rotAt(u16(d, p))], step: 1, lastInterp: 0 };
          p += 4;
        } else {
          const t = info(u32(d, p));
          const o = a + u32(d, p + 4);
          p += 8;
          const n = sampleCount(frames, t.step, t.lastInterp);
          obj.rot = { values: Array.from({ length: n }, (_, k) => rotAt(u16(d, o + k * 2))), step: t.step, lastInterp: t.lastInterp };
        }
      } else if (flags & 0x40) obj.rot = { values: [[1, 0, 0, 0, 1, 0, 0, 0, 1]], step: 1, lastInterp: 0 };
      if (!(flags & 0x600)) {
        obj.scale = [0x800, 0x1000, 0x2000].map((bit) => {
          if (flags & bit) {
            const v = fx(s32(d, p));
            p += 8; // scale, then its inverse
            return { values: [v], step: 1, lastInterp: 0 };
          }
          const t = info(u32(d, p));
          const o = a + u32(d, p + 4);
          p += 8;
          const n = sampleCount(frames, t.step, t.lastInterp);
          return { values: Array.from({ length: n }, (_, k) => fx(t.fx16 ? s16(d, o + k * 4) : s32(d, o + k * 8))), step: t.step, lastInterp: t.lastInterp };
        });
      } else if (flags & 0x200) obj.scale = [1, 1, 1].map((v) => ({ values: [v], step: 1, lastInterp: 0 }));
      return obj;
    });
    return { name: e.name, frames, objects };
  });
}

function sampleIndex(t: { step: number; lastInterp: number; values: unknown[] }, frame: number): number {
  if (t.values.length === 1) return 0;
  if (t.step === 1 || frame >= t.lastInterp) {
    const base = t.step === 1 ? 0 : Math.ceil(t.lastInterp / t.step) + 1 - (t.lastInterp + 1);
    return Math.min(t.values.length - 1, frame + (t.step === 1 ? 0 : base));
  }
  return Math.min(t.values.length - 1, Math.round(frame / t.step));
}

/** The object's matrix at `frame` (nearest sample), falling back to `bind` for parts the clip leaves alone. */
export function animMatrix(anim: JointAnim, obj: number, frame: number, bind: { scale: number[]; rot: number[]; trans: number[] }): Mat4 {
  const o = anim.objects[obj];
  if (o?.identity) return identity();
  const trans = o?.trans ? o.trans.map((t) => t!.values[sampleIndex(t!, frame)]!) : bind.trans;
  const rot = o?.rot ? o.rot.values[sampleIndex(o.rot, frame)]! : bind.rot;
  const scale = o?.scale ? o.scale.map((t) => t!.values[sampleIndex(t!, frame)]!) : bind.scale;
  const m = identity();
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[c * 4 + row] = rot[c * 3 + row]! * scale[c]!;
  m[12] = trans[0]!; m[13] = trans[1]!; m[14] = trans[2]!;
  return m;
}
