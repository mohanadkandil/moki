import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSht40Draft, SHT40_BUS_CAP_LIMIT_PF } from '../eda/blocks/generate-sht40.js';
import { checkBlockDraft, checkPlan, pinMap } from '../src/blocks/erc.js';
import { contentHash, materializeDraft } from '../src/blocks/library.js';
import type { BlockDef, BlockDraft, BoardPlan, CatalogPart, GateResult } from '../src/blocks/contract.js';

// Real retained catalog/importer fixtures, not invented LCSC parts. No network/native render.
const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const catalog = new Map(read<CatalogPart[]>('../src/blocks/data/parts.json').map(p => [p.lcsc, p]));
const sensor = catalog.get('C2909890')!, bypass = catalog.get('C14663')!;
const draft = () => createSht40Draft(structuredClone(sensor), structuredClone(bypass));
const errors = (gates: GateResult[]) => gates.flatMap(g => g.issues.filter(i => i.severity === 'error'));
const rules = (gates: GateResult[]) => errors(gates).map(i => i.rule);
function integration() {
  const plan = read<BoardPlan>('../src/blocks/data/spike-plan.json');
  const defs = read<BlockDef[]>('../src/blocks/data/seed.json');
  const block = materializeDraft(draft()); defs.push(block);
  plan.blocks.push({ inst: 'ambient', block: block.id, version: block.version, params: {}, at: { x: 20, y: -5 } });
  plan.links.push({ from: 'ambient.V3V3', to: 'ldo-ap2112-3v3.V3V3' }, { from: 'ambient.GND', to: 'esp32-s3-core.GND' }, { from: 'ambient.I2C', to: 'i2c-header.I2C' });
  plan.sections?.push({ id: 'ambient', title: block.title, purpose: 'Ambient sensing, kept away from warm circuitry; physical verification pending.', insts: ['ambient'], notes: ['No duplicate pull-ups; heater disabled; 100kHz bus timing must be verified.'], reference: { lcsc: sensor.lcsc, datasheetUrl: block.parts[0]!.datasheet.url, page: 17, quote: '1 SDA, 2 SCL, 3 VDD, 4 VSS; omit central copper.' } });
  return { plan, defs, block };
}

test('generated draft matches actual catalog receipts, pin map and explicit central-pad correction', () => {
  const b = draft();
  assert.deepEqual(read<BlockDraft>('../src/blocks/data/sht40-draft.json'), b);
  assert.equal(sensor.mpn, 'SHT40-AD1B-R2');
  assert.deepEqual(sensor.pins.map(p => [p.pad, p.labels]), [['1', ['SDA']], ['2', ['SCL']], ['3', ['VDD']], ['4', ['VSS']], ['5', ['EP']]]);
  assert.equal(b.parts[0]!.catalogReceipt, sensor.catalogReceipt);
  assert.deepEqual(Object.entries(b.parts[0]!.pins).map(([name, p]) => [name, p.pad]), [['SDA', '1'], ['SCL', '2'], ['VDD', '3'], ['VSS', '4']]);
  assert.deepEqual(b.parts[0]!.omitPads, ['5']);
  assert.match(b.parts[0]!.correction!.note!, /copper and paste/);
  assert.equal(b.parts[0]!.correction!.pages, '16–17');
  const keepout = b.constraints.find(c => c.kind === 'keepout')!;
  assert.equal(keepout.kind, 'keepout');
  if (keepout.kind === 'keepout') { assert.deepEqual(keepout.excludeParts, ['U1']); assert.ok(Math.abs(b.parts[1]!.at.x - keepout.x) > keepout.width / 2); }
  assert.equal(b.parts[1]!.lcsc, 'C14663'); assert.equal(b.parts[1]!.mpn, 'CC0603KRX7R9BB104');
  assert.equal(b.parts[1]!.value, '100nF'); assert.equal(b.parts[1]!.catalogReceipt, bypass.catalogReceipt);
  assert.deepEqual(errors(checkBlockDraft(b, catalog)), []);
  assert.ok(checkBlockDraft(b, catalog).flatMap(g => g.issues).some(i => i.rule === 'layout-constraint-pending'));
});

test('wrong actual catalog identity, stale receipt and changed native pad map fail closed', () => {
  const wrong = structuredClone(sensor); wrong.mpn = 'wrong';
  assert.throws(() => createSht40Draft(wrong, bypass), /catalog receipt required/);
  const pads = structuredClone(sensor); pads.pins[0]!.labels = ['SCL'];
  assert.throws(() => createSht40Draft(pads, bypass), /pad map differs/);
  const b = draft(); b.parts[0]!.catalogReceipt = `sha256:${'0'.repeat(64)}`;
  assert.ok(rules(checkBlockDraft(b, catalog)).includes('catalog-identity'));
  const ep = draft(); delete ep.parts[0]!.omitPads;
  assert.ok(rules(checkBlockDraft(ep, catalog)).includes('catalog-pad'));
});

