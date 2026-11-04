import { RootCircuit } from 'tscircuit';
import { convertCircuitJsonToSchematicSvg, convertCircuitJsonToPcbSvg } from 'circuit-to-svg';
import { convertCircuitJsonToGltf } from 'circuit-json-to-gltf';
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber';
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from 'circuit-json-to-bom-csv';
import { catalogBom } from '../src/board/bom';
import { convertCircuitJsonToPickAndPlaceCsv } from 'circuit-json-to-pnp-csv';
import { zipSync, strToU8 } from 'fflate';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolVersions } from './versions';

const job = resolve(process.argv[process.argv.indexOf('--job') + 1] ?? '.');
const start = performance.now();
const stages: { name: string; status: string; ms: number; note?: string }[] = [];
const save = (name: string, data: string | Uint8Array) => writeFile(resolve(job, name), data);
const responsive = (svg: string) => svg.replace(/<svg\b([^>]*)>/, (tag, attrs) => attrs.includes('viewBox=') ? tag : tag.replace('<svg', `<svg viewBox="0 0 ${/width="(\d+)"/.exec(attrs)?.[1] ?? 1200} ${/height="(\d+)"/.exec(attrs)?.[1] ?? 600}"`));
async function stage<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const at = performance.now();
  try { const value = await run(); stages.push({ name, status: 'done', ms: performance.now() - at }); return value; }
  catch (error) { stages.push({ name, status: 'failed', ms: performance.now() - at, note: String(error) }); throw error; }
}
try {
  const versions = await toolVersions();
  const circuit = new RootCircuit();
  let metadata: any;
  // Jobs are outside eda/: transpile with Bun so external imports and JSX use ONLY eda/node_modules.
  const compiled = await Bun.build({ entrypoints: [resolve(job, 'board.tsx')], target: 'bun', packages: 'external', jsx: { runtime: 'automatic', importSource: 'react' } });
  if (!compiled.success) throw new Error(compiled.logs.join('\n'));
  const runtimeSource = await compiled.outputs[0]!.text();
  const runtimeFile = resolve(import.meta.dir, `.job-${process.pid}.mjs`);
  await writeFile(runtimeFile, runtimeSource);
  let module: any;
  try { module = await import(pathToFileURL(runtimeFile).href); } finally { await Bun.file(runtimeFile).delete(); }
  if (typeof module.default !== 'function') throw new Error('board.tsx must default-export a Board component');
  metadata = module.boardMetadata;
  await stage('render', async () => { circuit.add(module.default()); circuit.render(); });
  await stage('route', () => circuit.renderUntilSettled());
  const cj = circuit.getCircuitJson();
  await save('circuit.json', JSON.stringify(cj, null, 2));
  if (metadata) await save('board-metadata.json', JSON.stringify(metadata, null, 2));
  await stage('svg', async () => { await save('schematic.svg', responsive(convertCircuitJsonToSchematicSvg(cj))); await save('pcb.svg', responsive(convertCircuitJsonToPcbSvg(cj))); });
  await stage('gltf', async () => { const glb = await convertCircuitJsonToGltf(cj, { format: 'glb' }); await save('board.glb', new Uint8Array(glb as ArrayBuffer)); });
  await stage('fab', async () => {
    const files = convertCircuitJsonToGerberFiles(cj);
    await save('gerbers.zip', zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strToU8(data)]))));
    const rows = await convertCircuitJsonToBomRows({ circuitJson: cj });
    for (const row of rows) {
      const part = metadata?.parts?.find((p: any) => p.id === row.designator);
      if (part) { row.value = part.value ?? row.value; row.footprint = `moki:${part.module}`; row.extra_columns = { 'Catalog module': part.module, 'Fit verified': 'No: verify actual parts' }; }
    }
    await save('bom.csv', metadata?.parts ? catalogBom(metadata) : convertBomRowsToCsv(rows));
    const pnp = convertCircuitJsonToPickAndPlaceCsv(cj).trimEnd().split(/\r?\n/);
    await save('pnp.csv', pnp.map((line, i) => line + (i === 0 ? ',Assembly note' : ',Reference only - through-hole hand assembly; not machine placement data')).join('\n') + '\n');
  });
  const issue = (e: any) => ({ type: e.type, message: String(e.message ?? e.error_type ?? e.type) });
  const errors = cj.filter((e: any) => e.type.endsWith('_error')).map(issue);
  const warnings = cj.filter((e: any) => e.type.endsWith('_warning')).map(issue);
  if (metadata?.dimensionsVerified === false) warnings.push({ type: 'unverified_module_dimensions', message: 'Footprints preserve approximate catalog pin coordinates. Verify actual module dimensions, pin order, sockets and fit before fabrication; Module and socket 3D shapes are illustrative, not exact manufacturer CAD.' });
  const board: any = cj.find((e: any) => e.type === 'pcb_board');
  await save('receipt.json', JSON.stringify({ stages, totalMs: performance.now() - start, drc: { checked: true, errors, warnings },
    board: { widthMm: board?.width ?? 0, heightMm: board?.height ?? 0, layers: board?.num_layers ?? 2, traceCount: cj.filter((e: any) => e.type === 'pcb_trace').length, viaCount: cj.filter((e: any) => e.type === 'pcb_via').length },
    toolVersions: versions }, null, 2));
  process.exitCode = errors.length ? 2 : 0;
} catch (error) {
  await save('render-error.json', JSON.stringify({ error: String(error), stages, totalMs: performance.now() - start }, null, 2));
  console.error(error); process.exitCode = 1;
}
