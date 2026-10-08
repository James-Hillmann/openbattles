import { romFile, tryRomFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import type { Rgba } from './render';
import type { UnpackedRom } from './rom';

/**
 * Pre-baked particle effects (`Particles/*.hps`) and the sprites they draw. The game plays the
 * dust cloud and flying LEGO studs over a building site with these. See docs/re-notes/build-ui.md
 * "Construction effect".
 */

/** One particle in one frame of an `.hps` animation. */
export interface Particle {
  /** Pixels from the effect's anchor; +y is down the screen. */
  x: number;
  y: number;
  /** Side of the square in pixels. */
  size: number;
  /** Angle, 65536 = a full turn. */
  rot: number;
  /** DS colour and alpha, 0..31 (a = 0: not drawn). */
  r: number;
  g: number;
  b: number;
  a: number;
  /** Sprite hash, a key of `ParticleFx.sprites` (hex). */
  sprite: string;
}

/** Frames of one `.hps` file; the game shows one frame per game tick, once. */
export type ParticleAnim = Particle[][];

export interface ParticleFx {
  /** `Particles/DustConstruction.hps` (50 frames). */
  dust: ParticleAnim;
  /** `Particles/LegoStudConstruction.hps` (50 frames). */
  studs: ParticleAnim;
  /** Sprite pictures by hash (hex), cut from `UI/AllInOne/CastleEffects` with palette bank 0. */
  sprites: Record<string, Rgba>;
}

/**
 * `.hps`: u32 frame count, u32 (unknown), then per frame u32 n and n 16-byte particles
 * (s16 x, s16 y, u16 size, u16 rot, u8 r, g, b, a, u32 sprite hash). confirmed: every file parses exactly.
 */
export function decodeHps(d: Uint8Array): ParticleAnim {
  const v = new DataView(d.buffer, d.byteOffset, d.length);
  const count = v.getUint32(0, true);
  let o = 8;
  const frames: ParticleAnim = [];
  for (let f = 0; f < count; f++) {
    const n = v.getUint32(o, true);
    o += 4;
    const ps: Particle[] = [];
    for (let i = 0; i < n; i++, o += 16) {
      ps.push({
        x: v.getInt16(o, true),
        y: v.getInt16(o + 2, true),
        size: v.getUint16(o + 4, true),
        rot: v.getUint16(o + 6, true),
        r: d[o + 8]!,
        g: d[o + 9]!,
        b: d[o + 10]!,
        a: d[o + 11]!,
        sprite: v.getUint32(o + 12, true).toString(16),
      });
    }
    frames.push(ps);
  }
  if (o !== d.length) throw new Error(`hps: ${d.length - o} trailing bytes`);
  return frames;
}

/** `UI/Game/UIMgrData.bin`: 28-byte records starting u32 hash, u16 x, y, w, h (pixels in an effects sheet). */
export function spriteRect(ui: Uint8Array, hash: number): { x: number; y: number; w: number; h: number } | undefined {
  const v = new DataView(ui.buffer, ui.byteOffset, ui.length);
  for (let o = 0; o + 28 <= ui.length; o += 4) {
    if (v.getUint32(o, true) === hash >>> 0) return { x: v.getUint16(o + 4, true), y: v.getUint16(o + 6, true), w: v.getUint16(o + 8, true), h: v.getUint16(o + 10, true) };
  }
  return undefined;
}

/**
 * The construction effect. The three factions' effect sheets (Castle, Mars, Pirate) hold the same
 * dust and stud pictures at the same spots (compared by eye), so one copy serves all.
 */
export function buildParticleFx(rom: UnpackedRom): ParticleFx | undefined {
  const dustFile = tryRomFile(rom, 'Particles/DustConstruction.hps');
  const studFile = tryRomFile(rom, 'Particles/LegoStudConstruction.hps');
  const ui = tryRomFile(rom, 'UI/Game/UIMgrData.bin');
  if (!dustFile || !studFile || !ui) return undefined;
  const dust = decodeHps(dustFile);
  const studs = decodeHps(studFile);
  // A 256x256 4bpp bitmap stored linearly (not as tiles), drawn with palette bank 0.
  const sheet = decodeChars(romFile(rom, 'UI/AllInOne/CastleEffects.NCBR'));
  const pal = decodePalette(romFile(rom, 'UI/AllInOne/CastleEffects.NCLR'));
  const stride = sheet.tilesWide * 8;
  const sprites: Record<string, Rgba> = {};
  for (const p of [...dust.flat(), ...studs.flat()]) {
    if (sprites[p.sprite]) continue;
    const r = spriteRect(ui, parseInt(p.sprite, 16));
    if (!r) continue;
    const img: Rgba = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) };
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = sheet.pixels[(r.y + y) * stride + r.x + x]!;
        if (i === 0) continue;
        img.data.set(pal.subarray(i * 4, i * 4 + 3), (y * r.w + x) * 4);
        img.data[(y * r.w + x) * 4 + 3] = 255;
      }
    }
    sprites[p.sprite] = img;
  }
  return { dust, studs, sprites };
}
