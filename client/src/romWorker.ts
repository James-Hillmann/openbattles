/// <reference lib="webworker" />
import { buildHudBundle, buildMapBundle, hex, listMaps, unpackRom, type HudBundle, type MapBundle, type UnpackedRom } from '@lbw/extract';

export type RomSummary = {
  title: string;
  gameCode: string;
  arm9: string;
  overlays: number;
  files: number;
  maps: string[];
  inventory: { ext: string; magic: string; count: number; bytes: number }[];
};

export type WorkerRequest = { type: 'load'; rom: ArrayBuffer } | { type: 'map'; name: string };
export type WorkerResponse =
  | { type: 'loaded'; summary: RomSummary }
  | { type: 'map'; bundle: MapBundle; hud: HudBundle }
  | { type: 'error'; error: string };

let rom: UnpackedRom | null = null;

/** Entities whose portraits the client can show (the sandbox spawns Guardsmen). */
const HUD_PORTRAITS = ['K_Swordsman'];

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.type === 'load') {
      rom = unpackRom(new Uint8Array(e.data.rom));
      post({
        type: 'loaded',
        summary: {
          title: rom.header.title,
          gameCode: rom.header.gameCode,
          arm9: `${hex(rom.header.arm9.ramAddress)} (${rom.arm9.length} bytes)`,
          overlays: rom.overlays.length,
          files: rom.files.length,
          maps: listMaps(rom),
          inventory: rom.inventory,
        },
      });
    } else {
      if (!rom) throw new Error('No ROM loaded');
      const bundle = buildMapBundle(rom, e.data.name);
      const hud = buildHudBundle(rom, HUD_PORTRAITS);
      const transfer = [bundle.ground.data.buffer, ...Object.values(bundle.units).map((u) => u.data.buffer)];
      post({ type: 'map', bundle, hud }, transfer as Transferable[]);
    }
  } catch (err) {
    post({ type: 'error', error: String(err) });
  }
};
