import { cpus, totalmem, arch, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBoardService } from '../server/board-api.js';
import { submitBrief, EMPTY_SESSION } from '../src/circuit/session.js';
import type { BoardJob } from '../src/board/model.js';

const service = createBoardService();
const output = resolve('docs/engineering/2026-11-04-tscircuit/evidence/bench.json');
const records: BoardJob[] = [];
const percentile = (xs: number[], p: number) => [...xs].sort((a,b) => a-b)[Math.max(0, Math.ceil(xs.length*p)-1)] ?? 0;
const summary = (jobs: BoardJob[]) => Object.fromEntries(['total', ...new Set(jobs.flatMap(j => j.stages.map(s => s.name)))].map(name => {
  const xs = name === 'total' ? jobs.map(j => j.totalMs) : jobs.flatMap(j => j.stages.filter(s => s.name === name).map(s => s.ms));
  return [name, { n: xs.length, p50Ms: percentile(xs, .5), p95Ms: percentile(xs, .95) }];
}));
for (const [template, brief] of [['focus-timer','a focus timer with buzzer'],['light-lamp','a light lamp'],['temp-monitor','a temperature monitor']] as const) {
  const result = submitBrief(EMPTY_SESSION, brief); if (result.outcome.kind !== 'created') throw new Error(`Rejected benchmark: ${brief}`);
  for (const mode of ['cold', 'cached'] as const) {
    for (let i = 0; i < (mode === 'cold' ? 5 : 3); i++) {
      const job = await service.submit({ design: result.outcome.revision.design }, mode === 'cold'); await service.idle();
      records.push(job);
      console.log(JSON.stringify({ template, mode, iteration: i+1, jobId: job.jobId, status: job.status, drcErrors: job.drc.errors.length, totalMs: job.totalMs, stages: job.stages, cache: job.cache }));
      await mkdir(resolve(output, '..'), { recursive: true });
      const templates = Object.fromEntries(['focus-timer','light-lamp','temp-monitor'].map(t => [t, {
        cold: summary(records.filter(j => j.input.template === t && j.cache === 'miss')),
        cached: summary(records.filter(j => j.input.template === t && j.cache === 'hit')),
      }]));
      await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), scope: '5 fresh subprocess runs with EDA and mechanical artifact caches bypassed, 3 EDA cache reuse runs per template (mechanical cache independently reported); installed OS/toolchain caches remain warm. Whole job timings exclude queue waiting.', machine: { nproc: cpus().length, cpu: cpus()[0]?.model, arch: arch(), platform: platform(), ramBytes: totalmem() }, toolVersions: job.toolVersions, templates, runs: records }, null, 2));
      if (job.status !== 'done' || job.drc.errors.length || job.stages.some(s => s.status === 'failed')) throw new Error(`Benchmark failed: ${job.error ?? JSON.stringify(job.drc.errors)}`);
    }
  }
}
console.log(`Measured ${records.length} jobs; wrote ${output}`);
