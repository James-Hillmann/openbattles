import { ascii, u16, u32 } from './bytes';

/**
 * Nitro 3D models (`.nsbmd`, magic `BMD0`): the units the game draws as 3D
 * (siege, flyers, ships). Standard Nitro SDK format; this decodes the static
 * mesh in its bind pose plus its textures. Floats are fine here: this is
 * render-side data and never feeds the sim.
 *
 * Fixed point on the DS: positions and matrices are 1.19.12 (value / 4096),
 * texture coordinates 1.11.4 (value / 16, in texels).
 */

const s16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const s32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
const fx = (v: number) => v / 4096;

/** 3D files (BMD0, BCA0, ...) list their sections in an offset table after the header. */
export function sections3d(d: Uint8Array): Map<string, { offset: number; size: number }> {
  const out = new Map<string, { offset: number; size: number }>();
  for (let i = 0; i < u16(d, 0x0e); i++) {
    const o = u32(d, 0x10 + i * 4);
    out.set(ascii(d, o, 4), { offset: o, size: u32(d, o + 4) });
  }
  return out;
}

/**
 * Nitro "info block" dictionary: a name -> fixed-size entry table used all over
 * the 3D formats. Returns each entry's data offset and its name.
 */
export function readDict(d: Uint8Array, o: number): { name: string; data: number }[] {
  const count = d[o + 1]!;
  // 4-byte header, 4-byte subheader + 4 const bytes, one 4-byte tree node per entry.
  const dataHdr = o + 12 + count * 4;
  const entrySize = u16(d, dataHdr);
  const data = dataHdr + 4;
  const names = data + entrySize * count;
  return Array.from({ length: count }, (_, i) => ({ name: ascii(d, names + i * 16, 16), data: data + i * entrySize }));
}

export type Mat4 = Float64Array; // column-major 4x4

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

export function apply(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/** A rotation-and-translation-and-scale, as stored per object (bone). */
export interface Srt {
  scale: [number, number, number];
  /** 3x3 rotation, column-major as stored (index = col * 3 + row). */
  rot: number[];
  trans: [number, number, number];
}

export function srtMatrix(t: Srt): Mat4 {
  const m = identity();
  const r = t.rot;
  // Scale applied first (M = T * R * S).
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[c * 4 + row] = r[c * 3 + row]! * t.scale[c]!;
  m[12] = t.trans[0]; m[13] = t.trans[1]; m[14] = t.trans[2];
  return m;
}

/**
 * Pivot-compressed rotation: a 3x3 with one ±1 "pivot" cell; the 2x2 left after
 * removing its row and column is [[a, b], [±b, ±a]].
 */
export function pivotRotation(flags: number, a: number, b: number): number[] {
  const select = (flags >> 4) & 15;
  const neg = (flags >> 8) & 15;
  const m = new Array(9).fill(0) as number[];
  m[select] = neg & 1 ? -1 : 1;
  const prow = Math.floor(select / 3);
  const pcol = select % 3;
  const rows = [0, 1, 2].filter((r) => r !== prow);
  const cols = [0, 1, 2].filter((c) => c !== pcol);
  const c = neg & 2 ? -b : b;
  const dd = neg & 4 ? -a : a;
  m[rows[0]! * 3 + cols[0]!] = a;
  m[rows[0]! * 3 + cols[1]!] = b;
  m[rows[1]! * 3 + cols[0]!] = c;
  m[rows[1]! * 3 + cols[1]!] = dd;
  return m;
}

/** Object (bone) transform record. */
export function readObject(d: Uint8Array, o: number): Srt {
  const flags = u16(d, o);
  const m0 = s16(d, o + 2);
  let p = o + 4;
  const t: Srt = { scale: [1, 1, 1], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], trans: [0, 0, 0] };
  if (!(flags & 1)) {
    t.trans = [fx(s32(d, p)), fx(s32(d, p + 4)), fx(s32(d, p + 8))];
    p += 12;
  }
  if (flags & 8) {
    t.rot = pivotRotation(flags, fx(s16(d, p)), fx(s16(d, p + 2)));
    p += 4;
  } else if (!(flags & 2)) {
    t.rot = [fx(m0), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => fx(s16(d, p + i * 2)))];
    p += 16;
  }
  if (!(flags & 4)) t.scale = [fx(s32(d, p)), fx(s32(d, p + 4)), fx(s32(d, p + 8))];
  return t;
}

