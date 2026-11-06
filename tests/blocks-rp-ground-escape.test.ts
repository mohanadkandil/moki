import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRpClockPhase } from '../eda/blocks/rp-clock.js';
import { createRpEscapePhase } from '../eda/blocks/rp-escape.js';

const root = new URL(
    '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/',
    import.meta.url,
  ),
  read = (n: string) => JSON.parse(readFileSync(new URL(n, root), 'utf8')),
  fixture = () => read('rp-signal-escape-fixture.json');
function rotate(f: any) {
  const turn = (p: any) => {
    const x = p.x;
    p.x = -p.y;
    p.y = x;
  };
  for (const p of f.graph.parts) {
    turn(p.at);
    p.at.rotation = (p.at.rotation ?? 0) + 90;
  }
  for (const e of f.circuit) {
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) turn(e);
    for (const field of ['center', 'footprint_origin']) if (e[field]) turn(e[field]);
    if (e.type === 'pcb_component') e.rotation += 90;
    if (e.type === 'pcb_smtpad' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
    if (e.shape?.startsWith('rotated_')) e.ccw_rotation = (e.ccw_rotation ?? 0) + 90;
    if (e.type === 'pcb_plated_hole') {
      e.rect_ccw_rotation = (e.rect_ccw_rotation ?? 0) + 90;
      e.hole_ccw_rotation = (e.hole_ccw_rotation ?? 0) + 90;
    }
    for (const field of ['points', 'outline']) if (Array.isArray(e[field])) for (const p of e[field]) turn(p);
    if (e.type === 'pcb_board') [e.width, e.height] = [e.height, e.width];
    if (e.type === 'pcb_keepout' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
  }
}

const run = (f: any) => {
  const clock = createRpClockPhase(f.circuit, f.graph, f.mapping);
  return createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { groundOnly: true });
};
test('ground-only actual2/4layer cardinal profile emits exactlyTESTEN19 andEP57 with unchanged input and literal dimensions', () => {
  for (const layers of [2, 4])
    for (const turns of [0, 1, 2, 3]) {
      const f = fixture();
      f.circuit.find((e: any) => e.type === 'pcb_board').num_layers = layers;
      for (let i = 0; i < turns; i++) rotate(f);
      const before = structuredClone(f),
        r = run(f);
      assert.deepEqual(f, before);
      assert.equal(r.scope, 'finite-rp2040-ground-native-escapes');
      assert.deepEqual(
        r.audit.map((a) => a.pad),
        ['19', '57'],
      );
      assert.deepEqual(r.netNames, ['GND']);
      assert.equal(r.props!.pcbTracePaths.length, 2);
      assert.equal(r.sourceTraceWidthOverrides.length, 2);
      for (const a of r.audit) {
        assert.equal(a.route.length, 3);
        assert.equal(a.route[0]!.route_type, 'wire');
        assert.equal(a.route[1]!.route_type, 'wire');
        assert.equal(a.route[2]!.route_type, 'via');
        const v = a.route[2]!;
        if (v.route_type === 'via') {
          assert.equal(v.via_diameter, 0.6);
          assert.equal(v.via_hole_diameter, 0.3);
          assert.equal(v.from_layer, 'top');
          assert.equal(v.to_layer, 'bottom');
        }
        for (const p of a.route)
          if (p.route_type === 'wire') {
            assert.equal(p.width, 0.15);
            assert.equal(p.layer, 'top');
          }
      }
    }
});
test('unused power barrel collision is excluded before preflight while actual obstacles remain checked', () => {
  const f = fixture(),
    clock = createRpClockPhase(f.circuit, f.graph, f.mapping),
    full = createRpEscapePhase(f.circuit, f.graph, f.mapping, clock),
    unused = full.audit.find((a) => a.pad === '22')!;
  f.circuit.push({
    type: 'pcb_hole',
    pcb_hole_id: 'DERIVED_UNUSED_POWER_EXIT_DRILL',
    x: unused.via.x,
    y: unused.via.y,
    hole_shape: 'circle',
    hole_diameter: 0.1,
  });
  assert.equal(
    createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { groundOnly: true }).audit.length,
    2,
  );
  assert.throws(() => createRpEscapePhase(f.circuit, f.graph, f.mapping, clock), /geometry/);
});
test('ground-only requires actual ground flags,canonical net/role/source/map/pad identity and rejects collisions', () => {
  const probe = run(fixture());
  for (const change of [
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'source_net' && e.name === 'GND').is_ground = false;
    },
    (f: any) => {
      f.graph.parts.find((p: any) => p.part.lcsc === 'C2040').part.pins['57'].role = 'power-in';
    },
    (f: any) => {
      f.graph.parts.find((p: any) => p.part.lcsc === 'C2040').part.pins['19'].role = 'bidirectional';
    },
    (f: any) => {
      f.mapping.U1['19'] = 'pin22';
    },
    (f: any) => {
      const a = probe.audit[0]!;
      f.circuit.find(
        (e: any) => e.type === 'source_trace' && e.source_trace_id === a.diagnosticSourceTraceId,
      ).connected_source_net_ids = ['foreign-net'];
    },
    (f: any) => {
      const a = probe.audit[1]!;
      f.circuit = f.circuit.filter(
        (e: any) => e.type !== 'pcb_smtpad' || e.pcb_port_id !== a.diagnosticPcbPortId,
      );
    },
    (f: any) => {
      const a = probe.audit[1]!;
      f.circuit.push({
        type: 'pcb_hole',
        pcb_hole_id: 'DERIVED_GROUND_EXIT_DRILL',
        x: a.via.x,
        y: a.via.y,
        hole_shape: 'circle',
        hole_diameter: 0.3,
      });
    },
    (f: any) => {
      const a = probe.audit[0]!;
      f.circuit.push({
        type: 'pcb_smtpad',
        pcb_smtpad_id: 'DERIVED_FOREIGN',
        pcb_component_id: 'foreign',
        layer: 'top',
        shape: 'rect',
        x: a.via.x,
        y: a.via.y,
        width: 0.4,
        height: 0.4,
      });
    },
    (f: any) => {
      const b = f.circuit.find((e: any) => e.type === 'pcb_board');
      b.width = 1;
      b.height = 1;
      delete b.outline;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => run(f));
  }
});
test('ground-only conflicts fail and all prior default/application/coupled counts and scope remain unchanged', () => {
  const f = fixture(),
    clock = createRpClockPhase(f.circuit, f.graph, f.mapping),
    plain = createRpEscapePhase(f.circuit, f.graph, f.mapping, clock);
  assert.deepEqual(createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { groundOnly: false }), plain);
  assert.equal(plain.audit.length, 14);
  assert.equal(
    createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { applicationVias: true }).audit.length,
    16,
  );
  assert.equal(
    createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { applicationVias: true, usbVias: true }).audit
      .length,
    18,
  );
  for (const options of [
    { groundOnly: true, applicationVias: true },
    { groundOnly: true, usbVias: true },
    { groundOnly: 'yes' },
    null,
    { groundOnly: true, unknown: true },
  ])
    assert.throws(
      () => createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, options as any),
      /options|ground-only/,
    );
});

test('saved foreign oscillator copper through a selected ground escape remains a hard native preflight failure', () => {
  const f = fixture(),
    clock = createRpClockPhase(f.circuit, f.graph, f.mapping),
    ground = createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { groundOnly: true });
  const target = ground.audit[0]!.via,
    changed = structuredClone(clock);
  Object.assign(changed.audit[0]!.route[2]!, { x: target.x, y: target.y });
  assert.throws(
    () => createRpEscapePhase(f.circuit, f.graph, f.mapping, changed, { groundOnly: true }),
    /geometry/,
  );
});
