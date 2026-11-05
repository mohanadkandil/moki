// Agent bench: `npx tsx src/agents/bench.ts [--base http://127.0.0.1:5173] [--only id,id] [--live] [--max-total 3]`
// Default is replay: no model is called and nothing is spent. The agent numbers are then estimates from
// hand-written fixtures. The pipeline numbers are real either way, because every design really builds.
// --live needs a key in the environment, stops at --max-total dollars across every live run (it adds up the
// call log first), logs every call's cost, and records fixtures as it goes. Start it through systemd-run with
// EnvironmentFile= so nobody has to see the key.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EXAMPLE_BRIEFS, interpretBrief } from '../circuit/interpret.js';
import { buildDesign } from '../circuit/templates.js';
import { httpBoardClient, waitForJob } from './board-client.js';
import { evaluateRequirements, REQUIREMENT_METRICS } from '../blocks/verify.js';
import { createProvider, priceOf, recordingProvider, redact, replayProvider, type CallRecord, type ModelProvider, type ReplayFixture } from './model.js';
import type { AgentEvent, EffortId, TurnOutcome, TurnRequest } from './protocol.js';
import { runTurn } from './turn.js';

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const live = process.argv.includes('--live');
const baseUrl = arg('base') ?? 'http://127.0.0.1:5173';
const maxTotal = Number(arg('max-total') ?? 3);
const only = arg('only')?.split(',');
const evidence = arg('evidence') ?? 'docs/engineering/2026-11-04-agents/evidence';
const out = resolve(evidence, 'agent-bench.json');
const callLog = resolve(evidence, 'agent-bench-calls.jsonl');
const fixtureDir = resolve('tests/agent-fixtures');
/** Builds wait for this much free memory: a starved worker times out, and that says nothing about the design. */
const MIN_FREE_MB = 700;
const freeMb = async () => Math.round(Number(/MemAvailable:\s+(\d+)/.exec(await readFile('/proc/meminfo', 'utf8'))?.[1] ?? 0) / 1024);

interface Case {
  id: string;
  kind: 'template' | 'off-template' | 'fixer' | 'editor' | 'firmware';
  brief: string;
  /** Written down before the run, from the catalog and the three firmware families. */
  expect: 'build' | 'decline';
  /** Editor cases change a real, finished build of this brief. */
  on?: string;
  /** Live runs serve this fixture's first call instead of asking the model, so a known bad design reaches the real pipeline and the model only plays the Fixer. */
  scriptedFirstCallFrom?: string;
  /** The same idea with calls written here. Every call after them is the real model. */
  scripted?: () => ReplayFixture['calls'];
  /** Runs like a maker: the Verifier proposes checks, the bench confirms them, then the design runs against them. */
  verify?: boolean;
}

const TIMER = 'A 25 minute focus timer with a small screen and a knob';
const cases: Case[] = [
  ...EXAMPLE_BRIEFS.map((e): Case => ({ id: `template-${e.template}`, kind: 'template', brief: e.brief, expect: 'build' })),
  { id: 'off-plant-moisture', kind: 'off-template', brief: 'plant moisture alarm', expect: 'decline' },
  { id: 'off-freezer-alarm', kind: 'off-template', brief: 'A freezer door alarm that beeps if it warms above -10 degrees', expect: 'build' },
  { id: 'off-reading-nook', kind: 'off-template', brief: 'A reading nook glow that comes on at dusk', expect: 'build' },
  { id: 'off-desk-climate', kind: 'off-template', brief: 'a desk air climate readout on a tiny screen', expect: 'build' },
  { id: 'off-nursery-cold', kind: 'off-template', brief: 'Nursery too-cold warning that shows the room temperature and chirps under 18 degrees', expect: 'build' },
  { id: 'fix-overlap', kind: 'fixer', brief: 'A temperature monitor with two pull-ups', expect: 'build' },
  { id: 'edit-usb-left', kind: 'editor', brief: 'move the USB to the left', expect: 'build', on: TIMER },
  { id: 'edit-smaller-case', kind: 'editor', brief: 'make the case smaller', expect: 'build', on: TIMER },
  { id: 'edit-add-buzzer', kind: 'editor', brief: 'add a buzzer', expect: 'build', on: TIMER },
  { id: 'verify-battery', kind: 'off-template', brief: 'A focus timer that runs 4 h on a 1000 mAh battery', expect: 'build', verify: true },
  { id: 'verify-small', kind: 'off-template', brief: 'A temperature monitor with a small screen that fits on a 60 by 40 mm board', expect: 'build', verify: true },
  { id: 'verify-usb-timer', kind: 'off-template', brief: 'A focus timer with a screen and a knob, powered over USB, using fewer than 6 parts', expect: 'build', verify: true },
  { id: 'edit-firmware-bar', kind: 'firmware', brief: 'show a progress bar on the screen while it counts down', expect: 'build', on: TIMER },
  // The owner's live set. None of these has a catalog part or firmware for what makes it special.
  { id: 'off-door-chime', kind: 'off-template', brief: 'A door chime that plays a tone when the door opens', expect: 'decline' },
  { id: 'off-pomodoro-ring', kind: 'off-template', brief: 'A pomodoro timer with an LED ring that shows the time left', expect: 'decline' },
  // The parts for these two exist, so since the Firmware agent they should build.
  { id: 'off-desk-humidity', kind: 'off-template', brief: 'A desk humidity display', expect: 'build' },
  { id: 'off-reaction-game', kind: 'off-template', brief: 'A reaction-time game', expect: 'build' },
  { id: 'fw-compile-fix', kind: 'firmware', brief: 'A reaction-time game', expect: 'build', scripted: () => {
    const read = interpretBrief(TIMER);
    if (!read.ok) throw new Error('Base brief no longer reads');
    return [
      { content: [{ type: 'tool_use', id: 'scripted-design', name: 'propose_design', input: { design: buildDesign(read.interpretation), summary: 'A reaction-time game.', custom_firmware: 'Wait a random 2 to 6 seconds, beep if there is a buzzer, show GO on the screen, then time how long the knob button takes to be pressed and show it in milliseconds.' } }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'scripted-bad-source', name: 'compile_app', input: { summary: 'A deliberately broken first try.', source: '#include <Arduino.h>\n#include "pins.h"\nvoid setup() { pinMode(PIN_SW1_SW, INPUT_PULLUP); showScore(0); }\nvoid loop() { undefinedThing++; }\n' } }], stopReason: 'tool_use' },
    ];
  } },
  { id: 'fix-failing', kind: 'fixer', brief: 'A temperature monitor with two pull-ups', expect: 'build', scriptedFirstCallFrom: 'fix-overlap' },
];

