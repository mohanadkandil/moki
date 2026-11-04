// Stands in for the gateway: the built app under /app/moki/, /api/board/* forwarded to the live API. Nothing else.
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { resolve, extname } from 'node:path';
const ROOT = new URL('./dist-base/', import.meta.url).pathname, PREFIX = '/app/moki';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.wasm': 'application/wasm' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX + '/')) { res.writeHead(404); res.end('outside the mount'); return; }
  const path = url.pathname.slice(PREFIX.length);
  if (path.startsWith('/api/board/')) {
    const headers = { ...req.headers, host: '127.0.0.1:5173' }; if (headers.origin) headers.origin = 'http://127.0.0.1:5173';
    const up = http.request({ host: '127.0.0.1', port: 5173, method: req.method, path: path + url.search, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', e => { res.writeHead(502); res.end(String(e)); }); req.pipe(up); return;
  }
  if (path.startsWith('/api/')) { res.writeHead(403); res.end('not forwarded'); return; }
  const file = /\.[a-z0-9]+$/i.test(path) ? resolve(ROOT, '.' + path) : resolve(ROOT, 'index.html');
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(data); } catch { res.writeHead(404); res.end(); }
}).listen(8899, '127.0.0.1', () => console.log('mount up'));
