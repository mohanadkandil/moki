import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { Sandbox } from '@daytona/sdk';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { createOpenAIClient } from '../src/runtime/providers.js';
import { PCBGeometry } from '../src/contracts/artifacts.js';
import { createSetupDaytonaClient, safeError } from './lib/daytona-client.js';

const runId = process.env.MOKI_RUN_ID;
if (!runId || !/^[a-zA-Z0-9-]{1,60}$/.test(runId)) throw new Error('Set a valid MOKI_RUN_ID');
const local = `var/runs/${runId}`;
const remote = `/home/daytona/moki/runs/${runId}`;
const model = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const timings: Record<string, number> = {};
const report: Record<string, unknown> = { ok: false, checkedAt: new Date().toISOString(), model, timingsMs: timings,
  release: { outcome: 'blocked', reason: 'No schematic, circuit or component-envelope validation' } };
type Stage = 'agents' | 'workers' | 'electrical' | 'handoff' | 'mechanical' | 'validation' | 'preview';
let activeStage: Stage = 'agents';
function event(stage: Stage, state: 'running' | 'passed' | 'blocked' | 'failed', message: string) {
  console.log('MOKI_EVENT ' + JSON.stringify({ stage, state, message, at: new Date().toISOString() }));
}
function clean(error: unknown) {
  return safeError(error).replace(/sk-[A-Za-z0-9_-]+/g, '<REDACTED>').slice(0, 1800);
}
async function timed<T>(name: string, stage: Stage, message: string, work: () => Promise<T>): Promise<T> {
  activeStage = stage;
  const start = performance.now();
  event(stage, 'running', message);
  try { const value = await work(); event(stage, 'passed', message); return value; }
  catch (error) { event(stage, 'failed', clean(error)); throw error; }
  finally { timings[name] = Math.round(performance.now() - start); }
}
async function command(sandbox: Sandbox, value: string, timeout = 60) {
  const result = await sandbox.process.executeCommand(value, undefined, undefined, timeout);
  if (result.exitCode !== 0) throw new Error(`Design worker command failed (${result.exitCode}): ${result.result.slice(-1200)}`);
  return result.result;
}
const Input = z.object({ brief: z.string().min(5).max(12000), inspirationId: z.string().min(1), conceptId: z.string().min(1), imagePath: z.string().min(1) });
const ElectricalPlan = z.object({ label: z.string(), width: z.number().min(10).max(200), height: z.number().min(10).max(150),
  thickness: z.literal(1.6), holes: z.array(z.object({ x: z.number(), y: z.number(), diameter: z.number().min(1).max(8) })).max(8),
  assumptions: z.array(z.string()).min(1).max(12) });
const MechanicalPlan = z.object({ label: z.string(), designIntent: z.string(), assumptions: z.array(z.string()).min(1).max(15),
  expectedBBoxMm: z.array(z.number().positive().max(500)).length(3), source: z.string().min(100).max(45000) });

