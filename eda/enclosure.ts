// The enclosure stage: bun eda/enclosure.ts --job <dir>
//
// Reads <dir>/circuit.json and writes mech-handoff.json, the enclosure-baseline stage, then the
// build123d body (mech/enclosure.py) and assembly.glb. If build123d is missing or fails, the baseline
// meshes become the deliverable and enclosure.json says so. The last stdout line is a JSON receipt.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { buildAssemblyGlb, lidToAssembled } from './enclosure/assembly.ts';
import { buildBaseline, type BaselineResult } from './enclosure/baseline.ts';
import { buildMechHandoff, type MechHandoff } from './enclosure/handoff.ts';
import { readBinaryStl, writeBinaryStl } from './enclosure/stl.ts';

interface Stage { name: string; status: 'done' | 'failed' | 'skipped'; ms: number; note?: string }

const MECH_TIMEOUT_MS = 90_000;
const started = performance.now();
const jobArg = process.argv.indexOf('--job');
if (jobArg < 0 || !process.argv[jobArg + 1]) { console.error('Usage: bun eda/enclosure.ts --job <dir>'); process.exit(1); }
const job = resolve(process.argv[jobArg + 1]!);
const path = (name: string) => resolve(job, name);
const stages: Stage[] = [];
const rounded = (n: number) => Math.round(n * 10) / 10;

function finish(status: 'done' | 'failed', note: string): never {
  console.log(JSON.stringify({ name: 'enclosure', status, ms: rounded(performance.now() - started), note, stages }));
  process.exit(status === 'done' ? 0 : 1);
}

