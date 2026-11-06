import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { contentId } from '../../../src/circuit/graph';
import { EMPTY_SESSION, submitBrief } from '../../../src/circuit/session';
import type { BoardJob } from '../board/types';
import { readZip } from '../board/zip';
import { crc32, storedZip } from './archive';
import { cleanNote, cleanRejection, designForRerun, planBrief } from './conversation';
import { cornerRadiusOf, describeEdits, editOrigin, editProblems, hasEdits, NO_EDITS, placedBox, placePoint, setPlacement, toEdits } from './editing';
import { airwires, connectedPins, readBoard, schematicMatrix } from './pcbModel';
import { SourceBadge } from './SourceBadge';
import { atBase } from '../board/base';
import { activity, cacheLabels, formatDuration, otherTime, proofChip, proofItems, readableError, routingErrors, sourceStatus, stageRows, summarize, tabStatus } from './facts';
import { tokenize } from './highlight';
import { artifactAction, LIFT, liftShare, partLabel, partOfNode } from './parts';

const artifact = (bytes: number) => ({ url: '/x', bytes, sha256: 'abc', kind: 'json' as const });
const finished: BoardJob = {
  jobId: 'j', status: 'done', cache: 'miss', totalMs: 24_400,
  input: { kind: 'design', template: 'focus-timer' },
  stages: [
    { name: 'codegen', status: 'done', ms: 4 }, { name: 'render', status: 'done', ms: 470 }, { name: 'route', status: 'done', ms: 2034 },
    { name: 'svg', status: 'done', ms: 54 }, { name: 'gltf', status: 'done', ms: 309 }, { name: 'fab', status: 'done', ms: 89 },
    { name: 'enclosure', status: 'done', ms: 8106 }, { name: 'firmware', status: 'done', ms: 11 }, { name: 'firmware-compile', status: 'done', ms: 13000, note: 'Compile checked' },
  ],
  drc: { checked: true, errors: [], warnings: [{ type: 'w', message: 'a' }, { type: 'w', message: 'b' }] },
  board: { widthMm: 90, heightMm: 100, layers: 2, traceCount: 11, viaCount: 7 },
  artifacts: { 'circuit.json': artifact(1), 'enclosure-base.stl': artifact(2), 'firmware.zip': artifact(3), 'pcb.svg': artifact(4) },
};
const facts = {
  enclosure: { engine: { name: 'build123d', version: '0.13.0' }, dimensions: { outerMm: { x: 94.6, y: 105.6, z: 30.49 } }, apertures: [{}], stack: { parts: [{ id: 'U1', confidence: 'estimated' }] }, validation: { base: { stl: { watertight: true } }, lid: { stl: { watertight: true } } } },
  firmware: { board: 'esp32dev', flash: { usedBytes: 305961, percent: 23.3 }, ram: { usedBytes: 22096, percent: 6.7 } },
};

test('a clean build says what it made, in measured time, and never claims a physical result', () => {
  const s = summarize(finished, facts);
  assert.equal(s.tone, 'ok');
  assert.equal(s.headline, 'Board, case and firmware in 24.4 s.');
  assert.ok(s.checked.some(l => l.text.includes('0 errors, 2 warnings')));
  assert.ok(s.checked.some(l => l.text.includes('94.6 × 105.6 × 30.5 mm') && l.text.includes('watertight')));
  assert.ok(s.unproven.some(l => /fabricated, printed, flashed or powered/.test(l.text)));
  assert.ok(s.unproven.some(l => /Module sizes/.test(l.text)));
});

test('DRC is called clean only with no warnings, and Not printed is always open', () => {
  const items = proofItems(finished);
  assert.equal(items.find(i => i.key === 'drc')!.label, 'DRC 0 errors');
  assert.equal(items.find(i => i.key === 'printed')!.tone, 'open');
  const clean = proofItems({ ...finished, drc: { checked: true, errors: [], warnings: [] } });
  assert.equal(clean.find(i => i.key === 'drc')!.label, 'DRC clean');
  const empty = proofItems({ jobId: 'q', status: 'running', stages: [], drc: { checked: false, errors: [], warnings: [] } });
  assert.equal(empty.find(i => i.key === 'drc')!.tone, 'busy');
});

