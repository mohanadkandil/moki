import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureImportedPart, ensurePart } from '../eda/blocks/imported.js';
import { getPart } from '../src/blocks/catalog.js';
import type { BlockPart, CatalogPart } from '../src/blocks/contract.js';
import type { PeripheralDraftBundle } from '../eda/blocks/generate-peripherals.js';
const bundle = JSON.parse(await readFile(new URL('../src/blocks/data/peripheral-drafts.json', import.meta.url), 'utf8')) as PeripheralDraftBundle;
const full = bundle.catalog.find(c => c.lcsc === 'C25804')!;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const official = 'https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod';
function block(c = full): BlockPart { return { ref: 'R1', lcsc: c.lcsc, mpn: c.mpn, catalogReceipt: c.catalogReceipt, pinout: 'verified', datasheet: { url: c.datasheetUrl!, pages: '1', note: 'Actual0603 resistor, verified2numericterminals; source supplier datasheet must be independently reviewed for footprint fit.' }, pins: { A: { pad: '1', role: 'passive' }, B: { pad: '2', role: 'passive' } }, at: { x: 0, y: 0 }, footprint: { source: 'footprinter', id: '0603', citation: { url: c.datasheetUrl!, pages: '1', note: 'Cited0603 package pinout, alternate standard land pattern; native geometry/DRC and independent review required.' } } }; }
async function temporary(t: test.TestContext) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'moki-fallback-')); t.after(() => rm(cacheDir, { recursive: true, force: true }));
  await mkdir(join(cacheDir, 'receipts'));
  for (const r of bundle.receipts) await writeFile(join(cacheDir, 'receipts', `${r.id.slice(7)}.json`), JSON.stringify(r));
  return cacheDir;
}
async function metadata(cacheDir: string): Promise<CatalogPart> {
  const manual = bundle.receipts.find(r => r.id === full.datasheetReceipt)!;
  assert.ok(manual, 'Real exact-ID supplier response exists');
  return getPart(full.lcsc, { cacheDir, fetch: (async input => String(input).includes('/easyeda_components/') ? new Response('{"error":"not found"}', { status: 404 }) : new Response(manual.rawBody, { status: 200 })) as typeof fetch });
}

test('cited standard package resolves actual native numeric pads with no imported-model claim', async t => {
  const cacheDir = await temporary(t), result = await ensurePart(block(), full, { cacheDir });
  assert.equal(result.raw, null); assert.ok('modelsProvided' in result && result.modelsProvided === false);
  assert.deepEqual([...result.pins], [['1', 'pin1'], ['2', 'pin2']]);
  const node: any = result.component({ name: 'R1' }); assert.equal(node.type, 'chip'); assert.equal(node.props.manufacturerPartNumber, full.mpn);
  assert.deepEqual(node.props.supplierPartNumbers, { jlcpcb: ['C25804'] }); assert.deepEqual(node.props.pinLabels, { pin1: 'A', pin2: 'B' });
  const pads = node.props.footprint.filter((g: any) => g.type === 'pcb_smtpad'); assert.equal(pads.length, 2); assert.ok(pads.every((p: any) => p.width > 0 && p.height > 0));
  assert.deepEqual(pads.map((p: any) => p.port_hints), [['pin1', '1'], ['pin2', '2']]); assert.equal(node.props.cadModel, undefined);
  assert.ok('resolvedFootprintSha256' in result && /^[a-f0-9]{64}$/.test(result.resolvedFootprintSha256));
  const audit = JSON.parse(await readFile((result as any).footprintAuditPath, 'utf8')); assert.equal(audit.catalogReceipt, full.catalogReceipt); assert.equal(audit.source, 'footprinter'); assert.match(audit.tool, /@tscircuit\/footprinter@/);
});

