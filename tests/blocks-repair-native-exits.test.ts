import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repairNativeExits, type NativeExitPhaseEvidence } from '../eda/blocks/repair-native-exits.js';
// Actual native saved-path serialization + actual native follow-up SRJ from a
// two-resistor four-layer render. Follow-up callback only returned existing
// prefixes: NO pathfinder ran. Joins below are explicitly DERIVED pure mutations.
const root = new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
function fixture() {
  const saved = read('native-exit-serialization.json'),
    circuit = saved.circuit as any[];
  const mapping = { R1: { '1': 'pin1', '2': 'pin2' }, R2: { '1': 'pin1', '2': 'pin2' } };
  const graph: any = {
    parts: ['R1', 'R2'].map((ref) => ({
      ref,
      inst: ref,
      localRef: ref,
      part: { pins: { '1': { pad: '1', role: 'passive' }, '2': { pad: '2', role: 'passive' } } },
    })),
    nets: [{ name: 'SUPPLY', pins: ['R1', 'R2'].map((ref) => ({ ref, pad: '1', logical: '1' })) }],
  };
  const phase: NativeExitPhaseEvidence = {
    props: { phaseIndex: 1, pcbTracePaths: saved.paths },
    audit: saved.paths.map((path: any, i: number) => ({
      ref: `R${i + 1}`,
      pad: '1',
      netName: 'SUPPLY',
      route: structuredClone(path.route),
    })),
  };
  const captures = saved.captures.map((input: any) => ({
    solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph',
    input: { input },
  }));
  return { circuit, mapping, graph, phase, captures };
}
function addJoin(f: ReturnType<typeof fixture>, withVias = false) {
  const prefixes = f.circuit.filter((e) => e.type === 'pcb_trace'),
    ends = prefixes.map((p) => p.route.at(-1));
  const source = f.circuit.find((e) => e.type === 'source_trace'),
    net = f.circuit.find((e) => e.type === 'source_net' && e.name === 'SUPPLY');
  const wire = (x: number, y: number, layer = 'bottom') => ({ route_type: 'wire', x, y, width: 0.15, layer });
  const route: any[] = [wire(ends[0].x, ends[0].y), wire(ends[0].x + 1, ends[0].y)];
  if (withVias) {
    route.push(
      {
        route_type: 'via',
        x: ends[0].x + 1,
        y: ends[0].y,
        from_layer: 'bottom',
        to_layer: 'inner1',
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
      wire(ends[0].x + 1, ends[0].y, 'inner1'),
      wire(ends[1].x - 1, ends[1].y, 'inner1'),
      {
        route_type: 'via',
        x: ends[1].x - 1,
        y: ends[1].y,
        from_layer: 'inner1',
        to_layer: 'bottom',
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
      wire(ends[1].x - 1, ends[1].y),
    );
  }
  route.push(wire(ends[1].x, ends[1].y));
  const join: any = {
    type: 'pcb_trace',
    pcb_trace_id: net.source_net_id + '_mst0_0',
    connection_name: net.source_net_id,
    subcircuit_id: source.subcircuit_id,
    connectsTo: prefixes.map((p) => p.pcb_trace_id + '_exit'),
    route,
  };
  f.circuit.unshift(join); // Real engine can materialize joins before the prefixes.
  for (const [i, p] of route.filter((p) => p.route_type === 'via').entries())
    f.circuit.push({
      type: 'pcb_via',
      pcb_via_id: 'DERIVED_JOIN_VIA_' + i,
      pcb_trace_id: join.pcb_trace_id,
      x: p.x,
      y: p.y,
      outer_diameter: 0.6,
      hole_diameter: 0.3,
      layers: ['top', 'inner1', 'inner2', 'bottom'],
      from_layer: p.from_layer,
      to_layer: p.to_layer,
      subcircuit_id: source.subcircuit_id,
      subcircuit_connectivity_map_key: source.subcircuit_connectivity_map_key,
    });
  return join;
}
const run = (f: ReturnType<typeof fixture>) =>
  repairNativeExits(f.circuit, f.graph, f.mapping, [f.phase], { nativeRoutingInputs: f.captures });
test('actual native terminal-via serialization binds exact audited prefixes and physical barrels without geometry or diagnostic changes', () => {
  const f = fixture();
  for (const p of f.circuit.filter((e) => e.type === 'pcb_trace')) {
    p.source_trace_id = '';
    delete p.route[0].start_pcb_port_id;
  }
  const before = JSON.stringify(f),
    r = run(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.audit.length, 2);
  assert.deepEqual(r.unrepairedTraceIds, []);
  assert.equal(f.circuit.filter((e) => e.type === 'pcb_trace')[0].route.length, 6);
  for (let i = 0; i < f.circuit.length; i++) {
    const a = structuredClone(f.circuit[i]),
      b = structuredClone(r.circuit[i]);
    if (a.type === 'pcb_trace') {
      delete a.source_trace_id;
      delete a.source_net_id;
      delete b.source_trace_id;
      delete b.source_net_id;
    }
    assert.deepEqual(b, a);
  }
  assert.equal(run({ ...f, circuit: r.circuit }).audit.length, 0);
});
test('derived same-net via-exit joins require real native endpoint capture; bottom and inner-layer paths preserve all geometry', () => {
  for (const withVias of [false, true]) {
    const f = fixture(),
      join = addJoin(f, withVias),
      before = structuredClone(join),
      r = run(f);
    assert.equal(r.audit.length, 1);
    assert.equal(r.audit[0]!.kind, 'saved-exit-join');
    assert.deepEqual(r.circuit.find((e) => e.pcb_trace_id === join.pcb_trace_id)!.route, before.route);
    assert.deepEqual(r.unrepairedTraceIds, []);
  }
  const f = fixture(),
    join = addJoin(f);
  const r = repairNativeExits(f.circuit, f.graph, f.mapping, [f.phase]);
  assert.ok(r.unrepairedTraceIds.includes(join.pcb_trace_id));
});
test('wrong actual via dimensions, spans, source keys, prefix widths/geometry/identity and existing metadata reject', () => {
  for (const mutate of [
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').hole_diameter = 0.6;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').layers = ['top', 'bottom'];
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').subcircuit_connectivity_map_key = 'foreign';
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_trace').route[1].x += 0.001;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_trace').route[0].width = 0.3;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_trace').route[0].start_pcb_port_id = null;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_trace').source_trace_id = 'foreign';
    },
    (f: any) => {
      f.phase.audit[0].netName = 'GND';
    },
    (f: any) => {
      f.mapping.R1['1'] = 'pin2';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f), /Native exit/);
  }
});
test('join capture, real annular contact, continuity and actual route-via ownership mutants fail closed', () => {
  for (const mutate of [
    (f: any, j: any) => {
      j.source_net_id = 'foreign';
    },
    (f: any, j: any) => {
      j.route[0].x += 1;
    },
    (f: any, j: any) => {
      j.route[1].width = 0.2;
    },
    (f: any, j: any) => {
      j.route[1].layer = 'top';
    },
    (f: any, j: any) => {
      f.captures.push(structuredClone(f.captures[0]));
    },
    (f: any, j: any) => {
      f.captures[0].input.input.connections[0].pointsToConnect[0].x += 0.001;
    },
    (f: any, j: any) => {
      f.circuit.find((e: any) => e.pcb_via_id === 'DERIVED_JOIN_VIA_0').outer_diameter = 0.7;
    },
  ]) {
    const f = fixture(),
      j = addJoin(f, true);
    mutate(f, j);
    assert.throws(() => run(f), /Native/);
  }
  const f = fixture(),
    j = addJoin(f);
  j.route = [j.route[0], { ...j.route[0], x: j.route[0].x + 0.001 }];
  assert.throws(() => run(f), /physical/);
});
test('unknown blank and unmatched failures remain visible rather than guessed or filtered', () => {
  const f = fixture();
  f.circuit.push(
    { type: 'pcb_trace', pcb_trace_id: 'unknown', route: [] },
    { type: 'pcb_autorouting_error', message: 'DERIVED unresolved native error' },
  );
  const r = run(f);
  assert.deepEqual(r.unrepairedTraceIds, ['unknown']);
  assert.ok(
    r.circuit.some(
      (e) => e.type === 'pcb_autorouting_error' && e.message === 'DERIVED unresolved native error',
    ),
  );
});
test('actual old SHT straight-prefix native join remains supported by the new independent proof', () => {
  const dir = 'usb-buck/saved-sources/',
    circuit = read(dir + 'circuit.json'),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    phase = read(dir + 'fanout-phase.json');
  const evidence = {
    props: phase.props,
    audit: phase.audit.map((a: any, i: number) => ({
      ...a,
      netName: a.netNames[0],
      route: phase.props.pcbTracePaths[i].route,
    })),
  };
  const r = repairNativeExits(circuit, graph, mapping, [evidence], {
    nativeRoutingInputs: read(dir + 'native-routing.json'),
  });
  assert.equal(r.audit.length, 1);
  assert.equal(r.audit[0]!.pcbTraceId, 'source_net_1_mst7_0');
  assert.deepEqual(r.unrepairedTraceIds, []);
});
test('native variable-width joins stay inside board minimum and captured nominal without using width as source identity', () => {
  const f = fixture(),
    j = addJoin(f, true);
  for (const capture of f.captures)
    for (const connection of capture.input.input.connections) {
      connection.width = 0.3;
      connection.nominalTraceWidth = 0.3;
    }
  for (let i = 0; i < j.route.length; i++)
    if (j.route[i].route_type === 'wire') j.route[i].width = i % 2 ? 0.3 : 0.15;
  assert.equal(run(f).audit.length, 1);
  for (const width of [0.14, 0.31]) {
    const bad = structuredClone(f);
    bad.circuit.find((e: any) => e.pcb_trace_id === j.pcb_trace_id).route[1].width = width;
    assert.throws(() => run(bad), /width/);
  }
});
test('only proved missing physical via keys are completed; conflicts and preattributed foreign join sources reject', () => {
  const f = fixture(),
    j = addJoin(f, true);
  for (const via of f.circuit.filter((e) => e.type === 'pcb_via')) delete via.subcircuit_connectivity_map_key;
  const before = structuredClone(f),
    r = run(f);
  assert.equal(r.viaAudit.length, 4);
  assert.deepEqual(f, before);
  for (const change of r.viaAudit) {
    const original = f.circuit.find((e) => e.pcb_via_id === change.pcbViaId),
      fixed = r.circuit.find((e) => e.pcb_via_id === change.pcbViaId),
      { subcircuit_connectivity_map_key, ...unchanged } = fixed;
    assert.deepEqual(unchanged, original);
    assert.equal(subcircuit_connectivity_map_key, change.connectivityKey);
  }
  const wrong = fixture(),
    join = addJoin(wrong);
  join.source_trace_id = 'foreign';
  assert.throws(() => run(wrong), /existing native join source/);
  const conflict = fixture();
  addJoin(conflict, true);
  conflict.circuit.find((e) => e.pcb_via_id === 'DERIVED_JOIN_VIA_0').subcircuit_connectivity_map_key =
    'foreign';
  assert.throws(() => run(conflict), /source differ/);
  const already = fixture(),
    existing = addJoin(already);
  existing.source_trace_id = already.circuit.find((e) => e.type === 'source_trace').source_trace_id;
  assert.equal(run(already).audit.length, 0);
});
test('derived native serialization of all14 actual RP profile exits proves exposed-pad aliases and source ownership', async () => {
  const { createRpClockPhase } = await import('../eda/blocks/rp-clock.js');
  const { createRpEscapePhase } = await import('../eda/blocks/rp-escape.js');
  const dir = 'rp-routing-robust/',
    circuit = read(dir + 'circuit.json').filter(
      (e: any) => !['pcb_trace', 'pcb_via', 'pcb_copper_pour'].includes(e.type) && !e.error_type,
    ),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins]));
  const originalPhase = createRpEscapePhase(
    circuit,
    graph,
    mapping,
    createRpClockPhase(circuit, graph, mapping),
  );
  assert.ok(originalPhase.props);
  const phase = { ...originalPhase, props: { ...originalPhase.props!, phaseIndex: 2 } };
  // DERIVED serialization follows the independently captured small native via
  // expansion. Original actual source/pad records stay untouched; no route runs.
  for (const [index, a] of phase.audit.entries()) {
    const source = circuit.find(
        (e: any) => e.type === 'source_trace' && e.source_trace_id === a.diagnosticSourceTraceId,
      ),
      last = a.route.at(-1)!,
      width = 0.15;
    const contact = (layer: string) => ({ route_type: 'wire', x: last.x, y: last.y, layer, width });
    const route = [...a.route.slice(0, -1), contact('top'), last, contact('bottom'), contact('bottom')];
    const pcb_trace_id = `saved_phase_null_2_${index}`;
    circuit.push({
      type: 'pcb_trace',
      pcb_trace_id,
      connection_name: a.diagnosticSourceNetId,
      subcircuit_id: source.subcircuit_id,
      route,
    });
    circuit.push({
      type: 'pcb_via',
      pcb_via_id: 'DERIVED_RP_' + index,
      pcb_trace_id,
      x: last.x,
      y: last.y,
      outer_diameter: 0.6,
      hole_diameter: 0.3,
      from_layer: 'top',
      to_layer: 'bottom',
      layers: ['top', 'inner1', 'inner2', 'bottom'],
      subcircuit_id: source.subcircuit_id,
      subcircuit_connectivity_map_key: source.subcircuit_connectivity_map_key,
    });
  }
  const result = repairNativeExits(circuit, graph, mapping, [phase as NativeExitPhaseEvidence]);
  assert.equal(result.audit.length, 14);
  assert.deepEqual(result.unrepairedTraceIds, []);
});
test('unexpected interior, wrong endpoint and foreign marker metadata rejects without inventing absent markers', () => {
  for (const mutate of [
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_trace').route[1].start_pcb_port_id = 'pcb_port_0';
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_trace').route.at(-1).end_pcb_port_id = 'pcb_port_0';
    },
    (f: any) => {
      addJoin(f).route[0].start_pcb_port_id = 'pcb_port_0';
    },
    (f: any) => {
      addJoin(f).route.at(-1).end_pcb_port_id = null;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f), /marker|marked/);
  }
});
test('two-layer derived barrel span is accepted only when the complete physical stack agrees', () => {
  const f = fixture();
  f.circuit.find((e) => e.type === 'pcb_board').num_layers = 2;
  for (const via of f.circuit.filter((e) => e.type === 'pcb_via')) via.layers = ['top', 'bottom'];
  assert.deepEqual(run(f).unrepairedTraceIds, []);
  f.circuit.find((e) => e.type === 'pcb_via').layers = ['top', 'inner1', 'inner2', 'bottom'];
  assert.throws(() => run(f), /span/);
});
test('an actual-coordinate same-net endpoint marker is proved, while a foreign physical pin marker rejects', () => {
  // DERIVED straight endpoint source proof only; no claim this new path passes DRC.
  const f = fixture(),
    prefix = f.circuit.find((e) => e.type === 'pcb_trace'),
    other = f.circuit.filter((e) => e.type === 'pcb_trace')[1],
    end = other.route[0];
  const route = [
    { ...prefix.route[0] },
    { route_type: 'wire' as const, x: end.x, y: end.y, layer: 'top', width: 0.15 },
  ];
  f.phase.props.pcbTracePaths[0]!.route = structuredClone(route);
  f.phase.audit[0]!.route = structuredClone(route);
  prefix.route = structuredClone(route);
  prefix.route[1].end_pcb_port_id = end.start_pcb_port_id;
  f.circuit = f.circuit.filter((e) => e.type !== 'pcb_via' || e.pcb_trace_id !== prefix.pcb_trace_id);
  assert.deepEqual(run(f).unrepairedTraceIds, []);
  const foreign = f.circuit.find((e) => e.type === 'pcb_port' && e.pcb_port_id === 'pcb_port_3');
  foreign.x = end.x;
  foreign.y = end.y;
  prefix.route[1].end_pcb_port_id = foreign.pcb_port_id;
  assert.throws(() => run(f), /physical source net/);
});

