// A brief whose parts are all in the module kit stays on the kit, even when no fixed program has that mix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseTurn } from '../server/agent-api.js';
import type { BoardClient } from '../src/agents/board-client.js';
import { cleanBrief } from '../src/agents/brief-text.js';
import type { ChipLibrary } from '../src/agents/chip.js';
import type { AgentJob } from '../src/agents/facts.js';
import { replayProvider, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent, Requirement } from '../src/agents/protocol.js';
import { REQUIREMENT_METRICS } from '../src/agents/requirement-metrics.js';
import { kitHasRequiredParts } from '../src/agents/roles.js';
import { catalogListing, validateDesign } from '../src/agents/tools.js';
import { runTurn } from '../src/agents/turn.js';
import { evaluateRequirements } from '../src/blocks/verify.js';
import { boardMetadata, generateBoardSource } from '../src/board/codegen.js';
import { layoutForDesign, validateLayout } from '../src/board/edits.js';
import type { CircuitDesign } from '../src/circuit/model.js';
import { physicalLayout, schematicLayout } from '../src/circuit/layout.js';

// The owner's words, exactly as they reached the server, gutter and wrapping included.
const PASTED = 'A reaction-time game: an LED lights up after a random\n  ▎ delay, I press the knob as fast as I can, and the screen\n  ▎ shows my time in milliseconds plus my best score. A beep\n  ▎ if I press too early.';
const BRIEF = 'A reaction-time game: an LED lights up after a random delay, I press the knob as fast as I can, and the screen shows my time in milliseconds plus my best score. A beep if I press too early.';
const design = JSON.parse(readFileSync('tests/agent-fixtures/reaction-game-design.json', 'utf8')) as CircuitDesign;
const source = readFileSync('tests/agent-fixtures/reaction-game-main.cpp', 'utf8');
const present = (kind: string): Requirement => ({ id: kind, plain: `Has a ${kind}.`, metric: 'interface_present', args: { kind }, op: 'present', source: 'brief' });
const CHECKS = ['led', 'knob', 'button', 'display', 'buzzer'].map(present);
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const replay = (...calls: ReplayFixture['calls']) => replayProvider({ id: 'kit-mix', provenance: 'authored', calls });

