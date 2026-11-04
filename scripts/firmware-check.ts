import { mkdir, readFile, rm, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateFirmware, compileFirmware } from '../src/firmware/index.js';
import { buildDesign } from '../src/circuit/templates.js';
import type { Interpretation, TemplateId } from '../src/circuit/model.js';

const output = resolve(process.argv[2] ?? 'docs/engineering/2026-11-04-tscircuit/evidence/eng_fw');
await mkdir(output, { recursive: true });
const results = [];
for (const [name, template, sensor] of [
  ['focus-timer', 'focus-timer', 'ds18b20'],
  ['light-lamp', 'light-lamp', 'ds18b20'],
  ['temp-monitor', 'temp-monitor', 'ds18b20'],
  ['temp-monitor-bme280', 'temp-monitor', 'bme280'],
] as const) {
  const interpretation: Interpretation = { template: template as TemplateId, chosenBy: 'user', recognized: [], notes: [], options: { buzzer: template !== 'light-lamp', display: template !== 'light-lamp', sensor, pins: {}, focusMinutes: 25, darkPercent: 30, alertC: 28, alertDirection: 'above' } };
  const jobDir = join(output, name);
  await mkdir(jobDir, { recursive: true });
  const design = buildDesign(interpretation);
  await writeFile(join(jobDir, 'design.json'), JSON.stringify(design, null, 2) + '\n');
  const generated = await generateFirmware(design, jobDir);
  console.log(`${name}: generated in ${generated.stage.ms} ms; compiling (first run)`);
  const initial = await compileFirmware(jobDir, { timeoutMs: 600000 });
  await copyFile(join(jobDir, 'firmware-build.json'), join(jobDir, 'first-build.json'));
  await copyFile(join(jobDir, 'firmware-compile.log'), join(jobDir, 'first-compile.log'));
  console.log(`${name}: first compile ${initial.status} in ${initial.ms} ms`);
  // A clean build with downloaded tools/libraries retained, not an incremental no-op.
  await rm(join(jobDir, 'firmware', '.pio', 'build'), { recursive: true, force: true });
  const warm = await compileFirmware(jobDir, { timeoutMs: 180000 });
  const receipt = JSON.parse(await readFile(join(jobDir, 'firmware-build.json'), 'utf8'));
  results.push({ template: name, generation: generated.stage, firstCompile: initial, warmCompile: warm, flash: receipt.flash, ram: receipt.ram, toolVersions: receipt.toolVersions });
  await writeFile(join(output, 'compile-summary.json'), JSON.stringify({ measuredAt: new Date().toISOString(), host: `${process.platform}-${process.arch}`, method: 'Sequential: first project provisions tools, following first builds reuse tool downloads. Warm = remove .pio/build, retain toolchains/library cache, rebuild all translation units; -j 2. Generation ms includes deterministic zip.', physicalFlash: false, results }, null, 2) + '\n');
  console.log(`${name}: warm compile ${warm.status} in ${warm.ms} ms`);
}
if (results.some(r => r.firstCompile.status === 'failed' || r.warmCompile.status === 'failed')) process.exitCode = 1;
