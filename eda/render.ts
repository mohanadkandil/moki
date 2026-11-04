import { RootCircuit } from 'tscircuit';
import { convertCircuitJsonToSchematicSvg, convertCircuitJsonToPcbSvg } from 'circuit-to-svg';
import { CircuitJsonToKicadPcbConverter, CircuitJsonToKicadSchConverter, CircuitJsonToKicadProConverter } from 'circuit-json-to-kicad';
import { renderDetailedBoard } from './models/render-board';
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber';
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from 'circuit-json-to-bom-csv';
import { catalogBom } from '../src/board/bom';
import { convertCircuitJsonToPickAndPlaceCsv } from 'circuit-json-to-pnp-csv';
import { zipSync, strToU8 } from 'fflate';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyLayout, manualEditsFor, verifyLayout, metadataForLayout } from './apply-layout';
import { makerAutorouter } from './edit-router';
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
  const layout = await Bun.file(resolve(job, 'layout.json')).exists() ? await Bun.file(resolve(job, 'layout.json')).json() : undefined;
  let editedRoutingInvocations = 0;
  await stage('render', async () => {
    circuit.add(module.default());
    if (layout) applyLayout(circuit, layout, async input => { editedRoutingInvocations++; return makerAutorouter(input); });
    circuit.render();
  });
  await stage('route', () => circuit.renderUntilSettled());
  const cj = circuit.getCircuitJson();
  if (layout) {
    if (cj.some(e => e.type === 'pcb_trace') && !editedRoutingInvocations) throw new Error('Edited routing policy was not applied');
    await save('manual-edits.json', JSON.stringify({ ...manualEditsFor(layout), routing: { solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph', planningClearanceMm: .25, minimumClearanceMm: .2, invocations: editedRoutingInvocations } }, null, 2));
  }
  if (layout) { verifyLayout(cj, layout); metadata = metadataForLayout(cj, layout, metadata); }
  await save('circuit.json', JSON.stringify(cj, null, 2));
  if (metadata) await save('board-metadata.json', JSON.stringify(metadata, null, 2));
  await stage('svg', async () => { await save('schematic.svg', responsive(convertCircuitJsonToSchematicSvg(cj))); await save('pcb.svg', responsive(convertCircuitJsonToPcbSvg(cj))); });
  await stage('gltf', async () => { await save('board.glb', await renderDetailedBoard(cj, metadata)); });
  await stage('fab', async () => {
    const files = convertCircuitJsonToGerberFiles(cj);
    const pcb = new CircuitJsonToKicadPcbConverter(cj);
    const sch = new CircuitJsonToKicadSchConverter(cj);
    const pro = new CircuitJsonToKicadProConverter(cj, {projectName: 'moki-carrier', schematicFilename: 'moki-carrier.kicad_sch', pcbFilename: 'moki-carrier.kicad_pcb'});
    for (const converter of [pcb,sch,pro]) converter.runUntilFinished();
    await save('kicad.zip', zipSync({
      'moki-carrier.kicad_pcb': strToU8(pcb.getOutputString()),
      // Converter 0.0.267 emits KiCad 10's '(power global)' despite a KiCad 9 file version.
      // KiCad 9's equivalent global-power marker is the argument-free '(power)'.
      'moki-carrier.kicad_sch': strToU8(sch.getOutputString().replace(/^([ \t]*)\(power[ \t]+global\)[ \t]*$/gm, '$1(power)')),
      'moki-carrier.kicad_pro': strToU8(pro.getOutputString()),
      'README.txt': strToU8('Open moki-carrier.kicad_pro in KiCad. Converted with circuit-json-to-kicad; review design rules, net assignments and fabrication outputs before manufacturing. Module outlines and fit are catalog estimates. The detailed Moki recognition models are embedded in board.glb, not KiCad.\n'),
    }));
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
