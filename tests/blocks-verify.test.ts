import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REQUIREMENT_METRICS, evaluateRequirements, factsFromPlan } from '../src/blocks/verify.js';
import { checkPlan } from '../src/blocks/erc.js';
import { schematicHash } from '../src/blocks/review.js';
import type { BlockDef, BlockPart, BoardPlan, DeviceFacts, GateResult, Requirement } from '../src/blocks/contract.js';

const facts = (): DeviceFacts => ({ interfaces: ['usb_c_sink', 'display'], boardMm: [55, 35], signals: { STATUS: ['output', 'gpio'] }, netVolts: { '3V3': 3.3 }, netVoltEvidence: {}, loadMa: { typical: 100, peak: 250, estimated: true }, batteryPresent: true, batteryMah: 500, partCount: 12 });
const req = (metric: Requirement['metric'], fields: Partial<Requirement> = {}): Requirement => ({ id: 'test', plain: 'Synthetic check', metric, source: 'maker', ...fields });
const evaluate = (r: Requirement, f = facts()) => evaluateRequirements([r], f);
const result = (r: Requirement, f = facts()) => evaluate(r, f).results![0]!;

test('closed registry and battery estimates honor override, zero fallback and inverse comparison', () => {
  assert.equal(REQUIREMENT_METRICS.length, 8); assert.equal(new Set(REQUIREMENT_METRICS.map(m => m.metric)).size, 8);
  const r = req('battery_life_h', { args: { capacity_mah: 1000 }, op: '>=', value: 8, unit: 'h' });
  const yes = result(r); assert.equal(yes.status, 'pass'); assert.equal(yes.measured, 10); assert.equal(yes.estimated, true); assert.match(yes.evidence, /1000 mAh \/ 100 mA/);
  assert.equal(result({ ...r, args: { capacity_mah: 0 } }).status, 'fail'); assert.equal(result({ ...r, args: { capacity_mah: 0 } }).measured, 5);
  assert.equal(result({ ...r, args: undefined }).measured, 5);
  assert.equal(result({ ...r, op: '<=', value: 8 }).status, 'fail'); assert.equal(result({ ...r, op: '<=', value: 10 }).status, 'pass');
  const noBattery = facts(); noBattery.batteryPresent = false;
  const hypothetical = result(r, noBattery); assert.equal(hypothetical.status, 'unsupported'); assert.equal(hypothetical.measured, 10); assert.equal(hypothetical.estimated, true); assert.match(hypothetical.evidence, /No known battery/);
  assert.equal(evaluate(r, noBattery).ok, true); // Nonfailure is not completion: status remains unsupported.
});

test('zero/NaN load, absent capacity and unknown costs never pass', () => {
  const life = req('battery_life_h', { op: '>=', value: 1, args: { capacity_mah: 0 } });
  for (const load of [undefined, { typical: 0, peak: 250, estimated: true }, { typical: NaN, peak: 250, estimated: true }, { typical: 100, peak: 0, estimated: true }, { typical: 100, peak: 50, estimated: true }]) {
    const f = facts(); f.loadMa = load; assert.equal(result(life, f).status, 'unsupported'); assert.equal(result(req('current_budget_ma', { op: '<=', value: 300 }), f).status, 'unsupported');
  }
  const overflow = facts(); overflow.loadMa = { typical: Number.MIN_VALUE, peak: 1, estimated: true }; assert.equal(result(life, overflow).status, 'unsupported');
  const noCap = facts(); delete noCap.batteryMah; assert.equal(result(life, noCap).status, 'unsupported');
  assert.equal(result(req('bom_cost_usd', { op: '<=', value: 100, unit: 'USD' })).status, 'unsupported');
  const complete = facts(); complete.bomCostUsd = 8.5; assert.equal(result(req('bom_cost_usd', { op: '<=', value: 8, unit: 'USD' }), complete).status, 'fail');
});

