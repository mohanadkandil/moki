import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { checkSensorCopper } from '../eda/blocks/sensor-copper-check.js';

const evidence = resolve('docs/engineering/2026-11-05-chip-level/evidence/chip_eda');
const recorded = join(evidence, 'sht40-board');
const { unzipSync, zipSync, strFromU8, strToU8 } = createRequire(new URL('../eda/package.json', import.meta.url))('fflate');
async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'moki-sensor-copper-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ['circuit.json', 'import-map.json', 'gerbers.zip']) await copyFile(join(recorded, file), join(dir, file));
  const circuit: any[] = JSON.parse(await readFile(join(dir, 'circuit.json'), 'utf8'));
  const imports = JSON.parse(await readFile(join(dir, 'import-map.json'), 'utf8'));
  const imported = imports.parts.find((p: any) => p.lcsc === 'C2909890');
  const source = circuit.find(p => p.type === 'source_component' && p.name === imported.ref);
  const component = circuit.find(p => p.type === 'pcb_component' && p.source_component_id === source.source_component_id);
  const keepout = circuit.find(p => p.type === 'pcb_keepout' && p.excluded_pcb_component_ids?.includes(component.pcb_component_id));
  const save = async () => {
    await writeFile(join(dir, 'circuit.json'), JSON.stringify(circuit));
    await writeFile(join(dir, 'import-map.json'), JSON.stringify(imports));
  };
  return { dir, circuit, imports, imported, component, keepout, save };
}
async function rejectsAudit(dir: string) {
  // A fail-closed exception and a structured failing result both block native acceptance.
  const result = await checkSensorCopper(dir).catch(error => ({ ok: false, error: String(error) }));
  assert.equal(result.ok, false, JSON.stringify(result));
}
function intrusion(x: number, y: number, layer = 'top') {
  return { type: 'pcb_trace', pcb_trace_id: 'REVIEW_MUTANT_UNDERBODY', route: [
    { route_type: 'wire', x: x - .3, y, width: .15, layer },
    { route_type: 'wire', x: x + .3, y, width: .15, layer },
  ] };
}

test('durable actual native board has four contact paste flashes and no forbidden sensor copper', async t => {
  const f = await fixture(t), result = await checkSensorCopper(f.dir);
  assert.equal(result.checked, true); assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok('paste' in result);
  assert.equal(result.paste!.pasteOk, true); assert.equal(result.paste!.near.length, 4);
  assert.equal(result.paste!.centralFlash, false); assert.deepEqual(result.violations, []);
});

test('retained actual segments from the historical DRC-clean but copper-invalid run are rejected', async t => {
  const f = await fixture(t);
  const old = JSON.parse(await readFile(join(evidence, 'sensor-copper-regression.json'), 'utf8'));
  assert.equal(old.sourceJob, '4cf83f62-630e-4159-b5b4-2965b23b85ef');
  assert.ok(old.segments.length); f.circuit.push(...old.segments); await f.save(); await rejectsAudit(f.dir);
});

test('a new width-bearing trace or via under the actual sensor body is rejected', async t => {
  for (const kind of ['trace', 'via']) {
    const f = await fixture(t), { x, y } = f.component.center;
    f.circuit.push(kind === 'trace' ? intrusion(x, y) : { type: 'pcb_via', pcb_via_id: 'REVIEW_MUTANT_VIA', x, y, hole_diameter: .3, outer_diameter: .6, layers: ['top', 'bottom'] });
    await f.save(); await rejectsAudit(f.dir);
  }
});

test('reintroduced central EP copper and paste cannot pass', async t => {
  const f = await fixture(t), { x, y } = f.component.center;
  const pad = f.circuit.find(p => p.type === 'pcb_smtpad' && p.pcb_component_id === f.component.pcb_component_id);
  f.circuit.push({ ...pad, pcb_smtpad_id: 'REVIEW_MUTANT_EP', port_hints: ['pin5'], x, y, width: .4, height: 1.1 });
  await f.save(); await rejectsAudit(f.dir);
  const paste = await fixture(t), zip = unzipSync(new Uint8Array(await readFile(join(paste.dir, 'gerbers.zip'))));
  const central = `X${Math.round(paste.component.center.x * 1e6)}Y${Math.round(paste.component.center.y * 1e6)}D03*\n`;
  zip['F_Paste.gbr'] = strToU8(strFromU8(zip['F_Paste.gbr']).replace('M02*', central + 'M02*'));
  await writeFile(join(paste.dir, 'gerbers.zip'), zipSync(zip)); await rejectsAudit(paste.dir);
});

test('moving the declared keepout away cannot hide copper beneath the real sensor center', async t => {
  const f = await fixture(t), { x, y } = f.component.center;
  f.keepout.center = { x: 100, y: 100 }; f.circuit.push(intrusion(x, y));
  await f.save(); await rejectsAudit(f.dir);
});

test('inner copper layers remain forbidden on a four-layer sensor board', async t => {
  const f = await fixture(t), { x, y } = f.component.center;
  const board = f.circuit.find(p => p.type === 'pcb_board'); board.num_layers = 4;
  f.keepout.layers = ['top', 'inner1', 'inner2', 'bottom'];
  f.circuit.push(intrusion(x, y, 'inner1')); await f.save(); await rejectsAudit(f.dir);
});

