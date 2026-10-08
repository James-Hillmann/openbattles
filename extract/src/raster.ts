import type { Material, Triangle } from './nsbmd';
import type { Rgba } from './render';

/**
 * Tiny software rasterizer for pre-rendering 3D unit models into sprite frames.
 * Orthographic camera: the model is turned by `yaw` about its vertical (Y) axis,
 * then tilted by `pitch` about X so the camera looks down at the ground.
 * Texels are sampled nearest-neighbour like the DS, and modulated by vertex color.
 */
export interface View {
  yaw: number;
  pitch: number;
  /** Pixels per model unit. */
  scale: number;
  width: number;
  height: number;
  /** Where the model origin lands in the image. */
  originX: number;
  originY: number;
}

export function rasterize(tris: readonly Triangle[], materials: readonly Material[], view: View): Rgba {
  const { width, height } = view;
  const data = new Uint8ClampedArray(width * height * 4);
  const depth = new Float64Array(width * height).fill(-Infinity);
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const project = (p: readonly number[]) => {
    // Yaw about Y.
    const x = p[0]! * cy + p[2]! * sy;
    const z = -p[0]! * sy + p[2]! * cy;
    const y = p[1]!;
    // Pitch about X: screen-down = -y*cos + z*sin, depth toward camera = y*sin + z*cos.
    const sx = view.originX + x * view.scale;
    const syy = view.originY + (-y * cp + z * sp) * view.scale;
    const d = y * sp + z * cp;
    return [sx, syy, d] as const;
  };
  for (const t of tris) {
    const mat = materials[t.material];
    const tex = mat?.texture ?? null;
    const [a, b, c] = t.v.map((v) => project(v.pos));
    const area = (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
    if (area === 0) continue;
    const minX = Math.max(0, Math.floor(Math.min(a![0], b![0], c![0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a![0], b![0], c![0])));
    const minY = Math.max(0, Math.floor(Math.min(a![1], b![1], c![1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a![1], b![1], c![1])));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const x = px + 0.5, y = py + 0.5;
        const w0 = ((b![0] - x) * (c![1] - y) - (b![1] - y) * (c![0] - x)) / area;
        const w1 = ((c![0] - x) * (a![1] - y) - (c![1] - y) * (a![0] - x)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a![2] + w1 * b![2] + w2 * c![2];
        const i = py * width + px;
        if (z <= depth[i]!) continue;
        const [va, vb, vc] = t.v;
        const lerp = (f: (v: typeof va) => number) => w0 * f(va) + w1 * f(vb) + w2 * f(vc);
        let r = lerp((v) => v.color[0]) / 31, g = lerp((v) => v.color[1]) / 31, bl = lerp((v) => v.color[2]) / 31;
        let alpha = 255;
        if (tex) {
          const u = sample(lerp((v) => v.uv[0]), tex.width, mat!.wrap, 16, 18);
          const v = sample(lerp((v) => v.uv[1]), tex.height, mat!.wrap, 17, 19);
          const o = (v * tex.width + u) * 4;
          alpha = tex.data[o + 3]!;
          if (alpha < 128) continue;
          r *= tex.data[o]! / 255;
          g *= tex.data[o + 1]! / 255;
          bl *= tex.data[o + 2]! / 255;
        }
        depth[i] = z;
        data[i * 4] = r * 255;
        data[i * 4 + 1] = g * 255;
        data[i * 4 + 2] = bl * 255;
        data[i * 4 + 3] = alpha;
      }
    }
  }
  return { width, height, data };
}

/** Texel index with the DS repeat/flip rules (clamp when repeat is off). */
function sample(c: number, size: number, wrap: number, repeatBit: number, flipBit: number): number {
  let i = Math.floor(c);
  if (!((wrap >> repeatBit) & 1)) return Math.min(size - 1, Math.max(0, i));
  if ((wrap >> flipBit) & 1) {
    const p = ((i % (2 * size)) + 2 * size) % (2 * size);
    return p < size ? p : 2 * size - 1 - p;
  }
  i = ((i % size) + size) % size;
  return i;
}
