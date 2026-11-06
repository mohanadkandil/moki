import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { searchParts, getPart, loadCatalogReceipt, type CatalogOptions } from '../src/blocks/catalog.js';

const evidence = resolve('docs/engineering/2026-11-05-chip-level/evidence/chip_eda');
const fixture = (name: string) => readFile(join(evidence, name), 'utf8');
const digest = (data: string) => createHash('sha256').update(data).digest('hex');
const PRIMARY = 'https://jlcsearch.tscircuit.com/api/search';
const FALLBACK = 'https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList';
const IMPORTER = 'https://jlcsearch.tscircuit.com/api/easyeda_components/C2909890';
async function sandbox(t: test.TestContext) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'moki-catalog-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true })); return cacheDir;
}
function fake(fn: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => fn(String(input), init ?? {})) as typeof fetch;
}
const response = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

test('primary search normalizes real catalog rows and reuses immutable captured evidence', async t => {
  const raw = await fixture('search-research/search-sht40.response'), expected = JSON.parse(raw).components;
  const cacheDir = await sandbox(t); let calls = 0;
  const fetcher = fake((url, init) => {
    calls++; assert.equal(new URL(url).origin + new URL(url).pathname, PRIMARY); assert.equal(new URL(url).searchParams.get('q'), 'SHT40');
    assert.equal(new URL(url).searchParams.get('limit'), '8'); assert.equal(init.redirect, 'error'); assert.ok(init.signal); return response(raw);
  });
  const options = { cacheDir, fetch: fetcher }, first = await searchParts(' SHT40 ', options);
  assert.equal(first.length, expected.length); assert.equal(first[0]!.lcsc, `C${expected[0].lcsc}`); assert.equal(first[0]!.mpn, expected[0].mfr);
  assert.equal(first[0]!.stock, expected[0].stock); assert.match(first[0]!.catalogReceipt, /^sha256:[a-f0-9]{64}$/);
  const receipt = await loadCatalogReceipt(first[0]!.catalogReceipt, options);
  assert.equal(receipt.rawBody, raw); assert.equal(receipt.response.bodySha256, digest(raw)); assert.equal(receipt.request.method, 'GET');
  assert.deepEqual(await searchParts('SHT40', options), first); assert.equal(calls, 1);
  assert.equal((await readdir(join(cacheDir, 'receipts'))).length, 1);
});

test('D1 overload falls back to the real primary JLC POST response and preserves both HTTP receipts', async t => {
  const failure = await fixture('search-research/list-sht40.response'), raw = await fixture('search-research/jlc-post-max98357a.response');
  const cacheDir = await sandbox(t); const requests: string[] = [];
  const fetcher = fake((url, init) => {
    requests.push(url);
    if (url.startsWith(PRIMARY)) return response(failure, 500);
    assert.equal(url, FALLBACK); assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(String(init.body)), { keyword: 'MAX98357A', currentPage: 1, pageSize: 8 });
    return response(raw);
  });
  const rows = await searchParts('MAX98357A', { cacheDir, fetch: fetcher });
  const real = rows.find(p => p.lcsc === 'C910544'); assert.ok(real); assert.equal(real.mpn, 'MAX98357AETE+T');
  assert.equal(real.manufacturer, 'Analog Devices Inc./Maxim Integrated'); assert.equal(real.package, 'TQFN-16-EP(3x3)');
  // Preserve discovery results; do not quietly replace the leading unstocked module with an IC.
  assert.equal(rows[0]!.stock, 0); assert.notEqual(rows[0]!.lcsc, real.lcsc);
  assert.equal(requests.length, 2); assert.equal((await readdir(join(cacheDir, 'receipts'))).length, 2);
  const receipt = await loadCatalogReceipt(real.catalogReceipt, { cacheDir }); assert.equal(receipt.request.url, FALLBACK); assert.equal(receipt.rawBody, raw);
});

