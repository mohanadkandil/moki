import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDrv8833EscapeProposals } from '../eda/blocks/drv8833-escape.js';
import { createNativeFanoutPhase } from '../eda/blocks/fanout.js';
import { checkEachPcbTraceNonOverlapping } from '../eda/node_modules/@tscircuit/checks/dist/index.js';
import type { PlanGraph } from '../src/blocks/graph.js';

const fixturePath = new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/drv8833-escape-fixture.json', import.meta.url);
const original = JSON.parse(readFileSync(fixturePath, 'utf8'));
const fixture = () => structuredClone(original) as { circuit: any[]; graph: PlanGraph; mapping: Record<string, Record<string, string>> };
const run = (f: ReturnType<typeof fixture>) => createDrv8833EscapeProposals(f.circuit, f.graph, f.mapping);
test('captured remote width transition still fails the unchanged final native clearance rule', () => {
  const f = fixture();
  const diagnosis = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/drv8833-clearance-diagnosis.json', import.meta.url), 'utf8'));
  assert.deepEqual(diagnosis.sourceInputWidths.map((c: any) => c.width), [0.3, 0.15]);
  const traces = ['VCP', 'VM'].map(key => ({
    type: 'pcb_trace', pcb_trace_id: diagnosis[key].pcbTraceId,
    source_trace_id: diagnosis[key].sourceTraceId, route: diagnosis[key].segment,
  }));
  const errors = checkEachPcbTraceNonOverlapping([...f.circuit, ...traces], { minClearance: 0.127 });
  assert.ok(errors.some(e => /too close.*gap: 0\.096mm/.test(e.message)));
  assert.ok(Math.abs(diagnosis.geometry.nativeFinalMaxEndpointGapMm - 0.09557893526377137) < 1e-12);
});
const land = (f: ReturnType<typeof fixture>, pin: number) => {
  const source = f.circuit.find(e => e.type === 'source_component' && e.name === 'U5');
  const pinSource = f.circuit.find(e => e.type === 'source_port' && e.source_component_id === source.source_component_id && e.pin_number === pin);
  const port = f.circuit.find(e => e.type === 'pcb_port' && e.source_port_id === pinSource.source_port_id);
  return f.circuit.find(e => e.type === 'pcb_smtpad' && e.pcb_port_id === port.pcb_port_id);
};
const foreignVmLand = (f: ReturnType<typeof fixture>) => {
  const vmNet = f.circuit.find(e => e.type === 'source_net' && e.name === 'VBUS');
  const vmSources = new Set(f.circuit.filter(e => e.type === 'source_trace' && e.connected_source_net_ids?.includes(vmNet.source_net_id)).flatMap(e => e.connected_source_port_ids));
  const vmPorts = new Set(f.circuit.filter(e => e.type === 'pcb_port' && vmSources.has(e.source_port_id)).map(e => e.pcb_port_id));
  return f.circuit.find(e => e.type === 'pcb_smtpad' && e.shape !== 'polygon' && vmPorts.has(e.pcb_port_id) && e.pcb_component_id !== land(f, 11).pcb_component_id);
};
test('actual failing-job geometry yields source-exact normal exits and binds native saved fanout', () => {
  const f = fixture(), before = JSON.stringify(f), r = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(r.proposals.map(p => p.pad), ['1', '2', '3', '4', '11', '12', '14', '15', '16']);
  for (const audit of r.audit) {
    const proposal = r.proposals.find(p => p.pad === audit.pad)!;
    const source = f.circuit.find(e => e.type === 'source_trace' && e.source_trace_id === audit.sourceTraceId);
    assert.equal(audit.widthMm, source.min_trace_thickness);
    assert.ok(proposal.route.every(p => p.width === source.min_trace_thickness && p.route_type === 'wire' && p.layer === 'top'));
    assert.ok(Math.abs(audit.lengthMm - 1.1499987) < 1e-8);
  }
  assert.equal(r.audit.find(a => a.pad === '12')!.widthMm, 0.3);
  assert.equal(r.audit.find(a => a.pad === '11')!.widthMm, 0.15);
  assert.equal(r.audit.find(a => a.pad === '11')!.normal.x, -1);
  const bound = createNativeFanoutPhase(f.circuit, r.proposals);
  assert.equal(bound.props!.autorouter, 'fanout');
  assert.equal(bound.props!.pcbTracePaths.length, 9);
  assert.deepEqual([...bound.netNames].sort(), r.netNames);
});

