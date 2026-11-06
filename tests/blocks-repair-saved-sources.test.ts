import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repairSavedSources } from '../eda/blocks/repair-saved-sources.js';
import { cjuIndexed } from '../eda/node_modules/@tscircuit/circuit-json-util/dist/index.js';
import {
  convertCircuitJsonToInputProblem,
  CopperPourPipelineSolver,
  initializeManifoldGeometry,
} from '../eda/node_modules/@tscircuit/copper-pour-solver/dist/index.js';
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkViaTraceClearance,
} from '../eda/node_modules/@tscircuit/checks/dist/index.js';
const root = new URL(
  '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/usb-buck/saved-sources/',
  import.meta.url,
);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
function fixture() {
  return {
    circuit: read('circuit.json') as any[],
    graph: read('plan-graph.json'),
    mapping: Object.fromEntries(read('import-map.json').parts.map((p: any) => [p.ref, p.pins])) as Record<
      string,
      Record<string, string>
    >,
    phase: read('fanout-phase.json'),
    inputs: read('native-routing.json'),
  };
}
const run = (f: ReturnType<typeof fixture>) =>
  repairSavedSources(f.circuit, f.graph, f.mapping, f.phase, { nativeRoutingInputs: f.inputs });
const checks = (c: any[]) => {
  const x = structuredClone(c);
  return [...checkEachPcbTraceNonOverlapping(x), ...checkPadTraceClearance(x), ...checkViaTraceClearance(x)];
};
const join = (f: ReturnType<typeof fixture>) =>
  f.circuit.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === 'source_net_1_mst7_0');
const prefix = (f: ReturnType<typeof fixture>) =>
  f.circuit.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === 'saved_phase_null_1_0');

test('actual native air blank saved-exit join repairs only metadata; official14 errors become10 with .052 real clearance retained', () => {
  const f = fixture(),
    before = JSON.stringify(f),
    result = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(result.audit.length, 1);
  assert.equal(result.audit[0]!.kind, 'saved-exit-join');
  assert.equal(result.audit[0]!.sourceNetId, 'source_net_1');
  assert.equal(result.audit[0]!.sourceTraceId, 'source_trace_38');
  assert.deepEqual(result.unrepairedTraceIds, []);
  for (let i = 0; i < f.circuit.length; i++) {
    const original = f.circuit[i],
      repaired = result.circuit[i];
    if (original.pcb_trace_id !== 'source_net_1_mst7_0') assert.deepEqual(repaired, original);
    else {
      const { source_trace_id, source_net_id, ...fields } = repaired;
      assert.deepEqual(fields, original);
    }
  }
  const old = checks(f.circuit),
    fresh = checks(result.circuit);
  assert.equal(old.length, 14);
  assert.equal(fresh.length, 10);
  assert.ok(old.some((e) => e.message.includes('unnamed trace (accidental contact)')));
  assert.ok(!fresh.some((e) => e.message.includes('unnamed trace (accidental contact)')));
  for (const clearance of ['0.052mm', '0.051mm', '0.071mm', '0.107mm'])
    assert.ok(
      fresh.some((e) => e.message.includes(clearance)),
      `real${clearance} failure retained`,
    );
  assert.equal(
    fresh.filter((e) => e.type === 'pcb_via_trace_clearance_error').length,
    old.filter((e) => e.type === 'pcb_via_trace_clearance_error').length,
  );
  // Existing failure records are never discarded by the repair; caller regenerates DRC explicitly.
  assert.deepEqual(
    result.circuit.filter((e) => e.error_type),
    f.circuit.filter((e) => e.error_type),
  );
});

test('lost saved-prefix sources bind uniquely to actual canonical physical pads and compiler sources', () => {
  const f = fixture();
  for (const t of f.circuit.filter(
    (e) => e.type === 'pcb_trace' && e.pcb_trace_id.startsWith('saved_phase_'),
  ))
    t.source_trace_id = '';
  const result = run(f);
  assert.equal(result.audit.filter((a) => a.kind === 'saved-prefix').length, 14);
  assert.equal(result.audit.filter((a) => a.kind === 'saved-exit-join').length, 1);
  const actual = fixture().circuit;
  for (const t of result.circuit.filter((e) => e.type === 'pcb_trace'))
    assert.deepEqual(t.route, actual.find((e) => e.pcb_trace_id === t.pcb_trace_id)!.route);
});

