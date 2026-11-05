import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { catalogPart, contentHash, getBlock, materializeDraft, recordIndependentReview, saveBlockDraft } from '../src/blocks/library.js';
import type { BlockDef, BlockDraft, BlockTestReceipt, GateResult } from '../src/blocks/contract.js';

// Synthetic review lifecycle; electrical part identities come from retained importer data.
async function fixture(t: test.TestContext, mcu = false): Promise<BlockDef> {
  const directory = await mkdtemp(join(tmpdir(), 'moki-library-review-'));
  const previous = process.env.MOKI_BLOCK_LIBRARY_DIR;
  process.env.MOKI_BLOCK_LIBRARY_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.MOKI_BLOCK_LIBRARY_DIR;
    else process.env.MOKI_BLOCK_LIBRARY_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const seeds = JSON.parse(await readFile(new URL('../src/blocks/data/seed.json', import.meta.url), 'utf8')) as BlockDef[];
  const original = seeds.find(b => b.id === (mcu ? 'esp32-s3-core' : 'boot-reset-buttons'))!;
  assert.ok(original, 'Importer-backed seed fixture must exist');
  const { contentHash: _hash, status: _status, provenance: _provenance, ...fields } = structuredClone(original);
  const draft: BlockDraft = { ...fields, id: mcu ? 'review-test-mcu' : 'review-test-switch', provenance: { author: 'agent', authorId: 'review-test-author' } };
  return saveBlockDraft(draft);
}

function receipt(b: BlockDef): BlockTestReceipt {
  const names: GateResult['gate'][] = ['erc', 'power', 'drc', 'spice', 'block-test', ...(b.mcu ? ['compile' as const] : [])];
  return { contentHash: b.contentHash, at: '2026-11-05T12:00:00Z', gates: names.map(gate => ({ gate, ok: true, issues: [] })), artifacts: {}, ms: 0 };
}
const review = (b: BlockDef, overrides: Partial<BlockDef['provenance']['reviews'][number]> = {}): BlockDef['provenance']['reviews'][number] => ({
  by: 'independent-test-reviewer', at: '2026-11-05T12:00:00Z', contentHash: b.contentHash,
  verdict: 'pass', notes: 'Synthetic receipt to test lifecycle guards; no electrical approval.', ...overrides,
});
const promote = (b: BlockDef, evidence = receipt(b), overrides: Partial<BlockDef['provenance']['reviews'][number]> = {}) => recordIndependentReview(b.id, b.version, review(b, overrides), evidence);

test('DRC-only receipt cannot promote an importer-backed block', async t => {
  const b = await fixture(t), evidence = receipt(b);
  evidence.gates = evidence.gates.filter(g => g.gate === 'drc');
  assert.throws(() => promote(b, evidence), /all passing block gates/);
  assert.equal(getBlock(b.id, b.version)!.status, 'unreviewed');
});

test('contradictory ok/error receipt cannot promote and required gates cannot be duplicated', async t => {
  const b = await fixture(t), evidence = receipt(b);
  evidence.gates[0]!.issues.push({ rule: 'synthetic-failure', severity: 'error', message: 'Deliberately contradictory receipt' });
  assert.throws(() => promote(b, evidence), /all passing block gates/);
  const duplicate = receipt(b); duplicate.gates.push(structuredClone(duplicate.gates[0]!));
  assert.throws(() => promote(b, duplicate), /all passing block gates/);
  assert.equal(getBlock(b.id, b.version)!.status, 'unreviewed');
});

test('complete exact-hash gates promote, but an author cannot review their own block', async t => {
  const b = await fixture(t);
  assert.throws(() => promote(b, receipt(b), { by: b.provenance.authorId! }), /independent/);
  const promoted = promote(b);
  assert.equal(promoted.status, 'reviewed');
  assert.equal(getBlock(b.id, b.version)!.status, 'reviewed');
  assert.equal(promoted.contentHash, b.contentHash);
});

