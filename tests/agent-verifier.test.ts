// The Verifier and the requirement gate. Replay, a fake board and a small fake engine: no model, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardClient } from '../src/agents/board-client.js';
import type { AgentJob } from '../src/agents/facts.js';
import { replayProvider, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent, ChatLine, DeviceFacts, Requirement, TurnRequest } from '../src/agents/protocol.js';
import { REQUIREMENT_METRICS } from '../src/agents/requirement-metrics.js';
import { evaluateRequirements } from '../src/blocks/verify.js';
import { runTurn, type VerifyEngine } from '../src/agents/turn.js';
import { requirementIssues } from '../src/agents/verifier.js';
import { CARRIER_INTERFACES, factsFromDesign } from '../src/agents/verify-facts.js';
import { applyChange } from '../src/agents/roles.js';
import { interpretBrief } from '../src/circuit/interpret.js';
import { buildDesign } from '../src/circuit/templates.js';
import type { CircuitDesign } from '../src/circuit/model.js';

const read = interpretBrief('A 25 minute focus timer with a small screen and a knob');
assert.ok(read.ok);
const timer = buildDesign(read.interpretation);
const battery: Requirement = { id: 'life', plain: 'Runs at least 4 hours on a 1000 mAh battery', metric: 'battery_life_h', args: { capacity_mah: 1000 }, op: '>=', value: 4, unit: 'h', source: 'brief' };
const size: Requirement = { id: 'size', plain: 'Fits within 60 by 40 mm', metric: 'board_size_mm', op: '<=', value: [60, 40], unit: 'mm', source: 'brief' };

/** Just enough of an engine to test the gate around it. chip_eda owns the real one. */
const engine: VerifyEngine = { metrics: REQUIREMENT_METRICS, evaluate(requirements, facts: DeviceFacts) {
  const results = requirements.map(r => {
    if (r.metric === 'battery_life_h') { const measured = Number(r.args?.capacity_mah) / (facts.loadMa?.typical ?? 1); return { id: r.id, status: measured >= Number(r.value) ? 'pass' as const : 'fail' as const, measured, target: Number(r.value), unit: 'h', estimated: true, evidence: 'From typical module currents.' }; }
    if (r.metric === 'board_size_mm') { if (!facts.boardMm) return { id: r.id, status: 'unsupported' as const, evidence: 'The board has no size until it is built.' }; const [w, h] = r.value as [number, number]; return { id: r.id, status: facts.boardMm[0] <= w && facts.boardMm[1] <= h ? 'pass' as const : 'fail' as const, measured: facts.boardMm, target: [w, h], unit: 'mm', evidence: 'From the build record.' }; }
    return { id: r.id, status: 'unsupported' as const, evidence: 'Not evaluated yet.' };
  });
  return { gate: 'verify', ok: !results.some(r => r.status === 'fail'), issues: [], results };
} };

const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const replay = (...calls: ReplayFixture['calls']) => replayProvider({ id: 'verifier', provenance: 'authored', calls });
const say = (requirements: Requirement[]) => `I'll build it. Before I start, I'll hold it to ${requirements.map(r => r.plain.toLowerCase()).join(' and ')}. Sound right?`;
const submit = (requirements: unknown[], extra: Record<string, unknown> = {}) => tool('v', 'submit_requirements', { requirements, message: Array.isArray(requirements) && (requirements as { plain?: string }[]).every(r => r.plain) ? say(requirements as Requirement[]) : 'Sound right?', ...extra });
const propose = tool('d', 'propose_design', { design: timer, summary: 'A timer.' });

