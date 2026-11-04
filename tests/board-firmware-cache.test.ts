import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDesign } from '../src/circuit/templates.js';
import { generateFirmware } from '../src/firmware/index.js';
import { compileWithCache } from '../src/board/firmware-cache.js';

test('layout-only jobs reuse verified firmware; source changes, bypass and failed compiles do not', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moki-firmware-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const countFile = join(root, 'count'), compiler = join(root, 'pio'), cache = join(root, 'cache');
  const fake = (version = 'test-pio 1', code = 0) => `#!/usr/bin/env node\nconst fs=require('node:fs'); if(process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); } else { const f=${JSON.stringify(countFile)}; let n=0;try{n=Number(fs.readFileSync(f,'utf8'))}catch{}fs.writeFileSync(f,String(n+1)); console.log('Flash: [=] 1% (used 100 bytes from 10000 bytes)'); process.exitCode=${code}; }\n`;
  await writeFile(compiler, fake(), { mode: 0o755 });
  let number = 0;
  const run = async (minutes: number, bypassCache = false) => {
    const dir = join(root, `job-${++number}`); await mkdir(dir);
    const design = buildDesign({ template: 'focus-timer', chosenBy: 'user', recognized: [], notes: [], options: { buzzer: true, display: true, sensor: 'ds18b20', focusMinutes: minutes, pins: {} } });
    await generateFirmware(design, dir);
    const stage = await compileWithCache(design, dir, cache, { platformioPath: compiler, bypassCache });
    return { stage, build: JSON.parse(await readFile(join(dir, 'firmware-build.json'), 'utf8')) };
  };
  assert.equal((await run(25)).stage.status, 'done');
  const same = await run(25); assert.equal(same.build.cache, 'hit'); assert.equal(same.build.compiled, true);
  assert.equal(await readFile(countFile, 'utf8'), '1');
  assert.equal((await run(45)).stage.status, 'done'); assert.equal(await readFile(countFile, 'utf8'), '2');
  await run(25, true); assert.equal(await readFile(countFile, 'utf8'), '3');
  const oldCore = process.env.PLATFORMIO_CORE_DIR, oldPackages = process.env.PLATFORMIO_PACKAGES_DIR;
  try {
    process.env.PLATFORMIO_CORE_DIR = join(root, 'other-core');
    process.env.PLATFORMIO_PACKAGES_DIR = join(root, 'other-packages');
    await run(25); assert.equal(await readFile(countFile, 'utf8'), '4', 'A different compiler installation cannot borrow verification');
    await mkdir(join(root, 'other-packages/toolchain'), { recursive: true });
    await writeFile(join(root, 'other-packages/toolchain/package.json'), '{"version":"changed"}');
    await run(25); assert.equal(await readFile(countFile, 'utf8'), '5', 'Installed package identity participates in verification');
  } finally {
    if (oldCore === undefined) delete process.env.PLATFORMIO_CORE_DIR; else process.env.PLATFORMIO_CORE_DIR = oldCore;
    if (oldPackages === undefined) delete process.env.PLATFORMIO_PACKAGES_DIR; else process.env.PLATFORMIO_PACKAGES_DIR = oldPackages;
  }
  await writeFile(compiler, fake('test-pio 2', 1));
  assert.equal((await run(25)).stage.status, 'failed'); assert.equal((await run(25)).stage.status, 'failed');
  assert.equal(await readFile(countFile, 'utf8'), '7');
});
