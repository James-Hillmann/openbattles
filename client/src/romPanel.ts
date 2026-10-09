import type { ArmyBundle, HudBundle, MapBundle, Rgba, UnitBundle } from '@lbw/extract';
import type { RomSummary, WorkerRequest, WorkerResponse } from './romWorker';

/** Stereo PCM at the DS mixer rate; `player` is the sound player it plays on (-1 for music). */
export type SoundPcm = { left: Float32Array; right: Float32Array; player: number };

/** What the rest of the client can ask of the loaded ROM. */
export interface RomControl {
  /** Null until a ROM is loaded. */
  summary(): RomSummary | null;
  /** Read a ROM file's bytes in the worker; resolves once its summary, army and unit bundles are in. */
  load(bytes: ArrayBuffer): Promise<RomSummary>;
  /** Load a map; resolves after `onMap` ran for it. */
  loadMap(name: string): Promise<void>;
  /** Rebuild unit sheets for these team colors; resolves after `onUnits` ran. */
  loadUnits(teams: number[], localTeam: number): Promise<void>;
  /** Ask for the ground redrawn with this terrain; `onGround` gets it. */
  rebake(name: string, terrain: Uint8Array): void;
  /** Render an effect or decode a music stream (stereo PCM at the DS mixer rate); null if there is none. */
  sound(req: { effect: { arc: number; index: number } } | { music: number }): Promise<SoundPcm | null>;
  onGround: ((name: string, ground: Rgba) => void) | null;
}

export interface RomHandlers {
  onMap(b: MapBundle, hud: HudBundle): void;
  onUnits(u: UnitBundle): void;
  onArmy(a: ArmyBundle): void;
  onError(message: string): void;
}

/** Load the user's ROM in a worker. Nothing leaves the browser. */
export function createRom(h: RomHandlers): RomControl {
  const worker = new Worker(new URL('./romWorker.ts', import.meta.url), { type: 'module' });
  const send = (req: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(req, transfer);
  let summary: RomSummary | null = null;
  // The worker answers in request order, so FIFO queues match replies to requests.
  const mapWaiters: (() => void)[] = [];
  const unitWaiters: (() => void)[] = [];
  const soundWaiters = new Map<number, (pcm: SoundPcm | null) => void>();
  let soundId = 0;
  let loading: { resolve: (s: RomSummary) => void; reject: (e: Error) => void; summary?: RomSummary } | null = null;

  const ctl: RomControl = {
    summary: () => summary,
    load: (bytes) =>
      new Promise((resolve, reject) => {
        loading = { resolve, reject };
        send({ type: 'load', rom: bytes }, [bytes]);
      }),
    loadMap: (name) =>
      new Promise((resolve) => {
        mapWaiters.push(resolve);
        send({ type: 'map', name });
      }),
    loadUnits: (teams, localTeam) =>
      new Promise((resolve) => {
        unitWaiters.push(resolve);
        send({ type: 'units', teams, localTeam });
      }),
    rebake: (name, terrain) => send({ type: 'ground', name, terrain: terrain.slice() }),
    sound: (req) =>
      new Promise((resolve) => {
        const id = ++soundId;
        soundWaiters.set(id, resolve);
        send({ type: 'sound', id, ...req });
      }),
    onGround: null,
  };

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'sound') {
      soundWaiters.get(msg.id)?.(msg.pcm);
      soundWaiters.delete(msg.id);
    } else if (msg.type === 'error') {
      if (loading) {
        loading.reject(new Error(msg.error));
        loading = null;
      } else {
        h.onError(msg.error);
        mapWaiters.shift()?.();
      }
    } else if (msg.type === 'loaded') {
      summary = msg.summary;
      if (loading) loading.summary = msg.summary;
    } else if (msg.type === 'army') {
      h.onArmy(msg.army);
    } else if (msg.type === 'ground') {
      ctl.onGround?.(msg.name, msg.ground);
    } else if (msg.type === 'units') {
      h.onUnits(msg.units);
      // The first unit bundle after a load finishes the load.
      if (loading?.summary) {
        loading.resolve(loading.summary);
        loading = null;
      } else unitWaiters.shift()?.();
    } else {
      h.onMap(msg.bundle, msg.hud);
      mapWaiters.shift()?.();
    }
  };
  return ctl;
}

/** Skirmish maps (mp01..mp30) first, then the rest. */
export function skirmishFirst(maps: readonly string[]): string[] {
  const skirmish = maps.filter((m) => /^mp\d+$/.test(m));
  return [...skirmish, ...maps.filter((m) => !skirmish.includes(m))];
}

// --- Keep the ROM between visits (IndexedDB, this browser only) ------------------

const DB = 'openbattles';
const STORE = 'rom';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** The ROM saved by `saveRom`, or null. Never throws: storage may be blocked. */
export async function savedRom(): Promise<ArrayBuffer | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const r = d.transaction(STORE).objectStore(STORE).get('rom');
      r.onsuccess = () => resolve(r.result instanceof ArrayBuffer ? r.result : null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveRom(bytes: ArrayBuffer | null): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve) => {
      const tx = d.transaction(STORE, 'readwrite');
      if (bytes) tx.objectStore(STORE).put(bytes, 'rom');
      else tx.objectStore(STORE).delete('rom');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* storage blocked: the player loads it again next time */
  }
}