const fakeBoard = (sizes: [number, number][] = [[90, 75]]) => {
  const created: { design?: CircuitDesign; baseJobId?: string }[] = [];
  const job = (jobId: string, at: number): AgentJob => ({ jobId, status: 'done', totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: true, errors: [], warnings: [] }, board: { widthMm: sizes[at]?.[0] ?? 90, heightMm: sizes[at]?.[1] ?? 75, layers: 2, traceCount: 1, viaCount: 0 }, stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'done', ms: 0 }], artifacts: {}, input: { kind: 'design', sourceSha256: 'x', edits: {} } } as unknown as AgentJob);
  const board = {
    create: async (input: { design?: CircuitDesign; baseJobId?: string }) => { created.push(input); return { jobId: `00000000-0000-4000-8000-00000000000${created.length - 1}` }; },
    get: async (jobId: string) => job(jobId, Number(jobId.slice(-1))),
    artifact: async () => null,
  } as unknown as BoardClient;
  return { board, created };
};
const turn = async (request: TurnRequest, provider: ReturnType<typeof replay>, board: BoardClient, verify: VerifyEngine | null = engine) => {
  const events: AgentEvent[] = [];
  const outcome = await runTurn(request, { provider, board, emit: e => events.push(e), pollMs: 1, ...(verify ? { verify } : {}) });
  return { outcome, events, messages: events.flatMap(e => (e.type === 'message' ? [e.text] : [])) };
};