test('a failed compile is reported as a failure, not dropped', () => {
  const job: BoardJob = { ...finished, stages: finished.stages!.map(s => (s.name === 'firmware-compile' ? { ...s, status: 'failed' as const, note: 'xtensa error' } : s)) };
  const s = summarize(job, facts);
  assert.equal(s.tone, 'warn');
  assert.match(s.headline, /Board and case in 24\.4 s\. The firmware compile failed\./);
  assert.equal(proofItems(job).find(i => i.key === 'compile')!.tone, 'error');
  assert.ok(s.unproven.some(l => l.text.includes('xtensa error')));
});

test('DRC errors outrank everything in the headline', () => {
  const job: BoardJob = { ...finished, drc: { checked: true, errors: [{ type: 'pcb_port_not_connected_error', message: 'x' }], warnings: [] } };
  const s = summarize(job, facts);
  assert.equal(s.tone, 'error');
  assert.match(s.headline, /with 1 DRC error\.$/);
  assert.ok(s.checked.some(l => /1 routing error/.test(l.text)));
});

test('a job that died before rendering has no fake DRC pass', () => {
  const job: BoardJob = { jobId: 'f', status: 'failed', error: 'boom', stages: [{ name: 'codegen', status: 'skipped', ms: 0 }], drc: { checked: false, errors: [], warnings: [] }, artifacts: {} };
  const s = summarize(job, {});
  assert.equal(s.tone, 'error');
  assert.equal(s.headline, 'This build failed.');
  assert.equal(s.sub, 'boom');
  assert.equal(s.unproven.length, 0);
  assert.ok(!s.checked.some(l => /Design rule/.test(l.text)));
});

test('a pipeline stack reads as its message, never its source excerpt', () => {
  const raw = 'Chip EDA failed (exit 1): 11 | const norm = 1;\n12 | function mm() {\n      ^\nerror: Cannot legalize 180deg\n      at mm (/home/sogo/repo/eda/blocks/legalize.ts:16:13)\n';
  assert.equal(readableError(raw), 'Cannot legalize 180deg');
  assert.equal(readableError('Chip EDA failed (exit 1): 11 | const norm = 1;\n   ^\n'), '');
  assert.equal(readableError('Enclosure failed: Traceback (most recent call last):\n  File "/a/b.py", line 3, in f\n    x()\nValueError: bad wall'), 'bad wall');
  assert.equal(readableError('Server restarted before this job finished. Build again.'), 'Server restarted before this job finished. Build again.');
});

test('a compiler error reads as one line with no server paths', () => {
  const raw = 'EDA render failed (exit 1): 6 | return <board ^ error: Expected "}" but found "<" at /home/sogo/repo/var/board-jobs/abc/board.tsx:6:10 more';
  assert.equal(readableError(raw), 'board.tsx line 6: Expected "}" but found "<".');
  assert.doesNotMatch(readableError('Cannot read /home/sogo/repo/x.json'), /home/);
});

test('cached stages say cached, and an edited source hides the compile row with its skipped parent', () => {
  const cached: BoardJob = { ...finished, stages: [{ name: 'codegen', status: 'done', ms: 2 }, { name: 'render', status: 'done', ms: 20, note: 'Cache hit: copied' }, { name: 'route', status: 'skipped', ms: 0, note: 'Cache hit: reused artifact' }] };
  assert.equal(stageRows(cached, facts).find(r => r.name === 'route')!.time, 'cached');
  const edited: BoardJob = { ...finished, input: { kind: 'source' }, stages: [...finished.stages!.slice(0, 7), { name: 'firmware', status: 'skipped', ms: 0, note: 'Edited TSX has no design graph' }] };
  assert.equal(stageRows(edited, facts).some(r => r.name === 'firmware-compile'), false);
});

