// @ts-nocheck -- Runs under Node with `npx tsx --test web/src/board/logic.test.ts`. The web tsconfig has no Node types.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileState, drcRan, groupedNotes, hideLayersCss, jobToDisplay, prepareSvg, timingCells, unattributedMs } from './logic';
import { readZip } from './zip';

const job = (over = {}) => ({ jobId: 'j', status: 'done', stages: [], ...over });
const art = { url: 'u', bytes: 1, sha256: 'x', kind: 'json' };

test('a job that crashed before rendering is not a clean DRC pass', () => {
  // The API seeds every job with empty drc arrays, which must not read as "0 errors".
  const crashed = job({ status: 'failed', drc: { errors: [], warnings: [] }, stages: [{ name: 'codegen', status: 'skipped', ms: 0 }] });
  assert.equal(drcRan(crashed), false);
  const running = job({ status: 'running', drc: { errors: [], warnings: [] }, stages: [{ name: 'codegen', status: 'done', ms: 1 }] });
  assert.equal(drcRan(running), false);
  const rendered = job({ drc: { errors: [], warnings: [] }, stages: [{ name: 'render', status: 'done', ms: 400 }] });
  assert.equal(drcRan(rendered), true);
  const failedRender = job({ status: 'failed', drc: { errors: [], warnings: [] }, stages: [{ name: 'render', status: 'failed', ms: 9 }] });
  assert.equal(drcRan(failedRender), false);
  // The API's explicit flag wins over the inference from stages.
  assert.equal(drcRan(job({ drc: { errors: [], warnings: [], checked: false }, stages: [{ name: 'render', status: 'done', ms: 4 }] })), false);
  assert.equal(drcRan(job({ drc: { errors: [], warnings: [], checked: true }, stages: [] })), true);
});

test('compile state never infers success from a generated zip', () => {
  assert.equal(compileState(job({ artifacts: { 'firmware.zip': art } })).kind, 'not-compiled');
  assert.deepEqual(compileState(job({ stages: [{ name: 'firmware-compile', status: 'skipped', ms: 0, note: 'no PlatformIO' }] })), { kind: 'not-compiled', reason: 'no PlatformIO' });
  assert.equal(compileState(job({ stages: [{ name: 'firmware-compile', status: 'failed', ms: 5, note: 'timed out' }] })).kind, 'failed');
  assert.equal(compileState(job({ stages: [{ name: 'firmware-compile', status: 'done', ms: 5 }] })).kind, 'compiled');
  assert.equal(compileState(job({ status: 'running' })).kind, 'pending');
  // Edited source: the firmware stage's own reason reaches the maker.
  assert.deepEqual(compileState(job({ stages: [{ name: 'firmware', status: 'skipped', ms: 0, note: 'no design graph' }] })), { kind: 'not-compiled', reason: 'no design graph' });
});

test('timing cells keep the pipeline order and mark the stage under way', () => {
  const cells = timingCells(job({ status: 'running', totalMs: 0, stages: [{ name: 'codegen', status: 'done', ms: 2 }] }));
  assert.deepEqual(cells.slice(0, 3).map(c => [c.name, c.state]), [['codegen', 'done'], ['render', 'running'], ['route', 'pending']]);
  assert.equal(cells.filter(c => c.state === 'running').length, 1);
});

test('queued jobs show nothing running', () => {
  assert.equal(timingCells(job({ status: 'queued' })).filter(c => c.state === 'running').length, 0);
});

test('a finished job names stages that never ran, and keeps unknown stages', () => {
  const cells = timingCells(job({ status: 'failed', stages: [{ name: 'codegen', status: 'done', ms: 1 }, { name: 'assembly', status: 'done', ms: 3 }] }));
  assert.equal(cells.find(c => c.name === 'render').state, 'not-reported');
  assert.equal(cells.find(c => c.name === 'assembly').state, 'done');
});

test('a cache hit reads as reused, a real skip stays skipped', () => {
  const cells = timingCells(job({ stages: [
    { name: 'route', status: 'skipped', ms: 0, note: 'Cache hit: reused artifact' },
    { name: 'firmware', status: 'skipped', ms: 0, note: 'Edited TSX has no design' },
  ] }));
  assert.equal(cells.find(c => c.name === 'route').state, 'reused');
  assert.equal(cells.find(c => c.name === 'firmware').state, 'skipped');
});