async function runMech(): Promise<{ ok: boolean; note: string }> {
  const python = process.env.MOKI_BUILD123D_PYTHON ?? resolve(homedir(), '.local/share/moki-tools/build123d-venv/bin/python');
  if (!existsSync(python)) return { ok: false, note: `build123d venv not found at ${python}` };
  const proc = Bun.spawn([python, resolve(import.meta.dir, '../mech/enclosure.py'), '--job', job], { stdout: 'pipe', stderr: 'pipe', timeout: MECH_TIMEOUT_MS, killSignal: 'SIGKILL' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const last = stdout.trim().split('\n').pop() ?? '';
  let receipt: { status?: string; note?: string } = {};
  try { receipt = JSON.parse(last); } catch { /* Reported below from stderr. */ }
  if (proc.signalCode) return { ok: false, note: `build123d was killed after ${MECH_TIMEOUT_MS} ms (${proc.signalCode})` };
  if (code !== 0 || receipt.status !== 'done') return { ok: false, note: receipt.note ?? (stderr.trim().split('\n').pop() || `build123d exited with code ${code}`) };
  return { ok: true, note: receipt.note ?? '' };
}

// The body depends only on the handoff and the code that models it, so a repeat board can reuse it.
// Failed runs and fallbacks are never stored.
const MECH_OUTPUTS = ['enclosure-base.stl', 'enclosure-lid.stl', 'enclosure.step', 'enclosure.json'];
const cacheRoot = process.env.MOKI_MECH_CACHE_DIR ?? resolve(import.meta.dir, '../var/mech-cache');

async function mechCacheDir(handoffText: string): Promise<string> {
  const hash = createHash('sha256').update(handoffText);
  for (const source of ['../mech/enclosure.py', '../mech/requirements.txt']) hash.update(await readFile(resolve(import.meta.dir, source)));
  hash.update(process.env.MOKI_BUILD123D_PYTHON ?? 'default-venv');
  return resolve(cacheRoot, hash.digest('hex'));
}

async function restoreMech(dir: string): Promise<boolean> {
  if (!MECH_OUTPUTS.every(name => existsSync(resolve(dir, name)))) return false;
  await Promise.all(MECH_OUTPUTS.map(name => copyFile(resolve(dir, name), path(name))));
  return true;
}

async function storeMech(dir: string): Promise<void> {
  // Written to one side and renamed, so a half-written entry can never be read as a hit.
  const temp = `${dir}.${process.pid}.tmp`;
  await mkdir(temp, { recursive: true });
  await Promise.all(MECH_OUTPUTS.map(name => copyFile(path(name), resolve(temp, name))));
  await rename(temp, dir).catch(() => rm(temp, { recursive: true, force: true }));
}

function baselineReport(handoff: MechHandoff, baseline: BaselineResult, reason: string) {
  const volume = (baseline.baseCheck.signedVolumeMm3 + baseline.lidCheck.signedVolumeMm3) / 1000;
  return {
    schema: 'moki.enclosure/1',
    engine: { name: '@tscircuit/create-fdm-enclosure', version: '0.0.7', kernel: 'JSCAD mesh', fallback: true, fallbackReason: reason },
    source: handoff.source, units: 'mm',
    frame: 'Solver frame: the box is centred on `offset` in board coordinates. Z = 0 is the outside of the floor.',
    offset: baseline.offset,
    dimensions: { outerMm: { x: baseline.dimensions.x, y: baseline.dimensions.y, z: baseline.dimensions.z }, seamZ: baseline.dimensions.seamZ, boardBottomZ: baseline.dimensions.boardBottomZ, boardTopZ: baseline.dimensions.boardTopZ, wallMm: 2, floorMm: 2, lidMm: 2 },
    clearancesMm: { fit: 0.3 },
    apertures: handoff.apertures.map(a => ({ id: a.id, part: a.part, purpose: a.purpose, face: a.face, shape: a.shape, position: { x: a.center.x, y: a.center.y }, sizeMm: { width: a.widthMm, height: a.heightMm }, note: a.note })),
    printOrientation: { base: 'Floor on the bed, as exported.', lid: 'Outer face on the bed, as exported.', lidExportTransform: { note: 'Assembled (x, y, z) = (x_stl, -y_stl, totalHeight - z_stl).', totalHeightMm: baseline.dimensions.z } },
    material: { name: 'PLA', densityGPerCm3: 1.24 },
    estimate: { volumeCm3: Math.round(volume * 1000) / 1000, filamentG: rounded(volume * 1.24), basis: 'Mesh volume at 100% infill: an upper bound.' },
    validation: { base: { stl: baseline.baseCheck }, lid: { stl: baseline.lidCheck } },
    physicalPrint: false,
    assumptions: ['No physical print or test fit has happened.', 'Module dimensions are catalog estimates.', 'This is the fallback box: no STEP file, no lid pillars, friction-fit lid.'],
    warnings: [...handoff.warnings, ...baseline.warnings],
  };
}

let handoff: MechHandoff;
let handoffText = '';
try {
  const at = performance.now();
  const circuitText = await readFile(path('circuit.json'), 'utf8');
  let metadata = null;
  if (existsSync(path('board-metadata.json'))) metadata = JSON.parse(await readFile(path('board-metadata.json'), 'utf8'));
  handoff = buildMechHandoff(circuitText, metadata);
  handoffText = JSON.stringify(handoff, null, 2);
  await writeFile(path('mech-handoff.json'), handoffText);
  stages.push({ name: 'mech-handoff', status: 'done', ms: rounded(performance.now() - at), note: `${handoff.parts.length} parts, ${handoff.apertures.length} openings, ${handoff.board.holes.length} M3 holes` });
} catch (error) {
  console.error(error);
  stages.push({ name: 'mech-handoff', status: 'failed', ms: rounded(performance.now() - started), note: String(error) });
  finish('failed', `Handoff failed: ${String(error)}`);
}

let baseline: BaselineResult | null = null;
{
  const at = performance.now();
  try {
    baseline = buildBaseline(handoff);
    await writeFile(path('enclosure-baseline-base.stl'), writeBinaryStl(baseline.base));
    await writeFile(path('enclosure-baseline-lid.stl'), writeBinaryStl(baseline.lid));
    stages.push({ name: 'enclosure-baseline', status: 'done', ms: rounded(performance.now() - at), note: `create-fdm-enclosure 0.0.7: ${baseline.baseCheck.triangles + baseline.lidCheck.triangles} triangles, watertight base=${baseline.baseCheck.watertight} lid=${baseline.lidCheck.watertight}` });
  } catch (error) {
    stages.push({ name: 'enclosure-baseline', status: 'failed', ms: rounded(performance.now() - at), note: String(error) });
  }
}

let mech: { ok: boolean; note: string };
let mechCache: 'hit' | 'miss' = 'miss';
{
  const at = performance.now();
  const cacheDir = await mechCacheDir(handoffText).catch(() => null);
  const restored = cacheDir ? await restoreMech(cacheDir).catch(() => false) : false;
  if (restored) {
    mechCache = 'hit';
    mech = { ok: true, note: 'build123d mech cache hit: same handoff and same modelling code' };
  } else {
    mech = await runMech().catch(error => ({ ok: false, note: String(error) }));
    // A cache that cannot be written only costs the next job some time.
    if (mech.ok && cacheDir) await mkdir(cacheRoot, { recursive: true }).then(() => storeMech(cacheDir)).catch(() => undefined);
  }
  stages.push({ name: 'enclosure', status: mech.ok ? 'done' : 'failed', ms: rounded(performance.now() - at), note: mech.note });
}

if (!mech.ok) {
  if (!baseline) finish('failed', `build123d failed (${mech.note}) and the baseline also failed.`);
  await copyFile(path('enclosure-baseline-base.stl'), path('enclosure-base.stl'));
  await copyFile(path('enclosure-baseline-lid.stl'), path('enclosure-lid.stl'));
  await writeFile(path('enclosure.json'), JSON.stringify(baselineReport(handoff, baseline, mech.note), null, 2));
}

let assemblyNote = '';
{
  const at = performance.now();
  try {
    if (!existsSync(path('board.glb'))) throw new Error('board.glb is missing');
    const report = JSON.parse(await readFile(path('enclosure.json'), 'utf8'));
    const dims = report.dimensions;
    const base = readBinaryStl(new Uint8Array(await readFile(path('enclosure-base.stl'))));
    const lid = lidToAssembled(readBinaryStl(new Uint8Array(await readFile(path('enclosure-lid.stl')))), dims.outerMm.z);
    // The fallback box sits in solver coordinates, so move it to the board frame before assembling.
    if (report.offset) for (const mesh of [base, lid]) for (let i = 0; i < mesh.length; i += 3) { mesh[i]! += report.offset.x; mesh[i + 1]! += report.offset.y; }
    const glb = buildAssemblyGlb({ boardGlb: new Uint8Array(await readFile(path('board.glb'))), base, lid, boardBottomZ: dims.boardBottomZ, boardTopZ: dims.boardTopZ, seamZ: dims.seamZ, thicknessMm: handoff.board.thicknessMm, parts: handoff.parts });
    await writeFile(path('assembly.glb'), glb);
    assemblyNote = `${glb.length} bytes`;
    stages.push({ name: 'assembly', status: 'done', ms: rounded(performance.now() - at), note: assemblyNote });
  } catch (error) {
    assemblyNote = String(error);
    stages.push({ name: 'assembly', status: 'failed', ms: rounded(performance.now() - at), note: assemblyNote });
  }
}

const totalMs = rounded(performance.now() - started);
const report = JSON.parse(await readFile(path('enclosure.json'), 'utf8'));
report.stages = stages;
report.ms = totalMs;
report.mechCache = mechCache;
if (report.timing) report.timingSource = mechCache === 'hit' ? 'the earlier run that filled the cache; see stages for this run' : 'this run';
report.warnings = report.warnings ?? [];
await writeFile(path('enclosure.json'), `${JSON.stringify(report, null, 2)}\n`);
const assemblyOk = stages.find(s => s.name === 'assembly')?.status === 'done';
finish('done', mech.ok
  ? `${mech.note}${assemblyOk ? '' : `; assembly failed: ${assemblyNote}`}`
  : `Using the create-fdm-enclosure fallback because build123d failed: ${mech.note}${assemblyOk ? '' : `; assembly failed: ${assemblyNote}`}`);