const board = httpBoardClient({ baseUrl: () => baseUrl, token: process.env.MOKI_BOARD_API_TOKEN });
const effort = (arg('effort') ?? 'balanced') as EffortId;
const liveProvider = live ? createProvider(process.env, effort) : null;
await mkdir(resolve(evidence), { recursive: true });
if (live && !liveProvider) throw new Error('--live needs ANTHROPIC_API_KEY or OPENAI_API_KEY in its environment. Nothing was called.');

const results: Array<{ id: string } & Record<string, unknown>> = [];
// Earlier live runs count, including smoke tests: the budget is for the whole bench.
let totalUsd = live ? (await readFile(callLog, 'utf8').catch(() => '')).split('\n').filter(Boolean).reduce((sum, line) => sum + (JSON.parse(line) as { costUsd: number }).costUsd, 0) : 0;

/** A finished build to edit. Built without any model, once per brief. */
const bases = new Map<string, Pick<TurnRequest, 'design' | 'brief' | 'jobId'>>();
async function baseFor(brief: string) {
  const known = bases.get(brief);
  if (known) return known;
  const read = interpretBrief(brief);
  if (!read.ok) throw new Error(`Base brief no longer reads: ${brief}`);
  const design = buildDesign(read.interpretation);
  const { jobId } = await board.create({ design });
  const job = await waitForJob(board, jobId);
  if (job.status !== 'done') throw new Error(`Base build failed: ${job.error}`);
  const base = { design, brief, jobId };
  bases.set(brief, base);
  return base;
}