test('importer resolves exact identity, actual pin labels, raw hashes and supplied model identifiers without fetching models', async t => {
  const raw = await fixture('nonseed/tscircuit-easyeda-cache.json'), manual = await fixture('search-research/jlc-exact-C2909890.response'), cacheDir = await sandbox(t); let calls = 0;
  const options = { cacheDir, fetch: fake((url, init) => {
    calls++; if (url === IMPORTER) return response(raw);
    assert.equal(url, FALLBACK); assert.equal(JSON.parse(String(init.body)).keyword, 'C2909890'); return response(manual);
  }) };
  const part = await getPart('C2909890', options);
  assert.equal(part.mpn, 'SHT40-AD1B-R2'); assert.equal(part.rawSha256, digest(raw)); assert.match(part.footprintSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(part.pins, [{ pad: '1', labels: ['SDA'] }, { pad: '2', labels: ['SCL'] }, { pad: '3', labels: ['VDD'] }, { pad: '4', labels: ['VSS'] }, { pad: '5', labels: ['EP'] }]);
  // The importer exposes EP; datasheet-driven corrections belong to an explicitly reviewed block.
  assert.equal(part.models.length, 2); assert.ok(part.models.every(m => new URL(m.url).hostname === 'modules.easyeda.com'));
  assert.equal(part.datasheetUrl, JSON.parse(manual).data.componentPageInfo.list[0].dataManualUrl);
  assert.ok(part.datasheetReceipt); assert.notEqual(part.datasheetReceipt, part.catalogReceipt);
  assert.equal((await loadCatalogReceipt(part.datasheetReceipt, options)).rawBody, manual);
  assert.deepEqual(await getPart('C2909890', options), part); assert.equal(calls, 2);
  assert.equal((await loadCatalogReceipt(part.catalogReceipt, options)).rawBody, raw);
});

test('importer rejects mismatched supplier, manufacturer-part, footprint and pin identities', async t => {
  const original = JSON.parse(await fixture('nonseed/tscircuit-easyeda-cache.json')), cacheDir = await sandbox(t);
  for (const mutate of [
    (j: any) => { j.easyeda_component_details.lcsc = 1; },
    (j: any) => { j.easyeda_component_details.easyeda_json.lcsc.number = 'C1'; },
    (j: any) => { j.easyeda_component_details.easyeda_json.title = 'Another component'; },
    (j: any) => { j.easyeda_component_details.easyeda_json.packageDetail.uuid = 'wrong'; },
    (j: any) => {
      const shape = j.easyeda_component_details.easyeda_json.dataStr.shape[2].split('^^'), physical = shape[4].split('~');
      physical[4] = '99'; shape[4] = physical.join('~'); j.easyeda_component_details.easyeda_json.dataStr.shape[2] = shape.join('^^');
    },
  ]) {
    const j = structuredClone(original); mutate(j);
    await assert.rejects(getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(() => response(JSON.stringify(j))) }), /mismatch|matching physical pad/);
  }
});

test('actual Worldsemi LED physical DIN pad 4 overrides stale SPICE pin 3', async t => {
  const raw = await fixture('audio-led-research/led-importer.json'), cacheDir = await sandbox(t);
  const part = await getPart('C2874885', { cacheDir, fetch: fake(url => response(url.endsWith('/C2874885') ? raw : '{"code":200,"data":{"componentPageInfo":{"list":[]}}}')) });
  const byPad = Object.fromEntries(part.pins.map(pin => [pin.pad, pin.labels]));
  assert.deepEqual(byPad, { '1': ['VDD'], '2': ['DOUT'], '3': ['VSS'], '4': ['DIN'] });
  const original = JSON.parse(raw), shapes = original.easyeda_component_details.easyeda_json.dataStr.shape;
  assert.ok(shapes.some((s: string) => s.startsWith('P~') && s.split('^^')[0]!.split('~')[3] === '3' && s.split('^^')[3]?.split('~')[4] === 'DIN'));
});

test('datasheet metadata comes only from the exact supplier identity and safe HTTPS response fields', async t => {
  const raw = await fixture('nonseed/tscircuit-easyeda-cache.json'), actual = JSON.parse(await fixture('search-research/jlc-exact-C2909890.response'));
  const cacheDir = await sandbox(t);
  const get = (body: any) => getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => response(url === IMPORTER ? raw : JSON.stringify(body))) });
  for (const url of ['http://example.com/a.pdf', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://metadata.internal/a', 'https://user:pass@lcsc.com/a', 'https://lcsc.com:8443/a']) {
    const changed = structuredClone(actual); changed.data.componentPageInfo.list[0].dataManualUrl = url;
    assert.equal((await get(changed)).datasheetUrl, undefined, url);
  }
  const wrongId = structuredClone(actual); wrongId.data.componentPageInfo.list[0].componentCode = 'C1';
  assert.equal((await get(wrongId)).datasheetUrl, undefined);
  const wrongMpn = structuredClone(actual); wrongMpn.data.componentPageInfo.list[0].componentModelEn = 'OTHER';
  await assert.rejects(get(wrongMpn), /datasheet manufacturer part number mismatch/);
  const preferred = structuredClone(actual); preferred.data.componentPageInfo.list[0].dataManualOfficialLink = 'https://sensirion.com/datasheet.pdf';
  // A mutation tests precedence; the positive real URL test above uses the untouched response.
  assert.equal((await get(preferred)).datasheetUrl, 'https://sensirion.com/datasheet.pdf');
  const rows = await searchParts('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => response(url.startsWith(PRIMARY) ? '{"components":[]}' : JSON.stringify(actual))) });
  assert.equal(rows[0]!.datasheetUrl, actual.data.componentPageInfo.list[0].dataManualUrl);
});

