import type { RomSummary } from './romWorker';

/**
 * M0 in the browser: read the user's ROM in a worker and show the format
 * inventory. M1 will cache decoded assets in IndexedDB from here.
 */
export function mountRomPanel(input: HTMLInputElement, out: HTMLElement): void {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    out.textContent = 'Reading...';
    const worker = new Worker(new URL('./romWorker.ts', import.meta.url), { type: 'module' });
    const buf = await file.arrayBuffer();
    worker.onmessage = (e: MessageEvent<{ ok: true; summary: RomSummary } | { ok: false; error: string }>) => {
      worker.terminate();
      if (!e.data.ok) {
        out.textContent = `Could not read ROM: ${e.data.error}`;
        return;
      }
      const s = e.data.summary;
      const rows = s.inventory
        .map((i) => `<tr><td>${esc(i.ext || '-')}</td><td>${esc(i.magic)}</td><td>${i.count}</td><td>${(i.bytes / 1024).toFixed(0)}K</td></tr>`)
        .join('');
      out.innerHTML = `
        <p><b>${esc(s.title)}</b> <code>${esc(s.gameCode)}</code><br/>
        ARM9 ${esc(s.arm9)}${s.arm9Compressed ? ', decompressed' : ''}<br/>
        ${s.overlays} overlays, ${s.files} files</p>
        <table><tr><th>ext</th><th>magic</th><th>n</th><th>size</th></tr>${rows}</table>`;
    };
    worker.postMessage(buf, [buf]);
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
