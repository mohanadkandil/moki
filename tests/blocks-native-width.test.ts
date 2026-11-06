import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { restoreNativeWidths } from '../eda/blocks/native-width.js';

const rules = { traceToPad: 0.127, traceToTrace: 0.127, viaToPad: 0.127 };
const trace = (name: string, width: number) => ({
  pcb_trace_id: name + '_mst0_0',
  connection_name: name,
  route: [
    { route_type: 'wire', x: 0, y: 0, layer: 'top', width },
    { route_type: 'wire', x: 1, y: 0, layer: 'top', width },
  ],
});
const input = () => ({
  minTraceWidth: 0.15,
  defaultObstacleMargin: 0.22,
  minTraceToPadEdgeClearance: 0.15,
  minViaEdgeToPadEdgeClearance: 0.15,
  connections: [{ name: 'A' }, { name: 'B' }],
  obstacles: [{ id: 'fixed-clock-copper', x: 2, y: 3, layers: ['top'] }],
});
const pipeline = (Stage: any) => ({
  pipelineDef: [{ solverName: 'powerTraceExpansionSolver', solverClass: Stage }],
});

test('native width replay mutates only subminimum trace IDs and freezes conforming copper even on the same net', async () => {
  const calls: any[] = [],
    original = input(),
    traces = [
      trace('A', 0.106),
      trace('B', 0.14),
      trace('C', 0.15),
      { ...trace('A', 0.15), pcb_trace_id: 'A_mst1_0' },
    ],
    before = structuredClone({ original, traces });
  original.connections.push({ name: 'C', nominalTraceWidth: 0.3 } as any);
  before.original = structuredClone(original);
  class Stage {
    solved = false;
    failed = false;
    stats = { nativeProof: true };
    output: any[];
    constructor(srj: any, options: any) {
      calls.push({ srj, options });
      this.output = structuredClone(srj.traces);
      for (const t of this.output)
        for (const p of t.route) if (t.connection_name === 'A' || calls.length === 2) p.width = 0.15;
      // Native refinement is allowed to move existing route geometry. The
      // wrapper must return it verbatim for fresh core materialization/DRC.
      this.output[0].route[1].x = 1.5;
    }
    step() {
      this.solved = true;
    }
    getOutput() {
      return this.output;
    }
  }
  const result = await restoreNativeWidths(pipeline(Stage), original, traces, rules);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.options),
    [
      { onlyConnectionNames: ['A', 'B'], allowNewVias: false },
      { onlyConnectionNames: ['B'], allowNewVias: false },
    ],
  );
  assert.equal(calls[0].srj.defaultObstacleMargin, 0.22);
  assert.equal(calls[0].srj.minTraceToPadEdgeClearance, 0.15);
  assert.equal(calls[1].srj.defaultObstacleMargin, 0.127);
  assert.equal(calls[1].srj.minTraceToPadEdgeClearance, 0.127);
  assert.equal(calls[1].srj.minViaEdgeToPadEdgeClearance, 0.127);
  for (const call of calls) {
    assert.deepEqual(call.srj.obstacles, original.obstacles);
    assert.deepEqual(call.srj.connections, original.connections);
    assert.equal(call.srj.minTraceWidth, 0.15);
    assert.ok(call.srj.fixedTraces.includes(traces[2]));
    assert.ok(call.srj.fixedTraces.includes(traces[3]));
  }
  assert.deepEqual(
    calls[0].srj.traces.map((t: any) => t.pcb_trace_id),
    ['A_mst0_0', 'B_mst0_0'],
  );
  assert.deepEqual(
    calls[1].srj.traces.map((t: any) => t.pcb_trace_id),
    ['B_mst0_0'],
  );
  assert.ok(calls[1].srj.fixedTraces.includes(result.traces[0]));
  assert.equal(result.traces[2], traces[2], 'nominal .3 net with valid .15 neck is fixed verbatim');
  assert.equal(result.traces[3], traces[3], 'same-net conforming sibling stays fixed verbatim');
  assert.equal(result.traces[0]!.route[1].x, 1.5);
  assert.deepEqual({ original, traces }, before);
  assert.equal(result.audit.length, 2);
  assert.deepEqual(
    result.audit.map((a) => a.fabricationPlanning),
    [false, true],
  );
  class Unused {
    constructor() {
      throw Error('Conforming copper must never enter native cleanup');
    }
  }
  const conforming = [trace('C', 0.15)],
    noop = await restoreNativeWidths(pipeline(Unused), original, conforming, rules);
  assert.equal(noop.traces, conforming);
  assert.equal(noop.traces[0], conforming[0]);
  assert.deepEqual(noop.audit, []);
  await assert.rejects(
    restoreNativeWidths(pipeline(Unused), original, conforming, rules, () => true),
    /was stopped/,
  );
});

