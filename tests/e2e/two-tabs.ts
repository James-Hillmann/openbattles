/// <reference lib="dom" />
/**
 * Two browser tabs play the same online match through the real client and relay:
 * tab A hosts, tab B joins with the room code, both give orders, and their state
 * hashes must agree at every hash tick. Without a ROM both sides use the bare test
 * field, which is what CI runs. With OB_ROM set, both tabs load that dump and the host
 * picks a map, so the real map, lineups and combat data go through lockstep too.
 *
 *   npm run e2e
 *   OB_ROM=path/to/your.nds npm run e2e
 *
 * Screenshots land in out/e2e/ (gitignored).
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { startRelay } from '@lbw/server';

const RELAY_PORT = 18790;
const TICKS = 300;
const ROM = process.env.OB_ROM;
/** Point at a hosted build (`npm start`, a tunnel or Render) instead of starting the dev server and relay. */
const HOSTED = process.env.OB_URL;
/** Not the lobby default, so the map choice has to travel through the relay. */
const MAP = 'mp02';

interface Ob {
  tick(): number;
  hashAt(t: number): number | null;
  online(): boolean;
  local(): number;
  issueMove(x: number, y: number): void;
  issueEconomy(): void;
  units(): unknown[];
  desynced(): unknown;
}
const ob = <T>(page: Page, f: (o: Ob) => T) => page.evaluate(`(${f.toString()})(window.__ob)`) as Promise<T>;

async function main() {
  const relay = HOSTED ? null : startRelay({ port: RELAY_PORT });
  const vite = HOSTED ? null : await createServer({ root: 'client', server: { port: 0, strictPort: false }, logLevel: 'warn' });
  await vite?.listen();
  const url = HOSTED ?? `${vite!.resolvedUrls!.local[0]}?relay=ws://localhost:${RELAY_PORT}`;
  const browser = await chromium.launch();
  const fail = (msg: string) => {
    throw new Error(msg);
  };
  try {
    // Separate contexts = separate players (own storage), like two machines.
    const [a, b] = await Promise.all([1, 2].map(async () => (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()));
    for (const p of [a!, b!]) p.on('pageerror', (e) => console.error('page error:', e.message));
    await Promise.all([a!.goto(url), b!.goto(url)]);
    if (ROM) {
      for (const p of [a!, b!]) await p.setInputFiles('#rom', ROM);
      await Promise.all([a!, b!].map((p) => p.waitForSelector('#mapPick', { timeout: 120000 })));
    }

    await a!.fill('#mpName', 'Ann');
    await a!.click('#mpHost');
    const code = (await a!.textContent('#mpRoom', { timeout: 10000 }))!.trim();
    console.log('room', code);
    await b!.fill('#mpName', 'Bob');
    await b!.fill('#mpCode', code);
    await b!.click('#mpJoin');
    await b!.waitForSelector('#mpReady');
    if (ROM) {
      await a!.selectOption('#mpMap', MAP);
      await b!.waitForFunction((m) => document.querySelector('.mpSummary')?.textContent?.includes(m), MAP);
    }
    await b!.selectOption('#mpFaction', 'W');
    await b!.click('#mpReady');
    await a!.waitForSelector('#mpLaunch:not([disabled])');
    await a!.click('#mpLaunch');
    await Promise.all([a!, b!].map((p) => p.waitForFunction('window.__ob.online() && window.__ob.tick() > 0')));
    mkdirSync('out/e2e', { recursive: true });
    await a!.screenshot({ path: 'out/e2e/host-start.png' });
    const units = await Promise.all([a!, b!].map((p) => p.evaluate(() => (window as never as { __ob: { units(): unknown[] } }).__ob.units().length)));
    console.log('units on each side', units);
    if (units[0] !== units[1] || units[0]! < 2) fail(`expected matching faction lineups, got ${units}`);
    if ((await ob(a!, (o) => o.local())) !== 0 || (await ob(b!, (o) => o.local())) !== 1) fail('wrong player slots');

    // Tab B goes to the background: from here only its worker clock may drive its sim
    // (a really hidden tab gets no animation frames; here the render loop just stops ticking).
    await b!.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));`);
    // Both sides give orders while the match runs. With a ROM: train a Builder and chop a tree too.
    if (ROM) for (const p of [a!, b!]) await ob(p, (o) => o.issueEconomy());
    for (let i = 0; i < 4; i++) {
      await ob(a!, (o) => o.issueMove(400, 300));
      await ob(b!, (o) => o.issueMove(150, 120));
      await a!.waitForTimeout(700);
    }
    await Promise.all([a!, b!].map((p) => p.waitForFunction(`window.__ob.tick() >= ${TICKS}`, null, { timeout: 60000, polling: 500 })));

    mkdirSync('out/e2e', { recursive: true });
    await a!.screenshot({ path: 'out/e2e/host.png' });
    await b!.screenshot({ path: 'out/e2e/guest.png' });

    let compared = 0;
    for (let t = 30; t <= TICKS; t += 30) {
      const [x, y] = await Promise.all([a!, b!].map((p) => p.evaluate((tt) => (window as never as { __ob: Ob }).__ob.hashAt(tt), t)));
      if (x === null || y === null) fail(`no hash at tick ${t}`);
      if (x !== y) fail(`tick ${t}: host ${x} vs guest ${y}`);
      compared++;
    }
    if (await ob(a!, (o) => o.desynced())) fail('relay reported a desync');
    if (ROM) {
      const after = await Promise.all([a!, b!].map((p) => ob(p, (o) => o.units().length)));
      console.log('units on each side after training', after);
      if (after[0] !== after[1] || after[0]! < units[0]! + 2) fail(`expected a trained Builder per side, got ${after}`);
    }
    console.log(`two tabs agree on all ${compared} hashes through tick ${TICKS}`);
  } finally {
    await browser.close();
    await vite?.close();
    for (const c of relay?.clients ?? []) c.terminate();
    relay?.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