test('foreign circular pads and plated holes beneath the sensor are rejected', async t => {
  for (const kind of ['circle', 'plated']) {
    const f = await fixture(t), { x, y } = f.component.center;
    f.circuit.push(kind === 'circle'
      ? { type: 'pcb_smtpad', pcb_smtpad_id: 'REVIEW_MUTANT_CIRCLE', pcb_component_id: 'FOREIGN', layer: 'top', shape: 'circle', x, y, radius: .25, port_hints: [] }
      : { type: 'pcb_plated_hole', pcb_plated_hole_id: 'REVIEW_MUTANT_PTH', pcb_component_id: 'FOREIGN', layers: ['top', 'bottom'], shape: 'circle', x, y, hole_diameter: .3, outer_diameter: .6, port_hints: [] });
    await f.save(); await rejectsAudit(f.dir);
  }
});

test('additional imported sensors must not be silently skipped', async t => {
  const f = await fixture(t);
  f.imports.parts.push({ ...f.imported, ref: 'REVIEW_SECOND_SENSOR', inst: 'review_second' });
  await f.save(); await rejectsAudit(f.dir);
});

test('changing the sensor paste aperture dimensions cannot retain acceptance', async t => {
  const f = await fixture(t), zip = unzipSync(new Uint8Array(await readFile(join(f.dir, 'gerbers.zip'))));
  const original = strFromU8(zip['F_Paste.gbr']);
  assert.match(original, /%ADD53R,0\.353502X0\.293992\*%/);
  zip['F_Paste.gbr'] = strToU8(original.replace('%ADD53R,0.353502X0.293992*%', '%ADD53R,0.7X0.7*%'));
  await writeFile(join(f.dir, 'gerbers.zip'), zipSync(zip)); await rejectsAudit(f.dir);
});

test('paste whose center is outside the body still fails when its aperture intrudes', async t => {
  const f = await fixture(t), zip = unzipSync(new Uint8Array(await readFile(join(f.dir, 'gerbers.zip'))));
  const { x, y } = f.component.center;
  const extra = `D999*\nX${Math.round((x + 1) * 1e6)}Y${Math.round(y * 1e6)}D03*\n`;
  const original = strFromU8(zip['F_Paste.gbr']);
  zip['F_Paste.gbr'] = strToU8(original.replace('M02*', '%ADD999R,1.0X0.4*%\n' + extra + 'M02*'));
  await writeFile(join(f.dir, 'gerbers.zip'), zipSync(zip)); await rejectsAudit(f.dir);
});

test('rotated foreign copper and a route-embedded via cannot hide under the sensor', async t => {
  for (const kind of ['rotated', 'route-via']) {
    const f = await fixture(t), { x, y } = f.component.center;
    f.circuit.push(kind === 'rotated'
      ? { type: 'pcb_smtpad', pcb_smtpad_id: 'REVIEW_ROTATED', pcb_component_id: 'FOREIGN', layer: 'top', shape: 'rotated_rect', x: x + .8, y, width: 1, height: .2, ccw_rotation: 45, port_hints: [] }
      : { type: 'pcb_trace', pcb_trace_id: 'REVIEW_ROUTE_VIA', route: [{ route_type: 'via', x, y, via_diameter: .6, via_hole_diameter: .3, from_layer: 'top', to_layer: 'bottom' }] });
    await f.save(); await rejectsAudit(f.dir);
  }
});

test('annulus overlap subtracts actual drill void instead of treating it as copper', async t => {
  const f = await fixture(t), { x, y } = f.component.center;
  f.circuit.push({ type: 'pcb_via', pcb_via_id: 'REVIEW_ANNULUS', x, y, hole_diameter: .4, outer_diameter: .6, layers: ['top', 'bottom'] });
  await f.save(); const result = await checkSensorCopper(f.dir);
  assert.equal(result.ok, false);
  const overlaps = result.violations.filter((v: any) => v.id === 'REVIEW_ANNULUS');
  assert.equal(overlaps.length, 2);
  for (const v of overlaps) assert.ok(v.overlapMm2 > .15 && v.overlapMm2 < .17, JSON.stringify(v));
});

test('modified flashed paste macro definition fails closed', async t => {
  const f = await fixture(t), zip = unzipSync(new Uint8Array(await readFile(join(f.dir, 'gerbers.zip'))));
  const original = strFromU8(zip['F_Paste.gbr']); assert.match(original, /%AMVERTPILL\*/);
  zip['F_Paste.gbr'] = strToU8(original.replace('%AMVERTPILL*', '%AMVERTPILL*1,1,10,0,0*'));
  await writeFile(join(f.dir, 'gerbers.zip'), zipSync(zip)); await rejectsAudit(f.dir);
});

test('functional pad exceptions remain bound to the independently reviewed importer geometry', async t => {
  const f = await fixture(t);
  const pad = f.circuit.find(p => p.type === 'pcb_smtpad' && p.pcb_component_id === f.component.pcb_component_id && p.port_hints.includes('pin1'));
  const before = pad.x; pad.x = f.component.center.x; await f.save();
  // Move its matching paste too: an internally consistent forged pad/flash pair must not enlarge exceptions.
  const zip = unzipSync(new Uint8Array(await readFile(join(f.dir, 'gerbers.zip'))));
  const paste = strFromU8(zip['F_Paste.gbr']); let moved = false;
  const altered = paste.replace(/X(-?\d+)Y(-?\d+)D03\*/g, (command: string, gx: string, gy: string) => {
    if (Number(gx) !== Math.round(before * 1e6) || Number(gy) !== Math.round(pad.y * 1e6)) return command;
    moved = true; return `X${Math.round(pad.x * 1e6)}Y${gy}D03*`;
  });
  assert.equal(moved, true); zip['F_Paste.gbr'] = strToU8(altered);
  await writeFile(join(f.dir, 'gerbers.zip'), zipSync(zip)); await rejectsAudit(f.dir);
});
