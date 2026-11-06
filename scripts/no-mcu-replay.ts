// A board with no microcontroller, from the first message to a routed job, with scripted model calls and everything else
// real: the no-code rule, the requirement gate, ERC, SPICE, the job API, routing and DRC. Costs nothing. It proves the path
// and these plans, and says nothing about whether a real model would choose them.
// Its review is scripted, so point both this and the server at a throwaway MOKI_SCHEMATIC_REVIEWS_DIR.
// `MOKI_SCHEMATIC_REVIEWS_DIR=var/schematic-reviews-test npx tsx scripts/no-mcu-replay.ts --brief night-light --base http://127.0.0.1:5199/app/moki --out file.json`
import { readFileSync, writeFileSync } from 'node:fs';
import { httpBoardClient } from '../src/agents/board-client.js';
import { realChipLibrary } from '../src/agents/chip-library.js';
import type { SchematicPlan } from '../src/agents/chip.js';
import { replayProvider } from '../src/agents/model.js';
import type { AgentEvent, Requirement } from '../src/agents/protocol.js';
import { REQUIREMENT_METRICS } from '../src/agents/requirement-metrics.js';
import { runTurn } from '../src/agents/turn.js';
import { evaluateRequirements } from '../src/blocks/verify.js';

const arg = (name: string) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : undefined; };
if (!process.env.MOKI_SCHEMATIC_REVIEWS_DIR) throw new Error('Set MOKI_SCHEMATIC_REVIEWS_DIR: a scripted review must never reach the real receipts.');
const present = (id: string, kind: string, plain: string) => ({ id, plain, metric: 'interface_present', args: { kind }, op: 'present', source: 'brief' }) as Requirement;
const BRIEFS: Record<string, { brief: string; why: string; requirements: Requirement[] }> = {
  'night-light': {
    brief: 'a night light that turns on when it gets dark',
    why: 'This needs no code: a light sensor and a transistor can switch the LED on their own, so I’ll leave the microcontroller out.',
    requirements: [present('light', 'light_sensor', 'It has a light sensor.'), present('led', 'led', 'It has an LED.'), present('usb', 'usb_power', 'It runs from USB power.')],
  },
  'water-buzzer': {
    brief: 'a buzzer that beeps when water touches two wires',
    why: 'This needs no code: water between the wires can switch a transistor and the buzzer on its own, so I’ll leave the microcontroller out.',
    requirements: [present('probe', 'probe', 'It has a two-wire probe.'), present('buzzer', 'buzzer', 'It has a buzzer.'), present('usb', 'usb_power', 'It runs from USB power.')],
  },
};
const name = arg('brief') ?? 'night-light';
const { brief, why, requirements } = BRIEFS[name]!;
const plan = JSON.parse(readFileSync(`tests/agent-fixtures/${name}-plan.json`, 'utf8')) as SchematicPlan;
const tool = (id: string, tool_: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name: tool_, input }], stopReason: 'tool_use' as const });
const verify = { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements };
const events: AgentEvent[] = [];
const emit = (event: AgentEvent) => {
  events.push(event);
  if (event.type === 'message') console.log(`[${event.role}] ${event.text.slice(0, 400)}`);
  else if (event.type === 'role') console.log(`[role] ${event.role}`);
  else if (event.type === 'tool') console.log(`[${event.role}] ${event.name} ${event.ok ? 'ok' : 'FAILED'}: ${event.summary.slice(0, 300)}`);
  else if (event.type === 'requirements') console.log(`[card] mode=${event.mode} noMcu=${event.noMcu} ${event.requirements.map(r => r.id).join(',')}`);
  else if (event.type === 'job') console.log(`[job] ${event.jobId}`);
  else if (event.type === 'job-result') console.log(`[job-result] ok=${event.ok} drc=${event.drcErrors} compile=${event.compile} ${Math.round(event.pipelineMs / 1000)}s ${event.problems.join(' | ').slice(0, 800)}`);
  else if (event.type === 'verify') console.log(`[verify] ok=${event.ok} ${event.results.map(r => `${r.id}:${r.status}`).join(' ')}`);
  else if (event.type === 'error') console.log(`[error] ${event.message}`);
};
const started = Date.now();
const board = httpBoardClient({ baseUrl: () => arg('base') ?? 'http://127.0.0.1:5199/app/moki' });
const chip = realChipLibrary();

// The first message, as a browser sends it. The kit Verifier says no code, and the checks are written again for that board.
const asked = await runTurn({ message: brief }, { provider: replayProvider({ id: 'no-mcu-ask', provenance: 'authored', calls: [
  tool('n', 'no_code_needed', { message: why }),
  tool('c', 'submit_requirements', { requirements, not_checkable: ['That it really responds as described.'], message: `I’ll build a small USB-powered board with no microcontroller. I’ll hold it to ${requirements.length} things: ${requirements.map(r => r.plain.replace(/\.$/, '').toLowerCase()).join(', ')}. Sound right?` }),
] }), board, chip, verify, emit });
const card = events.find(e => e.type === 'requirements');
if (asked !== 'awaiting-confirmation' || card?.type !== 'requirements' || !card.noMcu) throw new Error(`Expected a no-MCU card, got ${asked}`);

// The maker confirms, and what the card said comes back with the answer.
const outcome = await runTurn({ message: card.brief, brief: card.brief, requirements: card.requirements, requirementsConfirmed: true, ...(card.mode ? { mode: card.mode } : {}), noMcu: true }, { provider: replayProvider({ id: 'no-mcu-build', provenance: 'authored', calls: [
  tool('d', 'propose_plan', { plan, summary: plan.title }),
  tool('r', 'submit_review', { findings: plan.sections.map(s => ({ section: s.id, status: 'out-of-scope', claim: 'Scripted replay: nobody reviewed this.' })) }),
  tool('g', 'give_up', { reason: 'Scripted replay stops here.' }),
] }), board, chip, verify, emit, pollMs: 1000 });

console.log(`outcome ${outcome}, ${Math.round((Date.now() - started) / 1000)}s`);
const result = events.findLast(e => e.type === 'job-result');
const jobId = result?.type === 'job-result' ? result.jobId : undefined;
const job = jobId ? await board.get(jobId) : undefined;
const stages = job?.stages.map(s => `${s.name}:${s.status}`) ?? [];
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify({
  at: new Date().toISOString(), scripted: 'Model calls scripted; every other stage real. The plan was written by hand, and the review is scripted.', brief, outcome, wallMs: Date.now() - started,
  jobId, status: job?.status, noFirmware: job?.noFirmware ?? false, board: job?.board, drc: job?.drc, stages, gates: job?.gates?.map(g => ({ gate: g.gate, ok: g.ok, measurements: g.measurements, results: g.results?.map(r => `${r.id}:${r.status}`) })),
  firmwareArtifacts: Object.keys(job?.artifacts ?? {}).filter(a => /firmware/.test(a)), roles: events.flatMap(e => (e.type === 'role' ? [e.role] : [])), messages: events.flatMap(e => (e.type === 'message' ? [`${e.role}: ${e.text}`] : [])), refused: events.flatMap(e => (e.type === 'tool' && !e.ok ? [`${e.name}: ${e.summary}`] : [])),
}, null, 1));
