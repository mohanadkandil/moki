import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCopperNetlist } from '../eda/blocks/copper-netlist.js';
import type { PlanGraph } from '../src/blocks/graph.js';
import { checkCopperPourShorts } from '../eda/node_modules/@tscircuit/checks/dist/index.js';

// Synthetic physical fixtures, not native rendering or catalog/hardware proof.
function fixture() {
  const positions = { G1: [0, 0], G2: [4, 0], A: [0, 3], B: [4, 3], NC: [8, 3], D: [0, 7] };
  const graph = {
    parts: Object.keys(positions).map(ref => ({ ref, part: { pins: { p: { pad: '1', role: ref.startsWith('G') ? 'ground' : ref === 'NC' ? 'nc' : 'passive' } } } })),
    nets: [
      { name: 'GND', pins: ['G1', 'G2'].map(ref => ({ ref, logical: 'p', pad: '1' })) },
      { name: 'SIGNAL', pins: ['A', 'B'].map(ref => ({ ref, logical: 'p', pad: '1' })) },
      { name: 'ISOLATED', pins: [{ ref: 'D', logical: 'p', pad: '1' }] },
    ],
  } as unknown as PlanGraph;
  const mapping = Object.fromEntries(Object.keys(positions).map(ref => [ref, { '1': 'pin1' }]));
  const circuit: any[] = [
    { type: 'pcb_board', num_layers: 2 },
    { type: 'pcb_copper_pour', pcb_copper_pour_id: 'GND-plane', shape: 'brep', layer: 'top', brep_shape: { outer_ring: { vertices: [{ x: -1, y: -1 }, { x: 5, y: -1 }, { x: 5, y: 1 }, { x: -1, y: 1 }] }, inner_rings: [] } },
    { type: 'pcb_trace', pcb_trace_id: 'signal', route: [{ route_type: 'wire', x: 0, y: 3, layer: 'top', width: .15 }, { route_type: 'wire', x: 4, y: 3, layer: 'top', width: .15 }] },
  ];
  for (const [ref, [x, y]] of Object.entries(positions)) circuit.push(
    { type: 'source_component', name: ref, source_component_id: ref },
    { type: 'source_port', source_component_id: ref, source_port_id: `${ref}:source`, name: 'pin1', pin_number: 1, port_hints: ['pin1'] },
    { type: 'pcb_component', source_component_id: ref, pcb_component_id: ref },
    { type: 'pcb_port', pcb_component_id: ref, pcb_port_id: `${ref}:port`, source_port_id: `${ref}:source` },
    { type: 'pcb_smtpad', pcb_smtpad_id: `${ref}:pad`, pcb_component_id: ref, pcb_port_id: `${ref}:port`, port_hints: ['pin1'], shape: 'rect', x, y, width: .8, height: .8, layer: 'top' },
  );
  return { graph, mapping, circuit };
}
const all = (f: ReturnType<typeof fixture>) => checkCopperNetlist(f.graph, f.circuit, f.mapping, { policy: 'physical-network', scope: 'all' });
const rules = (r: ReturnType<typeof all>) => r.issues.map(i => i.rule);

test('all-net scope proves each actual network while retaining only real grounds in legacy groundNets', () => {
  const f = fixture(), before = structuredClone(f), result = all(f);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.scope, 'all-nets-actual-copper');
  assert.deepEqual(result.networks!.map(n => n.name), ['GND', 'SIGNAL', 'ISOLATED']);
  assert.deepEqual(result.groundNets.map(n => n.name), ['GND']);
  assert.equal(result.networks!.every(n => n.islands.length === 1), true);
  assert.deepEqual(f, before);
  assert.deepEqual(checkCopperNetlist(f.graph, f.circuit, f.mapping), checkCopperNetlist(f.graph, f.circuit, f.mapping, { scope: 'ground' }));
});

