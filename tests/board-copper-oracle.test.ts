import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CATALOG } from '../src/circuit/catalog.js';

function fixture() {
  const source = (id: string) => ({ type: 'source_component', source_component_id: id, name: id });
  const component = (id: string) => ({ type: 'pcb_component', pcb_component_id: id, source_component_id: id });
  const pad = (id: string, pin: number, x: number, y: number) => ({ type: 'pcb_plated_hole', pcb_component_id: id, x, y, outer_diameter: 1.6, hole_diameter: .8, port_hints: [`pin${pin}`] });
  const wire = (x: number, y: number, layer = 'top') => ({ route_type: 'wire', x, y, layer, width: .25 });
  return [
    { type: 'pcb_board', width: 30, height: 30 },
    ...['R1', 'R2'].flatMap(id => [source(id), component(id)]),
    pad('R1', 1, -5, 8), pad('R1', 2, -5, -8), pad('R2', 1, 5, 8), pad('R2', 2, 5, -8),
    { type: 'pcb_via', x: 0, y: 8, outer_diameter: .6, hole_diameter: .3 },
    { type: 'pcb_trace', pcb_trace_id: 'a', route: [wire(-5, 8), wire(0, 8),
      { route_type: 'via', x: 0, y: 8, from_layer: 'top', to_layer: 'bottom', via_diameter: .6, via_hole_diameter: .3 }, wire(0, 8, 'bottom'), wire(5, 8, 'bottom')] },
    { type: 'pcb_trace', pcb_trace_id: 'b', route: [wire(-5, -8), wire(5, -8)] },
  ] as Record<string, any>[];
}

async function oracle(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'moki-copper-oracle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'design.json'), JSON.stringify({ parts: ['R1', 'R2'].map(id => ({ id, module: 'resistor-axial' })),
    nets: [1, 2].map(pin => ({ name: String(pin), endpoints: ['R1', 'R2'].map(part => ({ part, pin: String(pin) })) })) }));
  await writeFile(join(dir, 'board-metadata.json'), JSON.stringify({ parts: [{ id: 'R1', module: 'resistor-axial', x: -5, y: 0 }, { id: 'R2', module: 'resistor-axial', x: 5, y: 0 }] }));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify(Object.fromEntries(CATALOG)));
  return async (cj: Record<string, any>[]) => {
    // Python's decoder accepts NaN/Infinity; exercise those actual tokens rather than JSON null.
    const encoded = JSON.stringify(cj, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? `__NONFINITE_${value}__` : value)
      .replace(/"__NONFINITE_(NaN|Infinity|-Infinity)__"/g, '$1');
    await writeFile(join(dir, 'circuit.json'), encoded);
    const run = spawnSync('python3', [resolve('tests/board-connectivity.py'), dir, join(dir, 'catalog.json')], { encoding: 'utf8', timeout: 5000 });
    return { status: run.status, output: run.stdout + run.stderr };
  };
}

test('copper oracle accepts intact annuli, including a route-only layer transition', async t => {
  const run = await oracle(t);
  for (const cj of [fixture(), fixture().filter(e => e.type !== 'pcb_via')]) {
    const result = await run(cj); assert.equal(result.status, 0, result.output);
  }
});

test('copper oracle rejects destructive, undersized and nonfinite drills/pads on every representation', async t => {
  const run = await oracle(t);
  for (const kind of ['pad', 'via', 'route-only-via']) for (const [field, bad] of [
    ['hole', 1.6], ['hole', .31], ['hole', 0], ['hole', -.3], ['hole', NaN], ['hole', Infinity],
    ['outer', 0], ['outer', -.6], ['outer', NaN], ['outer', Infinity],
  ] as const) {
    // A 0.31 mm hole leaves 0.145 mm on a 0.6 mm via; match that policy violation for the larger pad.
    let cj = fixture();
    if (kind === 'route-only-via') cj = cj.filter(e => e.type !== 'pcb_via');
    const target = kind === 'pad' ? cj.find(e => e.type === 'pcb_plated_hole')! : kind === 'via' ? cj.find(e => e.type === 'pcb_via')! : cj.find(e => e.type === 'pcb_trace')!.route.find((p: any) => p.route_type === 'via');
    const key = kind === 'route-only-via' ? (field === 'hole' ? 'via_hole_diameter' : 'via_diameter') : (field === 'hole' ? 'hole_diameter' : 'outer_diameter');
    target[key] = kind === 'pad' && bad === .31 ? 1.31 : bad;
    const result = await run(cj);
    assert.notEqual(result.status, 0, `${kind} ${key}=${bad} must fail\n${result.output}`);
    assert.match(result.output, /annulus|finite.*positive/);
  }
});

test('route dimensions cannot contradict a matching pcb_via, and drills cannot cut a neighbouring annulus', async t => {
  const run = await oracle(t);
  const mismatch = fixture(); mismatch.find(e => e.type === 'pcb_trace')!.route.find((p: any) => p.route_type === 'via').via_diameter = .8;
  const result = await run(mismatch); assert.notEqual(result.status, 0); assert.match(result.output, /dimensions disagree/);
  const neighbour = fixture(); neighbour.push({ type: 'pcb_via', x: -4.5, y: 8, outer_diameter: .6, hole_diameter: .3 });
  const cut = await run(neighbour); assert.notEqual(cut.status, 0); assert.match(cut.output, /Drill void cuts/);
});

test('copper wholly erased inside a valid drill does not survive as a connection or floating island', async t => {
  const run = await oracle(t), cj = fixture();
  cj.push({ type: 'pcb_trace', pcb_trace_id: 'erased', route: [
    { route_type: 'wire', x: -.02, y: 8, width: .02, layer: 'top' }, { route_type: 'wire', x: .02, y: 8, width: .02, layer: 'top' },
  ] });
  cj.push({ type: 'pcb_copper_pour', shape: 'brep', layer: 'top', pcb_copper_pour_id: 'erased-pour', brep_shape: {
    outer_ring: { vertices: [{ x: -.02, y: 7.98 }, { x: .02, y: 7.98 }, { x: .02, y: 8.02 }, { x: -.02, y: 8.02 }] }, inner_rings: [],
  } });
  const result = await run(cj); assert.equal(result.status, 0, result.output); assert.match(result.output, /copper pieces erased by drill voids: 2/);
});
