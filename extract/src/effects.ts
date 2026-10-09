import { romFile, tryRomFile } from './bundle';
import { decodeChars, decodePalette } from './nitro';
import { renderSheet } from './render';
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
  /** `Particles/LegoStudDestroy.hps`: a building's studs bursting when it dies (docs/re-notes/death.md). */
  studDestroy?: ParticleAnim;
  /** `Particles/LegoSmallStudDestroy.hps`: the same for a unit. */
  smallStudDestroy?: ParticleAnim;
  /** The Blue Stud's spinning gold brick, 16x16 frames (docs/re-notes/pickups.md "Look"). */
  blueStud?: Rgba[];
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
  const destroyFile = tryRomFile(rom, 'Particles/LegoStudDestroy.hps');
  const smallFile = tryRomFile(rom, 'Particles/LegoSmallStudDestroy.hps');
  const studDestroy = destroyFile ? decodeHps(destroyFile) : undefined;
  const smallStudDestroy = smallFile ? decodeHps(smallFile) : undefined;
  // A 256x256 4bpp bitmap stored linearly (not as tiles), drawn with palette bank 0.
  const sheet = decodeChars(romFile(rom, 'UI/AllInOne/CastleEffects.NCBR'));
  const pal = decodePalette(romFile(rom, 'UI/AllInOne/CastleEffects.NCLR'));
  const stride = sheet.tilesWide * 8;
  const sprites: Record<string, Rgba> = {};
  for (const p of [...dust, ...studs, ...(studDestroy ?? []), ...(smallStudDestroy ?? [])].flat()) {
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
  const blueStud = buildBlueStud(rom);
  return { dust, studs, sprites, ...(blueStud ? { blueStud } : {}), ...(studDestroy ? { studDestroy } : {}), ...(smallStudDestroy ? { smallStudDestroy } : {}) };
}

/**
 * `Sprites/CastleItems.NCBR` is a 64x128 linear 4bpp sheet of 16x16 item pictures drawn with
 * `Sprites/KingFaction.NCLR` bank 0. The Blue Stud on the map spins through the five gold-brick
 * pictures (row 1 col 3, row 2 cols 0-3), each held 3 VBlanks: the pictures and the period are
 * confirmed against the emulator, the order within the spin is likely.
 */
export const BLUE_STUD_CELLS = [7, 8, 9, 10, 11];
export const BLUE_STUD_VBLANKS = 3;

function buildBlueStud(rom: UnpackedRom): Rgba[] | undefined {
  const items = tryRomFile(rom, 'Sprites/CastleItems.NCBR');
  const palFile = tryRomFile(rom, 'Sprites/KingFaction.NCLR');
  if (!items || !palFile) return undefined;
  const sheet = renderSheet(decodeChars(items), decodePalette(palFile), 0);
  return BLUE_STUD_CELLS.map((c) => {
    const img: Rgba = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
    const x0 = (c % 4) * 16;
    const y0 = Math.floor(c / 4) * 16;
    for (let y = 0; y < 16; y++) img.data.set(sheet.data.subarray(((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + 16) * 4), y * 64);
    return img;
  });
}
