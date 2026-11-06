// The kit path for the reaction-time brief with scripted model calls and everything else real: the requirement gate, the
// sandboxed compile, the job API, routing, DRC and the case. Costs nothing. It proves the path, and says nothing about a
// model's judgement or about hand-written firmware being what a model would write.
// `npx tsx scripts/kit-replay.ts --base http://127.0.0.1:5199/app/moki --out file.json`
import { readFileSync, writeFileSync } from 'node:fs';
import { httpBoardClient } from '../src/agents/board-client.js';
import { replayProvider } from '../src/agents/model.js';
import type { AgentEvent, Requirement } from '../src/agents/protocol.js';
import { REQUIREMENT_METRICS } from '../src/agents/requirement-metrics.js';
import { runTurn } from '../src/agents/turn.js';
import { evaluateRequirements } from '../src/blocks/verify.js';

const arg = (name: string) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : undefined; };
const design = JSON.parse(readFileSync(arg('design') ?? 'tests/agent-fixtures/reaction-game-design.json', 'utf8'));
const source = readFileSync(arg('source') ?? 'tests/agent-fixtures/reaction-game-main.cpp', 'utf8');
const brief = 'A reaction-time game: an LED lights up after a random delay, I press the knob as fast as I can, and the screen shows my time in milliseconds plus my best score. A beep if I press too early.';
const present = (id: string, kind: string, plain: string): Requirement => ({ id, plain, metric: 'interface_present', args: { kind }, op: 'present', source: 'brief' });
const requirements = [present('led', 'led', 'Has an LED.'), present('knob', 'knob', 'Has a knob.'), present('button', 'button', 'Has a push button.'), present('display', 'display', 'Has a screen.'), present('buzzer', 'buzzer', 'Has a buzzer.')];
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const provider = replayProvider({ id: 'kit-replay', provenance: 'authored', calls: [
  tool('l', 'decline', { message: 'Scripted first no.', closest: '', closest_brief: '' }),
  tool('d', 'propose_design', { design, summary: 'A reaction-time game.', custom_firmware: brief }),
  tool('p', 'get_pin_map', {}),
  tool('f', 'compile_app', { source, summary: 'Runs the game.' }),
] });
const events: AgentEvent[] = [];
const started = Date.now();
const outcome = await runTurn({ message: brief, brief, requirements, requirementsConfirmed: true }, {
  provider, board: httpBoardClient({ baseUrl: () => arg('base') ?? 'http://127.0.0.1:5199/app/moki' }), pollMs: 1000,
  verify: { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements },
  emit: event => {
    events.push(event);
    if (event.type === 'message') console.log(`[${event.role}] ${event.text.slice(0, 400)}`);
    else if (event.type === 'tool') console.log(`[${event.role}] ${event.name} ${event.ok ? 'ok' : 'FAILED'}: ${event.summary.slice(0, 300)}`);
    else if (event.type === 'job') console.log(`[job] ${event.jobId}`);
    else if (event.type === 'job-result') console.log(`[job-result] ok=${event.ok} drc=${event.drcErrors} compile=${event.compile} case=${event.caseOk} ${Math.round(event.pipelineMs / 1000)}s ${event.problems.join(' | ').slice(0, 800)}`);
    else if (event.type === 'verify') console.log(`[verify] ok=${event.ok} ${event.results.map(r => `${r.id}:${r.status}`).join(' ')}`);
    else if (event.type === 'error') console.log(`[error] ${event.message}`);
  },
});
console.log(`outcome ${outcome}, ${Math.round((Date.now() - started) / 1000)}s`);
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), scripted: 'Model calls scripted, firmware hand-written; every other stage real.', outcome, wallMs: Date.now() - started, job: events.filter(e => e.type === 'job-result'), verify: events.filter(e => e.type === 'verify') }, null, 1));
