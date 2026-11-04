// Dev tool: measured enclosure timings per template.
//   bun eda/enclosure/bench-enclosure.ts --root <dir with <template>/circuit.json, board.glb> --out <file> [--cold 5] [--cached 3]
// Cold runs use a new empty mech cache each time. Cached runs share one primed cache.
import { arch, cpus, freemem, loadavg, tmpdir, totalmem } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : fallback!; };
const root = resolve(arg('root')); const outFile = resolve(arg('out')); const cold = Number(arg('cold', '5')); const cached = Number(arg('cached', '3'));
const cli = resolve(import.meta.dir, '../enclosure.ts');
const templates = ['focus-timer', 'light-lamp', 'temp-monitor'];

const percentile = (values: number[], p: number) => { const s = [...values].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! * 10) / 10; };
const summarize = (samples: Array<Record<string, number>>) => Object.fromEntries([...new Set(samples.flatMap(s => Object.keys(s)))].map(key => { const values = samples.map(s => s[key]).filter((v): v is number => v !== undefined); return [key, { p50: percentile(values, 50), p95: percentile(values, 95), n: values.length }]; }));

function once(job: string, cache: string): Record<string, number> {
  const started = performance.now();
  const proc = Bun.spawnSync([process.execPath, cli, '--job', job], { env: { ...process.env as Record<string, string>, MOKI_MECH_CACHE_DIR: cache }, stdout: 'pipe', stderr: 'pipe' });
  const wall = performance.now() - started;
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  const report = JSON.parse(readFileSync(join(job, 'enclosure.json'), 'utf8'));
  if (report.engine?.fallback) throw new Error(`Fell back: ${report.engine.fallbackReason}`);
  const sample: Record<string, number> = { wallMs: wall };
  for (const stage of report.stages) sample[`stage:${stage.name}`] = stage.ms;
  // On a hit, enclosure.json still holds the timings of the run that filled the cache, so they are not counted.
  if (report.mechCache !== 'hit') for (const [key, value] of Object.entries(report.timing ?? {})) sample[`python:${key}`] = value as number;
  return sample;
}

const before = loadavg();
const results: Record<string, { cold: any; cached: any }> = {};
for (const template of templates) {
  const job = join(root, template);
  const coldSamples: Array<Record<string, number>> = [];
  for (let i = 0; i < cold; i++) { const cache = mkdtempSync(join(tmpdir(), 'moki-bench-')); try { coldSamples.push(once(job, cache)); } finally { rmSync(cache, { recursive: true, force: true }); } }
  const shared = mkdtempSync(join(tmpdir(), 'moki-bench-'));
  const cachedSamples: Array<Record<string, number>> = [];
  try { once(job, shared); for (let i = 0; i < cached; i++) cachedSamples.push(once(job, shared)); } finally { rmSync(shared, { recursive: true, force: true }); }
  results[template] = { cold: summarize(coldSamples), cached: summarize(cachedSamples) };
  console.log(template, JSON.stringify(results[template]!.cold.wallMs), JSON.stringify(results[template]!.cached.wallMs));
}
writeFileSync(outFile, `${JSON.stringify({
  measuredAt: new Date().toISOString(),
  machine: { arch: arch(), cpus: cpus().length, totalMemMb: Math.round(totalmem() / 1048576), freeMemMbAtEnd: Math.round(freemem() / 1048576), loadavgBefore: before, loadavgAfter: loadavg() },
  note: 'The VPS was shared with other agents during this run, so the numbers include that load. Python import runs in a fresh process each time; a warm worker would remove python:importMs.',
  runs: { cold, cached }, results,
}, null, 2)}\n`);