function rotateMotor(f: ReturnType<typeof fixture>, quarter: number) {
  const anchor = f.graph.parts.find(p => p.ref === 'U5')!, inst = anchor.inst;
  const start = { ...anchor.at }, angle = quarter * Math.PI / 2;
  const point = (p: { x: number; y: number }) => ({
    x: 60 + (p.x - start.x) * Math.cos(angle) - (p.y - start.y) * Math.sin(angle),
    y: 60 + (p.x - start.x) * Math.sin(angle) + (p.y - start.y) * Math.cos(angle),
  });
  const refs = new Set(f.graph.parts.filter(p => p.inst === inst).map(p => p.ref));
  const sourceIds = new Set(f.circuit.filter(e => e.type === 'source_component' && refs.has(e.name)).map(e => e.source_component_id));
  const pcbIds = new Set(f.circuit.filter(e => e.type === 'pcb_component' && sourceIds.has(e.source_component_id)).map(e => e.pcb_component_id));
  for (const e of f.circuit) {
    if (e.type === 'pcb_board') { e.width = 200; e.height = 200; delete e.outline; }
    if (!pcbIds.has(e.pcb_component_id)) continue;
    if (typeof e.x === 'number' && typeof e.y === 'number') Object.assign(e, point(e));
    for (const key of ['center', 'footprint_origin']) if (e[key]) e[key] = point(e[key]);
    if (e.type === 'pcb_component') e.rotation = (e.rotation + quarter * 90) % 360;
    if (e.type === 'pcb_smtpad') {
      if (e.shape === 'rect') e.shape = 'rotated_rect';
      if (e.shape === 'pill') e.shape = 'rotated_pill';
      e.ccw_rotation = ((e.ccw_rotation ?? 0) + quarter * 90) % 360;
    }
  }
  for (const p of f.graph.parts.filter(p => p.inst === inst)) p.at = { ...point(p.at), rotation: ((p.at.rotation ?? 0) + quarter * 90) % 360 };
}
test('all cardinal block rotations and both supported layer counts preserve exact physical normals and widths', () => {
  for (const quarter of [0, 1, 2, 3]) for (const layers of [2, 4]) {
    const f = fixture(); rotateMotor(f, quarter);
    f.circuit.find(e => e.type === 'pcb_board').num_layers = layers;
    const before = JSON.stringify(f), r = run(f);
    assert.equal(JSON.stringify(f), before);
    assert.equal(r.proposals.length, 9);
    const vm = r.proposals.find(p => p.pad === '12')!, n = r.audit.find(a => a.pad === '12')!.normal;
    assert.equal(vm.route[0]!.width, 0.3);
    assert.ok(Math.abs(vm.route[1]!.x - vm.route[0]!.x - n.x * 1.1499987) < 1e-7);
    assert.ok(Math.abs(vm.route[1]!.y - vm.route[0]!.y - n.y * 1.1499987) < 1e-7);
  }
});
test('global ref allocation changes do not alter physical pin binding', () => {
  const f = fixture();
  const driver = f.graph.parts.find(p => p.ref === 'U5')!; driver.ref = 'U99';
  for (const net of f.graph.nets) for (const pin of net.pins) if (pin.ref === 'U5') pin.ref = 'U99';
  f.circuit.find(e => e.type === 'source_component' && e.name === 'U5').name = 'U99';
  f.mapping.U99 = f.mapping.U5!; delete f.mapping.U5;
  const r = run(f);
  assert.ok(r.proposals.every(p => p.ref === 'U99'));
  assert.equal(r.audit.find(p => p.pad === '12')!.widthMm, 0.3);
});
test('actual foreign VM land blocks VCP escape even with a forged VCP net label', () => {
  const f = fixture(), r = run(f), vcp = r.proposals.find(p => p.pad === '11')!;
  const vm = foreignVmLand(f);
  // Move a proven foreign VM land/port onto the outward VCP corridor. A copied
  // same-net label on that physical foreign pad must not make it acceptable.
  vm.x = (vcp.route[0]!.x + vcp.route[1]!.x) / 2; vm.y = vcp.route[0]!.y;
  const port = f.circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === vm.pcb_port_id);
  port.x = vm.x; port.y = vm.y;
  vm.source_net_id = f.circuit.find(e => e.type === 'source_net' && e.name === 'VCP_PUMP').source_net_id;
  assert.throws(() => run(f), /native geometry/);
});
test('a real foreign external pad, copper keepout and board edge each reject the proposed exits', () => {
  for (const obstruction of ['pad', 'keepout', 'board']) {
    const f = fixture(), r = run(f), p = r.proposals.find(p => p.pad === '11')!;
    const at = { x: p.route[1]!.x, y: p.route[1]!.y };
    if (obstruction === 'pad') {
      const foreign = foreignVmLand(f);
      foreign.x = at.x; foreign.y = at.y;
      const port = f.circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === foreign.pcb_port_id);
      port.x = at.x; port.y = at.y;
    } else if (obstruction === 'keepout') f.circuit.push({ type: 'pcb_keepout', pcb_keepout_id: 'foreign_keepout', shape: 'rect', center: at, width: 0.4, height: 0.4, layers: ['top'] });
    else {
      const board = f.circuit.find(e => e.type === 'pcb_board');
      board.width = 10; delete board.outline;
    }
    assert.throws(() => run(f), /native geometry/, obstruction);
  }
});
test('source identity, import aliases, pad geometry, cardinal pose, widths and routed input fail closed', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.mapping.U5!['11'] = 'pin12'; },
    (f: ReturnType<typeof fixture>) => { land(f, 11).port_hints = ['pin12']; },
    (f: ReturnType<typeof fixture>) => { land(f, 11).width = 0.8; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'source_component' && e.name === 'U5').manufacturer_part_number = 'foreign'; },
    (f: ReturnType<typeof fixture>) => { f.graph.parts.find(p => p.ref === 'U5')!.at.rotation = 45; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'source_trace' && e.source_trace_id === 'source_trace_118').min_trace_thickness = 0.5; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'pcb_board').min_trace_width = 0.2; },
    (f: ReturnType<typeof fixture>) => { f.circuit.push({ type: 'pcb_via' }); },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => run(f));
  }
});
