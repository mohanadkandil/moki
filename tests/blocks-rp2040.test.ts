import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRp2040Draft, RP2040_TARGET, type Rp2040Bundle } from '../eda/blocks/generate-rp2040.js';
import { checkBlockDraft } from '../src/blocks/erc.js';
import { contentHash } from '../src/blocks/library.js';
import { loadCatalogReceipt } from '../src/blocks/catalog.js';
import type { BlockDraft } from '../src/blocks/contract.js';

const bundle = JSON.parse(await readFile(new URL('../src/blocks/data/rp2040-drafts.json', import.meta.url), 'utf8')) as Rp2040Bundle;
const original = bundle.drafts[0]!;
const catalogs = new Map(bundle.catalog.map(p => [p.lcsc, p]));
const clone = () => structuredClone(original);
const part = (d: BlockDraft, ref: string) => d.parts.find(p => p.ref === ref)!;
const net = (d: BlockDraft, pin: string) => d.nets.find(n => n.pins.includes(pin));
const errors = (d: BlockDraft) => checkBlockDraft(d, catalogs).flatMap(g => g.issues.filter(i => i.severity === 'error'));

test('published RP2040 v1 reproduces exactly and remains an author draft with passing pure gates', () => {
  assert.equal(bundle.schema, 'moki.rp2040-bundle/1');
  assert.equal(contentHash(original), '458373d65744db7e252cca97bf94f096a8b1bb77da4672c01b276408290f4c90');
  assert.deepEqual(createRp2040Draft(bundle.catalog), original);
  assert.equal(original.version, 1); assert.equal(original.parts.length, 33);
  assert.equal(original.provenance.author, 'agent'); assert.equal('status' in original, false);
  assert.deepEqual(errors(original), []);
  assert.ok(checkBlockDraft(original, catalogs).some(g => g.issues.some(i => i.rule === 'unreviewed')));
});

test('every physical pad and exact supplier identity is bound to retained real importer evidence', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'moki-rp2040-receipts-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  await mkdir(join(cacheDir, 'receipts'));
  for (const receipt of bundle.receipts) {
    await writeFile(join(cacheDir, 'receipts', receipt.id.slice(7) + '.json'), JSON.stringify(receipt));
    assert.deepEqual(await loadCatalogReceipt(receipt.id, { cacheDir }), receipt);
  }
  assert.equal(bundle.catalog.length, 14); assert.equal(bundle.receipts.length, 28);
  for (const p of original.parts) {
    const c = catalogs.get(p.lcsc)!;
    assert.equal(p.mpn, c.mpn); assert.equal(p.catalogReceipt, c.catalogReceipt);
    assert.deepEqual(Object.values(p.pins).map(p => p.pad).sort(), c.pins.map(p => p.pad).sort());
    const receipt = bundle.receipts.find(r => r.id === c.catalogReceipt)!;
    assert.equal(JSON.parse(receipt.rawBody).easyeda_component_details.lcsc, Number(c.lcsc.slice(1)));
  }
  const bad = structuredClone(bundle.catalog); bad.find(c => c.lcsc === 'C2040')!.pins[0]!.pad = '999';
  assert.throws(() => createRp2040Draft(bad), /MPN\/pad identity differs/);
});

test('1.1V core is separate from 3.3V IO and all manufacturer supply groups have actual bypass parts', () => {
  const d = original;
  assert.equal(net(d, 'U1.45')!.name, 'VCORE');
  for (const pin of [23, 50]) assert.equal(net(d, `U1.${pin}`)!.name, 'VCORE');
  for (const pin of [1, 10, 22, 33, 42, 49, 43, 44, 48]) assert.equal(net(d, `U1.${pin}`)!.name, 'V3V3');
  assert.equal(net(d, 'U1.19')!.name, 'GND'); assert.equal(net(d, 'U1.57')!.name, 'GND');
  for (const pin of [1, 10, 22, 33, 42, 49, 43, 44, 45, 48, 23, 50]) {
    const c = d.constraints.find(c => c.kind === 'decoupling' && c.ic === 'U1' && c.powerPin === String(pin));
    assert.ok(c && c.kind === 'decoupling');
    for (const ref of c.caps) {
      assert.equal(net(d, `${ref}.1`), net(d, `U1.${pin}`)); assert.equal(net(d, `${ref}.2`)!.name, 'GND');
      assert.equal(part(d, ref).value, [44, 45].includes(pin) ? '1uF' : '100nF');
    }
  }
  assert.equal(d.power.sources.find(s => s.port === 'VCORE')!.maxMa, 100);
  const bad = clone(); part(bad, 'C9').value = '100nF'; assert.ok(errors(bad).length);
  const short = clone(); net(short, 'U1.45')!.pins.splice(net(short, 'U1.45')!.pins.indexOf('U1.45'), 1); net(short, 'U1.1')!.pins.push('U1.45'); assert.ok(errors(short).length);
});

test('QSPI uses the actual SOIC8 physical pinout and isolated BOOTSEL with pullup', () => {
  for (const [rp, flash] of [[56, 1], [53, 5], [55, 2], [54, 3], [51, 7], [52, 6]]) assert.equal(net(original, `U1.${rp}`), net(original, `U2.${flash}`));
  assert.equal(part(original, 'U2').mpn, 'W25Q16JVSSIQ');
  assert.equal(net(original, 'U2.8')!.name, 'V3V3'); assert.equal(net(original, 'U2.4')!.name, 'GND');
  assert.equal(part(original, 'R2').value, '1kOhm'); assert.equal(net(original, 'R2.1'), net(original, 'U1.56'));
  assert.equal(net(original, 'R2.2'), net(original, 'SW2.1')); assert.notEqual(net(original, 'U1.56'), net(original, 'SW2.1'));
  assert.equal(net(original, 'SW2.2')!.name, 'GND'); assert.equal(part(original, 'SW2').switch, 'normally-open');
  assert.equal(part(original, 'R3').value, '10kOhm'); assert.equal(net(original, 'R3.1')!.name, 'V3V3');
});

