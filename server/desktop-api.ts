import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Sandbox } from '@daytona/sdk';
import { createSetupDaytonaClient } from '../scripts/lib/daytona-client.js';

const workers = { mechanical: 'moki-mechanical', electrical: 'moki-electrical' } as const;
type Role = keyof typeof workers;
type Frame = { image: Buffer; capturedAt: string; at: number };

/** Read-only local bridge: no sandbox credentials or control endpoints reach the browser. */
export function createDesktopApi() {
  const sandboxes = new Map<Role, { sandbox: Sandbox; at: number }>();
  const pendingSandboxes = new Map<Role, Promise<Sandbox>>();
  const pendingFrames = new Map<Role, Promise<Frame>>();
  const frames = new Map<Role, Frame>();

  async function sandboxFor(role: Role): Promise<Sandbox> {
    const cached = sandboxes.get(role);
    if (cached && Date.now() - cached.at < 60_000) return cached.sandbox;
    const pending = pendingSandboxes.get(role);
    if (pending) return pending;
    const request = (async () => {
      const sandbox = await (await createSetupDaytonaClient(true)).get(workers[role]);
      if (sandbox.state !== 'started') throw new Error('Desktop is not running');
      sandboxes.set(role, { sandbox, at: Date.now() });
      return sandbox;
    })();
    pendingSandboxes.set(role, request);
    try { return await request; }
    finally { pendingSandboxes.delete(role); }
  }

  async function capture(role: Role): Promise<Frame> {
    const pending = pendingFrames.get(role);
    if (pending) return pending;
    const recent = frames.get(role);
    // Coalesce viewers opened together; never serve stored run artifacts as a live feed.
    if (recent && Date.now() - recent.at < 700) return recent;
    const request = (async () => {
      const sandbox = await sandboxFor(role);
      const shot = await sandbox.computerUse.screenshot.takeFullScreen(true);
      const image = Buffer.from(shot.screenshot || '', 'base64');
      if (image.length < 8 || image.length > 12_000_000 ||
          !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error('Invalid desktop frame');
      }
      const frame = { image, capturedAt: new Date().toISOString(), at: Date.now() };
      frames.set(role, frame);
      return frame;
    })();
    pendingFrames.set(role, request);
    try { return await request; }
    finally { pendingFrames.delete(role); }
  }

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
      const match = /^\/desktops\/(mechanical|electrical)(\/frame)?$/.exec(path);
      if (!match) return false;
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        json(res, 405, { error: 'This desktop viewer is read-only.' });
        return true;
      }
      const origin = req.headers.origin;
      let crossOrigin = req.headers['sec-fetch-site'] === 'cross-site';
      if (origin) {
        try { crossOrigin ||= new URL(origin).host !== req.headers.host; }
        catch { crossOrigin = true; }
      }
      if (crossOrigin) {
        json(res, 403, { error: 'Open the desktop from your Moki workshop.' });
        return true;
      }
      const role = match[1] as Role;
      try {
        if (match[2]) {
          const frame = await capture(role);
          if (res.destroyed) return true;
          res.writeHead(200, {
            'Content-Type': 'image/png', 'Content-Length': frame.image.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Content-Type-Options': 'nosniff', 'X-Moki-Captured-At': frame.capturedAt,
          });
          res.end(frame.image);
        } else {
          const sandbox = await sandboxFor(role);
          const status = await sandbox.computerUse.getStatus();
          if (status.status !== 'active') throw new Error('Desktop is not active');
          // A fresh server-side screenshot bridge works without disclosing a VNC bearer URL.
          json(res, 200, { role, name: workers[role], mode: 'frames' });
        }
      } catch {
        sandboxes.delete(role);
        frames.delete(role);
        if (!res.destroyed) json(res, 503, {
          error: 'The live desktop is unavailable. Check that the Daytona worker and desktop are running, then reconnect.',
        });
      }
      return true;
    },
  };
}
