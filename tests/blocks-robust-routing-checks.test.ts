import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runRobustRoutingChecks, ROUTING_CHECK_NAMES, ROUTING_CHECK_VERSION } from '../eda/blocks/robust-routing-checks.js';
import * as actual from '../eda/node_modules/@tscircuit/checks/dist/index.js';

const moduleUrl = new URL('../eda/blocks/robust-routing-checks.ts', import.meta.url);
// Evaluate the exact production control flow against individual checker spies;
// no native solver/router is instantiated. Only import.meta's URL is supplied
// explicitly because this test harness transpiles ESM into a CommonJS closure.
const code = ts.transpileModule(readFileSync(moduleUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(moduleUrl.href)), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const booleanError = () => new Error('source_net_13_0: Cannot complete boolean operation');
function harness(override: Record<string, any> = {}) {
  const calls: Array<{ name: string; circuit: any[]; options: any }> = [];
  const native: Record<string, any> = {};
  for (const name of ROUTING_CHECK_NAMES) native[name] = (circuit: any[], options?: any) => {
    calls.push({ name, circuit, options });
    if (name === 'checkCopperPourShorts' && circuit[0].center.x === 1) throw booleanError();
    return [{ check: name }];
  };
  native.checkCopperPourShorts = (circuit: any[]) => {
    calls.push({ name: 'checkCopperPourShorts', circuit, options: undefined });
    if (circuit[0].center.x === 1) throw booleanError();
    return [];
  };
  native.runAllRoutingChecks = (circuit: any[]) => { calls.push({ name: 'runAllRoutingChecks', circuit, options: undefined }); circuit[1].start_pcb_port_id = 'native-annotation'; throw booleanError(); };
  Object.assign(native, override);
  const compiled = { exports: {} as any };
  const require = (name: string) => {
    if (name === '../node_modules/@tscircuit/checks/dist/index.js') return native;
    if (name === 'node:fs') return { readFileSync };
    throw Error('Unexpected robust-check dependency: ' + name);
  };
  new Function('require', 'exports', 'module', code)(require, compiled.exports, compiled);
  return { run: compiled.exports.runRobustRoutingChecks as typeof runRobustRoutingChecks, calls, native };
}
const circuit = () => [
  { type: 'pcb_copper_pour', pcb_copper_pour_id: 'p', center: { x: 1, y: -2 }, width: 3, height: 4, rotation: 90, layer: 'top', source_net_id: 'net', brep_shape: { outer_ring: { vertices: [{ x: 1, y: 2, bulge: .3 }] }, inner_rings: [] } },
  { type: 'pcb_trace', pcb_trace_id: 'trace', route: [{ route_type: 'via', x: 2, y: -3, via_diameter: .6, via_hole_diameter: .3, from_layer: 'top', to_layer: 'bottom' }] },
  { type: 'pcb_plated_hole', x: 1, y: 2, rect_pad_width: 1, rect_pad_height: 2, rect_border_radius: .1, hole_offset_x: .2, hole_offset_y: -.3, hole_width: .4, hole_height: .5, ccw_rotation: 45, hole_ccw_rotation: 90 },
  { type: 'source_component', x: 3, y: 4, width: 7, rotation: 90 },
] as any[];

test('normal aggregate results stay native; pinned fallback sequence exactly matches installed primary source', async () => {
  const issues = [{ actual: 'ordinary native result' }], h = harness({ runAllRoutingChecks: () => issues });
  assert.deepEqual(await h.run(circuit()), { issues, retries: [] }); assert.equal(h.calls.length, 0);
  const primary = readFileSync(new URL('../eda/node_modules/@tscircuit/checks/dist/index.js', import.meta.url), 'utf8');
  const aggregate = primary.slice(primary.indexOf('function runAllRoutingChecks('), primary.indexOf('async function runAllChecks('));
  assert.deepEqual([...aggregate.matchAll(/\.\.\.(check\w+)\(/g)].map(m => m[1]), [...ROUTING_CHECK_NAMES]);
  assert.equal(JSON.parse(readFileSync(new URL('../eda/node_modules/@tscircuit/checks/package.json', import.meta.url), 'utf8')).version, ROUTING_CHECK_VERSION);
  for (const name of ROUTING_CHECK_NAMES) assert.equal(typeof actual[name], 'function', name);
});
test('only shorts gets unit-scaled geometry; all 22 unchanged public checks complete in native order/options', async () => {
  const h = harness(), input = circuit(), before = structuredClone(input), result = await h.run(input);
  assert.deepEqual(h.calls.map(c => c.name), ['runAllRoutingChecks', 'checkCopperPourShorts', ...ROUTING_CHECK_NAMES]);
  assert.equal(result.issues.length, ROUTING_CHECK_NAMES.length - 1);
  assert.deepEqual(result.retries, [{ check: 'checkCopperPourShorts', originalError: booleanError().message, scale: 1000 }]);
  const scaled = h.calls.filter(c => c.name === 'checkCopperPourShorts').at(-1)!.circuit;
  for (const call of h.calls) if (call.circuit !== input) assert.equal(call.name, 'checkCopperPourShorts');
  assert.deepEqual(scaled[0].center, { x: 1000, y: -2000 }); assert.equal(scaled[0].width, 3000); assert.equal(scaled[0].rotation, 90); assert.equal(scaled[0].brep_shape.outer_ring.vertices[0].bulge, .3);
  assert.deepEqual(scaled[1].route[0], { route_type: 'via', x: 2000, y: -3000, via_diameter: 600, via_hole_diameter: 300, from_layer: 'top', to_layer: 'bottom' });
  for (const key of ['rect_pad_width', 'rect_pad_height', 'rect_border_radius', 'hole_offset_x', 'hole_offset_y', 'hole_width', 'hole_height']) assert.equal(scaled[2][key], before[2][key] * 1000, key);
  assert.equal(scaled[2].ccw_rotation, 45); assert.equal(scaled[2].hole_ccw_rotation, 90); assert.deepEqual(scaled[3], before[3]);
  const cutout = h.calls.find(c => c.name === 'checkCopperToCutoutClearance')!; assert.deepEqual(cutout.options, { elementTypes: ['pcb_trace'] });
  assert.equal(input[1].start_pcb_port_id, 'native-annotation'); before[1].start_pcb_port_id = 'native-annotation'; assert.deepEqual(input, before);
});
test('unknown aggregate errors and unrelated/absent isolated failures fail closed', async () => {
  const unknown = new Error('unknown engine failure'); const h = harness({ runAllRoutingChecks: () => { throw unknown; } });
  await assert.rejects(h.run(circuit()), e => e === unknown); assert.equal(h.calls.length, 0);
  const isolated = new Error('other_net: Cannot complete boolean operation'); const other = harness({ checkCopperPourShorts: () => { throw isolated; } });
  await assert.rejects(other.run(circuit()), e => e === isolated);
  await assert.rejects(harness({ checkCopperPourShorts: () => [] }).run(circuit()), /source_net_13_0: Cannot complete boolean operation/);
});
test('scaled oracle failure, every later native checker error and changed error schema propagate', async () => {
  const later = new Error('real native islands failure');
  await assert.rejects(harness({ checkCopperPourIslands: () => { throw later; } }).run(circuit()), e => e === later);
  const failure = new Error('scaled geometry still fails');
  await assert.rejects(harness({ checkCopperPourShorts: (c: any[]) => { if (c[0].center.x === 1) throw booleanError(); throw failure; } }).run(circuit()), e => e === failure);
  await assert.rejects(harness({ checkCopperPourShorts: (c: any[]) => { if (c[0].center.x === 1) throw booleanError(); return [{ message: 'new schema', x: 1000 }]; } }).run(circuit()), /unsupported unit-bearing/);
  const nonfinite = circuit(); nonfinite[0].width = Infinity;
  await assert.rejects(harness().run(nonfinite), /nonfinite native PCB length/);
});
test('real different-net short positive control remains identical through native unit retry', async () => {
  const control: any[] = [
    { type: 'source_net', source_net_id: 'a', name: 'A' }, { type: 'source_net', source_net_id: 'b', name: 'B' },
    { type: 'pcb_copper_pour', pcb_copper_pour_id: 'pour-a', shape: 'rect', center: { x: 0, y: 0 }, width: 2, height: 2, layer: 'top', source_net_id: 'a' },
    { type: 'pcb_copper_pour', pcb_copper_pour_id: 'pour-b', shape: 'rect', center: { x: .5, y: .5 }, width: 2, height: 2, layer: 'top', source_net_id: 'b' },
  ];
  const expected = actual.checkCopperPourShorts(control as any); assert.ok(expected.length > 0);
  const h = harness({ runAllRoutingChecks: () => { throw booleanError(); }, checkCopperPourShorts: (c: any[]) => { if (c[2].width === 2) throw booleanError(); return actual.checkCopperPourShorts(c as any); } });
  const result = await h.run(control);
  assert.deepEqual(result.issues.filter(e => e.type === 'pcb_placement_error'), expected);
});
test('actual981 boolean precision failure is reproduced and recovered without skipping the remaining native checks', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/actual-98134781/circuit.json', import.meta.url), 'utf8'));
  assert.throws(() => actual.checkCopperPourShorts(fixture), /source_net_13_0: Cannot complete boolean operation/);
  const result = await runRobustRoutingChecks(fixture);
  assert.deepEqual(result.retries, [{ check: 'checkCopperPourShorts', originalError: 'source_net_13_0: Cannot complete boolean operation', scale: 1000 }]);
  assert.ok(result.issues.length > 0, 'real native diagnostics remain failures after recovery');
  assert.ok(!result.issues.some(e => String(e.message).includes('could not complete')));
});