test('existing source claims are checked against the proved net even without a routing capture', () => {
  const f = fixture(),
    join = addJoin(f);
  join.source_trace_id = 'foreign';
  f.captures = [];
  assert.throws(() => run(f), /existing native join source|existing source metadata/);
  const valid = fixture(),
    j = addJoin(valid);
  j.source_trace_id = valid.circuit.find((e) => e.type === 'source_trace').source_trace_id;
  valid.captures = [];
  assert.equal(run(valid).audit.length, 0);
});

test('translated90degree actual RP profile binds subnanometre source coordinates while .001mm shifts still reject', async () => {
  const { createRpClockPhase } = await import('../eda/blocks/rp-clock.js'),
    { createRpEscapePhase } = await import('../eda/blocks/rp-escape.js');
  const dir = 'rp-routing-robust/',
    circuit = read(dir + 'circuit.json').filter(
      (e: any) => !['pcb_trace', 'pcb_via', 'pcb_copper_pour'].includes(e.type) && !e.error_type,
    ),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins]));
  const angle = Math.PI / 2,
    c = Math.cos(angle),
    s = Math.sin(angle),
    transform = (p: any) => {
      const x = p.x,
        y = p.y;
      p.x = x * c - y * s + 1.23;
      p.y = x * s + y * c - 1.23;
    };
  for (const p of graph.parts) {
    transform(p.at);
    p.at.rotation = (p.at.rotation ?? 0) + 90;
  }
  for (const e of circuit) {
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) transform(e);
    for (const k of ['center', 'footprint_origin']) if (e[k]) transform(e[k]);
    if (e.type === 'pcb_component') e.rotation += 90;
    if (e.type === 'pcb_smtpad' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
    if (e.shape?.startsWith('rotated_')) e.ccw_rotation = (e.ccw_rotation ?? 0) + 90;
    if (e.type === 'pcb_plated_hole') {
      e.rect_ccw_rotation = (e.rect_ccw_rotation ?? 0) + 90;
      e.hole_ccw_rotation = (e.hole_ccw_rotation ?? 0) + 90;
    }
    for (const k of ['points', 'outline']) if (Array.isArray(e[k])) for (const p of e[k]) transform(p);
    if (e.type === 'pcb_board' || e.type === 'pcb_keepout') [e.width, e.height] = [e.height, e.width];
  }
  const profile = createRpEscapePhase(circuit, graph, mapping, createRpClockPhase(circuit, graph, mapping));
  assert.ok(profile.props);
  const phase = { ...profile, props: { ...profile.props!, phaseIndex: 2 } };
  const deltas = [];
  for (const [index, a] of phase.audit.entries()) {
    const source = circuit.find(
        (e: any) => e.type === 'source_trace' && e.source_trace_id === a.diagnosticSourceTraceId,
      ),
      port = circuit.find((e: any) => e.type === 'pcb_port' && e.pcb_port_id === a.diagnosticPcbPortId),
      last = a.route.at(-1)!,
      contact = (layer: string) => ({ route_type: 'wire', x: last.x, y: last.y, width: 0.15, layer }),
      pcb_trace_id = `saved_phase_null_2_${index}`;
    deltas.push(Math.hypot(port.x - a.route[0]!.x, port.y - a.route[0]!.y));
    const route = [
      ...a.route
        .slice(0, -1)
        .map((p, i) => ({ ...p, ...(!i ? { start_pcb_port_id: port.pcb_port_id } : {}) })),
      contact('top'),
      last,
      contact('bottom'),
      contact('bottom'),
    ];
    circuit.push({
      type: 'pcb_trace',
      pcb_trace_id,
      connection_name: a.diagnosticSourceNetId,
      subcircuit_id: source.subcircuit_id,
      route,
    });
    circuit.push({
      type: 'pcb_via',
      pcb_via_id: 'DERIVED_ROTATED_' + index,
      pcb_trace_id,
      x: last.x,
      y: last.y,
      outer_diameter: 0.6,
      hole_diameter: 0.3,
      from_layer: 'top',
      to_layer: 'bottom',
      layers: ['top', 'inner1', 'inner2', 'bottom'],
      subcircuit_id: source.subcircuit_id,
      subcircuit_connectivity_map_key: source.subcircuit_connectivity_map_key,
    });
  }
  assert.ok(
    deltas.some((d) => d > 0),
    'test must exercise a real floating point roundtrip difference',
  );
  assert.ok(deltas.every((d) => d < 1e-7));
  const before = structuredClone(circuit),
    r = repairNativeExits(circuit, graph, mapping, [phase]);
  assert.equal(r.audit.length, 14);
  assert.deepEqual(circuit, before);
  for (const t of r.circuit.filter((e: any) => e.type === 'pcb_trace'))
    assert.deepEqual(t.route, before.find((e: any) => e.pcb_trace_id === t.pcb_trace_id).route);
  const wrongPort = structuredClone(circuit);
  wrongPort.find(
    (e: any) => e.type === 'pcb_port' && e.pcb_port_id === phase.audit[0]!.diagnosticPcbPortId,
  ).x += 0.001;
  assert.throws(
    () => repairNativeExits(wrongPort, graph, mapping, [phase]),
    /physical pad\/port|coordinates/,
  );
  const wrongLiteral = structuredClone(circuit);
  wrongLiteral.find((e: any) => e.type === 'pcb_trace').route[0].x += 0.001;
  assert.throws(() => repairNativeExits(wrongLiteral, graph, mapping, [phase]), /serialized prefix geometry/);
});