function harness() {
  const created: unknown[] = [];
  const job = { jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', createdAt: '', totalMs: 1, status: 'done', cache: 'miss', board: { widthMm: 90, heightMm: 100, layers: 2, traceCount: 9, viaCount: 0 }, toolVersions: {}, drc: { checked: true, errors: [], warnings: [] }, stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'enclosure', status: 'done', ms: 1 }, { name: 'firmware', status: 'done', ms: 1 }, { name: 'firmware-compile', status: 'done', ms: 1 }], artifacts: { 'enclosure-base.stl': { url: '/x', bytes: 1, sha256: 'a', kind: 'stl' } }, input: { kind: 'design', sourceSha256: 'x' } } as unknown as AgentJob;
  const board: BoardClient = { async create(input) { created.push(input); return { jobId: job.jobId }; }, async get() { return job; }, async artifact() { return null; } };
  let chipAsked = 0;
  const chip = { blocks: async () => { chipAsked++; return []; } } as unknown as ChipLibrary;
  return { board, chip, created, chipCalls: () => chipAsked };
}

async function turn(provider: ReturnType<typeof replay>, h: ReturnType<typeof harness>) {
  const events: AgentEvent[] = [];
  const outcome = await runTurn({ message: BRIEF, brief: BRIEF, requirements: CHECKS, requirementsConfirmed: true }, {
    provider, board: h.board, chip: h.chip, pollMs: 1, emit: e => events.push(e),
    verify: { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements },
    compileApp: async () => ({ ok: true, ms: 1, errors: '' }),
  });
  return { outcome, events };
}

describe('the reaction-time brief', () => {
  it('reads as one sentence once the paste is cleaned', () => {
    assert.equal(cleanBrief(PASTED), BRIEF);
    assert.equal(parseTurn({ message: PASTED }).message, BRIEF);
    assert.equal(parseTurn({ message: 'x', brief: PASTED }).brief, BRIEF);
  });
  it('fits the kit with custom firmware, and no fixed program pretends to drive it', () => {
    assert.deepEqual(validateDesign(design, { customFirmware: true }), []);
    assert.ok(validateDesign(design).some(issue => /doesn't drive led/.test(issue)));
    assert.ok(catalogListing().firmwareFamilies['focus-timer'].customFirmwareModules?.includes('led-5mm-amber'));
  });
  it('gets a compact board with nothing overlapping, and draws everywhere the studio draws it', () => {
    const board = boardMetadata(design);
    assert.ok(board.widthMm * board.heightMm <= 90 * 100 * 0.75, `${board.widthMm} x ${board.heightMm}`);
    validateLayout(layoutForDesign(design));
    assert.ok(generateBoardSource(design).includes('D1'));
    const bench = physicalLayout(design);
    const benchOverlap = (a: typeof bench.parts[number], b: typeof bench.parts[number]) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const [i, a] of bench.parts.entries()) for (const b of bench.parts.slice(i + 1)) assert.ok(!benchOverlap(a, b), `${a.id} overlaps ${b.id} on the bench`);
    assert.equal(schematicLayout(design).parts.length, design.parts.length);
  });
  it('a model that says no gets a second look, and the kit builds it without chip mode', async () => {
    const h = harness();
    const provider = replay(
      tool('l', 'decline', { message: 'No program for this.', closest: '', closest_brief: '' }),
      tool('d', 'propose_design', { design, summary: 'A reaction-time game.', custom_firmware: BRIEF }),
      tool('f', 'compile_app', { source, summary: 'Runs the game.' }),
    );
    const { outcome, events } = await turn(provider, h);
    assert.equal(outcome, 'built');
    assert.equal(h.chipCalls(), 0);
    assert.equal(h.created.length, 1);
    assert.equal(provider.remaining(), 0);
    const no = events.find(e => e.type === 'tool' && e.name === 'decline');
    assert.ok(no?.type === 'tool' && !no.ok);
    assert.ok(!events.some(e => e.type === 'message' && /custom board/.test(e.text)));
  });
  it('a real second no still goes to chip mode, and says why', async () => {
    const h = harness();
    const provider = replay(
      tool('l', 'decline', { message: 'It needs Wi-Fi.', closest: '', closest_brief: '' }),
      tool('m', 'decline', { message: 'It needs Wi-Fi, and the kit has none.', closest: '', closest_brief: '' }),
      tool('v', 'list_metrics', {}),
      { content: [{ type: 'text', text: 'Stopping the script here.' }], stopReason: 'end_turn' },
    );
    const events: AgentEvent[] = [];
    await runTurn({ message: BRIEF, brief: BRIEF, requirements: CHECKS, requirementsConfirmed: true }, { provider, board: h.board, chip: h.chip, pollMs: 1, emit: e => events.push(e), verify: { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements } });
    assert.equal(h.chipCalls(), 1);
    assert.ok(events.some(e => e.type === 'message' && /It needs Wi-Fi, and the kit has none\. I’ll design a custom board/.test(e.text)));
  });
  it('only pushes back when the checks are all kit parts', () => {
    assert.equal(kitHasRequiredParts(CHECKS), true);
    assert.equal(kitHasRequiredParts([...CHECKS, present('usb_c_sink')]), false);
    assert.equal(kitHasRequiredParts([]), false);
    assert.equal(kitHasRequiredParts(undefined), false);
  });
});

describe('cleaning a pasted brief', () => {
  it('leaves ordinary writing alone', () => {
    assert.equal(cleanBrief('A lamp > 10 cm wide'), 'A lamp > 10 cm wide');
    assert.equal(cleanBrief('  A lamp.\n\nIt glows.  '), 'A lamp.\n\nIt glows.');
    assert.equal(cleanBrief('It has:\n- a knob\n- a screen'), 'It has:\n- a knob\n- a screen');
  });
  it('takes out quote gutters of any kind', () => {
    assert.equal(cleanBrief('│ one\n│ two'), 'one two');
    assert.equal(cleanBrief('> one\n> two'), 'one two');
    assert.equal(cleanBrief('▎one\r\n▎two'), 'one two');
    assert.equal(cleanBrief('▎ ▎'), '');
  });
});
