import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { nativeReplayInputSha256 } from '../eda/blocks/native-replay.js';

// Exact final caller proof, not an alternative implementation. Native fixture
// records retain their original geometry and are bound to the actual audit.
const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/refined-clock-materialization-fixture.json', import.meta.url), 'utf8'));
for (const trace of fixture.acceptedClockTraces) assert.equal(nativeReplayInputSha256(trace), fixture.acceptedTraceSha256[trace.pcb_trace_id]);
const source = readFileSync(new URL('../eda/blocks/build.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('build.ts', source, ts.ScriptTarget.Latest, true);
let proof: ts.IfStatement | undefined, dependency: ts.IfStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(tree).startsWith('nativeClockRefinement &&') && node.getText(tree).includes('const materialized =')) {
    assert.equal(proof, undefined); proof = node;
  }
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'nativeClockRefinement && (!nativeClockPreloads || !nativeClearanceFloor)') {
    assert.equal(dependency, undefined); dependency = node;
  }
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(proof); assert.ok(dependency);
const js = ts.transpileModule(`export async function check(cj:any[],acceptedClockTraces:any,nativeClockRefinement:boolean,asyncErrors:any[],save:any,nativeReplayInputSha256:any){${proof.getText(tree)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} as any }; new Function('exports', 'module', js)(module.exports, module);
const fresh = () => structuredClone(fixture);
const run = (f: any, save: (name: string, value: any) => Promise<void> = async () => {}, errors: string[] = []) => module.exports.check(f.circuit, f.acceptedClockTraces, true, errors, save, nativeReplayInputSha256);
const actual = (f: any) => f.circuit.find((r: any) => r.type === 'pcb_trace' && r.pcb_trace_id === f.acceptedClockTraces[1].pcb_trace_id);

test('actual066 canonical same-net source normalization passes with all literal clock copper and records unchanged', async () => {
  const f = fresh(), before = structuredClone(f), writes: any[] = [];
  assert.notEqual(actual(f).source_trace_id, f.acceptedClockTraces[1].source_trace_id, 'actual Core selected another canonical terminal declaration');
  await run(f, async (name, value) => { writes.push({ name, value }); });
  assert.deepEqual(f, before);
  const certificate = writes.find(w => w.name === 'native-clock-materialization.json').value;
  assert.equal(certificate.ok, true); assert.equal(certificate.clockTraces.length, 5);
  assert.ok(certificate.clockTraces.some((row: any) => row.sourceTraceId !== row.nativePreloadSourceTraceId));
  assert.equal(writes[0].name, 'native-clock-materialized-circuit.json', 'actual failed proof remains reviewable');
});

test('whole-path reversal preserves actual clock copper while any additional or missing piece rejects', async () => {
  const reversed = fresh(); actual(reversed).route.reverse(); await assert.doesNotReject(run(reversed));
  for (const kind of ['missing', 'duplicate', 'extra-source-clock', 'extra-net-clock']) {
    const f = fresh(), trace = actual(f);
    if (kind === 'missing') f.circuit.splice(f.circuit.indexOf(trace), 1);
    if (kind === 'duplicate') f.circuit.push(structuredClone(trace));
    if (kind === 'extra-source-clock') f.circuit.push({ ...structuredClone(trace), pcb_trace_id: 'DERIVED_UNCERTIFIED_CLOCK' });
    if (kind === 'extra-net-clock') f.circuit.push({ ...structuredClone(trace), pcb_trace_id: 'DERIVED_UNCERTIFIED_CLOCK', source_trace_id: undefined, source_net_id: f.acceptedClockTraces[1].connection_name });
    await assert.rejects(run(f), /clock|Clock/);
  }
});

test('foreign, ambiguous, multi-port and nonterminal source declarations never certify clock identity', async () => {
  for (const kind of ['foreign', 'duplicate-source', 'multi-port', 'multi-net', 'source-subcircuit', 'trace-subcircuit', 'missing-source', 'duplicate-port', 'nonterminal-port']) {
    const f = fresh(), trace = actual(f), source = f.circuit.find((r: any) => r.type === 'source_trace' && r.source_trace_id === trace.source_trace_id), port = f.circuit.find((r: any) => r.type === 'pcb_port' && r.source_port_id === source.connected_source_port_ids[0]);
    if (kind === 'foreign') trace.source_trace_id = 'source_trace_0';
    if (kind === 'duplicate-source') f.circuit.push(structuredClone(source));
    if (kind === 'multi-port') source.connected_source_port_ids.push('foreign-source-port');
    if (kind === 'multi-net') source.connected_source_net_ids.push('foreign-net');
    if (kind === 'source-subcircuit') source.subcircuit_id = 'foreign-subcircuit';
    if (kind === 'trace-subcircuit') trace.subcircuit_id = 'foreign-subcircuit';
    if (kind === 'missing-source') f.circuit.splice(f.circuit.indexOf(source), 1);
    if (kind === 'duplicate-port') f.circuit.push(structuredClone(port));
    if (kind === 'nonterminal-port') port.pcb_port_id = 'not-an-original-terminal';
    await assert.rejects(run(f), /clock|Clock/);
  }
});

test('materialization rejects even tiny coordinate/width/layer changes or any added via', async () => {
  for (const kind of ['coordinate', 'width', 'layer', 'via']) {
    const f = fresh(), trace = actual(f);
    if (kind === 'coordinate') trace.route[1].x += 1e-9;
    if (kind === 'width') trace.route[1].width = .149999999;
    if (kind === 'layer') trace.route[1].layer = 'bottom';
    if (kind === 'via') trace.route.splice(1, 0, { route_type: 'via', x: trace.route[0].x, y: trace.route[0].y, from_layer: 'top', to_layer: 'bottom', via_diameter: .6, via_hole_diameter: .3 });
    await assert.rejects(run(f), /copper was not materialized exactly/);
  }
});

test('fatal native or asynchronous failures preserve their original error instead of demanding a clock certificate', async () => {
  for (const kind of ['native', 'async']) {
    const f = fresh(), writes: string[] = []; f.acceptedClockTraces = undefined;
    if (kind === 'native') f.circuit.push({ type: 'pcb_autorouting_error', message: 'INDEPENDENT original native failure' });
    await assert.doesNotReject(run(f, async name => { writes.push(name); }, kind === 'async' ? ['INDEPENDENT async failure'] : []));
    assert.deepEqual(writes, []);
  }
  const f = fresh(); f.acceptedClockTraces = undefined;
  await assert.rejects(run(f), /complete native certificate/);
});

test('private refinement cannot be activated without both clock-preload and clearance certificates', () => {
  const guard = new Function('nativeClockRefinement', 'nativeClockPreloads', 'nativeClearanceFloor', dependency!.getText(tree));
  for (const enabled of [false, true]) for (const clocks of [false, true]) for (const floor of [false, true]) {
    if (enabled && (!clocks || !floor)) assert.throws(() => guard(enabled, clocks, floor), /requires proven native clock preloads/);
    else assert.doesNotThrow(() => guard(enabled, clocks, floor));
  }
});
