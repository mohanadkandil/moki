import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createServer, request } from 'node:http';
import { readFile, rename, symlink, unlink, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CATALOG } from '../src/circuit/catalog.js';
import { submitBrief, EMPTY_SESSION } from '../src/circuit/session.js';
import { generateBoardSource, boardMetadata } from '../src/board/codegen.js';
import { footprintFor } from '../src/board/catalog-footprints.js';
import { createBoardService, runBoardProcess } from '../server/board-api.js';

function design(brief = 'a focus timer with buzzer') {
  const result = submitBrief(EMPTY_SESSION, brief);
  assert.equal(result.outcome.kind, 'created');
  if (result.outcome.kind !== 'created') throw new Error('Invalid test brief');
  return result.outcome.revision.design;
}
test('every catalog pin maps exactly once and preserves catalog physical spacing and polarity', () => {
  for (const m of CATALOG.values()) {
    const f = footprintFor(m.id);
    assert.deepEqual(f.pins.map(p => p.id).sort(), m.pins.map(p => p.id).sort());
    assert.equal(new Set(f.pins.map(p => p.number)).size, m.pins.length);
    for (const [i, p] of m.pins.entries()) {
      assert.equal(f.pinLabels[`pin${i + 1}`], p.id);
      assert.ok(Math.abs(f.pins[i]!.x - (p.physical.x - m.size.w / 2)) < 0.001);
      assert.ok(Math.abs(f.pins[i]!.y - (m.size.h / 2 - p.physical.y)) < 0.001);
    }
  }
});
test('codegen is deterministic under array reordering; settings alter content identity', () => {
  const d = design(); const source = generateBoardSource(d);
  assert.equal(source, generateBoardSource(structuredClone(d)));
  assert.equal(source, generateBoardSource({ ...d, parts: [...d.parts].reverse(), nets: [...d.nets].reverse().map(n => ({ ...n, endpoints: [...n.endpoints].reverse() })) }));
  assert.notEqual(source, generateBoardSource(design('a focus timer for 40 minutes with buzzer')));
  assert.equal(boardMetadata(d).mountingHoles.length, 4);
  assert.equal(boardMetadata(d).layers, 2);
  const lamp = design('a light lamp');
  assert.deepEqual(boardMetadata(lamp).parts.filter(p => p.module === 'resistor-axial').map(p => p.value), ['10 kΩ', '150 Ω']);
  assert.match(generateBoardSource(lamp), /150 Ω/);
});
test('generated TSX safely encodes quoted roles and keeps sanitized net names distinct', () => {
  const d = design();
  d.parts[0]!.role = 'Runs "quoted" <plain> & text';
  d.nets[2]!.name = 'signal/a'; d.nets[3]!.name = 'signal_a';
  const source = generateBoardSource(d);
  const output = ts.transpileModule(source, { fileName: 'board.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.deepEqual(output.diagnostics, []);
  const names = [...source.matchAll(/<net name=\{("[^"\n]*")\}/g)].map(m => JSON.parse(m[1]!));
  assert.equal(names.length, d.nets.length);
  assert.equal(new Set(names).size, d.nets.length);
});
test('subprocess timeout kills its process group', async () => {
  await assert.rejects(runBoardProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], process.cwd(), 50), /timed out.*process group killed/);
});
test('real board job API: focus timer renders, routes, serves hashed artifacts and reuses cache', { timeout: 360_000 }, async t => {
  const service = createBoardService({ jobsRoot: resolve('var/board-jobs-test') });
  t.after(() => service.close());
  const server = createServer((req, res) => { void service.handle(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/board/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design: design() }) });
  assert.equal(response.status, 202);
  const { jobId } = await response.json() as { jobId: string };
  const terminalPoll = (async () => {
    for (;;) {
      const state = await fetch(`${base}/api/board/jobs/${jobId}`).then(r => r.json()) as Awaited<ReturnType<typeof service.submit>>;
      if (state.status === 'done' || state.status === 'failed') return state;
      await new Promise(done => setTimeout(done, 10));
    }
  })();
  await service.idle();
  const jobResponse = await fetch(`${base}/api/board/jobs/${jobId}`);
  const job = await jobResponse.json() as Awaited<ReturnType<typeof service.submit>>;
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual((await terminalPoll).artifacts, job.artifacts, 'The first terminal poll contains every final artifact and its final hash');
  await assert.rejects(stat(resolve(service.jobsRoot, jobId, 'firmware/.pio')), /ENOENT/);
  assert.deepEqual(job.drc.errors, []);
  assert.ok(job.board.traceCount > 0);
  assert.equal(job.board.layers, 2);
  for (const name of ['board.tsx','circuit.json','schematic.svg','pcb.svg','board.glb','gerbers.zip','kicad.zip','bom.csv','pnp.csv','receipt.json']) {
    assert.ok(job.artifacts[name], `${name} missing`);
    const artifact = await fetch(base + job.artifacts[name]!.url);
    assert.equal(artifact.status, 200); assert.equal(artifact.headers.get('cache-control'), 'no-store');
    assert.equal((await artifact.arrayBuffer()).byteLength, job.artifacts[name]!.bytes);
  }
  const glb = await readFile(resolve(service.jobsRoot, jobId, 'board.glb'));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  const cj = JSON.parse(await readFile(resolve(service.jobsRoot, jobId, 'circuit.json'), 'utf8')) as Record<string, any>[];
  assert.equal(cj.filter(e => e.type === 'cad_component' && e.model_jscad).length, design().parts.length);
  const netIds = new Set<string>();
  for (const net of design().nets) {
    const ids = net.endpoints.map(end => {
      const p = design().parts.find(p => p.id === end.part)!;
      const component = cj.find(e => e.type === 'source_component' && e.name === end.part)!;
      const pinNumber = CATALOG.get(p.module)!.pins.findIndex(pin => pin.id === end.pin) + 1;
      const port = cj.find(e => e.type === 'source_port' && e.source_component_id === component.source_component_id && e.pin_number === pinNumber)!;
      assert.ok(port, `${end.part}.${end.pin} must exist in the rendered graph`);
      const connections = cj.filter(e => e.type === 'source_trace' && e.connected_source_port_ids?.includes(port.source_port_id));
      assert.equal(connections.length, 1, `${end.part}.${end.pin} must join exactly one net`);
      return connections[0]!.connected_source_net_ids[0] as string;
    });
    assert.equal(new Set(ids).size, 1, `${net.name} must retain all of its endpoints`);
    netIds.add(ids[0]!);
  }
  assert.equal(netIds.size, design().nets.length, 'Different graph nets must stay electrically separate');
  assert.match(await readFile(resolve(service.jobsRoot, jobId, 'schematic.svg'), 'utf8'), /viewBox="0 0/);
  if (job.stages.some(s => s.name === 'enclosure' && s.status === 'done')) for (const name of ['enclosure-base.stl','enclosure-lid.stl','assembly.glb','enclosure.json']) assert.ok(job.artifacts[name], name);
  if (job.stages.some(s => s.name === 'firmware' && s.status === 'done')) for (const name of ['firmware.zip', 'firmware-build.json']) assert.ok(job.artifacts[name], name);
  const cached = await service.submit({ design: design() }); await service.idle();
  assert.equal(cached.status, 'done', cached.error); assert.equal(cached.cache, 'hit');
  assert.equal(cached.artifacts['board.glb']!.sha256, job.artifacts['board.glb']!.sha256);
  const traversal = await new Promise<number>(done => { const req = request(`${base}/api/board/jobs/${jobId}/files/%2e%2e%2fpackage.json`, res => {res.resume(); done(res.statusCode!);}); req.end(); });
  assert.equal(traversal, 400);
  assert.equal((await fetch(`${base}/api/board/jobs/${jobId}/files/job.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/board/jobs/${jobId}/files/unknown.json`)).status, 404);
  const svgPath = resolve(service.jobsRoot, jobId, 'pcb.svg');
  await rename(svgPath, svgPath + '.original');
  try {
    await symlink(resolve('package.json'), svgPath);
    assert.equal((await fetch(`${base}/api/board/jobs/${jobId}/files/pcb.svg`)).status, 404);
  } finally { await unlink(svgPath); await rename(svgPath + '.original', svgPath); }
  const invalid = await fetch(`${base}/api/board/jobs`, { method: 'POST', body: JSON.stringify({ source: 'x', design: design() }) }); assert.equal(invalid.status, 400);
  const foreignOrigin = await fetch(`${base}/api/board/jobs`, { method: 'POST', headers: { Origin: 'https://foreign.example' }, body: JSON.stringify({ source: 'x' }) }); assert.equal(foreignOrigin.status, 403);
  const unicodeSource = 'throw new Error("☕ unicode source test"); export default function Board() {}';
  const payload = Buffer.from(JSON.stringify({ source: unicodeSource }));
  const split = payload.indexOf(Buffer.from('☕')) + 1;
  const posted = await new Promise<{ jobId: string }>((done, fail) => {
    const req = request(`${base}/api/board/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let response = ''; res.on('data', chunk => response += chunk.toString()); res.on('end', () => done(JSON.parse(response)));
    });
    req.on('error', fail); req.write(payload.subarray(0, split));
    setTimeout(() => req.end(payload.subarray(split)), 5);
  });
  assert.equal(await readFile(resolve(service.jobsRoot, posted.jobId, 'board.tsx'), 'utf8'), unicodeSource);
  await service.idle();
  const bad = await service.submit({ source: 'throw new Error("test edited TSX failure"); export default function Board() {}' });
  await service.idle(); assert.equal(bad.status, 'failed'); assert.equal(bad.drc.checked, false); assert.match(bad.error!, /test edited TSX failure/);
  const unroutable = await service.submit({ source: 'export default function Board() { return <board width={4} height={4}><chip name="U1" footprint="dip38" /></board>; }' });
  await service.idle();
  assert.equal(unroutable.status, 'done', unroutable.error);
  assert.ok(unroutable.drc.errors.some(e => /outside_board/.test(e.type)));
  assert.ok(unroutable.artifacts['pcb.svg']);
  const recovered = await service.submit({ source: await readFile(resolve(service.jobsRoot, jobId, 'board.tsx'), 'utf8') }); await service.idle();
  assert.equal(recovered.status, 'done', recovered.error);
  assert.ok(recovered.stages.some(s => s.name === 'firmware' && s.status === 'skipped' && /Edited TSX/.test(s.note ?? '')));
});