test('non-ground cut fails despite canonical source labels and stale native connectsTo metadata', () => {
  const f = fixture();
  f.circuit.find(e => e.pcb_trace_id === 'signal').route[1].x = 1;
  for (const e of f.circuit) Object.assign(e, { source_trace_id: 'canonical', subcircuit_connectivity_map_key: 'SIGNAL', connectsTo: ['A:pad', 'B:pad'] });
  assert.equal(checkCopperNetlist(f.graph, f.circuit, f.mapping).ok, true, 'legacy scope checks grounds only');
  const result = all(f);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes('net-open'));
  assert.equal(result.networks!.find(n => n.name === 'SIGNAL')!.islands.length, 2);
});

test('non-ground copper touching an NC or another declared net fails isolation', () => {
  for (const foreign of ['NC', 'D']) {
    const f = fixture();
    Object.assign(f.circuit.find(e => e.pcb_smtpad_id === `${foreign}:pad`), { x: 2, y: 3 });
    const result = all(f);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(i => i.rule === 'net-short' && i.terminals?.includes(`${foreign}.1`)));
  }
});

test('every physical piece of a repeated non-ground pad must join actual copper', () => {
  const f = fixture(), pad = f.circuit.find(e => e.pcb_smtpad_id === 'A:pad');
  f.circuit.push({ ...pad, pcb_smtpad_id: 'A:second-piece', x: 12 });
  assert.ok(rules(all(f)).includes('net-open'));
});

function barrelFixture() {
  const f = fixture();
  f.circuit = f.circuit.filter(e => e.pcb_trace_id !== 'signal');
  for (const x of [0, 4]) f.circuit.push(
    { type: 'pcb_trace', pcb_trace_id: `escape-${x}`, route: [{ route_type: 'wire', x, y: 3, width: .15, layer: 'top' }, { route_type: 'wire', x, y: 5, width: .15, layer: 'top' }, { route_type: 'via', x, y: 5, from_layer: 'top', to_layer: 'bottom', via_diameter: .6, via_hole_diameter: .3 }, { route_type: 'wire', x, y: 5, width: .15, layer: 'bottom' }] },
    { type: 'pcb_via', pcb_via_id: `via-${x}`, x, y: 5, outer_diameter: .6, hole_diameter: .3, layers: ['top', 'bottom'], from_layer: 'top', to_layer: 'bottom' },
  );
  f.circuit.push({ type: 'pcb_trace', pcb_trace_id: 'back-bridge', route: [{ route_type: 'wire', x: 0, y: 5, width: .15, layer: 'bottom' }, { route_type: 'wire', x: 4, y: 5, width: .15, layer: 'bottom' }] });
  return f;
}

test('non-ground physical barrels prove cross-layer continuity and a foreign drill destroys acceptance', () => {
  const f = barrelFixture();
  assert.equal(all(f).ok, true, JSON.stringify(all(f).issues));
  f.circuit.push({ type: 'pcb_hole', pcb_hole_id: 'foreign-drill', x: 0, y: 5, hole_diameter: .8 });
  const result = all(f);
  assert.equal(result.ok, false);
  assert.ok(rules(result).includes('annulus-drilled-away'));
  assert.ok(rules(result).includes('net-open'));
});

test('all-net unsupported geometry and unattested physical identity fail closed', () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.pcb_smtpad_id === 'A:pad').shape = 'unsupported'; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.pcb_smtpad_id === 'A:pad').pcb_port_id = 'B:port'; },
    (f: ReturnType<typeof fixture>) => { f.graph.nets[1]!.pins.push({ ref: 'D', logical: 'p', pad: '1' }); },
  ]) {
    const f = fixture(); mutation(f);
    assert.ok(rules(all(f)).includes('copper-geometry-unverified'));
  }
  const f = fixture();
  assert.equal(checkCopperNetlist(f.graph, f.circuit, f.mapping, { scope: 'unsupported' } as any).ok, false);
});

test('all-net continuity does not fabricate a pour requirement for a signal-only graph', () => {
  const f = fixture();
  f.graph.nets = f.graph.nets.filter(n => n.name !== 'GND');
  for (const part of f.graph.parts) part.part.pins.p!.role = 'passive';
  f.circuit = f.circuit.filter(e => e.type !== 'pcb_copper_pour');
  const result = all(f);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.groundNets, []);
});

