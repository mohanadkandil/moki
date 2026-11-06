// Boards with no microcontroller: who decides, what holds them to it, and what the pipeline skips.
// Replay and a fake board, with the real block library, ERC and SPICE profiles. No model, no compiler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { BoardClient } from '../src/agents/board-client.js';
import { realChipLibrary } from '../src/agents/chip-library.js';
import { assessJob, closingLine, type AgentJob } from '../src/agents/facts.js';
import { replayProvider, type ReplayFixture } from '../src/agents/model.js';
import { hasMcu, needsCodeWord, NO_CODE_TAB, noCodeIssues } from '../src/agents/no-code.js';
import type { AgentEvent, TurnRequest } from '../src/agents/protocol.js';
import { runTurn } from '../src/agents/turn.js';
import type { SchematicPlan } from '../src/agents/chip.js';
import type { BlockDef } from '../src/blocks/contract.js';
import { checkPlan, runSpiceChecks } from '../src/blocks/index.js';
import { getBlock, resolvePlanBlocks } from '../src/blocks/library.js';
import { evaluateRequirements, REQUIREMENT_METRICS } from '../src/blocks/verify.js';

const verify = { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements };
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const replay = (...calls: ReplayFixture['calls']) => replayProvider({ id: 'no-mcu', provenance: 'authored', calls });
const plan = (name: string) => JSON.parse(readFileSync(`tests/agent-fixtures/${name}-plan.json`, 'utf8')) as SchematicPlan;
const REACTION = 'A reaction-time game: an LED lights up after a random delay, I press the knob as fast as I can, and the screen shows my time in milliseconds plus my best score. A beep if I press too early.';
const NIGHT = 'a night light that turns on when it gets dark';
const WHY = 'This needs no code: a light sensor and a transistor can switch the LED on their own.';

const finished = (jobId: string, extra: Partial<AgentJob> = {}) => ({ jobId, status: 'done', noFirmware: true, totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: true, errors: [], warnings: [] }, board: { widthMm: 20, heightMm: 42, layers: 2, traceCount: 1, viaCount: 0 }, artifacts: {}, input: { kind: 'plan' }, stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'route', status: 'done', ms: 1 }], ...extra }) as unknown as AgentJob;
const fakeBoard = (job: (id: string) => AgentJob = finished) => {
  const created: { plan?: SchematicPlan }[] = [];
  const board = { create: async (input: { plan?: SchematicPlan }) => { created.push(input); return { jobId: '00000000-0000-4000-8000-000000000001' }; }, get: async (id: string) => job(id), artifact: async () => undefined } as unknown as BoardClient;
  return { board, created };
};
// The real library, without what writes files or needs the EDA worker.
const chip = () => { const { recordSchematicReview: _r, sizeBoard: _s, datasheets: _d, ...rest } = realChipLibrary(); return rest; };
const run = async (request: TurnRequest, provider: ReturnType<typeof replay>, job?: (id: string) => AgentJob) => {
  const events: AgentEvent[] = [];
  const { board, created } = fakeBoard(job);
  const compiled: unknown[] = [];
  const outcome = await runTurn(request, { provider, board, emit: e => events.push(e), pollMs: 1, verify, chip: chip(), compileProject: async project => { compiled.push(project); return { ok: true, ms: 1, errors: '' }; } });
  return { outcome, events, created, compiled, messages: events.flatMap(e => (e.type === 'message' ? [e.text] : [])), roles: events.flatMap(e => (e.type === 'role' ? [e.role] : [])), refused: events.flatMap(e => (e.type === 'tool' && !e.ok ? [e.summary] : [])) };
};
const usb = { id: 'usb', plain: 'It runs from USB power', metric: 'interface_present', args: { kind: 'usb_power' }, op: 'present', source: 'inferred' } as const;
const card = tool('c', 'submit_requirements', { requirements: [usb], not_checkable: [], message: 'I’ll build it to run from USB power. Sound right?' });
const review = (p: SchematicPlan) => tool('r', 'submit_review', { findings: p.sections.map(s => ({ section: s.id, status: 'out-of-scope', claim: 'Scripted.' })) });
const confirmed = (message: string, extra: Partial<TurnRequest> = {}): TurnRequest => ({ message, brief: message, mode: 'chip', requirements: [usb as never], requirementsConfirmed: true, ...extra });

