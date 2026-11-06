import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { hasMcu } from '../src/agents/no-code.js';
import { runWorker } from '../src/board/process.js';
import { readFile, writeFile, mkdir, rename, readdir, realpath, access, rm, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { CircuitDesign } from '../src/circuit/model.js';
import { contentId } from '../src/circuit/graph.js';
import {
  parseMakerEdits,
  layoutFromCircuit,
  layoutForDesign,
  applyMakerEdits,
  type BoardLayout,
} from '../src/board/edits.js';
import { generateBoardSource } from '../src/board/codegen.js';
import type {
  BoardJob,
  BoardStage,
  BoardReceipt,
  BoardArtifact,
  BoardSubmission,
} from '../src/board/model.js';
import { checkPlan, resolvePlanBlocks } from '../src/blocks/library.js';
import { runSpiceChecks } from '../src/blocks/spice.js';
import { evaluateRequirements, factsFromPlan } from '../src/blocks/verify.js';
import { checkSchematicReview, schematicHash } from '../src/blocks/review.js';
import { MAX_DRAFT_OPS, parseOps } from '../src/agents/edits.js';
import { checkOps, libraryListing, type OpsBase } from './board-ops.js';
import type { BoardPlan, GateResult } from '../src/blocks/contract.js';
import { inspectBlockPadGeometry } from '../src/blocks/test-block.js';

/** The gallery's picture of a build. Named apart from the build's files: not a download, not part of a receipt, and never edits job.json. */
export const BOARD_THUMBNAIL = 'thumb.png';
export const BOARD_ARTIFACT_NAMES = [
  'board.tsx',
  'circuit.json',
  'schematic.svg',
  'pcb.svg',
  'board.glb',
  'gerbers.zip',
  'kicad.zip',
  'bom.csv',
  'pnp.csv',
  'enclosure-base.stl',
  'enclosure-lid.stl',
  'assembly.glb',
  'enclosure.json',
  'enclosure.step',
  'firmware.zip',
  'firmware-build.json',
  'receipt.json',
  'mech-handoff.json',
  'layout.json',
  'manual-edits.json',
  'design.json',
  'plan.json',
  'plan-graph.json',
  'gates.json',
  'spice.json',
  'verification.json',
  'schematic-circuit.json',
  'import-map.json',
  'sensor-copper-check.json',
  'netlist-check.json',
  'placement.json',
  'placement-check.json',
  'fanout-check.json',
  'fanout-phase.json',
  'native-async-errors.json',
  'native-routing.json',
  'ground-copper-check.json',
  'routing-plan.json',
  'breakout-check.json',
] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface AppliedOps { ops: unknown[]; changes: string[] }

export function runBoardProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
  environment: NodeJS.ProcessEnv = {},
  signal?: AbortSignal,
) {
  return runWorker(
    command,
    args,
    cwd,
    timeoutMs,
    { ...environment, NODE_PATH: resolve(cwd, 'eda/node_modules') },
    signal,
  );
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    text: string,
  ) {
    super(text);
  }
}
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Exclusive root ownership, including two services in the same Vite process. */
function claimRoot(jobsRoot: string) {
  mkdirSync(jobsRoot, { recursive: true });
  const file = resolve(jobsRoot, '.queue.lock');
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try {
        writeFileSync(fd, owner);
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (readFileSync(file, 'utf8') === owner) unlinkSync(file);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Only one process may inspect and remove a stale owner. Without this guard,
      // two takers can read the dead PID and the second can unlink the first's new lock.
      const recovery = resolve(jobsRoot, '.queue-recovery.lock');
      let recoveryFd: number;
      try {
        recoveryFd = openSync(recovery, 'wx', 0o600);
      } catch {
        throw new ApiError(503, 'Board queue lock recovery is busy; inspect its owner before retrying');
      }
      try {
        writeFileSync(recoveryFd, owner);
        let pid: number;
        try {
          pid = JSON.parse(readFileSync(file, 'utf8')).pid;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw new ApiError(503, 'Board queue lock is unreadable; inspect it before restarting');
        }
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new ApiError(503, 'Invalid board queue lock');
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            unlinkSync(file);
            continue;
          }
        }
        throw new ApiError(503, 'Another board service owns this job root');
      } finally {
        closeSync(recoveryFd);
        unlinkSync(recovery);
      }
    }
  }
  throw new ApiError(503, 'Could not claim board job root');
}