describe('requirement checks', () => {
  it('accepts every shape in the brief', () => {
    assert.deepEqual(requirementIssues([battery, size, { id: 'usb', plain: 'Has USB-C', metric: 'interface_present', args: { kind: 'usb_c_sink' }, op: 'present', source: 'brief' }, { id: 'rail', plain: 'The 3.3 V rail stays between 3.2 and 3.4 V', metric: 'net_voltage', args: { net: '3V3' }, op: 'within', value: [3.2, 3.4], unit: 'V', source: 'inferred' }, { id: 'mic', plain: 'The mic is on a capable pin', metric: 'pin_capability', args: { signal: 'I2S_MIC' }, op: 'present', source: 'inferred' }], REQUIREMENT_METRICS), []);
  });
  for (const [name, bad] of [
    ['a metric off the list', { ...battery, metric: 'looks_nice' }],
    ['a missing argument', { ...battery, args: {} }],
    ['an unknown argument', { ...battery, args: { capacity_mah: 1000, code: 'x' } }],
    ['a wrong comparison', { ...battery, op: 'within', value: [1, 2] }],
    ['no value to compare with', { ...battery, value: undefined }],
    ['a backwards range', { ...size, op: 'within', value: [3.4, 3.2], metric: 'net_voltage', args: { net: 'x' } }],
    ['no plain sentence', { ...battery, plain: '' }],
    ['a claim it works', { ...battery, plain: 'This board works.' }],
    ['an unknown source', { ...battery, source: 'model' }],
    ['a bad id', { ...battery, id: 'a b' }],
  ] as const) {
    it(`refuses ${name}`, () => assert.ok(requirementIssues([bad], REQUIREMENT_METRICS).length > 0));
  }
  it('accepts a board size as [width, height], whichever is larger', () => {
    assert.deepEqual(requirementIssues([{ ...size, op: 'within' }], REQUIREMENT_METRICS), []);
  });
  it('refuses an interface this mode can\'t report, so a check can\'t fail on a synonym', () => {
    const synonym = { id: 'usb', plain: 'Has USB power', metric: 'interface_present', args: { kind: 'usb_power_input' }, op: 'present', source: 'brief' };
    assert.deepEqual(requirementIssues([synonym], REQUIREMENT_METRICS), []);
    assert.match(requirementIssues([synonym], REQUIREMENT_METRICS, CARRIER_INTERFACES)[0]!, /isn't an interface/);
    assert.deepEqual(requirementIssues([{ ...synonym, args: { kind: 'usb_power' } }], REQUIREMENT_METRICS, CARRIER_INTERFACES), []);
  });
  it('every carrier interface is one the facts can really report', () => {
    const all = interpretBrief('A temperature monitor with a small screen and a chime');
    assert.ok(all.ok);
    for (const kind of factsFromDesign(buildDesign(all.interpretation)).interfaces) assert.ok(CARRIER_INTERFACES.includes(kind), kind);
  });
  it('makes the sentence say the number that gets checked', () => {
    assert.match(requirementIssues([{ ...size, plain: 'Fits within 50 by 50 mm', value: [500, 500] }], REQUIREMENT_METRICS)[0]!, /plain has to say 500/);
    assert.match(requirementIssues([{ ...battery, plain: 'Runs a long time on a battery' }], REQUIREMENT_METRICS)[0]!, /plain has to say 4/);
    assert.match(requirementIssues([{ ...battery, plain: 'Runs at least 4 hours on a battery' }], REQUIREMENT_METRICS)[0]!, /plain has to say 1000/);
    assert.deepEqual(requirementIssues([{ ...battery, plain: 'Runs at least 4 hours on a 1,000 mAh battery' }], REQUIREMENT_METRICS), []);
  });
  it('refuses duplicates, too many and non-lists', () => {
    assert.ok(requirementIssues([battery, battery], REQUIREMENT_METRICS).length);
    assert.ok(requirementIssues(Array.from({ length: 13 }, (_, i) => ({ ...battery, id: `r${i}` })), REQUIREMENT_METRICS).length);
    assert.ok(requirementIssues('x', REQUIREMENT_METRICS).length);
  });
});

describe('the confirm step', () => {
  it('shows the checks and designs nothing until the maker confirms', async () => {
    const { board, created } = fakeBoard();
    const { outcome, events } = await turn({ message: 'A focus timer that runs 4 h on a 1000 mAh battery' }, replay(submit([battery], { not_checkable: ['Looks nice on a desk'] })), board);
    assert.equal(outcome, 'awaiting-confirmation');
    assert.equal(created.length, 0);
    const card = events.find((e): e is Extract<AgentEvent, { type: 'requirements' }> => e.type === 'requirements')!;
    assert.deepEqual(card.notCheckable, ['Looks nice on a desk']);
    assert.equal(card.brief, 'A focus timer that runs 4 h on a 1000 mAh battery');
    assert.ok(!events.some(e => e.type === 'role' && e.role === 'designer'));
  });
  it('writes to the maker in words, with the data underneath', async () => {
    const { events } = await turn({ message: 'A timer' }, replay(submit([battery], { message: 'I\'ll build a timer. I\'ll hold it to at least 4 hours on a 1000 mAh battery. Sound right?', not_checkable: ['Looks nice'] })), fakeBoard().board);
    const card = events.find((e): e is Extract<AgentEvent, { type: 'requirements' }> => e.type === 'requirements')!;
    assert.match(card.message, /Sound right\?$/);
    assert.deepEqual(card.requirements, [battery]);
    assert.deepEqual(card.notCheckable, ['Looks nice']);
  });
  it('sends back a message that says a different number from the check, or none at all', async () => {
    const wrong = submit([battery], { message: 'I\'ll hold it to 8 hours on a 1000 mAh battery. Sound right?' });
    const { events, outcome } = await turn({ message: 'A timer' }, replay(wrong, submit([battery], { message: '' }), submit([battery])), fakeBoard().board);
    assert.equal(outcome, 'awaiting-confirmation');
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /message has to say 4/.test(e.summary)));
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /two or three plain sentences/.test(e.summary)));
  });
  it('sends back a message claiming it works', async () => {
    const { events } = await turn({ message: 'A timer' }, replay(submit([], { message: 'This board works.' }), submit([battery])), fakeBoard().board);
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /claims/.test(e.summary)));
  });
  it('sends a rejected requirement back to the Verifier', async () => {
    const { events, outcome } = await turn({ message: 'A timer' }, replay(submit([{ ...battery, metric: 'nope' }]), submit([battery])), fakeBoard().board);
    assert.equal(outcome, 'awaiting-confirmation');
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /isn't a metric/.test(e.summary)));
  });
  it('goes straight to design when there is nothing to agree', async () => {
    const { board, created } = fakeBoard();
    const { outcome } = await turn({ message: 'A timer' }, replay(submit([]), propose), board);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 1);
  });
  it('changes the card from chat, and asks again', async () => {
    const provider = replay(submit([{ ...battery, value: 3, plain: 'Runs at least 3 hours on a 1000 mAh battery', source: 'maker' }]));
    const { outcome, events } = await turn({ message: 'make it 3 hours', brief: 'A timer', requirements: [battery] }, provider, fakeBoard().board);
    assert.equal(outcome, 'awaiting-confirmation');
    const card = events.find((e): e is Extract<AgentEvent, { type: 'requirements' }> => e.type === 'requirements')!;
    assert.equal(card.requirements[0]!.value, 3);
    assert.equal(card.brief, 'A timer');
  });
  it('confirmed: code writes the requirements on the design, whatever the model sent', async () => {
    const { board, created } = fakeBoard();
    const sneaky = tool('d', 'propose_design', { design: { ...timer, requirements: [{ ...battery, value: 0 }] }, summary: 'A timer.' });
    const { outcome, events } = await turn({ message: 'A timer', requirements: [battery], requirementsConfirmed: true }, replay(sneaky), board);
    assert.equal(outcome, 'built');
    assert.deepEqual(created[0]?.design?.requirements, [battery]);
    assert.ok(events.some(e => e.type === 'verify'));
  });
  it('runs no Verifier on a server with no engine', async () => {
    const { board, created } = fakeBoard();
    await turn({ message: 'A timer' }, replay(propose), board, null);
    assert.equal(created.length, 1);
  });
});

