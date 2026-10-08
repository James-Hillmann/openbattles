import { parseNsbca, animMatrix, type JointAnim } from './nsbca';
import { parseNsbmd, poseModel, recolorMaterials, type Material, type Model, type Triangle } from './nsbmd';
import { rasterize } from './raster';
import type { Clip, ModelClips } from './modelClips';
import type { EntityInfo } from './units';
import type { Rgba } from './render';

/**
 * Units drawn from 3D models (siege, flyers, ships, the Giant). They have too many
 * poses to pre-render (up to ~80 animation frames x every facing), so the extractor
 * only parses them and works out a fixed frame box; `renderModelFrame` draws one
 * pose on demand and the client caches what it has drawn.
 *
 * Camera, fitted against the King ballista, catapult and dragon in the emulator
 * (docs/re-notes/formats.md "3D models"): orthographic, looking down 45 degrees,
 * 1 px per world unit, the model turned to face its direction of travel in map cells.
 */
export const MODEL_PITCH = Math.PI / 4;
/** Pixels per world unit, after the animation's per-model scale. */
export const PX_PER_UNIT = 1;
/** Facing steps. The game turns models smoothly; 32 steps is our approximation. */
export const MODEL_ROWS = 32;
/**
 * Where the model origin sits relative to the unit position, in px (down positive). In the
 * emulator the origin is drawn 15 px below a 24 px sprite's frame top for a unit at the same
 * position; our sprites put the position 19 px below their frame top, so models go 4 px up
 * to keep the two lined up.
 */
export const MODEL_ORIGIN_DY = -4;
/** Joint animations advance one frame per 2 VBlanks (seen in the emulator's animation controller). */
export const MODEL_FRAME_MS = (2 * 1000) / 60;

export interface ModelUnit {
  key: string;
  name: string;
  speed: number;
  /** Team palette bank its colors come from. */
  bank: number;
  /** Facing steps: row r faces yaw r / rows of a full turn, row 0 toward the camera (down), counter-clockwise on screen. */
  rows: number;
  /** One box for every pose and facing, so the unit doesn't jitter. */
  frameW: number;
  frameH: number;
  /** Pixel in the frame that sits on the unit's position. */
  anchorX: number;
  anchorY: number;
  /** Pixel in the frame where the model origin is drawn. */
  originX: number;
  originY: number;
  clips: ModelClips;
  model: Model;
  /** The model's materials with this bank's team colors. */
  materials: Material[];
  anim: JointAnim | null;
}

/** Place the model's triangles in one frame of its joint animation (bind pose without one). */
export function posedTriangles(model: Model, anim: JointAnim | null | undefined, frame: number): Triangle[] {
  if (!anim) return poseModel(model);
  return poseModel(model, (i) => animMatrix(anim, i, frame, model.objects[i]!.srt));
}

/** Team colors for palette slots 0-15, as BGR555, from the unit palette file. */
export function bankColors(nclrPalette: Uint8Array, bank: number): number[] {
  // nclrPalette is RGBA from decodePalette; back to BGR555.
  return Array.from({ length: 16 }, (_, i) => {
    const o = (bank * 16 + i) * 4;
    const c = (v: number) => Math.round((nclrPalette[o + v]! * 31) / 255);
    return c(0) | (c(1) << 5) | (c(2) << 10);
  });
}

/** Animation frames a clip shows: [start, end), or just `start` when start == end (a held pose). */
export function clipFrames([start, end]: readonly [number, number]): number[] {
  if (end <= start) return [start];
  return Array.from({ length: end - start }, (_, i) => start + i);
}

/**
 * Animation frame of a clip `elapsed` ms after it started. Clips loop over [start, end);
 * start == end holds one pose (e.g. the King ballista's idle).
 */
export function clipFrame([start, end]: Clip, elapsed: number): number {
  if (end <= start) return start;
  return start + (Math.floor(elapsed / MODEL_FRAME_MS) % (end - start));
}

