import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFanout, isFanoutTarget } from '../src/blocks/fanout.js';
import { planGraph } from '../src/blocks/graph.js';
import { contentHash } from '../src/blocks/library.js';
import type { BlockDef, BlockDraft, BoardPlan } from '../src/blocks/contract.js';

const directory = '../docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/';
const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(directory + name, import.meta.url), 'utf8'));
function fixture(isolated = false) {
  // Pair retained native output with its own captured plan/map, never the changing current full plan.
  const plan = json<BoardPlan>('native-port-plan.json');
  const seed = JSON.parse(readFileSync(new URL('../src/blocks/data/seed.json', import.meta.url), 'utf8')) as BlockDef[];
  const defs = [...seed, ...(plan.drafts ?? []).map((d: BlockDraft): BlockDef => ({ ...d, contentHash: contentHash(d), status: 'unreviewed', provenance: { ...d.provenance, reviews: [] } }))];
  const graph = planGraph(plan, defs), map = json<any>('native-port-import-map.json');
  let circuit = json<any>('native-port-fixture.json').circuit as any[];
  // The retained port regression subset intentionally omits pcb_board. This is its declared
  // rectangular test boundary, not newly rendered/routed or manufacturing evidence.
  circuit.push({ type: 'pcb_board', pcb_board_id: 'SYNTHETIC_BOUNDARY', center: { x: 0, y: 0 }, width: plan.board!.widthMm, height: plan.board!.heightMm, num_layers: 2, min_board_edge_clearance: .2 });
  const mapping = Object.fromEntries(map.parts.map((p: any) => [p.ref, p.pins]));
  for (const p of graph.parts.filter(p => isFanoutTarget(p.part))) assert.equal(p.block.contentHash, map.parts.find((m: any) => m.ref === p.ref).blockContentHash);
  if (isolated) {
    // SYNTHETIC reduction: retain actual target IC geometry, remove neighbouring passives only
    // to test the escape generator independently of the placement legalizer. No native pass claimed.
    const sourceIds = new Set(graph.parts.filter(p => isFanoutTarget(p.part)).map(p => circuit.find(c => c.type === 'source_component' && c.name === p.ref).source_component_id));
    const owners = new Set(circuit.filter(c => c.type === 'pcb_component' && sourceIds.has(c.source_component_id)).map(c => c.pcb_component_id));
    circuit = circuit.filter(c => !['pcb_smtpad', 'pcb_plated_hole'].includes(c.type) || owners.has(c.pcb_component_id));
  }
  return { circuit, graph, mapping };
}
function component(f: ReturnType<typeof fixture>, ref: string) {
  const source = f.circuit.find(c => c.type === 'source_component' && c.name === ref);
  return f.circuit.find(c => c.type === 'pcb_component' && c.source_component_id === source.source_component_id);
}
function move(f: ReturnType<typeof fixture>, ref: string, dx: number, dy: number, quarter = 0) {
  const c = component(f, ref), centre = { ...c.center };
  const transform = (x: number, y: number) => quarter ? { x: centre.x - (y - centre.y) + dx, y: centre.y + (x - centre.x) + dy } : { x: x + dx, y: y + dy };
  for (const e of f.circuit.filter(e => e.pcb_component_id === c.pcb_component_id)) {
    if (e.points) e.points = e.points.map((p: any) => transform(p.x, p.y));
    if (typeof e.x === 'number' && typeof e.y === 'number') Object.assign(e, transform(e.x, e.y));
    if (quarter && e.width && e.height) [e.width, e.height] = [e.height, e.width];
  }
  c.center = { x: centre.x + dx, y: centre.y + dy }; c.rotation += quarter * 90;
}

