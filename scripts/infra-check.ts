import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import type { Sandbox } from '@daytona/sdk';
import { createSetupDaytonaClient, safeError } from './lib/daytona-client.js';
import { PCBGeometry, acceptsValidation, type ArtifactRef } from '../src/contracts/artifacts.js';

const runId = process.env.MOKI_RUN_ID || 'infrastructure';
if (!/^[a-zA-Z0-9-]{1,60}$/.test(runId)) throw new Error('Invalid run id');
const root = `/home/daytona/moki/checks/${runId}`;
const local = process.env.MOKI_RUN_ID ? `var/runs/${runId}` : 'var/checks/infrastructure';
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), ok: false, timingsMs: {} };
const timings = report.timingsMs as Record<string, number>;
const stages: Record<string, string> = {
  workersReady: 'workers', kicadGenerateMeasure: 'electrical',
  electricalMechanicalHandoff: 'handoff', cadGenerateExport: 'mechanical',
  independentStepValidation: 'validation',
  desktopPreviews: 'preview',
};
function event(stage: string, state: string, message: string) {
  console.log('MOKI_EVENT ' + JSON.stringify({ stage, state, message, at: new Date().toISOString() }));
}
async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const stage = stages[name];
  if (stage) event(stage, 'running', name);
  try {
    const value = await run();
    if (stage) event(stage, 'passed', name);
    return value;
  } catch (error) {
    if (stage) event(stage, 'failed', safeError(error));
    throw error;
  } finally { timings[name] = Math.round(performance.now() - start); }
}
async function command(sandbox: Sandbox, text: string, timeout = 60) {
  const result = await sandbox.process.executeCommand(text, undefined, undefined, timeout);
  if (result.exitCode !== 0) throw new Error(`Fixture command failed (${result.exitCode}): ${result.result.slice(-1800)}`);
  return result.result;
}
async function main() {
  await mkdir(local, { recursive: true });
  const daytona = await createSetupDaytonaClient(process.argv.includes('--use-cli-profile'));
  const [electrical, mechanical] = await Promise.all(['moki-electrical', 'moki-mechanical'].map(name => daytona.get(name)));
  await timed('workersReady', () => Promise.all([electrical!, mechanical!].map(async sandbox => {
    await sandbox.refreshData();
    if (sandbox.state !== 'started') await sandbox.start(180);
    await sandbox.waitUntilStarted(180);
    await command(sandbox, `mkdir -p ${root}`);
  })));
  await electrical!.fs.uploadFile(await readFile('scripts/fixtures/board.py'), `${root}/board.py`);
  report.electrical = JSON.parse(await timed('kicadGenerateMeasure', () => command(electrical!, `/usr/bin/python3 ${root}/board.py ${root}`)));
  const contractBytes = await electrical!.fs.downloadFile(`${root}/pcb-geometry.json`);
  const board = await electrical!.fs.downloadFile(`${root}/fixture.kicad_pcb`);
  const geometry = PCBGeometry.parse(JSON.parse(contractBytes.toString()));
  if (createHash('sha256').update(board).digest('hex') !== geometry.artifact.sha256) throw new Error('Published board hash mismatch');
  await writeFile(`${local}/fixture.kicad_pcb`, board);
  await writeFile(`${local}/pcb-geometry.json`, contractBytes);
  console.log(`Electrical: saved/measured ${geometry.width} × ${geometry.height} mm board, ${geometry.holes.length} holes.`);

  // The existing installed skill is runtime truth. Ship code, never its venv or secrets.
  const skill = resolve(process.env.MOKI_CAD_SKILL || `${homedir()}/.agents/skills/cad`);
  const archive = resolve(`${local}/cad-runtime.tar.gz`);
  await promisify(execFile)('tar', ['-czf', archive, '--exclude=__pycache__', '-C', skill,
    'scripts/step', 'scripts/packages/cadpy/src']);
  await mechanical!.fs.uploadFile(archive, `${root}/cad-runtime.tar.gz`);
  await command(mechanical!, `tar -xzf ${root}/cad-runtime.tar.gz -C ${root}`);
  await timed('electricalMechanicalHandoff', async () => {
    await mechanical!.fs.uploadFile(contractBytes, `${root}/pcb-geometry.json`);
    const received = await mechanical!.fs.downloadFile(`${root}/pcb-geometry.json`);
    if (!received.equals(contractBytes)) throw new Error('Cross-worker geometry transfer mismatch');
  });
  for (const name of ['tray.py', 'validate-tray.py']) await mechanical!.fs.uploadFile(await readFile(`scripts/fixtures/${name}`), `${root}/${name}`);
  // Isolate the installed skill's OCP 7 runtime from the newer build123d/OCP 8 desktop.
  const python = '/home/daytona/moki/.cad-skill-venv/bin/python';
  const runtime = `PYTHONPATH=${root}/scripts/packages/cadpy/src ${python} ${root}/scripts/step`;
  console.log('Mechanical: generating STEP + GLB with the installed CAD skill runtime…');
  await timed('cadGenerateExport', () => command(mechanical!, `${runtime} ${root}/tray.py --glb tray.glb --force`, 120));
  report.fit = JSON.parse(await timed('independentStepValidation', () => command(mechanical!, `${python} ${root}/validate-tray.py ${root}`)));
  for (const name of ['tray.step', 'tray.glb', 'fit-report.json']) await writeFile(`${local}/${name}`, await mechanical!.fs.downloadFile(`${root}/${name}`));
  const fit = report.fit as { stepSha256: string };
  const step = await readFile(`${local}/tray.step`);
  if (createHash('sha256').update(step).digest('hex') !== fit.stepSha256) throw new Error('Downloaded STEP hash mismatch');
  const inputs: ArtifactRef[] = [geometry.artifact, { id: 'fixture-tray', revision: 1, sha256: fit.stepSha256, uri: `${local}/tray.step` }];
  const validation = { outcome: 'pass' as const, checker: 'fixture-step-collision-v1', inputs, evidence: [`${local}/fit-report.json`] };
  if (!acceptsValidation(validation, inputs)) throw new Error('Fresh validation rejected');
  if (acceptsValidation(validation, [{ ...inputs[0]!, revision: 2 }, inputs[1]!])) throw new Error('Stale validation accepted');
  report.handoff = { ok: true, boardSha256: geometry.artifact.sha256, geometryTransferVerified: true, staleRevisionRejected: true };
  // Show the actual generated files. This is deterministic app automation,
  // measured separately from model latency and never labeled AI computer use.
  report.previews = await timed('desktopPreviews', () => Promise.all([
    { sandbox: mechanical!, role: 'mechanical' },
    { sandbox: electrical!, role: 'electrical' },
  ].map(async ({ sandbox, role }) => {
    await sandbox.computerUse.start();
    await sandbox.fs.uploadFile(await readFile('scripts/fixtures/open-artifact.py'), `${root}/open-artifact.py`);
    const launch = JSON.parse(await command(sandbox, `/usr/bin/python3 ${root}/open-artifact.py ${role} ${root}`, 30)) as { expectedTitle: string; artifact: string };
    const deadline = Date.now() + 10_000;
    let windows = await sandbox.computerUse.display.getWindows();
    while (!windows.windows?.some(window => window.title?.includes(launch.expectedTitle)) && Date.now() < deadline) {
      await setTimeout(500);
      windows = await sandbox.computerUse.display.getWindows();
    }
    const visible = windows.windows?.some(window => window.title?.includes(launch.expectedTitle));
    // KiCad publishes a document title before its first canvas finishes loading.
    // Keep a bounded paint budget rather than capturing the blank intermediate frame.
    if (visible) await setTimeout(role === 'electrical' ? 5000 : 1500);
    if (visible && role === 'electrical') await sandbox.computerUse.keyboard.hotkey('Home');
    if (visible) await setTimeout(300);
    // Save failure evidence too, so an unexpected first-run dialog is inspectable.
    const screenshot = `${local}/${sandbox.name}.png`;
    await timed(`${sandbox.name}Screenshot`, async () => {
      const shot = await sandbox.computerUse.screenshot.takeFullScreen();
      if (!shot.screenshot) throw new Error('Empty desktop screenshot');
      await writeFile(screenshot, Buffer.from(shot.screenshot, 'base64'));
    });
    if (!visible) throw new Error(`${sandbox.name}: generated artifact window did not appear; inspect ${screenshot} and remote preview.log`);
    return { role, artifact: launch.artifact, screenshot, windows: windows.windows?.map(window => window.title) };
  })));
  report.ok = true;
  report.release = { outcome: 'blocked', reason: 'Fixture has no circuit, firmware or component envelopes. No manufacturing approval.' };
}
try { await main(); }
catch (error) { report.error = safeError(error); process.exitCode = 1; }
await mkdir(local, { recursive: true });
await writeFile(`${local}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