test('only the first unreported stage is running, and the activity names the worker that holds it', () => {
  const job: BoardJob = { jobId: 'r', status: 'running', stages: [{ name: 'codegen', status: 'done', ms: 3 }, { name: 'render', status: 'done', ms: 400 }, { name: 'route', status: 'done', ms: 1 }, { name: 'svg', status: 'done', ms: 1 }, { name: 'gltf', status: 'done', ms: 1 }, { name: 'fab', status: 'done', ms: 1 }] };
  const rows = stageRows(job, {});
  assert.deepEqual(rows.filter(r => r.state === 'running').map(r => r.name), ['enclosure']);
  assert.equal(activity(job, false), 'Modelling the case');
  assert.equal(activity(null, true), 'Sending the design');
  assert.equal(activity(finished, false), null);
});

test('a follow-up keeps the earlier brief, and naming another template starts over', () => {
  const first = submitBrief(EMPTY_SESSION, 'a focus timer with a knob and a beep');
  const session = first.session;
  assert.deepEqual(planBrief(EMPTY_SESSION, 'a little lamp'), { brief: 'a little lamp' });
  const more = planBrief(session, 'make it 45 minutes');
  assert.equal(more.choice, 'focus-timer');
  const next = submitBrief(session, more.brief, more.choice);
  assert.equal(next.outcome.kind, 'created');
  if (next.outcome.kind === 'created') {
    assert.equal(next.outcome.revision.design.template, 'focus-timer');
    assert.equal(next.outcome.revision.interpretation.options.buzzer, true);
    assert.equal(next.outcome.revision.interpretation.options.focusMinutes, 45);
  }
  assert.deepEqual(planBrief(session, 'make it a lamp'), { brief: 'make it a lamp' });
  const same = planBrief(session, 'remove the knob');
  assert.equal(submitBrief(session, same.brief, same.choice).outcome.kind, 'unchanged');
  const motor = planBrief(session, 'add a motor');
  const refused = submitBrief(session, motor.brief, motor.choice);
  assert.equal(refused.outcome.kind, 'rejected');
  if (refused.outcome.kind === 'rejected') assert.match(cleanRejection(refused.outcome.rejection).lines[0]!, /motor.*Workshop does not design/);
});

test('a refused brief reads properly, and choosing between two templates builds the chosen one', () => {
  const refused = submitBrief(EMPTY_SESSION, 'a smart coffee machine with a camera');
  assert.equal(refused.outcome.kind, 'rejected');
  if (refused.outcome.kind === 'rejected') assert.match(cleanRejection(refused.outcome.rejection).lines[0]!, /“camera” is not in the parts catalog/);
  const both = submitBrief(EMPTY_SESSION, 'a timer and a lamp');
  assert.equal(both.outcome.kind, 'rejected');
  if (both.outcome.kind === 'rejected') assert.deepEqual(both.outcome.rejection.candidates, ['focus-timer', 'light-lamp']);
  const chosen = submitBrief(EMPTY_SESSION, 'a timer and a lamp', 'light-lamp');
  assert.equal(chosen.outcome.kind, 'created');
  if (chosen.outcome.kind === 'created') assert.equal(chosen.outcome.revision.design.template, 'light-lamp');
});

test('notes written for the wiring-only preview are not repeated as if true here', () => {
  assert.doesNotMatch(cleanNote('Enclosures and PCB layout are not drawn here. This is a wiring preview.'), /not drawn|preview/);
  assert.doesNotMatch(cleanNote('Wi-Fi and Bluetooth are inside the ESP32 module. Network behaviour is firmware, which this preview does not write.'), /does not write/);
  assert.equal(cleanNote('Not used: “remove”. They don’t change the circuit.'), 'Not used: “remove”. They don’t change the circuit.');
});

test('the stored zip reads back through the same reader as firmware.zip', async () => {
  const encoder = new TextEncoder();
  const bytes = storedZip([{ name: 'a.txt', data: encoder.encode('hello') }, { name: 'dir/b.txt', data: encoder.encode('world!') }]);
  const entries = readZip(bytes.buffer as ArrayBuffer);
  assert.deepEqual(entries.map(e => e.path), ['a.txt', 'dir/b.txt']);
  assert.equal(await entries[1]!.text(), 'world!');
  assert.equal(crc32(encoder.encode('hello')), 0x3610a686);
});