test('actual dense IC pads produce outward normal stubs, preserving graph widths and immutable inputs', () => {
  const f = fixture(true), before = JSON.stringify(f), result = planFanout(f.circuit, f.graph, f.mapping);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); assert.equal(result.proposals.length, 34); assert.equal(JSON.stringify(f), before);
  assert.deepEqual(Object.fromEntries(['U2', 'U4', 'U6'].map(ref => [ref, result.proposals.filter(p => p.ref === ref).length])), { U2: 12, U4: 10, U6: 12 });
  for (const proposal of result.proposals) {
    const [a, b] = proposal.route, c = component(f, proposal.ref);
    assert.equal(proposal.route.length, 2); assert.equal(a!.layer, b!.layer); assert.equal(a!.width, b!.width);
    assert.ok(a!.x === b!.x || a!.y === b!.y); assert.ok((b!.x - a!.x) * (a!.x - c.center.x) + (b!.y - a!.y) * (a!.y - c.center.y) > 0);
    assert.ok(Math.hypot(b!.x - a!.x, b!.y - a!.y) <= 2);
    const net = f.graph.nets.find(n => n.pins.some(p => p.ref === proposal.ref && p.pad === proposal.pad))!;
    const power = net.pins.some(p => ['power-in', 'power-out', 'ground'].includes(f.graph.parts.find(g => g.ref === p.ref)!.part.pins[p.logical]!.role));
    assert.equal(a!.width, power ? .3 : .15);
  }
});

test('central exposed pads, NC pads and unconnected optional pads emit no route but remain geometry', () => {
  const f = fixture(true), result = planFanout(f.circuit, f.graph, f.mapping);
  for (const [ref, omitted] of [['U2', ['7', '9', '14', '15', '17']], ['U4', ['11']], ['U6', ['5', '6', '12', '13', '17']]] as const) assert.ok(!result.proposals.some(p => p.ref === ref && (omitted as readonly string[]).includes(p.pad)));
  const target = result.proposals.find(p => p.ref === 'U6' && p.pad === '9')!;
  const [a, b] = target.route;
  f.circuit.push({ type: 'pcb_smtpad', pcb_smtpad_id: 'SYNTHETIC_NC_OBSTACLE', pcb_component_id: 'SYNTHETIC_FOREIGN', port_hints: ['NC'], layer: 'top', shape: 'rect', x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, width: .1, height: .1 });
  const blocked = planFanout(f.circuit, f.graph, f.mapping);
  assert.equal(blocked.ok, false); assert.ok(blocked.diagnostics.some(d => d.rule === 'fanout-pad-clearance' && /SYNTHETIC_NC/.test(d.message)));
});

test('retained full placement obstructions are reported, rather than silently applying partial fanout', () => {
  const f = fixture(), result = planFanout(f.circuit, f.graph, f.mapping);
  assert.equal(result.ok, false); assert.equal(result.proposals.length, 34);
  assert.ok(result.diagnostics.some(d => d.rule === 'fanout-pad-clearance'));
  assert.equal(result.ok, !result.diagnostics.some(d => d.severity === 'error'));
});

test('cardinal component rotations are derived from actual pad geometry', () => {
  const f = fixture(true); move(f, 'U6', 0, 0, 1);
  const result = planFanout(f.circuit, f.graph, f.mapping);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const p = result.proposals.find(p => p.ref === 'U6' && p.pad === '9')!;
  assert.ok(p.route[1]!.x < p.route[0]!.x); assert.equal(p.route[1]!.y, p.route[0]!.y);
});

test('board boundary and same-layer keepouts reject a swept exit; opposite-layer keepout does not', () => {
  const edge = fixture(true); edge.circuit.find(c => c.type === 'pcb_board').width = 60;
  assert.ok(planFanout(edge.circuit, edge.graph, edge.mapping).diagnostics.some(d => d.rule === 'fanout-board'));
  const f = fixture(true), p = planFanout(f.circuit, f.graph, f.mapping).proposals.find(p => p.ref === 'U6' && p.pad === '9')!;
  const keepout = { type: 'pcb_keepout', shape: 'rect', layers: ['bottom'], center: { x: p.route[1]!.x, y: p.route[1]!.y }, width: .2, height: .2 };
  f.circuit.push(keepout); assert.equal(planFanout(f.circuit, f.graph, f.mapping).ok, true);
  keepout.layers = ['top']; assert.ok(planFanout(f.circuit, f.graph, f.mapping).diagnostics.some(d => d.rule === 'fanout-keepout'));
});