export interface BoardMaintenanceOptions {
  mechCacheRoot: string;
  testRootsParent: string;
}
// Explicitly enabled by the app plugin. Isolated service/test queues need not maintain shared data.
export const BOARD_SHARED_MAINTENANCE: BoardMaintenanceOptions = {
  mechCacheRoot: 'var/mech-cache',
  testRootsParent: 'var',
};
export interface BoardServiceOptions {
  root?: string;
  jobsRoot?: string;
  bun?: string;
  timeoutMs?: number;
  /** Chip-level native builds; defaults to MOKI_CHIP_TIMEOUT_MS or 10 minutes. */
  chipTimeoutMs?: number;
  maintenance?: BoardMaintenanceOptions;
  allowSource?: boolean;
}
export function createBoardService(options: BoardServiceOptions = {}) {
  const root = resolve(options.root ?? process.cwd());
  const jobsRoot = resolve(
    options.jobsRoot ??
      (process.env.MOKI_BOARD_JOBS_DIR
        ? resolve(root, process.env.MOKI_BOARD_JOBS_DIR)
        : resolve(root, 'var/board-jobs')),
  );
  const bun = options.bun ?? process.env.MOKI_BUN ?? resolve(homedir(), '.bun/bin/bun');
  // Native render/CAD work can exceed two minutes under shared-host memory pressure.
  // Keep it bounded and retain the explicit short timeout used by failure tests.
  const jobWorkerTimeoutMs = options.timeoutMs ?? 240_000;
  // Chip boards route natively: the live RP2040 motor plan measured 362.6 s of routing alone (job 3eb2b76f).
  const chipWorkerTimeoutMs = options.chipTimeoutMs ?? options.timeoutMs ?? Number(process.env.MOKI_CHIP_TIMEOUT_MS ?? 600_000);
  const jobs = new Map<string, BoardJob>();
  let queue: Promise<void> = Promise.resolve();
  let queued = 0,
    closed = false;
  const submissions = new Set<Promise<void>>();
  const controller = new AbortController();
  const tokenHash = process.env.MOKI_BOARD_API_TOKEN
    ? createHash('sha256').update(process.env.MOKI_BOARD_API_TOKEN).digest()
    : undefined;
  let release: (() => void) | undefined;
  let initialization: Promise<void> | undefined;
  async function evict() {
    const roots = [jobsRoot, resolve(jobsRoot, '_cache')];
    // Each service cleans its own root. The production service also reaps old test runs
    // and the shared mechanical cache; never touch an actively locked test root.
    if (options.maintenance) {
      roots.push(resolve(root, options.maintenance.mechCacheRoot));
      const testRootsParent = resolve(root, options.maintenance.testRootsParent);
      for (const name of await readdir(testRootsParent).catch(() => [])) {
        if (/^board-jobs-test(?:-|$)/.test(name)) {
          const candidate = resolve(testRootsParent, name);
          if (!(await exists(resolve(candidate, '.queue.lock')))) {
            const info = await stat(candidate).catch(() => null);
            if (!info?.isDirectory()) continue;
            if (Date.now() - info.mtimeMs > MAX_AGE_MS) await rm(candidate, { recursive: true, force: true });
            else roots.push(candidate, resolve(candidate, '_cache'));
          }
        }
      }
    }
    for (const parent of roots)
      for (const name of await readdir(parent).catch(() => [])) {
        if (!uuid.test(name) && !/^[a-f0-9]{64}$/.test(name)) continue;
        if (jobs.has(name) && ['running', 'queued'].includes(jobs.get(name)!.status)) continue;
        const dir = resolve(parent, name);
        const age = await stat(resolve(dir, 'job.json'))
          .catch(() => stat(dir))
          .catch(() => null);
        if (age && Date.now() - age.mtimeMs > MAX_AGE_MS) {
          await rm(dir, { recursive: true, force: true });
          jobs.delete(name);
        }
      }
  }
  function ready() {
    if (closed) throw new ApiError(503, 'Board service is closed');
    if (!release) release = claimRoot(jobsRoot);
    return (initialization ??= evict());
  }
  const worker = (
    command: string,
    args: string[],
    cwd: string,
    timeoutMs = 120_000,
    env: NodeJS.ProcessEnv = {},
  ) => runBoardProcess(command, args, cwd, timeoutMs, env, controller.signal);
  let drawn: Promise<unknown> = Promise.resolve();
  const drawing = new Map<string, Promise<boolean>>();
  /**
   * Draws a finished build's picture, one at a time and in its own process, since it's a few seconds of solid arithmetic.
   * A build calls this as it ends. A build from before thumbnails existed gets its picture the first time one is asked for.
   */
  function thumbnail(job: BoardJob): Promise<boolean> {
    const known = drawing.get(job.jobId);
    if (known) return known;
    const dir = directory(job.jobId);
    const next = drawn
      .then(async () => {
        if (await exists(resolve(dir, BOARD_THUMBNAIL))) return true;
        // A model that wouldn't draw once won't draw next time, so its log stops it being tried on every visit.
        if (job.status !== 'done' || closed || (await exists(resolve(dir, 'thumb.log')))) return false;
        if (!(await exists(resolve(dir, 'assembly.glb'))) && !(await exists(resolve(dir, 'board.glb')))) return false;
        const out = await worker(bun, [resolve(root, 'server/thumbnail.ts'), dir], root, 60_000);
        if (out.code !== 0) await writeFile(resolve(dir, 'thumb.log'), out.stdout + out.stderr);
        return out.code === 0 && (await exists(resolve(dir, BOARD_THUMBNAIL)));
      })
      // A build is finished whether or not its picture came out, and the gallery has something else to show.
      .catch(() => false)
      .finally(() => drawing.delete(job.jobId));
    drawing.set(job.jobId, next);
    drawn = next;
    return next;
  }
  const versions = () =>
    worker(bun, [resolve(root, 'eda/versions.ts')], root).then((out) => {
      if (out.code !== 0) throw new Error(`Cannot inspect EDA tool versions: ${out.stderr}`);
      return JSON.parse(out.stdout) as Record<string, string>;
    });
  const directory = (id: string) => resolve(jobsRoot, id);
  const save = async (job: BoardJob) => {
    await mkdir(directory(job.jobId), { recursive: true });
    await writeFile(resolve(directory(job.jobId), 'job.tmp'), JSON.stringify(job, null, 2));
    await rename(resolve(directory(job.jobId), 'job.tmp'), resolve(directory(job.jobId), 'job.json'));
  };
  async function refresh(job: BoardJob) {
    for (const name of BOARD_ARTIFACT_NAMES) {
      try {
        const data = await readFile(resolve(directory(job.jobId), name));
        const ext = extname(name).slice(1);
        job.artifacts[name] = {
          url: `/api/board/jobs/${job.jobId}/files/${name}`,
          bytes: data.length,
          sha256: sha(data),
          kind: (ext === 'tsx' ? 'source' : ext) as BoardArtifact['kind'],
        };
      } catch {
        /* A skipped or failed stage has no artifact. */
      }
    }
  }
  async function load(id: string): Promise<BoardJob | null> {
    await ready();
    if (!uuid.test(id)) return null;
    if (jobs.has(id)) return jobs.get(id)!;
    try {
      const job: BoardJob = JSON.parse(await readFile(resolve(directory(id), 'job.json'), 'utf8'));
      if (jobs.has(id)) return jobs.get(id)!;
      jobs.set(id, job);
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.error = 'Server restarted before this job finished. Build again.';
        await save(job);
      }
      return job;
    } catch {
      return null;
    }
  }
  async function execute(
    job: BoardJob,
    source: string,
    design: CircuitDesign | undefined,
    bypassCache: boolean,
    layout?: BoardLayout,
  ) {
    queued--;
    const started = performance.now();
    const dir = directory(job.jobId);
    try {
      controller.signal.throwIfAborted();
      job.status = 'running';
      await save(job);
      job.toolVersions = await versions();
      // Cache only deterministic EDA artifacts. Firmware settings and enclosure code are rerun;
      // cache misses/hits cannot inherit another design's settings or stale mechanical outputs.
      const artifactKey = (versions: Record<string, string>) =>
        sha(JSON.stringify({ source, layout: layout ?? null, versions }));
      const key = artifactKey(job.toolVersions);
      let cacheDir = resolve(jobsRoot, '_cache', key);
      let cached: BoardReceipt | undefined;
      if (!bypassCache) {
        try {
          cached = JSON.parse(await readFile(resolve(cacheDir, 'receipt.json'), 'utf8'));
        } catch {}
      }
      if (cached) {
        const at = performance.now();
        for (const name of [
          'circuit.json',
          'schematic.svg',
          'pcb.svg',
          'board.glb',
          'gerbers.zip',
          'kicad.zip',
          'bom.csv',
          'pnp.csv',
          'board-metadata.json',
          'manual-edits.json',
        ]) {
          if (await exists(resolve(cacheDir, name)))
            await writeFile(resolve(dir, name), await readFile(resolve(cacheDir, name)));
        }
        job.cache = 'hit';
        job.drc = cached.drc;
        job.board = cached.board;
        job.stages.push(
          {
            name: 'render',
            status: 'done',
            ms: performance.now() - at,
            note: 'Cache hit: copied EDA artifacts',
          },
          ...cached.stages
            .filter((s) => s.name !== 'render')
            .map((s) => ({
              ...s,
              status: 'skipped' as const,
              ms: 0,
              note: 'Cache hit: reused artifact; original timing is in cache receipt',
            })),
        );
      } else {
        const out = await worker(
          bun,
          [resolve(root, 'eda/render.ts'), '--job', dir],
          root,
          jobWorkerTimeoutMs,
        );
        await writeFile(resolve(dir, 'render.log'), out.stdout + out.stderr);
        if (![0, 2].includes(out.code))
          throw new Error(`EDA render failed (exit ${out.code}): ${out.stderr.slice(-2000)}`);
        const receipt: BoardReceipt = JSON.parse(await readFile(resolve(dir, 'receipt.json'), 'utf8'));
        job.stages.push(...receipt.stages);
        job.drc = receipt.drc;
        job.board = receipt.board;
        job.toolVersions = receipt.toolVersions;
        if (out.code === 0) {
          // A tool install can finish while a queued job starts. Store against the worker's
          // snapshot rather than attributing new artifacts to the pre-spawn version probe.
          cacheDir = resolve(jobsRoot, '_cache', artifactKey(receipt.toolVersions));
          await mkdir(cacheDir, { recursive: true });
          for (const name of [
            'circuit.json',
            'schematic.svg',
            'pcb.svg',
            'board.glb',
            'gerbers.zip',
            'kicad.zip',
            'bom.csv',
            'pnp.csv',
            'board-metadata.json',
            'manual-edits.json',
            'receipt.json',
          ]) {
            if (await exists(resolve(dir, name)))
              await writeFile(resolve(cacheDir, name), await readFile(resolve(dir, name)));
          }
        }
      }
      await refresh(job);
      await save(job);
      const enclosureStarted = performance.now();
      const enclosureScript = resolve(root, 'eda/enclosure.ts');
      const pythonScript = resolve(root, 'mech/enclosure.py');
      const python =
        process.env.MOKI_BUILD123D_PYTHON ??
        process.env.MOKI_ENCLOSURE_PYTHON ??
        resolve(homedir(), '.local/share/moki-tools/build123d-venv/bin/python');
      // The Bun wrapper owns handoff → Python build123d → assembly. Invoke it once;
      // running Python again would invalidate the wrapper's assembly and repeat the model.
      const hasWrapper = await exists(enclosureScript);
      const hasDirectHandoff = await exists(resolve(dir, 'mech-handoff.json'));
      if (hasWrapper || ((await exists(pythonScript)) && hasDirectHandoff)) {
        try {
          const out = await worker(
            hasWrapper ? bun : python,
            [hasWrapper ? enclosureScript : pythonScript, '--job', dir],
            root,
            jobWorkerTimeoutMs,
            bypassCache ? { MOKI_MECH_CACHE_DIR: resolve(dir, 'mech-cache') } : {},
          );
          await writeFile(resolve(dir, 'enclosure.log'), out.stdout + out.stderr);
          if (out.code !== 0)
            throw new Error(`Enclosure failed: ${out.stderr.slice(-1000) || out.stdout.slice(-1000)}`);
          let note: string | undefined;
          try {
            note = (JSON.parse(out.stdout.trim().split('\n').at(-1)!) as { note?: string }).note;
          } catch {}
          const report = JSON.parse(await readFile(resolve(dir, 'enclosure.json'), 'utf8'));
          if (report.engine?.name && report.engine?.version)
            job.toolVersions[`enclosure:${report.engine.name}`] = report.engine.version;
          const failed = report.stages?.some(
            (s: { name: string; status: string }) => s.name === 'assembly' && s.status === 'failed',
          );
          job.stages.push({
            name: 'enclosure',
            status: failed ? 'failed' : 'done',
            ms: performance.now() - enclosureStarted,
            ...(note ? { note } : {}),
          });
        } catch (error) {
          job.stages.push({
            name: 'enclosure',
            status: 'failed',
            ms: performance.now() - enclosureStarted,
            note: message(error),
          });
        }
      } else
        job.stages.push({
          name: 'enclosure',
          status: 'skipped',
          ms: performance.now() - enclosureStarted,
          note: 'Mechanical handoff/enclosure generator is not installed',
        });
      controller.signal.throwIfAborted();
      const firmwareStarted = performance.now();
      if (design && (await exists(resolve(root, 'src/firmware/index.ts')))) {
        try {
          // Execute the trusted firmware generator in a bounded process too, so nested compiles
          // cannot block the queue indefinitely. This source contains no user supplied TSX.
          const script = resolve(root, 'src/board/firmware-worker.ts');
          const out = await worker(
            process.execPath,
            [
              resolve(root, 'node_modules/tsx/dist/cli.mjs'),
              script,
              dir,
              resolve(jobsRoot, '_cache'),
              ...(bypassCache ? ['--bypass-cache'] : []),
            ],
            root,
            (options.timeoutMs ?? 120_000) + 20_000,
          );
          await writeFile(resolve(dir, 'firmware.log'), out.stdout + out.stderr);
          if (out.code !== 0) throw new Error(`Firmware generator failed: ${out.stderr.slice(-1000)}`);
          const receipt = JSON.parse(await readFile(resolve(dir, 'firmware-stage.json'), 'utf8')) as {
            stages: BoardStage[];
          };
          job.stages.push(...receipt.stages);
          const firmwareBuild = JSON.parse(await readFile(resolve(dir, 'firmware-build.json'), 'utf8'));
          for (const [name, version] of Object.entries(firmwareBuild.toolVersions ?? {}))
            job.toolVersions[`firmware:${name}`] = String(version);
        } catch (error) {
          job.stages.push({
            name: 'firmware',
            status: 'failed',
            ms: performance.now() - firmwareStarted,
            note: message(error),
          });
        }
      } else
        job.stages.push({
          name: 'firmware',
          status: 'skipped',
          ms: performance.now() - firmwareStarted,
          note: design
            ? 'Firmware generator is not installed'
            : 'Edited TSX has no verified design graph or firmware pin map',
        });
      controller.signal.throwIfAborted();
    } catch (error) {
      job.error = message(error);
    } finally {
      job.totalMs = performance.now() - started + (job.stages.find((s) => s.name === 'codegen')?.ms ?? 0);
      const { stages, totalMs, drc, board, toolVersions } = job;
      await writeFile(
        resolve(dir, 'receipt.json'),
        JSON.stringify({ stages, totalMs, drc, board, toolVersions, cache: job.cache }, null, 2),
      );
      await rm(resolve(dir, 'firmware/.pio'), { recursive: true, force: true });
      await refresh(job);
      job.status = job.error ? 'failed' : 'done';
      await save(job);
      void thumbnail(job);
    }
  }
  async function executeChip(job: BoardJob, plan: BoardPlan) {
    queued--;
    const started = performance.now(),
      dir = directory(job.jobId);
    job.gates = [];
    const gate = async (result: GateResult, ms = 0) => {
      job.gates!.push(result);
      job.stages.push({
        name: result.gate,
        status:
          result.gate === 'verify' && result.results?.some((r) => r.status === 'unsupported')
            ? 'skipped'
            : result.ok
              ? 'done'
              : 'failed',
        ms,
        note: result.issues.map((i) => i.message).join('; '),
      });
      await writeFile(resolve(dir, 'gates.json'), JSON.stringify(job.gates, null, 2));
      await save(job);
      if (!result.ok) {
        const errors = result.issues.filter((i) => i.severity === 'error');
        throw new Error(
          `${result.gate}: ${errors
            .slice(0, 4)
            .map((i) => i.message)
            .join('; ')}${errors.length > 4 ? `; ${errors.length - 4} more issues in gates.json` : ''}`,
        );
      }
    };
    try {
      controller.signal.throwIfAborted();
      job.status = 'running';
      await save(job);
      const blocks = resolvePlanBlocks(plan);
      if (!hasMcu(plan, blocks)) job.noFirmware = true;
      for (const result of checkPlan(plan, blocks)) await gate(result);
      const first = evaluateRequirements(plan.requirements ?? [], factsFromPlan(plan, blocks));
      await gate(first);
      const at = performance.now(),
        spice = await runSpiceChecks(plan, blocks, { artifactDir: resolve(dir, 'spice') });
      await writeFile(resolve(dir, 'spice.json'), JSON.stringify(spice, null, 2));
      await gate(spice, performance.now() - at);
      const verified = evaluateRequirements(plan.requirements ?? [], factsFromPlan(plan, blocks, spice));
      await writeFile(resolve(dir, 'verification.json'), JSON.stringify(verified, null, 2));
      // Replace the provisional pre-SPICE verdict. Unsupported is visible, never a completion pass.
      job.gates = job.gates.filter((g) => g.gate !== 'verify');
      job.stages = job.stages.filter((s) => s.name !== 'verify');
      await gate(verified);
      const pending = verified.results?.filter(
        (r) =>
          r.status !== 'pass' && plan.requirements?.find((q) => q.id === r.id)?.metric !== 'board_size_mm',
      );
      if (pending?.length)
        throw new Error(
          'Confirmed requirements remain unsupported: ' +
            pending.map((r) => r.id + ': ' + r.evidence).join('; '),
        );
      await gate(checkSchematicReview(plan, blocks));
      const out = await worker(
        bun,
        [resolve(root, 'eda/blocks/build.ts'), '--job', dir],
        root,
        chipWorkerTimeoutMs,
      );
      await writeFile(resolve(dir, 'render.log'), out.stdout + out.stderr);
      if (![0, 2].includes(out.code))
        throw new Error(`Chip EDA failed (exit ${out.code}): ${out.stderr.slice(-2000)}`);
      const receipt: BoardReceipt = JSON.parse(await readFile(resolve(dir, 'receipt.json'), 'utf8'));
      job.stages.push(...receipt.stages);
      job.board = receipt.board;
      job.drc = receipt.drc;
      job.toolVersions = receipt.toolVersions;
      await gate({
        gate: 'drc',
        ok: receipt.drc.checked === true && !receipt.drc.errors.length,
        issues: receipt.drc.errors.map((i) => ({ rule: i.type, severity: 'error', message: i.message })),
      });
      const nativeCircuit = JSON.parse(await readFile(resolve(dir, 'circuit.json'), 'utf8')),
        nativeImports = JSON.parse(await readFile(resolve(dir, 'import-map.json'), 'utf8'));
      const blockChecks = blocks
        .filter((b) => plan.blocks.some((i) => i.block === b.id && i.version === b.version))
        .map((b) => {
          const { contentHash: _hash, status: _status, provenance, ...fields } = b;
          return inspectBlockPadGeometry(
            {
              ...fields,
              provenance: {
                author: provenance.author,
                ...(provenance.authorId ? { authorId: provenance.authorId } : {}),
              },
            },
            plan,
            blocks,
            nativeCircuit,
            nativeImports,
          );
        });
      await gate({
        gate: 'block-test',
        ok: blockChecks.every((g) => g.ok),
        issues: blockChecks.flatMap((g) => g.issues),
        measurements: blockChecks.flatMap((g) => g.measurements ?? []),
      });
      const geometry = evaluateRequirements(plan.requirements ?? [], {
        ...factsFromPlan(plan, blocks, spice),
        boardMm: [receipt.board.widthMm, receipt.board.heightMm],
      });
      job.gates = job.gates.filter((g) => g.gate !== 'verify');
      job.stages = job.stages.filter((s) => s.name !== 'verify');
      await gate(geometry);
      await writeFile(resolve(dir, 'verification.json'), JSON.stringify(geometry, null, 2));
      if (geometry.results?.some((r) => r.status !== 'pass'))
        throw new Error(
          'Confirmed requirements remain unchecked after layout: ' +
            geometry.results
              .filter((r) => r.status !== 'pass')
              .map((r) => r.id + ': ' + r.evidence)
              .join('; '),
        );
      if (!job.noFirmware) {
      const compiled = await worker(
        process.execPath,
        [
          resolve(root, 'node_modules/tsx/dist/cli.mjs'),
          resolve(root, 'src/board/chip-firmware-worker.ts'),
          dir,
        ],
        root,
        (options.timeoutMs ?? 120_000) + 20_000,
      );
      await writeFile(resolve(dir, 'firmware.log'), compiled.stdout + compiled.stderr);
      if (await exists(resolve(dir, 'firmware-stage.json'))) {
        const receipt = JSON.parse(await readFile(resolve(dir, 'firmware-stage.json'), 'utf8'));
        job.stages.push(...receipt.stages);
      }
      const build = await readFile(resolve(dir, 'firmware-build.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      await gate({
        gate: 'compile',
        ok: compiled.code === 0 && build?.compiled === true,
        issues:
          compiled.code === 0 && build?.compiled === true
            ? []
            : [
                {
                  rule: 'firmware-compile',
                  severity: 'error',
                  message:
                    build?.note ?? compiled.stderr.slice(-1500) ?? 'Application firmware was not compiled',
                },
              ],
      });
      }
      job.stages.push({
        name: 'enclosure',
        status: 'skipped',
        ms: 0,
        note: 'Chip-level enclosure handoff is not implemented',
      });
    } catch (error) {
      job.error = message(error);
    } finally {
      job.totalMs = performance.now() - started;
      await rm(resolve(dir, 'firmware/.pio'), { recursive: true, force: true });
      await refresh(job);
      job.status = job.error ? 'failed' : 'done';
      await writeFile(
        resolve(dir, 'receipt.json'),
        JSON.stringify(
          {
            stages: job.stages,
            totalMs: job.totalMs,
            drc: job.drc,
            board: job.board,
            toolVersions: job.toolVersions,
            gates: job.gates,
          },
          null,
          2,
        ),
      );
      await refresh(job);
      await save(job);
      void thumbnail(job);
    }
  }
  async function submitChip(plan: BoardPlan, base: BoardJob | undefined, at: number, applied?: AppliedOps) {
    const blocks = resolvePlanBlocks(plan),
      checks = checkPlan(plan, blocks),
      errors = checks.flatMap((g) => g.issues.filter((i) => i.severity === 'error'));
    if (errors.length) throw new Error(errors.map((i) => `${i.where ?? 'plan'}: ${i.message}`).join('; '));
    if (plan.app && !hasMcu(plan, blocks)) throw new Error('This plan has firmware but no microcontroller to run it');
    if (
      plan.blocks.length > 50 ||
      plan.blocks.reduce(
        (n, i) => n + blocks.find((b) => b.id === i.block && b.version === i.version)!.parts.length,
        0,
      ) > 200
    )
      throw new Error('Plan exceeds the 50-block / 200-part build limit');
    const source = JSON.stringify(plan);
    if (source.length > 256_000) throw new Error('Plan exceeds 256000 characters');
    if (queued >= 5)
      throw new ApiError(429, 'Board queue is full (5 waiting jobs); retry after a build finishes');
    queued++;
    let finish!: () => void;
    const preparing = new Promise<void>((done) => {
      finish = done;
    });
    submissions.add(preparing);
    try {
      const id = randomUUID(),
        job: BoardJob = {
          jobId: id,
          status: 'queued',
          createdAt: new Date().toISOString(),
          input: {
            kind: 'plan',
            sourceSha256: sha(source),
            plan: structuredClone(plan),
            ...(base ? { baseJobId: base.jobId } : {}),
            ...(applied ? { ops: applied.ops } : {}),
          },
          ...(applied ? { editSummary: applied.changes } : {}),
          cache: 'miss',
          stages: [
            {
              name: 'codegen',
              status: 'done',
              ms: performance.now() - at,
              note: 'Validated JSON plan; no author TSX is executed',
            },
          ],
          totalMs: 0,
          drc: { checked: false, errors: [], warnings: [] },
          board: { widthMm: 0, heightMm: 0, layers: plan.layers, traceCount: 0, viaCount: 0 },
          artifacts: {},
          toolVersions: {},
        };
      await mkdir(directory(id), { recursive: true });
      await writeFile(resolve(directory(id), 'plan.json'), JSON.stringify(plan, null, 2));
      jobs.set(id, job);
      await save(job);
      queue = queue.catch(() => {}).then(() => executeChip(job, structuredClone(plan)));
      return job;
    } catch (error) {
      queued--;
      throw error;
    } finally {
      finish();
      submissions.delete(preparing);
    }
  }
  /** What a saved job's edits start from. Its saved design or plan is the only source. */
  async function opsBase(job: BoardJob): Promise<OpsBase> {
    if (job.input.kind === 'plan' && job.input.plan) return { kind: 'plan', plan: job.input.plan };
    if (job.input.kind !== 'design') throw new Error('This board was written as code, so it can’t be edited here.');
    try {
      return { kind: 'design', design: JSON.parse(await readFile(resolve(directory(job.jobId), 'design.json'), 'utf8')) };
    } catch {
      throw new Error('The saved design for this base job is unavailable');
    }
  }
  /** Turns edits into the ordinary submission they stand for, or refuses in one sentence, before any job exists. */
  async function resolveOps(input: BoardSubmission): Promise<{ input: BoardSubmission; applied: AppliedOps }> {
    for (const key of Object.keys(input))
      if (!['ops', 'baseJobId', 'edits', 'plan'].includes(key)) throw new Error(`Unknown job field: ${key}`);
    if (typeof input.baseJobId !== 'string' || !uuid.test(input.baseJobId)) throw new Error('Edits need a baseJobId');
    const job = await load(input.baseJobId);
    if (!job) throw new Error('Base job was not found');
    const check = checkOps(await opsBase(job), input.ops);
    if (!check.ok) throw new Error(check.reason);
    const parsed = parseOps(input.ops, MAX_DRAFT_OPS);
    if (!('ops' in parsed) || !parsed.ops.length) throw new Error('There’s nothing to change yet.');
    const applied = { ops: 'ops' in parsed ? parsed.ops : [], changes: check.changes };
    const { baseJobId, edits } = input;
    if (check.design) return { input: { design: check.design, baseJobId, ...(edits !== undefined ? { edits } : {}) }, applied };
    const made = check.plan!;
    // The Editor sends the plan it had reviewed, with firmware added. It has to be the same circuit these edits make.
    if (input.plan !== undefined) {
      if (schematicHash(input.plan) !== schematicHash(made)) throw new Error('That plan isn’t what these edits make.');
      return { input: { plan: input.plan, baseJobId }, applied };
    }
    if (check.needsReview)
      throw new Error('A second agent has to check this change against the datasheets before it can be built.');
    return { input: { plan: made, baseJobId }, applied };
  }
  async function submit(given: BoardSubmission, bypassCache = false) {
    await ready();
    if (closed) throw new ApiError(503, 'Board service is closed');
    const at = performance.now();
    if (!given || typeof given !== 'object' || Array.isArray(given))
      throw new Error('Provide a design, source or baseJobId');
    const { input, applied } = given.ops !== undefined ? await resolveOps(given) : { input: given, applied: undefined };
    for (const key of Object.keys(input))
      if (!['design', 'source', 'plan', 'baseJobId', 'edits'].includes(key))
        throw new Error(`Unknown job field: ${key}`);
    const explicitDesign = input.design !== undefined,
      explicitSource = input.source !== undefined;
    if ([explicitDesign, explicitSource, input.plan !== undefined].filter(Boolean).length > 1)
      throw new Error('Provide exactly one design, source or plan');
    if (
      input.plan !== undefined &&
      (!input.plan || typeof input.plan !== 'object' || Array.isArray(input.plan))
    )
      throw new Error('Plan must be a JSON board plan object');
    if (explicitSource && typeof input.source !== 'string') throw new Error('Source must be a string');
    if (input.baseJobId !== undefined && (typeof input.baseJobId !== 'string' || !uuid.test(input.baseJobId)))
      throw new Error('Invalid baseJobId');
    const edits = input.edits === undefined ? undefined : parseMakerEdits(input.edits);
    if (edits && !input.baseJobId) throw new Error('Layout edits require a baseJobId');
    const base = input.baseJobId ? await load(input.baseJobId) : undefined;
    if (input.baseJobId && !base) throw new Error('Base job was not found');
    const plan =
      input.plan ??
      (!explicitDesign && !explicitSource && base?.input.kind === 'plan' ? base.input.plan : undefined);
    if (plan !== undefined) {
      if (edits)
        throw new Error('Carrier placement edits do not apply to chip plans; send plan block placements');
      return submitChip(plan, base ?? undefined, at, applied);
    }
    let design = input.design;
    let source = input.source;
    if (!explicitDesign && !explicitSource) {
      if (!base) throw new Error('Provide exactly one design or source, or a baseJobId');
      if (base.input.kind === 'design') {
        try {
          design = JSON.parse(await readFile(resolve(directory(base.jobId), 'design.json'), 'utf8'));
        } catch {
          throw new Error('The saved design for this base job is unavailable');
        }
      } else source = await readFile(resolve(directory(base.jobId), 'board.tsx'), 'utf8');
    }
    if (design) source = generateBoardSource(design);
    if (!design && options.allowSource === false)
      throw new Error(
        'Raw TSX source builds are disabled on the production preview; submit a validated design or board plan',
      );
    if (typeof source !== 'string') throw new Error('Provide exactly one design or source');
    let layout: BoardLayout | undefined;
    let normalizedEdits = edits;
    let editSummary: string[] | undefined;
    // Edits to a board nobody moved are laid out afresh, as it first was. Re-routing around frozen positions
    // measurably breaks clearances that the same design passes when laid out fresh, and there's nothing to preserve.
    const movedByHand = base && (await readFile(resolve(directory(base.jobId), 'layout.json')).then(() => true, () => false));
    if (base && (edits !== undefined || !explicitSource) && (!applied || edits !== undefined || movedByHand)) {
      let baseline: BoardLayout;
      try {
        const cj = JSON.parse(await readFile(resolve(directory(base.jobId), 'circuit.json'), 'utf8'));
        const metadata = await readFile(resolve(directory(base.jobId), 'board-metadata.json'), 'utf8')
          .then(JSON.parse)
          .catch(() => undefined);
        baseline = layoutFromCircuit(cj, metadata);
      } catch (error) {
        if (!design || !explicitDesign)
          throw new Error(`Base job has no usable board geometry: ${message(error)}`);
        baseline = layoutForDesign(design);
      }
      if (design && explicitDesign && contentId(design) !== base.input.designContentId) {
        const fresh = layoutForDesign(design);
        baseline = {
          ...fresh,
          board: baseline.board,
          usbEdge: baseline.usbEdge,
          mountingHoles: baseline.mountingHoles,
          parts: fresh.parts.map(
            (p) => baseline.parts.find((b) => b.refdes === p.refdes && b.module === p.module) ?? p,
          ),
        };
      }
      if (!design) {
        const savedSource = await readFile(resolve(directory(base.jobId), 'board.tsx'), 'utf8');
        if (source !== savedSource)
          throw new Error('Build changed source before applying layout edits to it');
      }
      const applied = applyMakerEdits(baseline, edits ?? {});
      layout = applied.layout;
      normalizedEdits = applied.edits;
      editSummary = applied.summary;
    }
    if (!source.trim() || source.length > 256_000)
      throw new Error('Source must be between 1 and 256000 characters');
    if (queued >= 5)
      throw new ApiError(429, 'Board queue is full (5 waiting jobs); retry after a build finishes');
    queued++;
    let finish!: () => void;
    const preparing = new Promise<void>((done) => {
      finish = done;
    });
    submissions.add(preparing);
    try {
      const id = randomUUID();
      const job: BoardJob = {
        jobId: id,
        status: 'queued',
        createdAt: new Date().toISOString(),
        input: {
          kind: design ? 'design' : 'source',
          sourceSha256: sha(source),
          ...(design ? { template: design.template, designContentId: contentId(design) } : {}),
          ...(base ? { baseJobId: base.jobId } : {}),
          ...(normalizedEdits ? { edits: normalizedEdits } : {}),
          ...(layout ? { layoutSha256: sha(JSON.stringify(layout)) } : {}),
          ...(applied ? { ops: applied.ops } : {}),
        },
        cache: 'miss',
        ...(applied || editSummary ? { editSummary: [...(applied?.changes ?? []), ...(editSummary ?? [])] } : {}),
        stages: [
          {
            name: 'codegen',
            status: design ? 'done' : 'skipped',
            ms: performance.now() - at,
            ...(design ? {} : { note: 'User supplied TSX' }),
          },
        ],
        totalMs: 0,
        drc: { checked: false, errors: [], warnings: [] },
        board: { widthMm: 0, heightMm: 0, layers: 2, traceCount: 0, viaCount: 0 },
        artifacts: {},
        toolVersions: {},
      };
      await mkdir(directory(id), { recursive: true });
      await writeFile(resolve(directory(id), 'board.tsx'), source);
      if (design) await writeFile(resolve(directory(id), 'design.json'), JSON.stringify(design, null, 2));
      if (layout) await writeFile(resolve(directory(id), 'layout.json'), JSON.stringify(layout, null, 2));
      jobs.set(id, job);
      await save(job);
      queue = queue.catch(() => {}).then(() => execute(job, source, design, bypassCache, layout));
      return job;
    } catch (error) {
      queued--;
      throw error;
    } finally {
      finish();
      submissions.delete(preparing);
    }
  }
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const rawPath = (req.url ?? '/').split('?')[0]!;
    if (!rawPath.startsWith('/api/board/')) return next();
    try {
      if (tokenHash) {
        const supplied = req.headers['x-moki-capability'];
        const hash = createHash('sha256')
          .update(typeof supplied === 'string' ? supplied : '')
          .digest();
        if (!timingSafeEqual(tokenHash, hash))
          return json(res, 401, { error: 'Board API capability required' });
      }
      await ready();
      // Inspect the raw path before WHATWG URL dot-segment normalization.
      const decoded = decodeURIComponent(rawPath);
      if (
        decoded.split('/').some((s) => s === '..' || s === '.') ||
        decoded.includes('\\') ||
        decoded.includes('\0')
      )
        return json(res, 400, { error: 'Invalid artifact path' });
      if ((rawPath === '/api/board/jobs' || rawPath === '/api/board/ops/check') && req.method === 'POST') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          return json(res, 403, { error: 'Same-origin requests only' });
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          const data = Buffer.from(chunk);
          bytes += data.length;
          if (bytes > 300_000) return json(res, 413, { error: 'Request too large' });
          chunks.push(data);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (rawPath === '/api/board/ops/check') {
          if (typeof body?.baseJobId !== 'string' || !uuid.test(body.baseJobId)) throw new Error('Edits need a baseJobId');
          const base = await load(body.baseJobId);
          if (!base) throw new Error('Base job was not found');
          return json(res, 200, checkOps(await opsBase(base), body.ops));
        }
        const job = await submit(body);
        return json(res, 202, { jobId: job.jobId });
      }
      if (rawPath === '/api/board/library' && req.method === 'GET') {
        const params = new URL(req.url!, 'http://localhost').searchParams;
        const listing = libraryListing(params.get('mode'), params.get('q'));
        return listing ? json(res, 200, listing) : json(res, 400, { error: 'mode is carrier or chip.' });
      }
      if (rawPath === '/api/board/jobs' && req.method === 'GET') {
        await evict();
        const template = new URL(req.url!, 'http://localhost').searchParams.get('template');
        for (const name of await readdir(jobsRoot).catch(() => [])) if (uuid.test(name)) await load(name);
        return json(
          res,
          200,
          [...jobs.values()]
            .filter((j) => !template || j.input.template === template)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 30),
        );
      }
      const match = rawPath.match(/^\/api\/board\/jobs\/([^/]+)(?:\/files\/([^/]+))?$/);
      if (!match || !uuid.test(match[1]!) || req.method !== 'GET')
        return json(res, 404, { error: 'Board endpoint not found' });
      const job = await load(match[1]!);
      if (!job) return json(res, 404, { error: 'Job not found' });
      if (!match[2]) return json(res, 200, job);
      const name = match[2];
      const picture = name === BOARD_THUMBNAIL;
      if (picture ? !(await thumbnail(job)) : !(BOARD_ARTIFACT_NAMES as readonly string[]).includes(name) || !job.artifacts[name])
        return json(res, 404, { error: 'Artifact not found' });
      const path = await realpath(resolve(directory(job.jobId), name));
      if (!path.startsWith(directory(job.jobId) + sep))
        return json(res, 404, { error: 'Artifact not found' });
      const data = await readFile(path);
      const types: Record<string, string> = {
        '.tsx': 'text/plain; charset=utf-8',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.glb': 'model/gltf-binary',
        '.png': 'image/png',
        '.stl': 'model/stl',
        '.step': 'model/step',
        '.zip': 'application/zip',
        '.csv': 'text/csv; charset=utf-8',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(name)] ?? 'application/octet-stream',
        'Content-Length': data.length,
        // A job id never gets a different build, so its picture never changes.
        'Cache-Control': picture ? 'private, max-age=604800, immutable' : 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      res.end(data);
    } catch (error) {
      json(res, error instanceof ApiError ? error.status : 400, { error: message(error) });
    }
  }
  async function close() {
    closed = true;
    controller.abort();
    await initialization?.catch(() => {});
    await Promise.all(submissions);
    await queue.catch(() => {});
    await drawn;
    release?.();
    release = undefined;
  }
  return { submit, load, handle, idle: () => queue, close, jobsRoot };
}

export function boardApi(options: BoardServiceOptions = {}): Plugin {
  const attach = (server: any, production: boolean) => {
    const service = createBoardService({
      maintenance: BOARD_SHARED_MAINTENANCE,
      ...options,
      ...(production ? { allowSource: false } : {}),
    });
    server.httpServer?.once('close', () => {
      void service.close();
    });
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      void service.handle(req, res, next);
    });
  };
  return {
    name: 'moki-board-api',
    configureServer(server) {
      attach(server, false);
    },
    configurePreviewServer(server) {
      attach(server, true);
    },
  };
}