test('actual C160404 display-title whitespace preserves the exact supplier MPN', async t => {
  const raw = await fixture('search-research/C160404-catalog-response.json'), cacheDir = await sandbox(t);
  const captured = JSON.parse(raw).easyeda_component_details.easyeda_json;
  assert.equal(captured.title, 'SM04B-SRSS-TB (LF)(SN)');
  assert.equal(captured.dataStr.head.c_para['Manufacturer Part'], 'SM04B-SRSS-TB(LF)(SN)');
  const options = { cacheDir, fetch: fake(url => { assert.equal(url, 'https://jlcsearch.tscircuit.com/api/easyeda_components/C160404'); return response(raw); }) };
  const part = await getPart('C160404', options);
  assert.equal(part.lcsc, 'C160404'); assert.equal(part.mpn, 'SM04B-SRSS-TB(LF)(SN)');
  const changed = JSON.parse(raw); changed.easyeda_component_details.easyeda_json.title = 'SM04B-SRSS-TB(LF)(SN)-OTHER';
  await assert.rejects(getPart('C160404', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(() => response(JSON.stringify(changed))) }), /manufacturer part number mismatch/);
});

test('footprint pinning is stable across JSON key order and changes when actual imported geometry changes', async t => {
  const original = JSON.parse(await fixture('nonseed/tscircuit-easyeda-cache.json')), cacheDir = await sandbox(t);
  const get = (j: any) => getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(() => response(JSON.stringify(j))) });
  const first = await get(original), reordered = structuredClone(original);
  const geometry = reordered.easyeda_component_details.easyeda_json.packageDetail.dataStr;
  reordered.easyeda_component_details.easyeda_json.packageDetail.dataStr = Object.fromEntries(Object.entries(geometry).reverse());
  assert.equal((await get(reordered)).footprintSha256, first.footprintSha256);
  reordered.easyeda_component_details.easyeda_json.packageDetail.dataStr.shape[0] += '~changed';
  assert.notEqual((await get(reordered)).footprintSha256, first.footprintSha256);
});

test('malformed successful search and HTTP/application failures do not become fabricated empty results', async t => {
  const cacheDir = await sandbox(t);
  for (const [raw, status] of [['not JSON', 200], ['{"error":"upstream"}', 500], ['{"code":500,"data":{"componentPageInfo":{"list":[]}}}', 200]]) {
    await assert.rejects(searchParts('SHT40', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(() => response(String(raw), Number(status))) }), /search unavailable/);
  }
  assert.deepEqual(await searchParts('SHT40', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => response(url.startsWith(PRIMARY) ? '{"components":[]}' : '{"code":200,"data":{"componentPageInfo":{"list":[]}}}')) }), []);
});

test('an empty indexed search still tries the broader actual supplier catalog', async t => {
  const cacheDir = await sandbox(t), raw = await fixture('search-research/jlc-post-ics43434.response'); let calls = 0;
  const rows = await searchParts('ICS43434', { cacheDir, fetch: fake(url => { calls++; return response(url.startsWith(PRIMARY) ? '{"components":[]}' : raw); }) });
  assert.ok(rows.some(p => p.lcsc === 'C5656610' && p.mpn === 'ICS-43434')); assert.equal(calls, 2);
});

