import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareGroundPlaneInput, groundPlaneDirectionRetries } from '../eda/blocks/ground-plane.js';
import { planGraph } from '../src/blocks/graph.js';
import { resolvePlanBlocks } from '../src/blocks/library.js';

const fixturePath = new URL('../docs/engineering/2026-11-05-chip-level/evidence/chip_eda/ground-plane-fixture.json', import.meta.url);
function actual() {
  const f = JSON.parse(readFileSync(fixturePath, 'utf8'));
  return { f, context: { circuit: f.circuit, graph: planGraph(f.plan, resolvePlanBlocks(f.plan)), mapping: f.mapping } };
}

test('captured actual plane input gains only verified repeated-pad ownership and native same-net options', () => {
  const { f, context } = actual(), before = structuredClone(f.input), sourceBefore = structuredClone(context);
  const p = prepareGroundPlaneInput(f.input, context);
  assert.deepEqual(f.input, before); assert.deepEqual(context, sourceBefore);
  assert.equal(p.audit.connections, 61); assert.equal(p.options.allowSameNetMerges, true);
  assert.equal(p.input.allowViaInPad, false); assert.equal(p.options.allowBlindAndBuriedVias, false);
  assert.equal(p.audit.aliases.filter(x => x.ref === 'U1' && x.pad === '41').length, 8);
  assert.equal(p.audit.requiresNativeDrcAndPhysicalCopperGate, true);
  assert.deepEqual(p.input.connections, before.connections); assert.deepEqual(p.input.buses, before.buses);
  assert.deepEqual(p.input.outline, before.outline); assert.deepEqual(p.input.bounds, before.bounds);
  assert.deepEqual(p.input.obstacles.map(({ connectedTo: _, ...o }: any) => o), before.obstacles.map(({ connectedTo: _, ...o }: any) => o));
  for (const key of Object.keys(before).filter(k => k !== 'obstacles')) assert.deepEqual(p.input[key], before[key]);
  for (let i = 0; i < before.obstacles.length; i++) {
    const o = p.input.obstacles[i], old = before.obstacles[i];
    if (JSON.stringify(o.connectedTo) !== JSON.stringify(old.connectedTo)) {
      assert.ok(p.audit.aliases.some(x => x.pcbPort === o.circuitJsonMetadata.pcb_port_id));
      assert.ok(old.connectedTo.every((id: string) => o.connectedTo.includes(id)));
    }
  }
});

test('plane directions use actual narrow pad outward normals rather than component centroid drift', () => {
  const { f, context } = actual(), p = prepareGroundPlaneInput(f.input, context);
  const tps = p.audit.directions.find(x => x.ref === 'U4' && x.pad === '9')!;
  assert.equal(tps.direction, 'right'); assert.equal(p.options.busDirections[tps.connection], 'right');
  assert.equal(p.audit.directions.find(x => x.ref === 'U6' && x.pad === '3')!.direction, 'down');
});

test('conflicting native alias records and foreign physical-port substitutions cannot become GND routing identity', () => {
  for (const mutate of [
    (c: any[]) => { c.splice(c.findIndex(x => x.type === 'source_component_internal_connection'), 1); },
    (c: any[]) => { const p = c.find(x => x.type === 'source_port' && x.name === 'pin41_internal_1'); p.port_hints = ['pin41_internal_1', 'pin4', '4']; },
    (c: any[]) => { const r = c.find(x => x.type === 'source_component_internal_connection'); r.source_port_ids.push('source_port_51'); },
    (c: any[]) => { c.find(x => x.type === 'pcb_port' && x.pcb_port_id === 'pcb_port_41').pcb_component_id = 'foreign-component'; },
  ]) {
    const { f, context } = actual(); mutate(context.circuit);
    assert.throws(() => prepareGroundPlaneInput(f.input, context), /identity|internal|physical pad|native PCB|PCB port/i);
  }
});

test('foreign trace, net and geometry identities in native plane inputs reject before native routing', () => {
  for (const mutate of [
    (f: any) => { f.input.connections[0].source_trace_id = 'not-a-native-trace'; },
    (f: any) => { f.input.connections[0].pointsToConnect[0].x += .1; },
    (f: any) => { f.circuit.find((x: any) => x.type === 'source_trace' && x.source_trace_id === f.input.connections[0].source_trace_id).connected_source_net_ids = ['source_net_2']; },
    (f: any) => { f.input.obstacles.find((o: any) => o.circuitJsonMetadata?.pcb_port_id === 'pcb_port_41').componentId = 'foreign-component'; },
    (f: any) => { f.input.buses[0].termination.layer = 'top'; },
    (f: any) => { f.input.allowViaInPad = true; },
  ]) {
    const { f, context } = actual(); mutate(f);
    assert.throws(() => prepareGroundPlaneInput(f.input, context));
  }
});


