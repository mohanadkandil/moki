import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBoardService } from '../server/board-api.js';
import { layoutForDesign } from '../src/board/edits.js';
import { CATALOG } from '../src/circuit/catalog.js';

test('real maker edits reroute, move case apertures, rotate asymmetric parts and reuse firmware', { timeout: 900_000 }, async t => {
  const fixture = resolve('docs/engineering/2026-11-04-realism/review/evidence/copper/temp-monitor');
  const evidence = resolve('docs/engineering/2026-11-04-canvas-tools/evidence/edit_core');
  // A dedicated, exclusively locked test root retains deterministic native caches.
  // Repeated full-suite runs need not recompile the same firmware on this shared host.
  const service = createBoardService({ jobsRoot: resolve('var/board-jobs-test-maker') });
  t.after(() => service.close());
  await mkdir(evidence, {recursive:true}); const catalog = join(evidence,'catalog.json'); await writeFile(catalog,JSON.stringify(Object.fromEntries(CATALOG)));
  const design = JSON.parse(await readFile(join(fixture, 'design.json'), 'utf8'));
  const run = async (input: Parameters<typeof service.submit>[0], label: string) => {
    const job = await service.submit(input); await service.idle();
    assert.equal(job.status, 'done', `${label}: ${job.error}`); assert.deepEqual(job.drc.errors, [], label);
    assert.ok(job.board.traceCount > 0, label);
    const dir = resolve(service.jobsRoot, job.jobId);
    const fit = JSON.parse(await readFile(join(dir, 'enclosure.json'), 'utf8'));
    assert.deepEqual(fit.validation.failures, [], `${label}: case fit`);
    const oracle = spawnSync('python3', ['tests/board-connectivity.py', dir, catalog], { encoding: 'utf8' });
    assert.equal(oracle.status, 0, `${label}: ${oracle.stdout}\n${oracle.stderr}`);
    const keep = join(evidence, label); await mkdir(keep, { recursive: true });
    await writeFile(join(keep,'copper.log'),oracle.stdout + oracle.stderr);
    for (const file of ['job.json','circuit.json','board-metadata.json','pcb.svg','board.glb','assembly.glb','enclosure.json','mech-handoff.json','firmware-build.json','receipt.json']) await copyFile(join(dir,file),join(keep,file));
    if (job.input.edits) for (const file of ['layout.json','manual-edits.json']) await copyFile(join(dir,file),join(keep,file));
    if (job.input.edits) { const manual = JSON.parse(await readFile(join(dir,'manual-edits.json'),'utf8')); assert.ok(manual.routing.invocations > 0); assert.equal(manual.routing.minimumClearanceMm,.2); }
    return { job, dir, fit, firmware: JSON.parse(await readFile(join(dir,'firmware-build.json'),'utf8')) };
  };
  const before = await run({ design }, 'before');
  // A compact board has little room to spare. The screen has 3 mm free above it.
  const startedAt = (refdes: string) => layoutForDesign(design).parts.find(p => p.refdes === refdes)!;
  const screen = startedAt('U2'), sounder = startedAt('BZ1');
  const moved = await run({ baseJobId: before.job.jobId, edits: { placements: [{ refdes: 'U2', x: screen.center.x, y: screen.center.y + 3, rotation: 0 }] } }, 'moved');
  assert.equal(moved.job.input.kind, 'design');
  assert.equal(moved.firmware.compiled, true); assert.equal(moved.firmware.cache, 'hit');
  const aperture = (fit: any) => fit.apertures.find((a: any) => a.id === 'U2-display-active-area');
  assert.equal(Math.round((aperture(moved.fit).position.y - aperture(before.fit).position.y) * 100), 300);
  assert.notEqual(moved.job.artifacts['enclosure-lid.stl']!.sha256, before.job.artifacts['enclosure-lid.stl']!.sha256);
  assert.equal(await readFile(join(moved.dir, 'board.tsx'), 'utf8'), await readFile(join(before.dir, 'board.tsx'), 'utf8'));
  const repeated = await run({ baseJobId: before.job.jobId, edits: moved.job.input.edits }, 'repeated');
  assert.equal(repeated.job.cache, 'hit'); assert.equal(repeated.firmware.cache, 'hit');
  assert.equal(repeated.job.artifacts['board.glb']!.sha256, moved.job.artifacts['board.glb']!.sha256);
  const rotated = await run({ baseJobId: moved.job.jobId, edits: { placements: [{ refdes: 'BZ1', x: sounder.center.x, y: sounder.center.y, rotation: 90 }] } }, 'rotated');
  const cj = JSON.parse(await readFile(join(rotated.dir,'circuit.json'),'utf8'));
  const buzzer = cj.find((e: any) => e.type === 'source_component' && e.name === 'BZ1');
  const p = cj.find((e: any) => e.type === 'pcb_component' && e.source_component_id === buzzer.source_component_id);
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, `${JSON.stringify(a)} is not ${JSON.stringify(b)}`);
  near(p.center, sounder.center); near(p.footprint_origin, { x: sounder.center.x - 6.5, y: sounder.center.y }); assert.equal(p.rotation, 90);
  const resized = await run({ baseJobId: rotated.job.jobId, edits: { board: { widthMm: 120, heightMm: 120, cornerRadiusMm: 7 }, usbEdge: 'left' } }, 'resized-left');
  assert.equal(resized.job.board.widthMm,120); assert.equal(resized.fit.dimensions.boardCornerRadiusMm,7);
  assert.equal(resized.fit.apertures.find((a: any) => a.id === 'U1-usb').face,'x_neg');
  assert.equal(resized.firmware.cache,'hit');
  assert.equal(JSON.parse(await readFile(join(before.dir,'job.json'),'utf8')).input.baseJobId,undefined);
  await writeFile(join(evidence,'integration-jobs.json'),JSON.stringify({ jobsRoot: service.jobsRoot, before: before.job.jobId, moved: moved.job.jobId, rotated: rotated.job.jobId, resized: resized.job.jobId },null,2));
});