export interface Vertex {
  /** Model-space position after the bone matrix, bind pose. */
  pos: [number, number, number];
  /** Texcoord in texels. */
  uv: [number, number];
  /** Vertex color, 0..31 per channel. */
  color: [number, number, number];
  /** Matrix stack slot this vertex was transformed by (for animation). */
  slot: number;
  /** Untransformed position (before the slot matrix). */
  raw: [number, number, number];
}

export interface Triangle {
  v: [Vertex, Vertex, Vertex];
  material: number;
}

export interface Texture {
  name: string;
  width: number;
  height: number;
  /** RGBA, alpha 0 where transparent. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Material {
  name: string;
  texture: Texture | null;
  /** Where the texture came from, to decode it again with team colors. */
  source: { tex0: Uint8Array; params: number; palOffset: number } | null;
  /** TEXIMAGE_PARAM repeat/flip bits: 16 repeat S, 17 repeat T, 18 flip S, 19 flip T. */
  wrap: number;
  /** Polygon alpha 0..31 (31 opaque). */
  alpha: number;
}

export interface Model {
  name: string;
  objects: { name: string; srt: Srt }[];
  materials: Material[];
  triangles: Triangle[];
  /** Render program: which objects' matrices go into which stack slots. */
  program: RenderOp[];
  posScale: number;
  /**
   * Bounding box from the model header (min corner + size), in the units the
   * artists used. Unlike the meshes, these sizes are on one consistent scale
   * across all unit models.
   */
  box: { min: [number, number, number]; size: [number, number, number] };
}

export type RenderOp =
  | { op: 'mult'; obj: number; store: number | null; load: number | null }
  | { op: 'material'; id: number }
  | { op: 'mesh'; id: number }
  | { op: 'matrix'; slot: number };

/** Parse the render command bytecode that builds the matrix stack and draws meshes. */
function readProgram(d: Uint8Array, o: number, end: number): RenderOp[] {
  const ops: RenderOp[] = [];
  while (o < end) {
    const c = d[o]!;
    o++;
    switch (c) {
      case 0x00: break;
      case 0x01: return ops;
      case 0x02: o += 2; break;
      case 0x03: ops.push({ op: 'matrix', slot: d[o]! }); o += 1; break;
      case 0x04: case 0x24: case 0x44: ops.push({ op: 'material', id: d[o]! }); o += 1; break;
      case 0x05: ops.push({ op: 'mesh', id: d[o]! }); o += 1; break;
      case 0x06: ops.push({ op: 'mult', obj: d[o]!, store: null, load: null }); o += 3; break;
      case 0x26: ops.push({ op: 'mult', obj: d[o]!, store: d[o + 3]!, load: null }); o += 4; break;
      case 0x46: ops.push({ op: 'mult', obj: d[o]!, store: null, load: d[o + 3]! }); o += 4; break;
      case 0x66: ops.push({ op: 'mult', obj: d[o]!, store: d[o + 3]!, load: d[o + 4]! }); o += 5; break;
      case 0x07: case 0x47: case 0x08: o += 1; break;
      case 0x09: { // skinning: store id, count, then count x (stack id, inv-bind id, weight)
        const n = d[o + 1]!;
        o += 2 + n * 3;
        break;
      }
      case 0x0b: case 0x2b: break;
      case 0x0c: case 0x0d: o += 2; break;
      default:
        throw new Error(`Unknown render command 0x${c.toString(16)}`);
    }
  }
  return ops;
}

/** GPU command parameter counts (GBATEK "3D command list"). */
const GX_PARAMS: Record<number, number> = {
  0x00: 0, 0x10: 1, 0x11: 0, 0x12: 1, 0x13: 1, 0x14: 1, 0x15: 0, 0x16: 16, 0x17: 12, 0x18: 16, 0x19: 12, 0x1a: 9,
  0x1b: 3, 0x1c: 3, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 2, 0x24: 1, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x29: 1,
  0x2a: 1, 0x2b: 1, 0x30: 1, 0x31: 1, 0x32: 1, 0x33: 1, 0x34: 32, 0x40: 1, 0x41: 0, 0x50: 1, 0x60: 1, 0x70: 3,
  0x71: 2, 0x72: 1,
};

const sext = (v: number, bits: number) => (v << (32 - bits)) >> (32 - bits);

/**
 * Run one mesh's packed GPU command list and collect triangles in raw (unskinned)
 * coordinates, tagged with the matrix stack slot active for each vertex.
 */
