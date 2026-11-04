import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, copyFile, rename, rm, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, delimiter, isAbsolute } from 'node:path';
import { compileFirmware, firmwareProject } from '../firmware/index.js';
import type { CircuitDesign } from '../circuit/model.js';
import type { BoardStage } from './model.js';
import { runWorker } from './process.js';

async function installationIdentity() {
  const core = resolve(process.env.PLATFORMIO_CORE_DIR ?? '/home/sogo/.local/share/moki-tools/platformio-core');
  const packages = resolve(process.env.PLATFORMIO_PACKAGES_DIR ?? join(core, 'packages'));
  const hash = createHash('sha256').update(JSON.stringify({ core, packages }));
  for (const root of [join(core, 'platforms'), packages]) {
    const names = await readdir(root).catch(() => []);
    for (const name of names.sort()) {
      const dir = join(root, name); hash.update(await realpath(dir).catch(() => dir));
      for (const file of ['platform.json', 'package.json', '.piopm']) {
        hash.update(file); hash.update(await readFile(join(dir, file)).catch(() => Buffer.from('missing')));
      }
    }
  }
  return hash.digest('hex');
}

async function compilerPath(jobDir: string, supplied?: string): Promise<string> {
  const preferred = supplied ?? process.env.MOKI_PLATFORMIO;
  if (preferred) return isAbsolute(preferred) ? preferred : preferred.includes('/') ? resolve(jobDir, preferred) : executable(preferred);
  const installed = '/home/sogo/.local/share/moki-tools/platformio-venv/bin/pio';
  return await access(installed, constants.X_OK).then(() => installed, () => executable('pio'));
}
async function executable(name: string): Promise<string> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const file = resolve(dir, name);
    if (await access(file, constants.X_OK).then(() => true, () => false)) return file;
  }
  return name; // compileFirmware records a truthful skipped result for a missing tool.
}

/** Cache a successful native compile for identical generated sources/configuration and
 * compiler identity. Placement changes do not recompile; behavior or pin changes do. */
export async function compileWithCache(design: CircuitDesign, jobDir: string, cacheRoot: string,
  options: { bypassCache?: boolean; platformioPath?: string } = {}): Promise<BoardStage> {
  const started = performance.now(), command = await compilerPath(jobDir, options.platformioPath);
  let key: string | undefined, compilerVersion = '';
  try {
    const probe = await runWorker(command, ['--version'], jobDir, 10_000);
    if (probe.code !== 0) throw new Error('Compiler version unavailable');
    compilerVersion = (probe.stdout + probe.stderr).trim();
    const hash = createHash('sha256').update('moki-firmware-verification/1\n').update(JSON.stringify(firmwareProject(design)))
      .update(`${process.platform}/${process.arch}\n${command}\n${compilerVersion}`).update(await installationIdentity());
    for (const file of ['../firmware/index.ts', '../firmware/programs.ts', '../firmware/zip.ts']) hash.update(await readFile(new URL(file, import.meta.url)));
    hash.update(await readFile(command));
    key = hash.digest('hex');
  } catch { /* A missing/unidentifiable compiler cannot borrow an earlier success. */ }
  const directory = key ? resolve(cacheRoot, key) : undefined;
  if (directory && !options.bypassCache) {
    try {
      const saved = JSON.parse(await readFile(join(directory, 'firmware-build.json'), 'utf8'));
      const identity = JSON.parse(await readFile(join(directory, 'firmware-verification.json'), 'utf8'));
      if (identity.key !== key || saved.status !== 'done' || saved.compiled !== true || saved.exitCode !== 0 || saved.toolVersions?.platformio !== compilerVersion) throw new Error('No matching verified compile');
      const ms = performance.now() - started;
      const note = 'Reused a verified compilation of identical generated firmware and compiler; no physical flash.';
      await writeFile(join(jobDir, 'firmware-build.json'), JSON.stringify({ ...saved, ms, note, cache: 'hit', verificationKey: key, verifiedAt: identity.verifiedAt }, null, 2));
      await copyFile(join(directory, 'firmware-compile.log'), join(jobDir, 'firmware-compile.log'));
      return { name: 'firmware-compile', status: 'done', ms, note };
    } catch { /* Invalid, partial, failed or stale cache entries are ordinary misses. */ }
  }
  const stage = await compileFirmware(jobDir, { platformioPath: command });
  if (directory && stage.status === 'done') {
    const temporary = `${directory}.${randomUUID()}.tmp`;
    try {
      await mkdir(temporary, { recursive: true });
      for (const file of ['firmware-build.json', 'firmware-compile.log']) await copyFile(join(jobDir, file), join(temporary, file));
      await writeFile(join(temporary, 'firmware-verification.json'), JSON.stringify({ key, verifiedAt: new Date().toISOString() }));
      await rename(temporary, directory);
    } catch { /* Cache storage failure only costs another compile; never changes its result. */ }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return stage;
}