test('board dimensions are coordinatewise bounds, with no sorting or implicit rotation', () => {
  for (const op of ['within', '<='] as const) {
    const r = req('board_size_mm', { op, value: [60, 40], unit: 'mm' });
    assert.equal(result(r).status, 'pass');
    const rotated = facts(); rotated.boardMm = [35, 55]; assert.equal(result(r, rotated).status, 'fail');
    assert.deepEqual(result(r, rotated).target, [60, 40]);
    const unknown = facts(); delete unknown.boardMm; assert.equal(result(r, unknown).status, 'unsupported');
  }
});

test('nominal voltage is unsupported until actual SPICE evidence is supplied', () => {
  const r = req('net_voltage', { args: { net: '3V3' }, op: 'within', value: [3.2, 3.4], unit: 'V' }), f = facts();
  assert.equal(result(r, f).status, 'unsupported');
  f.netVoltEvidence!['3V3'] = 'Native SPICE run sha256:example and waveform node3V3';
  assert.equal(result(r, f).status, 'pass'); f.netVolts['3V3'] = 3.5; assert.equal(result(r, f).status, 'fail');
  f.netVolts['3V3'] = NaN; assert.equal(result(r, f).status, 'unsupported');
});

test('interface, validated signal and part facts report absence and limits without guessing', () => {
  assert.equal(result(req('interface_present', { args: { kind: 'USB-C sink' } })).status, 'pass');
  assert.equal(result(req('interface_present', { args: { kind: 'i2s_mic' }, op: 'present' })).status, 'fail');
  assert.equal(result(req('pin_capability', { args: { signal: 'STATUS' } })).status, 'pass');
  for (const caps of [undefined, [], [''], [12], ['output', null]]) {
    const f = facts(); f.signals = { STATUS: caps as any }; assert.equal(result(req('pin_capability', { args: { signal: 'STATUS' } }), f).status, 'unsupported');
  }
  assert.equal(result(req('pin_capability', { args: { signal: 'I2S_MIC' } })).status, 'unsupported');
  const ambiguous = facts(); ambiguous.signals.status = ['output']; assert.equal(result(req('pin_capability', { args: { signal: 'STATUS' } }), ambiguous).status, 'unsupported');
  assert.equal(result(req('part_count', { op: '<=', value: 10 })).status, 'fail'); assert.equal(result(req('part_count', { op: '>=', value: 10 })).status, 'pass');
  assert.equal(result(req('part_count', { op: '>=', value: 0 }), {} as DeviceFacts).status, 'unsupported');
});

test('invalid schema, operators, units, argument types and targets always fail', () => {
  const good = req('battery_life_h', { args: { capacity_mah: 1000 }, op: '>=', value: 8, unit: 'h' });
  for (const r of [null, {}, { ...good, metric: 'unknown' }, { ...good, extra: true }, { ...good, args: { capacity_mah: '1000' } }, { ...good, args: { capacity_mah: -1 } }, { ...good, args: { capacity_mah: NaN } }, { ...good, op: '==' }, { ...good, op: undefined }, { ...good, value: Infinity }, { ...good, value: -1 }, { ...good, value: '8' }, { ...good, unit: 'mAh' }, { ...good, source: 'designer' },
    req('board_size_mm', { op: '<=', value: [60, 0] }), req('net_voltage', { op: 'within', args: { net: 'x' }, value: [5, 3] }), req('pin_capability', { args: { signal: '' } }), req('pin_capability', { args: { signal: '---' } }), req('interface_present', { args: { kind: 'usb' }, op: 'present', value: 1 }), req('current_budget_ma', { op: '>=', value: 0 }), req('part_count', { op: '<=', value: 1.2 })]) {
    const g = evaluate(r as Requirement); assert.equal(g.ok, false, JSON.stringify(r)); assert.equal(g.results![0]!.status, 'fail');
  }
  const duplicate = evaluateRequirements([good, good], facts()); assert.equal(duplicate.ok, false); assert.equal(duplicate.results![1]!.status, 'fail');
  assert.equal(evaluateRequirements(null as any, facts()).ok, false); assert.equal(evaluateRequirements(Array(13).fill(good), facts()).ok, false);
});

