import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCopperNetlist } from '../eda/blocks/copper-netlist.js';
import type { PlanGraph } from '../src/blocks/graph.js';

const actual = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/actual-13a6-annulus-fixture.json', import.meta.url), 'utf8'));
// Exact captured via coordinates/dimensions, with explicitly SYNTHETIC terminal
// wrappers to exercise cross-layer physical continuity without a whole-board run.
function fixture(pair = 0, layers = 2) {
  const [a, b] = structuredClone(actual.pairs[pair].vias), dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const positions = { A: { x: a.x - dx / d, y: a.y - dy / d, layer: 'top' }, B: { x: b.x + dx / d, y: b.y + dy / d, layer: 'bottom' } };
  const graph = { parts: ['A', 'B'].map(ref => ({ ref, part: { pins: { p: { pad: '1', role: 'ground' } } } })), nets: [{ name: 'GND', pins: ['A', 'B'].map(ref => ({ ref, logical: 'p', pad: '1' })) }] } as unknown as PlanGraph;
  const circuit: any[] = [{ type: 'pcb_board', num_layers: layers, min_via_hole_edge_to_via_hole_edge_clearance: actual.sourceBoardMinViaHoleEdgeClearanceMm }, a, b];
  for (const [ref, at] of Object.entries(positions)) circuit.push(
    { type: 'source_component', name: ref, source_component_id: ref },
    { type: 'source_port', source_component_id: ref, source_port_id: ref + ':source', name: 'pin1', pin_number: 1, port_hints: ['pin1'] },
    { type: 'pcb_component', source_component_id: ref, pcb_component_id: ref },
    { type: 'pcb_port', pcb_port_id: ref + ':port', pcb_component_id: ref, source_port_id: ref + ':source' },
    { type: 'pcb_smtpad', pcb_smtpad_id: ref + ':pad', pcb_component_id: ref, pcb_port_id: ref + ':port', port_hints: ['pin1'], shape: 'rect', width: .4, height: .4, ...at },
  );
  circuit.push(
    { type: 'pcb_trace', pcb_trace_id: 'synthetic-A-approach', route: [{ route_type: 'wire', ...positions.A, width: .3 }, { route_type: 'wire', x: a.x, y: a.y, layer: 'top', width: .3 }, { route_type: 'via', x: a.x, y: a.y, from_layer: 'top', to_layer: 'bottom', via_diameter: .6, via_hole_diameter: .3 }, { route_type: 'wire', x: a.x, y: a.y, layer: 'bottom', width: .3 }] },
    { type: 'pcb_trace', pcb_trace_id: 'synthetic-B-approach', route: [{ route_type: 'wire', ...positions.B, width: .3 }, { route_type: 'wire', x: b.x, y: b.y, layer: 'bottom', width: .3 }] },
    { type: 'pcb_copper_pour', pcb_copper_pour_id: 'synthetic-B-bottom-island', shape: 'brep', layer: 'bottom', brep_shape: { outer_ring: { vertices: [[-.3, -.3], [.3, -.3], [.3, .3], [-.3, .3]].map(([x, y]) => ({ x: positions.B.x + x!, y: positions.B.y + y! })) }, inner_rings: [] } },
  );
  return { graph, circuit, mapping: { A: { '1': 'pin1' }, B: { '1': 'pin1' } }, a, b };
}
const run = (f: ReturnType<typeof fixture>) => checkCopperNetlist(f.graph, f.circuit, f.mapping, { scope: 'all', policy: 'physical-network' });
const rejected = (f: ReturnType<typeof fixture>) => {
  const result = run(f);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(i => i.rule === 'annulus-drilled-away'), JSON.stringify(result.issues));
};

test('actual two partial-notch pairs retain a complete proven collar on every2/4layer barrel', () => {
  for (const pair of [0, 1]) for (const layers of [2, 4]) {
    const f = fixture(pair, layers), before = structuredClone(f), result = run(f);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.annulusCollarCertificates!.length, 2);
    for (const proof of result.annulusCollarCertificates!) {
      assert.equal(proof.layers.length, layers);
      assert.ok(proof.layers.every(l => l.remainingPolygons === 1 && l.outerRadiusMm > l.innerRadiusMm));
    }
    assert.equal(result.networks![0]!.islands.length, 1);
    assert.deepEqual(f, before);
    assert.ok(actual.pairs[pair].holeEdgeGapMm > actual.sourceBoardMinViaHoleEdgeClearanceMm);
  }
});

test('fully erased, barrel-wall-reaching and tangent circumscribed foreign drills still fail closed', () => {
  for (const layers of [2, 4]) for (const kind of ['erased', 'wall', 'tangent']) {
    const f = fixture(0, layers), offset = kind === 'wall' ? .25 : kind === 'tangent' ? .3 / Math.cos(Math.PI / 48) : 0;
    f.circuit.push({ type: 'pcb_hole', pcb_hole_id: 'negative-' + kind, x: f.a.x + offset, y: f.a.y, hole_diameter: kind === 'erased' ? 1 : .3 });
    rejected(f);
  }
});

test('a foreign inner-layer drill cannot borrow intact top/bottom copper for a4layer barrel', () => {
  const f = fixture(0, 4);
  f.circuit.push({ type: 'pcb_via', pcb_via_id: 'negative-inner-drill', x: f.a.x + .25, y: f.a.y, hole_diameter: .3, outer_diameter: .6, layers: ['inner1', 'inner2'], from_layer: 'inner1', to_layer: 'inner2' });
  rejected(f);
});

test('a complete inner collar cannot justify joining a detached second lower-copper polygon', () => {
  const f = fixture();
  for (let i = -4; i <= 4; i++) f.circuit.push({ type: 'pcb_hole', pcb_hole_id: 'negative-barrier-' + i, x: f.a.x + .24, y: f.a.y + i * .05, hole_diameter: .08 });
  rejected(f);
  assert.ok(!run(f).annulusCollarCertificates?.some(p => p.id === f.a.pcb_via_id));
});

test('off-centre vias and other plated-pad partial cuts do not gain the circular-via certificate', () => {
  const offset = fixture();
  Object.assign(offset.a, { outer_diameter: .64, hole_offset_x: .01 });
  offset.circuit.find(e => e.pcb_trace_id === 'synthetic-A-approach').route.find((p: any) => p.route_type === 'via').via_diameter = .64;
  rejected(offset);
  const plated = fixture(), pad = plated.circuit.find(e => e.pcb_smtpad_id === 'A:pad');
  Object.assign(pad, { type: 'pcb_plated_hole', pcb_plated_hole_id: 'negative-non-via-pad', shape: 'circle', x: plated.a.x, y: plated.a.y, outer_diameter: .6, hole_diameter: .3, layers: ['top', 'bottom'] });
  plated.circuit = plated.circuit.filter(e => e !== plated.a && e.pcb_trace_id !== 'synthetic-A-approach');
  rejected(plated);
});

test('the collar proof does not excuse foreign terminal contact or union electrical labels', () => {
  const f = fixture();
  f.graph.nets = [{ name: 'A-net', pins: [{ ref: 'A', logical: 'p', pad: '1' }] }, { name: 'B-net', pins: [{ ref: 'B', logical: 'p', pad: '1' }] }];
  for (const part of f.graph.parts) part.part.pins.p!.role = 'passive';
  f.circuit.forEach(e => { e.subcircuit_connectivity_map_key = 'FAKE_SHARED_NAME'; });
  const result = run(f);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(i => i.rule === 'net-short'));
});