test('native deduplicated saved barrels support same-net inner-layer joins without inventing barrels or changing geometry', () => {
  function shared(reverse = false) {
    const f = fixture(),
      join = addJoin(f),
      ends = f.circuit
        .filter((e) => e.type === 'pcb_trace' && e.pcb_trace_id.startsWith('saved_phase_'))
        .map((p) => p.route.at(-1));
    const wire = (p: any, layer: string) => ({ route_type: 'wire', x: p.x, y: p.y, width: 0.15, layer }),
      via = (p: any, from: string, to: string) => ({
        route_type: 'via',
        x: p.x,
        y: p.y,
        from_layer: from,
        to_layer: to,
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      });
    join.route = [
      wire(ends[0], 'bottom'),
      via(ends[0], 'bottom', 'inner1'),
      wire(ends[0], 'inner1'),
      wire(ends[1], 'inner1'),
      via(ends[1], 'inner1', 'bottom'),
      wire(ends[1], 'bottom'),
    ];
    if (reverse)
      join.route = join.route
        .reverse()
        .map((p: any) =>
          p.route_type === 'via' ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer } : p,
        );
    // Core keeps the two existing prefix-owned full through barrels, with their
    // original top→bottom direction fields, when the join reuses those holes.
    return { f, join };
  }
  for (const reverse of [false, true]) {
    const { f, join } = shared(reverse),
      before = structuredClone(f),
      r = run(f);
    assert.equal(r.audit.length, 1);
    assert.equal(r.viaAudit.length, 0);
    assert.deepEqual(f, before);
    assert.equal(r.circuit.filter((e) => e.type === 'pcb_via').length, 2);
    assert.deepEqual(r.circuit.find((e) => e.pcb_trace_id === join.pcb_trace_id)!.route, join.route);
    assert.deepEqual(
      r.circuit.filter((e) => e.type === 'pcb_via'),
      f.circuit.filter((e) => e.type === 'pcb_via'),
    );
    assert.deepEqual(r.unrepairedTraceIds, []);
  }
  for (const mutate of [
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').hole_diameter = 0.6;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').subcircuit_connectivity_map_key = 'foreign';
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').pcb_trace_id = 'UNPROVED_OWNER';
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').x += 0.0001;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').layers = ['top', 'bottom'];
    },
  ]) {
    const { f } = shared();
    mutate(f);
    assert.throws(() => run(f), /barrel|source differ/);
  }
});

