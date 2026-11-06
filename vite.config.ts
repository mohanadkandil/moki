import { defineConfig, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { agentApi } from "./server/agent-api";
import { projectApi } from "./server/project-api";
import { boardApi } from "./server/board-api";
import { workshopApi } from "./server/workshop-api";

// Preview only: serve the review artifacts without copying local tooling or evidence
// receipts into the production application's public directory.
async function studyIndex(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/studies' && !url.pathname.startsWith('/studies/')) { next(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/studies(?:\/(?:drawer|ribbon|lamp))?$/.test(pathname)) {
      res.writeHead(307, { Location: `${pathname}/${url.search}` }); res.end(); return;
    }
    const directory = /^\/studies\/(?:drawer\/|ribbon\/|lamp\/)?$/.test(pathname);
    const relative = (directory ? `${pathname}index.html` : pathname).slice('/studies/'.length);
    const allowed = /^(?:index\.html|(?:ribbon|drawer|lamp)\/(?:index\.html|style\.css|app\.js|circuit\.js|persona\.js|fonts\/[A-Za-z0-9._-]+)|evidence\/[a-z0-9-]+\.png|contract\/screens\.json)$/;
    if (!allowed.test(relative)) { res.writeHead(404); res.end('Study asset not found.'); return; }
    const root = resolve(process.cwd(), 'docs/sprint-2026-11-01/design');
    const target = await realpath(resolve(root, relative));
    if (!target.startsWith(root + sep)) { res.writeHead(404); res.end('Study asset not found.'); return; }
    const bytes = await readFile(target);
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404); res.end('Study asset not found.');
  }
}
const studies: Plugin = {
  name: 'moki-study-index',
  configureServer(server) { server.middlewares.use((req, res, next) => { void studyIndex(req, res, next); }); },
  configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void studyIndex(req, res, next); }); },
};

export default defineConfig(({ command, isPreview }) => {
  const appBase = process.env.MOKI_BASE_PATH ?? (command === 'build' || isPreview ? '/app/moki/' : '/');
  if (appBase !== '/' && appBase !== '/app/moki/') throw new Error('MOKI_BASE_PATH must be / or /app/moki/');
  const publicHost = process.env.MOKI_PUBLIC_HOST;
  if (publicHost && !/^[a-zA-Z0-9.-]+$/.test(publicHost)) throw new Error('Invalid MOKI_PUBLIC_HOST');
  const allowedHosts = ['localhost', '127.0.0.1', ...(publicHost ? [publicHost] : [])];
  // Only production files and the board API belong on the private app link.
  // This hook runs before Vite's base middleware and the board plugin.
  const privatePreview: Plugin = {
    name: 'moki-private-preview',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        let hostname: string;
        try { hostname = new URL(`http://${req.headers.host ?? ''}`).hostname; }
        catch { res.writeHead(403); res.end(); return; }
        if (!allowedHosts.includes(hostname)) { res.writeHead(403); res.end(); return; }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const prefix = appBase === '/' ? '' : appBase.slice(0, -1);
        // The landing lives at the root, with a trailing slash so assets and links resolve the same way everywhere.
        if (appBase !== '/' && url.pathname === prefix) {
          res.writeHead(302, { Location: `${appBase}${url.search}` }); res.end(); return;
        }
        if (!url.pathname.startsWith(appBase)) { res.writeHead(404); res.end(); return; }
        const path = url.pathname.slice(prefix.length);
        if (path.startsWith('/api/board/') || path.startsWith('/api/agent/') || path === '/api/projects' || path.startsWith('/api/projects/')) {
          req.url = path + url.search; next(); return;
        }
        const staticPath = /^\/(?:|studio\/?|studio\/[0-9a-fA-F-]{36}|lab\/?|favicon\.svg|images\/[a-zA-Z0-9_-]+\.webp)$/.test(path) || /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?|ttf|png|svg|webp|jpe?g|ico|glb|bin)$/.test(path);
        if (!staticPath || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404); res.end(); return; }
        next();
      });
    },
  };

  return {
    root: "web",
    base: appBase,
    plugins: [privatePreview, studies, react(), boardApi(), agentApi(), projectApi(), workshopApi()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, allowedHosts },
    preview: { host: "127.0.0.1", port: 8847, strictPort: true, allowedHosts },
    build: { outDir: "../dist/web", emptyOutDir: true },
  };
});