test('input, response-size and timeout bounds fail closed; receipt IDs cannot traverse paths', async t => {
  const cacheDir = await sandbox(t); let calls = 0;
  const unused = fake(() => { calls++; return response('{}'); });
  for (const q of ['', 'a', 'x'.repeat(121), 'sensor\ncommand']) await assert.rejects(searchParts(q, { cacheDir, fetch: unused }), /search/);
  for (const id of ['2909890', 'c2909890', 'C0', 'C1/../../x', 'https://example.com']) await assert.rejects(getPart(id, { cacheDir, fetch: unused }), /LCSC/);
  await assert.rejects(loadCatalogReceipt('../x', { cacheDir }), /receipt ID/); assert.equal(calls, 0);
  const raw = await fixture('nonseed/tscircuit-easyeda-cache.json');
  await assert.rejects(getPart('C2909890', { cacheDir, maxResponseBytes: 64, fetch: fake(() => response(raw)) }), /size limit/);
  const ids = await readdir(join(cacheDir, 'receipts')); const oversized = JSON.parse(await readFile(join(cacheDir, 'receipts', ids[0]!), 'utf8'));
  assert.equal(oversized.response.truncated, true); assert.equal(Buffer.byteLength(oversized.rawBody), 64);
  const aborted = fake((_url, init) => new Promise((_yes, no) => { const signal = init.signal!; signal.addEventListener('abort', () => no(signal.reason), { once: true }); }));
  // Keep the event loop alive because AbortSignal.timeout's own timer is unreferenced.
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(getPart('C2909890', { cacheDir, timeoutMs: 10, fetch: aborted }), /timeout/i); }
  finally { clearInterval(keepAlive); }
});

test('tampered immutable receipts fail integrity checks and disabled cache re-fetches stock snapshots', async t => {
  const cacheDir = await sandbox(t), raw = await fixture('search-research/search-sht40.response'); let calls = 0;
  const options: CatalogOptions = { cacheDir, fetch: fake(() => { calls++; return response(raw); }) };
  const rows = await searchParts('SHT40', options), id = rows[0]!.catalogReceipt;
  const path = join(cacheDir, 'receipts', `${id.slice(7)}.json`), original = await readFile(path, 'utf8'), changed = JSON.parse(original);
  changed.rawBody = '{}'; await writeFile(path, JSON.stringify(changed));
  await assert.rejects(loadCatalogReceipt(id, options), /integrity/);
  await writeFile(path, original);
  await searchParts('SHT40', { ...options, cacheMaxAgeMs: 0 }); assert.equal(calls, 2);
});

test('confirmed importer absence returns exact supplier metadata and keeps both immutable receipts', async t => {
  const raw = await fixture('search-research/jlc-exact-C2909890.response'), cacheDir = await sandbox(t); let imports = 0, suppliers = 0;
  // Simulated 404 availability failure; the positive identity/MPN body is an untouched actual JLC response.
  const options = { cacheDir, fetch: fake(url => { if (url === IMPORTER) { imports++; return response('{"error":"not found"}', 404); } assert.equal(url, FALLBACK); suppliers++; return response(raw); }) };
  const part = await getPart('C2909890', options);
  assert.equal(part.mpn, 'SHT40-AD1B-R2'); assert.equal(part.importer, 'jlcpcb-metadata-only'); assert.deepEqual(part.pins, []); assert.equal(part.footprintSha256, ''); assert.deepEqual(part.models, []);
  assert.equal(part.rawSha256, digest(raw)); assert.equal((await loadCatalogReceipt(part.catalogReceipt, options)).rawBody, raw);
  assert.equal((await loadCatalogReceipt(part.importerUnavailableReceipt!, options)).response.status, 404);
  await getPart('C2909890', options); assert.equal(imports, 2); assert.equal(suppliers, 1); // Absence never becomes an imported-part cache hit.
  await assert.rejects(getPart('C2909890', { ...options, allowMetadataOnly: false }), /unavailable/);
});

