import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeNativeCopper } from '../eda/blocks/normalize-native-copper.js';
import { runAllRoutingChecks, checkViasInPads } from '../eda/node_modules/@tscircuit/checks/dist/index.js';
const wire = (x: number, y = 0) => ({ route_type: 'wire', x, y, width: 0.15, layer: 'top' });
const trace = (route: any[]) => ({
  type: 'pcb_trace',
  pcb_trace_id: 'source_net_1_0',
  source_trace_id: 'source_trace_1',
  connection_name: 'source_net_1',
  route,
});

test('exact horizontal and vertical interval sweeps preserve extrema, original point identities and endpoint/source metadata', () => {
  for (const axis of ['x', 'y']) {
    const points = [2, 8, 4, -3, 0, 5, 1].map((n) => (axis === 'x' ? wire(n, 7) : wire(7, n))),
      t = trace(points),
      original = structuredClone(t),
      result = normalizeNativeCopper([t]),
      out = result.traces[0]!;
    assert.deepEqual(t, original);
    assert.equal(out.route.length, 4);
    assert.deepEqual(out.route, [points[0]!, points[1]!, points[3]!, points[6]!]);
    assert.equal(out.route[0], points[0]);
    assert.equal(out.route.at(-1), points.at(-1));
    assert.equal(out.source_trace_id, t.source_trace_id);
    assert.equal(out.connection_name, t.connection_name);
    for (const p of out.route) assert.ok(points.includes(p), 'no point or coordinate is constructed');
    // Independent geometric characterization: connected collinear capsules are
    // the closed centerline interval swept by the same radius disk. Both exact
    // minima/maxima, fixed coordinate, width and layer must therefore match.
    const interval = (route: any[]) => [
      Math.min(...route.map((p) => p[axis])),
      Math.max(...route.map((p) => p[axis])),
    ];
    assert.deepEqual(interval(out.route), interval(points));
    assert.equal(out.route[0]![axis === 'x' ? 'y' : 'x'], 7);
    assert.ok(out.route.every((p) => p.width === 0.15 && p.layer === 'top'));
    assert.deepEqual(normalizeNativeCopper(result.traces).traces, result.traces);
    assert.deepEqual(normalizeNativeCopper(result.traces).audit, []);
  }
});

test('width, layer, via, diagonal and every metadata-bearing point remain hard run boundaries; saved fixed phases are untouched', () => {
  for (const mutate of [
    (p: any) => {
      p.width = 0.2;
    },
    (p: any) => {
      p.layer = 'bottom';
    },
    (p: any) => {
      p.y = 0.001;
    },
    (p: any) => {
      p.y = Number.MIN_VALUE;
    },
    (p: any) => {
      p.start_pcb_port_id = 'actual-port';
    },
    (p: any) => {
      p.end_pcb_port_id = 'actual-port';
    },
    (p: any) => {
      p.unknown_metadata = { identity: 2 };
    },
    (p: any) => {
      p.route_type = 'via';
      delete p.width;
      delete p.layer;
      p.from_layer = 'top';
      p.to_layer = 'bottom';
    },
  ]) {
    const t = trace([0, 1, 2, 3, 4].map((x) => wire(x)));
    mutate(t.route[2]);
    const result = normalizeNativeCopper([t]);
    assert.equal(result.traces[0], t);
    assert.deepEqual(result.audit, []);
  }
  const fixed = { ...trace([0, 1, 2, 3, 4].map((x) => wire(x))), pcb_trace_id: 'saved_phase_null_0_0' };
  assert.equal(normalizeNativeCopper([fixed]).traces[0], fixed);
  const interpolated = {
    ...trace([0, 1, 2, 3, 4].map((x) => wire(x))),
    route_thickness_mode: 'interpolated',
  };
  assert.equal(normalizeNativeCopper([interpolated]).traces[0], interpolated);
  const rounded = { ...trace([0, 1, 2, 3, 4].map((x) => wire(x))), should_round_corners: true };
  assert.equal(normalizeNativeCopper([rounded]).traces[0], rounded);
});

test('corner transitions preserve original endpoints and exact per-axis copper ranges', () => {
  const points = [wire(0), wire(1), wire(2), wire(3), wire(3, 1), wire(3, 2), wire(3, 4), wire(3, 3)],
    t = trace(points),
    result = normalizeNativeCopper([t]);
  assert.deepEqual(result.traces[0]!.route, [points[0], points[3], points[6], points[7]]);
  assert.equal(result.audit.length, 2);
  for (const a of result.audit) {
    const original = points.slice(a.startIndex, a.endIndex + 1),
      kept = a.keptIndices.map((i) => points[i]!);
    assert.equal(Math.min(...original.map((p) => p[a.axis])), Math.min(...kept.map((p) => p[a.axis])));
    assert.equal(Math.max(...original.map((p) => p[a.axis])), Math.max(...kept.map((p) => p[a.axis])));
  }
});

test('actual127-point native trace reduces by55 exact redundant points; all10 true via-in-pad errors and remaining boolean failure remain visible', async () => {
  const raw = JSON.parse(
      readFileSync(
        new URL(
          '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/actual-98134781/circuit.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
    target = raw.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === 'source_net_13_0'),
    before = structuredClone(raw),
    result = normalizeNativeCopper([target]),
    normalized = raw.map((e: any) => (e === target ? result.traces[0] : e));
  assert.equal(target.route.length, 127);
  assert.equal(result.traces[0]!.route.length, 72);
  assert.equal(result.traces[0]!.route[0], target.route[0]);
  assert.equal(result.traces[0]!.route.at(-1), target.route.at(-1));
  assert.deepEqual(raw, before);
  assert.equal(result.audit.length, 2);
  for (const a of result.audit) {
    const points = target.route.slice(a.startIndex, a.endIndex + 1),
      fixed = a.axis === 'x' ? 'y' : 'x';
    assert.ok(
      points.every(
        (p: any) =>
          p[fixed] === points[0][fixed] && p.width === points[0].width && p.layer === points[0].layer,
      ),
    );
    assert.deepEqual(
      [a.min, a.max],
      [Math.min(...points.map((p: any) => p[a.axis])), Math.max(...points.map((p: any) => p[a.axis]))],
    );
  }
  const viaErrors = checkViasInPads(structuredClone(raw));
  assert.equal(viaErrors.length, 10);
  assert.deepEqual(checkViasInPads(structuredClone(normalized)), viaErrors);
  // Captured failure is NOT repaired by exact axis cleanup alone. The native
  // trace also has non-axis numerical loops, which this helper must not edit.
  await assert.rejects(
    runAllRoutingChecks(structuredClone(raw)),
    /source_net_13_0: Cannot complete boolean operation/,
  );
  await assert.rejects(
    runAllRoutingChecks(structuredClone(normalized)),
    /source_net_13_0: Cannot complete boolean operation/,
  );
});