describe('the requirement gate', () => {
  it('stops before building with numbers, when moving parts can\'t help', async () => {
    const { board, created } = fakeBoard();
    const hard = { ...battery, value: 100, plain: 'Runs 100 hours on 1000 mAh' };
    const { outcome, messages, events } = await turn({ message: 'A timer', requirements: [hard], requirementsConfirmed: true }, replay(propose), board);
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(messages.some(m => /Requirement gate failed, so nothing was built/.test(m) && /Runs 100 hours on 1000 mAh/.test(m) && /Measured/.test(m)));
    const shown = events.find((e): e is Extract<AgentEvent, { type: 'verify' }> => e.type === 'verify')!;
    assert.equal(shown.ok, false);
    assert.equal(shown.results[0]!.plain, 'Runs 100 hours on 1000 mAh');
  });
  it('sends a board that is too big to the Fixer, then passes with the new size', async () => {
    const { board, created } = fakeBoard([[90, 75], [58, 39]]);
    const fits = { ...size, value: [60, 40] as [number, number] };
    const fix = tool('f', 'propose_fix', { reason: 'Smaller board.', edits: { board: { widthMm: 58, heightMm: 39 } } });
    const { outcome, events } = await turn({ message: 'A timer', requirements: [fits], requirementsConfirmed: true }, replay(propose, tool('r', 'read_job', {}), fix), board);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 2);
    assert.deepEqual(created[1]?.design?.requirements, [fits]);
    const last = events.filter((e): e is Extract<AgentEvent, { type: 'verify' }> => e.type === 'verify').at(-1)!;
    assert.equal(last.ok, true);
  });
  it('reports the failed requirement with numbers when the Fixer can\'t meet it', async () => {
    const { board } = fakeBoard();
    const { outcome, messages } = await turn({ message: 'A timer', requirements: [size], requirementsConfirmed: true }, replay(propose, tool('g', 'give_up', { reason: 'The parts need more room.' })), board);
    assert.equal(outcome, 'build-failed');
    assert.ok(messages.some(m => /Requirement failed: Fits within 60 by 40 mm/.test(m) && /90,75/.test(m)));
  });
  it('shows unsupported honestly, and never counts it as done', async () => {
    const { board } = fakeBoard();
    const later = { id: 'cost', plain: 'Costs under 5 dollars', metric: 'bom_cost_usd', op: '<=', value: 5, source: 'brief' } as Requirement;
    const { outcome, events, messages } = await turn({ message: 'A timer', requirements: [later], requirementsConfirmed: true }, replay(propose), board);
    assert.equal(outcome, 'built-unverified');
    assert.ok(messages.some(m => /Built, but not done: 1 requirement couldn’t be checked\. Costs under 5 dollars/.test(m)));
    const last = events.filter((e): e is Extract<AgentEvent, { type: 'verify' }> => e.type === 'verify').at(-1)!;
    assert.equal(last.results[0]!.status, 'unsupported');
  });
  it('runs after every change, and the Editor\'s ops can\'t touch the requirements', async () => {
    const { board, created } = fakeBoard();
    const current: CircuitDesign = { ...timer, requirements: [battery] };
    const { events } = await turn({ message: 'move the USB to the left', design: current, jobId: '11111111-1111-4111-8111-111111111111' }, replay(tool('e', 'propose_edit', { summary: 'USB left.', edits: { usbEdge: 'left' } })), board);
    assert.deepEqual(created[0]?.design?.requirements, [battery]);
    assert.ok(events.some(e => e.type === 'verify'));
    const changed = applyChange(current, { ops: [{ op: 'set_pin', net: 'none', gpio: 5 }] });
    assert.ok('error' in changed || changed.design.requirements?.[0]?.value === 4);
  });
  it('only the maker can loosen a requirement: the Editor hands over and the card comes back', async () => {
    const { board, created } = fakeBoard();
    const current: CircuitDesign = { ...timer, requirements: [battery] };
    const { outcome, events } = await turn({ message: '2 hours is fine', design: current, jobId: '11111111-1111-4111-8111-111111111111' }, replay(tool('e', 'change_requirements', { request: 'Runs 2 hours', summary: 'Change the battery target.' }), submit([{ ...battery, value: 2, plain: 'Runs at least 2 hours on a 1000 mAh battery', source: 'maker' }])), board);
    assert.equal(outcome, 'awaiting-confirmation');
    assert.equal(created.length, 0);
    const card = events.find((e): e is Extract<AgentEvent, { type: 'requirements' }> => e.type === 'requirements')!;
    assert.equal(card.existing, true);
  });
  it('rebuilds with the new list once the maker confirms it for a device on screen', async () => {
    const { board, created } = fakeBoard();
    const current: CircuitDesign = { ...timer, requirements: [battery] };
    const relaxed = { ...battery, value: 2, plain: 'Runs at least 2 hours on a 1000 mAh battery', source: 'maker' as const };
    const { outcome } = await turn({ message: 'A timer', design: current, jobId: '11111111-1111-4111-8111-111111111111', requirements: [relaxed], requirementsConfirmed: true }, replay(), board);
    assert.equal(outcome, 'built');
    assert.deepEqual(created[0]?.design?.requirements, [relaxed]);
  });
});

