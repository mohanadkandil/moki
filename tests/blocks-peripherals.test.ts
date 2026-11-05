import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPeripheralDrafts, type PeripheralDraftBundle } from '../eda/blocks/generate-peripherals.js';
import { getPart, loadCatalogReceipt } from '../src/blocks/catalog.js';
import { checkBlockDraft } from '../src/blocks/erc.js';
import type { BlockDraft, CatalogPart } from '../src/blocks/contract.js';

const bundle = JSON.parse(await readFile(new URL('../src/blocks/data/peripheral-drafts.json', import.meta.url), 'utf8')) as PeripheralDraftBundle;
const catalogs = new Map(bundle.catalog.map(p => [p.lcsc, p]));
const draft = (id: string) => structuredClone(bundle.drafts.find(d => d.id === id)!);
const part = (d: BlockDraft, ref: string) => d.parts.find(p => p.ref === ref)!;
const net = (d: BlockDraft, pin: string) => d.nets.find(n => n.pins.includes(pin));
const errors = (d: BlockDraft, c = catalogs) => checkBlockDraft(d, c).flatMap(g => g.issues.filter(i => i.severity === 'error'));

test('four separate data-only drafts reproduce deterministically and pass catalog-required standalone ERC', () => {
  assert.equal(bundle.schema, 'moki.peripheral-drafts/1'); assert.equal(bundle.drafts.length, 4);
  assert.deepEqual(buildPeripheralDrafts(catalogs), bundle.drafts);
  for (const d of bundle.drafts) {
    assert.equal(d.provenance.author, 'agent'); assert.equal('status' in d, false); assert.equal('reviews' in d.provenance, false);
    assert.deepEqual(errors(d), [], d.id);
    assert.ok(checkBlockDraft(d, catalogs).some(g => g.issues.some(i => i.rule === 'unreviewed')));
    assert.ok(d.parts.every(p => p.datasheet.url.startsWith('https://') && p.datasheet.pages));
    assert.ok(d.parts.every(p => !p.value || p.valueWhy?.pages));
  }
  assert.ok(bundle.notes.some(n => n.includes('not independent'))); assert.ok(bundle.notes.some(n => n.includes('not') || n.includes('never')));
});

test('embedded actual HTTP receipts verify immutable hashes and replay each exact importer without network', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'moki-peripheral-catalog-')); t.after(() => rm(cacheDir, { recursive: true, force: true }));
  await mkdir(join(cacheDir, 'receipts'));
  for (const r of bundle.receipts) {
    await writeFile(join(cacheDir, 'receipts', `${r.id.slice(7)}.json`), JSON.stringify(r));
    assert.deepEqual(await loadCatalogReceipt(r.id, { cacheDir }), r);
  }
  const fetcher = (async (input: any, init?: RequestInit) => {
    const r = bundle.receipts.find(r => r.request.url === String(input) && r.request.method === (init?.method ?? 'GET') && r.request.body === init?.body);
    assert.ok(r, `No real captured response for ${String(input)}`);
    return new Response(r.rawBody, { status: r.response.status, headers: { 'content-type': r.response.contentType ?? 'application/json' } });
  }) as typeof fetch;
  for (const c of bundle.catalog) {
    const replay = await getPart(c.lcsc, { cacheDir, fetch: fetcher });
    assert.equal(replay.mpn, c.mpn); assert.equal(replay.rawSha256, c.rawSha256); assert.equal(replay.footprintSha256, c.footprintSha256); assert.deepEqual(replay.pins, c.pins); assert.equal(replay.datasheetUrl, c.datasheetUrl);
    const raw = await loadCatalogReceipt(c.catalogReceipt, { cacheDir });
    assert.equal(JSON.parse(raw.rawBody).easyeda_component_details.lcsc, Number(c.lcsc.slice(1)));
  }
});

test('every actual imported pad is mapped exactly once, including amplifier NC/EP and connector mount tabs', () => {
  for (const d of bundle.drafts) for (const p of d.parts) {
    const expected = catalogs.get(p.lcsc)!;
    assert.equal(p.mpn, expected.mpn); assert.equal(p.catalogReceipt, expected.catalogReceipt);
    const pads = Object.values(p.pins).map(p => p.pad);
    assert.equal(new Set(pads).size, pads.length); assert.deepEqual([...pads].sort(), expected.pins.map(p => p.pad).sort());
  }
  const a = draft('i2s-amp-max98357a');
  for (const n of ['5', '6', '12', '13']) { const [name, pin] = Object.entries(part(a, 'U1').pins).find(([, pin]) => pin.pad === n)!; assert.equal(pin.role, 'nc'); assert.equal(net(a, `U1.${name}`), undefined); }
  assert.equal(part(a, 'U1').pins.EP!.pad, '17'); assert.equal(part(a, 'U1').pins.EP!.role, 'ground'); assert.equal(net(a, 'U1.EP')!.name, 'GND');
  const d = draft('ssd1306-i2c-header'); for (const n of ['5', '6']) { const pin = Object.values(part(d, 'J1').pins).find(p => p.pad === n)!; assert.equal(pin.role, 'nc'); }
});

