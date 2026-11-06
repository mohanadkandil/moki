import test from 'node:test';
import assert from 'node:assert/strict';
import { withChipRoutingPlanningMargin } from '../src/blocks/router-planning.js';

test('chip planning retains mixed net widths, pad topology and native rules', () => {
  const input = {
    minTraceWidth: .15, nominalTraceWidth: .15, defaultObstacleMargin: .1,
    minTraceToPadEdgeClearance: .127, minViaEdgeToPadEdgeClearance: .127,
    minPadEdgeToPadEdgeClearance: .127, minViaPadDiameter: .6,
    connections: [
      { name: 'V5', width: .3, nominalTraceWidth: .3, pointsToConnect: [{ x: 2, y: 1, layer: 'top', pcb_port_id: 'power' }] },
      { name: 'amp_WS', width: .15, nominalTraceWidth: .15, pointsToConnect: [{ x: 2.5, y: 1, layer: 'top', pcb_port_id: 'signal' }] },
    ],
    obstacles: [{ center: { x: 2, y: 1 }, width: .3, height: .6, connectedTo: ['power'], layers: ['top'] }],
  };
  const before = structuredClone(input), next = withChipRoutingPlanningMargin(input);
  assert.equal(next.defaultObstacleMargin, .18);
  assert.equal(next.minTraceToPadEdgeClearance, .15);
  assert.equal(next.minViaEdgeToPadEdgeClearance, .15);
  assert.deepEqual(input, before);
  for (const key of ['minTraceWidth', 'nominalTraceWidth', 'minPadEdgeToPadEdgeClearance', 'minViaPadDiameter', 'connections', 'obstacles'] as const) assert.deepEqual(next[key], input[key]);
});

test('chip planning preserves stricter rules and rejects malformed changed fields', () => {
  const input = { defaultObstacleMargin: .4, minTraceToPadEdgeClearance: .3, minViaEdgeToPadEdgeClearance: .35 };
  assert.deepEqual(withChipRoutingPlanningMargin(input), input);
  assert.deepEqual(withChipRoutingPlanningMargin({}), { defaultObstacleMargin: .18, minTraceToPadEdgeClearance: .15, minViaEdgeToPadEdgeClearance: .15 });
  for (const key of Object.keys(input)) for (const value of [NaN, Infinity, -.01, null, '.2']) assert.throws(() => withChipRoutingPlanningMargin({ [key]: value }), /Invalid routing clearance/);
  for (const input of [null, undefined, [], 'code']) assert.throws(() => withChipRoutingPlanningMargin(input), /must be an object/);
});
