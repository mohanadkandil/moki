import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBoardService, runBoardProcess } from '../server/board-api.js';

async function fixture(t: test.TestContext, options: Parameters<typeof createBoardService>[0] = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'moki-board-security-'));
  const service = createBoardService({ jobsRoot: join(dir, 'jobs'), ...options });
  const server = createServer((req, res) => { void service.handle(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await service.close(); await rm(dir, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  return { dir, service, base: `http://127.0.0.1:${address.port}` };
}

test('every board endpoint requires a capability when configured, including files and unknown endpoints', async t => {
  const previous = process.env.MOKI_BOARD_API_TOKEN;
  process.env.MOKI_BOARD_API_TOKEN = 'test-private-capability';
  const { base } = await fixture(t);
  if (previous === undefined) delete process.env.MOKI_BOARD_API_TOKEN; else process.env.MOKI_BOARD_API_TOKEN = previous;
  for (const path of ['/api/board/jobs', `/api/board/jobs/${randomUUID()}`, `/api/board/jobs/${randomUUID()}/files/pcb.svg`, '/api/board/unknown']) {
    for (const capability of [undefined, '', 'wrong', 'test-private-capability-extra']) {
      const response = await fetch(base + path, { headers: capability === undefined ? {} : { 'X-Moki-Capability': capability } });
      assert.equal(response.status, 401, path);
    }
  }
  assert.equal((await fetch(base + '/api/board/jobs', { headers: { 'X-Moki-Capability': 'test-private-capability' } })).status, 200);
  assert.equal((await fetch(base + '/api/board/jobs', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/api/board/jobs', { method: 'POST', headers: { 'X-Moki-Capability': 'test-private-capability', Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
});

test('TSX cannot read an arbitrary inherited parent environment value', { timeout: 30_000 }, async t => {
  const { service } = await fixture(t);
  process.env.MOKI_TEST_PARENT_SECRET = 'do-not-inherit';
  try {
    const job = await service.submit({ source: 'throw new Error("ENV_PROBE:" + (process.env.MOKI_TEST_PARENT_SECRET ?? "absent")); export default function Board() {}' });
    await service.idle();
    assert.equal(job.status, 'failed');
    assert.match(job.error!, /ENV_PROBE:absent/);
    assert.ok(!job.error!.includes('do-not-inherit'));
  } finally { delete process.env.MOKI_TEST_PARENT_SECRET; }
});

test('escaped grandchild retaining stdout cannot wedge a process timeout or the next worker', { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-escaped-'));
  const pidFile = join(dir, 'escaped.pid');
  try {
    const start = performance.now();
    await assert.rejects(runBoardProcess('/bin/sh', ['-c', 'setsid sh -c \'echo $$ > "$1"; exec sleep 30\' sh "$1" & wait', 'sh', pidFile], process.cwd(), 250), /timed out/);
    assert.ok(performance.now() - start < 2000, 'Must settle without waiting for escaped stdout holder');
    assert.equal((await runBoardProcess(process.execPath, ['-e', 'console.log("next worker")'], process.cwd())).stdout.trim(), 'next worker');
  } finally {
    try { process.kill(-Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});

test('an escaped TSX grandchild times out and the actual board queue continues', { timeout: 30_000 }, async t => {
  const { dir, service } = await fixture(t, { timeoutMs: 3000 });
  const pidFile = join(dir, 'escaped-job.pid');
  try {
    const hanging = await service.submit({ source: `import {spawn} from 'node:child_process'; spawn('setsid', ['sh', '-c', 'echo $$ > "$1"; exec sleep 30', 'sh', ${JSON.stringify(pidFile)}], {stdio:['ignore',1,2]}); await new Promise(()=>{}); export default function Board(){}` });
    const next = await service.submit({ source: 'throw new Error("QUEUE_CONTINUED"); export default function Board(){}' });
    const start = performance.now(); await service.idle();
    assert.ok(performance.now() - start < 10000);
    assert.ok(Number(await readFile(pidFile, 'utf8')) > 0, 'The escaped grandchild actually ran');
    assert.equal(hanging.status, 'failed'); assert.match(hanging.error!, /timed out/);
    assert.equal(next.status, 'failed'); assert.match(next.error!, /QUEUE_CONTINUED/);
  } finally { try { process.kill(-Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch {} }
});

test('queue admits at most five waiting jobs and returns HTTP 429', { timeout: 30_000 }, async t => {
  const { service, base } = await fixture(t, { timeoutMs: 1500 });
  await service.submit({ source: 'await new Promise(()=>{}); export default function Board(){}' });
  // Wait until the first job leaves the waiting count.
  await new Promise(done => setTimeout(done, 50));
  const responses = await Promise.all(Array.from({ length: 7 }, () => fetch(base + '/api/board/jobs', {
    method: 'POST', body: JSON.stringify({ source: 'throw new Error("queued test"); export default function Board(){}' }),
  })));
  assert.equal(responses.filter(r => r.status === 202).length, 5);
  assert.equal(responses.filter(r => r.status === 429).length, 2);
  await service.close();
});

test('root lock excludes a second service, restart failure is persisted, and shutdown kills workers', { timeout: 15_000 }, async t => {
  const { dir, service } = await fixture(t);
  const id = randomUUID(), jobDir = join(service.jobsRoot, id);
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, 'job.json'), JSON.stringify({ jobId: id, status: 'running', artifacts: {} }));
  assert.equal((await service.load(id))?.status, 'failed');
  assert.equal(JSON.parse(await readFile(join(jobDir, 'job.json'), 'utf8')).status, 'failed');
  const other = createBoardService({ jobsRoot: service.jobsRoot });
  await assert.rejects(other.submit({ source: 'x' }), /Another board service/);
  const pidFile = join(dir, 'worker.pid');
  const nestedPidFile = join(dir, 'nested.pid');
  const active = await service.submit({ source: `import {writeFileSync} from 'node:fs'; import {runWorker} from ${JSON.stringify(join(process.cwd(), 'src/board/process.ts'))}; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await runWorker('/bin/sh', ['-c', 'echo $$ > "$1"; sleep 30', 'sh', ${JSON.stringify(nestedPidFile)}], process.cwd(), 30000); export default function Board(){}` });
  for (let i = 0; i < 200; i++) { if (await readFile(nestedPidFile).then(() => true, () => false)) break; await new Promise(done => setTimeout(done, 20)); }
  const pid = Number(await readFile(pidFile, 'utf8'));
  const nestedPid = Number(await readFile(nestedPidFile, 'utf8'));
  await service.close();
  assert.equal(active.status, 'failed');
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise(done => setTimeout(done, 10)); }
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  const nestedState = await readFile(`/proc/${nestedPid}/stat`, 'utf8').catch(() => '');
  assert.ok(!nestedState || /\) Z /.test(nestedState), 'Ordinary nested toolchain process must be gone or dead');
  assert.ok(await other.load(id)); await other.close();
});

test('a stale root lock is reclaimed by only one competing process', { timeout: 15_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-stale-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, '.queue.lock'), JSON.stringify({ pid: 2147483647, token: 'dead-owner' }));
  const script = `import {createBoardService} from './server/board-api.ts'; const s=createBoardService({jobsRoot:${JSON.stringify(dir)}}); try {await s.load('${randomUUID()}'); console.log('CLAIMED'); await new Promise(r=>setTimeout(r,1000));} catch(e) {console.log('REJECTED:'+e.message);} finally {await s.close();}`;
  const results = await Promise.all([0, 1].map(() => runBoardProcess(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], process.cwd())));
  assert.equal(results.filter(r => r.stdout.includes('CLAIMED')).length, 1);
  assert.equal(results.filter(r => r.stdout.includes('REJECTED:')).length, 1);
});

test('seven-day eviction removes old jobs and cache entries and preserves recent jobs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-eviction-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const jobsRoot = join(dir, 'jobs'), oldId = randomUUID(), recentId = randomUUID();
  const old = new Date(Date.now() - 8 * 86400_000);
  for (const name of [oldId, recentId, `_cache/${'a'.repeat(64)}`]) {
    const entry = join(jobsRoot, name); await mkdir(entry, { recursive: true });
    await writeFile(join(entry, 'job.json'), JSON.stringify({ jobId: name, status: 'done' }));
    if (name !== recentId) { await utimes(join(entry, 'job.json'), old, old); await utimes(entry, old, old); }
  }
  const service = createBoardService({ jobsRoot }); t.after(() => service.close());
  assert.equal(await service.load(oldId), null);
  assert.ok(await service.load(recentId));
  await assert.rejects(readFile(join(jobsRoot, '_cache', 'a'.repeat(64), 'job.json')), /ENOENT/);
});