test('without native-input proof blank join stays unrepaired, and repeated repair is idempotent', () => {
  const f = fixture();
  const bounded = repairSavedSources(f.circuit, f.graph, f.mapping, f.phase);
  assert.equal(bounded.audit.length, 0);
  assert.deepEqual(bounded.unrepairedTraceIds, ['source_net_1_mst7_0']);
  const full = run(f);
  f.circuit = full.circuit;
  assert.equal(run(f).audit.length, 0);
  assert.deepEqual(run(f).circuit, full.circuit);
  const unknown = fixture();
  join(unknown).pcb_trace_id = 'unknown-blank-native-trace';
  assert.deepEqual(run(unknown).unrepairedTraceIds, ['unknown-blank-native-trace']);
});

test('shifted prefix, width, wrong pad/source identity and ambiguous compiler source reject', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      prefix(f).route[1].x += 0.001;
      prefix(f).source_trace_id = '';
    },
    (f: ReturnType<typeof fixture>) => {
      prefix(f).route[0].width = 0.15;
      prefix(f).source_trace_id = '';
    },
    (f: ReturnType<typeof fixture>) => {
      f.phase.props.pcbTracePaths[0].connection = '.U2 > .pin2';
    },
    (f: ReturnType<typeof fixture>) => {
      f.mapping.U2!['1'] = 'pin2';
    },
    (f: ReturnType<typeof fixture>) => {
      prefix(f).route[0].start_pcb_port_id = 'pcb_port_96';
    },
    (f: ReturnType<typeof fixture>) => {
      f.circuit.push(
        structuredClone(
          f.circuit.find((e) => e.type === 'source_trace' && e.source_trace_id === 'source_trace_38'),
        ),
      );
    },
    (f: ReturnType<typeof fixture>) => {
      prefix(f).source_trace_id = 'source_trace_95';
    },
    (f: ReturnType<typeof fixture>) => {
      prefix(f).pcb_trace_id = 'saved_phase_null_2_0';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f), /Saved|saved/);
  }
});

test('join native identity, net, audited endpoints, route envelope and capture mutants reject', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      join(f).connection_name = 'source_net_0';
    },
    (f: ReturnType<typeof fixture>) => {
      join(f).source_net_id = 'source_net_0';
    },
    (f: ReturnType<typeof fixture>) => {
      join(f).connectsTo[0] = 'saved_phase_null_1_999_exit';
    },
    (f: ReturnType<typeof fixture>) => {
      join(f).connectsTo[0] = 'saved_phase_null_1_2_exit';
    },
    (f: ReturnType<typeof fixture>) => {
      join(f).route[0].x -= 1;
    },
    (f: ReturnType<typeof fixture>) => {
      join(f).route[5].width = 0.15;
    },
    (f: ReturnType<typeof fixture>) => {
      join(f).subcircuit_id = 'foreign-subcircuit';
    },
    (f: ReturnType<typeof fixture>) => {
      f.inputs = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.inputs.push(structuredClone(f.inputs[2]));
    },
    (f: ReturnType<typeof fixture>) => {
      f.inputs[2].input.input.connections
        .find((c: any) => c.name === 'source_net_1')
        .pointsToConnect.find((p: any) => p.pointId === 'saved_phase_null_1_0_exit').x += 0.001;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f), /join|routing|saved|canonical/i);
  }
});