test('inward native BREP arc cannot become a false straight-chord connection', () => {
  // Exact independently reported geometry: the inward semicircle excludes A,
  // while a straight chord fills the void and falsely joins A to B.
  const f = fixture();
  f.graph.parts = f.graph.parts.filter(p => ['A', 'B'].includes(p.ref));
  f.graph.nets = f.graph.nets.filter(n => n.name === 'SIGNAL');
  f.circuit = f.circuit.filter(e => e.type === 'pcb_board' || ['A', 'B'].some(ref => e.source_component_id === ref || e.pcb_component_id === ref || e.name === ref));
  for (const [ref, y] of [['A', .5], ['B', 3]] as const) Object.assign(f.circuit.find(e => e.pcb_smtpad_id === `${ref}:pad`), { x: 2, y, width: .4, height: .4 });
  f.circuit.push({ type: 'source_net', source_net_id: 'pour-net', name: 'POUR' }, { type: 'pcb_copper_pour', pcb_copper_pour_id: 'arc-pour', shape: 'brep', layer: 'top', source_net_id: 'pour-net', brep_shape: { outer_ring: { vertices: [{ x: 0, y: 0, bulge: -1 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, inner_rings: [] } });
  const native = checkCopperPourShorts(f.circuit as any);
  assert.ok(native.some(e => e.pcb_placement_error_id.includes('B:pad')));
  assert.ok(!native.some(e => e.pcb_placement_error_id.includes('A:pad')), 'actual native curved region excludes A');
  const result = all(f);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(i => i.rule === 'copper-geometry-unverified' && /bulge/.test(i.message)));
  f.circuit.find(e => e.pcb_copper_pour_id === 'arc-pour').brep_shape.outer_ring.vertices[0].bulge = 0;
  assert.equal(all(f).ok, true, 'the rejected curved geometry differs materially from a straight chord');
});

test('all polygon rings reject nonzero or malformed bulges; zero and absent bulges retain straight geometry', () => {
  for (const bulge of [1, -1, 1e-15, NaN, Infinity, -Infinity, '0', null]) {
    for (const location of ['outer', 'inner', 'pad']) {
      const f = fixture(), pour = f.circuit.find(e => e.type === 'pcb_copper_pour');
      if (location === 'outer') pour.brep_shape.outer_ring.vertices[0].bulge = bulge;
      if (location === 'inner') pour.brep_shape.inner_rings.push({ vertices: [{ x: 1, y: -.1, bulge }, { x: 2, y: -.1 }, { x: 2, y: .1 }, { x: 1, y: .1 }] });
      if (location === 'pad') Object.assign(f.circuit.find(e => e.pcb_smtpad_id === 'A:pad'), { shape: 'polygon', points: [{ x: -.4, y: 2.6, bulge }, { x: .4, y: 2.6 }, { x: .4, y: 3.4 }, { x: -.4, y: 3.4 }] });
      assert.ok(all(f).issues.some(i => i.rule === 'copper-geometry-unverified' && /bulge/.test(i.message)), `${location}/${String(bulge)}`);
    }
  }
  for (const bulge of [undefined, 0, -0]) {
    const f = fixture(); f.circuit.find(e => e.type === 'pcb_copper_pour').brep_shape.outer_ring.vertices[0].bulge = bulge;
    assert.equal(all(f).ok, true);
  }
});

// Explicit opt-in: coordinator owns the bounded whole-board CPU slot. A failure
// remains a real gate failure; this test does not replace or relabel geometry.
const actual = process.env.MOKI_TEST_ALL_NET_ACTUAL_JOB;
test('opt-in actual accepted native board passes every-net physical copper proof', { skip: !actual }, () => {
  const read = (name: string) => JSON.parse(readFileSync(resolve(actual!, name), 'utf8'));
  const result = checkCopperNetlist(read('plan-graph.json'), read('circuit.json'), Object.fromEntries(read('import-map.json').parts.map((p: any) => [p.ref, p.pins])), { policy: 'physical-network', scope: 'all' });
  assert.equal(result.scope, 'all-nets-actual-copper');
  assert.equal(result.networks!.length, read('plan-graph.json').nets.length);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});
