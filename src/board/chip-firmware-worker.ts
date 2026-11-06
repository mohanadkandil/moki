import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { chipProject } from '../agents/firmware-project.js';
import { compileFirmware } from '../firmware/index.js';
import { projectZip } from '../firmware/zip.js';
import { pinMap } from '../blocks/library.js';
import type { BoardPlan } from '../blocks/contract.js';
const dir = resolve(process.argv[2]!),
  plan: BoardPlan = JSON.parse(await readFile(resolve(dir, 'plan.json'), 'utf8'));
if (!plan.app?.source)
  throw new Error('Chip-level firmware requires an application source written against the plan pin map');
const started = performance.now(),
  map = pinMap(plan),
  project = chipProject(plan.title, map, plan.app.source);
for (const [name, body] of Object.entries(project)) {
  const p = resolve(dir, 'firmware', name);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body);
}
await writeFile(resolve(dir, 'firmware.zip'), projectZip(project));
const generated = { name: 'firmware', status: 'done', ms: performance.now() - started };
const compiled = await compileFirmware(dir, { platformioPath: resolve('src/agents/pio-sandbox.sh') });
// The carrier compiler's legacy metadata names its fixed ESP32 target. Chip
// projects carry an explicit MCU target, so preserve the actual environment
// separately and report the board/platform that produced this compile.
const receiptPath = resolve(dir, 'firmware-build.json');
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
await writeFile(receiptPath, JSON.stringify({ ...receipt, environment: receipt.board,
  board: map.pio.board, platform: map.pio.platform, framework: map.pio.framework }, null, 2) + '\n');
await writeFile(
  resolve(dir, 'firmware-stage.json'),
  JSON.stringify({ stages: [generated, compiled] }, null, 2),
);
if (compiled.status !== 'done') process.exitCode = 2;
