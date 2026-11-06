import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTING_PLANNING_CLEARANCE_MM, withRoutingPlanningMargin } from '../src/board/router-planning.js';

// Routing-boundary fixture, not an executed solver result. Native job32e088ce used
// preset:auto (without this adapter) and left0.093mm trace copper gap versus0.127mm DRC.
const srj = () => ({ layerCount: 2, minTraceWidth: .15, minViaHoleDiameter: .3, minViaPadDiameter: .6,
  minPadEdgeToPadEdgeClearance: .127, minTraceToPadEdgeClearance: .127, minViaEdgeToPadEdgeClearance: .127,
  defaultObstacleMargin: .1, minBoardEdgeClearance: .2,
  bounds: { minX: -50, maxX: 50, minY: -60, maxY: 60 },
  obstacles: [{ type: 'rect', center: { x: 0, y: 0 }, width: .25, height: .6, layers: ['top'], connectedTo: ['V5'] }],
  connections: [{ name: 'amp_WS', pointsToConnect: [{ x: 1, y: 2, layer: 'top', pcb_port_id: 'pcb_port_8' }, { x: 3, y: 4, layer: 'top', pcb_port_id: 'pcb_port_14' }] }],
});

test('carrier planning preserves obstacle margin and geometry while flooring pad clearance', () => {
  const input = srj(), before = structuredClone(input), result = withRoutingPlanningMargin(input);
  assert.equal(ROUTING_PLANNING_CLEARANCE_MM, .25);
  assert.equal(result.defaultObstacleMargin, .1); assert.equal(result.minTraceToPadEdgeClearance, .25); assert.equal(result.minViaEdgeToPadEdgeClearance, .25);
  assert.deepEqual(input, before); assert.notEqual(input, result);
  for (const key of ['layerCount', 'minTraceWidth', 'minViaHoleDiameter', 'minViaPadDiameter', 'minPadEdgeToPadEdgeClearance', 'minBoardEdgeClearance', 'bounds', 'obstacles', 'connections'] as const) assert.deepEqual(result[key], input[key]);
  assert.deepEqual(result.connections[0].pointsToConnect, input.connections[0]!.pointsToConnect);
});

test('planning never lowers stricter input clearance and supplies explicit floors for absent values', () => {
  const input = { ...srj(), defaultObstacleMargin: .4, minTraceToPadEdgeClearance: .35, minViaEdgeToPadEdgeClearance: .3 };
  const result = withRoutingPlanningMargin(input);
  assert.equal(result.defaultObstacleMargin, .4); assert.equal(result.minTraceToPadEdgeClearance, .35); assert.equal(result.minViaEdgeToPadEdgeClearance, .3);
  const absent = withRoutingPlanningMargin({ layerCount: 4 });
  assert.equal(absent.defaultObstacleMargin, undefined); assert.equal(absent.minTraceToPadEdgeClearance, .25); assert.equal(absent.minViaEdgeToPadEdgeClearance, .25);
  assert.deepEqual(withRoutingPlanningMargin(result), result);
});

test('invalid clearances fail before loading or running a solver', () => {
  for (const key of ['minTraceToPadEdgeClearance', 'minViaEdgeToPadEdgeClearance']) for (const value of [NaN, Infinity, -.01, '.3', null]) assert.throws(() => withRoutingPlanningMargin({ ...srj(), [key]: value }), /Invalid routing clearance/);
  for (const input of [null, undefined, [], 'source code']) assert.throws(() => withRoutingPlanningMargin(input), /must be an object/);
});
