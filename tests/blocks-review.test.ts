import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contentHash, resolvePlanBlocks } from '../src/blocks/library.js';
import { checkSchematicReview, recordSchematicReview, schematicHash } from '../src/blocks/review.js';
import type { BlockDraft, BoardPlan } from '../src/blocks/contract.js';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'moki-schematic-review-'));
  const previous = process.env.MOKI_SCHEMATIC_REVIEWS_DIR;
  process.env.MOKI_SCHEMATIC_REVIEWS_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.MOKI_SCHEMATIC_REVIEWS_DIR;
    else process.env.MOKI_SCHEMATIC_REVIEWS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const plan = JSON.parse(await readFile(new URL('../src/blocks/data/spike-plan.json', import.meta.url), 'utf8')) as BoardPlan;
  const blocks = resolvePlanBlocks(plan);
  return { plan, blocks };
}
const syntheticReview = { by: 'independent-receipt-test', findings: [{ status: 'match', note: 'Synthetic lifecycle receipt; this test makes no electrical approval.' }] };

test('review receipt is required and follows the exact electrical hash', async t => {
  const { plan, blocks } = await fixture(t);
  assert.equal(checkSchematicReview(plan, blocks).ok, false);
  const hash = recordSchematicReview(plan, syntheticReview, blocks);
  assert.equal(hash, schematicHash(plan, blocks));
  assert.equal(checkSchematicReview(plan, blocks).ok, true);
  const saved = JSON.parse(await readFile(join(process.env.MOKI_SCHEMATIC_REVIEWS_DIR!, `${hash}.json`), 'utf8'));
  assert.equal(saved.hash, hash); assert.equal(saved.by, syntheticReview.by);
});

test('firmware and block placement changes retain an electrical review', async t => {
  const { plan, blocks } = await fixture(t);
  const hash = recordSchematicReview(plan, syntheticReview, blocks);
  plan.app = { source: '#include <Arduino.h>\nvoid setup() {}\nvoid loop() {}\n' };
  plan.blocks[0]!.at = { x: 42, y: -17, rotation: 90 };
  plan.board = { widthMm: 90, heightMm: 70, cornerRadiusMm: 2 };
  plan.blocks.reverse();
  assert.equal(schematicHash(plan, blocks), hash);
  assert.equal(checkSchematicReview(plan, blocks).ok, true);
});

test('changing a component revision content hash invalidates review', async t => {
  const { plan, blocks } = await fixture(t);
  const original = recordSchematicReview(plan, syntheticReview, blocks);
  const revised = structuredClone(blocks);
  const target = revised.find(b => plan.blocks.some(i => i.block === b.id) && b.parts.some(p => p.value))!;
  assert.ok(target);
  target.parts.find(p => p.value)!.value = '20k';
  const { contentHash: _hash, status: _status, provenance, ...fields } = target;
  const draft: BlockDraft = { ...fields, provenance: { author: provenance.author, ...(provenance.authorId ? { authorId: provenance.authorId } : {}) } };
  // Supplied definitions are trusted resolved revisions: their hash must change with content.
  target.contentHash = contentHash(draft);
  assert.notEqual(schematicHash(plan, revised), original);
  assert.equal(checkSchematicReview(plan, revised).ok, false);
});

test('links, confirmed requirements and source citations remain bound to the review', async t => {
  const { plan, blocks } = await fixture(t);
  recordSchematicReview(plan, syntheticReview, blocks);
  for (const change of [
    (p: BoardPlan) => { p.links = p.links.slice(1); },
    (p: BoardPlan) => { p.requirements = [{ id: 'count', plain: 'At most one part', metric: 'part_count', op: '<=', value: 1, source: 'maker' }]; },
    (p: BoardPlan) => { assert.ok(p.sections?.[0]?.reference); p.sections[0]!.reference!.page += 1; },
  ]) {
    const edited = structuredClone(plan); change(edited);
    assert.equal(checkSchematicReview(edited, blocks).ok, false);
  }
});

test('internal writer requires a reviewer identity and nonempty findings', async t => {
  const { plan, blocks } = await fixture(t);
  assert.throws(() => recordSchematicReview(plan, { by: ' ', findings: [{}] }, blocks), /identity and findings/);
  assert.throws(() => recordSchematicReview(plan, { by: 'reviewer', findings: [] }, blocks), /identity and findings/);
  assert.equal(checkSchematicReview(plan, blocks).ok, false);
});
