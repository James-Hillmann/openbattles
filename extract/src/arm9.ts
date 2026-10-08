import { indexOf, u32 } from './bytes';
import { blzDecompress } from './blz';

/** Magic pair the Nitro SDK places in the ARM9 "module params" block. */
const NITROCODE = [0x21, 0x06, 0xc0, 0xde, 0xde, 0xc0, 0x06, 0x21];

export interface Arm9Info {
  moduleParamsOffset: number;
  /** RAM address where compressed data ends; 0 means not compressed. */
  compressedEnd: number;
  sdkVersion: number;
}

export function findModuleParams(arm9: Uint8Array): Arm9Info | null {
  const at = indexOf(arm9, NITROCODE);
  if (at < 0x1c) return null;
  const p = at - 0x1c;
  return { moduleParamsOffset: p, compressedEnd: u32(arm9, p + 0x14), sdkVersion: u32(arm9, p + 0x18) };
}

/**
 * Returns the ARM9 binary as it looks in RAM after the boot code unpacks it.
 * This is what you load into Ghidra. The `compressedEnd` field is zeroed so
 * tools don't try to decompress it again.
 */
export function decompressArm9(arm9: Uint8Array, ramAddress: number): { data: Uint8Array; wasCompressed: boolean } {
  const info = findModuleParams(arm9);
  if (!info || info.compressedEnd === 0) return { data: arm9.slice(), wasCompressed: false };
  const end = info.compressedEnd - ramAddress;
  if (end <= 0 || end > arm9.length) throw new Error('ARM9 compressedEnd outside binary');
  const dec = blzDecompress(arm9.subarray(0, end));
  const out = new Uint8Array(dec.length + (arm9.length - end));
  out.set(dec);
  out.set(arm9.subarray(end), dec.length);
  new DataView(out.buffer).setUint32(info.moduleParamsOffset + 0x14, 0, true);
  return { data: out, wasCompressed: true };
}
