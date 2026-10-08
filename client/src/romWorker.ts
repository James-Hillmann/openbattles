/// <reference lib="webworker" />
import {
  applyTeamColors,
  buildHudBundle,
  buildMapBundle,
  buildUnitBundle,
  hex,
  listMaps,
  tryRomFile,
  unpackRom,
  type HudBundle,
  type MapBundle,
  type UnitBundle,
  type UnpackedRom,
} from '@lbw/extract';

/**
 * Palette banks the sandbox draws: 0 red (you), 2 blue (opponent); bank + 1 is
 * the same team selected, with its outline.
 */
const TEAM_BANKS = [0, 1, 2, 3];
/** Team whose selection outline is yellow (the local player's, red). */
const LOCAL_TEAM = 0;

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
  | { type: 'units'; units: UnitBundle }
  | { type: 'map'; bundle: MapBundle; hud: HudBundle }
  | { type: 'error'; error: string };

let rom: UnpackedRom | null = null;

/** Entities whose portraits the HUD can show: every sprite unit in the unit bundle. */
let portraitIds: string[] = [];

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
      const r = rom;
      const units = buildUnitBundle((path) => tryRomFile(r, path), TEAM_BANKS, (pal) =>
        applyTeamColors(pal, r.arm9, r.header.arm9.ramAddress, r.header.gameCode, LOCAL_TEAM),
      );
      portraitIds = [...new Set(units.sprites.map((s) => s.name))];
      post({ type: 'units', units }, units.sprites.map((s) => s.atlas.data.buffer));
    } else {
      if (!rom) throw new Error('No ROM loaded');
      const bundle = buildMapBundle(rom, e.data.name);
      const hud = buildHudBundle(rom, portraitIds);
      const transfer = [bundle.ground.data.buffer, ...(bundle.minimap ? [bundle.minimap.data.buffer] : [])];
      post({ type: 'map', bundle, hud }, transfer as Transferable[]);
    }
  } catch (err) {
    post({ type: 'error', error: String(err) });
  }
};
