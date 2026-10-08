import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRelay, staticHandler } from '@lbw/server';
import type { ServerMsg } from '@lbw/server/protocol';

/** The hosted setup: one HTTP server serves the built page and carries the relay on /relay. */
const dist = mkdtempSync(join(tmpdir(), 'ob-dist-'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>OpenBattles</title>');
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'assets', 'main-abc123.js'), 'console.log(1)');
writeFileSync(join(tmpdir(), 'ob-secret.txt'), 'outside dist');

const server = createServer(staticHandler(dist));
const wss = startRelay({ server });
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as AddressInfo).port;
afterAll(() => new Promise<void>((r) => {
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.close(() => r());
}));

/** Raw path (no URL normalization by fetch) so traversal attempts reach the handler as sent. */
function get(path: string): Promise<{ status: number; type?: string; cache?: string; body: string }> {
  return new Promise((resolve, reject) => {
    request({ port, path }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode!, type: res.headers['content-type'], cache: res.headers['cache-control'], body }));
    }).on('error', reject).end();
  });
}

describe('hosting server', () => {
  it('serves the page, hashed assets and a health check', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    expect(page.cache).toBe('no-cache');
    const js = await get('/assets/main-abc123.js');
    expect(js.type).toContain('text/javascript');
    expect(js.cache).toContain('immutable');
    expect((await get('/healthz')).body).toBe('ok');
  });

  it('falls back to the page for unknown paths and never leaves dist', async () => {
    expect((await get('/lobby')).body).toContain('OpenBattles');
    for (const p of ['/../ob-secret.txt', '/%2e%2e/ob-secret.txt', '/assets/..%2f..%2fob-secret.txt']) {
      expect((await get(p)).body).not.toContain('outside dist');
    }
    expect((await get('/%E0%A4%A')).status).toBe(400);
  });

  it('accepts relay connections on /relay of the same port', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/relay`);
    const msg = await new Promise<ServerMsg>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ t: 'host', rom: 'test', name: 'A' })));
      ws.on('message', (d) => resolve(JSON.parse(String(d))));
      ws.on('error', reject);
    });
    ws.close();
    expect(msg.t).toBe('lobby');
  });
});