test('the tokenizer keeps every character and finds the things it colors', () => {
  const code = '#pragma once\n// note\nconstexpr int PIN_BUZZER = 23;\n<board width={90} name="x" />';
  const tokens = tokenize(code);
  assert.equal(tokens.map(t => t.text).join(''), code);
  for (const kind of ['comment', 'keyword', 'number', 'tag', 'attr', 'string'] as const) assert.ok(tokens.some(t => t.kind === kind), kind);
  assert.equal(formatDuration(0.4), '<1 ms');
});

test('the not-proven list says what the design rule check does not cover, once it has run', () => {
  const scope = 'The design rule check covers placement and routing. It doesn’t check that the circuit works, or that your modules match.';
  assert.ok(summarize(finished, facts).unproven.some(l => l.text === scope));
  const notRun = { ...finished, drc: undefined, stages: finished.stages?.filter(s => s.name !== 'render') };
  assert.ok(!summarize(notRun, facts).unproven.some(l => l.text === scope));
});

test('the folded proof chip counts passes, names a lone problem and never hides one in a count', () => {
  assert.deepEqual(proofChip(proofItems(finished)), { tone: 'ok', label: '3 checks' });
  const drcBad = { ...finished, drc: { checked: true, errors: [{ type: 'e', message: 'x' }], warnings: [] } };
  assert.deepEqual(proofChip(proofItems(drcBad)), { tone: 'error', label: 'DRC 1 error' });
  const twoBad = { ...drcBad, stages: finished.stages?.map(s => (s.name === 'firmware-compile' ? { ...s, status: 'failed' as const, note: 'boom' } : s)) };
  assert.deepEqual(proofChip(proofItems(twoBad)), { tone: 'error', label: '2 problems' });
  assert.equal(proofChip(proofItems({ jobId: 'j', status: 'running' })).tone, 'busy');
});

test('an Other row makes the stages add up to the total, and only a finished job has one', () => {
  const stages = finished.stages!.reduce((sum, s) => sum + s.ms, 0);
  assert.equal(otherTime({ ...finished, totalMs: stages + 2800 }), '2.80 s');
  assert.equal(otherTime({ ...finished, totalMs: stages + 10 }), null);
  assert.equal(otherTime({ ...finished, status: 'running', totalMs: stages + 2800 }), null);
  assert.equal(otherTime({ ...finished, status: 'failed', stages: [], totalMs: 5630 }), null);
});

test('the board and case caches are labelled separately', () => {
  const stages = (note: string) => finished.stages!.map(s => (s.name === 'enclosure' ? { ...s, note } : s));
  assert.deepEqual(cacheLabels({ ...finished, cache: 'miss', stages: stages('build123d mech cache hit: same handoff') }), ['board cache miss', 'case cache hit']);
  assert.deepEqual(cacheLabels({ ...finished, cache: 'hit', stages: stages('build123d 0.13.0: import 4428 ms') }), ['board cache hit', 'case cache miss']);
  assert.deepEqual(cacheLabels({ jobId: 'j', status: 'done', cache: 'hit' }), ['board cache hit']);
});

test('URLs land under the mount point, once, and leave blob URLs alone', () => {
  assert.equal(atBase('/api/board/jobs', '/'), '/api/board/jobs');
  assert.equal(atBase('/api/board/jobs', '/app/moki/'), '/app/moki/api/board/jobs');
  assert.equal(atBase('/app/moki/api/board/jobs', '/app/moki/'), '/app/moki/api/board/jobs');
  assert.equal(atBase('/', '/app/moki/'), '/app/moki/');
  assert.equal(atBase('/api/x', './'), './api/x');
  assert.equal(atBase('blob:http://x/1', '/app/moki/'), 'blob:http://x/1');
});