test('official post-DRC own-pad handoff markers and captured mixed via joins retain strict physical ownership', async () => {
  const { checkEachPcbTraceNonOverlapping } = await import(
    '../eda/node_modules/@tscircuit/checks/dist/index.js'
  );
  function handoff() {
    const f = fixture(),
      prefix = f.circuit.find((e) => e.type === 'pcb_trace'),
      start = prefix.route[0],
      route = [
        { ...start },
        { route_type: 'wire' as const, x: start.x, y: start.y + 0.2, width: 0.15, layer: 'top' },
      ];
    f.phase.props.pcbTracePaths[0]!.route = structuredClone(route);
    f.phase.audit[0]!.route = structuredClone(route);
    prefix.route = structuredClone(route);
    f.circuit = f.circuit.filter((e) => e.type !== 'pcb_via' || e.pcb_trace_id !== prefix.pcb_trace_id);
    const input = f.captures[0].input.input.connections[0],
      point = input.pointsToConnect.find((p: any) => p.pointId === prefix.pcb_trace_id + '_exit');
    point.y = route[1]!.y;
    point.layer = 'top';
    const right = f.circuit.filter((e) => e.type === 'pcb_trace')[1].route.at(-1),
      source = f.circuit.find((e) => e.type === 'source_trace'),
      net = f.circuit.find((e) => e.type === 'source_net' && e.name === 'SUPPLY'),
      pcb_trace_id = net.source_net_id + '_mst0_0',
      a = route[1]!,
      v = { x: a.x, y: a.y + 0.5 };
    const wire = (p: any, layer: string) => ({ route_type: 'wire', x: p.x, y: p.y, width: 0.15, layer });
    const join = {
      type: 'pcb_trace',
      pcb_trace_id,
      connection_name: net.source_net_id,
      subcircuit_id: source.subcircuit_id,
      connectsTo: [
        prefix.pcb_trace_id + '_exit',
        f.circuit.filter((e) => e.type === 'pcb_trace')[1].pcb_trace_id + '_exit',
      ],
      route: [
        wire(a, 'top'),
        wire(v, 'top'),
        {
          route_type: 'via',
          ...v,
          from_layer: 'top',
          to_layer: 'bottom',
          via_diameter: 0.6,
          via_hole_diameter: 0.3,
        },
        wire(v, 'bottom'),
        wire(right, 'bottom'),
      ],
    };
    f.circuit.push(join, {
      type: 'pcb_via',
      pcb_via_id: 'DERIVED_HANDOFF_JOIN_VIA',
      pcb_trace_id,
      ...v,
      outer_diameter: 0.6,
      hole_diameter: 0.3,
      from_layer: 'top',
      to_layer: 'bottom',
      layers: ['top', 'inner1', 'inner2', 'bottom'],
      subcircuit_id: source.subcircuit_id,
      subcircuit_connectivity_map_key: source.subcircuit_connectivity_map_key,
    });
    return { f, prefix, join };
  }
  const { f, prefix, join } = handoff();
  assert.equal(run(f).audit.length, 1);
  const annotated = structuredClone(f);
  checkEachPcbTraceNonOverlapping(annotated.circuit, { minClearance: 0.127 });
  const p = annotated.circuit.find((e) => e.pcb_trace_id === prefix.pcb_trace_id)!,
    j = annotated.circuit.find((e) => e.pcb_trace_id === join.pcb_trace_id)!,
    ownPort = p.route[0].start_pcb_port_id;
  assert.equal(p.route.at(-1).end_pcb_port_id, ownPort);
  assert.equal(j.route[0].start_pcb_port_id, ownPort);
  const port = annotated.circuit.find((e) => e.type === 'pcb_port' && e.pcb_port_id === ownPort);
  assert.ok(Math.abs(port.y - p.route.at(-1).y) > 0.19);
  const before = structuredClone(annotated),
    r = run(annotated);
  assert.equal(r.audit.length, 1);
  assert.deepEqual(annotated, before);
  assert.deepEqual(
    r.circuit.filter((e) => e.type === 'pcb_trace').map((e) => e.route),
    annotated.circuit.filter((e) => e.type === 'pcb_trace').map((e) => e.route),
  );
  const rotated = structuredClone(annotated),
    turn = (p: any) => {
      const x = p.x;
      p.x = -p.y;
      p.y = x;
    };
  for (const e of rotated.circuit) {
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) turn(e);
    for (const key of ['center', 'footprint_origin']) if (e[key]) turn(e[key]);
    if (e.type === 'pcb_smtpad') {
      e.shape = 'rotated_rect';
      e.ccw_rotation = 90;
    }
    if (e.type === 'pcb_component') e.rotation = (e.rotation ?? 0) + 90;
    if (e.type === 'pcb_board') [e.width, e.height] = [e.height, e.width];
    if (e.route) for (const p of e.route) turn(p);
  }
  for (const path of rotated.phase.props.pcbTracePaths) for (const p of path.route) turn(p);
  for (const a of rotated.phase.audit) for (const p of a.route) turn(p);
  for (const c of rotated.captures)
    for (const connection of c.input.input.connections) for (const p of connection.pointsToConnect) turn(p);
  assert.equal(
    run(rotated).audit.length,
    1,
    'same post-DRC markers remain proved on actual rotated rectangular copper',
  );
  for (const mutate of [
    (x: any) => {
      x.circuit.find((e: any) => e.pcb_trace_id === prefix.pcb_trace_id).route.at(-1).end_pcb_port_id =
        'pcb_port_2';
    },
    (x: any) => {
      x.circuit.find((e: any) => e.pcb_trace_id === join.pcb_trace_id).route[0].start_pcb_port_id =
        'pcb_port_2';
    },
    (x: any) => {
      x.circuit.find((e: any) => e.pcb_trace_id === join.pcb_trace_id).route[0].y += 0.001;
    },
    (x: any) => {
      x.circuit.find((e: any) => e.type === 'pcb_smtpad' && e.pcb_port_id === ownPort).height = 0.45;
    },
    (x: any) => {
      const y = 0.3;
      x.phase.props.pcbTracePaths[0].route.at(-1).y = y;
      x.phase.audit[0].route.at(-1).y = y;
      x.circuit.find((e: any) => e.pcb_trace_id === prefix.pcb_trace_id).route.at(-1).y = y;
      x.circuit.find((e: any) => e.pcb_trace_id === join.pcb_trace_id).route[0].y = y;
      x.captures[0].input.input.connections[0].pointsToConnect[0].y = y;
    },
    (x: any) => {
      for (const c of x.captures)
        for (const n of c.input.input.connections) {
          n.width = 0.3;
          n.nominalTraceWidth = 0.3;
        }
      x.circuit.find((e: any) => e.pcb_trace_id === join.pcb_trace_id).route[0].width = 0.3;
    },
    (x: any) => {
      x.captures[0].input.input.connections[0].pointsToConnect[0].y += 0.001;
    },
  ]) {
    const bad = structuredClone(annotated);
    mutate(bad);
    assert.throws(() => run(bad), /marker|endpoint|coordinates|captured/);
  }
});

