import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectBlockPadGeometry, type NativeImportMap } from '../src/blocks/test-block.js';
import type { BlockDef, BlockDraft, BoardPlan } from '../src/blocks/contract.js';

const original = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/native-shape-rotation-fixture.json', import.meta.url), 'utf8'));
const fixture = () => structuredClone(original) as {
  draft: BlockDraft; plan: BoardPlan; blocks: BlockDef[]; circuit: any[]; imports: NativeImportMap;
};
const run = (f: ReturnType<typeof fixture>) => inspectBlockPadGeometry(f.draft, f.plan, f.blocks, f.circuit, f.imports);
const driver = (f: ReturnType<typeof fixture>) => {
  const source = f.circuit.find(e => e.type === 'source_component' && e.name === 'U5');
  const component = f.circuit.find(e => e.type === 'pcb_component' && e.source_component_id === source.source_component_id);
  const pads = f.circuit.filter(e => e.type === 'pcb_smtpad' && e.pcb_component_id === component.pcb_component_id);
  const ports = f.circuit.filter(e => e.type === 'pcb_port' && e.pcb_component_id === component.pcb_component_id);
  return { source, component, pads, ports };
};
test('exact failing 65x55 job attests all actual motor parts, including sixteen rotated pill lands and EP', () => {
  const f = fixture(), before = JSON.stringify(f), { component, pads } = driver(f);
  assert.equal(component.rotation, 90);
  assert.deepEqual(component.footprint_origin, { x: -26.5, y: 1.25 });
  assert.equal(pads.filter(p => p.shape === 'rotated_pill' && p.ccw_rotation === 90).length, 16);
  const pin11 = pads.find(p => p.port_hints.includes('pin11'));
  assert.deepEqual({ x: pin11.x, y: pin11.y }, { x: -29.350007, y: 2.2251060000000003 });
  assert.equal(pin11.width, 0.350012); assert.equal(pin11.height, 1.2999974);
  assert.equal(pads.filter(p => p.shape === 'rect' && p.port_hints.includes('pin17')).length, 1);
  const gate = run(f);
  assert.equal(gate.ok, true, JSON.stringify(gate));
  assert.equal(gate.measurements!.length, 9);
  assert.equal(gate.measurements!.find(m => m.where.endsWith('.U1'))!.measured, 17);
  assert.equal(JSON.stringify(f), before);
});
test('native pill and rotated_pill representations retain actual source aliases at every cardinal rotation', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const f = fixture(), { source, component, pads, ports } = driver(f), origin = component.footprint_origin;
    const angle = (rotation - component.rotation) * Math.PI / 180;
    for (const p of [...pads, ...ports]) {
      const x = p.x - origin.x, y = p.y - origin.y;
      p.x = origin.x + x * Math.cos(angle) - y * Math.sin(angle);
      p.y = origin.y + x * Math.sin(angle) + y * Math.cos(angle);
      if (p.type === 'pcb_smtpad' && p.shape === 'rotated_pill') {
        p.shape = rotation === 0 ? 'pill' : 'rotated_pill';
        if (rotation === 0) delete p.ccw_rotation; else p.ccw_rotation = rotation;
      }
    }
    component.rotation = rotation;
    const alias = f.circuit.find(e => e.type === 'source_port' && e.source_component_id === source.source_component_id && e.pin_number === 11);
    assert.equal(alias.name, 'VCP'); assert.ok(alias.port_hints.includes('pin11'));
    assert.equal(run(f).ok, true, `rotation ${rotation}`);
    alias.pin_number = 12;
    assert.equal(run(f).ok, false, 'rotated geometry cannot hide a contradictory physical alias');
  }
});
test('supported rotated rectangle has a finite angle; missing, nonfinite or malformed angles fail for both rotated shapes', () => {
  const good = fixture(), ep = driver(good).pads.find(p => p.port_hints.includes('pin17'));
  ep.shape = 'rotated_rect'; ep.ccw_rotation = 90;
  assert.equal(run(good).ok, true);
  for (const shape of ['rotated_rect', 'rotated_pill']) for (const angle of [undefined, NaN, Infinity, '90', null]) {
    const f = fixture(), p = driver(f).pads[0]; p.shape = shape;
    if (angle === undefined) delete p.ccw_rotation; else p.ccw_rotation = angle;
    assert.equal(run(f).ok, false, `${shape}: ${String(angle)}`);
  }
});
test('degenerate dimensions, unsupported foreign shapes/layers and nonfinite coordinates still fail closed', () => {
  for (const mutate of [
    (p: any) => { p.width = 0; }, (p: any) => { p.height = -1; },
    (p: any) => { p.width = NaN; }, (p: any) => { p.height = Infinity; },
    (p: any) => { p.x = NaN; }, (p: any) => { p.y = Infinity; },
    (p: any) => { p.shape = 'ellipse'; }, (p: any) => { p.shape = 'foreign_pill'; },
    (p: any) => { p.layer = 'inner1'; },
  ]) {
    const f = fixture(); mutate(driver(f).pads[0]);
    assert.equal(run(f).ok, false);
  }
});
test('actual import/source/pad identity and complete physical coverage remain required', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { driver(f).pads[0].port_hints = ['pin12']; },
    (f: ReturnType<typeof fixture>) => { driver(f).pads[0].pcb_port_id = 'foreign'; },
    (f: ReturnType<typeof fixture>) => { f.imports.parts.find(p => p.ref === 'U5')!.footprintSha256 = '0'.repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.imports.parts.find(p => p.ref === 'U5')!.pins['11'] = 'pin12'; },
    (f: ReturnType<typeof fixture>) => { f.circuit.splice(f.circuit.indexOf(driver(f).pads[0]), 1); },
    (f: ReturnType<typeof fixture>) => { f.circuit.push({ ...driver(f).pads[0], pcb_smtpad_id: 'rogue', pcb_port_id: 'foreign', port_hints: ['foreign'] }); },
  ]) {
    const f = fixture(); mutate(f); assert.equal(run(f).ok, false);
  }
});
test('actual connector annuli must survive their drills and keep top-to-bottom barrel layers', () => {
  const base = fixture(); assert.equal(base.circuit.filter(p => p.type === 'pcb_plated_hole').length, 2);
  for (const mutate of [
    (p: any) => { p.outer_diameter = p.hole_diameter; },
    (p: any) => { p.outer_diameter = p.hole_diameter - 0.1; },
    (p: any) => { p.hole_diameter = 0; },
    (p: any) => { p.layers = ['top']; },
    (p: any) => { Object.assign(p, { shape: 'pill', outer_width: 1, outer_height: 2, hole_width: 1, hole_height: 1 }); },
    (p: any) => { p.shape = 'rotated_pill'; p.ccw_rotation = 90; },
  ]) {
    const f = fixture(); mutate(f.circuit.find(p => p.type === 'pcb_plated_hole'));
    assert.equal(run(f).ok, false);
  }
});
