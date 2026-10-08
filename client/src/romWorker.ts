/// <reference lib="webworker" />
import { hex, unpackRom } from '@lbw/extract';

export type RomSummary = {
  title: string;
  gameCode: string;
  arm9: string;
  arm9Compressed: boolean;
  overlays: number;
  files: number;
  inventory: { ext: string; magic: string; count: number; bytes: number; example: string }[];
};

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const r = unpackRom(new Uint8Array(e.data));
    const summary: RomSummary = {
      title: r.header.title,
      gameCode: r.header.gameCode,
      arm9: `${hex(r.header.arm9.ramAddress)} (${r.arm9.length} bytes)`,
      arm9Compressed: r.arm9WasCompressed,
      overlays: r.overlays.length,
      files: r.files.length,
      inventory: r.inventory,
    };
    self.postMessage({ ok: true, summary });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