test('firmware, address, current and timing assumptions stay explicitly heater-disabled', () => {
  const b = draft();
  assert.deepEqual(b.firmware!.libs, []); assert.deepEqual(b.firmware!.includes, ['Wire.h']);
  assert.deepEqual(b.ports.find(p => p.id === 'I2C')!.bus!.i2cAddresses, [0x44]);
  assert.equal(b.parts.filter(p => p.ref.startsWith('R')).length, 0);
  assert.ok(!b.constraints.some(c => c.kind === 'pullup'));
  assert.deepEqual(b.params.find(p => p.id === 'heater')!.options, ['disabled']);
  assert.deepEqual(b.power.sinks, [{ port: 'V3V3', typicalMa: .5, peakMa: 2 }]);
  assert.throws(() => createSht40Draft(sensor, bypass, { frequencyHz: 400000 }), /100000/);
  for (const value of [0, -1, NaN, Infinity, SHT40_BUS_CAP_LIMIT_PF, 400]) assert.throws(() => createSht40Draft(sensor, bypass, { busCapacitancePf: value }), /capacitance/);
  const declared = createSht40Draft(sensor, bypass, { busCapacitancePf: 80 });
  assert.equal(declared.params.find(p => p.id === 'busCapacitancePf')!.default, 80);
  assert.deepEqual(errors(checkBlockDraft(declared, catalog)), []);
  assert.match(declared.params.find(p => p.id === 'busCapacitancePf')!.why, /not measured/);
});

test('bypass removed, disconnected, too small or too far cannot pass the draft gate', () => {
  for (const mutate of [
    (b: BlockDraft) => { b.parts = b.parts.filter(p => p.ref !== 'C1'); b.nets.forEach(n => { n.pins = n.pins.filter(p => !p.startsWith('C1.')); }); },
    (b: BlockDraft) => { b.nets.find(n => n.name === 'V3V3')!.pins = ['U1.VDD']; b.nets.find(n => n.name === 'GND')!.pins.push('C1.1'); },
    (b: BlockDraft) => { b.parts[1]!.value = '10nF'; },
    (b: BlockDraft) => { b.parts[1]!.at.x = 3; },
  ]) { const b = draft(); mutate(b); assert.ok(errors(checkBlockDraft(b, catalog)).some(i => i.rule.startsWith('decoupling-'))); }
});

test('actual seed carrier supplies shared pull-ups, 3.3V power and family-neutral bus pin map', () => {
  const { plan, defs, block } = integration();
  assert.equal(block.status, 'unreviewed'); assert.deepEqual(block.provenance.reviews, []);
  assert.equal(block.contentHash, contentHash(draft()));
  const header = defs.find(b => b.id === 'i2c-header')!;
  assert.equal(header.constraints.filter(c => c.kind === 'pullup' && c.ohms === 10000).length, 2);
  assert.deepEqual(errors(checkPlan(plan, defs)), []);
  const map = pinMap(plan, defs);
  assert.ok(Object.keys(map.pins).some(k => k === 'PIN_AMBIENT_I2C_SDA'));
  assert.ok(Object.keys(map.pins).some(k => k === 'PIN_AMBIENT_I2C_SCL'));
  assert.equal(map.includes.filter(i => i === 'Wire.h').length, 1);
  assert.ok(map.usage.some(u => u.block === 'ambient' && /heater/.test(u.note)));
});

test('missing carrier pull-ups and wrong 5V supply reject integrated sensor', () => {
  const missing = integration(); missing.defs.find(b => b.id === 'i2c-header')!.constraints = [];
  assert.ok(rules(checkPlan(missing.plan, missing.defs)).includes('i2c-pullup-missing'));
  const wrong = integration(); wrong.plan.links = wrong.plan.links.filter(l => l.from !== 'ambient.V3V3');
  wrong.plan.links.push({ from: 'ambient.V3V3', to: 'usb-c-sink.VBUS' });
  assert.ok(rules(checkPlan(wrong.plan, wrong.defs)).some(r => r === 'voltage-domain' || r === 'pin-voltage'));
});

test('second address-0x44 sensor and heater override reject integrated plan', () => {
  const { plan, defs, block } = integration();
  plan.blocks.push({ inst: 'ambient2', block: block.id, version: block.version, params: {} });
  plan.links.push({ from: 'ambient2.V3V3', to: 'ambient.V3V3' }, { from: 'ambient2.GND', to: 'ambient.GND' }, { from: 'ambient2.I2C', to: 'ambient.I2C' });
  plan.sections?.find(s => s.id === 'ambient')!.insts.push('ambient2');
  assert.ok(rules(checkPlan(plan, defs)).includes('i2c-address-collision'));
  const override = integration(); override.plan.blocks.find(b => b.inst === 'ambient')!.params.heater = 'enabled';
  assert.ok(errors(checkPlan(override.plan, override.defs)).length > 0);
});