test('routing errors are counted from known DRC types, and an unknown error type gives no count rather than 0', () => {
  assert.equal(routingErrors(finished), 0);
  const withErrors = (...types: string[]) => ({ ...finished, drc: { checked: true, warnings: [], errors: types.map(type => ({ type, message: 'x' })) } });
  assert.equal(routingErrors(withErrors('pcb_trace_not_connected_error', 'x_error')), 1);
  assert.equal(routingErrors(withErrors('some_new_tscircuit_error')), null);
  assert.equal(routingErrors({ jobId: 'j', status: 'running' }), null);
});

test('the stage reads part identity from every node name in use, and leaves the board and case alone', () => {
  assert.deepEqual(partOfNode('U1:esp32-devkitc-v4'), { ref: 'U1', moduleId: 'esp32-devkitc-v4', socket: false });
  assert.deepEqual(partOfNode('U1:socket'), { ref: 'U1', moduleId: null, socket: true });
  assert.deepEqual(partOfNode('modules-SW1', { moki: { module: 'ky040-rotary-encoder' } }), { ref: 'SW1', moduleId: 'ky040-rotary-encoder', socket: false });
  assert.deepEqual(partOfNode('BZ1'), { ref: 'BZ1', moduleId: null, socket: false });
  for (const name of ['Box0', 'enclosure-lid', 'enclosure-base', '', undefined]) assert.equal(partOfNode(name), null);
  assert.deepEqual(partLabel('U1', 'esp32-devkitc-v4'), { ref: 'U1', name: 'ESP32-DevKitC V4' });
  assert.deepEqual(partLabel('U9', null), { ref: 'U9', name: null });
});

test('in the exploded view sockets stay with the board and modules lift off it', () => {
  assert.equal(liftShare('U1:socket'), LIFT.board);
  assert.equal(liftShare('U1:esp32-devkitc-v4'), LIFT.modules);
  assert.equal(liftShare('modules-U1'), LIFT.modules);
  assert.equal(liftShare('enclosure-lid'), LIFT.lid);
  assert.equal(liftShare('enclosure-base'), 0);
});

test('kicad.zip is offered as an action, other files by name', () => {
  assert.equal(artifactAction('kicad.zip'), 'Open in KiCad');
  assert.equal(artifactAction('gerbers.zip'), null);
});

test('tabs show no status once a build is done, even for an output it never made', () => {
  assert.equal(tabStatus(finished, { id: 'schematic', needs: 'schematic.svg' }, false), null);
  assert.equal(tabStatus({ ...finished, artifacts: {} }, { id: 'case', needs: 'enclosure.json' }, false), null);
  assert.equal(tabStatus(null, { id: 'pcb', needs: 'circuit.json' }, false), null);
});

test('while a build runs, only tabs whose output is missing wait, and a lost run stops claiming that', () => {
  const running: BoardJob = { ...finished, status: 'running', stages: finished.stages!.slice(0, 2), artifacts: { 'schematic.svg': artifact(1) } };
  assert.equal(tabStatus(running, { id: 'schematic', needs: 'schematic.svg' }, true), null);
  assert.equal(tabStatus(running, { id: 'case', needs: 'enclosure.json' }, true), 'waiting');
  assert.equal(tabStatus(running, { id: 'case', needs: 'enclosure.json' }, false), null);
});

test('a failure marks only the tab of the stage that failed', () => {
  const all = [{ id: 'schematic', needs: 'schematic.svg' }, { id: 'pcb', needs: 'circuit.json' }, { id: '3d', needs: 'board.glb' }, { id: 'case', needs: 'enclosure.json' }, { id: 'firmware', needs: 'firmware.zip' }, { id: 'code', needs: 'board.tsx' }] as const;
  const marked = (job: BoardJob) => all.filter(t => tabStatus(job, t, false) === 'failed').map(t => t.id);
  const reported: BoardJob = { ...finished, status: 'failed', artifacts: {}, stages: [...finished.stages!.slice(0, 6), { name: 'enclosure', status: 'failed', ms: 9 }] };
  assert.deepEqual(marked(reported), ['case']);
  // A render that crashes reports no stage of its own.
  const silent: BoardJob = { ...finished, status: 'failed', artifacts: {}, stages: [{ name: 'codegen', status: 'skipped', ms: 0 }] };
  assert.deepEqual(marked(silent), ['schematic']);
  // The job can finish while one stage failed, and that still deserves the mark.
  const partial: BoardJob = { ...finished, stages: [...finished.stages!.slice(0, 8), { name: 'firmware-compile', status: 'failed', ms: 9 }] };
  assert.deepEqual(marked(partial), ['firmware']);
});