test('individually clear component exits still reject crossings with other proposed stubs', () => {
  const f = fixture(true); const c = component(f, 'U4'); move(f, 'U4', 4.7 - c.center.x, -4 - c.center.y);
  const result = planFanout(f.circuit, f.graph, f.mapping);
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(d => d.rule === 'fanout-stub-clearance'));
});

test('wrong physical mapping, arbitrary rotation and unsupported copper fail closed', () => {
  const wrong = fixture(true); wrong.mapping.U2['12'] = 'pin13';
  assert.equal(planFanout(wrong.circuit, wrong.graph, wrong.mapping).ok, false);
  const angled = fixture(true); component(angled, 'U4').rotation = 45;
  assert.ok(planFanout(angled.circuit, angled.graph, angled.mapping).diagnostics.some(d => /cardinal/.test(d.message)));
  const unknown = fixture(true); unknown.circuit.push({ type: 'pcb_smtpad', shape: 'unsupported', layer: 'top', x: 28, y: -10 });
  assert.ok(planFanout(unknown.circuit, unknown.graph, unknown.mapping).diagnostics.some(d => /Unsupported foreign pad/.test(d.message)));
});

test('missing, unknown and malformed keepout layer declarations reject the plan', () => {
  for (const layerValue of [undefined, [], ['unsupported'], ['inner1'], 'top', [7]]) {
    const f = fixture(true);
    f.circuit.push({ type: 'pcb_keepout', shape: 'rect', center: { x: 28, y: -10 }, width: 1, height: 1, ...(layerValue === undefined ? {} : { layers: layerValue }) });
    const result = planFanout(f.circuit, f.graph, f.mapping);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.some(d => /keepout layers/.test(d.message)));
  }
});

test('connected square or polygon perimeter pads cannot silently lose their required exits', () => {
  for (const shape of ['rect', 'polygon']) {
    const f = fixture(true), owner = component(f, 'U6');
    const pad = f.circuit.find(c => c.type === 'pcb_smtpad' && c.pcb_component_id === owner.pcb_component_id && c.port_hints?.includes('pin9'));
    if (shape === 'rect') { pad.width = .25; pad.height = .25; }
    else { pad.shape = 'polygon'; pad.points = [{ x: pad.x - .125, y: pad.y - .3 }, { x: pad.x + .125, y: pad.y - .3 }, { x: pad.x + .125, y: pad.y + .3 }, { x: pad.x - .125, y: pad.y + .3 }]; }
    const result = planFanout(f.circuit, f.graph, f.mapping);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.some(d => d.ref === 'U6' && /Connected noncentral pad OUTP\/9/.test(d.message)));
  }
});

test('foreign via copper and NPTH drills beneath an actual proposed stub are rejected', () => {
  for (const type of ['pcb_via', 'pcb_hole']) {
    const f = fixture(true), p = planFanout(f.circuit, f.graph, f.mapping).proposals.find(p => p.ref === 'U6' && p.pad === '9')!;
    const x = (p.route[0]!.x + p.route[1]!.x) / 2, y = (p.route[0]!.y + p.route[1]!.y) / 2;
    f.circuit.push(type === 'pcb_via' ? { type, pcb_via_id: 'SYNTHETIC_FOREIGN_VIA', x, y, outer_diameter: .6, hole_diameter: .3, layers: ['top', 'bottom'] } : { type, pcb_hole_id: 'SYNTHETIC_NPTH', x, y, hole_shape: 'circle', hole_diameter: .6 });
    const result = planFanout(f.circuit, f.graph, f.mapping);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(d => d.ref === 'U6' && d.pad === '9' && d.rule === 'fanout-drill-clearance'));
    if (type === 'pcb_via') assert.ok(result.diagnostics.some(d => d.ref === 'U6' && d.pad === '9' && d.rule === 'fanout-via-clearance'));
  }
});

