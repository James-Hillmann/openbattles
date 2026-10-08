import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import type { Rgba } from '../src/render';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(t: string, d: Uint8Array) { const o = new Uint8Array(12 + d.length); const v = new DataView(o.buffer); v.setUint32(0, d.length); o.set(Buffer.from(t), 4); o.set(d, 8); v.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length))); return o; }
export function writePng(path: string, img: Rgba, scale = 1) {
  const w = img.width * scale, h = img.height * scale;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((Math.floor(y / scale) * img.width) + Math.floor(x / scale)) * 4; raw.set(img.data.subarray(s, s + 4), y * (w * 4 + 1) + 1 + x * 4); }
  const ihdr = new Uint8Array(13); const v = new DataView(ihdr.buffer); v.setUint32(0, w); v.setUint32(4, h); ihdr.set([8, 6, 0, 0, 0], 8);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]));
}