describe('which briefs can go without code', () => {
  for (const brief of [NIGHT, 'a buzzer that beeps when water touches two wires', 'a continuity tester', 'an LED blinker using a 555 timer', 'a simple water-leak buzzer']) it(`no word needs code in: ${brief}`, () => assert.equal(needsCodeWord(brief), null));
  for (const [brief, word] of [[REACTION, 'game'], ['a clock with a screen', 'clock'], ['a Wi-Fi doorbell', 'wi-fi'], ['a countdown timer', 'countdown'], ['a timer for my tea', 'timer'], ['a lamp that turns off after 10 minutes', 'after 10 minutes'], ['a night light with an ESP32', 'esp32']] as const) it(`keeps a controller for: ${brief}`, () => assert.equal(needsCodeWord(brief), word));
});

describe('the Verifier decides', () => {
  it('sends a no-logic idea to a board with no microcontroller, and says why once', async () => {
    const { outcome, events, messages, roles } = await run({ message: NIGHT }, replay(tool('n', 'no_code_needed', { message: WHY }), card));
    assert.equal(outcome, 'awaiting-confirmation');
    const asked = events.find(e => e.type === 'requirements');
    assert.ok(asked?.type === 'requirements' && asked.mode === 'chip' && asked.noMcu === true);
    assert.deepEqual(messages, [WHY]);
    assert.deepEqual(roles, ['verifier', 'verifier']);
  });
  it('refuses that for the reaction-game brief, which stays on the kit', async () => {
    const kit = tool('c', 'submit_requirements', { requirements: [{ ...usb, id: 'screen', plain: 'It has a screen', args: { kind: 'display' } }], not_checkable: [], message: 'I’ll build it with a screen. Sound right?' });
    const { events, refused } = await run({ message: REACTION }, replay(tool('n', 'no_code_needed', { message: WHY }), kit));
    assert.deepEqual(refused, ['This one needs code']);
    const asked = events.find(e => e.type === 'requirements');
    assert.ok(asked?.type === 'requirements' && asked.mode === undefined && asked.noMcu === undefined);
  });
  it('only offers it once, so it can’t loop', async () => {
    const { refused, events } = await run({ message: NIGHT }, replay(tool('n', 'no_code_needed', { message: WHY }), tool('m', 'no_code_needed', { message: WHY }), card));
    assert.equal(refused.length, 1);
    assert.ok(events.some(e => e.type === 'requirements'));
  });
});

describe('the kit Designer can decide too', () => {
  const kitTurn = (message: string): TurnRequest => ({ message, requirements: [], requirementsConfirmed: true });
  it('hands a no-logic idea over, and the next card has no microcontroller', async () => {
    const { events, messages } = await run(kitTurn(NIGHT), replay(tool('d', 'decline', { message: WHY, closest: '', closest_brief: '', no_code_needed: true }), card));
    const asked = events.find(e => e.type === 'requirements');
    assert.ok(asked?.type === 'requirements' && asked.noMcu === true);
    assert.ok(messages[0]?.startsWith(WHY));
  });
  it('ignores the flag when the brief needs code', async () => {
    const { events } = await run(kitTurn(REACTION), replay(tool('d', 'decline', { message: 'No code.', closest: '', closest_brief: '', no_code_needed: true }), card));
    const asked = events.find(e => e.type === 'requirements');
    assert.ok(asked?.type === 'requirements' && asked.noMcu === undefined);
  });
});