describe('with chip_eda\'s real engine', () => {
  const real: VerifyEngine = { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements };
  it('gives hypothetical hours on a USB-only carrier, unchecked rather than passed', async () => {
    const { board } = fakeBoard();
    const { outcome, events, messages } = await turn({ message: 'A timer', requirements: [battery], requirementsConfirmed: true }, replay(propose), board, real);
    assert.equal(outcome, 'built-unverified');
    const last = events.filter((e): e is Extract<AgentEvent, { type: 'verify' }> => e.type === 'verify').at(-1)!;
    assert.equal(last.results[0]!.status, 'unsupported');
    assert.equal(typeof last.results[0]!.measured, 'number');
    assert.ok(messages.some(m => /Built, but not done/.test(m)));
  });
  it('fails a board that is too big, with its real size', () => {
    const facts = factsFromDesign(timer, { board: { widthMm: 90, heightMm: 75, layers: 2, traceCount: 1, viaCount: 0 } } as never);
    const gate = evaluateRequirements([size], facts);
    assert.equal(gate.ok, false);
    assert.equal(gate.results![0]!.status, 'fail');
  });
  it('passes what the facts support, and leaves a nominal voltage unchecked', () => {
    const facts = factsFromDesign(timer);
    const gate = evaluateRequirements([
      { id: 'parts', plain: 'At most 6 parts', metric: 'part_count', op: '<=', value: 6, source: 'brief' },
      { id: 'screen', plain: 'Has a screen', metric: 'interface_present', args: { kind: 'display' }, op: 'present', source: 'brief' },
      { id: 'rail', plain: 'The rail is between 3.2 and 3.4 V', metric: 'net_voltage', args: { net: '+3V3' }, op: 'within', value: [3.2, 3.4], unit: 'V', source: 'inferred' },
    ], facts);
    assert.deepEqual(gate.results!.map(r => r.status), ['pass', 'pass', 'unsupported']);
  });
});