test('microphone follows actual manufacturer pin map, left strap, discharge resistor and bypass', () => {
  const d = draft('i2s-mic-ics43434'), u = part(d, 'U1');
  assert.equal(u.lcsc, 'C5656610'); assert.deepEqual(Object.fromEntries(Object.entries(u.pins).map(([name, pin]) => [name, pin.pad])), { WS: '1', LR: '2', GND: '3', SCK: '4', VDD: '5', SD: '6' });
  assert.equal(u.pins.SD!.role, 'output'); assert.equal(net(d, 'U1.LR')!.name, 'GND');
  assert.equal(part(d, 'R1').lcsc, 'C25803'); assert.equal(part(d, 'R1').value, '100kOhm'); assert.equal(net(d, 'R1.A')!.name, 'SD'); assert.equal(net(d, 'R1.B')!.name, 'GND');
  assert.equal(part(d, 'C1').value, '100nF'); assert.ok(d.constraints.some(c => c.kind === 'decoupling' && c.minUf === .1));
  assert.ok(d.power.sinks[0]!.peakMa >= .55 + 3.6 / 100000 * 1000); assert.match(d.summary, /EOL|acoustic/);
  assert.deepEqual(d.firmware!.libs, []); assert.ok(d.firmware!.includes.includes('driver/i2s.h'));
});

test('amplifier straps and both bypassed supply pins implement left12dB mode with differential speaker only', () => {
  const d = draft('i2s-amp-max98357a'); assert.equal(part(d, 'U1').lcsc, 'C910544'); assert.equal(net(d, 'U1.GAIN')!.name, 'GND'); assert.equal(net(d, 'U1.SD_MODE')!.name, 'V5');
  assert.equal(net(d, 'U1.VDD7')!.name, 'V5'); assert.equal(net(d, 'U1.VDD8')!.name, 'V5'); assert.equal(d.constraints.filter(c => c.kind === 'decoupling').length, 2);
  assert.equal(part(d, 'C2').lcsc, 'C162430'); assert.equal(part(d, 'C2').value, '10uF'); assert.match(part(d, 'C2').valueWhy!.note!, /DC bias/);
  assert.equal(part(d, 'J1').lcsc, 'C131337'); assert.equal(net(d, 'J1.P')!.name, 'SPK_P'); assert.equal(net(d, 'J1.N')!.name, 'SPK_N');
  assert.notEqual(net(d, 'J1.P'), net(d, 'J1.N')); assert.ok(!net(d, 'J1.P')!.pins.some(p => p.includes('GND'))); assert.ok(!net(d, 'J1.N')!.pins.some(p => p.includes('GND')));
  const budget = d.power.sinks[0]!; assert.ok(budget.typicalMa >= 1.4 / (4.75 * .8) * 1000 + 3.35); assert.ok(budget.peakMa >= 1.8 / (4.75 * .8) * 1000 + 3.35);
  assert.match(d.summary, /8ohm/); assert.match(d.summary, /not an IC current rating/); assert.match(d.firmware!.usage, /no shutdown GPIO/);
  assert.deepEqual(d.firmware!.libs, []); assert.ok(d.firmware!.includes.includes('driver/i2s.h'));
});

test('LED DIN is physicalpad4 and only AHCT5V output drives it; 3.3V input and firmware limits stay explicit', () => {
  const d = draft('ws2812b-v5-levelshift'); assert.equal(part(d, 'D1').lcsc, 'C2874885'); assert.equal(part(d, 'D1').pins.DIN!.pad, '4'); assert.equal(part(d, 'D1').pins.DOUT!.pad, '2');
  assert.equal(part(d, 'U1').lcsc, 'C7484'); assert.equal(net(d, 'U1.OE_N')!.name, 'GND'); assert.equal(net(d, 'U1.Y'), net(d, 'D1.DIN'));
  assert.notEqual(net(d, 'U1.A'), net(d, 'D1.DIN')); assert.equal(d.ports.find(p => p.id === 'LED_DATA')!.terminal, 'net:DATA_3V3');
  assert.equal(d.power.sinks[0]!.peakMa, 63); assert.match(part(d, 'U1').datasheet.note!, /DeltaICC1.5mA/);
  assert.deepEqual(d.firmware!.libs, []); assert.match(d.firmware!.usage, /No firmware library\/version is approved/); assert.match(d.firmware!.usage, /280us/);
});

test('display remains an explicit SH1mm module contract with actual pads and pinned approved library versions', () => {
  const d = draft('ssd1306-i2c-header'); assert.equal(part(d, 'J1').lcsc, 'C160404');
  assert.deepEqual(['GND', 'VCC', 'SCL', 'SDA'].map(name => part(d, 'J1').pins[name]!.pad), ['1', '2', '3', '4']);
  assert.deepEqual(d.firmware!.libs, ['adafruit/Adafruit SSD1306@2.5.13', 'adafruit/Adafruit GFX Library@1.11.11', 'adafruit/Adafruit BusIO@1.17.0']);
  assert.match(d.summary, /No bare OLED IC or selected module/); assert.match(d.firmware!.usage, /conservative reserved budget/); assert.deepEqual(d.power.sinks, [{ port: 'V3V3', typicalMa: 50, peakMa: 50 }]);
  assert.equal(part(d, 'R1').value, '10kOhm'); assert.equal(part(d, 'R2').value, '10kOhm'); assert.equal(d.constraints.filter(c => c.kind === 'pullup').length, 2);
});

test('catalog-required ERC rejects missing pads, connected NC and undersized actual bypass values', () => {
  for (const change of [
    (d: BlockDraft) => { delete part(d, 'U1').pins.EP; },
    (d: BlockDraft) => { d.nets.find(n => n.name === 'GND')!.pins.push('U1.NC5'); },
    (d: BlockDraft) => { part(d, 'C2').value = '100nF'; },
    (d: BlockDraft) => { part(d, 'U1').catalogReceipt = `sha256:${'0'.repeat(64)}`; },
  ]) { const d = draft('i2s-amp-max98357a'); change(d); assert.ok(errors(d).length); }
  const absent = new Map<string, CatalogPart>(); assert.ok(errors(draft('i2s-mic-ics43434'), absent).length);
});