async function main() {
  await mkdir(local, { recursive: true });
  const input = Input.parse(JSON.parse(await readFile(`${local}/design-input.json`, 'utf8')));
  const imagePath = resolve(input.imagePath);
  const imageRoot = resolve('var/inspirations') + sep;
  if (!imagePath.startsWith(imageRoot) || !['.jpg', '.jpeg', '.png', '.webp'].includes(extname(imagePath).toLowerCase())) throw new Error('Selected image must be a generated inspiration asset');
  if ((await stat(imagePath)).size > 12_000_000) throw new Error('Selected concept image exceeds 12 MB');
  const image = await readFile(imagePath);
  const mime = extname(imagePath).toLowerCase() === '.png' ? 'image/png' : extname(imagePath).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg';
  const imageUrl = `data:${mime};base64,${image.toString('base64')}`;
  report.input = { brief: input.brief, inspirationId: input.inspirationId, conceptId: input.conceptId,
    imagePath: input.imagePath, imageSha256: createHash('sha256').update(image).digest('hex') };
  const client = createOpenAIClient().withOptions({ timeout: 30_000, maxRetries: 0 });
  let savedElectrical: z.infer<typeof ElectricalPlan> | undefined;
  if (process.env.MOKI_RESUME_DESIGN === '1') {
    const previous = JSON.parse(await readFile(`${local}/report.json`, 'utf8'));
    if (JSON.stringify(previous.input) !== JSON.stringify(report.input)) throw new Error('Cannot resume a different brief or selected image');
    savedElectrical = ElectricalPlan.parse(JSON.parse(await readFile(`${local}/electrical-plan.json`, 'utf8')));
    report.electricalAgent = previous.electricalAgent;
    report.previousAttempts = [...(previous.previousAttempts || (previous.previousAttempt ? [previous.previousAttempt] : [])),
      { timingsMs: previous.timingsMs, error: previous.error }];
  }
  const daytona = await createSetupDaytonaClient(process.argv.includes('--use-cli-profile'));
  const [electricalWorker, mechanicalWorker] = await Promise.all(['moki-electrical', 'moki-mechanical'].map(name => daytona.get(name)));
  if (!electricalWorker || !mechanicalWorker) throw new Error('Both design workers are required');
  await timed('workersReady', 'workers', 'Starting the electrical and mechanical workspaces.', () => Promise.all([electricalWorker, mechanicalWorker].map(async sandbox => {
    await sandbox.refreshData();
    if (sandbox.state !== 'started') await sandbox.start(180);
    await sandbox.waitUntilStarted(180);
    await command(sandbox, `mkdir -p ${remote}`);
  })));
  report.workspaceReset = await timed('workspaceReset', 'workers', 'Fresh project workspace: clearing previous generated documents while keeping the workers running.', () => Promise.all([
    { sandbox: electricalWorker, role: 'electrical' }, { sandbox: mechanicalWorker, role: 'mechanical' },
  ].map(async ({ sandbox, role }) => {
    await sandbox.computerUse.start();
    await sandbox.fs.uploadFile(await readFile('scripts/design/reset-workspace.py'), `${remote}/reset-workspace.py`);
    return JSON.parse(await command(sandbox, `/usr/bin/python3 ${remote}/reset-workspace.py ${role} ${remote}`, 30));
  })));
  const electrical = savedElectrical || await timed('electricalPlanning', 'agents', 'Electrical agent is proposing a board envelope from your brief and selected concept.', async () => {
    const response = await client.responses.parse({ model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 900,
      instructions: 'You are Moki’s electrical physical-planning specialist. Read the exact product brief and selected concept image. Propose a compact plausible rectangular PCB envelope sized for THIS product. This is physical PLANNING only: no circuit or functional PCB exists. Do not claim a BOM, schematic, routing or electrical validation. All dimensions are mm. Thickness1.6. Choose 0-4 sensible provisional mounting holes, at most8; diameter1..8, each center at least radius+0.5mm inside the board. If dimensions are absent, make explicit provisional assumptions. Do not reuse a stock board size. Respect product scale and visible shape.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: input.brief }, { type: 'input_image', image_url: imageUrl, detail: 'high' }] }],
      text: { format: zodTextFormat(ElectricalPlan, 'electrical_physical_plan') } });
    if (!response.output_parsed) throw new Error('Electrical agent returned no structured plan');
    report.electricalAgent = { responseId: response.id, usage: response.usage };
    return ElectricalPlan.parse(response.output_parsed);
  });
  await writeFile(`${local}/electrical-plan.json`, JSON.stringify(electrical, null, 2) + '\n');
  await electricalWorker.fs.uploadFile(await readFile('scripts/design/board.py'), `${remote}/board.py`);
  await electricalWorker.fs.uploadFile(await readFile(`${local}/electrical-plan.json`), `${remote}/electrical-plan.json`);
  report.electrical = JSON.parse(await timed('boardGenerateMeasure', 'electrical', 'KiCad is saving the proposed board outline and measuring the saved file.', () => command(electricalWorker, `/usr/bin/python3 ${remote}/board.py ${remote}`)));
  const boardBytes = await electricalWorker.fs.downloadFile(`${remote}/board.kicad_pcb`);
  const contractBytes = await electricalWorker.fs.downloadFile(`${remote}/pcb-geometry.json`);
  const geometry = PCBGeometry.parse(JSON.parse(contractBytes.toString()));
  if (createHash('sha256').update(boardBytes).digest('hex') !== geometry.artifact.sha256) throw new Error('Saved board and geometry hash disagree');
  await writeFile(`${local}/board.kicad_pcb`, boardBytes);
  await writeFile(`${local}/pcb-geometry.json`, contractBytes);
  await timed('geometryHandoff', 'handoff', 'Mechanical agent is receiving the measured PCB dimensions and hole positions.', async () => {
    await mechanicalWorker.fs.uploadFile(contractBytes, `${remote}/pcb-geometry.json`);
    await mechanicalWorker.fs.uploadFile(boardBytes, `${remote}/board.kicad_pcb`);
    if (!(await mechanicalWorker.fs.downloadFile(`${remote}/pcb-geometry.json`)).equals(contractBytes)) throw new Error('Geometry handoff changed bytes');
    report.handoff = { ok: true, geometryTransferVerified: true, boardSha256: geometry.artifact.sha256,
      sourceRevision: geometry.artifact.revision, geometryComplete: false, unresolved: geometry.unresolved };
  });
  const prompt = `Product brief:\n${input.brief}\n\nActual measured board contract:\n${contractBytes.toString()}\n\nElectrical planning assumptions:\n${JSON.stringify(electrical.assumptions)}`;
  await writeFile(`${local}/mechanical-brief.txt`, prompt);
  let mechanical = await timed('mechanicalPlanning', 'mechanical', 'Mechanical agent is writing a first-pass enclosure for the selected concept and measured board.', async () => {
    const response = await client.responses.parse({ model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 4000,
      instructions: `You are Moki’s mechanical CAD specialist. Return concise executable Python build123d0.11.1 source, ideally under80 lines, with gen_step() returning closed positive-volume shape(s). Follow the selected image silhouette, proportions, materials and distinctive details, adapted to the actual brief and measured PCB. Do not return a generic fixture tray or fixed template box. You are making a real FIRST-PASS mechanical design, not a functional electronics product. All unspecified dimensions and electronic elements must be labeled assumptions. Use millimeters, XY centered and +Z up; board centeredXY with its mounting transform stated. Use simple robust build123d operations with named parameters and native labels/colors. A hollow enclosure can have shell/body/lid and distinct user-visible features; separate solid parts must be named. Board must have plausible internal clearance using measured width/height. No actual component-envelope fit is established. Prefer robust algebraic primitives, 2D closed profiles extruded or revolved for the selected silhouette. Fillets only when safe; avoid risky kernel operations and overcomplicated geometry. Do not return a shape for the PCB itself or pretend a decorative button is electrically functional. Outline look is a concept reference, never a dimensional source. Source starts with a CAD brief docstring stating intent, dimensions, datum, assumptions and verification targets. Allowed imports: build123d,math,json,pathlib,cadpy.assembly. No network, os, subprocess, file output, exports, dynamic execution or private introspection. No mesh import or arbitrary file access. If reading contract, only json.loads(Path(__file__).with_name('pcb-geometry.json').read_text()). gen_step returns geometry; CAD skill owns STEP/GLB export. Single-body or labeled Compound(children=[...]) is sufficient; avoid unverified AssemblyHelper APIs. Expected bbox must be reasonable within500mm. Return complete source, no markdown fences.`,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageUrl, detail: 'high' }] }],
      text: { format: zodTextFormat(MechanicalPlan, 'mechanical_cad_plan') } }, { timeout: 75_000 });
    report.mechanicalAgent = { responseId: response.id, usage: response.usage, status: response.status, incompleteDetails: response.incomplete_details };
    await writeFile(`${local}/mechanical-response.json`, JSON.stringify({ id: response.id, status: response.status, usage: response.usage, output: response.output }, null, 2));
    if (!response.output_parsed) throw new Error(`Mechanical agent returned no structured source (${response.status}; ${response.incomplete_details?.reason || 'no details'})`);
    return MechanicalPlan.parse(response.output_parsed);
  });
  await writeFile(`${local}/mechanical-plan.json`, JSON.stringify(mechanical, null, 2) + '\n');
  await writeFile(`${local}/product.py`, mechanical.source + '\n');
  const skill = resolve(process.env.MOKI_CAD_SKILL || `${homedir()}/.agents/skills/cad`);
  const archive = resolve(`${local}/cad-runtime.tar.gz`);
  await promisify(execFile)('tar', ['-czf', archive, '--exclude=__pycache__', '-C', skill, 'scripts/step', 'scripts/packages/cadpy/src']);
  await mechanicalWorker.fs.uploadFile(archive, `${remote}/cad-runtime.tar.gz`);
  await command(mechanicalWorker, `tar -xzf ${remote}/cad-runtime.tar.gz -C ${remote}`);
  for (const name of ['check-source.py', 'validate-step.py']) await mechanicalWorker.fs.uploadFile(await readFile(`scripts/design/${name}`), `${remote}/${name}`);
  await mechanicalWorker.fs.uploadFile(await readFile(`${local}/product.py`), `${remote}/product.py`);
  const python = '/home/daytona/moki/.cad-skill-venv/bin/python';
  const build = async () => {
    await command(mechanicalWorker, `/usr/bin/python3 ${remote}/check-source.py ${remote}/product.py`);
    return command(mechanicalWorker,
      `cd ${remote} && ulimit -t 110 && timeout 115s env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PYTHONPATH=${remote}/scripts/packages/cadpy/src ${python} ${remote}/scripts/step ${remote}/product.py --glb product.glb --force`, 120);
  };
  try {
    await timed('cadGenerateExport', 'mechanical', 'Building actual STEP solids and their GLB preview in the mechanical worker.', build);
  } catch (error) {
    // One real model repair, never a substitute fixture or canned fallback geometry.
    await writeFile(`${local}/product-attempt-1.py`, mechanical.source);
    const failure = clean(error);
    mechanical = await timed('mechanicalRepair', 'mechanical', 'Mechanical agent is repairing its CAD source from the actual worker error.', async () => {
      const response = await client.responses.parse({ model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 4000,
        instructions: 'Repair this first-pass build123d0.11.1 CAD source using the actual error, original brief, measured PCB contract and selected product image. Return complete source defining gen_step(), same design intent, valid closed solids, named parameters, labels and colors. Simplify failing kernel operations while preserving the selected silhouette. No fallback fixture or stock tray. Allowed imports only build123d,math,json,pathlib,cadpy.assembly; no exports, network, os, subprocess, eval, exec, private attributes or filesystem writes. Path can only read pcb-geometry.json next to __file__. Return complete concise source under2000 tokens and explicit assumptions; do not claim functional electronics or validated component fit.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: `${prompt}\n\nFailed source:\n${mechanical.source}\n\nActual worker error:\n${failure}` },
          { type: 'input_image', image_url: imageUrl, detail: 'high' }] }],
        text: { format: zodTextFormat(MechanicalPlan, 'mechanical_cad_repair') } }, { timeout: 75_000 });
      if (!response.output_parsed) throw new Error('CAD repair returned no structured source');
      report.mechanicalRepair = { responseId: response.id, usage: response.usage, cause: failure };
      return MechanicalPlan.parse(response.output_parsed);
    });
    await writeFile(`${local}/mechanical-plan.json`, JSON.stringify(mechanical, null, 2) + '\n');
    await writeFile(`${local}/product.py`, mechanical.source + '\n');
    await mechanicalWorker.fs.uploadFile(await readFile(`${local}/product.py`), `${remote}/product.py`);
    await timed('cadRepairExport', 'mechanical', 'Rebuilding the repaired CAD source in the mechanical worker.', build);
  }
  const validation = JSON.parse(await timed('independentStepValidation', 'validation', 'Independent validator is reopening the exported STEP and measuring its real geometry.', () => command(mechanicalWorker,
    `timeout 110s env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 ${python} ${remote}/validate-step.py ${remote}`, 120)));
  for (const name of ['product.step', 'product.glb', 'geometry-check.json']) await writeFile(`${local}/${name}`, await mechanicalWorker.fs.downloadFile(`${remote}/${name}`));
  if (createHash('sha256').update(await readFile(`${local}/product.step`)).digest('hex') !== validation.stepSha256) throw new Error('Downloaded STEP hash mismatch');
  if ((await stat(`${local}/product.glb`)).size < 100) throw new Error('Empty GLB preview');
  report.geometry = validation;
  report.design = { label: mechanical.label, designIntent: mechanical.designIntent, assumptions: mechanical.assumptions, expectedBBoxMm: mechanical.expectedBBoxMm };
  report.previews = await timed('desktopPreviews', 'preview', 'Opening the actual saved board and generated enclosure in the live desktops.', () => Promise.all([
    { sandbox: electricalWorker, role: 'electrical' }, { sandbox: mechanicalWorker, role: 'mechanical' },
  ].map(async ({ sandbox, role }) => {
    await sandbox.computerUse.start();
    await command(sandbox, `/usr/bin/python3 ${remote}/reset-workspace.py ${role} ${remote} --close-blank`, 15);
    await sandbox.fs.uploadFile(await readFile('scripts/design/open-artifact.py'), `${remote}/open-artifact.py`);
    const previewEnvironment = role === 'mechanical' ? `env TMPDIR=${remote}/freecad-tmp XDG_CACHE_HOME=${remote}/freecad-cache ` : '';
    const launch = JSON.parse(await command(sandbox, `${previewEnvironment}/usr/bin/python3 ${remote}/open-artifact.py ${role} ${remote}`, 35)) as { expectedTitle: string; artifact: string; documentWindow?: unknown };
    await setTimeout(role === 'electrical' ? 5000 : 1500);
    if (role === 'electrical') await sandbox.computerUse.keyboard.hotkey('Home');
    await setTimeout(300);
    const shot = await sandbox.computerUse.screenshot.takeFullScreen();
    if (!shot.screenshot) throw new Error('Empty design desktop screenshot');
    const screenshot = `${local}/moki-${role}.png`;
    await writeFile(screenshot, Buffer.from(shot.screenshot, 'base64'));
    return { role, artifact: launch.artifact, screenshot, documentWindow: launch.documentWindow };
  })));
  report.ok = true;
  event('preview', 'passed', 'The actual first-pass CAD geometry is ready for preview.');
  event('validation', 'blocked', 'Geometry checks passed. Functional electronics, component envelopes and assembly fit remain unverified.');
}
try { await main(); }
catch (error) {
  report.error = clean(error);
  event(activeStage, 'failed', clean(error));
  process.exitCode = 1;
}
await mkdir(local, { recursive: true });
await writeFile(`${local}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
