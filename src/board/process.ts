import { spawn } from 'node:child_process';

// Intentionally exact names: a PLATFORMIO_* or BUN_* wildcard could carry credentials.
const ENVIRONMENT_KEYS = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'BUN_INSTALL',
  'BUN_RUNTIME_TRANSPILER_CACHE_PATH', 'PLATFORMIO_CORE_DIR', 'PLATFORMIO_PACKAGES_DIR',
  'PLATFORMIO_BUILD_CACHE_DIR', 'PLATFORMIO_SETTING_ENABLE_TELEMETRY', 'NO_COLOR',
  'MOKI_BUN', 'MOKI_BUILD123D_PYTHON', 'MOKI_ENCLOSURE_PYTHON', 'MOKI_PLATFORMIO',
  'MOKI_MECH_CACHE_DIR', 'MOKI_BLOCK_LIBRARY_DIR', 'MOKI_BLOCK_PARTS_DIR',
  'MOKI_SCHEMATIC_REVIEWS_DIR', 'NODE_PATH'] as const;

export function workerEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = overrides[key] ?? process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface WorkerResult { code: number; stdout: string; stderr: string }
/** A process group bounds normal descendants. An escaped session needs an OS sandbox.
 * Settle on timeout/abort independently of close: escaped children may retain the pipes. */
export function runWorker(command: string, args: string[], cwd: string, timeoutMs: number,
  environment: NodeJS.ProcessEnv = {}, signal?: AbortSignal): Promise<WorkerResult> {
  return new Promise((yes, no) => {
    signal?.throwIfAborted();
    // Nested compilers stay in the outer worker group, so closing the service also
    // kills them. A direct compile invocation still owns its own group.
    const detached = process.platform !== 'win32' && process.env.MOKI_WORKER_IN_GROUP !== '1';
    const child = spawn(command, args, { cwd, detached,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...workerEnvironment(environment), MOKI_WORKER_IN_GROUP: '1' } });
    let stdout = '', stderr = '', settled = false;
    const kill = () => { try { if (child.pid && detached) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const stop = (error: Error) => {
      if (settled) return;
      settled = true; kill(); child.stdout.destroy(); child.stderr.destroy(); cleanup(); no(error);
    };
    const abort = () => stop(new Error('Worker stopped because the board service closed; process group killed'));
    const timer = setTimeout(() => stop(new Error(`Worker timed out after ${timeoutMs} ms; process group killed; escaped sessions require a sandbox`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (data: Buffer) => { stdout = (stdout + data.toString()).slice(-1_000_000); });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-1_000_000); });
    child.once('error', error => { if (!settled) { settled = true; cleanup(); no(error); } });
    child.once('close', code => { if (!settled) { settled = true; cleanup(); kill(); yes({ code: code ?? 1, stdout, stderr }); } });
  });
}
