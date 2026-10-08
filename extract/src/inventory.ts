import { ascii } from './bytes';
import { isPmoc, pmocDecompress } from './pmoc';

/**
 * Guess a file's format from its first bytes. Standard Nitro SDK formats have
 * 4-char magics (NARC, NCGR, NCLR, NSCR, NANR, NCER, SDAT, BMD0, BTX0, ...).
 * LEGO Battles wraps most of its data in a PMOC container; for those we report
 * the inner magic as "PMOC>XXXX". Anything with no magic shows up as "?".
 */
export function sniff(data: Uint8Array): string {
  if (data.length === 0) return 'empty';
  if (isPmoc(data)) {
    try {
      return `PMOC>${sniff(pmocDecompress(data))}`;
    } catch {
      return 'PMOC>(bad)';
    }
  }
  if (data.length >= 4) {
    const m = ascii(data, 0, 4);
    if (/^[A-Za-z0-9 ]{4}$/.test(m)) return m;
  }
  const t = data[0];
  // Nintendo BIOS LZ77 (0x10), LZ11 (0x11), Huffman (0x2x), RLE (0x30).
  if (t === 0x10 || t === 0x11) return `lz${t.toString(16)}?`;
  if (t === 0x30) return 'rle?';
  if (t === 0x24 || t === 0x28) return 'huff?';
  return '?';
}

export interface InventoryRow {
  ext: string;
  magic: string;
  count: number;
  bytes: number;
  example: string;
}

export function inventory(files: { path: string; data: Uint8Array }[]): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  for (const f of files) {
    const dot = f.path.lastIndexOf('.');
    const ext = dot > f.path.lastIndexOf('/') ? f.path.slice(dot + 1).toLowerCase() : '';
    const magic = sniff(f.data);
    const key = `${ext}\u0000${magic}`;
    const r = rows.get(key) ?? { ext, magic, count: 0, bytes: 0, example: f.path };
    r.count++;
    r.bytes += f.data.length;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.bytes - a.bytes);
}
