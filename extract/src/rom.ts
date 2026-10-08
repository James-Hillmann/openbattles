import { decompressArm9 } from './arm9';
import { blzDecompress } from './blz';
import { inventory, type InventoryRow } from './inventory';
import { fileBytes, parseFat, parseFnt, parseHeader, parseOverlayTable, type NdsHeader, type Overlay } from './nds';

export interface UnpackedRom {
  header: NdsHeader;
  files: { id: number; path: string; data: Uint8Array }[];
  arm9: Uint8Array;
  arm9WasCompressed: boolean;
  overlays: (Overlay & { data: Uint8Array })[];
  inventory: InventoryRow[];
}

/** Everything M0 needs from a ROM, in memory. Works in Node and in a Web Worker. */
export function unpackRom(rom: Uint8Array): UnpackedRom {
  const header = parseHeader(rom);
  const fat = parseFat(rom, header);
  const files = parseFnt(rom, header).map((f) => ({ ...f, data: fileBytes(rom, fat, f.id) }));
  const arm9Raw = rom.subarray(header.arm9.romOffset, header.arm9.romOffset + header.arm9.size);
  const arm9 = decompressArm9(arm9Raw, header.arm9.ramAddress);
  const overlays = parseOverlayTable(rom, header.arm9OverlayTable).map((ov) => {
    const raw = fileBytes(rom, fat, ov.fileId);
    return { ...ov, data: ov.compressed ? blzDecompress(raw) : raw.slice() };
  });
  return { header, files, arm9: arm9.data, arm9WasCompressed: arm9.wasCompressed, overlays, inventory: inventory(files) };
}