export function runDisplayList(d: Uint8Array, o: number, len: number, material: number, initialSlot: number): Triangle[] {
  const end = o + len;
  const tris: Triangle[] = [];
  let slot = initialSlot;
  let pos: [number, number, number] = [0, 0, 0];
  let uv: [number, number] = [0, 0];
  let color: [number, number, number] = [31, 31, 31];
  let prim = 0;
  let strip: Vertex[] = [];
  const emit = () => {
    const v: Vertex = { pos: [0, 0, 0], raw: [pos[0], pos[1], pos[2]], uv: [uv[0], uv[1]], color: [color[0], color[1], color[2]], slot };
    strip.push(v);
    const n = strip.length;
    const tri = (a: Vertex, b: Vertex, c: Vertex) => tris.push({ v: [a, b, c], material });
    if (prim === 0 && n === 3) { tri(strip[0]!, strip[1]!, strip[2]!); strip = []; }
    else if (prim === 1 && n === 4) { tri(strip[0]!, strip[1]!, strip[2]!); tri(strip[0]!, strip[2]!, strip[3]!); strip = []; }
    else if (prim === 2 && n >= 3) {
      // Alternate winding so all strip triangles face the same way.
      if (n % 2) tri(strip[n - 3]!, strip[n - 2]!, strip[n - 1]!);
      else tri(strip[n - 2]!, strip[n - 3]!, strip[n - 1]!);
    } else if (prim === 3 && n >= 4 && n % 2 === 0) {
      const [a, b, c, e] = [strip[n - 4]!, strip[n - 3]!, strip[n - 1]!, strip[n - 2]!];
      tri(a, b, c); tri(a, c, e);
    }
  };
  while (o + 4 <= end) {
    const ids = [d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!];
    o += 4;
    for (const id of ids) {
      const n = GX_PARAMS[id];
      if (n === undefined) throw new Error(`Unknown GX command 0x${id.toString(16)}`);
      const p = (i: number) => u32(d, o + i * 4);
      switch (id) {
        case 0x14: slot = p(0) & 31; break;
        case 0x20: { const c = p(0); color = [c & 31, (c >> 5) & 31, (c >> 10) & 31]; break; }
        case 0x22: { const c = p(0); uv = [sext(c & 0xffff, 16) / 16, sext(c >>> 16, 16) / 16]; break; }
        case 0x23: { const a = p(0), b = p(1); pos = [fx(sext(a & 0xffff, 16)), fx(sext(a >>> 16, 16)), fx(sext(b & 0xffff, 16))]; emit(); break; }
        case 0x24: { const a = p(0); pos = [fx(sext(a & 1023, 10) << 6), fx(sext((a >> 10) & 1023, 10) << 6), fx(sext((a >> 20) & 1023, 10) << 6)]; emit(); break; }
        case 0x25: { const a = p(0); pos = [fx(sext(a & 0xffff, 16)), fx(sext(a >>> 16, 16)), pos[2]]; emit(); break; }
        case 0x26: { const a = p(0); pos = [fx(sext(a & 0xffff, 16)), pos[1], fx(sext(a >>> 16, 16))]; emit(); break; }
        case 0x27: { const a = p(0); pos = [pos[0], fx(sext(a & 0xffff, 16)), fx(sext(a >>> 16, 16))]; emit(); break; }
        case 0x28: { const a = p(0); pos = [pos[0] + fx(sext(a & 1023, 10)), pos[1] + fx(sext((a >> 10) & 1023, 10)), pos[2] + fx(sext((a >> 20) & 1023, 10))]; emit(); break; }
        case 0x40: prim = p(0) & 3; strip = []; break;
        case 0x41: strip = []; break;
      }
      o += n * 4;
    }
  }
  return tris;
}

