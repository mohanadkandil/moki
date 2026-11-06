import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { CATALOG } from '../src/circuit/catalog.js';
import { buildDesign } from '../src/circuit/templates.js';
import { generateBoardSource } from '../src/board/codegen.js';
import { catalogBom } from '../src/board/bom.js';
import { runBoardProcess } from '../server/board-api.js';
import type { TemplateId } from '../src/circuit/model.js';

test('all templates route with wider fab rules and physical copper exactly matches design nets', { timeout: 240_000 }, async () => {
  const dir = await mkdtemp(resolve('var/board-jobs-test-routing-'));
  const catalog = join(dir, 'catalog.json');
  await writeFile(catalog, JSON.stringify(Object.fromEntries(CATALOG)));
  const bun = process.env.MOKI_BUN ?? resolve(homedir(), '.bun/bin/bun');
  for (const template of ['focus-timer', 'light-lamp', 'temp-monitor'] as TemplateId[]) {
    const design = buildDesign({ template, chosenBy: 'user', recognized: [], notes: [], options: { buzzer: true, display: true, sensor: 'ds18b20', pins: {} } });
    const job = join(dir, template); await mkdir(job);
    await writeFile(join(job, 'design.json'), JSON.stringify(design));
    await writeFile(join(job, 'board.tsx'), generateBoardSource(design));
    const rendered = await runBoardProcess(bun, [resolve('eda/render.ts'), '--job', job], process.cwd());
    assert.equal(rendered.code, 0, rendered.stderr);
    const receipt = JSON.parse(await readFile(join(job, 'receipt.json'), 'utf8'));
    assert.deepEqual(receipt.drc.errors, [], template);
    const glb = await readFile(join(job,'board.glb'));
    assert.ok(glb.length <= 3_000_000, `${template} GLB is ${glb.length} bytes`);
    const raw = JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
    assert.ok(raw.asset.extras.moki.maskMaterials.white);
    assert.ok(raw.nodes.some((n:any)=>n.name==='U1:esp32-devkitc-v4'));
    assert.ok(raw.nodes.some((n:any)=>n.name==='U1:socket'));
    for(const part of design.parts) {
      const n=raw.nodes.find((n:any)=>n.name===`${part.id}:${part.module}`);
      assert.ok(n, `${template} placed ${part.id} has a detailed model`);
      for(const node of raw.nodes.filter((n:any)=>n.extras?.moki?.part===part.id)) {
        const min=Math.min(...raw.meshes[node.mesh].primitives.map((p:any)=>raw.accessors[p.attributes.POSITION].min[1]))+(node.translation?.[1]??0);
        const seat=.8+node.extras.moki.seatHeightMm;
        assert.ok(min >= seat-.001 && min-seat <= .5, `${template} ${node.name} floats above seat: min ${min}, seat ${seat}`);
      }
    }
    if(template==='temp-monitor') {
      const metadata=JSON.parse(await readFile(join(job,'board-metadata.json'),'utf8'));
      const reduction=1-metadata.widthMm*metadata.heightMm/(90*95);
      assert.ok(reduction>=.3, `temperature carrier area reduction ${reduction}`);
    }
    assert.ok((await readFile(join(job,'kicad.zip'))).length > 1000);
    const pours = JSON.parse(await readFile(join(job,'circuit.json'),'utf8')).filter((e:any)=>e.type==='pcb_copper_pour');
    assert.ok(pours.some((p:any)=>p.layer==='top'));assert.ok(pours.some((p:any)=>p.layer==='bottom'));
    const copper = await runBoardProcess('python3', [resolve('tests/board-connectivity.py'), job, catalog], process.cwd());
    await writeFile(join(job, 'connectivity.log'), copper.stdout + copper.stderr);
    assert.equal(copper.code, 0, `${template}\n${copper.stdout}\n${copper.stderr}`);
    const elements: any[] = JSON.parse(await readFile(join(job, 'circuit.json'), 'utf8'));
    for (const via of elements.filter(e => e.type === 'pcb_via')) {
      assert.ok(Number.isFinite(via.hole_diameter) && via.hole_diameter >= 0.3 - 1e-6);
      assert.ok(Number.isFinite(via.outer_diameter) && via.outer_diameter >= 0.6 - 1e-6);
      assert.ok((via.outer_diameter - via.hole_diameter) / 2 >= 0.15 - 1e-6, 'Via must retain a 0.15 mm annulus');
    }
    for (const trace of elements.filter(e => e.type === 'pcb_trace')) for (const point of trace.route) {
      if (point.route_type === 'wire') assert.ok(point.width >= 0.25 - 1e-6);
    }
    const silk = elements.filter(e => e.type === 'pcb_silkscreen_text').map(e => e.text);
    for (const label of ['GND', '+']) assert.ok(silk.includes(label));
    if (template === 'temp-monitor') assert.ok(silk.includes('FLAT'));
    if (template === 'light-lamp') assert.ok(silk.includes('K -'));
    const bom = await readFile(join(job, 'bom.csv'), 'utf8');
    assert.match(bom, /Female socket 1x19/); assert.match(bom, /Male header/); assert.match(bom, /M3 x 16/);
    assert.doesNotMatch(bom, /[^\x00-\x7f]/);
    const placement = await readFile(join(job, 'pnp.csv'), 'utf8');
    assert.match(placement, /Reference only - through-hole/);
    const csvCheck = await runBoardProcess('python3', ['-c', 'import csv,sys; rows=list(csv.reader(open(sys.argv[1], newline=""))); assert rows and all(len(row)==6 for row in rows), rows', join(job, 'pnp.csv')], process.cwd());
    assert.equal(csvCheck.code, 0, csvCheck.stderr);
    // Retain the last generated boards for the required visual inspection and report.
    const evidence = resolve('docs/engineering/2026-11-04-tscircuit/evidence/fix_core', template);
    await mkdir(evidence, { recursive: true });
    for (const name of ['board.tsx', 'design.json', 'circuit.json', 'board-metadata.json', 'pcb.svg', 'receipt.json', 'connectivity.log', 'bom.csv', 'pnp.csv']) await cp(join(job, name), join(evidence, name));
    if (template === 'light-lamp') {
      // The physical oracle must catch damage even when source_trace still claims success.
      const original = await readFile(join(job, 'circuit.json'), 'utf8');
      await writeFile(join(job, 'circuit.json'), JSON.stringify(elements.filter(e => e.type !== 'pcb_trace')));
      const broken = await runBoardProcess('python3', [resolve('tests/board-connectivity.py'), job, catalog], process.cwd());
      assert.notEqual(broken.code, 0, 'An open circuit must fail');
      await writeFile(join(job, 'circuit.json'), original);
      const pads = elements.filter(e => e.type === 'pcb_plated_hole');
      const a = pads[0]!, b = pads[1]!;
      elements.push({ type: 'pcb_trace', pcb_trace_id: 'injected-short', route: [a, b].map(p => ({ route_type: 'wire', x: p.x, y: p.y, width: 0.25, layer: 'top' })) });
      await writeFile(join(job, 'circuit.json'), JSON.stringify(elements));
      const shorted = await runBoardProcess('python3', [resolve('tests/board-connectivity.py'), job, catalog], process.cwd());
      assert.notEqual(shorted.code, 0, 'A physical short must fail');
      const poured = JSON.parse(original);
      const xs=[a.x,b.x],ys=[a.y,b.y];
      poured.push({type:'pcb_copper_pour',pcb_copper_pour_id:'injected-pour-short',shape:'brep',layer:'top',brep_shape:{outer_ring:{vertices:[
        {x:Math.min(...xs)-1,y:Math.min(...ys)-1},{x:Math.max(...xs)+1,y:Math.min(...ys)-1},
        {x:Math.max(...xs)+1,y:Math.max(...ys)+1},{x:Math.min(...xs)-1,y:Math.max(...ys)+1},
      ]},inner_rings:[]}});
      await writeFile(join(job,'circuit.json'),JSON.stringify(poured));
      const pourShort=await runBoardProcess('python3',[resolve('tests/board-connectivity.py'),job,catalog],process.cwd());
      assert.notEqual(pourShort.code,0,'A pour bridging unrelated pads must fail');
    }
  }
  await rm(dir, { recursive: true, force: true });
});

test('catalog BOM preserves ASCII values and includes the real assembly supplies', () => {
  const csv = catalogBom({ parts: [{ id: 'R1', module: 'resistor-axial', role: '', value: '4.7 kΩ' }] });
  assert.match(csv, /1\/4 W/); assert.match(csv, /4.7 kohm/); assert.match(csv, /M3 x 16 mm/);
});