test('metadata-only identity requires separate availability proof and an explicit verified footprint', async t => {
  const cacheDir = await temporary(t), c = await metadata(cacheDir); assert.equal(c.importer, 'jlcpcb-metadata-only'); assert.deepEqual(c.pins, []);
  const p = block(c), result = await ensurePart(p, c, { cacheDir }); assert.equal(result.pins.size, 2);
  const no = structuredClone(p); delete no.footprint; await assert.rejects(ensurePart(no, c, { cacheDir }), /explicit cited/);
  const forged = structuredClone(c); delete forged.importerUnavailableReceipt; await assert.rejects(ensurePart(p, forged, { cacheDir }), /unavailability evidence/);
  const wrongProof = { ...c, importerUnavailableReceipt: full.catalogReceipt }; await assert.rejects(ensurePart(p, wrongProof, { cacheDir }), /unavailability evidence/);
});

test('fallback rejects invalid identities, unverified/nonnumeric/incomplete pad maps and unsafe selectors', async t => {
  const cacheDir = await temporary(t);
  for (const mutate of [
    (p: BlockPart) => { p.lcsc = 'C1'; },
    (p: BlockPart) => { p.pinout = 'unverified'; },
    (p: BlockPart) => { p.pins.A!.pad = 'A1'; },
    (p: BlockPart) => { p.pins.A!.pad = '2'; },
    (p: BlockPart) => { p.footprint!.id = 'sot23_5'; },
    (p: BlockPart) => { p.footprint!.id = 'https://127.0.0.1/a'; },
    (p: BlockPart) => { p.footprint!.id = 'dip10000000'; },
    (p: BlockPart) => { p.footprint!.citation.pages = ''; },
    (p: BlockPart) => { p.omitPads = ['3']; },
  ]) { const p = block(); mutate(p); await assert.rejects(ensurePart(p, full, { cacheDir })); }
  const wrong = { ...full, mpn: 'OTHER' }, p = block(wrong); await assert.rejects(ensurePart(p, wrong, { cacheDir }), /immutable supplier receipt/);
  const path = join(cacheDir, 'receipts', `${full.catalogReceipt.slice(7)}.json`), raw = JSON.parse(await readFile(path, 'utf8')); raw.rawBody = '{}'; await writeFile(path, JSON.stringify(raw));
  await assert.rejects(ensurePart(block(), full, { cacheDir }), /integrity/);
});

test('pinned official KiCad data converts to actual numeric pads without model URLs or executable source', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'unpaginated footprint source', note: 'Official KiCad raw footprint captured2026-11-05; package fit is separately datasheet-reviewed.' } };
  let calls = 0;
  const result = await ensurePart(p, full, { cacheDir, fetch: (async input => { calls++; assert.equal(String(input), official); return new Response(KICAD_SOURCE); }) as typeof fetch });
  assert.equal(calls, 1); assert.equal((result as any).footprintSource, 'kicad'); assert.equal(result.pins.size, 2); assert.equal((result as any).sourceSha256, digest(KICAD_SOURCE));
  const audit = JSON.parse(await readFile((result as any).footprintAuditPath, 'utf8')); assert.equal(audit.rawSource, KICAD_SOURCE); assert.equal(audit.sourceSha256, digest(KICAD_SOURCE)); assert.equal((result as any).modelsProvided, false);
  const courtyard = audit.geometry.filter((g: any) => g.type === 'pcb_courtyard_outline');
  assert.equal(courtyard.length, 1, 'Four actual KiCad F.CrtYd lines must form one native area-bearing courtyard');
  assert.equal(courtyard[0].outline.length, 5); assert.deepEqual(courtyard[0].outline[0], courtyard[0].outline.at(-1));
  const area = Math.abs(courtyard[0].outline.slice(0, -1).reduce((sum: number, p: any, i: number) => sum + p.x * courtyard[0].outline[i + 1].y - courtyard[0].outline[i + 1].x * p.y, 0) / 2);
  assert.ok(Math.abs(area - 2.96 * 1.46) < 1e-10);
  assert.equal(audit.normalizations.length, 1); assert.equal(audit.normalizations[0].kind, 'stitch-exact-courtyard-segments'); assert.equal(audit.normalizations[0].sourceFragments.length, 4);
  const missingHash = structuredClone(p); delete missingHash.footprint!.citation.sha256; await assert.rejects(ensurePart(missingHash, full, { cacheDir }), /pinned SHA/);
  const changed = structuredClone(p); changed.footprint!.citation.sha256 = '0'.repeat(64); await assert.rejects(ensurePart(changed, full, { cacheDir, fetch: (async () => new Response(KICAD_SOURCE)) as typeof fetch }), /bytes changed/);
  const unsafe = structuredClone(p); unsafe.footprint!.citation.url = 'https://127.0.0.1/private'; await assert.rejects(ensurePart(unsafe, full, { cacheDir }), /official raw footprint/);
});

