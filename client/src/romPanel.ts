import type { MapBundle, UnitBundle } from '@lbw/extract';
import type { WorkerRequest, WorkerResponse } from './romWorker';

/**
 * Sidebar: load the user's ROM in a worker, show what's in it, and let them
 * pick a map. Nothing leaves the browser.
 */
export function mountRomPanel(input: HTMLInputElement, out: HTMLElement, onMap: (b: MapBundle) => void, onUnits: (u: UnitBundle) => void): void {
  const worker = new Worker(new URL('./romWorker.ts', import.meta.url), { type: 'module' });
  const send = (req: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(req, transfer);

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'error') {
      out.insertAdjacentHTML('beforeend', `<p class="err">${esc(msg.error)}</p>`);
    } else if (msg.type === 'loaded') {
      const s = msg.summary;
      const skirmish = s.maps.filter((m) => /^mp\d+$/.test(m));
      const options = [...skirmish, ...s.maps.filter((m) => !skirmish.includes(m))]
        .map((m) => `<option>${esc(m)}</option>`)
        .join('');
      const rows = s.inventory
        .map((i) => `<tr><td>${esc(i.ext || '-')}</td><td>${esc(i.magic)}</td><td>${i.count}</td><td>${(i.bytes / 1024).toFixed(0)}K</td></tr>`)
        .join('');
      out.innerHTML = `
        <p><b>${esc(s.title)}</b> <code>${esc(s.gameCode)}</code><br/>
        ARM9 ${esc(s.arm9)}, ${s.overlays} overlays, ${s.files} files</p>
        <label>Map <select id="mapPick">${options}</select></label>
        <details><summary>File formats</summary>
        <table><tr><th>ext</th><th>magic</th><th>n</th><th>size</th></tr>${rows}</table></details>`;
      const pick = out.querySelector<HTMLSelectElement>('#mapPick')!;
      pick.addEventListener('change', () => send({ type: 'map', name: pick.value }));
      send({ type: 'map', name: pick.value });
    } else if (msg.type === 'units') {
      onUnits(msg.units);
    } else {
      onMap(msg.bundle);
    }
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    out.textContent = 'Reading...';
    const buf = await file.arrayBuffer();
    send({ type: 'load', rom: buf }, [buf]);
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
