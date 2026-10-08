import { parseNsbmd, poseModel, recolorMaterials, type Model } from './nsbmd';
import { rasterize, type View } from './raster';
import type { EntityInfo, UnitSprite } from './units';

/**
 * Pre-render the 3D unit models (siege, flyers, ships) into the same atlas shape
 * as sprite units: one row per facing, here one frame per row.
 *
 * Camera, fitted against a King ballista in the emulator (docs/re-notes/formats.md "3D models"):
 * orthographic, looking down 45 degrees, the model turned to face its direction of travel
 * measured in map cells. The ballista draws at 12 px per model unit.
 */
export const MODEL_PITCH = Math.PI / 4;
/** Facing steps pre-rendered per model. The game turns models smoothly; 16 is our approximation. */
export const MODEL_ROWS = 16;
/** Ballista calibration: px per unit of the header bounding box (12 px per mesh unit / 11.08 box units per mesh unit). */
const PX_PER_BOX_UNIT = 1.082;

/** Mesh-to-pixel scale. Only the ballista is measured; other models are sized by their header box (guess). */
export function modelScale(model: Model): number {
  const tris = poseModel(model);
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const t of tris) for (const v of t.v) {
    lo = Math.min(lo, v.pos[0]); hi = Math.max(hi, v.pos[0]);
    lo2 = Math.min(lo2, v.pos[2]); hi2 = Math.max(hi2, v.pos[2]);
  }
  const mesh = Math.max(hi - lo, hi2 - lo2);
  const box = Math.max(model.box.size[0], model.box.size[2]);
  return mesh > 0 ? (PX_PER_BOX_UNIT * box) / mesh : 1;
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

export function buildModelSprites(
  entities: readonly EntityInfo[],
  file: (path: string) => Uint8Array | undefined,
  palette: Uint8Array,
  banks: readonly number[],
): UnitSprite[] {
  const out: UnitSprite[] = [];
  for (const e of entities) {
    const data = file(`${e.asset}.nsbmd`);
    if (!data || e.speed === 0xffff) continue;
    let model: Model;
    try {
      model = parseNsbmd(data);
    } catch {
      continue; // unknown commands: leave this unit undrawn rather than fail the whole load
    }
    const tris = poseModel(model);
    const scale = modelScale(model);
    const yaw = (r: number) => (r * 2 * Math.PI) / MODEL_ROWS;
    // One frame size and anchor for every facing: the projected bounds over all turns.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const cp = Math.cos(MODEL_PITCH), sp = Math.sin(MODEL_PITCH);
    for (let r = 0; r < MODEL_ROWS; r++) {
      const cy = Math.cos(yaw(r)), sy = Math.sin(yaw(r));
      for (const t of tris) for (const v of t.v) {
        const x = (v.pos[0] * cy + v.pos[2] * sy) * scale;
        const z = -v.pos[0] * sy + v.pos[2] * cy;
        const y = (-v.pos[1] * cp + z * sp) * scale;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    const frameW = Math.ceil(x1 - x0) + 2;
    const frameH = Math.ceil(y1 - y0) + 2;
    const anchorX = Math.round(1 - x0);
    const anchorY = Math.round(1 - y0);
    for (const bank of banks) {
      const materials = recolorMaterials(model, bankColors(palette, bank));
      const atlas = { width: frameW, height: frameH * MODEL_ROWS, data: new Uint8ClampedArray(frameW * frameH * MODEL_ROWS * 4) };
      for (let r = 0; r < MODEL_ROWS; r++) {
        const view: View = { yaw: yaw(r), pitch: MODEL_PITCH, scale, width: frameW, height: frameH, originX: anchorX, originY: anchorY };
        atlas.data.set(rasterize(tris, materials, view).data, r * frameW * frameH * 4);
      }
      out.push({
        key: `${e.name}@${bank}`,
        name: e.name,
        speed: e.speed,
        layout: 'model',
        frameW,
        frameH,
        rows: MODEL_ROWS,
        mirrored: false,
        anchorX,
        anchorY,
        atlas,
        idle: 0,
        walk: [0],
        attack: [0],
      });
    }
  }
  return out;
}