test('every promotion evidence receipt must match the immutable content hash', async t => {
  const b = await fixture(t), changed = '0'.repeat(64);
  assert.notEqual(b.contentHash, changed);
  assert.throws(() => promote(b, receipt(b), { contentHash: changed }), /exact-hash/);
  const evidence = receipt(b); evidence.contentHash = changed;
  assert.throws(() => promote(b, evidence), /exact-hash/);
  assert.equal(getBlock(b.id, b.version)!.status, 'unreviewed');
});

test('edited revisions start unreviewed and cannot inherit a prior approval', async t => {
  const b = await fixture(t); promote(b);
  const { contentHash: _hash, status: _status, provenance, ...fields } = b;
  const draft: BlockDraft = { ...structuredClone(fields), title: `${b.title} revised`, provenance: { author: provenance.author, authorId: provenance.authorId } };
  assert.notEqual(contentHash(draft), b.contentHash);
  await assert.rejects(saveBlockDraft(draft), /revision is immutable/);
  draft.version += 1;
  const revised = await saveBlockDraft(draft);
  assert.equal(revised.status, 'unreviewed');
  assert.deepEqual(revised.provenance.reviews, []);
  assert.notEqual(revised.contentHash, b.contentHash);
  assert.equal(getBlock(b.id, b.version)!.status, 'reviewed');
  assert.equal(getBlock(b.id)!.version, revised.version);
  assert.equal(getBlock(b.id)!.status, 'unreviewed');
});

test('later failure with a timezone offset downgrades the persisted block', async t => {
  const b = await fixture(t); promote(b);
  // 11:30 -02:00 is 13:30 UTC, later than the passing 12:00 UTC review.
  const downgraded = promote(b, receipt(b), { at: '2026-11-05T11:30:00-02:00', verdict: 'fail' });
  assert.equal(downgraded.status, 'unreviewed');
  assert.equal(getBlock(b.id, b.version)!.status, 'unreviewed');
});

test('MCU block promotion also requires its compile gate', async t => {
  const b = await fixture(t, true), evidence = receipt(b);
  evidence.gates = evidence.gates.filter(g => g.gate !== 'compile');
  assert.throws(() => promote(b, evidence), /all passing block gates/);
  assert.equal(promote(b).status, 'reviewed');
});

test('author draft cannot forge reviewed status, and modified saved content fails integrity', async t => {
  const b = await fixture(t); promote(b);
  const { contentHash: _hash, status: _status, provenance, ...fields } = b;
  const draft: BlockDraft = { ...fields, provenance: { author: provenance.author, authorId: provenance.authorId } };
  assert.throws(() => materializeDraft({ ...draft, status: 'reviewed' } as BlockDraft), /status is unknown/);
  const path = join(process.env.MOKI_BLOCK_LIBRARY_DIR!, 'blocks', `${b.id}@${b.version}.json`);
  const edited = JSON.parse(await readFile(path, 'utf8'));
  edited.title = 'Modified without changing the immutable hash';
  await writeFile(path, JSON.stringify(edited));
  assert.throws(() => getBlock(b.id, b.version), /content changed without a new revision/);
});

test('pinned part remains resolvable after a newer stock capture without refreshing importer evidence', async t => {
  const b = await fixture(t), ref = b.parts[0]!, pinned = catalogPart(ref.lcsc, ref.catalogReceipt);
  const recent = { ...structuredClone(pinned), catalogReceipt: `sha256:${'f'.repeat(64)}`, stock: 123456 };
  assert.notEqual(recent.catalogReceipt, pinned.catalogReceipt);
  const root = join(process.env.MOKI_BLOCK_LIBRARY_DIR!, 'parts'); await mkdir(root);
  const name = createHash('sha256').update(`${recent.lcsc}:${recent.catalogReceipt}`).digest('hex');
  await writeFile(join(root, `${name}.json`), JSON.stringify(recent));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Pinned lookup must not fetch current metadata'); };
  try {
    assert.deepEqual(catalogPart(ref.lcsc, ref.catalogReceipt), pinned);
    assert.equal(catalogPart(ref.lcsc, recent.catalogReceipt).stock, 123456);
    const detached = catalogPart(ref.lcsc, ref.catalogReceipt); detached.pins.length = 0;
    assert.deepEqual(catalogPart(ref.lcsc, ref.catalogReceipt), pinned);
  } finally { globalThis.fetch = originalFetch; }
});
