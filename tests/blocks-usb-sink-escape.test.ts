import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUsbSinkEscapeProposals, type UsbSinkPrefix } from '../eda/blocks/usb-sink-escape.js';
import type { PlanGraph } from '../src/blocks/graph.js';

const original = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/usb-sink-escape-fixture.json', import.meta.url), 'utf8'));
const fixture = () => structuredClone(original) as { circuit: any[]; graph: PlanGraph; mapping: Record<string, Record<string, string>>; prefixes: UsbSinkPrefix[] };
const run = (f: ReturnType<typeof fixture>) => createUsbSinkEscapeProposals(f.circuit, f.graph, f.mapping, f.prefixes);
test('actual failed VBUS geometry yields six protection-chip and two CC exits against all38 existing profile paths', () => {
  const f = fixture(), before = JSON.stringify(f), r = run(f);
  assert.equal(JSON.stringify(f), before); assert.equal(f.prefixes.length, 38);
  assert.deepEqual(r.audit.map(p => `${p.ref}.${p.pad}`), ['U4.1', 'U4.2', 'U4.3', 'U4.4', 'U4.5', 'U4.6', 'R7.1', 'R8.1']);
  for (const a of r.audit) {
    assert.equal(a.widthMm, a.ref === 'U4' && ['2', '5'].includes(a.pad) ? 0.3 : 0.15);
    assert.equal(a.lengthMm, a.ref === 'U4' ? 1.0360035 : 0.9032377);
    assert.ok(a.route.every(p => p.route_type === 'wire' && p.layer === 'top' && p.width === a.widthMm));
    const source = f.circuit.find(e => e.type === 'source_trace' && e.source_trace_id === a.diagnosticSourceTraceId);
    assert.equal(source.min_trace_thickness, a.widthMm);
  }
  const vbus = r.audit.find(p => p.ref === 'U4' && p.pad === '5')!;
  assert.equal(vbus.route[0]!.y, 13.399096); assert.equal(vbus.route[1]!.y, 14.4350995);
  assert.deepEqual([...r.netNames].sort(), ['CC1', 'CC2', 'GND', 'USB_DM_EXT', 'USB_DP_EXT', 'VBUS']);
});

function rotate(f: ReturnType<typeof fixture>, quarter: number) {
  const a = quarter * Math.PI / 2;
  const pt = (p: { x: number; y: number }) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
  for (const e of f.circuit) {
    if (!e.type.startsWith('pcb_')) continue;
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) Object.assign(e, pt(e));
    for (const key of ['center', 'footprint_origin']) if (e[key]) e[key] = pt(e[key]);
    if (Array.isArray(e.outline)) e.outline = e.outline.map(pt);
    if (e.type === 'pcb_smtpad' && Array.isArray(e.points)) e.points = e.points.map(pt);
    if (e.type === 'pcb_component') e.rotation = (e.rotation + quarter * 90) % 360;
    if (e.type === 'pcb_smtpad') {
      if (e.shape === 'rect') e.shape = 'rotated_rect';
      if (e.shape === 'pill') e.shape = 'rotated_pill';
      e.ccw_rotation = ((e.ccw_rotation ?? 0) + quarter * 90) % 360;
    }
    if (e.type === 'pcb_board' && quarter % 2) [e.width, e.height] = [e.height, e.width];
  }
  for (const p of f.graph.parts) p.at = { ...pt(p.at), rotation: ((p.at.rotation ?? 0) + quarter * 90) % 360 };
  for (const p of f.prefixes) p.route = p.route.map(p => ({ ...p, ...pt(p) }));
}
test('all cardinal placements and2/4layer boards preserve actual pad normals, widths and prefix clearance', () => {
  for (const q of [0, 1, 2, 3]) for (const layers of [2, 4]) {
    const f = fixture(); rotate(f, q); f.circuit.find(e => e.type === 'pcb_board').num_layers = layers;
    const r = run(f); assert.equal(r.proposals.length, 8);
    for (const a of r.audit) assert.ok(Math.abs(Math.hypot(a.route[1]!.x - a.route[0]!.x, a.route[1]!.y - a.route[0]!.y) - a.lengthMm) < 1e-8);
  }
});
test('actual source aliases, physical pad order, supported shape and power width remain strict', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.mapping.U4!['5'] = 'pin4'; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'source_port' && e.source_component_id === 'source_component_4' && e.pin_number === 5).pin_number = 4; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'pcb_smtpad' && e.pcb_port_id === 'pcb_port_78').port_hints = ['pin4']; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'pcb_smtpad' && e.pcb_port_id === 'pcb_port_78').shape = 'pill'; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'pcb_smtpad' && e.pcb_port_id === 'pcb_port_78').width = 0; },
    (f: ReturnType<typeof fixture>) => { f.circuit.find(e => e.type === 'source_trace' && e.display_name?.startsWith('.U4 > .pin5 to ')).min_trace_thickness = 0.15; },
    (f: ReturnType<typeof fixture>) => { const b = f.circuit.find(e => e.type === 'pcb_board'); b.width = 10; delete b.outline; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => run(f)); }
});
test('foreign VBUS land at a signal exit cannot be excused by a copied same-net label', () => {
  const f = fixture(), r = run(f), signal = r.audit.find(p => p.ref === 'U4' && p.pad === '1')!, at = signal.route[1]!;
  const port = f.circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === 'pcb_port_69');
  const land = f.circuit.find(e => e.type === 'pcb_smtpad' && e.pcb_port_id === port.pcb_port_id);
  Object.assign(port, { x: at.x, y: at.y }); Object.assign(land, { x: at.x, y: at.y, source_net_id: signal.diagnosticSourceNetId });
  assert.throws(() => run(f), /foreign geometry/);
});
test('constraint endpoints, prefix identity, finite geometry and via annulus cannot be bypassed', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { const c = f.graph.parts.find(p => p.part.lcsc === 'C2040')!.block.constraints.find(c => c.kind === 'usb-c-sink')!; if (c.kind === 'usb-c-sink') c.resistors = ['R7', 'R7']; },
    (f: ReturnType<typeof fixture>) => { const c = f.graph.parts.find(p => p.part.lcsc === 'C2040')!.block.constraints.find(c => c.kind === 'usb-c-sink')!; if (c.kind === 'usb-c-sink') c.cc1 = c.cc2; },
    (f: ReturnType<typeof fixture>) => { f.prefixes[0]!.net = 'VBUS'; },
    (f: ReturnType<typeof fixture>) => { f.prefixes[0]!.route = f.prefixes[0]!.route.map((p, i) => i ? p : { ...p, x: NaN }); },
    (f: ReturnType<typeof fixture>) => { const p = f.prefixes.find(p => p.route.some(p => p.route_type === 'via'))!; p.route = p.route.map(p => p.route_type === 'via' ? { ...p, via_hole_diameter: 0.6 } : p); },
    (f: ReturnType<typeof fixture>) => { const c = f.graph.parts.find(p => p.part.lcsc === 'C2040')!; c.block.version = 99; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => run(f)); }
});
