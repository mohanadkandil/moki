import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNativeFanoutPhase } from '../eda/blocks/fanout.js';

// Clearly labelled DERIVED preflight fixture: original actual routed SHT board,
// retaining its four original native pcbPath records and all actual pad/source
// geometry, removing subsequent autorouter traces and vias. Not new routing proof.
const path =
  '../docs/engineering/2026-11-05-chip-level/evidence/chip_eda/sht40-board/block-tests/run-okhhnn/circuit.json';
const actual = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as any[];
function fixture() {
  return structuredClone(
    actual.filter(
      (e) =>
        e.type !== 'pcb_via' &&
        (e.type !== 'pcb_trace' ||
          ['pcb_trace_0', 'pcb_trace_1', 'pcb_trace_2', 'pcb_trace_3'].includes(e.pcb_trace_id)),
    ),
  );
}
const run = (c: any[]) => createNativeFanoutPhase(c, [], { allowPreRoutedFootprintHints: true });

test('actual SHT native local paths pass narrow preflight without mutation; default rejects', () => {
  const c = fixture(),
    before = JSON.stringify(c);
  assert.throws(() => createNativeFanoutPhase(c, []), /before routing/);
  const r = run(c);
  assert.equal(r.preRoutedFootprintHints.length, 4);
  assert.equal(r.props, null);
  assert.equal(JSON.stringify(c), before);
  assert.deepEqual(r.preRoutedFootprintHints.map((a) => a.pad).sort(), ['1', '2', '3', '4']);
});

test('incomplete, duplicate, extra routed and via paths fail closed', () => {
  const a = fixture();
  a.splice(
    a.findIndex((e) => e.type === 'pcb_trace'),
    1,
  );
  assert.throws(() => run(a), /four exact/);
  const b = fixture();
  b.push(structuredClone(b.find((e) => e.type === 'pcb_trace')));
  assert.throws(() => run(b), /four exact/);
  const c = fixture();
  c.push(
    structuredClone(
      actual.find(
        (e) =>
          e.type === 'pcb_trace' &&
          !['pcb_trace_0', 'pcb_trace_1', 'pcb_trace_2', 'pcb_trace_3'].includes(e.pcb_trace_id),
      ),
    ),
  );
  assert.throws(() => run(c), /four exact/);
  const via = fixture();
  via.push(structuredClone(actual.find((e) => e.type === 'pcb_via')));
  assert.throws(() => run(via), /routed vias/);
  const d = fixture();
  d.find((e) => e.type === 'pcb_trace').route[1].route_type = 'via';
  assert.throws(() => run(d), /geometry/);
});

test('spoofed physical source, pad binding, net and local geometry cannot unlock preflight', () => {
  for (const mutate of [
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace').route[1].x += 0.01;
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace').route[0].start_pcb_port_id = 'not-a-port';
    },
    (c: any[]) => {
      const t = c.find((e) => e.type === 'pcb_trace');
      c.find(
        (e) => e.type === 'source_trace' && e.source_trace_id === t.source_trace_id,
      ).connected_source_net_ids = ['source_net_3'];
    },
    (c: any[]) => {
      c.find(
        (e) => e.type === 'source_component' && e.manufacturer_part_number === 'SHT40-AD1B-R2',
      ).supplier_part_numbers.jlcpcb = ['C2040'];
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace').source_trace_id = 'source_trace_0';
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace').route[1].width = 0.3;
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace').route[1].end_pcb_port_id = 'pcb_port_0';
    },
  ]) {
    const c = fixture();
    mutate(c);
    assert.throws(() => run(c), /Footprint|footprint/);
  }
});