// Explicit SYNTHETIC graph exercises upstream accounting and generic MCU aliases, not hardware acceptance.
const cite = { url: 'https://example.invalid/SYNTHETIC.pdf', pages: '1' };
const role = (pad: string, role: BlockPart['pins'][string]['role']) => ({ pad, role });
const part = (ref: string, pins: BlockPart['pins'], value?: string): BlockPart => ({ ref, pins, mpn: 'SYNTHETIC', lcsc: 'SYNTHETIC', catalogReceipt: `sha256:${'a'.repeat(64)}`, datasheet: cite, pinout: 'verified', at: { x: 0, y: 0 }, ...(value ? { value, valueWhy: cite } : {}) });
const cap = (ref: string) => part(ref, { A: role('1', 'passive'), B: role('2', 'passive') }, '1uF');
function blank(id: string, cls: string): BlockDef { return { schema: 'moki.block/1', id, class: cls, version: 1, contentHash: 'a'.repeat(64), title: 'SYNTHETIC', summary: 'Synthetic test graph', status: 'unreviewed', provenance: { author: 'agent', reviews: [] }, parts: [], nets: [], ports: [], params: [], constraints: [], power: { sources: [], sinks: [] } }; }
function graph() {
  const source = blank('usb-c-sink', 'usb_power'); source.parts = [part('J1', { P: role('1', 'passive'), G: role('2', 'ground') })]; source.nets = [{ name: 'P', pins: ['J1.P'] }, { name: 'G', pins: ['J1.G'] }]; source.ports = [{ id: 'OUT', label: '5V', kind: 'power-out', terminal: 'net:P', volts: { min: 5, max: 5 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }]; source.power.sources = [{ port: 'OUT', volts: 5, maxMa: 1000, mode: 'external' }];
  const reg = blank('reg', 'power'); reg.parts = [part('U1', { IN: role('1', 'power-in'), OUT: role('2', 'power-out'), GND: role('3', 'ground') }), cap('C1'), cap('C2')]; reg.nets = [{ name: 'IN', pins: ['U1.IN', 'C1.A'] }, { name: '3V3', pins: ['U1.OUT', 'C2.A'] }, { name: 'G', pins: ['U1.GND', 'C1.B', 'C2.B'] }]; reg.ports = [{ id: 'IN', label: 'Input', kind: 'power-in', terminal: 'net:IN', volts: { min: 5, max: 5 } }, { id: 'OUT', label: 'Output', kind: 'power-out', terminal: 'net:3V3', volts: { min: 3.3, max: 3.3 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }]; reg.power.sources = [{ port: 'OUT', volts: 3.3, maxMa: 500, inputPort: 'IN', mode: 'regulated', conversion: 'switching', efficiency: .8 }]; reg.power.sinks = [{ port: 'IN', typicalMa: 10, peakMa: 20 }]; reg.constraints = ['IN', 'OUT'].map((pin, i) => ({ kind: 'decoupling', ic: 'U1', powerPin: pin, groundPin: 'GND', caps: [`C${i + 1}`], minUf: 1, maxDistanceMm: 2, citation: cite }));
  const mcu = blank('stm32', 'mcu'); mcu.parts = [part('J1', { V: role('1', 'passive'), G: role('2', 'ground'), SIG: role('3', 'output') })]; mcu.nets = [{ name: 'V', pins: ['J1.V'] }, { name: 'G', pins: ['J1.G'] }, { name: 'SIG', pins: ['J1.SIG'] }]; mcu.ports = [{ id: 'IN', label: 'Input', kind: 'power-in', terminal: 'net:V', volts: { min: 3, max: 3.6 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }, { id: 'STATUS', label: 'Status', kind: 'gpio', terminal: 'J1.SIG' }]; mcu.power.sinks = [{ port: 'IN', typicalMa: 100, peakMa: 200 }]; mcu.mcu = { family: 'STM32-SYNTHETIC', pio: { platform: 'ststm32', board: 'SYNTHETIC', framework: 'arduino' }, flashKb: 64, ramKb: 20, pins: [{ id: 'J1.SIG', gpio: 'PA0', caps: ['output', 'gpio'] }] };
  const peripheral = structuredClone(mcu); peripheral.id = 'display'; peripheral.class = 'display'; delete peripheral.mcu; peripheral.parts[0]!.pins.SIG!.role = 'input'; peripheral.power.sinks = [{ port: 'IN', typicalMa: 20, peakMa: 50 }];
  const blocks = [source, reg, mcu, peripheral]; const plan: BoardPlan = { schema: 'moki.plan/1', title: 'SYNTHETIC', layers: 2, board: { widthMm: 55, heightMm: 35 }, blocks: blocks.map((b, i) => ({ inst: ['source', 'reg', 'mcu', 'display'][i]!, block: b.id, version: 1, params: {} })), links: [{ from: 'source.OUT', to: 'reg.IN' }, { from: 'reg.OUT', to: 'mcu.IN' }, { from: 'reg.OUT', to: 'display.IN' }, ...['reg', 'mcu', 'display'].map(i => ({ from: 'source.GND', to: `${i}.GND` })), { from: 'mcu.STATUS', to: 'display.STATUS' }] };
  return { blocks, plan };
}

test('facts use generic MCU aliases and aggregate each upstream load once through conversions', () => {
  const { blocks, plan } = graph(); assert.ok(checkPlan(plan, blocks).every(g => g.ok), JSON.stringify(checkPlan(plan, blocks)));
  const f = factsFromPlan(plan, blocks); assert.deepEqual(f.boardMm, [55, 35]); assert.equal(f.partCount, 6); assert.ok(f.interfaces.includes('usb_c_sink')); assert.ok(f.interfaces.includes('display'));
  assert.ok(Math.abs(f.loadMa!.typical - 109) < 1e-9); assert.ok(Math.abs(f.loadMa!.peak - 226.25) < 1e-9); assert.equal(f.loadMa!.estimated, true);
  assert.deepEqual(f.signals.pa0, ['output', 'gpio']); assert.deepEqual(f.signals.display, ['output', 'gpio']); assert.equal(result(req('pin_capability', { args: { signal: 'PA0' } }), f).status, 'pass');
  assert.deepEqual(Object.keys(f.netVolts), []); assert.equal(f.batteryPresent, false); assert.equal(f.batteryMah, undefined); assert.equal(f.bomCostUsd, undefined);
  const s = blocks[1]!.power.sources[0]!; s.conversion = 'linear'; delete s.efficiency; s.dropoutV = .2; s.maxDissipationW = 1;
  const linear = factsFromPlan(plan, blocks); assert.equal(linear.loadMa!.typical, 130); assert.equal(linear.loadMa!.peak, 270);
  blocks[0]!.class = 'battery'; assert.equal(factsFromPlan(plan, blocks).batteryPresent, true); // Explicit battery-class external source and actual load path, not a charger alone.
});

test('facts omit unsupported multi-source current and malformed or invalid MCU mapping', () => {
  const { blocks, plan } = graph(); const second = structuredClone(blocks[0]!); second.id = 'other-source'; blocks.push(second); plan.blocks.push({ inst: 'other', block: second.id, version: 1, params: {} });
  assert.equal(factsFromPlan(plan, blocks).loadMa, undefined);
  const base = graph(); base.blocks[2]!.mcu!.pins[0]!.caps = ['input']; assert.deepEqual(Object.keys(factsFromPlan(base.plan, base.blocks).signals), []);
  assert.doesNotThrow(() => factsFromPlan(null as any, null as any));
});

test('facts bind a complete SPICE fixture to the current shared net and reject stale plans', async () => {
  const { blocks, plan } = graph(), b = blocks[2]!;
  b.parts.push(part('R1', { A: role('1', 'passive'), B: role('2', 'passive') }, '10k'), part('R2', { A: role('1', 'passive'), B: role('2', 'passive') }, '10k'));
  b.nets[0]!.pins.push('R1.A'); b.nets[1]!.pins.push('R2.B'); b.nets.push({ name: 'ADC', pins: ['R1.B', 'R2.A'] });
  b.spiceChecks = [{ kind: 'divider', name: 'ADC divider', upper: 'R1', lower: 'R2', inputV: 3.3, target: 1.65, tolerance: .01, citation: cite }];
  const fixturePath = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/spice/native-profile-results.json';
  const captured = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(captured.result.ok, true);
  const actual = captured.result.measurements.find((m: any) => m.name === 'divider');
  // The captured engine ran the same fixed 10k/10k, 3.3V profile. This pure test
  // assigns its complete gate fixture to this synthetic graph to test identity handling;
  // it does not claim the original historical worker ran this entire graph.
  const native: GateResult = { ...captured.result, inputHash: schematicHash(plan, blocks), issues: [{ rule: 'spice-evidence', severity: 'warning', message: `Actual native fixed-divider fixture ${fixturePath}` }], measurements: [{ ...actual, where: 'mcu.ADC divider' }] };
  const f = factsFromPlan(plan, blocks, native); assert.equal(f.netVolts.ADC, actual.measured); assert.equal(f.netVolts['mcu.ADC'], actual.measured); assert.equal(f.netVolts['3V3'], undefined); assert.match(f.netVoltEvidence!.ADC!, /native fixed-divider fixture/);
  const voltage = req('net_voltage', { args: { net: 'ADC' }, op: 'within', value: [1.64, 1.66] }); assert.equal(result(voltage, f).status, 'pass');
  native.ok = false; assert.equal(result(voltage, factsFromPlan(plan, blocks, native)).status, 'unsupported'); native.ok = true; native.measurements![0]!.unit = 'ms'; assert.equal(result(voltage, factsFromPlan(plan, blocks, native)).status, 'unsupported');
  native.measurements![0]!.unit = 'V';
  const original = native.inputHash; delete native.inputHash;
  assert.equal(result(voltage, factsFromPlan(plan, blocks, native)).status, 'unsupported'); native.inputHash = original;
  // A valid electrical mutation: renamed instance with all actual links updated.
  plan.blocks[2]!.inst = 'new_mcu';
  plan.links = plan.links.map(link => ({ from: link.from.replace(/^mcu\./, 'new_mcu.'), to: link.to.replace(/^mcu\./, 'new_mcu.') }));
  assert.ok(checkPlan(plan, blocks).every(g => g.ok));
  // Even a coincident measurement name cannot make the stale run current.
  native.measurements![0]!.where = 'new_mcu.ADC divider';
  assert.equal(result(voltage, factsFromPlan(plan, blocks, native)).status, 'unsupported');
  native.inputHash = schematicHash(plan, blocks);
  assert.equal(result(voltage, factsFromPlan(plan, blocks, native)).status, 'pass');
  blocks[2]!.contentHash = 'b'.repeat(64);
  assert.equal(result(voltage, factsFromPlan(plan, blocks, native)).status, 'unsupported');
});

test('confirmed answer/default provenance is accepted without relaxing metric checks',()=>{
 for(const source of ['answer','default'] as const){
  const r=req('part_count',{source,op:'<=',value:20});assert.equal(result(r).status,'pass');
  assert.equal(result({...r,value:-1}).status,'fail');
 }
});