test('a drill void is excluded from via copper but cannot make a drilled-away stub valid', () => {
  const f = fixture(true), p = planFanout(f.circuit, f.graph, f.mapping).proposals.find(p => p.ref === 'U6' && p.pad === '9')!;
  f.circuit.push({ type: 'pcb_via', pcb_via_id: 'SYNTHETIC_LARGE_VOID', x: p.route[0]!.x, y: (p.route[0]!.y + p.route[1]!.y) / 2, outer_diameter: 4.5, hole_diameter: 4, layers: ['top', 'bottom'] });
  const result = planFanout(f.circuit, f.graph, f.mapping), own = result.diagnostics.filter(d => d.ref === 'U6' && d.pad === '9');
  assert.equal(result.ok, false); assert.ok(own.some(d => d.rule === 'fanout-drill-clearance'));
  assert.ok(!own.some(d => d.rule === 'fanout-via-clearance'), 'The proposed copper is inside the drill void, not inside its annulus');
});

test('NPTH clearance uses at least0.2mm from swept trace copper to drill edge', () => {
  for (const [offset, expected] of [[.55, false], [.61, true]] as const) {
    const f = fixture(true), p = planFanout(f.circuit, f.graph, f.mapping).proposals.find(p => p.ref === 'U6' && p.pad === '9')!;
    f.circuit.push({ type: 'pcb_hole', pcb_hole_id: 'SYNTHETIC_OFFSET_NPTH', x: p.route[0]!.x + offset, y: (p.route[0]!.y + p.route[1]!.y) / 2, hole_shape: 'circle', hole_diameter: .6 });
    const result = planFanout(f.circuit, f.graph, f.mapping);
    assert.equal(result.ok, expected, JSON.stringify(result.diagnostics));
    if (!expected) assert.ok(result.diagnostics.some(d => d.rule === 'fanout-drill-clearance' && /0.2 mm/.test(d.message)));
  }
});

test('foreign pad layers must be present and belong to the actual board stack', () => {
  for (const layer of [undefined, 'unsupported', 'inner1']) {
    const f = fixture(true);
    f.circuit.push({ type: 'pcb_smtpad', pcb_smtpad_id: 'SYNTHETIC_LAYER_PAD', shape: 'rect', x: 28.75, y: -10.1, width: .1, height: .1, ...(layer === undefined ? {} : { layer }) });
    const result = planFanout(f.circuit, f.graph, f.mapping);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.some(d => /native pad layer/.test(d.message)));
  }
  const f = fixture(true); f.circuit.find(e => e.type === 'pcb_board').num_layers = 4;
  f.circuit.push({ type: 'pcb_smtpad', pcb_smtpad_id: 'SYNTHETIC_INNER_PAD', shape: 'rect', x: 28.75, y: -10.1, width: .1, height: .1, layer: 'inner1' });
  f.circuit.push({ type: 'pcb_via', pcb_via_id: 'SYNTHETIC_BURIED_VIA', x: 28.75, y: -10.1, outer_diameter: .6, hole_diameter: .3, layers: ['inner1', 'inner2'] });
  assert.equal(planFanout(f.circuit, f.graph, f.mapping).ok, true, 'Known inner-only copper/drill does not intersect top-layer stubs');
});

test('malformed via annuli and unknown or contradictory via layer spans fail closed', () => {
  for (const mutate of [
    (v: any) => { v.outer_diameter = v.hole_diameter; },
    (v: any) => { delete v.layers; },
    (v: any) => { v.layers = ['unsupported']; },
    (v: any) => { v.layers = ['top']; v.from_layer = 'top'; v.to_layer = 'bottom'; },
  ]) {
    const f = fixture(true), via = { type: 'pcb_via', pcb_via_id: 'SYNTHETIC_INVALID_VIA', x: 28.75, y: -10.1, outer_diameter: .6, hole_diameter: .3, layers: ['top', 'bottom'] };
    mutate(via); f.circuit.push(via);
    const result = planFanout(f.circuit, f.graph, f.mapping);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.some(d => /annulus|layers|layer span/.test(d.message)));
  }
});