test('native foreign copper, drills, board edge and keepouts still reject retained hints', () => {
  for (const type of ['pcb_smtpad', 'pcb_hole', 'pcb_keepout', 'offboard']) {
    const c = fixture(),
      t = c.find((e) => e.type === 'pcb_trace'),
      p = { x: (t.route[0].x + t.route[1].x) / 2, y: t.route[0].y };
    if (type === 'pcb_smtpad')
      c.push({
        type,
        pcb_smtpad_id: 'SYNTHETIC_FOREIGN',
        pcb_component_id: 'SYNTHETIC_OWNER',
        shape: 'rect',
        layer: 'top',
        ...p,
        width: 0.1,
        height: 0.1,
      });
    if (type === 'pcb_hole')
      c.push({ type, pcb_hole_id: 'SYNTHETIC_DRILL', hole_shape: 'circle', ...p, hole_diameter: 0.3 });
    if (type === 'pcb_keepout')
      c.push({
        type,
        pcb_keepout_id: 'SYNTHETIC_KEEP',
        shape: 'rect',
        layers: ['top'],
        center: p,
        width: 0.1,
        height: 0.1,
      });
    if (type === 'offboard') {
      const b = c.find((e) => e.type === 'pcb_board');
      delete b.outline;
      b.center = { x: 0, y: 0 };
      b.width = 1;
      b.height = 1;
    }
    assert.throws(() => run(c), /native geometry|outside native board/);
  }
});

test('a new exit cannot cross a retained foreign-net footprint trace even when pads are clear', () => {
  const c = fixture(),
    hint = c.find((e) => e.type === 'pcb_trace'),
    a = hint.route[0],
    b = hint.route[1];
  const source = c.find((e) => e.type === 'source_component' && e.name === 'U2');
  const pin = c.find(
    (e) =>
      e.type === 'source_port' && e.source_component_id === source.source_component_id && e.pin_number === 1,
  );
  const port = c.find((e) => e.type === 'pcb_port' && e.source_port_id === pin.source_port_id);
  // Synthetic proposed target pose only: real source/port IDs retained. Place its
  // start clear of the hint, then cross the hint interior; no rendered pass claimed.
  const x = (a.x + b.x) / 2,
    y = a.y - 0.5;
  port.x = x;
  port.y = y;
  const pad = c.find((e) => e.type === 'pcb_smtpad' && e.pcb_port_id === port.pcb_port_id);
  pad.x = x;
  pad.y = y;
  const proposal = {
    ref: 'U2',
    pad: '1',
    route: [
      { route_type: 'wire' as const, x, y, layer: 'top' as const, width: 0.15 },
      { route_type: 'wire' as const, x, y: y + 1, layer: 'top' as const, width: 0.15 },
    ],
  };
  assert.throws(
    () => createNativeFanoutPhase(c, [proposal], { allowPreRoutedFootprintHints: true }),
    /retained footprint hint clearance/,
  );
});

test('actual SHT profile follows cardinal native component transforms', () => {
  for (const rotation of [90, 180, 270]) {
    const c = fixture(),
      owner = c.find((e) => e.type === 'source_component' && e.manufacturer_part_number === 'SHT40-AD1B-R2');
    const component = c.find(
        (e) => e.type === 'pcb_component' && e.source_component_id === owner.source_component_id,
      ),
      o = component.footprint_origin,
      a = (rotation * Math.PI) / 180;
    const turn = (p: any) => {
      const x = p.x - o.x,
        y = p.y - o.y;
      p.x = o.x + x * Math.cos(a) - y * Math.sin(a);
      p.y = o.y + x * Math.sin(a) + y * Math.cos(a);
    };
    for (const e of c.filter((e) => e.pcb_component_id === component.pcb_component_id)) {
      if (Number.isFinite(e.x) && Number.isFinite(e.y)) turn(e);
      if (e.type === 'pcb_smtpad' && rotation % 180) [e.width, e.height] = [e.height, e.width];
    }
    for (const e of c.filter((e) => e.type === 'pcb_trace')) for (const p of e.route) turn(p);
    component.rotation = rotation;
    assert.equal(run(c).preRoutedFootprintHints.length, 4);
  }
});