test('KiCad courtyard gaps, branches and crossing source segments fail closed without inventing geometry', async t => {
  const cacheDir = await temporary(t);
  // Deliberate SYNTHETIC mutations of retained official source; not supplier-published revisions.
  const gap = KICAD_SOURCE.replace('(fp_line (start -1.48 0.73) (end -1.48 -0.73)', '(fp_line (start -1.48 0.73) (end -1.48 -0.72)');
  const branch = KICAD_SOURCE.replace('  (pad 1 smd', '  (fp_line (start -1.48 -0.73) (end 0 0) (layer F.CrtYd) (width 0.05))\n  (pad 1 smd');
  const crossing = KICAD_SOURCE
    .replace('(fp_line (start -1.48 -0.73) (end 1.48 -0.73)', '(fp_line (start -1.48 -0.73) (end 1.48 0.73)')
    .replace('(fp_line (start 1.48 0.73) (end -1.48 0.73)', '(fp_line (start 1.48 -0.73) (end -1.48 0.73)');
  for (const source of [gap, branch, crossing]) {
    assert.notEqual(source, KICAD_SOURCE);
    const p = block(); p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(source), pages: 'synthetic mutation of captured footprint source' } };
    await assert.rejects(ensurePart(p, full, { cacheDir, fetch: (async () => new Response(source)) as typeof fetch }), /courtyard.*(gap|branch|nonzero|cross|overlap)/i);
  }
});

test('exact pinned KiCad source repeats without fetch and retains original bytes, URL and geometry', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  let calls = 0;
  const first: any = await ensurePart(p, full, { cacheDir, fetch: (async () => { calls++; return new Response(KICAD_SOURCE); }) as typeof fetch });
  assert.equal(first.sourceCacheMode, 'fetch'); assert.equal(calls, 1);
  assert.equal(first.sourceCachePath, join(cacheDir, 'footprint-sources', digest(KICAD_SOURCE), `${digest(official)}.json`));
  const cache = JSON.parse(await readFile(first.sourceCachePath, 'utf8'));
  assert.deepEqual(cache, { schema: 'moki.kicad-footprint-source/1', sourceUrl: official, sourceSha256: digest(KICAD_SOURCE), rawSource: KICAD_SOURCE });
  const second: any = await ensurePart(p, full, { cacheDir, fetch: (async () => { calls++; throw new Error('No cached build may contact changed/unavailable upstream'); }) as typeof fetch });
  assert.equal(calls, 1); assert.equal(second.sourceCacheMode, 'source-cache');
  assert.equal(second.sourceSha256, digest(KICAD_SOURCE)); assert.equal(second.resolvedFootprintSha256, first.resolvedFootprintSha256); assert.equal(second.footprintAuditPath, first.footprintAuditPath);
  const audit = JSON.parse(await readFile(second.footprintAuditPath, 'utf8'));
  assert.equal(audit.rawSource, KICAD_SOURCE); assert.equal(digest(audit.rawSource), digest(KICAD_SOURCE));
});

