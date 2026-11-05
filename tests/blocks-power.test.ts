import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPowerBundle, createPowerDrafts, checkPowerReference, checkNtcPowerReference, powerEvidenceGates, batteryAndNtcEvidenceGates, type PowerDraftBundle } from '../eda/blocks/generate-power.js';
import { checkBlockDraft, checkPlan } from '../src/blocks/erc.js';
import { contentHash } from '../src/blocks/library.js';
import type { BlockDef, BlockDraft, BoardPlan, GateResult } from '../src/blocks/contract.js';

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const retained = read<PowerDraftBundle>('../src/blocks/data/power-drafts.json');
const catalogs = () => new Map(retained.catalog.map(p => [p.lcsc, structuredClone(p)]));
const drafts = () => createPowerDrafts(catalogs());
const errors = (g: GateResult[]) => g.flatMap(g => g.issues.filter(i => i.severity === 'error'));
const rules = (g: GateResult[]) => errors(g).map(i => i.rule);
const materialize = (d: BlockDraft): BlockDef => ({ ...d, contentHash: contentHash(d), status: 'unreviewed', provenance: { ...d.provenance, reviews: [] } });

// SYNTHETIC planning-load fixture only: no real supplier identity/device capability is invented.
// Actual power ICs/passives use retained catalog receipts; this fixture exercises aggregate budgets.
function load(): BlockDef {
  return materialize({ schema: 'moki.block/1', id: 'synthetic-fullboard-load', version: 1, title: 'SYNTHETIC load envelope', summary: 'Not physical hardware; author budget for MCU/header/display/mic/SHT and direct5V amp/LED.', class: 'synthetic', provenance: { author: 'agent', authorId: 'SYNTHETIC' },
    parts: [{ ref: 'J1', lcsc: 'SYNTHETIC:LOAD', mpn: 'SYNTHETIC:LOAD', catalogReceipt: `sha256:${'a'.repeat(64)}`, pinout: 'verified', datasheet: { url: 'https://example.invalid/SYNTHETIC-load-budget', pages: '1' }, at: { x: 0, y: 0 }, pins: { P3: { pad: '1', role: 'passive' }, P5: { pad: '2', role: 'passive' }, G: { pad: '3', role: 'ground' } } }],
    nets: [{ name: 'V3', pins: ['J1.P3'] }, { name: 'V5', pins: ['J1.P5'] }, { name: 'G', pins: ['J1.G'] }], params: [],
    ports: [{ id: 'V3', label: '3.3V budget', kind: 'power-in', terminal: 'net:V3', volts: { min: 3, max: 3.6 } }, { id: 'V5', label: '5V budget', kind: 'power-in', terminal: 'net:V5', volts: { min: 4.75, max: 5.25 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }],
    power: { sources: [], sinks: [{ port: 'V3', typicalMa: 251.03, peakMa: 602.6 }, { port: 'V5', typicalMa: 419, peakMa: 563 }] }, constraints: [] });
}
function setup() {
  const source = read<BlockDef[]>('../src/blocks/data/seed.json').find(b => b.id === 'usb-c-sink')!;
  const blocks = [source, ...drafts().slice(0, 2).map(materialize), load()];
  const plan: BoardPlan = { schema: 'moki.plan/1', title: 'USB-present power allocation, not a battery-state proof', layers: 2,
    blocks: blocks.map((b, i) => ({ inst: ['usb', 'charger', 'buck', 'load'][i]!, block: b.id, version: b.version, params: {} })),
    links: [{ from: 'usb.VBUS', to: 'charger.VBUS' }, { from: 'charger.SYS', to: 'buck.SYS' }, { from: 'buck.V3V3', to: 'load.V3' }, { from: 'usb.VBUS', to: 'load.V5' }, ...['charger', 'buck', 'load'].map(inst => ({ from: 'usb.GND', to: `${inst}.GND` }))] };
  return { blocks, plan };
}

test('retained power drafts reproduce actual catalog-bound identities and pass generic draft ERC/power', () => {
  assert.deepEqual(createPowerBundle(retained.catalog), retained);
  const ds = drafts(); assert.equal(ds.length, 4);
  for (const d of ds) { assert.deepEqual(errors(checkBlockDraft(d, catalogs())), []); assert.ok(!('status' in d)); }
  assert.equal(ds[0]!.parts.find(p => p.ref === 'U1')!.pins.ITERM!.pad, '15');
  assert.equal(ds[0]!.parts.find(p => p.ref === 'U1')!.pins.EP!.pad, '17');
  assert.equal(ds[1]!.parts.find(p => p.ref === 'U1')!.pins.EP!.pad, '11');
  const connector = ds[0]!.parts.find(p => p.ref === 'J1')!;
  assert.equal(connector.lcsc, 'C160352'); assert.equal(connector.pins.TAB3!.role, 'nc'); assert.equal(connector.pins.TAB4!.role, 'nc');
  assert.ok(checkPowerReference(ds).ok);
  assert.ok(checkNtcPowerReference(ds).ok);
});

test('original USB revisions retain their exact identities and content alongside new variants', () => {
  const ds = drafts();
  assert.equal(ds[0]!.id, 'bq24074-usb-300ma-ts-bypass'); assert.equal(contentHash(ds[0]!), '5bcc7121c95fda0ff7cae827d7e00b06eb6ede599b27b8fb07078f41a866045e');
  assert.equal(ds[1]!.id, 'tps63001-usb-sys-3v3'); assert.equal(contentHash(ds[1]!), 'f6737dba04f161f87426c22a99896fbe7b1ad7f7e50818fb51a0b17d4c7e11dc');
});

test('NTC variant routes actual SH header toTS and retains real external NTC evidence without fake placement', () => {
  const b = drafts()[2]!;
  assert.equal(b.id, 'bq24074-usb-190ma-ntc-required');
  const j = b.parts.find(p => p.ref === 'J2')!;
  assert.equal(j.lcsc, 'C160402'); assert.equal(j.mpn, 'SM02B-SRSS-TB(LF)(SN)');
  assert.equal(j.pins.RET!.pad, '1'); assert.equal(j.pins.SENSE!.pad, '2');
  assert.deepEqual(b.nets.find(n => n.name === 'TS_PACK')!.pins, ['U1.TS', 'J2.SENSE']);
  assert.ok(b.nets.find(n => n.name === 'GND')!.pins.includes('J2.RET'));
  assert.ok(!b.parts.some(p => p.ref === 'R3' || p.lcsc === 'C5346323'));
  assert.equal(catalogs().get('C5346323')!.mpn, '103AT-2');
  assert.deepEqual(catalogs().get('C5346323')!.pins.map(p => p.pad).sort(), ['1', '2']);
  assert.equal(b.parts.find(p => p.ref === 'R2')!.lcsc, 'C23162');
  assert.equal(b.parts.find(p => p.ref === 'R2')!.value, '4.7kOhm');
  assert.equal(b.power.sources.find(s => s.port === 'BAT')!.maxMa, 210);
  assert.ok(b.params.some(p => p.default === 'external-pack-ntc-required-unqualified'));
});

test('NTC connector faults, sneak fixed bypass and charge-current understatement reject the new reference', () => {
  for (const mutate of [
    (b: BlockDraft) => { b.nets.find(n => n.name === 'TS_PACK')!.pins = ['U1.TS']; },
    (b: BlockDraft) => { b.nets.find(n => n.name === 'TS_PACK')!.pins.push('U1.VSS'); },
    (b: BlockDraft) => { const bypass = structuredClone(drafts()[0]!.parts.find(p => p.ref === 'R3')!); b.parts.push(bypass); b.nets.find(n => n.name === 'TS_PACK')!.pins.push('R3.1'); b.nets.find(n => n.name === 'GND')!.pins.push('R3.2'); },
    (b: BlockDraft) => { b.power.sources.find(s => s.port === 'BAT')!.maxMa = 190; },
    (b: BlockDraft) => { b.parts.find(p => p.ref === 'R2')!.value = '3kOhm'; },
  ]) { const ds = drafts(); mutate(ds[2]!); assert.equal(checkNtcPowerReference(ds).ok, false); }
});

test('NTC/qualified-SYS variants pass a separate USB-present graph with full charging reserved', () => {
  const { plan, blocks } = setup(), ds = drafts();
  blocks[1] = materialize(ds[2]!); blocks[2] = materialize(ds[3]!);
  plan.blocks[1]!.block = blocks[1]!.id; plan.blocks[2]!.block = blocks[2]!.id;
  assert.deepEqual(errors(checkPlan(plan, blocks)), []);
  assert.equal(blocks[1]!.power.sources.find(s => s.port === 'BAT')!.continuousMa, 210);
  assert.equal(blocks[2]!.ports.find(p => p.id === 'SYS')!.volts!.min, 3);
});

test('conditional battery arithmetic cannot promote external NTC, pack cutoff or all-function claims', () => {
  const gates = batteryAndNtcEvidenceGates();
  const arithmetic = gates[0]!; assert.equal(arithmetic.ok, true);
  const candidate = arithmetic.measurements!.find(m => m.name === 'rail plus quiet-audio peak, LEDoff')!;
  assert.ok(candidate.measured > 950 && candidate.measured < 1000);
  const allFunctions = gates.find(g => g.issues.some(i => i.rule === 'all-functions-battery-budget'))!;
  assert.equal(allFunctions.ok, false); assert.ok(allFunctions.measurements![0]!.measured > 1090);
  const verify = gates.find(g => g.gate === 'verify')!;
  assert.equal(verify.ok, false);
  for (const r of ['external-ntc-qualification-missing', 'battery-pass-through-state-unsupported', 'qualified-pack-minimum-unproved', 'quiet-audio-current-not-enforced']) assert.ok(rules([verify]).includes(r));
  assert.ok(arithmetic.issues.some(i => i.rule === 'ntc-trip-tolerance-estimate' && /Unqualified/.test(i.message)));
  for (const g of gates) assert.equal(g.ok, !g.issues.some(i => i.severity === 'error'));
});

test('catalog substitution, mismatched actual pad map and omitted duplicated power pad fail closed', () => {
  const c = catalogs(); c.get('C2861252')!.mpn = 'BQ24075RGTT';
  assert.throws(() => createPowerDrafts(c), /actual verified/i);
  const swapped = catalogs(); swapped.get('C28060')!.pins.find(p => p.pad === '10')!.labels = ['GND'];
  assert.throws(() => createPowerDrafts(swapped), /native pad map/);
  const b = drafts()[0]!; delete b.parts[0]!.pins.BAT3;
  b.nets.forEach(n => { n.pins = n.pins.filter(p => p !== 'U1.BAT3'); });
  assert.ok(rules(checkBlockDraft(b, catalogs())).includes('catalog-pad'));
});

test('USB mode, open safety-timer/default-termination pins and real programming values are enforced', () => {
  for (const mutate of [
    (b: BlockDraft) => { b.parts.find(p => p.ref === 'R1')!.value = '1.1kOhm'; },
    (b: BlockDraft) => { b.parts.find(p => p.ref === 'R2')!.value = '1kOhm'; },
    (b: BlockDraft) => { b.parts.find(p => p.ref === 'R3')!.value = '100kOhm'; },
    (b: BlockDraft) => { b.nets.find(n => n.name === 'GND')!.pins.push('U1.TMR'); },
    (b: BlockDraft) => { b.nets.find(n => n.name === 'GND')!.pins.push('U1.ITERM'); },
    (b: BlockDraft) => { b.nets.find(n => n.name === 'VBUS')!.pins = b.nets.find(n => n.name === 'VBUS')!.pins.filter(p => p !== 'U1.EN2'); b.nets.find(n => n.name === 'GND')!.pins.push('U1.EN2'); },
  ]) { const ds = drafts(); mutate(ds[0]!); assert.equal(checkPowerReference(ds).ok, false); }
});

test('fixed converter feedback, switching inductor and supply topology cannot be silently changed', () => {
  for (const mutate of [
    (b: BlockDraft) => { b.nets.find(n => n.name === 'V3V3')!.pins = b.nets.find(n => n.name === 'V3V3')!.pins.filter(p => p !== 'U1.FB'); b.nets.find(n => n.name === 'SYS')!.pins.push('U1.FB'); },
    (b: BlockDraft) => { b.parts.find(p => p.ref === 'L1')!.value = '1uH'; },
    (b: BlockDraft) => { b.nets.find(n => n.name === 'SW_L2')!.pins = ['U1.L2']; b.nets.find(n => n.name === 'GND')!.pins.push('L1.2'); },
    (b: BlockDraft) => { b.power.sources[0]!.maxMa = 1800; },
  ]) { const ds = drafts(); mutate(ds[1]!); assert.equal(checkPowerReference(ds).ok, false); }
});

test('actual USB seed plus charger/converter supports the declared full-board load envelope', () => {
  const { plan, blocks } = setup();
  assert.deepEqual(errors(checkPlan(plan, blocks)), []);
  const arithmetic = powerEvidenceGates(drafts()).find(g => g.gate === 'power')!;
  assert.ok(arithmetic.ok); assert.ok(arithmetic.measurements!.every(m => m.ok));
  const peak = arithmetic.measurements!.find(m => m.name === 'qualifiedUSB peak allocation')!;
  assert.ok(peak.measured > 1480 && peak.measured < 1500, `tight conditional source budget: ${peak.measured}`);
  assert.ok(arithmetic.measurements!.some(m => m.name.includes('summedSYS+BAT')));
  assert.ok(arithmetic.measurements!.some(m => m.name.includes('peak plus20%')));
});

test('wrong source voltage, insufficient USB source, overloaded rail and battery/SYS short reject plans', () => {
  const weak = setup(); weak.blocks[0]!.power.sources[0]!.maxMa = 1000;
  assert.ok(rules(checkPlan(weak.plan, weak.blocks)).includes('peak-current-budget'));
  const low = setup(); low.blocks[0]!.power.sources[0]!.volts = 4.5; low.blocks[0]!.ports.find(p => p.id === 'VBUS')!.volts = { min: 4.5, max: 4.5 };
  assert.ok(rules(checkPlan(low.plan, low.blocks)).some(r => ['dropout', 'voltage-domain', 'pin-voltage'].includes(r)));
  const overload = setup(); overload.blocks[3]!.power.sinks[0]!.peakMa = 900;
  assert.ok(rules(checkPlan(overload.plan, overload.blocks)).includes('peak-current-budget'));
  const shorted = setup(); const ch = shorted.blocks[1]!;
  const bat = ch.nets.find(n => n.name === 'BAT')!, sys = ch.nets.find(n => n.name === 'SYS')!; bat.pins.push(...sys.pins); ch.nets = ch.nets.filter(n => n !== sys); ch.ports.find(p => p.id === 'SYS')!.terminal = 'net:BAT';
  assert.ok(rules(checkPlan(shorted.plan, shorted.blocks)).includes('battery-system'));
});

test('shared SYS plus BAT heat, missing exposed ground and decoupling faults cannot pass', () => {
  const hot = setup(); const charger = hot.blocks[1]!;
  for (const s of charger.power.sources) s.thermal!.ambientC = 70;
  assert.ok(rules(checkPlan(hot.plan, hot.blocks)).includes('shared-continuous-rating'));
  const ep = drafts()[0]!; ep.nets.find(n => n.name === 'GND')!.pins = ep.nets.find(n => n.name === 'GND')!.pins.filter(p => p !== 'U1.EP');
  assert.ok(rules(checkBlockDraft(ep, catalogs())).includes('ground-pin'));
  const cap = drafts()[1]!; cap.parts.find(p => p.ref === 'C3')!.value = '1nF'; cap.parts.find(p => p.ref === 'C4')!.value = '1nF'; cap.parts.find(p => p.ref === 'C5')!.value = '1nF';
  assert.ok(rules(checkBlockDraft(cap, catalogs())).includes('decoupling-value'));
});

test('USB-only success preserves failed battery, temperature, effective-capacitance and hardware evidence', () => {
  const gate = powerEvidenceGates(drafts()).find(g => g.gate === 'verify')!;
  assert.equal(gate.ok, false);
  for (const expected of ['battery-state-unverified', 'battery-pack-unselected', 'pack-temperature-disabled', 'effective-capacitance-unverified', 'hardware-power-unverified']) assert.ok(rules([gate]).includes(expected));
  const ts = drafts()[0]!;
  assert.match(ts.title, /TS monitoring disabled/);
  assert.ok(ts.params.some(p => p.default === 'disabled-fixed-resistor'));
  for (const g of retained.gates) assert.equal(g.ok, !g.issues.some(i => i.severity === 'error'));
});
