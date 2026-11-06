import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { prepareImmutablePreloads } from '../eda/blocks/immutable-preloads.js';
import { nativeReplayInputSha256 } from '../eda/blocks/native-replay.js';

// Execute the exact production callback/binder, without importing the build
// entrypoint or running a native solver. The recorded source snapshot has no
// rendered PCB traces: identity comes from real source declarations and ports.
const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/clock-phase-binding-fixture.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../eda/blocks/build.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('build.ts', source, ts.ScriptTarget.Latest, true);
let binder: ts.IfStatement | undefined, callback: ts.ArrowFunction | undefined, replayGuard: ts.IfStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'nativeClockPreloads' && node.getText(tree).includes('const ownerIds')) {
    assert.equal(binder, undefined); binder = node;
  }
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'c.on' && node.arguments[0]?.getText(tree) === "'autorouting:end'") {
    assert.equal(callback, undefined); assert.ok(ts.isArrowFunction(node.arguments[1]!)); callback = node.arguments[1] as ts.ArrowFunction;
  }
  if (ts.isIfStatement(node) && node.expression.getText(tree) === 'nativeReplayManifest && nativeClockPreloads') {
    assert.equal(replayGuard, undefined); replayGuard = node;
  }
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(binder); assert.ok(callback); assert.ok(replayGuard);
const compiled = ts.transpileModule(`
export async function bind(geometry:any,rpClock:any,capturedClockPhase:any,layerCount:number,prepareImmutablePreloads:any,nativeReplayInputSha256:any){
 const c={getCircuitJson:()=>geometry},nativeClockPreloads=true,saves:any[]=[];
 let planned:any={layerCount,connections:[],traces:[],obstacles:[]},immutableClock:any;
 const save=async(name:any,value:any)=>{saves.push({name,value});};
 ${binder.getText(tree)}
 return {planned,immutableClock,saves};
}
export function capture(nativeReplayInputSha256:any){
 let nativeOutputIndex=0,capturedClockPhase:any;
 const nativeClockPreloads=true,job='fixture',resolve=(...parts:any[])=>parts.join('/'),writeFileSync=()=>{};
 const emit=${callback.getText(tree)};
 return {emit,snapshot:()=>capturedClockPhase};
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} as any };
new Function('exports', 'module', compiled)(module.exports, module);
const fresh = () => structuredClone(fixture);
const run = (f: any, layerCount = 2) => module.exports.bind(f.source, f.profile, f.event.simpleRouteJson.traces, layerCount, prepareImmutablePreloads, nativeReplayInputSha256);

test('private captured-output replay cannot bypass live immutable clock getter verification', () => {
  const guard = new Function('nativeReplayManifest', 'nativeClockPreloads', replayGuard!.getText(tree));
  for (const manifest of [undefined, 'private-manifest.json']) for (const clocks of [false, true]) {
    if (manifest && clocks) assert.throws(() => guard(manifest, clocks), /fresh native routing/);
    else assert.doesNotThrow(() => guard(manifest, clocks));
  }
});

test('actual public clock event is cloned only at the correct phase and rejects conflicting repeats', () => {
  const f = fresh(), capture = module.exports.capture(nativeReplayInputSha256);
  capture.emit({ ...f.event, phaseName: 'other-phase' }); assert.equal(capture.snapshot(), undefined);
  capture.emit({ ...f.event, phaseStageIndex: 1 }); assert.equal(capture.snapshot(), undefined);
  capture.emit(f.event); const expected = structuredClone(f.event.simpleRouteJson.traces);
  assert.deepEqual(capture.snapshot(), expected);
  f.event.simpleRouteJson.traces[0].route[0].x += .01;
  assert.deepEqual(capture.snapshot(), expected, 'later event-object changes cannot alter captured copper');
  assert.throws(() => capture.emit(f.event), /events disagree/);
  assert.throws(() => capture.emit({ ...fresh().event, simpleRouteJson: { traces: [] } }), /incomplete/);
});

test('actual zero-PCBtrace source snapshot binds source identity only, preserving all five literal records', async () => {
  for (const layers of [2, 4]) {
    const f = fresh(), before = structuredClone(f); assert.ok(!f.source.some((r: any) => r.type === 'pcb_trace'));
    const result = await run(f, layers); assert.equal(result.planned.traces.length, 5);
    result.planned.traces.forEach((trace: any, index: number) => {
      assert.ok(trace.source_trace_id); assert.ok(trace.subcircuit_id);
      const copper = { ...trace }; delete copper.source_trace_id; delete copper.subcircuit_id;
      assert.deepEqual(copper, f.event.simpleRouteJson.traces[index]);
    });
    assert.deepEqual(f, before); assert.ok(Object.isFrozen(result.immutableClock.traces[0].route[0]));
    assert.equal(result.saves.find((s: any) => s.name === 'native-clock-phase-binding.json').value.bindings.length, 5);
  }
});

test('clock profiles must be covered bijectively, including two branches on the same net', async () => {
  const f = fresh(), traces = f.event.simpleRouteJson.traces;
  const first = traces.findIndex((t: any, i: number) => traces.slice(i + 1).some((u: any) => u.connection_name === t.connection_name));
  const second = traces.findIndex((t: any, i: number) => i > first && t.connection_name === traces[first].connection_name);
  traces[second] = { ...structuredClone(traces[first]), pcb_trace_id: traces[second].pcb_trace_id };
  await assert.rejects(run(f), /repeats a verified profile/);
});

test('every connectsTo alias must be a unique complete actual same-clock-net physical port', async () => {
  for (const kind of ['foreign', 'unknown', 'duplicate', 'missing', 'empty', 'nonstring', 'duplicate-port', 'duplicate-declaration', 'foreign-subcircuit']) {
    const f = fresh(), trace = f.event.simpleRouteJson.traces[0], aliases = trace.connectsTo, firstId = aliases[0];
    if (kind === 'foreign') aliases.push('pcb_port_56');
    if (kind === 'unknown') aliases.push('unknown-physical-port');
    if (kind === 'duplicate') aliases.push(aliases[0]);
    if (kind === 'missing') aliases.pop();
    if (kind === 'empty') trace.connectsTo = [];
    if (kind === 'nonstring') aliases.push(42);
    const port = f.source.find((r: any) => r.type === 'pcb_port' && r.pcb_port_id === firstId);
    const declaration = f.source.find((r: any) => r.type === 'source_trace' && r.connected_source_port_ids?.length === 1 && r.connected_source_port_ids[0] === port.source_port_id && r.connected_source_net_ids?.[0] === trace.connection_name);
    if (kind === 'duplicate-port') f.source.push(structuredClone(port));
    if (kind === 'duplicate-declaration') f.source.push(structuredClone(declaration));
    if (kind === 'foreign-subcircuit') declaration.subcircuit_id = 'foreign-subcircuit';
    await assert.rejects(run(f), /Clock event/);
  }
});

test('clock copper and existing source metadata cannot change, and source evidence must exist', async () => {
  for (const kind of ['coordinate', 'width', 'layer', 'via', 'source', 'subcircuit', 'missing-source', 'duplicate-net', 'missing-phase', 'wrong-profile']) {
    const f = fresh(), trace = f.event.simpleRouteJson.traces[0];
    if (kind === 'coordinate') trace.route[1].x += 1e-9;
    if (kind === 'width') trace.route[1].width = .14;
    if (kind === 'layer') trace.route[1].layer = 'bottom';
    if (kind === 'via') trace.route[1].route_type = 'via';
    if (kind === 'source') trace.source_trace_id = 'foreign-source';
    if (kind === 'subcircuit') trace.subcircuit_id = 'foreign-subcircuit';
    if (kind === 'missing-source') f.source = f.source.filter((r: any) => r.type !== 'source_trace');
    if (kind === 'duplicate-net') f.source.push(structuredClone(f.source.find((r: any) => r.type === 'source_net' && r.source_net_id === trace.connection_name)));
    if (kind === 'missing-phase') f.event.simpleRouteJson.traces = undefined;
    if (kind === 'wrong-profile') f.profile.audit.pop();
    await assert.rejects(run(f), /Clock|clock/);
  }
});

test('compiler net IDs may be renumbered without guessing aliases or altering copper', async () => {
  const f = fresh(), renumber = new Map(f.profile.netNames.map((name: string, index: number) => [f.source.find((r: any) => r.type === 'source_net' && r.name === name).source_net_id, 'renumbered-clock-' + index]));
  for (const row of f.source) {
    if (row.type === 'source_net' && renumber.has(row.source_net_id)) row.source_net_id = renumber.get(row.source_net_id);
    if (row.type === 'source_trace') row.connected_source_net_ids = row.connected_source_net_ids?.map((id: string) => renumber.get(id) ?? id);
  }
  for (const trace of f.event.simpleRouteJson.traces) trace.connection_name = renumber.get(trace.connection_name);
  const result = await run(f); assert.ok(result.planned.traces.every((trace: any) => trace.connection_name.startsWith('renumbered-clock-')));
});