test('official GitHub and GitLab mirrors with identical pinned bytes coexist and remain URL-bound', async t => {
  const cacheDir = await temporary(t), github = block(), gitlab = block();
  const mirror = 'https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod';
  github.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  gitlab.footprint = { ...structuredClone(github.footprint), citation: { ...github.footprint.citation, url: mirror } };
  let calls = 0;
  const first: any = await ensurePart(github, full, { cacheDir, fetch: (async input => { calls++; assert.equal(String(input), official); return new Response(KICAD_SOURCE); }) as typeof fetch });
  const second: any = await ensurePart(gitlab, full, { cacheDir, fetch: (async input => { calls++; assert.equal(String(input), mirror); return new Response(KICAD_SOURCE); }) as typeof fetch });
  assert.equal(calls, 2); assert.notEqual(first.sourceCachePath, second.sourceCachePath);
  assert.equal(second.sourceCachePath, join(cacheDir, 'footprint-sources', digest(KICAD_SOURCE), `${digest(mirror)}.json`));
  assert.equal(first.sourceSha256, second.sourceSha256); assert.equal(first.resolvedFootprintSha256, second.resolvedFootprintSha256);
  const offline = (async () => { calls++; throw new Error('Both exact mirror caches must work offline'); }) as typeof fetch;
  assert.equal((await ensurePart(github, full, { cacheDir, fetch: offline }) as any).sourceCacheMode, 'source-cache');
  assert.equal((await ensurePart(gitlab, full, { cacheDir, fetch: offline }) as any).sourceCacheMode, 'source-cache');
  assert.equal(calls, 2);
  await rm(first.sourceCachePath);
  const recovered: any = await ensurePart(github, full, { cacheDir, fetch: offline });
  assert.equal(calls, 2); assert.equal(recovered.sourceCacheMode, 'audit-cache');
  assert.equal(JSON.parse(await readFile(recovered.sourceCachePath, 'utf8')).sourceUrl, official);
  const tampered = JSON.parse(await readFile(first.sourceCachePath, 'utf8')); tampered.sourceUrl = mirror;
  await writeFile(first.sourceCachePath, JSON.stringify(tampered));
  await assert.rejects(ensurePart(github, full, { cacheDir, fetch: offline }), /source cache URL\/hash\/integrity mismatch/);
  assert.equal(calls, 2);
});

test('old hash-only source cache is preserved while immutable exact-URL audit supplies migration', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  const first: any = await ensurePart(p, full, { cacheDir, fetch: (async () => new Response(KICAD_SOURCE)) as typeof fetch });
  const legacyPath = join(cacheDir, 'footprint-sources', `${digest(KICAD_SOURCE)}.json`);
  const legacy = JSON.parse(await readFile(first.sourceCachePath, 'utf8'));
  // A hash-only record lacks URL-key binding; it is deliberately not used to relabel provenance.
  legacy.sourceUrl = 'https://example.invalid/untrusted-legacy-provenance';
  const legacyBytes = JSON.stringify(legacy); await writeFile(legacyPath, legacyBytes); await rm(first.sourceCachePath);
  const recovered: any = await ensurePart(p, full, { cacheDir, fetch: (async () => { throw new Error('Trusted matching audit must recover offline'); }) as typeof fetch });
  assert.equal(recovered.sourceCacheMode, 'audit-cache');
  assert.equal(JSON.parse(await readFile(recovered.sourceCachePath, 'utf8')).sourceUrl, official);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyBytes);
});

