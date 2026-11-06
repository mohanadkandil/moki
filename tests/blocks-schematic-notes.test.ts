import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutSchematicNotes } from '../eda/blocks/schematic-notes.js';

const words = (s: string) => s.replace(/\s/gu, '');
test('actual RP/motor notes including clipped third DRV note remain complete and inside the computed section', () => {
  const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-motor/plan.json', import.meta.url), 'utf8'));
  const section = fixture.sections.find((s: any) => s.id === 'motor');
  assert.ok(section.notes[2].length > 100, 'regression must exercise the real overflowing note');
  const before = structuredClone(section), result = layoutSchematicNotes(section);
  assert.deepEqual(section, before);
  assert.equal(words(result.noteLines.join(' ')), words(section.notes.join(' ')));
  assert.ok(result.noteLines.length > section.notes.length);
  const ref = section.reference;
  assert.equal(words(result.referenceLines.join(' ')), words(`${ref.lcsc} · reference p${ref.page} · Fig ${ref.figure} · ${ref.quote}`));
  const noteBottom = result.noteStartY + (result.noteLines.length - 1) * result.lineHeight;
  assert.ok(result.referenceStartY > noteBottom + result.lineHeight);
  const lastBaseline = result.referenceStartY + (result.referenceLines.length - 1) * result.lineHeight;
  assert.ok(result.neededHeight >= lastBaseline + 18);
});
test('every note and entire long reference quote survive, and the section grows beyond its old fixed box', () => {
  const notes = Array.from({ length: 8 }, (_, i) => `Note ${i}: ${'verify current budget and wiring '.repeat(9)}`);
  const quote = 'Manufacturer application conditions '.repeat(40);
  const r = layoutSchematicNotes({ notes, reference: { lcsc: 'C2040', page: 14, quote } });
  assert.equal(words(r.noteLines.join(' ')), words(notes.join(' ')));
  assert.equal(words(r.referenceLines.join(' ')), words(`C2040 · reference p14 · ${quote}`));
  assert.ok(r.neededHeight > 620);
  assert.ok([...r.noteLines, ...r.referenceLines].every(line => Array.from(line).length <= 100));
});
test('wide unbroken tokens and Unicode split without losing characters or breaking surrogate pairs', () => {
  const token = 'W'.repeat(250) + '😀'.repeat(30);
  const r = layoutSchematicNotes({ notes: [token] });
  assert.equal(r.noteLines.join(''), token);
  assert.ok(r.noteLines.every(line => Array.from(line).length <= Math.floor(914 / (14 * 1.1))));
  assert.ok(r.noteLines.every(line => !/[\uD800-\uDBFF]$/u.test(line) && !/^[\uDC00-\uDFFF]/u.test(line)));
});
test('empty notes, explicit paragraph breaks and XML-sensitive content remain caller-owned text', () => {
  assert.equal(layoutSchematicNotes({ notes: [] }).neededHeight, 620);
  const r = layoutSchematicNotes({ notes: ['<5V & "quoted">\n\nsecond paragraph', '', 'fifth'] });
  assert.deepEqual(r.noteLines, ['<5V & "quoted">', '', 'second paragraph', '', 'fifth']);
  assert.deepEqual(r.referenceLines, []);
});
test('narrow custom capacities wrap deterministically and invalid capacity fails explicitly', () => {
  const section = { notes: ['one two three four five six', 'X'.repeat(25)] };
  const a = layoutSchematicNotes(section, { maxWidth: 100, maxChars: 8 });
  assert.deepEqual(a, layoutSchematicNotes(section, { maxWidth: 100, maxChars: 8 }));
  assert.equal(words(a.noteLines.join(' ')), words(section.notes.join(' ')));
  assert.ok(a.noteLines.every(line => line.length <= 8));
  for (const options of [{ maxChars: 0 }, { maxChars: 1.2 }, { maxWidth: 1 }, { lineHeight: 10 }, { fontSize: NaN }])
    assert.throws(() => layoutSchematicNotes(section, options), /schematic notes|Schematic notes/);
});
