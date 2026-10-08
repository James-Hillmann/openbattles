import type { HudBundle, MapBundle, Rgba, UnitBundle } from '@lbw/extract';
import type { RomSummary, WorkerRequest, WorkerResponse } from './romWorker';

/** What the rest of the client can ask of the loaded ROM. */
export interface RomControl {
  /** Null until a ROM is loaded. */
  summary(): RomSummary | null;
  /** Load a map; resolves after `onMap` ran for it. */
  loadMap(name: string): Promise<void>;
  /** Rebuild unit sheets for these team colors; resolves after `onUnits` ran. */
  loadUnits(teams: number[], localTeam: number): Promise<void>;
  /** Lock the map picker (an online match chose the map). */
  lockMap(name: string | null): void;
  /** Ask for the ground redrawn with this terrain; `onGround` gets it. */
  rebake(name: string, terrain: Uint8Array): void;
  onGround: ((name: string, ground: Rgba) => void) | null;
  /** Called whenever a ROM finishes loading. */
  onLoaded: (() => void) | null;
}

/**
 * Sidebar: load the user's ROM in a worker, show what's in it, and let them
 * pick a map. Nothing leaves the browser.
 */
export function mountRomPanel(
  input: HTMLInputElement,
  out: HTMLElement,
  onMap: (b: MapBundle, hud: HudBundle) => void,
  onUnits: (u: UnitBundle) => void,
): RomControl {
  const worker = new Worker(new URL('./romWorker.ts', import.meta.url), { type: 'module' });
  const send = (req: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(req, transfer);
  let summary: RomSummary | null = null;
  // The worker answers in request order, so FIFO queues match replies to requests.
  // Untracked requests (the map picker) queue a no-op so replies stay aligned.
  const mapWaiters: (() => void)[] = [];
  const unitWaiters: (() => void)[] = [];
  const noop = () => {};
  const pickMap = (name: string) => {
    mapWaiters.push(noop);
    send({ type: 'map', name });
  };
  let pick: HTMLSelectElement | null = null;

  const ctl: RomControl = {
    summary: () => summary,
    loadMap: (name) =>
      new Promise((resolve) => {
        mapWaiters.push(resolve);
        if (pick) pick.value = name;
        send({ type: 'map', name });
      }),
    loadUnits: (teams, localTeam) =>
      new Promise((resolve) => {
        unitWaiters.push(resolve);
        send({ type: 'units', teams, localTeam });
      }),
    lockMap: (name) => {
      if (!pick) return;
      pick.disabled = name !== null;
      if (name) pick.value = name;
    },
    rebake: (name, terrain) => send({ type: 'ground', name, terrain: terrain.slice() }),
    onGround: null,
    onLoaded: null,
  };

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'error') {
      out.insertAdjacentHTML('beforeend', `<p class="err">${esc(msg.error)}</p>`);
      mapWaiters.shift()?.();
    } else if (msg.type === 'loaded') {
      const s = msg.summary;
      summary = s;
      const options = skirmishFirst(s.maps).map((m) => `<option>${esc(m)}</option>`).join('');
      const rows = s.inventory
        .map((i) => `<tr><td>${esc(i.ext || '-')}</td><td>${esc(i.magic)}</td><td>${i.count}</td><td>${(i.bytes / 1024).toFixed(0)}K</td></tr>`)
        .join('');
      out.innerHTML = `
        <p><b>${esc(s.title)}</b> <code>${esc(s.gameCode)}</code><br/>
        ARM9 ${esc(s.arm9)}, ${s.overlays} overlays, ${s.files} files</p>
        <label>Map <select id="mapPick">${options}</select></label>
        <details><summary>File formats</summary>
        <table><tr><th>ext</th><th>magic</th><th>n</th><th>size</th></tr>${rows}</table></details>`;
      pick = out.querySelector<HTMLSelectElement>('#mapPick')!;
      pick.addEventListener('change', () => pickMap(pick!.value));
      pickMap(pick.value);
      ctl.onLoaded?.();
    } else if (msg.type === 'ground') {
      ctl.onGround?.(msg.name, msg.ground);
    } else if (msg.type === 'units') {
      onUnits(msg.units);
      unitWaiters.shift()?.();
    } else {
      onMap(msg.bundle, msg.hud);
      mapWaiters.shift()?.();
    }
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    out.textContent = 'Reading...';
    const buf = await file.arrayBuffer();
    send({ type: 'load', rom: buf }, [buf]);
  });
  return ctl;
}

/** Skirmish maps (mp01..mp30) first, then the rest. */
export function skirmishFirst(maps: readonly string[]): string[] {
  const skirmish = maps.filter((m) => /^mp\d+$/.test(m));
  return [...skirmish, ...maps.filter((m) => !skirmish.includes(m))];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
