import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { prepareImmutablePreloads, verifyImmutablePreloads } from '../eda/blocks/immutable-preloads.js';
import { verifyRefinedClockPreloads } from '../eda/blocks/refined-clock-preloads.js';
import { withChipRoutingPlanningMargin } from '../src/blocks/router-planning.js';

// Exact production adapter, fake native protocol only. These cases exercise
// asynchronous diagnostic failure/cancellation, without loading any solver.
const source = readFileSync(new URL('../eda/blocks/router.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/immutable-preloads-fixture.json', import.meta.url), 'utf8'));
const prepare = () => prepareImmutablePreloads(fixture.input, fixture.fixedTraces);
const make = (Native: any) => {
  const module = { exports: {} as any };
  const require = (name: string) => {
    if (name === 'tscircuit') return { SOLVERS: { AutoroutingPipelineSolver9_PreloadedTraceGraph: Native } };
    if (name === './immutable-preloads.js') return { verifyImmutablePreloads };
    if (name === './refined-clock-preloads.js') return { verifyRefinedClockPreloads };
    if (name === '../../src/blocks/router-planning.js') return { withChipRoutingPlanningMargin };
    if (name === './routing-frame.js') return { rotateNativeRoutingFrame() { throw Error('Unexpected frame'); } };
    if (name === './native-width.js') return { restoreNativeWidths() { throw Error('Rejected copper reached width repair'); } };
    throw Error('Unexpected adapter dependency ' + name);
  };
  new Function('require', 'exports', 'module', js)(require, module.exports, module);
  return module.exports.chipAutorouter;
};
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(done => setImmediate(done));
class Mutated {
  solved = false; failed = false;
  step() { this.solved = true; }
  getOutputSimpleRouteJson() { return { traces: fixture.fixedTraces }; }
  getUpdatedPreloadedTraces() { return structuredClone(fixture.fixedTraces); }
  getMutatedPreloadedTraces() { return [fixture.fixedTraces[0]]; }
  visualize() { return {}; }
}

test('rejected-preload writer failure preserves the original verification error and never publishes copper', async () => {
  const prepared = prepare(), events: string[] = [], writerError = Error('INDEPENDENT diagnostic disk failure');
  const adapter = await make(Mutated)(prepared.input, {
    immutablePreloads: prepared.expected,
    onImmutablePreloads: async () => { events.push('diagnostic'); throw writerError; },
    onNativeSolved: async () => { events.push('published'); },
    onFailure: async () => { throw Error('INDEPENDENT secondary failure writer'); },
  });
  adapter.on('complete', () => events.push('complete')); adapter.on('error', () => events.push('error'));
  await assert.rejects(adapter.run(), (error: any) => error !== writerError && /Immutable preload native mutation/.test(error.message));
  assert.deepEqual(events, ['diagnostic', 'error']);
});

test('stop during rejected-preload diagnostics rejects pending run and suppresses late error/completion', async () => {
  const prepared = prepare(), entered = deferred(), release = deferred(), events: string[] = [];
  const adapter = await make(Mutated)(prepared.input, {
    immutablePreloads: prepared.expected,
    onImmutablePreloads: async () => { entered.resolve(); await release.promise; },
    onNativeSolved: async () => { events.push('published'); },
  });
  adapter.on('complete', () => events.push('complete')); adapter.on('error', () => events.push('error'));
  const pending = adapter.run(); await entered.promise; adapter.stop(); await assert.rejects(pending, /was stopped/);
  release.resolve(); await tick(); assert.deepEqual(events, []);
});
