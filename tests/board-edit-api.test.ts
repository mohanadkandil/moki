import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createBoardService } from '../server/board-api.js';
import { generateBoardSource } from '../src/board/codegen.js';
import { contentId } from '../src/circuit/graph.js';

const fixture = resolve('docs/engineering/2026-11-04-realism/review/evidence/copper/temp-monitor');
async function setup(t: any, kind = 'design', overlap = false) {
  const root = await mkdtemp(join(tmpdir(), 'moki-edit-api-')), jobsRoot = join(root, 'jobs'), id = randomUUID();
  const dir = join(jobsRoot, id); await mkdir(dir, { recursive: true });
  const design = JSON.parse(await readFile(join(fixture, 'design.json'), 'utf8'));
  const source = generateBoardSource(design);
  const cj = JSON.parse(await readFile(join(fixture, 'circuit.json'), 'utf8'));
  if (overlap) {
    const s = cj.find((e: any) => e.type === 'source_component' && e.name === 'U2');
    const p = cj.find((e: any) => e.type === 'pcb_component' && e.source_component_id === s.source_component_id);
    p.center.x -= 30; p.footprint_origin.x -= 30;
    for (const e of cj.filter((e: any) => e.type === 'pcb_plated_hole' && e.pcb_component_id === p.pcb_component_id)) e.x -= 30;
  }
  await writeFile(join(dir, 'circuit.json'), JSON.stringify(cj));
  await writeFile(join(dir, 'board-metadata.json'), await readFile(join(fixture, 'board-metadata.json')));
  await writeFile(join(dir, 'board.tsx'), source); await writeFile(join(dir, 'design.json'), JSON.stringify(design));
  await writeFile(join(dir, 'job.json'), JSON.stringify({ jobId: id, status: 'done', createdAt: new Date().toISOString(), input: { kind, designContentId: contentId(design), sourceSha256: createHash('sha256').update(source).digest('hex') }, stages: [], artifacts: {} }));
  const bun = join(root, 'bun');
  await writeFile(bun, '#!/usr/bin/env node\nif(process.argv.some(x=>x.endsWith("versions.ts"))) console.log("{}"); else process.exitCode=1;\n', { mode: 0o755 });
  const service = createBoardService({ jobsRoot, bun });
  const server = createServer((req, res) => { void service.handle(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await service.idle(); await service.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); });
  const addr = server.address(); assert.ok(addr && typeof addr === 'object');
  const post = (body: unknown) => fetch(`http://127.0.0.1:${addr.port}/api/board/jobs`, { method: 'POST', body: JSON.stringify(body) });
  return { id, dir, design, source, service, post, jobsRoot };
}
const move = { placements: [{ refdes: 'U2', x: 19.85, y: 27.9, rotation: 0 }] };

test('invalid edit requests return plain 400 errors without admitting a child job', async t => {
  const f = await setup(t);
  const bad = [
    { edits: move }, { baseJobId: f.id, edits: { mystery: 1 } },
    ...[{ refdes: 'U2', x: 999, y: 0, rotation: 0 }, { refdes: 'U2', x: -14.15, y: 27.9, rotation: 0 }, { refdes: 'U99', x: 0, y: 0, rotation: 0 }, { refdes: 'U2', x: 0, y: 0 }].map(p => ({ baseJobId: f.id, edits: { placements: [p] } })),
    { baseJobId: f.id, edits: { board: { widthMm: 10, heightMm: 75, cornerRadiusMm: 3 } } },
    { baseJobId: f.id, source: f.source + '\n//changed', edits: move },
    { baseJobId: f.id, edits: move, extra: true },
  ];
  for (const body of bad) { const res = await f.post(body); assert.equal(res.status, 400); const value = await res.json() as any; assert.equal(typeof value.error, 'string'); assert.ok(value.error.length > 4); }
  assert.deepEqual((await readdir(f.jobsRoot)).filter(n => /^[a-f0-9-]{36}$/.test(n)), [f.id]);
});
for (const kind of ['design', 'source']) test(`${kind} base-only edits recover input and persist placement intent`, async t => {
  const f = await setup(t, kind); const response = await f.post({ baseJobId: f.id, edits: move });
  assert.equal(response.status, 202, await response.clone().text()); const { jobId } = await response.json() as any;
  await f.service.idle(); const job = await f.service.load(jobId); assert.ok(job);
  assert.equal(job.input.kind, kind); assert.equal(job.input.baseJobId, f.id); assert.deepEqual(job.input.edits, move); assert.match(job.input.layoutSha256!, /^[a-f0-9]{64}$/);
  assert.ok(job.editSummary?.some(x => /U2 moved 4 mm/.test(x)));
  assert.equal(await readFile(join(f.jobsRoot, jobId, 'board.tsx'), 'utf8'), f.source);
  if (kind === 'design') assert.deepEqual(JSON.parse(await readFile(join(f.jobsRoot, jobId, 'design.json'), 'utf8')), f.design);
  const layout = JSON.parse(await readFile(join(f.jobsRoot, jobId, 'layout.json'), 'utf8'));
  assert.deepEqual(layout.parts.find((p: any) => p.refdes === 'U2').center, { x: 19.85, y: 27.9 });
});
test('Fixer can repair a base whose module envelopes overlap', async t => {
  const f = await setup(t, 'design', true); const response = await f.post({ baseJobId: f.id, edits: move });
  assert.equal(response.status, 202, await response.text());
});