test('pre-pour database attribution makes actual join a foreign GND obstacle and regenerated pour clears its copper', async () => {
  const f = fixture();
  // DERIVED pre-pour state: remove completed pours and their marking metadata;
  // all original trace coordinate/width/layer geometry and source records remain.
  const pre = f.circuit.filter((e) => e.type !== 'pcb_copper_pour');
  for (const t of pre.filter((e) => e.type === 'pcb_trace'))
    for (const p of t.route) {
      delete p.is_inside_copper_pour;
      delete p.copper_pour_id;
    }
  // Native DRC adds port markers only later; remove them to exercise the real
  // hook timing rather than relying on the captured post-DRC annotation.
  for (const t of pre.filter((e) => e.type === 'pcb_trace' && e.pcb_trace_id.startsWith('saved_phase_')))
    for (const p of t.route) {
      delete p.start_pcb_port_id;
      delete p.end_pcb_port_id;
    }
  const db = cjuIndexed(structuredClone(pre), { indexConfig: { byId: true, byType: true } });
  const gnd = pre.find((e) => e.type === 'source_net' && e.name === 'GND'),
    actualJoin = pre.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === 'source_net_1_mst7_0');
  const options = {
    layer: 'top' as const,
    source_net_id: gnd.source_net_id,
    subcircuit_id: gnd.subcircuit_id,
    pad_margin: 0.127,
    trace_margin: 0.127,
    board_edge_margin: 0,
    outline: [
      { x: -4, y: -11 },
      { x: 2, y: -11 },
      { x: 2, y: -5 },
      { x: -4, y: -5 },
    ],
  };
  const before = convertCircuitJsonToInputProblem(db.toArray(), options);
  const fixed = repairSavedSources(db.toArray(), f.graph, f.mapping, f.phase, {
    nativeRoutingInputs: f.inputs,
  });
  assert.equal(fixed.audit.length, 1);
  for (const a of fixed.audit) {
    const t = fixed.circuit.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === a.pcbTraceId)!;
    db.pcb_trace.update(a.pcbTraceId, {
      source_trace_id: t.source_trace_id,
      source_net_id: t.source_net_id,
    } as any);
  }
  const after = convertCircuitJsonToInputProblem(db.toArray(), options);
  const target = (input: typeof before) =>
    input.pads.filter((p) => p.padId.startsWith(actualJoin.pcb_trace_id + '-'));
  assert.equal(target(before).length, 0, 'Unattributed copper is omitted by the native converter');
  assert.equal(target(after).length, 1);
  assert.notEqual(
    target(after)[0]!.connectivityKey,
    after.regionsForPour[0]!.connectivityKey,
    'Attributed V3V3 trace must block the GND region',
  );
  assert.match(target(after)[0]!.connectivityKey, /connectivity_net1$/);
  assert.deepEqual(db.pcb_trace.get(actualJoin.pcb_trace_id)!.route, actualJoin.route);
  assert.deepEqual(
    db.toArray().filter((e) => e.type.startsWith('source_')),
    pre.filter((e) => e.type.startsWith('source_')),
  );
  await initializeManifoldGeometry();
  // Bounded6x6mm official solver on just the actual join obstacle. This is not a
  // native board render or router run, and does not claim full-board acceptance.
  const minimal = (input: typeof before) => ({ regionsForPour: input.regionsForPour, pads: target(input) });
  const oldPours = new CopperPourPipelineSolver(minimal(before)).getOutput().brep_shapes;
  const newPours = new CopperPourPipelineSolver(minimal(after)).getOutput().brep_shapes;
  assert.equal(oldPours.length, 1);
  assert.equal(newPours.length, 1);
  assert.equal(oldPours[0]!.inner_rings.length, 0);
  assert.equal(newPours[0]!.inner_rings.length, 1);
  const inside = (point: any, vertices: any[]) => {
    let hit = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i],
        b = vertices[j];
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
        hit = !hit;
    }
    return hit;
  };
  const sample = actualJoin.route[10];
  assert.ok(inside(sample, oldPours[0]!.outer_ring.vertices));
  assert.ok(
    inside(sample, newPours[0]!.inner_rings[0]!.vertices),
    'Regenerated GND pour must physically clear the actual join centerline',
  );
});

test('pre-pour prefixes without later DRC markers repair lost sources without inventing route markers', () => {
  const f = fixture();
  for (const t of f.circuit.filter(
    (e) => e.type === 'pcb_trace' && e.pcb_trace_id.startsWith('saved_phase_'),
  )) {
    t.source_trace_id = '';
    for (const p of t.route) {
      delete p.start_pcb_port_id;
      delete p.end_pcb_port_id;
    }
  }
  const before = JSON.stringify(f),
    r = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.audit.filter((a) => a.kind === 'saved-prefix').length, 14);
  assert.equal(r.audit.filter((a) => a.kind === 'saved-exit-join').length, 1);
  for (const t of r.circuit.filter((e) => e.type === 'pcb_trace'))
    assert.deepEqual(t.route, f.circuit.find((e) => e.pcb_trace_id === t.pcb_trace_id)!.route);
  for (const marker of ['pcb_port_96', null, '']) {
    const bad = fixture();
    prefix(bad).route[0].start_pcb_port_id = marker;
    assert.throws(() => run(bad), /actual pad\/port start binding/);
  }
});
