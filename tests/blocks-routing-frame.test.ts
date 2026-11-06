import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rotateNativeRoutingFrame, type RoutingFrameQuarter } from '../eda/blocks/routing-frame.js';
const f = JSON.parse(
  readFileSync(
    new URL(
      '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/routing-frame-fixture.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const quarters = [0, 1, 2, 3] as const;
const inverse = (q: RoutingFrameQuarter) => ((4 - q) % 4) as RoutingFrameQuarter;
test('captured 723 obstacles,144 terminals and117 raw native traces roundtrip all cardinal frames without input mutation', () => {
  const before = structuredClone(f);
  assert.equal(f.input.obstacles.length, 723);
  assert.equal(
    f.input.connections.reduce((s: number, c: any) => s + c.pointsToConnect.length, 0),
    144,
  );
  assert.equal(f.traces.length, 117);
  for (const q of quarters) {
    const r = rotateNativeRoutingFrame(f.input, q),
      back = rotateNativeRoutingFrame(r.input, inverse(q));
    assert.deepEqual(back.input, f.input);
    const framed = rotateNativeRoutingFrame({ ...f.input, traces: f.traces }, q).input.traces;
    assert.deepEqual(r.inverseTraces(framed), f.traces);
    assert.equal(r.input.minTraceToPadEdgeClearance, f.input.minTraceToPadEdgeClearance);
    assert.equal(r.input.layerCount, 2);
  }
  assert.deepEqual(f, before);
  assert.equal(rotateNativeRoutingFrame(f.input, 0).input, f.input);
});
test('rotated intrinsic rect keeps dimensions while absent-angle rect and oval rotate world axes', () => {
  const input = structuredClone(f.input);
  input.obstacles = [
    {
      type: 'rect',
      center: { x: 2, y: 3 },
      width: 0.63,
      height: 2.25,
      ccwRotationDegrees: 90,
      layers: ['top'],
      connectedTo: ['rect'],
    },
    {
      type: 'rect',
      center: { x: 2, y: 3 },
      width: 2.25,
      height: 0.63,
      layers: ['top'],
      connectedTo: ['axis'],
    },
    {
      type: 'oval',
      center: { x: -2, y: 4 },
      width: 0.8,
      height: 1.6,
      layers: ['top', 'bottom'],
      connectedTo: ['oval'],
    },
  ];
  input.outline = [
    { x: -4, y: -2 },
    { x: 5, y: -2 },
    { x: 5, y: 7 },
    { x: -4, y: 7 },
  ];
  const r = rotateNativeRoutingFrame(input, 3).input;
  assert.deepEqual(r.obstacles[0], { ...input.obstacles[0], center: { x: 3, y: -2 }, ccwRotationDegrees: 0 });
  assert.equal(r.obstacles[0].width, 0.63);
  assert.equal(r.obstacles[1].width, 0.63);
  assert.equal(r.obstacles[1].height, 2.25);
  assert.equal(Object.hasOwn(r.obstacles[1], 'ccwRotationDegrees'), false);
  assert.equal(r.obstacles[2].width, 1.6);
  assert.equal(r.obstacles[2].height, 0.8);
  assert.deepEqual(r.outline, [
    { x: -2, y: 4 },
    { x: -2, y: -5 },
    { x: 7, y: -5 },
    { x: 7, y: 4 },
  ]);
  assert.deepEqual(rotateNativeRoutingFrame(r, 1).input, input);
});
test('four-layer terminals and full-span via inverse preserve all layer,source,width and marker identities', () => {
  const input = structuredClone(f.input);
  input.layerCount = 4;
  input.connections = [
    {
      name: 'canonical',
      source_trace_id: 'source_trace_1',
      pointsToConnect: [
        { x: 1, y: 2, layers: ['top', 'inner1', 'inner2', 'bottom'], pointId: 'actual-port' },
        { x: -2, y: 3, layer: 'inner1', terminalVia: { toLayer: 'bottom', viaDiameter: 0.6 } },
      ],
    },
  ];
  input.traces = [
    {
      type: 'pcb_trace',
      pcb_trace_id: 'trace',
      connection_name: 'canonical',
      source_trace_id: 'source_trace_1',
      source_net_id: 'net',
      subcircuit_id: 'sub',
      connectsTo: ['actual-port', 'other'],
      route: [
        { route_type: 'wire', x: 1, y: 2, width: 0.15, layer: 'inner1', start_pcb_port_id: 'actual-port' },
        {
          route_type: 'via',
          x: 2,
          y: 3,
          from_layer: 'top',
          to_layer: 'bottom',
          layers: ['top', 'inner1', 'inner2', 'bottom'],
          via_diameter: 0.6,
          via_hole_diameter: 0.3,
        },
        { route_type: 'wire', x: 2, y: 3, width: 0.22, layer: 'bottom', end_pcb_port_id: 'other' },
      ],
    },
  ];
  input.fixedTraces = structuredClone(input.traces);
  input.fixedTraces[0].pcb_trace_id = 'fixed-prefix';
  for (const q of quarters) {
    const r = rotateNativeRoutingFrame(input, q);
    assert.deepEqual(r.inverseTraces(r.input.traces), input.traces);
    assert.deepEqual(rotateNativeRoutingFrame(r.input, inverse(q)).input, input);
  }
});
test('unknown geometry,constraints,noncardinal obstacles and ambiguous terminal geometry fail closed', () => {
  for (const mutate of [
    (a: any) => (a.keepouts = []),
    (a: any) => (a.buses = []),
    (a: any) => (a.differentialPairs = []),
    (a: any) => (a.obstacles[0].polygon = [{ x: 1, y: 2 }]),
    (a: any) => (a.obstacles[0].ccwRotationDegrees = 45),
    (a: any) => (a.obstacles[0].shape = 'polygon'),
    (a: any) => (a.obstacles[0].center.z = 0),
    (a: any) => (a.connections[0].pointsToConnect[0].direction = { x: 1, y: 0 }),
    (a: any) => (a.connections[0].pointsToConnect[0].layers = ['top']),
  ]) {
    const input = structuredClone(f.input);
    mutate(input);
    assert.throws(() => rotateNativeRoutingFrame(input, 3));
  }
  assert.throws(() => rotateNativeRoutingFrame(f.input, 4 as any));
});
test('inverse output rejects unknown path shapes and malformed dimensions instead of losing native geometry', () => {
  const r = rotateNativeRoutingFrame(f.input, 3);
  for (const mutate of [
    (a: any) => (a[0].route[0].curve_radius = 0.3),
    (a: any) => (a[0].route[0].width = 0),
    (a: any) => (a[0].route[0].layer = 'inner1'),
    (a: any) => (a[0].route[0].route_type = 'through_obstacle'),
    (a: any) => a.push(structuredClone(a[0])),
  ]) {
    const traces = structuredClone(f.traces);
    mutate(traces);
    assert.throws(() => r.inverseTraces(traces));
  }
});

test('actual JS optional undefined fields are JSON-absent while defined unknown constraints still reject by field name', () => {
  const input = structuredClone(f.input);
  Object.assign(input, {
    buses: undefined,
    differentialPairs: undefined,
    jumpers: undefined,
    futureConstraint: undefined,
  });
  Object.assign(input.obstacles[0], { futureGeometry: undefined, ccwRotationDegrees: undefined });
  Object.assign(input.obstacles[0].center, { z: undefined });
  input.obstacles[0].circuitJsonMetadata = {
    ...input.obstacles[0].circuitJsonMetadata,
    pcb_via_id: undefined,
    futureMetadata: undefined,
  };
  Object.assign(input.connections[0].pointsToConnect[0], { futureDirection: undefined });
  const before = structuredClone(input),
    json = JSON.parse(JSON.stringify(input));
  for (const q of quarters) {
    const r = rotateNativeRoutingFrame(input, q),
      expected = rotateNativeRoutingFrame(json, q);
    assert.deepEqual(JSON.parse(JSON.stringify(r.input)), expected.input);
    assert.equal(r.input.futureConstraint, undefined);
  }
  assert.deepEqual(input, before);
  for (const [where, key, value] of [
    ['input', 'buses', []],
    ['input', 'futureConstraint', {}],
    ['obstacle', 'futureGeometry', []],
    ['metadata', 'futureMetadata', 'defined'],
  ] as const) {
    const bad = structuredClone(input);
    const target =
      where === 'input'
        ? bad
        : where === 'obstacle'
          ? bad.obstacles[0]
          : bad.obstacles[0].circuitJsonMetadata;
    target[key] = value;
    assert.throws(() => rotateNativeRoutingFrame(bad, 3), new RegExp('field: ' + key));
  }
});
