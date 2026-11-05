import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileWithCache } from './firmware-cache.js';
import type { BoardStage } from './model.js';
const dir = resolve(process.argv[2]!);
const design = JSON.parse(await readFile(resolve(dir, 'design.json'), 'utf8'));
const firmware = await import(pathToFileURL(resolve('src/firmware/index.ts')).href);
const stages: BoardStage[] = [];
const sandbox = design.app ? { platformioPath: resolve('src/agents/pio-sandbox.sh') } : {};
let at = performance.now();
await firmware.generateFirmware(design, dir);
stages.push({ name: 'firmware', status: 'done', ms: performance.now() - at });
if (typeof firmware.compileFirmware === 'function') {
  at = performance.now();
  const result = process.argv[3] ? await compileWithCache(design, dir, resolve(process.argv[3]), { bypassCache: process.argv.includes('--bypass-cache'), ...sandbox }) : await firmware.compileFirmware(dir, sandbox);
  stages.push({ name: 'firmware-compile', status: result.status ?? 'skipped', ms: performance.now() - at, note: result.note ?? result.reason });
} else stages.push({ name: 'firmware-compile', status: 'skipped', ms: 0, note: 'Compiler adapter not installed' });
await writeFile(resolve(dir, 'firmware-stage.json'), JSON.stringify({ stages }, null, 2));
