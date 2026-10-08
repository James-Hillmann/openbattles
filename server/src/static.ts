import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/**
 * Serves the built client (client/dist) so one process hosts the page and the relay.
 * Only the Vite build output is served: no ROM or extracted data ever lives on the server,
 * players load their own dump in the browser.
 */
export function staticHandler(root: string): (req: IncomingMessage, res: ServerResponse) => void {
  const index = join(root, 'index.html');
  return (req, res) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(404).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) file = index;
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('client not built: run npm run build');
      return;
    }
    // Vite fingerprints everything under /assets; the page itself must always be fresh.
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
}