test('the Code badge only says Rendered when this job rendered its source', () => {
  const badge = (job: BoardJob, following = false) => renderToStaticMarkup(createElement(SourceBadge, { status: sourceStatus(job, following) }));
  // The shape of real failed job 4d1f69f5: saved source, a crash in the render, no circuit.
  const crashed: BoardJob = { jobId: 'x', status: 'failed', error: 'EDA render failed (exit 1): boom', input: { kind: 'source' }, stages: [{ name: 'codegen', status: 'skipped', ms: 0 }], artifacts: { 'board.tsx': artifact(154), 'receipt.json': artifact(9) } };
  assert.match(badge(crashed), /is-error.*Render failed/);
  assert.doesNotMatch(badge(crashed), /is-ok|>Rendered</);

  const killed: BoardJob = { ...crashed, error: 'Worker stopped because the board service closed; process group killed' };
  assert.match(badge(killed), /is-warn.*Not rendered/);
  const queued: BoardJob = { ...crashed, status: 'running', error: undefined };
  assert.match(badge(queued, true), />Rendering</);
  assert.match(badge(queued, false), />Source saved</);
  assert.doesNotMatch(badge(queued, false), /is-ok/);
  assert.match(badge({ ...crashed, status: 'done', error: undefined }), /is-warn.*Not rendered/);

  const withCircuit = { ...crashed.artifacts, 'circuit.json': artifact(1) };
  assert.match(badge({ ...crashed, status: 'done', error: undefined, artifacts: withCircuit }), /is-ok.*Rendered/);
  // A later stage failing doesn't undo the render.
  assert.match(badge({ ...crashed, error: 'Case failed', artifacts: withCircuit }), /is-ok.*Rendered/);
  assert.match(badge({ ...crashed, artifacts: withCircuit }), /is-error.*Render failed/);
});

test('a re-run submits the design the job was built from, not the latest with the same template', () => {
  const first = submitBrief(EMPTY_SESSION, 'a focus timer for 25 minutes with a buzzer');
  const second = submitBrief(first.session, 'a focus timer for 45 minutes with a buzzer');
  assert.ok(first.outcome.kind === 'created' && second.outcome.kind === 'created');
  const early = first.outcome.revision.design;
  const late = second.outcome.revision.design;
  assert.equal(early.template, late.template);
  assert.notEqual(contentId(early), contentId(late));
  const jobOf = (design: typeof early): BoardJob => ({ jobId: 'j', status: 'done', input: { kind: 'design', template: design.template, designContentId: contentId(design) } });
  assert.deepEqual(designForRerun(jobOf(early), second.session), early);
  assert.deepEqual(designForRerun(jobOf(late), second.session), late);
  // From history in another session, or a source job: this session doesn't hold that design, so it isn't a design re-run.
  assert.equal(designForRerun(jobOf(early), EMPTY_SESSION), null);
  assert.equal(designForRerun({ jobId: 'j', status: 'done', input: { kind: 'design', template: late.template, designContentId: 'someone-else' } }, second.session), null);
  assert.equal(designForRerun({ jobId: 'j', status: 'done', input: { kind: 'source' } }, second.session), null);
  assert.equal(designForRerun({ jobId: 'j', status: 'done', input: { kind: 'design', template: late.template } }, second.session), null);
});