test('tampered pinned source bytes or URL fail closed without fetch or cache replacement', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  const first: any = await ensurePart(p, full, { cacheDir, fetch: (async () => new Response(KICAD_SOURCE)) as typeof fetch });
  const original = await readFile(first.sourceCachePath, 'utf8');
  for (const mutate of [
    (c: any) => { c.rawSource += '\n; SYNTHETIC tampered bytes'; },
    (c: any) => { c.sourceUrl = 'https://example.invalid/forged.kicad_mod'; },
    (c: any) => { c.extra = 'unsupported'; },
  ]) {
    const cache = JSON.parse(original); mutate(cache); const altered = JSON.stringify(cache); await writeFile(first.sourceCachePath, altered);
    let calls = 0;
    await assert.rejects(ensurePart(p, full, { cacheDir, fetch: (async () => { calls++; return new Response(KICAD_SOURCE); }) as typeof fetch }), /source cache.*(integrity|URL|hash)/);
    assert.equal(calls, 0); assert.equal(await readFile(first.sourceCachePath, 'utf8'), altered);
  }
});

test('raw UTF8 source hash does not normalize away an added BOM', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  await assert.rejects(ensurePart(p, full, { cacheDir, fetch: (async () => new Response('\uFEFF' + KICAD_SOURCE)) as typeof fetch }), /bytes changed/);
});

test('legacy immutable fallback audit recovers exact source offline and creates the verified source cache', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  const first: any = await ensurePart(p, full, { cacheDir, fetch: (async () => new Response(KICAD_SOURCE)) as typeof fetch });
  await rm(first.sourceCachePath);
  let calls = 0;
  const recovered: any = await ensurePart(p, full, { cacheDir, fetch: (async () => { calls++; throw new Error('Offline legacy source recovery must not fetch'); }) as typeof fetch });
  assert.equal(calls, 0); assert.equal(recovered.sourceCacheMode, 'audit-cache'); assert.equal(recovered.sourceSha256, digest(KICAD_SOURCE)); assert.equal(recovered.resolvedFootprintSha256, first.resolvedFootprintSha256);
  const cache = JSON.parse(await readFile(recovered.sourceCachePath, 'utf8'));
  assert.equal(cache.rawSource, KICAD_SOURCE); assert.equal(cache.sourceSha256, digest(KICAD_SOURCE)); assert.equal(cache.sourceUrl, official);
});

test('tampered legacy audit cannot supply pinned source or trigger a silent network fallback', async t => {
  const cacheDir = await temporary(t), p = block();
  p.footprint = { source: 'kicad', id: 'kicad:Resistor_SMD/R_0603_1608Metric', citation: { url: official, sha256: digest(KICAD_SOURCE), pages: 'captured official footprint source' } };
  const first: any = await ensurePart(p, full, { cacheDir, fetch: (async () => new Response(KICAD_SOURCE)) as typeof fetch });
  await rm(first.sourceCachePath);
  const audit = JSON.parse(await readFile(first.footprintAuditPath, 'utf8')); audit.rawSource += '\n; SYNTHETIC tampered legacy audit';
  await writeFile(first.footprintAuditPath, JSON.stringify(audit));
  let calls = 0;
  await assert.rejects(ensurePart(p, full, { cacheDir, fetch: (async () => { calls++; return new Response(KICAD_SOURCE); }) as typeof fetch }), /audit cache integrity/);
  assert.equal(calls, 0);
});

test('same-process imported component cache keeps distinct pinned geometry revisions immutable', async t => {
  const cacheDir = await temporary(t);
  await mkdir(resolve('var'), { recursive: true });
  const assetDir = await mkdtemp(resolve('var/footprint-test-'));
  t.after(() => rm(assetDir, { recursive: true, force: true }));
  const captured = bundle.receipts.find(r => r.id === full.catalogReceipt)!;
  const original = JSON.parse(captured.rawBody), changed = structuredClone(original);
  const shapes = changed.easyeda_component_details.easyeda_json.packageDetail.dataStr.shape as string[];
  const index = shapes.findIndex(s => s.startsWith('PAD~'));
  const pad = shapes[index]!.split('~'); pad[4] = String(Number(pad[4]) * 2); shapes[index] = pad.join('~');
  // A deliberate synthetic geometry mutation of a real importer response exercises
  // module-cache identity. It is not a claim that supplier published this revision.
  const make = (body: any) => getPart(full.lcsc, { cacheDir, cacheMaxAgeMs: 0, fetch: (async input => {
    const manual = bundle.receipts.find(r => r.id === full.datasheetReceipt)!;
    return new Response(String(input).includes('/easyeda_components/') ? JSON.stringify(body) : manual.rawBody);
  }) as typeof fetch });
  const a = await make(original), b = await make(changed); assert.notEqual(a.footprintSha256, b.footprintSha256);
  const first = await ensureImportedPart(a, { cacheDir, assetDir }), second = await ensureImportedPart(b, { cacheDir, assetDir });
  const widths = (factory: (props: any) => any) => factory({ name: 'R1' }).props.footprint.props.children.filter((p: any) => p.type === 'smtpad').map((p: any) => p.props.width);
  assert.notDeepEqual(widths(first.component), widths(second.component));
  assert.equal((await ensureImportedPart(a, { cacheDir, assetDir })).component, first.component);
});

