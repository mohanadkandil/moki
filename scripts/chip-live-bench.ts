// The chip-live acceptance: real briefs through the real chat API on a dev server, answering as a maker would.
// `npx tsx scripts/chip-live-bench.ts --base http://127.0.0.1:5199 [--only id] [--max-total 5]`. Spends real money through
// the server's key, which this script never sees. Adds each run to the evidence file, and stops at --max-total.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AgentEvent, ChatLine, TurnRequest } from '../src/agents/protocol.js';

const arg = (name: string) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : undefined; };
const base = arg('base') ?? 'http://127.0.0.1:5199';
const maxTotal = Number(arg('max-total') ?? 5);
const effort = (arg('effort') ?? 'balanced') as TurnRequest['effort'];
const only = arg('only')?.split(',');
const out = resolve(arg('evidence') ?? 'docs/engineering/2026-11-06-chip-live/evidence/chip-live-bench.json');
const CASES = [
  { id: 'rp2040-motor', brief: 'Design an RP2040 motor controller', answer: 'One small brushed DC motor at 5 V from USB-C, controlled from a button: press to start, stop and change speed. You choose anything else.' },
  { id: 's3-air', brief: 'an ESP32-S3 air quality monitor with a screen', answer: 'USB-C powered, desk use, a small I2C screen, measuring temperature and humidity. You choose anything else.' },
  { id: 'soil-alarm', brief: 'a soil moisture alarm', answer: 'USB powered, a capacitive soil probe on a connector, and a buzzer when it gets dry. You choose anything else.' },
];

async function* stream(request: TurnRequest): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${base}/api/agent/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = frame.split('\n').find(l => l.startsWith('data: '));
      if (data) yield JSON.parse(data.slice(6)) as AgentEvent;
    }
  }
}

const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) as { runs: Record<string, unknown>[] } : { runs: [] };
const spentBefore = () => previous.runs.reduce((sum, run) => sum + Number(run.costUsd ?? 0), 0);
mkdirSync(dirname(out), { recursive: true });
const save = () => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(previous, null, 2)); };

for (const item of CASES.filter(c => !only || only.includes(c.id))) {
  if (spentBefore() >= maxTotal) { console.log(`Stopped: $${spentBefore().toFixed(3)} spent of $${maxTotal}.`); break; }
  const started = Date.now();
  const run: Record<string, unknown> & { turns: unknown[] } = { id: item.id, brief: item.brief, at: new Date().toISOString(), effort, turns: [] };
  previous.runs.push(run);
  const history: ChatLine[] = [];
  let request: TurnRequest = { message: item.brief, ...(effort ? { effort } : {}) };
  let cost = 0, agentMs = 0, pipelineMs = 0, calls = 0;
  let answered = false;
  for (let round = 0; round < 4; round++) {
    const seen: Record<string, unknown>[] = [];
    let outcome = 'none'; let card: Extract<AgentEvent, { type: 'requirements' }> | null = null; let last = '';
    const roles: string[] = []; const jobs: Record<string, unknown>[] = []; let partials = 0, partialsWithGraph = 0;
    for await (const event of stream(request)) {
      if (event.type === 'plan.partial') { partials++; if (event.graph) partialsWithGraph++; console.log(`  [step] ${event.step}${event.graph ? ` (sheet: ${event.graph.parts.length} parts)` : ''}`); }
      if (event.type === 'role') { roles.push(event.role); console.log(`  [role] ${event.role}`); }
      if (event.type === 'tool') { console.log(`  [${event.role}] ${event.name}${event.ok ? '' : ' FAILED'}: ${event.summary.slice(0, 220)} ($${event.costUsd.toFixed(4)})`); if (!event.ok) seen.push({ failedTool: event.name, role: event.role, summary: event.summary.slice(0, 600) }); }
      if (event.type === 'message') { console.log(`  [say ${event.role}] ${event.text.slice(0, 700)}`); seen.push({ say: event.role, text: event.text.slice(0, 1200) }); last = event.text; }
      if (event.type === 'verify') seen.push({ verify: event.ok, results: event.results.map(r => ({ id: r.id, status: r.status, measured: r.measured, target: r.target, evidence: r.evidence.slice(0, 200) })) });
      if (event.type === 'job') { console.log(`  [job] ${event.jobId} attempt ${event.attempt}`); jobs.push({ jobId: event.jobId, attempt: event.attempt }); }
      if (event.type === 'job-result') { console.log(`  [job-result] ok=${event.ok} drc=${event.drcErrors} compile=${event.compile} ${Math.round(event.pipelineMs / 1000)}s ${event.problems.join(' | ').slice(0, 900)}`); jobs.push({ jobId: event.jobId, ok: event.ok, status: event.status, drcErrors: event.drcErrors, compile: event.compile, pipelineMs: event.pipelineMs, problems: event.problems }); }
      if (event.type === 'plan') writeFileSync(resolve(dirname(out), `plan-${item.id}.json`), JSON.stringify(event.plan, null, 2));
      if (event.type === 'plan') seen.push({ plan: { title: event.plan.title, blocks: event.plan.blocks.map(b => `${b.inst}=${b.block}@${b.version}`), sections: event.plan.sections?.map(s => s.title), drafts: event.plan.drafts?.map(d => d.id), layers: event.plan.layers, board: event.plan.board, unreviewed: event.unreviewed } });
      if (event.type === 'requirements') { card = event; seen.push({ card: { mode: event.mode ?? 'carrier', checks: event.requirements.map(r => r.plain), notCheckable: event.notCheckable, message: event.message } }); console.log(`  [card ${event.mode ?? 'carrier'}] ${event.message}`); }
      if (event.type === 'decline') { seen.push({ decline: event.message }); console.log(`  [decline] ${event.message}`); }
      if (event.type === 'error') { seen.push({ error: event.message }); console.log(`  [error] ${event.message}`); }
      if (event.type === 'done') { outcome = event.outcome; cost += event.usage.costUsd; agentMs += event.usage.agentMs; pipelineMs += event.usage.pipelineMs; calls += event.usage.calls; console.log(`  [done] ${event.outcome} $${event.usage.costUsd.toFixed(3)} agent ${Math.round(event.usage.agentMs / 1000)}s pipeline ${Math.round(event.usage.pipelineMs / 1000)}s`); }
    }
    run.turns.push({ request: request.message.slice(0, 200), mode: request.mode ?? null, outcome, roles, partials, partialsWithGraph, jobs, seen });
    Object.assign(run, { outcome, costUsd: Number(cost.toFixed(4)), agentMs, pipelineMs, calls, wallMs: Date.now() - started }); save();
    if (outcome !== 'awaiting-confirmation') break;
    // Answer as a maker would: a question gets the answer once, a card gets a yes. The browser's own request shapes.
    history.push({ role: 'user', text: request.message });
    if (card) { request = { message: card.brief, brief: card.brief, requirements: card.requirements, requirementsConfirmed: true, history, ...(card.mode ? { mode: card.mode } : {}), ...(effort ? { effort } : {}) }; }
    else if (!answered) { answered = true; history.push({ role: 'agent', text: last }); request = { message: item.answer, history, ...(effort ? { effort } : {}) }; }
    else break;
  }
  console.log(`== ${item.id}: ${String(run.outcome)} $${cost.toFixed(3)} ${Math.round((Date.now() - started) / 1000)}s`);
}
console.log(`Total $${spentBefore().toFixed(3)}`);