describe('carrier facts', () => {
  it('gives an estimated load and no battery, and the real board size once built', () => {
    const facts = factsFromDesign(timer);
    assert.equal(facts.loadMa?.estimated, true);
    assert.ok(facts.loadMa!.typical > 0 && facts.loadMa!.peak >= facts.loadMa!.typical);
    assert.equal(facts.batteryPresent, false);
    assert.deepEqual(facts.netVolts, {});
    assert.equal(facts.boardMm, undefined);
    assert.ok(facts.interfaces.includes('display') && facts.interfaces.includes('knob'));
    assert.deepEqual(factsFromDesign(timer, { board: { widthMm: 90, heightMm: 75, layers: 2, traceCount: 1, viaCount: 0 } } as never).boardMm, [90, 75]);
  });
});


describe('live events', () => {
  it('reports each Designer step, with the whole design once proposed', async () => {
    const { events } = await turn({ message: 'A timer', requirements: [battery], requirementsConfirmed: true }, replay(tool('a', 'list_catalog', {}), tool('b', 'get_module', { id: timer.parts[0]!.module }), propose), fakeBoard().board);
    const partials = events.filter((e): e is Extract<AgentEvent, { type: 'plan.partial' }> => e.type === 'plan.partial');
    assert.deepEqual(partials.map(p => p.step.split(' ')[0]), ['Reading', 'Reading', 'Reading', 'Laying']);
    assert.equal(partials[0]!.design, undefined);
    assert.equal(partials.at(-1)!.design?.parts.length, timer.parts.length);
  });
  it('keeps a malformed or boastful draft off the canvas, and still reports the step', async () => {
    const provider = replay(tool('a', 'validate_design', { design: { parts: 'nope' } }), tool('b', 'validate_design', { design: { ...timer, title: 'This board works' } }), propose);
    const { events } = await turn({ message: 'A timer', requirements: [battery], requirementsConfirmed: true }, provider, fakeBoard().board);
    const partials = events.filter((e): e is Extract<AgentEvent, { type: 'plan.partial' }> => e.type === 'plan.partial');
    assert.equal(partials[1]!.design, undefined);
    assert.equal(partials[2]!.design, undefined);
    assert.ok(partials.at(-1)!.design);
  });
  it('runs no partials on a turn that only asks', async () => {
    const { events } = await turn({ message: 'A timer' }, replay(submit([battery])), fakeBoard().board);
    assert.equal(events.filter(e => e.type === 'plan.partial').length, 0);
  });
});

