/// <reference lib="webworker" />
import {
  applyTeamColors,
  buildHudBundle,
  buildMapBundle,
  FLASH_BANK,
  buildUnitBundle,
  modelClips,
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
 * Palette banks the sandbox draws by default: 0 red (you), 2 blue (opponent); bank + 1
 * is the same team selected, with its outline; FLASH_BANK for the hit flash. An online
 * match asks for its players' colors instead (team color c = bank 2c).
 */
const DEFAULT_TEAMS = [0, 1];
/** Team whose selection outline is yellow (the local player's, red). */
const LOCAL_TEAM = 0;

/** Units in the given team colors; `localTeam` gets the yellow selection outline. */
function units(r: UnpackedRom, teams: readonly number[], localTeam: number): UnitBundle {
  const banks = [...teams.flatMap((t) => [2 * t, 2 * t + 1]), FLASH_BANK];
  return buildUnitBundle(
    (path) => tryRomFile(r, path),
    banks,
    (pal) => applyTeamColors(pal, r.arm9, r.header.arm9.ramAddress, r.header.gameCode, localTeam),
    (e) => modelClips(r.arm9, r.header.arm9.ramAddress, r.header.gameCode, e.entityIndex),
  );
}

/**
 * Identifies the ROM for the lobby: players with different dumps would build different
 * worlds and desync, so the relay only pairs matching fingerprints. FNV-1a over the
 * cartridge header, which holds the game code, version and the header/secure-area CRCs.
 */
function fingerprint(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < Math.min(0x160, bytes.length); i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type RomSummary = {
  title: string;
  gameCode: string;
  arm9: string;
  overlays: number;
  files: number;
  maps: string[];
  fingerprint: string;
  inventory: { ext: string; magic: string; count: number; bytes: number }[];
};

export type WorkerRequest =
  | { type: 'load'; rom: ArrayBuffer }
  | { type: 'map'; name: string }
  /** Rebuild the unit sheets for these team colors (0..5). */
  | { type: 'units'; teams: number[]; localTeam: number };
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
      const bytes = new Uint8Array(e.data.rom);
      rom = unpackRom(bytes);
      post({
        type: 'loaded',
        summary: {
          title: rom.header.title,
          gameCode: rom.header.gameCode,
          arm9: `${hex(rom.header.arm9.ramAddress)} (${rom.arm9.length} bytes)`,
          overlays: rom.overlays.length,
          files: rom.files.length,
          maps: listMaps(rom),
          fingerprint: fingerprint(bytes),
          inventory: rom.inventory,
        },
      });
      const u = units(rom, DEFAULT_TEAMS, LOCAL_TEAM);
      portraitIds = [...new Set(u.sprites.map((s) => s.name))];
      post({ type: 'units', units: u }, u.sprites.map((s) => s.atlas.data.buffer));
    } else if (e.data.type === 'units') {
      if (!rom) throw new Error('No ROM loaded');
      const u = units(rom, e.data.teams, e.data.localTeam);
      post({ type: 'units', units: u }, u.sprites.map((s) => s.atlas.data.buffer));
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
