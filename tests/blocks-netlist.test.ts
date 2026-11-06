import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planGraph } from '../src/blocks/graph.js';
import { resolvePlanBlocks } from '../src/blocks/library.js';
import { nativeNetlistIssues } from '../src/blocks/native-netlist.js';
const path = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/sht40-board/';
async function actual() {
  const read = async (n: string) => JSON.parse(await readFile(path + n, 'utf8'));
  const plan = await read('plan.json'),
    graph = planGraph(plan, resolvePlanBlocks(plan)),
    circuit = await read('circuit.json'),
    imports = await read('import-map.json');
  return { graph, circuit, mapping: Object.fromEntries(imports.parts.map((p: any) => [p.ref, p.pins])) };
}
test('actual imported aliases and USB A/B pads preserve the validated plan netlist', async () => {
  const { graph, circuit, mapping } = await actual();
  assert.deepEqual(nativeNetlistIssues(graph, circuit, mapping), []);
});
test('native port swap, missing net trace and added power-ground short cannot pass', async () => {
  for (const kind of ['swap', 'missing', 'short']) {
    const { graph, circuit, mapping } = await actual();
    const ground = circuit.find((c: any) => c.type === 'source_net' && c.name === 'GND').source_net_id,
      vcc = circuit.find((c: any) => c.type === 'source_net' && c.name === 'V3V3').source_net_id;
    if (kind === 'short')
      circuit.push({
        type: 'source_trace',
        source_trace_id: 'injected-short',
        connected_source_port_ids: [],
        connected_source_net_ids: [ground, vcc],
      });
    else {
      const trace = circuit.find(
        (c: any) => c.type === 'source_trace' && c.connected_source_net_ids.includes(vcc),
      );
      if (kind === 'missing') circuit.splice(circuit.indexOf(trace), 1);
      else trace.connected_source_net_ids = [ground];
    }
    assert.ok(nativeNetlistIssues(graph, circuit, mapping).length, kind);
  }
});

test('undeclared connections between isolated pads and unexpected native components/ports fail', async () => {
  for (const kind of ['isolated-short', 'isolated-net', 'extra-component', 'extra-port']) {
    const { graph, circuit, mapping } = await actual();
    const source = circuit.find((c: any) => c.type === 'source_component' && c.name === 'U1');
    const ports = circuit.filter(
      (c: any) =>
        c.type === 'source_port' &&
        c.source_component_id === source.source_component_id &&
        [4, 5].includes(c.pin_number),
    );
    assert.equal(ports.length, 2);
    const ground = circuit.find((c: any) => c.type === 'source_net' && c.name === 'GND').source_net_id;
    if (kind === 'extra-component')
      circuit.push({
        type: 'source_component',
        source_component_id: 'unknown-component',
        name: 'unexpected',
      });
    if (kind === 'extra-component' || kind === 'extra-port')
      circuit.push({
        type: 'source_port',
        source_port_id: 'unexpected-port',
        source_component_id: kind === 'extra-port' ? source.source_component_id : 'unknown-component',
        name: 'unexpected',
        pin_number: 99,
        port_hints: ['pin99'],
      });
    circuit.push({
      type: 'source_trace',
      source_trace_id: 'unexpected-trace',
      connected_source_port_ids:
        kind === 'isolated-short'
          ? ports.map((p: any) => p.source_port_id)
          : kind === 'isolated-net'
            ? [ports[0].source_port_id]
            : ['unexpected-port'],
      connected_source_net_ids:
        kind === 'isolated-short' ? [] : kind === 'isolated-net' ? ['unexpected-isolated-net'] : [ground],
    });
    assert.ok(nativeNetlistIssues(graph, circuit, mapping).length, kind);
  }
});

async function repeatedPadFixture() {
  const base = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/';
  const read = async (n: string) => JSON.parse(await readFile(base + n, 'utf8'));
  const plan = await read('native-port-plan.json'),
    circuit = (await read('native-port-fixture.json')).circuit;
  const imports = await read('native-port-import-map.json');
  return {
    graph: planGraph(plan, resolvePlanBlocks(plan)),
    circuit,
    mapping: Object.fromEntries(imports.parts.map((p: any) => [p.ref, p.pins])),
  };
}
test('actual microphone repeated physical ground pad aliases preserve netlist without accepting shorts or rogue ports', async () => {
  const good = await repeatedPadFixture();
  assert.deepEqual(nativeNetlistIssues(good.graph, good.circuit, good.mapping), []);
  for (const kind of [
    'missing-record',
    'foreign-owner',
    'wrong-hint',
    'wrong-pin',
    'cross-pad-short',
    'rogue-port',
    'unmatched-declaration',
  ]) {
    const f = await repeatedPadFixture(),
      c = f.circuit;
    const alias = c.find((p: any) => p.type === 'source_port' && p.name === 'pin3_internal_1');
    assert.ok(alias);
    const source = c.find(
      (p: any) => p.type === 'source_component' && p.source_component_id === alias.source_component_id,
    );
    const connection = c.find(
      (p: any) =>
        p.type === 'source_component_internal_connection' &&
        p.source_component_id === source.source_component_id,
    );
    if (kind === 'missing-record') c.splice(c.indexOf(connection), 1);
    if (kind === 'foreign-owner') alias.source_component_id = 'foreign';
    if (kind === 'wrong-hint') alias.port_hints = ['pin3_internal_1', 'pin4', '4'];
    if (kind === 'wrong-pin') alias.pin_number = 4;
    if (kind === 'cross-pad-short') {
      const vdd = c.find(
        (p: any) =>
          p.type === 'source_port' &&
          p.source_component_id === source.source_component_id &&
          p.pin_number === 5,
      );
      connection.source_port_ids.push(vdd.source_port_id);
      source.internally_connected_source_port_ids[0].push(vdd.source_port_id);
    }
    if (kind === 'rogue-port')
      c.push({
        ...alias,
        source_port_id: 'rogue-port',
        name: 'pin3_internal_99',
        port_hints: ['pin3_internal_99', 'pin3', '3'],
      });
    if (kind === 'unmatched-declaration') source.internally_connected_source_port_ids[0].pop();
    assert.ok(nativeNetlistIssues(f.graph, c, f.mapping).length, kind);
  }
});

test('canonical native names cannot hide contradictory physical pin metadata', async () => {
  for (const kind of ['number', 'hints', 'extra-number-hint']) {
    const f = await repeatedPadFixture(),
      p = f.circuit.find((p: any) => p.type === 'source_port' && p.name === 'pin1');
    assert.ok(p);
    if (kind === 'number') p.pin_number = 99;
    else if (kind === 'hints') p.port_hints = ['pin99', '99'];
    else p.port_hints.push('pin99');
    assert.ok(nativeNetlistIssues(f.graph, f.circuit, f.mapping).length, kind);
  }
});