test('native width replay stops at a residual subminimum wire and preserves native failures', async () => {
  class Thin {
    solved = false;
    failed = false;
    step() {
      this.solved = true;
    }
    getOutput() {
      return [trace('A', 0.149)];
    }
  }
  await assert.rejects(
    restoreNativeWidths(pipeline(Thin), input(), [trace('A', 0.1)], rules),
    /below required 0.15/,
  );
  class Failed {
    solved = false;
    failed = false;
    error = 'actual width solver failure';
    step() {
      this.failed = true;
    }
    getOutput() {
      throw Error('Must not read failed output');
    }
  }
  await assert.rejects(
    restoreNativeWidths(pipeline(Failed), input(), [trace('A', 0.1)], rules),
    /actual width solver failure/,
  );
});

test('cancellation during a native width loop rejects before consuming output', async () => {
  for (const solvedOnStop of [false, true]) {
    let stopped = false,
      reads = 0;
    class Waiting {
      solved = false;
      failed = false;
      step() {
        stopped = true;
        this.solved = solvedOnStop;
      }
      getOutput() {
        reads++;
        return [trace('A', 0.15)];
      }
    }
    await assert.rejects(
      restoreNativeWidths(pipeline(Waiting), input(), [trace('A', 0.1)], rules, () => stopped),
      /was stopped/,
    );
    assert.equal(reads, 0);
  }
});

test('an already cancelled replay rejects even when native stage starts solved', async () => {
  let reads = 0;
  class AlreadySolved {
    solved = true;
    failed = false;
    getOutput() {
      reads++;
      return [trace('A', 0.15)];
    }
  }
  await assert.rejects(
    restoreNativeWidths(pipeline(AlreadySolved), input(), [trace('A', 0.1)], rules, () => true),
    /was stopped/,
  );
  assert.equal(reads, 0);
});

test('native width replay enforces its per-stage time budget', async (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => (clock += 50000));
  class NeverSolved {
    solved = false;
    failed = false;
    step() {}
    getOutput() {
      throw Error('Not solved');
    }
  }
  await assert.rejects(
    restoreNativeWidths(pipeline(NeverSolved), input(), [trace('A', 0.1)], rules),
    /exceeded90seconds/,
  );
});

test('malformed native inputs and changed trace identity or coverage fail closed', async () => {
  await assert.rejects(restoreNativeWidths({}, input(), [trace('A', 0.1)], rules), /unavailable/);
  await assert.rejects(
    restoreNativeWidths({}, input(), [trace('A', 0.1)], { ...rules, traceToTrace: -1 }),
    /Invalid/,
  );
  class Unused {
    constructor() {
      throw Error('Malformed width reached native stage');
    }
  }
  for (const width of [NaN, Infinity, 0, -0.15, undefined]) {
    const bad = trace('A', width as any);
    await assert.rejects(
      restoreNativeWidths(pipeline(Unused), input(), [bad], rules),
      /wire|width|geometry/i,
    );
  }
  await assert.rejects(
    restoreNativeWidths(pipeline(Unused), input(), [trace('A', 0.15), trace('A', 0.15)], rules),
    /unique|identity/i,
  );
  for (const output of [
    [],
    [trace('invented', 0.15)],
    [trace('A', 0.15), trace('A', 0.15)],
    [trace('A', 0.15), trace('B', 0.15), trace('C', 0.15)],
  ]) {
    class BadCoverage {
      solved = true;
      failed = false;
      getOutput() {
        return output;
      }
    }
    await assert.rejects(
      restoreNativeWidths(
        pipeline(BadCoverage),
        input(),
        [trace('A', 0.1), trace('B', 0.14), trace('C', 0.15)],
        rules,
      ),
      /identity\/coverage/,
    );
  }
  class InvalidOutput {
    solved = true;
    failed = false;
    getOutput() {
      return [trace('A', NaN)];
    }
  }
  await assert.rejects(
    restoreNativeWidths(pipeline(InvalidOutput), input(), [trace('A', 0.1)], rules),
    /below required|wire|width/,
  );
});