/** Decode one TEX0 texture to RGBA. Formats 1-4, 6, 7; 4x4-compressed (5) is decoded too. */
export function decodeTexture(tex0: Uint8Array, params: number, palOffset: number, name: string, palOverride: readonly number[] = []): Texture {
  const t = tex0;
  const width = 8 << ((params >> 20) & 7);
  const height = 8 << ((params >> 23) & 7);
  const format = (params >> 26) & 7;
  const color0Transparent = (params >> 29) & 1;
  const texBase = u32(t, 0x14);
  const palBase = u32(t, 0x38);
  const off = texBase + (params & 0xffff) * 8;
  const pal = palBase + palOffset;
  const out = new Uint8ClampedArray(width * height * 4);
  const put = (i: number, c: number, a: number) => {
    out[i * 4] = ((c & 31) * 255) / 31;
    out[i * 4 + 1] = (((c >> 5) & 31) * 255) / 31;
    out[i * 4 + 2] = (((c >> 10) & 31) * 255) / 31;
    out[i * 4 + 3] = a;
  };
  /** `palOverride[i]` (BGR555) replaces palette entry i: how team colors are applied. */
  const palColor = (i: number) => palOverride[i] ?? u16(t, pal + i * 2);
  const n = width * height;
  switch (format) {
    case 1: for (let i = 0; i < n; i++) { const v = t[off + i]!; put(i, palColor(v & 31), (((v >> 5) * 4 + (v >> 5) / 2) * 255) / 31); } break;
    case 6: for (let i = 0; i < n; i++) { const v = t[off + i]!; put(i, palColor(v & 7), ((v >> 3) * 255) / 31); } break;
    case 2: for (let i = 0; i < n; i++) { const v = (t[off + (i >> 2)]! >> ((i & 3) * 2)) & 3; put(i, palColor(v), v === 0 && color0Transparent ? 0 : 255); } break;
    case 3: for (let i = 0; i < n; i++) { const v = (t[off + (i >> 1)]! >> ((i & 1) * 4)) & 15; put(i, palColor(v), v === 0 && color0Transparent ? 0 : 255); } break;
    case 4: for (let i = 0; i < n; i++) { const v = t[off + i]!; put(i, palColor(v), v === 0 && color0Transparent ? 0 : 255); } break;
    case 7: for (let i = 0; i < n; i++) { const c = u16(t, off + i * 2); put(i, c, c & 0x8000 ? 255 : 0); } break;
    case 5: {
      // 4x4 blocks: u32 of 2-bit texel indices per block, plus a u16 per block in the extra area.
      const blocks = u32(t, 0x24) + (params & 0xffff) * 8;
      const extra = u32(t, 0x28) + (params & 0xffff) * 4;
      const bw = width / 4;
      for (let b = 0; b < (width * height) / 16; b++) {
        const bits = u32(t, blocks + b * 4);
        const info = u16(t, extra + b * 2);
        const pbase = pal + (info & 0x3fff) * 4;
        const mode = info >> 14;
        const c = [0, 1, 2, 3].map((k) => u16(t, pbase + Math.min(k, mode >= 2 ? 1 : 3) * 2));
        // (4x4-compressed palettes are addressed per block; team recolor isn't applied here.)
        const mix = (x: number, y: number, wx: number, wy: number) => {
          const ch = (s: number) => Math.floor((((x >> s) & 31) * wx + ((y >> s) & 31) * wy) / (wx + wy));
          return ch(0) | (ch(5) << 5) | (ch(10) << 10);
        };
        if (mode === 1) c[2] = mix(c[0]!, c[1]!, 1, 1);
        if (mode === 2) { c[2] = mix(c[0]!, c[1]!, 5, 3); c[3] = mix(c[0]!, c[1]!, 3, 5); }
        if (mode === 3) { c[2] = u16(t, pbase + 4); c[3] = u16(t, pbase + 6); }
        for (let k = 0; k < 16; k++) {
          const v = (bits >> (k * 2)) & 3;
          const x = (b % bw) * 4 + (k & 3);
          const y = Math.floor(b / bw) * 4 + (k >> 2);
          put(y * width + x, c[v]!, v === 3 && mode < 2 ? 0 : 255);
        }
      }
      break;
    }
    default: break;
  }
  return { name, width, height, data: out };
}

function readTex0(d: Uint8Array, o: number) {
  const tex0 = d.subarray(o);
  const textures = readDict(tex0, u16(tex0, 0x0e)).map((e) => ({ name: e.name, params: u32(tex0, e.data) }));
  const palettes = readDict(tex0, u32(tex0, 0x34)).map((e) => ({ name: e.name, offset: u16(tex0, e.data) * 8 }));
  return { tex0, textures, palettes };
}