test('recommended crystal has grounded case, 15pF loads and crystal-side 1k output damping', () => {
  assert.equal(part(original, 'X1').mpn, 'ABM8-272-T3');
  assert.equal(net(original, 'X1.2')!.name, 'GND'); assert.equal(net(original, 'X1.4')!.name, 'GND');
  assert.equal(net(original, 'X1.1'), net(original, 'U1.20'));
  assert.equal(net(original, 'R1.1'), net(original, 'U1.21')); assert.equal(net(original, 'R1.2'), net(original, 'X1.3'));
  assert.notEqual(net(original, 'U1.21'), net(original, 'X1.3')); assert.equal(part(original, 'R1').value, '1kOhm');
  for (const [ref, pin] of [['C15', 'X1.1'], ['C16', 'X1.3']]) {
    assert.equal(part(original, ref!).value, '15pF'); assert.equal(net(original, ref + '.1'), net(original, pin!)); assert.equal(net(original, ref + '.2')!.name, 'GND');
  }
});

test('USB has independent 5.1k Rd, correct ESD channels and 27Ohm links; RUN has external pullup and switch', () => {
  for (const [rp, r, esd, connector] of [['46', 'R5', '1', 'A7'], ['47', 'R6', '3', 'A6']]) {
    assert.equal(part(original, r!).value, '27Ohm'); assert.equal(net(original, 'U1.' + rp), net(original, r + '.1'));
    assert.equal(net(original, r + '.2'), net(original, 'U4.' + esd)); assert.equal(net(original, 'U4.' + esd), net(original, 'J1.' + connector));
  }
  assert.equal(net(original, 'U4.1'), net(original, 'U4.6')); assert.equal(net(original, 'U4.3'), net(original, 'U4.4'));
  for (const [cc, r] of [['A5', 'R7'], ['B5', 'R8']]) { assert.equal(part(original, r!).value, '5.1kOhm'); assert.equal(net(original, 'J1.' + cc), net(original, r + '.1')); assert.equal(net(original, r + '.2')!.name, 'GND'); }
  assert.notEqual(net(original, 'J1.A5'), net(original, 'J1.B5'));
  assert.equal(net(original, 'R4.2'), net(original, 'U1.26')); assert.equal(net(original, 'SW1.1'), net(original, 'U1.26'));
  assert.equal(part(original, 'R4').value, '10kOhm'); assert.equal(net(original, 'R4.1')!.name, 'V3V3'); assert.equal(net(original, 'SW1.2')!.name, 'GND');
});

test('all canonical GP ports and motor aliases retain real physical PWM/ADC facts and the official mbed target', () => {
  assert.deepEqual(original.mcu!.pio, RP2040_TARGET); assert.deepEqual(RP2040_TARGET, { platform: 'platformio/raspberrypi@1.20.0', board: 'pico', framework: 'arduino', environment: 'rp2040' });
  const pads = [2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,27,28,29,30,31,32,34,35,36,37,38,39,40,41];
  for (let gpio = 0; gpio < 30; gpio++) {
    const p = original.ports.find(p => p.id === `GP${gpio}`)!;
    assert.equal(p.terminal, `U1.${pads[gpio]}`); assert.equal(p.kind, gpio >= 26 ? 'analog' : 'gpio');
    const f = original.mcu!.pins.find(p => p.id === `U1.${pads[gpio]}`)!;
    assert.equal(f.gpio, gpio); assert.ok(f.caps.includes('pwm')); assert.equal(f.caps.includes('adc'), gpio >= 26); assert.equal(f.reserved, undefined);
  }
  assert.equal(original.ports.find(p => p.id === 'MOTOR_IN1')!.terminal, 'U1.17'); assert.equal(original.ports.find(p => p.id === 'MOTOR_IN2')!.terminal, 'U1.18');
  assert.deepEqual(original.ports.find(p => p.id === 'I2C')!.bus!.signals, { SDA: 'U1.31', SCL: 'U1.32' });
  assert.match(original.firmware!.usage, /Default Wire uses GP4\/5/); assert.match(original.firmware!.usage, /Arduino-mbed/);
  const missingAdc = clone(); missingAdc.mcu!.pins.find(p => p.gpio === 26)!.caps = ['input', 'output', 'bidirectional', 'pwm']; assert.ok(errors(missingAdc).length);
});

test('catalog substitution and physically missing required supply/ground pads fail closed', () => {
  for (const mutate of [
    (d: BlockDraft) => { delete part(d, 'U1').pins['57']; },
    (d: BlockDraft) => { part(d, 'U2').catalogReceipt = `sha256:${'0'.repeat(64)}`; },
    (d: BlockDraft) => { const n = net(d, 'U1.44')!; n.pins = n.pins.filter(p => p !== 'U1.44'); },
    (d: BlockDraft) => { const n = net(d, 'U1.19')!; n.pins = n.pins.filter(p => p !== 'U1.19'); },
  ]) { const d = clone(); mutate(d); assert.ok(errors(d).length); }
});