/** Serves one call from a fixture at no cost, then hands over to the real model. */
function scriptedCalls(inner: ModelProvider, calls: ReplayFixture['calls']): ModelProvider {
  let used = 0;
  return { name: inner.name, model: inner.model, reserveFactor: inner.reserveFactor, async call(request) {
    const next = calls[used++];
    if (!next) return inner.call(request);
    return { content: next.content, stopReason: next.stopReason, model: inner.model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  } };
}
/** What the Firmware agent did in a turn, and its source on disk, so a person can read what the model wrote. */
function firmwareOf(events: AgentEvent[]) {
  const compiles = events.filter((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool' && e.name === 'compile_app');
  const app = events.flatMap(e => (e.type === 'design' && e.design.app ? [e.design.app] : [])).at(-1);
  return { custom: Boolean(app), compileCalls: compiles.length, compileResults: compiles.map(c => redact(c.summary)), compileMs: compiles.reduce((sum, c) => sum + c.ms, 0), lines: app?.source.split('\n').length ?? 0, brief: app?.brief ?? null };
}
const readFixture = (name: string) => readFile(resolve(fixtureDir, `${name}.json`), 'utf8').then(text => JSON.parse(text) as ReplayFixture).catch(() => null);

// The owner's order: templates, five off-template briefs, the Fixer, then two briefs the catalog can build,
// because none of the five can prove an off-template build.
const LIVE_SET = ['template-focus-timer', 'template-light-lamp', 'template-temp-monitor', 'off-plant-moisture', 'off-door-chime', 'off-pomodoro-ring', 'off-desk-humidity', 'off-reaction-game', 'fix-failing', 'off-freezer-alarm', 'off-reading-nook'];
const selected = live && !only ? cases.filter(c => LIVE_SET.includes(c.id)).sort((a, b) => LIVE_SET.indexOf(a.id) - LIVE_SET.indexOf(b.id)) : cases;
for (const item of only ? (only.map(id => cases.find(c => c.id === id)).filter(Boolean) as Case[]) : selected) {
  if (live && totalUsd >= maxTotal) {
    results.push({ id: item.id, skipped: `Reached the $${maxTotal} total for this bench` });
    continue;
  }
  const fixture = live ? null : await readFixture(item.id) ?? await readFixture(`${item.id}.recorded`);
  if (!live && !fixture) { console.log(`${item.id}: skipped, no fixture yet`); continue; }
  let freeAtStart = await freeMb();
  for (let waited = 0; freeAtStart < MIN_FREE_MB && waited < 40; waited++) { await new Promise(r => setTimeout(r, 15_000)); freeAtStart = await freeMb(); }
  if (freeAtStart < MIN_FREE_MB) {
    results.push({ id: item.id, skipped: `Only ${freeAtStart} MB free after waiting 10 minutes` });
    console.log(`${item.id}: skipped, only ${freeAtStart} MB free`);
    continue;
  }
  const fromFixture = live && item.scriptedFirstCallFrom ? (await readFixture(item.scriptedFirstCallFrom))?.calls[0] : undefined;
  const scripted = live ? (item.scripted?.() ?? (fromFixture ? [fromFixture] : [])) : [];
  const recorder = liveProvider ? recordingProvider(scripted.length ? scriptedCalls(liveProvider, scripted) : liveProvider, item.id, item.brief) : null;
  const provider: ModelProvider = recorder ?? replayProvider(fixture!);
  const events: AgentEvent[] = [];
  const context = item.on ? await baseFor(item.on) : {};
  const started = performance.now();
  // A live run may not spend past what the whole bench has left.
  const capUsd = live ? Math.min(2, maxTotal - totalUsd) : 2;
  const logCall = (record: CallRecord) => {
    if (!live) return;
    console.log(`  call ${record.role} ${record.model}: ${record.inputTokens}+${record.cacheReadTokens}+${record.cacheWriteTokens} in, ${record.outputTokens} out, $${record.costUsd.toFixed(4)}, ${Math.round(record.ms)} ms`);
    // Written at once: a killed run must still count what it spent.
    if (record.inputTokens + record.outputTokens + record.cacheReadTokens > 0) appendFileSync(callLog, `${JSON.stringify({ at: new Date().toISOString(), case: item.id, ...record })}\n`);
  };
  const engine = item.verify ? { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements } : undefined;
  let outcome: TurnOutcome = await runTurn({ message: item.brief, ...context }, { provider, board, capUsd, emit: event => events.push(event), onCall: logCall, ...(engine ? { verify: engine } : {}) });
  let firstUsage: Extract<AgentEvent, { type: 'done' }>['usage'] | undefined;
  const card = events.find((e): e is Extract<AgentEvent, { type: 'requirements' }> => e.type === 'requirements');
  if (outcome === 'awaiting-confirmation' && card) {
    // What pressing "Looks right" sends. Its turn has its own cap, like a maker's would.
    firstUsage = events.find((e): e is Extract<AgentEvent, { type: 'done' }> => e.type === 'done')!.usage;
    events.splice(events.findIndex(e => e.type === 'done'), 1);
    outcome = await runTurn({ message: card.brief, brief: card.brief, requirements: card.requirements, requirementsConfirmed: true }, { provider, board, capUsd: Math.min(capUsd, maxTotal - totalUsd - firstUsage.costUsd), emit: event => events.push(event), onCall: logCall, verify: engine! });
  }
  const wallMs = Math.round(performance.now() - started);
  const done = events.find((e): e is Extract<AgentEvent, { type: 'done' }> => e.type === 'done')!;
  const jobs = events.filter((e): e is Extract<AgentEvent, { type: 'job-result' }> => e.type === 'job-result');
  const last = jobs.at(-1);
  if (firstUsage) for (const key of ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'agentMs'] as const) done.usage[key] += firstUsage[key];
  totalUsd += done.usage.costUsd;
  const built = jobs.length ? Boolean(last?.ok && last.drcErrors === 0 && last.compile === 'compiled') : null;
  // A correct decline passes. A build is judged by the board only, whatever was expected, and `matchedExpectation` says if it was a surprise.
  const success = outcome === 'declined' ? item.expect === 'decline' : built === true && outcome === 'built';
  const records = await Promise.all(jobs.map(j => board.get(j.jobId).catch(() => null)));
  const row = {
    id: item.id, kind: item.kind, brief: item.brief, expected: item.expect, outcome,
    rulesWouldAccept: interpretBrief(item.brief).ok,
    matchedExpectation: outcome === (item.expect === 'decline' ? 'declined' : 'built'),
    freeMemoryMbAtStart: freeAtStart,
    modelCalls: done.usage.calls - scripted.length,
    ...(scripted.length ? { scriptedCalls: scripted.length, scriptedNote: 'The first calls came from the bench at no cost, to set up a known failure. Every later call is the real model.' } : {}),
    firmware: firmwareOf(events),
    effort,
    ...(card ? { requirements: card.requirements, notCheckable: card.notCheckable, verify: events.filter((e): e is Extract<AgentEvent, { type: 'verify' }> => e.type === 'verify').at(-1) ?? null } : {}),
    inputTokens: done.usage.inputTokens + done.usage.cacheReadTokens + done.usage.cacheWriteTokens,
    outputTokens: done.usage.outputTokens,
    costUsd: Number(done.usage.costUsd.toFixed(5)),
    agentMs: done.usage.agentMs, pipelineMs: done.usage.pipelineMs, wallMs,
    jobs: jobs.map((j, i) => ({ jobId: j.jobId, attempt: j.attempt, ok: j.ok, drcErrors: j.drcErrors, compile: j.compile, caseOk: j.caseOk, pipelineMs: j.pipelineMs, cache: records[i]?.cache ?? null, baseJobId: records[i]?.input?.baseJobId ?? null, problems: j.problems })),
    messages: events.flatMap(e => (e.type === 'message' ? [redact(e.text)] : e.type === 'error' ? [`error: ${redact(e.message)}`] : e.type === 'decline' ? [redact(`declined: ${e.message}${e.closest ? ` Closest: ${e.closest}` : ''}`)] : e.type === 'fallback' ? [`fallback: ${redact(e.reason)}`] : [])),
    tools: events.flatMap(e => (e.type === 'tool' ? [e.name] : [])),
    success,
    labels: {
      tokensAndCost: done.usage.estimated ? 'estimated' : 'measured',
      agentMs: live ? 'measured' : 'not meaningful (replay)',
      pipeline: 'measured',
      modelJudgement: live ? 'measured' : 'not measured (authored fixture)',
    },
  };
  results.push(row);
  console.log(`${item.id}: ${outcome} success=${success} calls=${row.modelCalls} $${row.costUsd} pipeline=${row.pipelineMs}ms`);
  if (recorder) await writeFile(resolve(fixtureDir, `${item.id}.recorded.json`), `${JSON.stringify(recorder.fixture(), null, 1)}\n`);
  const written = events.flatMap(e => (e.type === 'design' && e.design.app ? [e.design.app.source] : [])).at(-1);
  if (written) { await mkdir(resolve(evidence, 'firmware'), { recursive: true }); await writeFile(resolve(evidence, 'firmware', `${item.id}.cpp`), written); }
}

const mode = live ? 'live' : 'replay';
const previous = await readFile(out, 'utf8').then(text => JSON.parse(text) as { mode: string; results: Array<{ id: string }> }).catch(() => null);
// A live row and a replay estimate never share a file.
const merged = only && previous?.mode === mode ? [...previous.results.filter(r => !results.some(n => n.id === r.id)), ...results] : results;
let headCommit: string | null = null;
try { headCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Not a checkout. */ }
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify({
  schema: 'moki.agent-bench/1',
  generatedAt: new Date().toISOString(),
  mode,
  provider: liveProvider?.name ?? 'replay',
  model: liveProvider?.model ?? 'none (claude-sonnet-5-5 prices applied to estimated tokens)',
  headCommit,
  boardApi: baseUrl,
  ...(liveProvider ? { pricePerMillionTokensUsd: priceOf(liveProvider.model) } : {}),
  meaning: live
    ? "Tokens and cost are the provider's usage. Agent and pipeline times are measured. Success means 0 DRC errors and compiled."
    : "NO MODEL WAS CALLED. Fixtures are hand-written, so tokens and cost are character estimates (4 characters a token, no thinking tokens) and success says nothing about a real model's judgement. Pipeline timings, DRC and compile results are real: each design was built through the live job API. Cached boards shorten pipeline times.",
  totals: { costUsd: Number(totalUsd.toFixed(5)), label: live ? 'tokens measured, priced at pricePerMillionTokensUsd' : 'estimated', ...(live ? { includesEveryLiveCall: true, capUsd: maxTotal } : {}) },
  results: merged,
}, null, 2)}\n`);
console.log(`Wrote ${out}`);