/** Parse the first model in an `.nsbmd` file, mesh in raw coordinates plus the render program. */
export function parseNsbmd(d: Uint8Array): Model {
  if (ascii(d, 0, 4) !== 'BMD0') throw new Error('Not a BMD0 model');
  const secs = sections3d(d);
  const mdl0 = secs.get('MDL0');
  if (!mdl0) throw new Error('No MDL0');
  const [entry] = readDict(d, mdl0.offset + 8);
  const m = mdl0.offset + u32(d, entry!.data);
  const renderOff = m + u32(d, m + 4);
  const matOff = m + u32(d, m + 8);
  const pieceOff = m + u32(d, m + 12);
  const posScale = fx(s32(d, m + 0x1c));
  const boxScale = fx(s32(d, m + 0x38));
  const b = (i: number) => fx(s16(d, m + 0x2c + i * 2)) * boxScale;
  const box = { min: [b(0), b(1), b(2)] as [number, number, number], size: [b(3), b(4), b(5)] as [number, number, number] };

  const objects = readDict(d, m + 0x40).map((e) => ({ name: e.name, srt: readObject(d, m + 0x40 + u32(d, e.data)) }));
  const program = readProgram(d, renderOff, matOff);

  // Materials, then texture/palette pairings that say which texture each material uses.
  const tex = secs.has('TEX0') ? readTex0(d, secs.get('TEX0')!.offset) : null;
  const matDict = readDict(d, matOff + 4);
  const texFor = new Map<number, string>();
  const palFor = new Map<number, string>();
  for (const [pairOff, target] of [[u16(d, matOff), texFor], [u16(d, matOff + 2), palFor]] as const) {
    for (const e of readDict(d, matOff + pairOff)) {
      const list = matOff + u16(d, e.data);
      const n = d[e.data + 2]!;
      for (let i = 0; i < n; i++) target.set(d[list + i]!, e.name);
    }
  }
  const materials: Material[] = matDict.map((e, i) => {
    const mo = matOff + u32(d, e.data);
    const polyAttr = u32(d, mo + 12);
    const texParam = u32(d, mo + 20);
    let texture: Texture | null = null;
    let source: Material['source'] = null;
    const tn = texFor.get(i);
    if (tex && tn) {
      const t = tex.textures.find((x) => x.name === tn);
      const p = tex.palettes.find((x) => x.name === palFor.get(i));
      if (t) {
        source = { tex0: tex.tex0, params: t.params, palOffset: p?.offset ?? 0 };
        texture = decodeTexture(tex.tex0, t.params, source.palOffset, tn);
      }
    }
    return { name: e.name, texture, source, wrap: texParam, alpha: (polyAttr >> 16) & 31 };
  });

  // Meshes: run the program to know which material and matrix slot each mesh starts with.
  const pieces = readDict(d, pieceOff).map((e) => pieceOff + u32(d, e.data));
  const triangles: Triangle[] = [];
  let material = 0;
  let slot = 0;
  for (const op of program) {
    if (op.op === 'material') material = op.id;
    else if (op.op === 'matrix') slot = op.slot;
    else if (op.op === 'mesh') {
      const p = pieces[op.id]!;
      triangles.push(...runDisplayList(d, p + u32(d, p + 8), u32(d, p + 12), material, slot));
    }
  }
  return { name: entry!.name, objects, materials, triangles, program, posScale, box };
}

/**
 * Build the matrix stack by running the render program with the given object
 * transforms (bind pose, or one animation frame), then place every vertex.
 */
export function poseModel(model: Model, objectMatrix: (obj: number) => Mat4 = (i) => srtMatrix(model.objects[i]!.srt)): Triangle[] {
  const stack: Mat4[] = [];
  let cur = identity();
  for (const op of model.program) {
    if (op.op === 'mult') {
      if (op.load !== null) cur = stack[op.load] ?? identity();
      cur = mul(cur, objectMatrix(op.obj));
      if (op.store !== null) stack[op.store] = cur;
    }
  }
  return model.triangles.map((t) => ({
    ...t,
    v: t.v.map((v) => {
      const m = stack[v.slot] ?? identity();
      const [x, y, z] = apply(m, v.raw[0] * model.posScale, v.raw[1] * model.posScale, v.raw[2] * model.posScale);
      return { ...v, pos: [x, y, z] };
    }) as [Vertex, Vertex, Vertex],
  }));
}

/**
 * The model's materials with palette entries 0-15 replaced (BGR555). Unit models
 * ship with the blue team colors from KingFaction.NCLR bank 2 in those slots, and
 * the game swaps in the owner's bank: seen on a red King ballista in the emulator.
 */
export function recolorMaterials(model: Model, colors: readonly number[]): Material[] {
  return model.materials.map((m) =>
    m.source && m.texture ? { ...m, texture: decodeTexture(m.source.tex0, m.source.params, m.source.palOffset, m.texture.name, colors) } : m,
  );
}
