import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMakerEdits, layoutForDesign, layoutFromCircuit, layoutOutline, parseMakerEdits, validateLayout, type BoardLayout } from '../src/board/edits.js';
import { submitBrief, EMPTY_SESSION } from '../src/circuit/session.js';
const fixture = 'docs/engineering/2026-11-04-realism/review/evidence/copper/temp-monitor/';
const circuit = () => JSON.parse(readFileSync(`${fixture}circuit.json`, 'utf8'));
const metadata = JSON.parse(readFileSync(`${fixture}board-metadata.json`, 'utf8'));
const base = () => layoutFromCircuit(circuit(), metadata);
function onlyController(size = 100): BoardLayout {
  const b = base(); b.board = { widthMm: size, heightMm: size, cornerRadiusMm: 3 }; b.mountingHoles = [];
  b.parts = b.parts.filter(p => p.refdes === 'U1');
  const c = b.parts[0]!; const delta = -size / 2 + 37.5; c.origin.y += delta; c.center.y += delta; validateLayout(b); return b;
}
test('strict edit schema rejects unknown, missing, nonfinite and duplicate fields', () => {
  for (const value of [null, [], { what: 1 }, { board: { widthMm: 75, heightMm: 75 } }, { board: { widthMm: 75, heightMm: 75, cornerRadiusMm: 3, x: 0 } }, { placements: [{ refdes: 'U2', x: 1, y: 2 }] }, { placements: [{ refdes: 'U2', x: NaN, y: 2, rotation: 0 }] }, { placements: [{ refdes: 'U2', x: 1, y: Infinity, rotation: 0 }] }, { placements: [{ refdes: 'U2', x: 1, y: 2, rotation: 0, z: 1 }] }, { usbEdge: 'front' }, { placements: [{ refdes: 'U2', x: 1, y: 2, rotation: 0 }, { refdes: 'U2', x: 2, y: 2, rotation: 0 }] }]) assert.throws(() => parseMakerEdits(value));
  assert.deepEqual(parseMakerEdits({ placements: [{ refdes: 'U2', x: 1, y: 2, rotation: -90 }] }), { placements: [{ refdes: 'U2', x: 1, y: 2, rotation: 270 }] });
});
test('actual component centres and asymmetric BZ origin remain distinct under 90 degree rotation', () => {
  const b = base(); const old = structuredClone(b); const bz = b.parts.find(p => p.refdes === 'BZ1')!;
  assert.deepEqual(bz.center, { x: 25, y: -16.5 }); assert.deepEqual(bz.origin, { x: 25, y: -10 });
  const { layout } = applyMakerEdits(b, { placements: [{ refdes: 'BZ1', x: 25, y: -16.5, rotation: 90 }] });
  assert.deepEqual(layout.parts.find(p => p.refdes === 'BZ1')!.origin, { x: 18.5, y: -16.5 }); assert.deepEqual(b, old);
  assert.deepEqual(layout.parts.filter(p => p.refdes !== 'BZ1'), old.parts.filter(p => p.refdes !== 'BZ1'));
});
test('generated design centres match actual circuit centres including header rows', () => {
  const result = submitBrief(EMPTY_SESSION, 'temperature monitor with display and buzzer'); assert.equal(result.outcome.kind, 'created'); if (result.outcome.kind !== 'created') return;
  // What the build really made of this design's source.
  const built = (name: string) => JSON.parse(readFileSync(new URL(`./agent-fixtures/compact-temp-monitor-${name}.json`, import.meta.url), 'utf8'));
  const designLayout = layoutForDesign(result.outcome.revision.design); const actual = layoutFromCircuit(built('circuit'), built('metadata'));
  for (const p of designLayout.parts) { const a = actual.parts.find(a => a.refdes === p.refdes)!; assert.ok(Math.hypot(p.center.x - a.center.x, p.center.y - a.center.y) < .002, p.refdes); }
});
test('safe OLED move preserves immutable base and every other part', () => {
  const b = base(); const before = structuredClone(b); const { layout, summary } = applyMakerEdits(b, { placements: [{ refdes: 'U2', x: 19.85, y: 27.9, rotation: 0 }] });
  assert.deepEqual(b, before); assert.deepEqual(layout.parts.filter(p => p.refdes !== 'U2'), b.parts.filter(p => p.refdes !== 'U2'));
  assert.equal(layout.parts.find(p => p.refdes === 'U2')!.origin.x, 19.85); assert.match(summary[0]!, /U2 moved 4 mm/);
});
test('off-board, overlap, unknown parts and invalid controller moves fail', () => {
  const b = base();
  assert.throws(() => applyMakerEdits(b, { placements: [{ refdes: 'U2', x: 100, y: 0, rotation: 0 }] }), /outside/);
  assert.throws(() => applyMakerEdits(b, { placements: [{ refdes: 'U2', x: -15, y: 15, rotation: 0 }] }), /overlaps/);
  assert.throws(() => applyMakerEdits(b, { placements: [{ refdes: 'U9', x: 0, y: 0, rotation: 0 }] }), /Unknown part/);
  const c = b.parts.find(p => p.refdes === 'U1')!;
  assert.throws(() => applyMakerEdits(b, { placements: [{ refdes: 'U1', x: c.center.x, y: c.center.y + 2, rotation: 0 }] }), /USB must remain/);
  assert.throws(() => applyMakerEdits(b, { placements: [{ refdes: 'U1', x: c.center.x, y: c.center.y, rotation: 45 }] }), /cardinal/);
});
test('rectangular outline has four unique corners; rounded outline follows radius', () => {
  assert.equal(layoutOutline({ widthMm: 75, heightMm: 75, cornerRadiusMm: 0 }).length, 4);
  const p = layoutOutline({ widthMm: 75, heightMm: 75, cornerRadiusMm: 10 }); assert.ok(p.length >= 52); assert.deepEqual(p[0], { x: 37.5, y: 27.5 });
  const c = circuit(); c.find((e: any) => e.type === 'pcb_board').outline = layoutOutline({ widthMm: 75, heightMm: 75, cornerRadiusMm: 7 });
  assert.equal(layoutFromCircuit(c, metadata).board.cornerRadiusMm, 7);
  c.find((e: any) => e.type === 'pcb_board').outline = layoutOutline({ widthMm: 75, heightMm: 75, cornerRadiusMm: 0 });
  assert.equal(layoutFromCircuit(c, metadata).board.cornerRadiusMm, 0);
});
test('resize snaps controller USB only and explicit controller edits cannot be silently undone', () => {
  const b = base(); const edited = applyMakerEdits(b, { board: { widthMm: 85, heightMm: 85, cornerRadiusMm: 0 } }).layout;
  assert.equal(edited.parts.find(p => p.refdes === 'U1')!.origin.y, -15.3);
  assert.deepEqual(edited.parts.filter(p => p.refdes !== 'U1'), b.parts.filter(p => p.refdes !== 'U1'));
  assert.deepEqual(edited.mountingHoles[0], { x: -38.5, y: -38.5, diameterMm: 3.2 });
  const c = b.parts.find(p => p.refdes === 'U1')!;
  assert.throws(() => applyMakerEdits(b, { board: { widthMm: 85, heightMm: 85, cornerRadiusMm: 0 }, placements: [{ refdes: c.refdes, ...c.center, rotation: 0 }] }), /USB must remain/);
});
test('all four USB edges are cardinal and edge locked; clashes are rejected', () => {
  for (const [edge, rotation] of [['left', 270], ['right', 90], ['top', 180], ['bottom', 0]] as const) {
    const { layout } = applyMakerEdits(onlyController(), { usbEdge: edge }); assert.equal(layout.parts[0]!.rotation, rotation); validateLayout(layout);
  }
  assert.throws(() => applyMakerEdits(base(), { usbEdge: 'right' }), /overlaps/);
});
test('arbitrary peripheral rotation is supported and mounting holes clear full body envelopes', () => {
  const b = onlyController(); const bz = structuredClone(base().parts.find(p => p.refdes === 'BZ1')!); b.parts.push(bz);
  validateLayout(applyMakerEdits(b, { placements: [{ refdes: 'BZ1', x: 20, y: 10, rotation: 37 }] }).layout);
  b.mountingHoles = [{ x: 25, y: -16.5, diameterMm: 3.2 }]; assert.throws(() => validateLayout(b), /obstructs a mounting hole/);
});
test('rounded corners reject bodies that fit the bounding rectangle, and larger fillets move mounting holes inward', () => {
  const b = onlyController(120); const bz = structuredClone(base().parts.find(p => p.refdes === 'BZ1')!); b.parts.push(bz);
  assert.throws(() => applyMakerEdits(b, { board: { widthMm: 120, heightMm: 120, cornerRadiusMm: 20 }, placements: [{ refdes: 'BZ1', x: 53, y: 53, rotation: 0 }] }), /outside/);
  const { layout } = applyMakerEdits(onlyController(120), { board: { widthMm: 120, heightMm: 120, cornerRadiusMm: 20 } });
  assert.ok(Math.abs(layout.mountingHoles[0]!.x) < 56); validateLayout(layout);
});
test('unsafe source-base geometry fails closed', () => {
  for (const mutate of [
    (c: any[]) => { c.find(e => e.type === 'pcb_component').footprint_origin = undefined; },
    (c: any[]) => { c.find(e => e.type === 'pcb_plated_hole').x += 1; },
    (c: any[]) => { c.find(e => e.type === 'pcb_plated_hole').outer_diameter = 4; },
    (c: any[]) => { c.find(e => e.type === 'pcb_plated_hole').hole_diameter = 4; },
    (c: any[]) => { c.find(e => e.type === 'pcb_plated_hole').shape = 'oval'; },
    (c: any[]) => { c.find(e => e.type === 'pcb_plated_hole').layers = ['top']; },
    (c: any[]) => { c.find(e => e.type === 'pcb_board').center.x = 1; },
    (c: any[]) => { c.find(e => e.type === 'pcb_board').outline[3].x -= 4; },
    (c: any[]) => { c.push({ ...c.find(e => e.type === 'pcb_board') }); },
  ]) { const c = circuit(); mutate(c); assert.throws(() => layoutFromCircuit(c, metadata)); }
});