// A small board in circuit.json's own shape: U1 and U2 share net n1, and U2's second pin is unwired.
const circuitFile = [
  { type: 'pcb_board', center: { x: 0, y: 0 }, width: 40, height: 30, num_layers: 2, outline: [{ x: 20, y: 12 }, { x: 18, y: 15 }, { x: 20, y: -12 }] },
  { type: 'source_component', source_component_id: 'sc1', name: 'U1', manufacturer_part_number: 'ESP32 module' },
  { type: 'source_component', source_component_id: 'sc2', name: 'U2', manufacturer_part_number: 'OLED' },
  { type: 'source_net', source_net_id: 'sn1', name: 'SDA', subcircuit_connectivity_map_key: 'n1' },
  { type: 'source_port', source_port_id: 'sp1', source_component_id: 'sc1', name: 'GPIO21', pin_number: 1, subcircuit_connectivity_map_key: 'n1' },
  { type: 'source_port', source_port_id: 'sp2', source_component_id: 'sc2', name: 'SDA', pin_number: 1, subcircuit_connectivity_map_key: 'n1' },
  { type: 'source_port', source_port_id: 'sp3', source_component_id: 'sc2', name: 'NC', pin_number: 2 },
  { type: 'pcb_component', pcb_component_id: 'pc1', source_component_id: 'sc1', center: { x: -10, y: 0 }, width: 8, height: 8, layer: 'top', rotation: 0 },
  { type: 'pcb_component', pcb_component_id: 'pc2', source_component_id: 'sc2', center: { x: 10, y: 0 }, width: 6, height: 2, layer: 'top', rotation: 0 },
  { type: 'pcb_silkscreen_rect', pcb_component_id: 'pc2', center: { x: 10, y: 3 }, width: 6, height: 8, layer: 'top', stroke_width: 0.1 },
  { type: 'pcb_port', pcb_port_id: 'pp1', pcb_component_id: 'pc1', source_port_id: 'sp1', x: -10, y: 0 },
  { type: 'pcb_port', pcb_port_id: 'pp2', pcb_component_id: 'pc2', source_port_id: 'sp2', x: 9, y: 0 },
  { type: 'pcb_port', pcb_port_id: 'pp3', pcb_component_id: 'pc2', source_port_id: 'sp3', x: 11, y: 0 },
  { type: 'pcb_plated_hole', pcb_component_id: 'pc1', pcb_port_id: 'pp1', x: -10, y: 0, shape: 'circle', outer_diameter: 1.6, hole_diameter: 0.8 },
  { type: 'pcb_plated_hole', pcb_component_id: 'pc2', pcb_port_id: 'pp2', x: 9, y: 0, shape: 'circle', outer_diameter: 1.6, hole_diameter: 0.8 },
  { type: 'pcb_plated_hole', pcb_component_id: 'pc2', pcb_port_id: 'pp3', x: 11, y: 0, shape: 'circle', outer_diameter: 1.6, hole_diameter: 0.8 },
  { type: 'pcb_trace', pcb_trace_id: 't1', connection_name: 'sn1', route: [
    { route_type: 'wire', x: -10, y: 0, width: 0.25, layer: 'top', start_pcb_port_id: 'pp1' }, { route_type: 'wire', x: 0, y: 0, width: 0.25, layer: 'top' },
    { route_type: 'via', x: 0, y: 0, from_layer: 'top', to_layer: 'bottom' },
    { route_type: 'wire', x: 0, y: 0, width: 0.25, layer: 'bottom' }, { route_type: 'wire', x: 9, y: 0, width: 0.25, layer: 'bottom', end_pcb_port_id: 'pp2' },
  ] },
  { type: 'pcb_copper_pour', layer: 'top', source_net_id: 'sn1', brep_shape: { outer_ring: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, inner_rings: [] } },
  { type: 'schematic_component', schematic_component_id: 'sch1', source_component_id: 'sc1', center: { x: 1, y: 1 }, size: { width: 2, height: 2 } },
  { type: 'schematic_port', schematic_component_id: 'sch1', center: { x: 3, y: 1 } },
];