test('actual native reversed via annotations prove coincident annular copper without rewriting route or barrel geometry', () => {
  const dir = 'rp-routing-robust/actual-134193af/',
    raw = read(dir + 'pre-pour-circuit.json'),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    phases = read(dir + 'native-exit-phase.json'),
    captures = [
      {
        solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph',
        input: { input: read(dir + 'router-input.json') },
      },
    ];
  const target = 'source_net_20_mst1_0';
  // DERIVED focused proof: retain every actual source/pad/phase/barrel record and
  // this exact actual MST. Unrelated native routes are omitted, not accepted or
  // filtered from a production board; fullraw has a separate width-floor issue.
  const circuit = raw.filter(
    (e: any) =>
      e.type !== 'pcb_trace' ||
      e.pcb_trace_id === target ||
      !/^source_net_\d+_mst\d+_\d+$/.test(e.pcb_trace_id),
  );
  const t = circuit.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === target);
  delete t.source_trace_id;
  delete t.source_net_id;
  const vias = t.route.filter((p: any) => p.route_type === 'via');
  assert.equal(vias.length, 2);
  for (const p of vias) {
    const index = t.route.indexOf(p);
    assert.notEqual(t.route[index - 1].layer, p.from_layer);
    assert.notEqual(t.route[index + 1].layer, p.to_layer);
  }
  const before = structuredClone(circuit),
    r = repairNativeExits(circuit, graph, mapping, phases, { nativeRoutingInputs: captures });
  assert.equal(r.audit.length, 1);
  assert.equal(r.audit[0]!.pcbTraceId, target);
  assert.deepEqual(r.unrepairedTraceIds, []);
  assert.deepEqual(circuit, before);
  assert.deepEqual(
    r.circuit.filter((e: any) => e.type === 'pcb_trace').map((e: any) => e.route),
    before.filter((e: any) => e.type === 'pcb_trace').map((e: any) => e.route),
  );
  assert.deepEqual(
    r.circuit.filter((e: any) => e.type === 'pcb_via'),
    before.filter((e: any) => e.type === 'pcb_via'),
  );
  for (const mutate of [
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_22').hole_diameter = 0.6;
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_22').layers = ['top', 'bottom'];
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_22').subcircuit_connectivity_map_key =
        'foreign';
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === target).route[2].x += 0.001;
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === target).route[4].x += 0.001;
    },
    (c: any[]) => {
      const tr = c.find((e) => e.type === 'pcb_trace' && e.pcb_trace_id === target);
      for (let i = 4; i < 10; i++) {
        tr.route[i].x = tr.route[3].x;
        tr.route[i].y = tr.route[3].y;
      }
    },
  ]) {
    const bad = structuredClone(circuit);
    mutate(bad);
    assert.throws(
      () => repairNativeExits(bad, graph, mapping, phases, { nativeRoutingInputs: captures }),
      /barrel|source differ|annular|discontinuous/,
    );
  }
});

