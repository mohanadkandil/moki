// The chip-level turn with scripted model calls and everything else real: ERC, citations, SPICE, the job API, routing,
// DRC and the sandboxed compile. Costs nothing. It proves the path after the models, and says nothing about their judgement.
// Its review is scripted, so point both this and the server at a throwaway MOKI_SCHEMATIC_REVIEWS_DIR.
// `MOKI_SCHEMATIC_REVIEWS_DIR=var/schematic-reviews-test npx tsx scripts/chip-live-replay.ts --base http://127.0.0.1:5199/app/moki --plan file.json`
import { readFileSync, writeFileSync } from 'node:fs';
import { httpBoardClient } from '../src/agents/board-client.js';
import { realChipLibrary } from '../src/agents/chip-library.js';
import { replayProvider } from '../src/agents/model.js';
import type { AgentEvent } from '../src/agents/protocol.js';
import { runTurn } from '../src/agents/turn.js';
import type { SchematicPlan } from '../src/agents/chip.js';

const arg = (name: string) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : undefined; };
if (!process.env.MOKI_SCHEMATIC_REVIEWS_DIR) throw new Error('Set MOKI_SCHEMATIC_REVIEWS_DIR: a scripted review must never reach the real receipts.');
const baseUrl = arg('base') ?? 'http://127.0.0.1:5199/app/moki';
const plan = JSON.parse(readFileSync(arg('plan') ?? 'src/blocks/data/spike-plan.json', 'utf8')) as SchematicPlan;
delete (plan as { requirements?: unknown }).requirements; delete plan.app;
const source = arg('source') ? readFileSync(arg('source')!, 'utf8') : '#include <Arduino.h>\n#include "pins.h"\nvoid setup() { Serial.begin(115200); }\nvoid loop() { Serial.println("hello"); delay(1000); }\n';
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const provider = replayProvider({ id: 'chip-live-replay', provenance: 'authored', calls: [
  // A live run may have read a part's datasheet from the manufacturer. Reading it the same way makes those citations checkable.
  ...(plan.sections ?? []).flatMap((section, i) => (section.reference?.datasheetUrl ? [tool(`s${i}`, 'read_datasheet', { lcsc: section.reference.lcsc, url: section.reference.datasheetUrl, pages: [section.reference.page] })] : [])),
  tool('d', 'propose_plan', { plan, summary: 'Scripted plan.', app_brief: 'Print hello once a second.' }),
  tool('r', 'submit_review', { findings: (plan.sections ?? []).map(s => ({ section: s.id, status: 'out-of-scope', claim: 'Scripted replay: nobody reviewed this.' })) }),
  tool('f', 'compile_app', { source, summary: 'Prints hello.' }),
  // Only reached if the build fails: a fix that adds layers, which code must refuse for a clearance failure, then an honest stop.
  tool('x', 'propose_fix', { plan: { ...plan, layers: plan.layers === 2 ? 4 : 2 }, reason: 'Scripted: try more layers.' }),
  tool('g', 'give_up', { reason: 'Scripted replay stops here.' }),
] });
const events: AgentEvent[] = [];
const started = Date.now();
const outcome = await runTurn({ message: 'Scripted', mode: 'chip', requirements: [], requirementsConfirmed: true }, {
  provider, board: httpBoardClient({ baseUrl: () => baseUrl }), chip: realChipLibrary(), pollMs: 1000,
  emit: event => {
    events.push(event);
    if (event.type === 'plan.partial') console.log(`[step] ${event.step}${event.graph ? ` (sheet: ${event.graph.parts.length} parts, ${event.graph.nets.length} nets)` : ''}`);
    else if (event.type === 'message') console.log(`[${event.role}] ${event.text.slice(0, 500)}`);
    else if (event.type === 'tool' && !event.ok) console.log(`[${event.role}] ${event.name} FAILED: ${event.summary.slice(0, 500)}`);
    else if (event.type === 'job') console.log(`[job] ${event.jobId}`);
    else if (event.type === 'job-result') console.log(`[job-result] ok=${event.ok} drc=${event.drcErrors} compile=${event.compile} ${Math.round(event.pipelineMs / 1000)}s ${event.problems.join(' | ').slice(0, 900)}`);
    else if (event.type === 'error') console.log(`[error] ${event.message}`);
  },
});
console.log(`outcome ${outcome}, ${Math.round((Date.now() - started) / 1000)}s`);
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), scripted: 'Model calls scripted; every other stage real.', outcome, wallMs: Date.now() - started, sentBoard: plan.board ?? null, boards: events.flatMap(e => (e.type === 'plan' ? [e.plan.board ?? null] : [])), refused: events.flatMap(e => (e.type === 'tool' && !e.ok ? [`${e.name}: ${e.summary}`] : [])), messages: events.flatMap(e => (e.type === 'message' ? [`${e.role}: ${e.text}`] : [])), jobs: events.filter(e => e.type === 'job' || e.type === 'job-result') }, null, 2));