function nativeAttempt(input: any, failedNames: string[]) {
  const solved = input.connections.filter((connection: any) => !failedNames.includes(connection.name));
  return { plans: solved.map((connection: any) => ({ connectionName: connection.name })),
    summary: { routedConnectionCount: solved.length, failedBusIds: ['not-authoritative'] } };
}

test('native direction retry maps actual solved-plan identities to only the two failed buses', () => {
  const { f, context } = actual(), prepared = prepareGroundPlaneInput(f.input, context);
  // Fixture scheduling only: partial plan names identify failure, not copper acceptance.
  const failed = ['source_trace_36', 'source_trace_49'];
  const before = structuredClone(prepared);
  const retry = groundPlaneDirectionRetries(prepared.input, prepared.options, nativeAttempt(prepared.input, failed));
  assert.deepEqual(retry.failedConnections, failed); assert.equal(retry.alternatives.length, 15);
  assert.deepEqual(prepared, before);
  const actualBusIds = prepared.input.buses.filter((b: any) => b.connectionNames.some((n: string) => failed.includes(n))).map((b: any) => b.busId);
  const combinations = new Set<string>();
  for (const options of retry.alternatives) {
    const changed = Object.keys(options.busDirections).filter(id => options.busDirections[id] !== prepared.options.busDirections[id]);
    assert.ok(changed.length >= 1 && changed.length <= 2); assert.ok(changed.every(id => actualBusIds.includes(id)));
    for (const key of Object.keys(prepared.options).filter(key => key !== 'busDirections')) assert.deepEqual(options[key], prepared.options[key as keyof typeof prepared.options]);
    for (const [id, direction] of Object.entries(options.busDirections)) {
      assert.ok(['up', 'right', 'down', 'left'].includes(direction as string));
      if (!actualBusIds.includes(id)) assert.equal(direction, prepared.options.busDirections[id]);
    }
    combinations.add(actualBusIds.map((id: string) => options.busDirections[id]).join('|'));
  }
  assert.equal(combinations.size, 15);
  const first = retry.alternatives[0]!;
  assert.equal(first.busDirections[actualBusIds[0]], prepared.options.busDirections[actualBusIds[0]]);
  first.busDirections[actualBusIds[0]] = 'mutated';
  assert.deepEqual(prepared, before);
});

test('one failed plane connection permits exactly three alternate native cardinal hints', () => {
  const { f, context } = actual(), prepared = prepareGroundPlaneInput(f.input, context);
  const connection = prepared.input.connections[0].name;
  // Bus IDs are not required to equal connection IDs.
  const bus = prepared.input.buses.find((b: any) => b.connectionNames.includes(connection));
  const oldId = bus.busId; bus.busId = 'renamed-plane-bus';
  prepared.options.busDirections[bus.busId] = prepared.options.busDirections[oldId]!;
  delete prepared.options.busDirections[oldId];
  const result = groundPlaneDirectionRetries(prepared.input, prepared.options, nativeAttempt(prepared.input, [connection]));
  assert.deepEqual(result.failedConnections, [connection]); assert.equal(result.alternatives.length, 3);
  for (const option of result.alternatives) {
    assert.ok(option.busDirections[bus.busId] !== prepared.options.busDirections[bus.busId]);
    assert.ok(!(oldId in option.busDirections));
  }
});

test('invalid, contradictory or broad native failures never trigger direction searching', () => {
  for (const mutate of [
    (p: any, attempt: any) => { attempt.plans = undefined; },
    (p: any, attempt: any) => { attempt.plans = []; attempt.summary.routedConnectionCount = 0; },
    (p: any, attempt: any) => { attempt.plans[0].connectionName = 'unknown'; },
    (p: any, attempt: any) => { attempt.plans.push(attempt.plans[0]); },
    (p: any, attempt: any) => { attempt.summary.routedConnectionCount--; },
    (p: any, attempt: any) => { attempt.plans.pop(); attempt.summary.routedConnectionCount--; },
    (p: any, attempt: any) => { p.input.buses[0].connectionNames.push('source_trace_36'); },
    (p: any, attempt: any) => { p.options.busDirections.source_trace_36 = 'diagonal'; },
  ]) {
    const { f, context } = actual(), p = prepareGroundPlaneInput(f.input, context), attempt = nativeAttempt(p.input, ['source_trace_36', 'source_trace_49']);
    mutate(p, attempt);
    assert.throws(() => groundPlaneDirectionRetries(p.input, p.options, attempt));
  }
  const { f, context } = actual(), p = prepareGroundPlaneInput(f.input, context);
  assert.throws(() => groundPlaneDirectionRetries(p.input, p.options, nativeAttempt(p.input, [])), /one or two/);
});
