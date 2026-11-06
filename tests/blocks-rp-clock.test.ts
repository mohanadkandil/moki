import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRpClockPhase } from '../eda/blocks/rp-clock.js';
import type { PlanGraph } from '../src/blocks/graph.js';

// DERIVED ENGINEERING FIXTURE: unchanged actual RP2 electrical records joined
// with actual RP4 routing-disabled imported PCB geometry after verifying every
// source-component/port identity. It is not a new native route or DRC receipt.
const root = new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-motor/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const original = {
  circuit: read('clock-fixture-circuit.json') as any[],
  graph: read('clock-fixture-graph.json') as PlanGraph,
  mapping: read('clock-fixture-map.json') as Record<string, Record<string, string>>,
};
const fixture = () => structuredClone(original);
const run = (f: ReturnType<typeof fixture>) => createRpClockPhase(f.circuit, f.graph, f.mapping);
const source = (f: ReturnType<typeof fixture>, ref: string) =>
  f.circuit.find((e) => e.type === 'source_component' && e.name === ref);
const pad = (f: ReturnType<typeof fixture>, ref: string, pin: number) => {
  const s = source(f, ref),
    p = f.circuit.find(
      (e) =>
        e.type === 'source_port' && e.source_component_id === s.source_component_id && e.pin_number === pin,
    );
  const port = f.circuit.find((e) => e.type === 'pcb_port' && e.source_port_id === p.source_port_id);
  return f.circuit.find((e) => e.type === 'pcb_smtpad' && e.pcb_port_id === port.pcb_port_id);
};
test('finite actual RP4 profile preserves source graph, uses all three nets and passes native geometry checks', () => {
  const f = fixture(),
    before = JSON.stringify(f),
    result = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(result.audit.length, 5);
  assert.equal(result.props!.autorouter, 'auto');
  assert.equal(result.props!.phaseIndex, 0);
  assert.equal(new Set(result.props!.connections).size, 5);
  assert.deepEqual([...result.netNames].sort(), ['XIN', 'XOUT', 'XTAL_OUT']);
  for (const path of result.audit) {
    assert.ok(path.lengthMm > 0 && path.lengthMm < 10);
    assert.ok(path.route.every((p) => p.route_type === 'wire' && p.layer === 'top' && p.width === 0.15));
  }
  assert.ok(result.lengthsByNet.XIN! < 10);
  assert.ok(result.lengthsByNet.XOUT! < 10);
  assert.ok(result.lengthsByNet.XTAL_OUT! < 10);
  assert.ok(Math.abs(result.lengthsByNet.XIN! - 9.894285604544498) < 1e-7);
});
test('global reference allocation is resolved from instance/localRef and actual native IDs', () => {
  const f = fixture(),
    names = new Map(f.graph.parts.map((p) => [p.ref, 'RENAMED_' + p.ref]));
  for (const p of f.graph.parts) p.ref = names.get(p.ref)!;
  for (const n of f.graph.nets) for (const p of n.pins) p.ref = names.get(p.ref)!;
  for (const e of f.circuit) if (e.type === 'source_component') e.name = names.get(e.name) ?? e.name;
  f.mapping = Object.fromEntries(Object.entries(f.mapping).map(([ref, pins]) => [names.get(ref)!, pins]));
  const result = run(f);
  assert.ok(result.audit.every((p) => p.from.startsWith('.RENAMED_') && p.to.startsWith('.RENAMED_')));
});
test('world translation preserves native local clock profile and exact PCB endpoints', () => {
  const f = fixture(),
    dx = 2,
    dy = -1;
  for (const p of f.graph.parts) {
    p.at.x += dx;
    p.at.y += dy;
  }
  for (const e of f.circuit) {
    if (!e.type.startsWith('pcb_') || e.type === 'pcb_board') continue;
    if (typeof e.x === 'number') e.x += dx;
    if (typeof e.y === 'number') e.y += dy;
    for (const key of ['center', 'footprint_origin'])
      if (e[key]) {
        e[key].x += dx;
        e[key].y += dy;
      }
    if (Array.isArray(e.points))
      for (const p of e.points) {
        p.x += dx;
        p.y += dy;
      }
  }
  const result = run(f),
    base = run(fixture());
  assert.equal(result.audit.length, 5);
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < result.audit[i]!.route.length; j++) {
      assert.ok(Math.abs(result.audit[i]!.route[j]!.x - base.audit[i]!.route[j]!.x - dx) < 1e-7);
      assert.ok(Math.abs(result.audit[i]!.route[j]!.y - base.audit[i]!.route[j]!.y - dy) < 1e-7);
    }
});
test('foreign pad contact and clearance are checked against actual physical land geometry', () => {
  const f = fixture(),
    target = run(f).audit[0]!.route[2]!;
  const foreign = pad(f, 'U1', 19);
  foreign.x = target.x;
  foreign.y = target.y;
  assert.throws(() => run(f), /native geometry/);
});
test('drilled holes, foreign via copper, top keepouts and board edges reject the path', () => {
  for (const [mutation, mutate] of [
    (f: ReturnType<typeof fixture>, p: any) =>
      f.circuit.push({
        type: 'pcb_hole',
        pcb_hole_id: 'synthetic-clock-hole',
        hole_shape: 'circle',
        x: p.x,
        y: p.y,
        hole_diameter: 0.3,
      }),
    (f: ReturnType<typeof fixture>, p: any) =>
      f.circuit.push({
        type: 'pcb_via',
        pcb_via_id: 'synthetic-clock-via',
        x: p.x,
        y: p.y,
        hole_diameter: 0.3,
        outer_diameter: 0.6,
        layers: ['top', 'bottom'],
      }),
    (f: ReturnType<typeof fixture>, p: any) =>
      f.circuit.push({
        type: 'pcb_keepout',
        pcb_keepout_id: 'synthetic-clock-keepout',
        shape: 'rect',
        center: { x: p.x, y: p.y },
        width: 0.5,
        height: 0.5,
        layers: ['top'],
      }),
    (f: ReturnType<typeof fixture>, _p: any) => {
      const board = f.circuit.find((e) => e.type === 'pcb_board');
      board.width = 1;
      board.height = 1;
      board.outline = [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.5 },
        { x: -0.5, y: 0.5 },
      ];
    },
  ].entries()) {
    const f = fixture(),
      p = run(f).audit[0]!.route[2]!;
    mutate(f, p);
    assert.throws(() => run(f), /native geometry/, `mutation ${mutation}`);
  }
});
test('off-land ports, corrupted physical aliases, missing topology and inconsistent placement fail closed', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      const s = source(f, 'X1'),
        p = f.circuit.find(
          (e) =>
            e.type === 'source_port' && e.source_component_id === s.source_component_id && e.pin_number === 1,
        );
      const pcb = f.circuit.find((e) => e.type === 'pcb_port' && e.source_port_id === p.source_port_id);
      pcb.x += 3;
    },
    (f: ReturnType<typeof fixture>) => {
      const s = source(f, 'U1');
      f.circuit.find(
        (e) =>
          e.type === 'source_port' && e.source_component_id === s.source_component_id && e.pin_number === 20,
      ).pin_number = 21;
    },
    (f: ReturnType<typeof fixture>) => {
      const n = f.graph.nets.find((n) => n.name === 'XIN')!;
      n.pins = n.pins.filter((p) => p.ref !== 'C15');
    },
    (f: ReturnType<typeof fixture>) => {
      f.graph.parts.find((p) => p.localRef === 'X1' && p.inst === 'rp')!.at.x += 0.25;
    },
    (f: ReturnType<typeof fixture>) => {
      f.mapping.X1!['1'] = 'pin3';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f));
  }
});
test('partial routed inputs and unsupported placement profiles do not get stretched into a route', () => {
  const f = fixture();
  f.circuit.push({ type: 'pcb_trace', pcb_trace_id: 'synthetic-existing-trace', route: [] });
  assert.throws(() => run(f), /before routing/);
  const moved = fixture(),
    p = moved.graph.parts.find((p) => p.inst === 'rp' && p.localRef === 'R1')!,
    s = source(moved, p.ref),
    pcb = moved.circuit.find(
      (e) => e.type === 'pcb_component' && e.source_component_id === s.source_component_id,
    );
  p.at.x += 0.1;
  pcb.center.x += 0.1;
  pcb.footprint_origin.x += 0.1;
  assert.throws(() => run(moved), /Unsupported RP clock placement/);
  assert.equal(createRpClockPhase([], { parts: [], nets: [] }, {}).props, null);
});

test('stricter native length, width and clearance limits remain hard', () => {
  const length = fixture();
  length.circuit
    .filter(
      (e) =>
        e.type === 'source_trace' &&
        e.connected_source_net_ids?.includes(
          length.circuit.find((e) => e.type === 'source_net' && e.name === 'XIN').source_net_id,
        ),
    )
    .forEach((e) => (e.max_length = 5));
  assert.throws(() => run(length), /exceeds native 5mm maximum/);
  const width = fixture();
  width.circuit.find((e) => e.type === 'pcb_board').min_trace_width = 0.2;
  assert.throws(() => run(width), /width violates native board rule/);
  const clearance = fixture();
  clearance.circuit.find((e) => e.type === 'pcb_board').min_trace_to_pad_edge_clearance = 0.4;
  assert.throws(() => run(clearance), /native geometry/);
});
