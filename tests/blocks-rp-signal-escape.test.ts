import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNativeFanoutPhase } from '../eda/blocks/fanout.js';
import { createRpSignalEscapeProposals } from '../eda/blocks/rp-signal-escape.js';
import type { PlanGraph } from '../src/blocks/graph.js';
import type { RpClockPhase } from '../eda/blocks/rp-clock.js';
import type { RpEscapePhase } from '../eda/blocks/rp-escape.js';
import {
  checkEachPcbTraceNonOverlapping,
  checkViaTraceClearance,
} from '../eda/node_modules/@tscircuit/checks/dist/index.js';

const original = JSON.parse(
  readFileSync(
    new URL(
      '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/rp-signal-escape-fixture.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const fixture = () =>
  structuredClone(original) as {
    circuit: any[];
    graph: PlanGraph;
    mapping: Record<string, Record<string, string>>;
    clock: RpClockPhase;
    power: RpEscapePhase;
  };
const run = (f: ReturnType<typeof fixture>, excluded = new Set(['IN1', 'IN2'])) =>
  createRpSignalEscapeProposals(f.circuit, f.graph, f.mapping, f.clock, f.power, excluded);
test('actual captured65x55 geometry admits ten signal stubs against all14 power prefixes and saved clock copper', () => {
  const f = fixture(),
    before = JSON.stringify(f),
    r = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(
    r.proposals.map((p) => p.pad),
    ['2', '26', '46', '47', '51', '52', '53', '54', '55', '56'],
  );
  assert.equal(r.proposals.length, 10);
  for (const a of r.audit) {
    assert.equal(a.lengthMm, a.pad === '46' ? 0.6 : 0.925);
    assert.equal(a.route.length, 2);
    assert.ok(a.route.every((p) => p.route_type === 'wire' && p.width === 0.15 && p.layer === 'top'));
    const source = f.circuit.find(
      (e) => e.type === 'source_trace' && e.source_trace_id === a.diagnosticSourceTraceId,
    );
    assert.equal(source.min_trace_thickness, 0.15);
    assert.ok(source.connected_source_port_ids.includes(a.diagnosticSourcePortId));
    assert.ok(source.connected_source_net_ids.includes(a.diagnosticSourceNetId));
  }
});
test('GPIO14/15 physical17/18 have native accepted inside-pad handoffs when no other phase owns their nets', () => {
  const f = fixture(),
    before = JSON.stringify(f),
    result = run(f, new Set());
  assert.equal(result.proposals.length, 12);
  assert.equal(JSON.stringify(f), before);
  for (const a of result.audit.filter((a) => ['17', '18'].includes(a.pad))) {
    assert.equal(a.kind, 'inside-pad-handoff');
    assert.equal(a.lengthMm, 0.2);
    const land = f.circuit.find((e) => e.type === 'pcb_smtpad' && e.pcb_port_id === a.diagnosticPcbPortId);
    assert.ok(Math.abs(a.route[1]!.x - land.x) + 0.075 < land.width / 2);
    assert.ok(Math.abs(a.route[1]!.y - land.y) + 0.075 < land.height / 2);
  }
  const bound = createNativeFanoutPhase(f.circuit, result.proposals);
  assert.equal(bound.props!.pcbTracePaths.length, 12);
  assert.ok(bound.audit.some((a) => a.pad === '17' && a.netNames.includes('IN1')));
  assert.ok(bound.audit.some((a) => a.pad === '18' && a.netNames.includes('IN2')));
  assert.ok(
    !run(f).netNames.includes('IN1') && !run(f).netNames.includes('IN2'),
    'Explicit other-end DRV phase ownership remains respected',
  );
});
test('long outward pin17/18 candidates still collide with unchanged clock geometry', () => {
  const f = fixture(),
    result = run(f, new Set());
  const source = f.clock.audit.map((a, i) => {
    const net = f.circuit.find((e) => e.type === 'source_net' && e.name === a.net);
    const trace = f.circuit.find(
      (e) =>
        e.type === 'source_trace' &&
        e.connected_source_net_ids?.includes(net.source_net_id) &&
        e.display_name?.startsWith(a.from + ' to '),
    );
    return {
      type: 'pcb_trace',
      pcb_trace_id: 'clock_handoff_regression_' + i,
      source_trace_id: trace.source_trace_id,
      subcircuit_id: trace.subcircuit_id,
      route: structuredClone(a.route),
    };
  });
  for (const a of result.audit.filter((a) => ['17', '18'].includes(a.pad))) {
    const route = structuredClone(a.route);
    route[1]!.y = route[0]!.y - 0.925;
    const trace = {
      type: 'pcb_trace',
      pcb_trace_id: 'long_gpio_' + a.pad,
      source_trace_id: a.diagnosticSourceTraceId,
      route,
    };
    assert.ok(
      checkEachPcbTraceNonOverlapping([...structuredClone(f.circuit), ...structuredClone(source), trace], {
        minClearance: 0.127,
      }).length > 0,
    );
  }
});
test('short USB_DM stub avoids actual power45 via while a uniform1.2mm normal stub fails unchanged native DRC', () => {
  const f = fixture(),
    r = run(f),
    usb = r.audit.find((p) => p.pad === '46')!,
    power45 = f.power.audit.find((p) => p.pad === '45')!;
  const trace = {
    type: 'pcb_trace',
    pcb_trace_id: 'usb_stub_probe',
    source_trace_id: usb.diagnosticSourceTraceId,
    route: structuredClone(usb.route),
  };
  const via = {
    type: 'pcb_via' as const,
    pcb_via_id: 'actual_power45_via',
    source_net_id: power45.diagnosticSourceNetId,
    x: power45.via.x,
    y: power45.via.y,
    outer_diameter: 0.6,
    hole_diameter: 0.3,
    from_layer: 'top' as const,
    to_layer: 'bottom' as const,
    layers: ['top', 'bottom'],
  };
  assert.equal(
    checkEachPcbTraceNonOverlapping([...structuredClone(f.circuit), structuredClone(trace), via], {
      minClearance: 0.127,
    }).length,
    0,
  );
  trace.route[1]!.y = trace.route[0]!.y + 1.2;
  assert.ok(
    checkViaTraceClearance([...structuredClone(f.circuit), trace, via], { minClearance: 0.127 }).length > 0,
  );
});

function rotate(f: ReturnType<typeof fixture>, quarter: number) {
  const a = (quarter * Math.PI) / 2;
  const pt = (p: { x: number; y: number }) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  });
  for (const e of f.circuit) {
    if (!e.type.startsWith('pcb_')) continue;
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) Object.assign(e, pt(e));
    for (const field of ['center', 'footprint_origin']) if (e[field]) e[field] = pt(e[field]);
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
  for (const p of f.graph.parts)
    p.at = { ...pt(p.at), rotation: ((p.at.rotation ?? 0) + quarter * 90) % 360 };
  for (const p of f.clock.audit) p.route = p.route.map((p) => ({ ...p, ...pt(p) }));
  for (const p of f.power.audit) {
    p.route = p.route.map((p) => ({ ...p, ...pt(p) }));
    p.via = pt(p.via);
  }
}
test('all cardinal placements on2/4layers preserve physical pad normals and .15mm source widths', () => {
  for (const quarter of [0, 1, 2, 3])
    for (const layers of [2, 4]) {
      const f = fixture();
      rotate(f, quarter);
      f.circuit.find((e) => e.type === 'pcb_board').num_layers = layers;
      const r = run(f, new Set());
      assert.equal(r.proposals.length, 12);
      for (const a of r.audit)
        assert.ok(
          Math.abs(Math.hypot(a.route[1]!.x - a.route[0]!.x, a.route[1]!.y - a.route[0]!.y) - a.lengthMm) <
            1e-8,
        );
    }
});
test('real foreign VBUS pad at a free exit cannot be accepted through a copied same-net label', () => {
  const f = fixture(),
    result = run(f),
    at = result.proposals.find((p) => p.pad === '53')!.route[1]!;
  const net = f.circuit.find((e) => e.type === 'source_net' && e.name === 'VBUS');
  const sourceIds = new Set(
    f.circuit
      .filter((e) => e.type === 'source_trace' && e.connected_source_net_ids?.includes(net.source_net_id))
      .flatMap((e) => e.connected_source_port_ids),
  );
  const foreignPort = f.circuit.find(
    (e) =>
      e.type === 'pcb_port' &&
      sourceIds.has(e.source_port_id) &&
      f.circuit.some(
        (p) => p.type === 'pcb_smtpad' && p.pcb_port_id === e.pcb_port_id && p.shape !== 'polygon',
      ),
  );
  const pad = f.circuit.find((e) => e.type === 'pcb_smtpad' && e.pcb_port_id === foreignPort.pcb_port_id);
  Object.assign(pad, {
    x: at.x,
    y: at.y,
    source_net_id: result.audit.find((p) => p.pad === '53')!.diagnosticSourceNetId,
  });
  foreignPort.x = at.x;
  foreignPort.y = at.y;
  assert.throws(() => run(f), /foreign geometry/);
});
test('foreign power-via contact, unsupported source/land identity, incomplete prefixes and board bounds fail closed', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.mapping.U1!['53'] = 'pin54';
    },
    (f: ReturnType<typeof fixture>) => {
      f.circuit.find((e) => e.type === 'source_port' && e.pin_number === 53).pin_number = 54;
    },
    (f: ReturnType<typeof fixture>) => {
      f.power.audit.pop();
    },
    (f: ReturnType<typeof fixture>) => {
      f.clock.audit.pop();
    },
    (f: ReturnType<typeof fixture>) => {
      const p = f.power.audit.find((p) => p.pad === '45')!,
        via = p.route.find((p) => p.route_type === 'via')!;
      if (via.route_type === 'via') via.via_hole_diameter = 0.6;
    },
    (f: ReturnType<typeof fixture>) => {
      f.graph.parts.find((p) => p.part.lcsc === 'C2040')!.at.rotation = 45;
    },
    (f: ReturnType<typeof fixture>) => {
      const b = f.circuit.find((e) => e.type === 'pcb_board');
      b.width = 10;
      delete b.outline;
    },
    (f: ReturnType<typeof fixture>) => {
      const s = f.circuit.find(
        (e) => e.type === 'source_trace' && e.display_name?.startsWith('.U1 > .pin53 to '),
      );
      s.min_trace_thickness = 0.3;
    },
    (f: ReturnType<typeof fixture>) => {
      const at = run(f).audit.find((p) => p.pad === '53')!.route[1]!,
        p = f.power.audit.find((p) => p.pad === '45')!,
        old = { ...p.via };
      for (const r of p.route)
        if (Math.hypot(r.x - old.x, r.y - old.y) < 1e-6) {
          r.x = at.x;
          r.y = at.y;
        }
      p.via = { x: at.x, y: at.y };
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f));
  }
});