test('a native join can depart a proved saved through barrel on another physical layer only with positive annular copper', () => {
  function otherLayer() {
    const f = fixture(),
      join = addJoin(f);
    // DERIVED serialization case: no new via is inserted at the already-proved
    // prefix barrels. Both literal captured exits remain bottom-layer points.
    for (const p of join.route) p.layer = 'inner1';
    return { f, join };
  }
  const { f, join } = otherLayer(),
    before = structuredClone(f),
    result = run(f);
  assert.equal(result.audit.length, 1);
  assert.deepEqual(result.unrepairedTraceIds, []);
  assert.deepEqual(f, before);
  assert.deepEqual(result.circuit.find((e) => e.pcb_trace_id === join.pcb_trace_id)!.route, join.route);
  assert.deepEqual(
    result.circuit.filter((e) => e.type === 'pcb_via'),
    f.circuit.filter((e) => e.type === 'pcb_via'),
  );
  for (const mutate of [
    (f: any, j: any) => {
      j.route[0].x += 0.4;
    },
    (f: any, j: any) => {
      for (const p of j.route) p.layer = 'unphysical';
    },
    (f: any, j: any) => {
      const start = j.route[0];
      for (const p of j.route) {
        p.x = start.x;
        p.y = start.y;
      }
    },
    (f: any, j: any) => {
      j.route[0].width = 0.149;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').hole_diameter = 0.6;
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').subcircuit_connectivity_map_key = 'foreign';
    },
    (f: any) => {
      f.circuit.find((e: any) => e.type === 'pcb_via').layers = ['top', 'bottom'];
    },
  ]) {
    const { f: bad, join: j } = otherLayer();
    mutate(bad, j);
    assert.throws(() => run(bad), /barrel|physical|layer\/width/);
  }
});

