import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, readdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { boardApi, createBoardService } from '../server/board-api.js';
import type { BoardPlan } from '../src/blocks/contract.js';
const jobDirs = async (root: string) =>
  (await readdir(root).catch(() => [])).filter((n) => /^[a-f0-9-]{36}$/.test(n));
test('actual production-preview plugin rejects source and source-only history before making a job', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'moki-chip-preview-')),
    jobsRoot = join(root, 'jobs');
  let middleware!: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  const plugin = boardApi({ root, jobsRoot, allowSource: true, bun: '/definitely-not-a-renderer' });
  (plugin.configurePreviewServer as unknown as (server: object) => void)({
    httpServer: server,
    middlewares: {
      use(fn: typeof middleware) {
        middleware = fn;
      },
    },
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/board/jobs`;
  // Harmless marker text; this test never reads a private file or executes the submitted source.
  const source = 'throw new Error("SOURCE_MUST_NOT_RUN")';
  let r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Raw TSX source builds are disabled/);
  assert.deepEqual(await jobDirs(jobsRoot), []);
  const id = randomUUID();
  await mkdir(join(jobsRoot, id));
  await writeFile(join(jobsRoot, id, 'board.tsx'), source);
  await writeFile(
    join(jobsRoot, id, 'job.json'),
    JSON.stringify({ jobId: id, status: 'done', input: { kind: 'source' } }),
  );
  r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseJobId: id }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Raw TSX source builds are disabled/);
  assert.deepEqual(await jobDirs(jobsRoot), [id]);
});
test('invalid and mixed plan submissions create no job', async (t) => {
  const jobsRoot = await mkdtemp(join(tmpdir(), 'moki-chip-invalid-')),
    service = createBoardService({ jobsRoot, allowSource: false, bun: '/does-not-run' });
  t.after(async () => {
    await service.close();
    await rm(jobsRoot, { recursive: true, force: true });
  });
  const plan = JSON.parse(await readFile(resolve('src/blocks/data/spike-plan.json'), 'utf8')) as BoardPlan;
  await assert.rejects(service.submit({ plan, source: 'bad' }), /exactly one/);
  await assert.rejects(service.submit({ plan: null as unknown as BoardPlan }), /JSON board plan/);
  await assert.rejects(service.submit({ plan: { ...plan, mechanical: {} } as BoardPlan }), /unknown/);
  await assert.rejects(
    service.submit({
      plan: {
        ...plan,
        blocks: [...plan.blocks, { ...plan.blocks[0]!, inst: 'duplicate', block: 'made-up' }],
      },
    }),
    /Requested block revision is unavailable/,
  );
  await assert.rejects(
    service.submit({ plan, edits: { board: { widthMm: 60, heightMm: 70, cornerRadiusMm: 0 } } }),
    /baseJobId/,
  );
  assert.deepEqual(await jobDirs(jobsRoot), []);
});
test('validated data-only plan is accepted under production source refusal, but no review means no render or done', async (t) => {
  const jobsRoot = await mkdtemp(join(tmpdir(), 'moki-chip-submission-')),
    service = createBoardService({ jobsRoot, allowSource: false, bun: '/must-not-render-without-review' });
  t.after(async () => {
    await service.close();
    await rm(jobsRoot, { recursive: true, force: true });
  });
  const plan = JSON.parse(await readFile(resolve('src/blocks/data/spike-plan.json'), 'utf8')) as BoardPlan;
  // Real seed RC profile runs before review. No review receipt is issued.
  plan.title = 'Unreviewed API fixture ' + randomUUID();
  const job = await service.submit({ plan });
  assert.equal(job.input.kind, 'plan');
  assert.deepEqual(job.input.plan, plan);
  await service.idle();
  const loaded = await service.load(job.jobId);
  assert.equal(loaded?.status, 'failed');
  assert.match(loaded?.error ?? '', /independent.*review|review.*independent/i);
  assert.equal(loaded?.gates?.find((g) => g.gate === 'spice')?.ok, true);
  assert.equal(loaded?.drc.checked, false);
  assert.ok(!loaded?.stages.some((s) => s.name === 'route'));
  assert.deepEqual(await readFile(join(jobsRoot, job.jobId, 'plan.json'), 'utf8').then(JSON.parse), plan);
});
