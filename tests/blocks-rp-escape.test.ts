import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoroutingPhaseProps } from '../eda/node_modules/@tscircuit/props/dist/index.js';
import { createRpClockPhase } from '../eda/blocks/rp-clock.js';
import { createRpEscapePhase } from '../eda/blocks/rp-escape.js';
const root = new URL(
    '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/',
    import.meta.url,
  ),
  read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
function fixture() {
  const original = read('circuit.json') as any[];
  return {
    circuit: original.filter(
      (e) => !['pcb_trace', 'pcb_via', 'pcb_copper_pour'].includes(e.type) && !e.error_type,
    ),
    graph: read('plan-graph.json'),
    mapping: Object.fromEntries(read('import-map.json').parts.map((p: any) => [p.ref, p.pins])) as Record<
      string,
      Record<string, string>
    >,
  };
}
const run = (f: ReturnType<typeof fixture>) => {
  const clock = createRpClockPhase(f.circuit, f.graph, f.mapping);
  return { clock, escape: createRpEscapePhase(f.circuit, f.graph, f.mapping, clock) };
};

test('actual failed4layer placement admits14 native off-pad power/ground escapes preserving every clock limit and immutable input', () => {
  const f = fixture(),
    before = JSON.stringify(f),
    r = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.escape.audit.length, 14);
  assert.equal(r.escape.props!.autorouter, 'fanout');
  assert.equal(r.escape.props!.phaseIndex, 1);
  assert.equal(autoroutingPhaseProps.parse(r.escape.props).pcbTracePaths!.length, 14);
  assert.deepEqual(r.escape.netNames, ['GND', 'V3V3', 'VCORE']);
  assert.deepEqual(r.clock.lengthsByNet, read('clock-phase.json').lengthsByNet);
  for (const a of r.escape.audit) {
    assert.equal(a.route[0]!.route_type, 'wire');
    const via = a.route.at(-1)!;
    assert.equal(via.route_type, 'via');
    if (via.route_type === 'via') {
      assert.equal(via.via_diameter, 0.6);
      assert.equal(via.via_hole_diameter, 0.3);
      assert.equal(via.from_layer, 'top');
      assert.equal(via.to_layer, 'bottom');
    }
    assert.ok(Math.hypot(a.via.x - a.route[0]!.x, a.via.y - a.route[0]!.y) > 0.7);
  }
  assert.ok(r.escape.sourceTraceWidthOverrides.some((a) => a.pad === '19' && a.widthMm === 0.15));
  assert.ok(r.escape.sourceTraceWidthOverrides.some((a) => a.pad === '57' && a.widthMm === 0.15));
});

test('same actual profile validates on2/4layers with independently changed enclosing board sizes', () => {
  for (const layers of [2, 4])
    for (const [width, height] of [
      [65, 55],
      [75, 65],
      [90, 80],
    ]) {
      const f = fixture(),
        b = f.circuit.find((e) => e.type === 'pcb_board');
      b.num_layers = layers;
      b.width = width;
      b.height = height;
      delete b.outline;
      assert.equal(run(f).escape.audit.length, 14);
    }
});