test('actual full native width-refined board proves rounded saved-barrel contacts on top, bottom and inner layers without changing copper', () => {
  const dir = 'rp-routing-robust/actual-a81367d2/',
    circuit = read(dir + 'pre-pour-circuit.json'),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    phases = read(dir + 'native-exit-phase.json'),
    captures = [
      {
        solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph',
        input: { input: read(dir + 'router-input.json') },
      },
    ],
    prove = (c: any[], cs = captures) =>
      repairNativeExits(c, graph, mapping, phases, { nativeRoutingInputs: cs }),
    before = structuredClone(circuit),
    result = prove(circuit);
  assert.equal(result.audit.length, 1);
  assert.equal(result.audit[0]!.pcbTraceId, 'source_net_7_mst3_0');
  assert.deepEqual(result.viaAudit, []);
  assert.deepEqual(result.unrepairedTraceIds, []);
  assert.deepEqual(circuit, before);
  const copper = (c: any[]) =>
    c
      .filter((e) => e.type === 'pcb_trace' || e.type === 'pcb_via')
      .map((e) => {
        const clone = structuredClone(e);
        delete clone.source_trace_id;
        delete clone.source_net_id;
        return clone;
      });
  assert.deepEqual(copper(result.circuit), copper(before));
  assert.deepEqual(
    result.circuit.filter((e) => e.type !== 'pcb_trace'),
    before.filter((e: any) => e.type !== 'pcb_trace'),
  );
  for (const id of ['source_net_7_mst1_0', 'source_net_4_mst24_0', 'source_net_0_mst5_0']) {
    const join = circuit.find((e: any) => e.pcb_trace_id === id),
      end = join.route.at(-1),
      prefix = circuit.find((e: any) => e.pcb_trace_id === join.connectsTo[1].slice(0, -5)),
      via = prefix.route.find((p: any) => p.route_type === 'via'),
      delta = Math.hypot(end.x - via.x, end.y - via.y);
    assert.ok(
      delta > 0.00012 && delta < 0.00016,
      'actual rounded route endpoint is not an exact barrel center',
    );
    assert.ok(
      delta + end.width / 2 < via.via_diameter / 2,
      'whole actual endpoint cap remains inside barrel outer disk',
    );
  }
  for (const mutate of [
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_0_mst5_0').route.at(-1).x += 0.4;
    },
    (c: any[]) => {
      const t = c.find((e) => e.pcb_trace_id === 'source_net_4_mst24_0');
      t.route.at(-1).x += 0.2;
      t.route.at(-1).width = 0.3;
    },
    (c: any[]) => {
      const t = c.find((e) => e.pcb_trace_id === 'source_net_7_mst1_0');
      for (const p of t.route)
        if (p.route_type === 'wire' && p.layer === 'bottom') {
          p.x = -14.450156;
          p.y = 1.7999999999999998;
        }
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_trace_id === 'saved_phase_null_2_5').pcb_trace_id =
        'unproved-owner';
    },
    (c: any[]) => {
      c.find(
        (e) => e.type === 'pcb_via' && e.pcb_trace_id === 'saved_phase_null_2_5',
      ).subcircuit_connectivity_map_key = 'foreign';
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_trace_id === 'saved_phase_null_2_5').hole_diameter = 0.6;
    },
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_0_mst5_0').route.at(-1).width = 0.149;
    },
  ]) {
    const bad = structuredClone(circuit);
    mutate(bad);
    assert.throws(() => prove(bad), /physical|barrel|source differ|layer\/width/);
  }
  const changedCapture = structuredClone(captures);
  changedCapture[0]!.input.input.connections
    .find((c: any) => c.name === 'source_net_0')
    .pointsToConnect.find((p: any) => p.pointId === 'saved_phase_null_2_5_exit').x += 0.001;
  assert.throws(() => prove(circuit, changedCapture), /captured exit/);
});

test('actual canonical global MST owner proves native deduplicated barrels; foreign, unknown and nonphysical owners reject', () => {
  const dir = 'rp-routing-robust/actual-e7a97ca9/',
    raw = read(dir + 'pre-pour-circuit.json'),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    phases = read(dir + 'native-exit-phase.json'),
    captures = [
      {
        solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph',
        input: { input: read(dir + 'router-input.json') },
      },
    ],
    ids = ['source_net_7_mst1_0', 'source_net_7_mst3_0', 'source_net_7_mst4_0'];
  // DERIVED focused actual subset: keep all source/pad/phase/barrel records and
  // these three actual VCORE MSTs. No geometry is changed or fabricated. Full
  // raw has a separate, deliberately still-rejected captured-exit mismatch.
  const circuit = raw.filter(
      (e: any) =>
        e.type !== 'pcb_trace' ||
        !/^source_net_\d+_mst\d+_\d+$/.test(e.pcb_trace_id) ||
        ids.includes(e.pcb_trace_id),
    ),
    prove = (c: any[]) => repairNativeExits(c, graph, mapping, phases, { nativeRoutingInputs: captures }),
    before = structuredClone(circuit),
    result = prove(circuit);
  assert.deepEqual(result.audit, []);
  assert.deepEqual(result.viaAudit, []);
  assert.deepEqual(result.unrepairedTraceIds, []);
  assert.deepEqual(result.circuit, before);
  assert.deepEqual(circuit, before);
  const barrel = circuit.find((e: any) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_89');
  assert.equal(barrel.pcb_trace_id, 'source_net_7_mst1_0');
  assert.ok(!barrel.pcb_trace_id.startsWith('saved_phase_'));
  const blankBorrower = structuredClone(circuit);
  delete blankBorrower.find((e: any) => e.pcb_trace_id === 'source_net_7_mst3_0').source_trace_id;
  assert.equal(prove(blankBorrower).audit.length, 1);
  for (const mutate of [
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_89').pcb_trace_id = 'unknown-owner';
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_89').subcircuit_connectivity_map_key =
        'foreign';
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_89').hole_diameter = 0.6;
    },
    (c: any[]) => {
      c.find((e) => e.type === 'pcb_via' && e.pcb_via_id === 'pcb_via_89').x += 0.000001;
    },
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_7_mst1_0' && e.type === 'pcb_trace').source_trace_id =
        'source_trace_0';
    },
    (c: any[]) => {
      const owner = c.find((e) => e.pcb_trace_id === 'source_net_7_mst1_0' && e.type === 'pcb_trace');
      owner.connectsTo[0] = 'unregistered-native-point';
    },
    (c: any[]) => {
      const owner = c.find((e) => e.pcb_trace_id === 'source_net_7_mst1_0' && e.type === 'pcb_trace');
      const index = owner.route.findIndex((p: any) => p.route_type === 'via');
      owner.route[index - 1].x += 0.000001;
    },
    (c: any[]) => {
      const ownerIndex = c.findIndex(
          (e) => e.pcb_trace_id === 'source_net_7_mst1_0' && e.type === 'pcb_trace',
        ),
        owner = c.splice(ownerIndex, 1)[0];
      owner.source_trace_id = '';
      c.push(owner);
    },
  ]) {
    const bad = structuredClone(circuit);
    mutate(bad);
    assert.throws(() => prove(bad), /barrel|source metadata|source differ/);
  }
  assert.throws(
    () => repairNativeExits(raw, graph, mapping, phases, { nativeRoutingInputs: captures }),
    /physical saved-exit\/annular contact: source_net_0_mst12_0/,
  );
});