test('the board model reads parts, nets and envelopes from circuit.json', () => {
  assert.equal(readBoard({ not: 'a circuit' }), null);
  assert.equal(readBoard([]), null);
  const model = readBoard(circuitFile)!;
  assert.deepEqual([model.board.w, model.board.h], [40, 30]);
  assert.equal(model.nets.get('n1')!.name, 'SDA');
  const u2 = model.parts.find(p => p.ref === 'U2')!;
  assert.deepEqual(u2.envelope, { x: 10, y: 3, w: 6, h: 8 });
  assert.equal(u2.name, 'OLED');
  assert.deepEqual(connectedPins(u2).map(p => p.label), ['SDA']);
  assert.equal(u2.pins.length, 2);
  assert.equal(u2.pads[0]!.net, 'n1');
  assert.equal(model.traces[0]!.net, 'n1');
  assert.deepEqual(model.traces[0]!.runs.map(r => r.layer), ['top', 'bottom']);
  assert.equal(model.pours[0]!.net, 'n1');
  // The schematic box takes in the pin stubs, so clicking a pin finds its part.
  assert.deepEqual(model.schematic[0], { ref: 'U1', x: 1.5, y: 1, w: 3, h: 2 });
  assert.deepEqual(airwires(model).map(w => w.net), ['n1']);
  assert.deepEqual(schematicMatrix('<svg data-real-to-screen-transform="matrix(2,0,0,-2,10,20)">')!(1, 1), [12, 18]);
  assert.equal(schematicMatrix('<svg>'), null);
});

test('a draft says what it moved, in words, and returning a part clears it', () => {
  const model = readBoard(circuitFile)!;
  const u2 = model.parts.find(p => p.ref === 'U2')!;
  assert.equal(hasEdits(NO_EDITS), false);
  const moved = setPlacement(NO_EDITS, u2, { x: 2, y: 3, rotation: 0 });
  assert.deepEqual(describeEdits(model, moved), ['U2 moved 8 mm left, 3 mm up']);
  assert.deepEqual(toEdits(moved), { placements: [{ refdes: 'U2', x: 2, y: 3, rotation: 0 }] });
  assert.equal(hasEdits(setPlacement(moved, u2, { x: 10, y: 0, rotation: 360 })), false);
  const turned = setPlacement(NO_EDITS, u2, { x: 10, y: 0, rotation: 90 });
  assert.deepEqual(describeEdits(model, turned), ['U2 turned 90°']);
  assert.deepEqual(describeEdits(model, { placements: {}, board: { widthMm: 50, heightMm: 30, cornerRadiusMm: 2 }, usbEdge: 'left' }), ['Board 50 × 30 mm, 2 mm corners', 'USB on the left edge']);
  const [x, y] = placePoint(u2, { x: 10, y: 0, rotation: 90 }, 11, 0);
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 1) < 1e-9);
  // Turning a quarter swaps the footprint's sides.
  const box = placedBox(u2, { x: 10, y: 0, rotation: 90 });
  assert.deepEqual([box.x1 - box.x0, box.y1 - box.y0], [8, 6]);
});

test('draft hints catch a part off the board or on another, and stay quiet about what never moved', () => {
  const model = readBoard(circuitFile)!;
  const u2 = model.parts.find(p => p.ref === 'U2')!;
  assert.deepEqual(editProblems(model, NO_EDITS), []);
  assert.deepEqual(editProblems(model, setPlacement(NO_EDITS, u2, { x: 30, y: 0, rotation: 0 })), ['U2 doesn’t fit on the board there.']);
  assert.deepEqual(editProblems(model, setPlacement(NO_EDITS, u2, { x: -10, y: -3, rotation: 0 })), ['U1 would overlap U2.']);
  assert.deepEqual(editProblems(model, { placements: {}, board: { widthMm: 20, heightMm: 30, cornerRadiusMm: 0 } }), ['U1 doesn’t fit on the board there.', 'U2 doesn’t fit on the board there.']);
});

test('only a job carrying edits calls itself edited', () => {
  assert.equal(editOrigin({ input: { kind: 'design' } }), null);
  assert.deepEqual(editOrigin({ input: { baseJobId: 'b', edits: { placements: [] } }, editSummary: ['U2 moved 8 mm left', 3] }), { baseJobId: 'b', lines: ['U2 moved 8 mm left'] });
  assert.equal(cornerRadiusOf(readBoard(circuitFile)!.board), 3);
});