function rotated(f: ReturnType<typeof fixture>) {
  const rot = (p: any) => {
    const x = p.x;
    p.x = -p.y;
    p.y = x;
  };
  for (const p of f.graph.parts) {
    rot(p.at);
    p.at.rotation = (p.at.rotation ?? 0) + 90;
  }
  for (const e of f.circuit) {
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) rot(e);
    for (const field of ['center', 'footprint_origin']) if (e[field]) rot(e[field]);
    if (e.type === 'pcb_component') e.rotation += 90;
    if (e.type === 'pcb_smtpad' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
    if (e.shape?.startsWith('rotated_')) e.ccw_rotation = (e.ccw_rotation ?? 0) + 90;
    if (e.type === 'pcb_plated_hole') {
      e.rect_ccw_rotation = (e.rect_ccw_rotation ?? 0) + 90;
      e.hole_ccw_rotation = (e.hole_ccw_rotation ?? 0) + 90;
    }
    for (const field of ['points', 'outline']) if (Array.isArray(e[field])) for (const p of e[field]) rot(p);
    if (e.type === 'pcb_board') [e.width, e.height] = [e.height, e.width];
    if (e.type === 'pcb_keepout' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
  }
}
test('clock and escape profiles follow actual cardinal90degree placement on4layers', () => {
  const f = fixture(),
    base = run(f);
  rotated(f);
  const r = run(f);
  assert.equal(r.escape.audit.length, 14);
  for (let i = 0; i < base.escape.audit.length; i++) {
    const a = base.escape.audit[i]!,
      b = r.escape.audit[i]!;
    assert.ok(Math.hypot(b.via.x + a.via.y, b.via.y - a.via.x) < 1e-6);
  }
  for (const name of Object.keys(base.clock.lengthsByNet))
    assert.ok(Math.abs(base.clock.lengthsByNet[name]! - r.clock.lengthsByNet[name]!) < 1e-6);
});

test('foreign copper, clock encroachment, off-board vias and native mapping mutants reject', () => {
  const initial = fixture(),
    probe = run(initial).escape.audit.find((a) => a.pad === '22')!;
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.circuit.push({
        type: 'pcb_smtpad',
        pcb_smtpad_id: 'SYNTHETIC_FOREIGN',
        pcb_component_id: 'SYNTHETIC_OWNER',
        layer: 'top',
        shape: 'rect',
        x: probe.via.x,
        y: probe.via.y,
        width: 0.4,
        height: 0.4,
      });
    },
    (f: ReturnType<typeof fixture>) => {
      f.circuit.push({
        type: 'pcb_hole',
        pcb_hole_id: 'SYNTHETIC_HOLE',
        hole_shape: 'circle',
        x: probe.via.x,
        y: probe.via.y,
        hole_diameter: 0.3,
      });
    },
    (f: ReturnType<typeof fixture>) => {
      const b = f.circuit.find((e) => e.type === 'pcb_board');
      b.width = 1;
      b.height = 1;
      delete b.outline;
    },
    (f: ReturnType<typeof fixture>) => {
      f.mapping.U1!['22'] = 'pin23';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f), /geometry|board|mapping|source graph|port|aliases/i);
  }
  const f = fixture(),
    clock = createRpClockPhase(f.circuit, f.graph, f.mapping);
  clock.audit[2]!.route[1]!.x = probe.via.x;
  clock.audit[2]!.route[1]!.y = probe.via.y;
  assert.throws(() => createRpEscapePhase(f.circuit, f.graph, f.mapping, clock), /geometry/);
});

test('captured4layer failure is a later foreign supply route, while the new pin22 escape leaves away from saved XOUT', async () => {
  const { checkEachPcbTraceNonOverlapping } = await import(
    '../eda/node_modules/@tscircuit/checks/dist/index.js'
  );
  const actual = read('circuit.json');
  assert.ok(
    checkEachPcbTraceNonOverlapping(actual).some(
      (e) => 'pcb_trace_id' in e && e.pcb_trace_id === 'saved_phase_null_0_2' && e.message.includes('0.067mm'),
    ),
  );
  const f = fixture(),
    r = run(f),
    newPath = r.escape.audit.find((a) => a.pad === '22')!.route;
  assert.ok(
    newPath[1]!.y > newPath[0]!.y,
    'inward off-pad via replaces the previously downward escape into XOUT',
  );
  assert.ok(r.clock.audit.find((a) => a.from === '.U1 > .pin21')!.route.every((p) => p.layer === 'top'));
});

test('clock and escape-only profiles fit centered55x40/40x55 boards with90degree and translated native frames', () => {
  for (const quarter of [0, 1]) {
    const f = fixture();
    if (quarter) rotated(f);
    const mcu = f.graph.parts.find((p: any) => p.part.lcsc === 'C2040'),
      dx = -mcu.at.x,
      dy = -mcu.at.y;
    const shift = (p: any) => {
      p.x += dx;
      p.y += dy;
    };
    for (const p of f.graph.parts) shift(p.at);
    for (const e of f.circuit) {
      if (e.type === 'pcb_board') continue;
      if (Number.isFinite(e.x) && Number.isFinite(e.y)) shift(e);
      for (const field of ['center', 'footprint_origin']) if (e[field]) shift(e[field]);
      for (const field of ['points', 'outline'])
        if (Array.isArray(e[field])) for (const p of e[field]) shift(p);
    }
    const board = f.circuit.find((e) => e.type === 'pcb_board');
    board.center = { x: 0, y: 0 };
    board.width = quarter ? 55 : 40;
    board.height = quarter ? 40 : 55;
    delete board.outline;
    assert.equal(run(f).escape.audit.length, 14);
    // This checks only these local clock/escape profiles and all foreign geometry
    // as obstacles; full-board placement/routing is a separate required gate.
  }
});