/**
 * Frame box over every pose the clips use and every facing. Turning about the vertical axis
 * keeps a vertex within its distance from that axis, so the box is exact horizontally and
 * close vertically without rendering each facing.
 */
function frameBox(model: Model, anim: JointAnim | null, clips: ModelClips) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const cp = Math.cos(MODEL_PITCH), sp = Math.sin(MODEL_PITCH);
  const frames = new Set([...clipFrames(clips.idle), ...clipFrames(clips.move), ...clipFrames(clips.attack)]);
  for (const f of frames) {
    for (const t of posedTriangles(model, anim, f)) for (const v of t.v) {
      const rho = Math.hypot(v.pos[0], v.pos[2]) * PX_PER_UNIT;
      const y = -v.pos[1] * cp * PX_PER_UNIT;
      x0 = Math.min(x0, -rho); x1 = Math.max(x1, rho);
      y0 = Math.min(y0, y - rho * sp); y1 = Math.max(y1, y + rho * sp);
    }
  }
  const originX = Math.ceil(-x0) + 2, originY = Math.ceil(-y0) + 2;
  return { frameW: Math.ceil(x1 - x0) + 4, frameH: Math.ceil(y1 - y0) + 4, originX, originY, anchorX: originX, anchorY: originY - MODEL_ORIGIN_DY };
}

/** A clip set for models the ROM's table doesn't cover: hold the first frame. */
const STILL: ModelClips = { idle: [0, 0], move: [0, 0], attack: [0, 0] };

export function buildModelUnits(
  entities: readonly EntityInfo[],
  file: (path: string) => Uint8Array | undefined,
  palette: Uint8Array,
  banks: readonly number[],
  clipsFor: (e: EntityInfo) => ModelClips | null,
): ModelUnit[] {
  const out: ModelUnit[] = [];
  for (const e of entities) {
    const data = file(`${e.asset}.nsbmd`);
    if (!data || e.speed === 0xffff) continue;
    let model: Model;
    let anim: JointAnim | null = null;
    try {
      model = parseNsbmd(data);
      const a = file(`${e.asset}.nsbca`);
      anim = a ? parseNsbca(a)[0] ?? null : null;
    } catch {
      continue; // unknown commands: leave this unit undrawn rather than fail the whole load
    }
    const clips = anim ? clipsFor(e) ?? STILL : STILL;
    const box = frameBox(model, anim, clips);
    for (const bank of banks) {
      out.push({
        key: `${e.name}@${bank}`,
        name: e.name,
        speed: e.speed,
        bank,
        rows: MODEL_ROWS,
        ...box,
        clips,
        model,
        materials: recolorMaterials(model, bankColors(palette, bank)),
        anim,
      });
    }
  }
  return out;
}

/** Facing row for a movement vector in pixels: models face their direction of travel measured in 24x16 px map cells. */
export function modelRow(dx: number, dy: number, rows: number): number {
  const yaw = Math.atan2(dx / 24, dy / 16); // render-side only
  return ((Math.round((yaw / (2 * Math.PI)) * rows) % rows) + rows) % rows;
}

/**
 * Draw one pose. `outline` adds the 1 px selection outline the game draws around a selected
 * model (RGB), on the pixels just outside its silhouette.
 */
export function renderModelFrame(u: ModelUnit, row: number, frame: number, outline?: readonly [number, number, number]): Rgba {
  const img = rasterize(posedTriangles(u.model, u.anim, frame), u.materials, {
    yaw: (row * 2 * Math.PI) / u.rows,
    pitch: MODEL_PITCH,
    scale: PX_PER_UNIT,
    width: u.frameW,
    height: u.frameH,
    originX: u.originX,
    originY: u.originY,
  });
  if (outline) {
    const { width: w, height: h, data } = img;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 0;
    const edge: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push(y * w + x);
    }
    for (const i of edge) data.set([outline[0], outline[1], outline[2], 255], i * 4);
  }
  return img;
}