test('overlapping source base can be repaired without accepting an invalid final layout', () => {
  const c = circuit(); const component = c.find((e: any) => e.type === 'pcb_component' && e.source_component_id === c.find((s: any) => s.type === 'source_component' && s.name === 'U2').source_component_id);
  component.center.x -= 25; component.footprint_origin.x -= 25;
  for (const pad of c.filter((e: any) => e.type === 'pcb_plated_hole' && e.pcb_component_id === component.pcb_component_id)) pad.x -= 25;
  const b = layoutFromCircuit(c, metadata); const before = structuredClone(b);
  assert.throws(() => validateLayout(b), /overlaps/);
  assert.throws(() => applyMakerEdits(b, {}), /overlaps/);
  const fixed = applyMakerEdits(b, { placements: [{ refdes: 'U2', x: 19.85, y: 27.9, rotation: 0 }] }).layout;
  validateLayout(fixed); assert.deepEqual(b, before);
});
test('growing a too-small source board repairs bounds, mounting holes and USB edge together', () => {
  const c = circuit(); const board = c.find((e: any) => e.type === 'pcb_board');
  board.width = 65; board.height = 65; board.outline = layoutOutline({ widthMm: 65, heightMm: 65, cornerRadiusMm: 3 });
  const b = layoutFromCircuit(c, metadata); const before = structuredClone(b);
  assert.throws(() => validateLayout(b));
  const fixed = applyMakerEdits(b, { board: { widthMm: 85, heightMm: 85, cornerRadiusMm: 3 } }).layout;
  validateLayout(fixed); assert.deepEqual(b, before);
  assert.deepEqual(fixed.parts.filter(p => p.refdes !== 'U1'), b.parts.filter(p => p.refdes !== 'U1'));
});
test('source carriers require two layers, exactly four standard holes and no grouped placements', () => {
  for (const mutate of [
    (c: any[]) => { c.find(e => e.type === 'pcb_board').num_layers = 4; },
    (c: any[]) => { c.splice(c.findIndex(e => e.type === 'pcb_hole'), 1); },
    (c: any[]) => { c.push({ ...c.find(e => e.type === 'pcb_hole'), pcb_hole_id: 'extra' }); },
    (c: any[]) => { c.find(e => e.type === 'pcb_hole').hole_diameter = 3.5; },
    (c: any[]) => { c.find(e => e.type === 'pcb_hole').hole_shape = 'oval'; },
    (c: any[]) => { c.find(e => e.type === 'pcb_component').pcb_group_id = 'pcb_group_nested'; },
    (c: any[]) => { c.push({ type: 'pcb_group', pcb_group_id: 'pcb_group_nested', parent_pcb_group_id: 'pcb_group_parent' }); },
  ]) { const c = circuit(); mutate(c); assert.throws(() => layoutFromCircuit(c, metadata)); }
});