test('internal canonical-join geometry deferral changes no copper or source IDs; prefixes and blank joins remain strict', () => {
  const dir = 'rp-routing-robust/actual-e7a97ca9/',
    raw = read(dir + 'pre-pour-circuit.json'),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    phases = read(dir + 'native-exit-phase.json'),
    captures = [
      {
        solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph',
        input: { input: read(dir + 'router-input.json') },
      },
    ],
    options = {
      nativeRoutingInputs: captures,
      existingJoinGeometry: 'defer-to-physical-network-oracle' as const,
    },
    prove = (c: any[]) => repairNativeExits(c, graph, mapping, phases, options),
    before = structuredClone(raw),
    result = prove(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(result.circuit, before);
  assert.deepEqual(result.audit, []);
  assert.deepEqual(result.viaAudit, []);
  assert.deepEqual(result.unrepairedTraceIds, []);
  assert.equal(result.deferredExistingTraceIds.length, 13);
  assert.ok(result.deferredExistingTraceIds.includes('source_net_0_mst12_0'));
  for (const id of result.deferredExistingTraceIds)
    assert.ok(raw.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === id).source_trace_id);
  assert.throws(
    () => repairNativeExits(raw, graph, mapping, phases, { nativeRoutingInputs: captures }),
    /physical saved-exit\/annular contact: source_net_0_mst12_0/,
  );
  for (const mutate of [
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_0_mst12_0' && e.type === 'pcb_trace').source_trace_id =
        'source_trace_31';
    },
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_0_mst12_0' && e.type === 'pcb_trace').source_net_id =
        'source_net_4';
    },
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_0_mst12_0' && e.type === 'pcb_trace').connection_name =
        'source_net_4';
    },
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'source_net_0_mst12_0' && e.type === 'pcb_trace').subcircuit_id =
        'foreign-subcircuit';
    },
    (c: any[]) => {
      c.find((e) => e.pcb_trace_id === 'saved_phase_null_2_8' && e.type === 'pcb_trace').route[1].x += 0.001;
    },
  ]) {
    const bad = structuredClone(raw);
    mutate(bad);
    assert.throws(() => prove(bad), /source metadata|physical source net|literal|geometry|route differs/);
  }
  const unproved = structuredClone(raw);
  delete unproved.find((e: any) => e.pcb_trace_id === 'source_net_0_mst12_0' && e.type === 'pcb_trace')
    .source_trace_id;
  assert.throws(() => prove(unproved), /physical saved-exit\/annular contact: source_net_0_mst12_0/);
  const blank = structuredClone(raw);
  delete blank.find((e: any) => e.pcb_trace_id === 'source_net_7_mst3_0' && e.type === 'pcb_trace')
    .source_trace_id;
  const repaired = prove(blank);
  assert.equal(repaired.audit.length, 1);
  assert.equal(repaired.audit[0]!.pcbTraceId, 'source_net_7_mst3_0');
  assert.ok(!repaired.deferredExistingTraceIds.includes('source_net_7_mst3_0'));
  const missingCapture = repairNativeExits(blank, graph, mapping, phases, {
    existingJoinGeometry: options.existingJoinGeometry,
  });
  assert.deepEqual(missingCapture.unrepairedTraceIds, ['source_net_7_mst3_0']);
  assert.deepEqual(missingCapture.audit, []);
  assert.ok(!missingCapture.deferredExistingTraceIds.includes('source_net_7_mst3_0'));
  assert.throws(
    () => repairNativeExits(raw, graph, mapping, phases, { existingJoinGeometry: 'arbitrary' as any }),
    /Unsupported/,
  );
});

test('official Pipeline7 capture gets the identical strict geometry proof; unknown solver names never authorize attribution', () => {
  const f = fixture(),
    join = addJoin(f, true);
  for (const capture of f.captures) capture.solver = 'AutoroutingPipelineSolver7_MultiGraph';
  const before = structuredClone(f),
    result = run(f);
  assert.equal(result.audit.length, 1);
  assert.deepEqual(result.unrepairedTraceIds, []);
  assert.deepEqual(f, before);
  assert.deepEqual(result.circuit.find((e) => e.pcb_trace_id === join.pcb_trace_id)!.route, join.route);
  const badBarrel = structuredClone(f);
  badBarrel.circuit.find((e) => e.type === 'pcb_via').hole_diameter = 0.6;
  assert.throws(() => run(badBarrel), /barrel|dimensions/);
  for (const solver of [
    'AutoroutingPipelineSolver7',
    'AutoroutingPipelineSolver7_MultiGraph_fake',
    'AutoroutingPipelineSolver11_Simplification',
  ]) {
    const unknown = structuredClone(f);
    for (const capture of unknown.captures) capture.solver = solver;
    const unproved = run(unknown);
    assert.deepEqual(unproved.audit, []);
    assert.deepEqual(unproved.unrepairedTraceIds, [join.pcb_trace_id]);
  }
  // DERIVED descriptor-only change on actual native global barrel evidence.
  // This also exercises the independent captured-owner allowlist branch.
  const dir = 'rp-routing-robust/actual-e7a97ca9/',
    raw = read(dir + 'pre-pour-circuit.json'),
    graph = read(dir + 'plan-graph.json'),
    mapping = Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    phases = read(dir + 'native-exit-phase.json'),
    ids = ['source_net_7_mst1_0', 'source_net_7_mst3_0', 'source_net_7_mst4_0'],
    circuit = raw.filter(
      (e: any) =>
        e.type !== 'pcb_trace' ||
        !/^source_net_\d+_mst\d+_\d+$/.test(e.pcb_trace_id) ||
        ids.includes(e.pcb_trace_id),
    ),
    captures = [
      { solver: 'AutoroutingPipelineSolver7_MultiGraph', input: { input: read(dir + 'router-input.json') } },
    ];
  delete circuit.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === 'source_net_7_mst3_0')
    .source_trace_id;
  const global = repairNativeExits(circuit, graph, mapping, phases, { nativeRoutingInputs: captures });
  assert.equal(global.audit.length, 1);
  assert.deepEqual(global.unrepairedTraceIds, []);
});
