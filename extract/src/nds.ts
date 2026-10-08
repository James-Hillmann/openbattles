import { ascii, u16, u32 } from './bytes';

/**
 * Nintendo DS cartridge layout (see GBATEK "DS Cartridge Header").
 *
 * A ROM is: 0x200-byte header, then the ARM9 binary (main CPU, runs the game),
 * the ARM7 binary (sound/wifi co-processor, almost never game logic), the
 * overlay tables, and NitroFS: a FAT (file offsets) plus FNT (file names).
 */
export interface NdsHeader {
  title: string;
  gameCode: string;
  makerCode: string;
  arm9: { romOffset: number; entry: number; ramAddress: number; size: number };
  arm7: { romOffset: number; entry: number; ramAddress: number; size: number };
  fnt: { offset: number; size: number };
  fat: { offset: number; size: number };
  arm9OverlayTable: { offset: number; size: number };
  arm7OverlayTable: { offset: number; size: number };
  iconTitleOffset: number;
  romSize: number;
  headerSize: number;
}

export function parseHeader(rom: Uint8Array): NdsHeader {
  if (rom.length < 0x200) throw new Error('File too small to be a DS ROM');
  const bin = (o: number) => ({ romOffset: u32(rom, o), entry: u32(rom, o + 4), ramAddress: u32(rom, o + 8), size: u32(rom, o + 12) });
  const region = (o: number) => ({ offset: u32(rom, o), size: u32(rom, o + 4) });
  return {
    title: ascii(rom, 0x00, 12),
    gameCode: ascii(rom, 0x0c, 4),
    makerCode: ascii(rom, 0x10, 2),
    arm9: bin(0x20),
    arm7: bin(0x30),
    fnt: region(0x40),
    fat: region(0x48),
    arm9OverlayTable: region(0x50),
    arm7OverlayTable: region(0x58),
    iconTitleOffset: u32(rom, 0x68),
    romSize: u32(rom, 0x80),
    headerSize: u32(rom, 0x84),
  };
}

export interface FatEntry {
  start: number;
  end: number;
}

export function parseFat(rom: Uint8Array, h: NdsHeader): FatEntry[] {
  const out: FatEntry[] = [];
  for (let o = h.fat.offset; o < h.fat.offset + h.fat.size; o += 8) out.push({ start: u32(rom, o), end: u32(rom, o + 4) });
  return out;
}

export interface FsFile {
  id: number;
  path: string;
}

/**
 * Walk the FNT. Directory ids are 0xF000 + index into the main table; file ids
 * are sequential within each directory starting at that dir's firstFileId.
 * Files with ids below the root's firstFileId are overlays (unnamed).
 */
export function parseFnt(rom: Uint8Array, h: NdsHeader): FsFile[] {
  const base = h.fnt.offset;
  const files: FsFile[] = [];
  const walk = (dirIndex: number, prefix: string, depth: number) => {
    if (depth > 64) throw new Error('FNT nesting too deep (corrupt?)');
    const entry = base + dirIndex * 8;
    let p = base + u32(rom, entry);
    let fileId = u16(rom, entry + 4);
    for (;;) {
      const t = rom[p++];
      if (t === undefined) throw new Error('FNT ran off end of ROM');
      if (t === 0) break;
      if (t === 0x80) throw new Error('Reserved FNT entry type 0x80');
      const len = t & 0x7f;
      const name = ascii(rom, p, len);
      p += len;
      if (t & 0x80) {
        const sub = u16(rom, p) & 0x0fff;
        p += 2;
        walk(sub, `${prefix}${name}/`, depth + 1);
      } else {
        files.push({ id: fileId++, path: prefix + name });
      }
    }
  };
  walk(0, '', 0);
  return files.sort((a, b) => a.id - b.id);
}

/** One ARM9 overlay: code loaded into RAM on demand (levels, menus, modes). */
export interface Overlay {
  id: number;
  ramAddress: number;
  ramSize: number;
  bssSize: number;
  staticInitStart: number;
  staticInitEnd: number;
  fileId: number;
  /** Bit 24 of the flags word: file is BLZ-compressed. */
  compressed: boolean;
  compressedSize: number;
}

export function parseOverlayTable(rom: Uint8Array, region: { offset: number; size: number }): Overlay[] {
  const out: Overlay[] = [];
  for (let o = region.offset; o < region.offset + region.size; o += 32) {
    const flags = u32(rom, o + 28);
    out.push({
      id: u32(rom, o),
      ramAddress: u32(rom, o + 4),
      ramSize: u32(rom, o + 8),
      bssSize: u32(rom, o + 12),
      staticInitStart: u32(rom, o + 16),
      staticInitEnd: u32(rom, o + 20),
      fileId: u32(rom, o + 24),
      compressed: ((flags >>> 24) & 1) === 1,
      compressedSize: flags & 0xffffff,
    });
  }
  return out;
}

export const fileBytes = (rom: Uint8Array, fat: FatEntry[], id: number): Uint8Array => {
  const e = fat[id];
  if (!e) throw new Error(`No FAT entry for file id ${id}`);
  return rom.subarray(e.start, e.end);
};
