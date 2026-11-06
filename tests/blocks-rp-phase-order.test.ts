import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectRpCriticalSignalNets } from '../eda/blocks/rp-phase-order.js';
import type { PlanGraph } from '../src/blocks/graph.js';

const captured = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/rp-phase-order-fixture.json', import.meta.url), 'utf8'));
const fixture = () => ({ graph: structuredClone(captured.graph) as PlanGraph, touched: new Set<string>(captured.touched), clocks: new Set<string>(captured.clockNetNames) });
const expected = ['BUTTON', 'RUN', 'USB_DM', 'USB_DP', 'QSPI_SD3', 'QSPI_SCLK', 'QSPI_SD0', 'QSPI_SD2', 'QSPI_SD1', 'QSPI_SS'];
test('actual 65x55 failure graph prioritizes all six QSPI nets, internal USB and RUN before supply meshes', () => {
  const f = fixture(), before = JSON.stringify(f.graph), touchedBefore = [...f.touched], clocksBefore = [...f.clocks];
  const selected = selectRpCriticalSignalNets(f.graph, f.touched, f.clocks);
  assert.deepEqual([...selected], expected);
  assert.deepEqual([...selected].filter(n => n.startsWith('QSPI_')).sort(), ['QSPI_SCLK', 'QSPI_SD0', 'QSPI_SD1', 'QSPI_SD2', 'QSPI_SD3', 'QSPI_SS']);
  assert.equal(JSON.stringify(f.graph), before); assert.deepEqual([...f.touched], touchedBefore); assert.deepEqual([...f.clocks], clocksBefore);
  assert.equal(captured.capturedRemainingConnection.name, 'source_net_13');
  assert.ok(Math.abs(captured.capturedRemainingConnection.pointsToConnect[0].x + 17.650048) < 1e-10);
  assert.equal(captured.capturedRemainingPhase.preloadedTraces, 102);
});
test('clock remains phase0, power and DRV-owned signals remain dense phase2, unrelated nets stay outside this selector', () => {
  const f = fixture(), early = selectRpCriticalSignalNets(f.graph, f.touched, f.clocks);
  const phase = (name: string) => f.clocks.has(name) ? 0 : f.touched.has(name) ? 2 : early.has(name) ? 1 : undefined;
  for (const name of ['XIN', 'XOUT', 'XTAL_OUT']) assert.equal(phase(name), 0);
  for (const name of ['V3V3', 'VCORE', 'VBUS', 'GND', 'VCP_PUMP', 'VINT_BYPASS', 'IN1', 'IN2']) assert.equal(phase(name), 2);
  for (const name of expected) assert.equal(phase(name), 1);
  assert.equal(early.has('USB_DM_EXT'), false); assert.equal(early.has('CC1'), false);
  // Power classification considers every endpoint: tying MCU BOOT input to GND
  // must not misclassify it as an early logic net merely because its pin is input.
  assert.equal(f.graph.parts.find(p => p.ref === 'U1')!.part.pins['19']!.role, 'input');
  assert.equal(early.has('GND'), false);
});
test('existing fanout or clock ownership always wins and does not mutate the plan graph', () => {
  const f = fixture(); f.touched.add('QSPI_SD0'); f.clocks.add('RUN');
  const selected = selectRpCriticalSignalNets(f.graph, f.touched, f.clocks);
  assert.deepEqual([...selected], expected.filter(n => n !== 'QSPI_SD0' && n !== 'RUN'));
  assert.ok(f.touched.has('QSPI_SD0')); assert.ok(f.clocks.has('RUN'));
});
test('classification follows actual component/pin identity rather than net or global reference spelling', () => {
  const f = fixture(), mcu = f.graph.parts.find(p => p.part.lcsc === 'C2040')!, oldRef = mcu.ref;
  mcu.ref = 'RENAMED_MCU';
  for (const net of f.graph.nets) {
    for (const pin of net.pins) if (pin.ref === oldRef) pin.ref = mcu.ref;
    net.name = 'renamed_' + net.name;
  }
  const selected = selectRpCriticalSignalNets(f.graph, new Set([...f.touched].map(n => 'renamed_' + n)), new Set([...f.clocks].map(n => 'renamed_' + n)));
  assert.deepEqual([...selected], expected.map(n => 'renamed_' + n));
});
test('S3, a misleading RP name, or an unknown profile never receives this finite RP strategy', () => {
  for (const mutate of [
    (p: PlanGraph['parts'][number]) => { p.part.lcsc = 'C2913198'; p.part.mpn = 'ESP32-S3'; p.block.id = 'esp32-s3-core'; },
    (p: PlanGraph['parts'][number]) => { p.part.mpn = 'foreign'; },
    (p: PlanGraph['parts'][number]) => { p.block.id = 'unreviewed-custom-core'; },
    (p: PlanGraph['parts'][number]) => { p.block.version = 999; },
  ]) {
    const f = fixture(); mutate(f.graph.parts.find(p => p.part.lcsc === 'C2040')!);
    assert.deepEqual([...selectRpCriticalSignalNets(f.graph, f.touched, f.clocks)], []);
  }
});
test('unknown pin references, contradictory physical pad aliases and duplicate graph identities reject', () => {
  for (const mutate of [
    (g: PlanGraph) => { g.nets.find(n => n.name === 'QSPI_SD0')!.pins[0]!.ref = 'foreign'; },
    (g: PlanGraph) => { g.nets.find(n => n.name === 'QSPI_SD0')!.pins[0]!.pad = '57'; },
    (g: PlanGraph) => { g.nets.push(structuredClone(g.nets[0]!)); },
    (g: PlanGraph) => { g.parts.push(structuredClone(g.parts[0]!)); },
  ]) {
    const f = fixture(); mutate(f.graph); assert.throws(() => selectRpCriticalSignalNets(f.graph, f.touched, f.clocks));
  }
});