// Exact first-party KiCad source captured from official URL above on2026-11-05 (HTTP200).
// This tests conversion only; no RootCircuit render, native route/DRC or component fit is claimed.
const KICAD_SOURCE = "(module R_0603_1608Metric (layer F.Cu) (tedit 5F68FEEE)\n  (descr \"Resistor SMD 0603 (1608 Metric), square (rectangular) end terminal, IPC_7351 nominal, (Body size source: IPC-SM-782 page 72, https://www.pcb-3d.com/wordpress/wp-content/uploads/ipc-sm-782a_amendment_1_and_2.pdf), generated with kicad-footprint-generator\")\n  (tags resistor)\n  (attr smd)\n  (fp_text reference REF** (at 0 -1.43) (layer F.SilkS)\n    (effects (font (size 1 1) (thickness 0.15)))\n  )\n  (fp_text value R_0603_1608Metric (at 0 1.43) (layer F.Fab)\n    (effects (font (size 1 1) (thickness 0.15)))\n  )\n  (fp_line (start -0.8 0.4125) (end -0.8 -0.4125) (layer F.Fab) (width 0.1))\n  (fp_line (start -0.8 -0.4125) (end 0.8 -0.4125) (layer F.Fab) (width 0.1))\n  (fp_line (start 0.8 -0.4125) (end 0.8 0.4125) (layer F.Fab) (width 0.1))\n  (fp_line (start 0.8 0.4125) (end -0.8 0.4125) (layer F.Fab) (width 0.1))\n  (fp_line (start -0.237258 -0.5225) (end 0.237258 -0.5225) (layer F.SilkS) (width 0.12))\n  (fp_line (start -0.237258 0.5225) (end 0.237258 0.5225) (layer F.SilkS) (width 0.12))\n  (fp_line (start -1.48 0.73) (end -1.48 -0.73) (layer F.CrtYd) (width 0.05))\n  (fp_line (start -1.48 -0.73) (end 1.48 -0.73) (layer F.CrtYd) (width 0.05))\n  (fp_line (start 1.48 -0.73) (end 1.48 0.73) (layer F.CrtYd) (width 0.05))\n  (fp_line (start 1.48 0.73) (end -1.48 0.73) (layer F.CrtYd) (width 0.05))\n  (pad 1 smd roundrect (at -0.825 0) (size 0.8 0.95) (layers F.Cu F.Mask F.Paste) (roundrect_rratio 0.25))\n  (pad 2 smd roundrect (at 0.825 0) (size 0.8 0.95) (layers F.Cu F.Mask F.Paste) (roundrect_rratio 0.25))\n  (fp_text user %R (at 0 0) (layer F.Fab)\n    (effects (font (size 0.4 0.4) (thickness 0.06)))\n  )\n  (model ${KISYS3DMOD}/Resistor_SMD.3dshapes/R_0603_1608Metric.wrl\n    (at (xyz 0 0 0))\n    (scale (xyz 1 1 1))\n    (rotate (xyz 0 0 0))\n  )\n)";