test('bars are a linear share of the total, and notes group by text', () => {
  const cells = timingCells(job({ totalMs: 1000, stages: [{ name: 'render', status: 'done', ms: 250 }, { name: 'svg', status: 'skipped', ms: 0, note: 'n' }, { name: 'gltf', status: 'skipped', ms: 0, note: 'n' }] }));
  assert.equal(cells.find(c => c.name === 'render').share, 0.25);
  assert.deepEqual(groupedNotes(cells).map(g => g.names), [['svg', 'gltf']]);
});

test('time outside the named stages is stated only when it can be', () => {
  assert.equal(unattributedMs(job({ totalMs: 1000, stages: [{ name: 'render', status: 'done', ms: 800 }] })), 200);
  assert.equal(unattributedMs(job({ status: 'running', totalMs: 1000 })), null);
  assert.equal(unattributedMs(job({ totalMs: 100, stages: [{ name: 'render', status: 'done', ms: 800 }] })), null);
});

test('a job with only source and a receipt keeps the last good build on screen', () => {
  const good = job({ jobId: 'good', artifacts: { 'schematic.svg': art } });
  const failed = job({ jobId: 'bad', status: 'failed', artifacts: { 'board.tsx': art, 'receipt.json': art } });
  assert.equal(jobToDisplay(failed, good).jobId, 'good');
  assert.equal(jobToDisplay(failed, null).jobId, 'bad');
  const partial = job({ jobId: 'partial', status: 'failed', artifacts: { 'board.tsx': art, 'pcb.svg': art } });
  assert.equal(jobToDisplay(partial, good).jobId, 'partial');
  assert.equal(jobToDisplay(null, good).jobId, 'good');
});

test('prepareSvg adds the viewBox tscircuit leaves out and appends CSS last', () => {
  const out = prepareSvg('<svg xmlns="x" width="800" height="600"><style>.a{}</style></svg>', '.b{}');
  assert.match(out, /^<svg viewBox="0 0 800 600" xmlns="x"/);
  assert.ok(out.endsWith('<style>.b{}</style></svg>'));
  const kept = prepareSvg('<svg viewBox="1 2 3 4" width="8" height="6"></svg>');
  assert.match(kept, /viewBox="1 2 3 4"/);
  assert.equal(kept.match(/viewBox/g).length, 1);
  assert.equal(prepareSvg('not an svg'), 'not an svg');
});

test('layer CSS targets the attribute circuit-to-svg writes', () => {
  assert.equal(hideLayersCss(['bottom']), '[data-pcb-layer="bottom"]{display:none}');
});

function zipOf(path, bytes, method, compressedBytes) {
  const name = new TextEncoder().encode(path);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); local.setUint16(8, method, true); local.setUint16(26, name.length, true);
  const dir = new DataView(new ArrayBuffer(46));
  dir.setUint32(0, 0x02014b50, true); dir.setUint16(10, method, true); dir.setUint32(20, compressedBytes.length, true); dir.setUint32(24, bytes.length, true); dir.setUint16(28, name.length, true);
  const end = new DataView(new ArrayBuffer(22));
  const centralAt = 30 + name.length + compressedBytes.length;
  end.setUint32(0, 0x06054b50, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + name.length, true); end.setUint32(16, centralAt, true);
  return Buffer.concat([Buffer.from(local.buffer), name, compressedBytes, Buffer.from(dir.buffer), name, Buffer.from(end.buffer)]);
}

test('readZip reads stored and deflated entries from the central directory', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const text = 'constexpr int PIN_BUZZER = 23;\n'.repeat(20);
  const raw = Buffer.from(text);
  for (const [method, body] of [[0, raw], [8, deflateRawSync(raw)]]) {
    const zip = zipOf('fw/include/pins.h', raw, method, body);
    const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length);
    const [entry] = readZip(buffer);
    assert.equal(entry.path, 'fw/include/pins.h');
    assert.equal(await entry.text(), text);
  }
});

test('readZip refuses what is not a zip', () => {
  assert.throws(() => readZip(new ArrayBuffer(64)), /not a ZIP/);
});

test('a board with no microcontroller has no compile step to wait for or miss', () => {
  const none = job({ noFirmware: true, status: 'running', stages: [{ name: 'codegen', status: 'done', ms: 1 }] });
  assert.deepEqual(compileState(none), { kind: 'none' });
  assert.ok(!timingCells(none).some(c => c.name === 'firmware' || c.name === 'firmware-compile'));
});
