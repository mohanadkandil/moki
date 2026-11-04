import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, utimes, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { boardApi, createBoardService } from '../server/board-api.js';
const old = new Date(Date.now() - 8 * 86400_000);
const present = (file: string) => stat(file).then(() => true, () => false);
async function entry(path: string, stale = true) {
  await mkdir(path, { recursive: true }); await writeFile(join(path, 'artifact'), 'fixture');
  if (stale) await utimes(path, old, old);
  return path;
}

for (const name of ['board-jobs', 'board-jobs-app']) test(`${name}: app plugin maintains shared cache and unlocked test roots at startup and on history reads`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'moki-shared-maintenance-'));
  const jobsRoot = join(root, 'var', name), cache = join(root, 'var/mech-cache');
  const oldCache = await entry(join(cache, 'a'.repeat(64))), recentCache = await entry(join(cache, 'b'.repeat(64)), false);
  const oldTests = await entry(join(root, 'var/board-jobs-test-abandoned'));
  const activeTests = await entry(join(root, 'var/board-jobs-test-active'));
  await entry(join(activeTests, randomUUID())); await writeFile(join(activeTests, '.queue.lock'), JSON.stringify({ pid: process.pid })); await utimes(activeTests, old, old);
  const recentTests = await entry(join(root, 'var/board-jobs-test-recent'), false);
  const oldTestJob = await entry(join(recentTests, randomUUID()));
  const recentTestJob = await entry(join(recentTests, randomUUID()), false);
  const oldTestCache = await entry(join(recentTests, '_cache', 'c'.repeat(64)));
  const unrelated = await entry(join(root, 'var/unrelated-old-directory'));
  // Use the actual Vite plugin factory: its explicit shared-maintenance config must
  // also be enabled in configurePreviewServer with the deployed job-root layout.
  let middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  const plugin = boardApi({ root, jobsRoot });
  const configure = plugin.configurePreviewServer as unknown as (server: object) => void;
  configure({ httpServer: server, middlewares: { use(fn: typeof middleware) { middleware = fn; } } });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/board/jobs`;
  assert.equal((await fetch(url)).status, 200);
  for (const path of [oldCache, oldTests, oldTestJob, oldTestCache]) assert.equal(await present(path), false, path);
  for (const path of [recentCache, activeTests, recentTests, recentTestJob, unrelated]) assert.equal(await present(path), true, path);
  const addedCache = await entry(join(cache, 'd'.repeat(64)));
  const addedTests = await entry(join(root, 'var/board-jobs-test-later'));
  assert.equal((await fetch(url)).status, 200);
  assert.equal(await present(addedCache), false); assert.equal(await present(addedTests), false);
  assert.equal(await present(activeTests), true, 'An active test root remains excluded on subsequent eviction');
});

test('an isolated board service does not implicitly maintain unrelated shared data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moki-maintenance-opt-in-'));
  const cache = await entry(join(root, 'var/mech-cache', 'e'.repeat(64)));
  const tests = await entry(join(root, 'var/board-jobs-test-old'));
  const service = createBoardService({ root });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  await service.load(randomUUID());
  assert.equal(await present(cache), true); assert.equal(await present(tests), true);
});