describe('the build with no microcontroller', () => {
  for (const [name, brief] of [['night-light', NIGHT], ['water-buzzer', 'a buzzer that beeps when water touches two wires']] as const) {
    it(`${name}: no firmware agent, no compile, and the closing line says so`, async () => {
      const p = plan(name);
      const { outcome, roles, compiled, created, messages, events } = await run(confirmed(brief, { noMcu: true }), replay(tool('d', 'propose_plan', { plan: p, summary: p.title }), review(p)));
      assert.equal(outcome, 'built');
      assert.ok(!roles.includes('firmware'));
      assert.equal(compiled.length, 0);
      assert.equal(created[0]!.plan!.app, undefined);
      const result = events.find(e => e.type === 'job-result');
      assert.ok(result?.type === 'job-result' && result.ok && result.compile === 'none');
      assert.match(messages.at(-1)!, /no firmware, because this board has no code/);
    });
    it(`${name}: passes ERC and power with no MCU in it`, () => {
      const p = plan(name), blocks = resolvePlanBlocks(p);
      assert.equal(hasMcu(p, blocks), false);
      for (const gate of checkPlan(p, blocks)) assert.ok(gate.ok, JSON.stringify(gate.issues));
    });
  }
  it('refuses an MCU after the maker was told there would be none', async () => {
    const core = getBlock('esp32-s3-core')!;
    const p = plan('night-light');
    const withMcu = { ...p, blocks: [...p.blocks, { inst: 'mcu', block: core.id, version: core.version, params: {} }], sections: [...p.sections, { id: 'mcu', title: 'MCU', purpose: 'Runs code.', insts: ['mcu'], notes: ['An extra.'] }] };
    const { refused } = await run(confirmed(NIGHT, { noMcu: true }), replay(tool('d', 'propose_plan', { plan: withMcu, summary: 'x', app_brief: 'x' }), tool('g', 'decline', { message: 'x', closest: '' })));
    assert.ok(refused.length > 0);
  });
  it('refuses a plan with no MCU when the brief needs one', async () => {
    const p = plan('night-light');
    const { refused, created } = await run(confirmed('a night light with a screen'), replay(tool('d', 'propose_plan', { plan: p, summary: p.title, no_mcu_reason: WHY }), tool('g', 'decline', { message: 'x', closest: '' })));
    assert.match(refused[0]!, /needs code/);
    assert.equal(created.length, 0);
  });
  it('makes a Designer that chose this alone say why, in chat', async () => {
    const p = plan('night-light');
    const { refused, messages } = await run(confirmed(NIGHT), replay(tool('d', 'propose_plan', { plan: p, summary: p.title }), tool('e', 'propose_plan', { plan: p, summary: p.title, no_mcu_reason: WHY }), review(p)));
    assert.equal(refused.length, 1);
    assert.equal(messages[0], WHY);
  });
  it('puts the USB-C power block first, whatever order a model sent, so its socket faces off the board', async () => {
    const p = plan('night-light');
    const shuffled = { ...p, blocks: [...p.blocks].reverse() };
    const { created } = await run(confirmed(NIGHT, { noMcu: true }), replay(tool('d', 'propose_plan', { plan: shuffled, summary: p.title }), review(p)));
    assert.equal(created[0]!.plan!.blocks[0]!.block, 'usb-c-power-only');
  });
  it('says a bus block needs something to drive it', () => {
    const screen = getBlock('ssd1306-i2c-header') as BlockDef;
    const issues = noCodeIssues({ blocks: [{ inst: 's', block: screen.id, version: screen.version, params: {} }] }, [screen], 'a light');
    assert.match(issues[0]!, /talks over a bus/);
  });
  it('the Firmware tab’s words are one plain sentence', () => {
    assert.equal(NO_CODE_TAB.match(/[.!?](\s|$)/g)?.length, 1);
    assert.match(NO_CODE_TAB, /no code/);
  });
  it('a job with no firmware is not a compile failure', () => {
    const job = finished('j');
    assert.equal(assessJob(job).compile, 'none');
    assert.equal(assessJob(job).ok, true);
    assert.match(closingLine(job, 1), /no firmware/);
    assert.doesNotMatch(closingLine(job, 1), /not compiled/);
  });
});

describe('SPICE on the no-code blocks', () => {
  it('measures the dark detector in light and dark, and the switched LED', async () => {
    const p = plan('night-light');
    const gate = await runSpiceChecks(p, resolvePlanBlocks(p));
    assert.ok(gate.ok, JSON.stringify(gate.issues));
    const at = (word: RegExp) => gate.measurements!.find(m => word.test(m.where))!.measured;
    assert.ok(Math.abs(at(/10 lux/) - 0.614) < 0.01, 'under the 1 V threshold in light');
    assert.ok(Math.abs(at(/in the dark/) - 4.545) < 0.01, 'over the threshold in the dark');
    assert.ok(Math.abs(at(/LED current/) - 13) < 0.1);
  });
  it('measures the probe through its series resistor', async () => {
    const p = plan('water-buzzer');
    const gate = await runSpiceChecks(p, resolvePlanBlocks(p));
    assert.ok(gate.ok, JSON.stringify(gate.issues));
    assert.ok(Math.abs(gate.measurements![0]!.measured - 4.167) < 0.01);
  });
  it('fails a series resistor that feeds something other than an input', async () => {
    const p = plan('water-buzzer');
    // The probe's output into a resistor to ground would load the node, so it can't count as carrying no current.
    const blocks = resolvePlanBlocks(p).map(b => (b.id !== 'buzzer-switch' ? b : { ...b, parts: b.parts.map(part => (part.ref !== 'Q1' ? part : { ...part, pins: { ...part.pins, G: { ...part.pins.G!, role: 'passive' as const } } })) }));
    const gate = await runSpiceChecks(p, blocks);
    assert.equal(gate.ok, false);
    assert.match(gate.issues.find(i => i.severity === 'error')!.message, /omits a load/);
  });
});