test('metadata fallback rejects unavailable supplier identities and does not conceal malformed importer responses', async t => {
  const raw = await fixture('search-research/jlc-exact-C2909890.response'), original = JSON.parse(await fixture('nonseed/tscircuit-easyeda-cache.json')), cacheDir = await sandbox(t);
  for (const mutate of [
    (j: any) => { j.data.componentPageInfo.list[0].componentCode = 'C1'; },
    (j: any) => { j.data.componentPageInfo.list.push(structuredClone(j.data.componentPageInfo.list[0])); },
    (j: any) => { j.code = 500; },
  ]) { const j = JSON.parse(raw); mutate(j); await assert.rejects(getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => url === IMPORTER ? response('{}', 404) : response(JSON.stringify(j))) }), /exact LCSC|successful catalog/); }
  for (const mutate of [
    (j: any) => { j.easyeda_component_details.lcsc = 1; },
    (j: any) => { j.easyeda_component_details.easyeda_json.packageDetail.uuid = 'wrong'; j.easyeda_component_details.easyeda_json.packageDetail.dataStr.shape = []; },
    (j: any) => { j.easyeda_component_details.easyeda_json.packageDetail.dataStr = 'bad JSON'; },
  ]) {
    const j = structuredClone(original); mutate(j); let suppliers = 0;
    await assert.rejects(getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => { if (url !== IMPORTER) suppliers++; return response(JSON.stringify(j)); }) }), /mismatch|Invalid importer/);
    assert.equal(suppliers, 0);
  }
  for (const status of [403, 500, 503]) await assert.rejects(getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(() => response('{}', status)) }), /HTTP/);
});

test('explicit missing geometry falls back only after importer identities and supplier MPN agree', async t => {
  const original = JSON.parse(await fixture('nonseed/tscircuit-easyeda-cache.json')), actual = await fixture('search-research/jlc-exact-C2909890.response'), cacheDir = await sandbox(t);
  original.easyeda_component_details.easyeda_json.packageDetail.dataStr.shape = [];
  const get = (supplier: string) => getPart('C2909890', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => response(url === IMPORTER ? JSON.stringify(original) : supplier)) });
  const part = await get(actual); assert.equal(part.importer, 'jlcpcb-metadata-only'); assert.ok(part.importerUnavailableReceipt);
  const wrong = JSON.parse(actual); wrong.data.componentPageInfo.list[0].componentModelEn = 'OTHER'; await assert.rejects(get(JSON.stringify(wrong)), /MPN mismatch/);
});

test('audited DRV8833 reel-title alias binds exact supplier, component and package identities', async t => {
  const receipt = JSON.parse(await readFile(resolve('docs/engineering/2026-11-06-chip-live/evidence/chip_eda/motor/drv8833-import-receipt.json'), 'utf8'));
  const raw = receipt.rawBody, cacheDir = await sandbox(t);
  const run = (body: string) => getPart('C50506', { cacheDir, cacheMaxAgeMs: 0, fetch: fake(url => response(url.endsWith('/C50506') ? body : '{"code":200,"data":{"componentPageInfo":{"list":[]}}}')) });
  const actual = await run(raw);
  assert.equal(actual.mpn, 'DRV8833PWPR'); assert.equal(actual.pins.length, 17);
  for (const mutate of [
    (c: any) => { c.title = 'DRV8833PWPX'; },
    (c: any) => { c.dataStr.head.c_para['Manufacturer Part'] = 'DRV8833PWPR-HX'; },
    (c: any) => { c.dataStr.head.c_para['Supplier Part'] = 'C53055901'; },
    (c: any) => { c.uuid = 'different'; },
    (c: any) => { c.packageDetail.uuid = c.dataStr.head.puuid = 'different'; },
  ]) {
    const changed = JSON.parse(raw); mutate(changed.easyeda_component_details.easyeda_json);
    await assert.rejects(run(JSON.stringify(changed)), /mismatch/);
  }
});

test('clean caches replay code-owned RP/motor supplier captures; corrupt existing records never heal',async t=>{
 const cacheDir=await sandbox(t);
 for(const name of ['rp2040-drafts','motor-drafts']){
  const bundle=JSON.parse(await readFile(resolve(`src/blocks/data/${name}.json`),'utf8'));
  const expected=bundle.receipts.find((r:any)=>r.id===bundle.catalog[0].catalogReceipt);
  assert.deepEqual(await loadCatalogReceipt(expected.id,{cacheDir,fetch:fake(()=>{throw Error('network forbidden');})}),expected);
 }
 const bundle=JSON.parse(await readFile(resolve('src/blocks/data/rp2040-drafts.json'),'utf8'));
 const expected=bundle.receipts[0];
 const {mkdir}=await import('node:fs/promises');await mkdir(join(cacheDir,'receipts'));
 await writeFile(join(cacheDir,'receipts',expected.id.slice(7)+'.json'),JSON.stringify({...expected,rawBody:'tampered'}));
 await assert.rejects(loadCatalogReceipt(expected.id,{cacheDir}),/integrity/);
});