describe('deciding what can be built, before offering anything', () => {
  const BRIEF = 'Design an RP2040 motor controller';
  const cannot = (extra: Record<string, unknown> = {}) => tool('c', 'cannot_build', { missing: ['RP2040', 'motor driver'], closest_brief: 'An ESP32 board with a rotary encoder and a screen', chip_level: true, message: 'This mode has no RP2040 and no motor driver. The closest I can build is an ESP32 board with a rotary encoder and a screen. Chip-level mode will cover the RP2040 and motor drivers.', ...extra });
  const decline = tool('d', 'decline', { message: 'No part here can drive a motor.', closest: '', closest_brief: '' });
  const spy = (inner: ReturnType<typeof replay>) => {
    const seen: { system: string; tools: string[] }[] = [];
    const provider = { name: inner.name, model: inner.model, reserveFactor: inner.reserveFactor, call(request: Parameters<typeof inner.call>[0]) {
      seen.push({ system: request.system, tools: request.tools.map(t => t.name) });
      return inner.call(request);
    } } as ReturnType<typeof replay>;
    return { provider, seen };
  };
  const chipTurnOf = async (request: TurnRequest, provider: ReturnType<typeof replay>) => {
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ ...request, mode: 'chip' }, { provider, board: fakeBoard().board, emit: e => events.push(e), pollMs: 1, verify: engine!, chip: { blocks: () => [] } as never });
    return { outcome, events };
  };

  it('says plainly it can\'t build this brief, with no card, no design and no build', async () => {
    const board = fakeBoard();
    const { outcome, events } = await turn({ message: BRIEF }, replay(cannot()), board.board);
    assert.equal(outcome, 'declined');
    const said = events.find((e): e is Extract<AgentEvent, { type: 'decline' }> => e.type === 'decline')!;
    assert.match(said.message, /no RP2040 and no motor driver/);
    assert.match(said.message, /closest I can build/);
    assert.match(said.message, /Chip-level mode/);
    assert.equal(said.closestBrief, 'An ESP32 board with a rotary encoder and a screen');
    assert.equal(events.filter(e => e.type === 'requirements').length, 0);
    assert.equal(events.filter(e => e.type === 'design' || e.type === 'job').length, 0);
    assert.equal(board.created.length, 0);
  });
  it('tells the Verifier what this mode really has, and lets it refuse or ask', async () => {
    const { provider, seen } = spy(replay(cannot()));
    await turn({ message: BRIEF }, provider, fakeBoard().board);
    assert.match(seen[0]!.system, /ESP32-DevKitC/);
    assert.match(seen[0]!.system, /never swap in another/);
    assert.doesNotMatch(seen[0]!.system, /What can be built right now:[^\n]*RP2040/);
    assert.ok(seen[0]!.tools.includes('cannot_build') && seen[0]!.tools.includes('ask_maker'));
  });
  it('adds the chip-level sentence if the model left it out, and only when it applies', async () => {
    const plain = 'This mode has no RP2040. The closest is an ESP32 board.';
    const told = async (extra: Record<string, unknown>) => (await turn({ message: BRIEF }, replay(cannot({ message: plain, ...extra })), fakeBoard().board)).events.find((e): e is Extract<AgentEvent, { type: 'decline' }> => e.type === 'decline')!.message;
    assert.match(await told({}), /Chip-level mode will cover this/);
    assert.equal(await told({ chip_level: false }), plain);
  });
  it('sends a refusal back when it says nothing useful, or claims too much', async () => {
    for (const bad of [{ missing: [] }, { closest_brief: '' }, { message: '' }, { message: 'This board works already.' }]) {
      const { events } = await turn({ message: BRIEF }, replay(cannot(bad), cannot()), fakeBoard().board);
      assert.ok(events.some(e => e.type === 'tool' && e.name === 'cannot_build' && !e.ok));
      assert.equal(events.filter(e => e.type === 'decline').length, 1);
    }
  });
  it('never makes a card from zero checks: the exact failure goes to the Designer, which says no', async () => {
    // What the live model did: nothing checkable, and a question nobody could answer with a button.
    const zero = submit([], { not_checkable: ['That it uses an RP2040.', 'That it controls a motor.'], message: 'I\'ll build a motor controller based on the RP2040. Does that sound right?' });
    const { outcome, events } = await turn({ message: BRIEF }, replay(zero, decline), fakeBoard().board);
    assert.equal(outcome, 'declined');
    assert.equal(events.filter(e => e.type === 'requirements').length, 0);
    assert.ok(!events.some(e => e.type === 'message' && /sound right/.test(e.text)));
    assert.ok(events.some(e => e.type === 'tool' && e.role === 'designer'));
  });
  it('proceeds on a confirm with no checks, instead of refusing it', async () => {
    const { outcome, events } = await turn({ message: BRIEF, brief: BRIEF, requirementsConfirmed: true }, replay(decline), fakeBoard().board);
    assert.equal(outcome, 'declined');
    assert.ok(!events.some(e => e.type === 'error'));
  });
  it('asks a vague brief one round of questions when it can be built', async () => {
    const question = 'Which kind of motor is it: DC, stepper or servo? How is it powered, and how do you want to control it?';
    const { outcome, events } = await chipTurnOf({ message: BRIEF }, replay(tool('a', 'ask_maker', { message: question })));
    assert.equal(outcome, 'awaiting-confirmation');
    assert.ok(events.some(e => e.type === 'message' && e.role === 'verifier' && e.text === question));
    assert.equal(events.filter(e => e.type === 'requirements' || e.type === 'decline').length, 0);
  });
  it('doesn\'t tell a chip-level maker to wait for chip-level mode', async () => {
    const { events } = await chipTurnOf({ message: 'A mains dimmer' }, replay(cannot({ message: 'No mains voltage here. The closest is a low-voltage LED dimmer.' })));
    assert.doesNotMatch((events.find(e => e.type === 'decline') as { message: string }).message, /Chip-level/);
  });
  it('takes the answer, stops asking, and carries the whole device into the card', async () => {
    const whole = 'An RP2040 controller for one 12 V DC motor, with a speed knob';
    const history = [{ role: 'user', text: BRIEF }, { role: 'agent', text: 'Which kind of motor is it?' }] as ChatLine[];
    const { provider, seen } = spy(replay(submit([battery], { brief: whole })));
    const { outcome, events } = await chipTurnOf({ message: 'DC, 12 V, with a knob', history }, provider);
    assert.equal(outcome, 'awaiting-confirmation');
    assert.ok(!seen[0]!.tools.includes('ask_maker'));
    assert.ok(seen[0]!.tools.includes('cannot_build'));
    assert.equal((events.find(e => e.type === 'requirements') as { brief: string }).brief, whole);
  });
  it('refuses a question with no question in it', async () => {
    const { events } = await chipTurnOf({ message: BRIEF }, replay(tool('a', 'ask_maker', { message: 'Tell me more.' }), tool('b', 'ask_maker', { message: 'Which motor?' })));
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'ask_maker' && !e.ok));
  });
  it('removes the last check from a board that exists without asking to confirm nothing', async () => {
    const board = fakeBoard();
    const { events } = await turn({ message: 'drop all the checks', brief: 'A timer', requirements: [battery], design: { ...timer, requirements: [battery] } }, replay(submit([], { message: 'Removed them.' })), board.board);
    assert.equal(events.filter(e => e.type === 'requirements').length, 0);
    assert.deepEqual((board.created[0] as { design: CircuitDesign }).design.requirements, []);
  });
  it('doesn\'t offer refusal or questions when only changing checks', async () => {
    const { provider, seen } = spy(replay(submit([{ ...battery, source: 'maker' }])));
    await turn({ message: 'make it 4 hours', brief: 'A timer', requirements: [battery] }, provider, fakeBoard().board);
    assert.ok(!seen[0]!.tools.includes('cannot_build') && !seen[0]!.tools.includes('ask_maker'));
  });
});
