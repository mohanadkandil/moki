import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkNativeTraceWidths } from '../src/blocks/native-trace-width.js';
import { checkSourceTracesMatchPcbTraceThickness } from '../eda/node_modules/@tscircuit/checks/dist/index.js';

const wire = (x: number, width: any = 0.15, layer = 'top', y = 0) => ({ route_type: 'wire', x, y, width, layer });
const via = (x = 0) => ({ route_type: 'via', x, y: 0, from_layer: 'top', to_layer: 'bottom', via_diameter: 0.6, via_hole_diameter: 0.3 });
const circuit = (route: any[], minimum?: any) => [{ type: 'pcb_board', num_layers: 2, ...(minimum !== undefined ? { min_trace_width: minimum } : {}) }, { type: 'pcb_trace', pcb_trace_id: 'trace', source_trace_id: 'source', route }];
test('actual134 VCORE taper from canonical one-port source83 escapes official source-thickness checking but fails board minimum', () => {
  const raw = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/actual-134193af/pre-pour-circuit.json', import.meta.url), 'utf8')) as any[];
  const target = raw.find(e => e.type === 'pcb_trace' && e.pcb_trace_id === 'source_net_7_mst1_0');
  const source = raw.find(e => e.type === 'source_trace' && e.source_trace_id === target.source_trace_id);
  assert.equal(source.source_trace_id, 'source_trace_83');
  assert.equal(source.connected_source_port_ids.length, 1);
  assert.equal(target.route[0].width, 0.10606601717798213);
  const actual = raw.filter(e => e.type !== 'pcb_trace' || e === target), before = JSON.stringify(actual);
  assert.deepEqual(checkSourceTracesMatchPcbTraceThickness(actual), []);
  const issues = checkNativeTraceWidths(actual);
  assert.ok(issues.length > 0);
  assert.ok(issues.some(e => e.pcb_trace_id === target.pcb_trace_id && e.source_trace_id === 'source_trace_83' && e.actual_widths_mm?.includes(0.10606601717798213)));
  assert.equal(JSON.stringify(actual), before);
});
test('absolute minimum accepts .15, rejects .1499 and checks either tapered endpoint irrespective of nominal widths', () => {
  assert.deepEqual(checkNativeTraceWidths(circuit([wire(0), wire(1)])), []);
  for (const route of [[wire(0, 0.1499), wire(1, 0.3)], [wire(0, 0.3), wire(1, 0.1499)]]) {
    const c: any[] = circuit(route); c[0].nominal_trace_width = 1; c[1].nominalTraceWidth = 0.3;
    assert.equal(checkNativeTraceWidths(c).length, 1);
  }
  assert.deepEqual(checkNativeTraceWidths(circuit([wire(0, 0.3), wire(1, 0.3)])), []);
  assert.equal(checkNativeTraceWidths(circuit([wire(0, 0.15), wire(1, 0.15)], 0.2)).length, 1);
  assert.deepEqual(checkNativeTraceWidths(circuit([wire(0, 0.15 - 5e-10), wire(1)])), []);
});
test('finite subfloor coincident via contacts alone are ignored; participation in any free wire segment still fails', () => {
  assert.deepEqual(checkNativeTraceWidths(circuit([wire(0, 0.106), via(), wire(0, 0.106, 'bottom'), wire(0, 0.15, 'bottom'), wire(1, 0.15, 'bottom')])), []);
  for (const route of [[wire(0, 0.106), via(1)], [via(), wire(1, 0.106, 'bottom')], [wire(0, 0.106), wire(1)]])
    assert.equal(checkNativeTraceWidths(circuit(route)).length, 1);
  assert.deepEqual(checkNativeTraceWidths(circuit([wire(0, 0.106), wire(1e-8, 0.106)])), []);
  assert.equal(checkNativeTraceWidths(circuit([wire(0, 0.106), wire(1.01e-8, 0.106)])).length, 1);
});
test('malformed widths, coordinates, route types and board rules fail closed even on isolated contacts', () => {
  for (const width of [undefined, null, '0.15', NaN, Infinity, -1, 0]) {
    const p = wire(0); if (width === undefined) delete (p as any).width; else p.width = width;
    assert.ok(checkNativeTraceWidths(circuit([p, via()])).length > 0, String(width));
  }
  for (const minimum of [null, '0.15', NaN, Infinity, 0, -1])
    assert.ok(checkNativeTraceWidths(circuit([wire(0), wire(1)], minimum)).length > 0);
  for (const point of [{ ...wire(0), x: NaN }, { ...wire(0), y: Infinity }, { ...wire(0), route_type: 'unknown' }, { ...wire(0), layer: '' }, null])
    assert.ok(checkNativeTraceWidths(circuit([point, wire(1)])).length > 0);
  assert.ok(checkNativeTraceWidths([{ type: 'pcb_trace' }]).length > 0);
  assert.ok(checkNativeTraceWidths(null as any).length > 0);
});
test('direct wire-layer jumps and displaced via-only segments reject; reversed explicit via labels do not change width proof', () => {
  assert.equal(checkNativeTraceWidths(circuit([wire(0), wire(1, 0.15, 'bottom')])).length, 1);
  assert.equal(checkNativeTraceWidths(circuit([wire(0), wire(0, 0.15, 'bottom')])).length, 1);
  assert.equal(checkNativeTraceWidths(circuit([via(), via(1)])).length, 1);
  assert.deepEqual(checkNativeTraceWidths(circuit([wire(-1), { ...via(), from_layer: 'bottom', to_layer: 'top' }, wire(0, 0.15, 'bottom'), wire(1, 0.15, 'bottom')])), []);
});
test('inspection preserves all source, native route and diagnostic records', () => {
  const c = circuit([wire(0, 0.106), wire(1)]); c.push({ type: 'pcb_trace_error', message: 'existing diagnostic' } as any);
  const before = structuredClone(c), errors = checkNativeTraceWidths(c);
  assert.ok(errors.length > 0); assert.deepEqual(c, before);
  assert.deepEqual(checkNativeTraceWidths([{ type: 'pcb_trace', route: [wire(0), wire(1)] }]), []);
  assert.ok(checkNativeTraceWidths([{ type: 'pcb_board', min_trace_width: 0.15 }, { type: 'pcb_board', min_trace_width: 0.2 }]).length > 0);
});
