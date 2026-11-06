import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { BoardClient, JobInput } from '../src/agents/board-client.js';
import { applyDesignOps, parseBoardEdits, parseOps } from '../src/agents/edits.js';
import { assessJob, claimsPhysicalProof, closingLine, guardClaims, type AgentJob } from '../src/agents/facts.js';
import { AgentStop, agentStatus, anthropicBilling, costOf, createProvider, JobBudget, priceOf, recordingProvider, redact, replayProvider, type ModelProvider, type ModelRequest, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent, TurnRequest } from '../src/agents/protocol.js';
import { routeTurn, runTurn } from '../src/agents/turn.js';
import { catalogListing, moduleDetail, validateDesign } from '../src/agents/tools.js';
import { interpretBrief } from '../src/circuit/interpret.js';
import type { CircuitDesign } from '../src/circuit/model.js';
import { buildDesign } from '../src/circuit/templates.js';

const fixture = (id: string): ReplayFixture => JSON.parse(readFileSync(resolve('tests/agent-fixtures', `${id}.json`), 'utf8'));
const replay = (id: string) => replayProvider(fixture(id));
const designOf = (brief: string): CircuitDesign => {
  const read = interpretBrief(brief);
  assert.ok(read.ok, brief);
  return buildDesign(read.interpretation);
};
const TIMER = 'A 25 minute focus timer with a small screen and a knob';
const UUID = '11111111-1111-4111-8111-111111111111';

type JobScript = Partial<AgentJob>;
const passing: JobScript = {
  status: 'done', totalMs: 30000, cache: 'miss', drc: { checked: true, errors: [], warnings: [] },
  stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'enclosure', status: 'done', ms: 1 }, { name: 'firmware', status: 'done', ms: 1 }, { name: 'firmware-compile', status: 'done', ms: 1 }],
  artifacts: { 'enclosure-base.stl': { url: '/x', bytes: 1, sha256: 'a', kind: 'stl' } },
};
const tooSmall: JobScript = { ...passing, drc: { checked: true, errors: [{ type: 'pcb_component_outside_board_error', message: 'U1 is outside the board' }], warnings: [] } };

/** A board service with scripted results. Records what it was asked to build. */
function fakeBoard(script: JobScript[]) {
  const created: JobInput[] = [];
  const jobs = new Map<string, AgentJob>();
  const board: BoardClient = {
    async create(input) {
      const n = created.push(input);
      const jobId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
      const scripted = script[Math.min(n - 1, script.length - 1)] ?? passing;
      jobs.set(jobId, { jobId, createdAt: '', totalMs: 0, board: { widthMm: 90, heightMm: 70, layers: 2, traceCount: 9, viaCount: 0 }, toolVersions: {}, ...scripted, input: { kind: 'design', sourceSha256: 'x', ...(input.edits ? { edits: input.edits } : {}), ...(input.baseJobId ? { baseJobId: input.baseJobId } : {}) } } as AgentJob);
      return { jobId };
    },
    async get(jobId) {
      const job = jobs.get(jobId);
      if (job) return job;
      return { jobId, createdAt: '', totalMs: 1, board: { widthMm: 90, heightMm: 70, layers: 2, traceCount: 9, viaCount: 0 }, toolVersions: {}, ...passing, input: { kind: 'design', sourceSha256: 'x' } } as AgentJob;
    },
    async artifact() { return null; },
  };
  return { board, created };
}

async function turn(provider: ModelProvider, request: TurnRequest, script: JobScript[] = [passing], capUsd?: number, signal?: AbortSignal) {
  const events: AgentEvent[] = [];
  const { board, created } = fakeBoard(script);
  const outcome = await runTurn(request, { provider, board, emit: e => events.push(e), pollMs: 1, ...(capUsd !== undefined ? { capUsd } : {}), ...(signal ? { signal } : {}) });
  const of = <K extends AgentEvent['type']>(type: K) => events.filter((e): e is Extract<AgentEvent, { type: K }> => e.type === type);
  return { outcome, events, created, of };
}

// Every test here must stay offline. Anything reaching for the network fails the run.
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => { throw new Error('Network access in an agent test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

describe('model interface', () => {
  it('prices calls from usage, counting cache reads and writes at their own rates', () => {
    const cost = costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }, priceOf('claude-sonnet-5-5', {}));
    assert.ok(Math.abs(cost - (2 + 10 + 0.2 + 2.5)) < 1e-9);
  });

  it('assumes a high price for a model it cannot price, and marks the cost as estimated', () => {
    const price = priceOf('gpt-unknown-1', {});
    assert.equal(price.known, false);
    assert.ok(price.output >= 10);
    const budget = new JobBudget(2, {});
    const record = budget.charge('designer', 'openai', { content: [], stopReason: 'end_turn', model: 'gpt-unknown-1', usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } }, 5);
    assert.equal(record.estimated, true);
    assert.equal(budget.totals().estimated, true);
    assert.equal(priceOf('gpt-unknown-1', { MOKI_AGENT_PRICE: '1,4' }).known, true);
  });

  it('charges a declined attempt as well as the fallback that answered, each at its own price', () => {
    const budget = new JobBudget(2, {});
    const billed = anthropicBilling([
      { type: 'message', input_tokens: 1000, output_tokens: 100 },
      { type: 'fallback_message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ], 'claude-sonnet-5-5');
    const record = budget.charge('designer', 'anthropic', { content: [], stopReason: 'end_turn', model: 'claude-opus-5-5', usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, billed }, 1);
    const expected = (1000 * 2 + 100 * 10 + 1000 * 4 + 500 * 20) / 1e6;
    assert.ok(Math.abs(record.costUsd - expected) < 1e-9, String(record.costUsd));
    assert.equal(record.outputTokens, 600);
    assert.equal(record.estimated, false);
  });

  it('shrinks a call to what the cap can still pay for, and refuses one it cannot', () => {
    const request: ModelRequest = { system: 's', messages: [{ role: 'user', text: 'hi' }], tools: [], maxTokens: 8000 };
    const provider = { model: 'claude-sonnet-5-5', reserveFactor: 1 };
    assert.equal(new JobBudget(2, {}).preflight(request, provider), 8000);
    const low = new JobBudget(0.05, {}).preflight(request, provider);
    assert.ok(low < 8000 && low * 10 / 1e6 <= 0.05, String(low));
    assert.throws(() => new JobBudget(0.001, {}).preflight(request, provider), (e: AgentStop) => e.reason === 'budget');
  });

  it('reserves for a server-side fallback when the provider can bill a second model', () => {
    const request: ModelRequest = { system: 's', messages: [{ role: 'user', text: 'hi' }], tools: [], maxTokens: 64000 };
    const plain = new JobBudget(0.3, {}).preflight(request, { model: 'claude-sonnet-5-5', reserveFactor: 1 });
    const reserved = new JobBudget(0.3, {}).preflight(request, { model: 'claude-sonnet-5-5', reserveFactor: 3 });
    assert.ok(reserved < plain / 2.5, `${reserved} vs ${plain}`);
  });

  it('never lets a key out through an error message', () => {
    assert.equal(redact('401 for key sk-ant-api03-abcDEF123456 today'), '401 for key [redacted] today');
    assert.equal(redact('bad sk-proj_abcdefgh12345'), 'bad [redacted]');
  });

  it('turns itself off for the kill switch and for no key, and says which', () => {
    const off = agentStatus({ MOKI_AGENTS: 'off', ANTHROPIC_API_KEY: 'k' });
    assert.equal(off.enabled, false);
    assert.match(off.reason!, /MOKI_AGENTS=off/);
    assert.equal(createProvider({ MOKI_AGENTS: 'OFF', ANTHROPIC_API_KEY: 'k' }), null);
    const none = agentStatus({});
    assert.equal(none.enabled, false);
    assert.match(none.reason!, /No model key/);
    assert.equal(createProvider({}), null);
  });

  it('stays off on a public host with no token, since anyone could spend the budget', () => {
    const open = agentStatus({ ANTHROPIC_API_KEY: 'k', MOKI_PUBLIC_HOST: 'moki.example' });
    assert.equal(open.enabled, false);
    assert.match(open.reason!, /MOKI_BOARD_API_TOKEN/);
    assert.equal(agentStatus({ ANTHROPIC_API_KEY: 'k', MOKI_PUBLIC_HOST: 'moki.example', MOKI_BOARD_API_TOKEN: 't' }).enabled, true);
  });

  it('picks the provider from the keys, with the model the brief names as default', () => {
    assert.deepEqual([agentStatus({ ANTHROPIC_API_KEY: 'k' }).provider, agentStatus({ ANTHROPIC_API_KEY: 'k' }).model], ['anthropic', 'claude-sonnet-5-5']);
    assert.equal(agentStatus({ ANTHROPIC_API_KEY: 'k', MOKI_AGENT_MODEL: 'claude-opus-5-5' }).model, 'claude-opus-5-5');
    assert.deepEqual([agentStatus({ OPENAI_API_KEY: 'k' }).provider, agentStatus({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' }).model], ['openai', 'm']);
    assert.equal(agentStatus({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', MOKI_AGENT_PROVIDER: 'openai' }).provider, 'openai');
    assert.equal(agentStatus({ OPENAI_API_KEY: 'o', MOKI_AGENT_PROVIDER: 'anthropic' }).enabled, false);
  });

  it('replay serves calls in order, marks estimates, and treats running out as an error', async () => {
    const provider = replayProvider({ id: 't', provenance: 'authored', calls: [{ content: [{ type: 'text', text: 'hello' }], stopReason: 'end_turn' }] });
    const request: ModelRequest = { system: 's', messages: [], tools: [], maxTokens: 10 };
    const response = await provider.call(request);
    assert.equal(response.estimated, true);
    assert.ok(response.usage.outputTokens > 0);
    await assert.rejects(provider.call(request), /has no call 2/);
  });

  it('a recording replays to the same answers with the real usage', async () => {
    const live = replayProvider({ id: 'live', provenance: 'authored', calls: [{ content: [{ type: 'text', text: 'yes' }], stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } }] });
    const recorder = recordingProvider(live, 'r', 'brief');
    await recorder.call({ system: 's', messages: [], tools: [], maxTokens: 10 });
    const saved = recorder.fixture();
    assert.equal(saved.provenance, 'recorded');
    const again = await replayProvider(saved).call({ system: 's', messages: [], tools: [], maxTokens: 10 });
    assert.deepEqual(again.usage, { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
    assert.equal(again.estimated, false);
  });
});

describe('catalog tools and validation', () => {
  it('lists only catalog modules, with exact pins on request', () => {
    assert.equal(catalogListing().modules.length, 9);
    assert.equal(moduleDetail('nope'), null);
    assert.ok(moduleDetail('esp32-devkitc-v4')!.pins.some(p => p.id === 'GPIO32'));
  });

  it('accepts every template the rule interpreter can build', () => {
    for (const brief of [TIMER, 'A little lamp that turns on when the room gets darker than 30%', 'A temperature monitor with a probe and a screen that alerts above 28 °C']) assert.deepEqual(validateDesign(designOf(brief)), []);
  });

  it('accepts every design the replay fixtures propose', () => {
    for (const id of ['template-focus-timer', 'template-light-lamp', 'template-temp-monitor', 'off-freezer-alarm', 'off-reading-nook', 'off-desk-climate', 'off-nursery-cold']) {
      const proposal = fixture(id).calls.at(-1)!.content.find(b => b.type === 'tool_use') as { input: { design: CircuitDesign } };
      assert.deepEqual(validateDesign(proposal.input.design), [], id);
    }
  });

  it('refuses a module outside the catalog', () => {
    const design = designOf(TIMER);
    design.parts.push({ id: 'M1', module: 'servo-sg90', role: 'Moves.' });
    assert.match(validateDesign(design).join(), /unknown module/);
  });

  it('refuses a part the firmware family would silently ignore', () => {
    const lamp = designOf('A little lamp that turns on when the room gets darker than 30%');
    lamp.parts.push({ id: 'BZ1', module: 'piezo-passive-12mm', role: 'Beeps.' });
    lamp.nets.push({ id: 'BUZZER', name: 'BUZZER', kind: 'signal', endpoints: [{ part: 'U1', pin: 'GPIO23' }, { part: 'BZ1', pin: '+' }], why: 'x' });
    lamp.nets.find(n => n.kind === 'ground')!.endpoints.push({ part: 'BZ1', pin: '-' });
    assert.match(validateDesign(lamp).join(), /firmware doesn't drive piezo/);
  });

  it('runs the firmware generator, so an unusable setting is caught before a build', () => {
    const timer = designOf(TIMER);
    timer.behavior = timer.behavior.map(b => (b.label === 'Session length' ? { ...b, value: 'nine hundred min' } : b));
    assert.match(validateDesign(timer).join(), /Firmware generator: Invalid firmware behavior/);
  });

  it('refuses design text that claims a physical result', () => {
    const timer = designOf(TIMER);
    timer.title = 'This device has been printed and it works';
    assert.match(validateDesign(timer).join(), /may not claim/);
  });

  it('refuses a non-object and an oversized graph', () => {
    assert.notDeepEqual(validateDesign(null), []);
    const timer = designOf(TIMER);
    timer.notes = Array.from({ length: 11 }, () => ({ level: 'info' as const, text: 'x' }));
    assert.match(validateDesign(timer).join(), /Too many/);
  });
});

describe('claim guard', () => {
  it('catches physical claims and leaves honest sentences alone', () => {
    for (const claim of ['The board has been printed.', 'It works.', 'This device is working.', 'The firmware was flashed.', 'Tested on real hardware.', 'It is safe to leave plugged in.', 'Guaranteed to fit.', 'This board works and you can download it.', 'Your timer works.', 'I flashed the board.'])
      assert.equal(claimsPhysicalProof(claim), true, claim);
    for (const honest of ['The firmware compiled.', 'Nothing has been printed.', 'It hasn’t been flashed.', 'A knob works by pulsing two pins.', 'Once it has been printed, check the fit.', 'The DRC shows 0 errors.', 'U2 is the screen.', 'The firmware has not been flashed.', 'You can check that it works once it is printed.'])
      assert.equal(claimsPhysicalProof(honest), false, honest);
  });

  it('removes only the claim and adds what is known', () => {
    const { text, changed } = guardClaims('The firmware compiled. It works.');
    assert.equal(changed, true);
    assert.match(text, /The firmware compiled\./);
    assert.doesNotMatch(text, /It works/);
    assert.match(text, /Nothing has been printed/);
  });
});

describe('design operations', () => {
  it('rejects malformed operations with a reason', () => {
    assert.match((parseOps([{ op: 'rm_rf' }]) as { error: string }).error, /unknown op/);
    assert.match((parseOps('x') as { error: string }).error, /array/);
    assert.match((parseOps(Array(13).fill({ op: 'remove_part', id: 'X' })) as { error: string }).error, /At most/);
  });

  it('never mutates the design it is given', () => {
    const before = designOf(`${TIMER} and a buzzer`);
    const copy = structuredClone(before);
    const out = applyDesignOps(before, [{ op: 'set_pin', net: 'BUZZER', gpio: 18 }]);
    assert.ok('design' in out);
    assert.deepEqual(before, copy);
    assert.ok(out.design.nets.find(n => n.id === 'BUZZER')!.endpoints.some(e => e.pin === 'GPIO18'));
  });

  it('only offers pins that are safe to assign', () => {
    const before = designOf(`${TIMER} and a buzzer`);
    assert.match((applyDesignOps(before, [{ op: 'set_pin', net: 'BUZZER', gpio: 0 }]) as { error: string }).error, /can't be chosen/);
    assert.match((applyDesignOps(before, [{ op: 'set_pin', net: 'NOPE', gpio: 18 }]) as { error: string }).error, /no net/);
  });

  it('bounds board edits and rejects unknown parts', () => {
    assert.match((parseBoardEdits({ board: { widthMm: 5, heightMm: 70 } }) as { error: string }).error, /20–300/);
    assert.match((parseBoardEdits({ board: { widthMm: 40, heightMm: 40, cornerRadiusMm: 30 } }) as { error: string }).error, /Corner radius/);
    assert.match((parseBoardEdits({ usbEdge: 'middle' }) as { error: string }).error, /usbEdge/);
    assert.match((parseBoardEdits({ placements: [{ refdes: 'Q9', x: 1, y: 1 }] }, designOf(TIMER)) as { error: string }).error, /no part Q9/);
    assert.match((parseBoardEdits({}) as { error: string }).error, /changes nothing/);
    assert.deepEqual(parseBoardEdits({ usbEdge: 'left' }), { edits: { usbEdge: 'left' } });
  });
});

describe('job assessment', () => {
  const job = (over: JobScript): AgentJob => ({ jobId: UUID, createdAt: '', totalMs: 1000, board: { widthMm: 1, heightMm: 1, layers: 2, traceCount: 0, viaCount: 0 }, toolVersions: {}, input: { kind: 'design', sourceSha256: 'x' }, ...passing, ...over } as AgentJob);

  it('passes only with a checked DRC, no errors, and no failed stage', () => {
    assert.equal(assessJob(job({})).ok, true);
    assert.equal(assessJob(job(tooSmall)).ok, false);
    assert.equal(assessJob(job({ status: 'failed', error: 'boom' })).ok, false);
    assert.equal(assessJob(job({ drc: { checked: false, errors: [], warnings: [] } })).ok, false);
  });

  it('does not treat a missing compiler as a failure, and does not call it compiled', () => {
    const skipped = assessJob(job({ stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'enclosure', status: 'done', ms: 1 }, { name: 'firmware-compile', status: 'skipped', ms: 0 }] }));
    assert.equal(skipped.ok, true);
    assert.equal(skipped.compile, 'not-compiled');
    assert.match(closingLine(job({ stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'firmware-compile', status: 'skipped', ms: 0 }] }), 1), /not compiled/);
  });

  it('closing lines never claim more than software checks', () => {
    for (const line of [closingLine(job({}), 1), closingLine(job(tooSmall), 3)]) {
      assert.match(line, /Nothing has been printed/);
      assert.equal(guardClaims(line).changed, false);
    }
  });
});

describe('routing', () => {
  const design = designOf(TIMER);
  it('sends each kind of message to the right agent, with no model call', () => {
    assert.equal(routeTurn({ message: 'a plant alarm' }), 'designer');
    assert.equal(routeTurn({ message: 'add a buzzer', design }), 'editor');
    assert.equal(routeTurn({ message: 'move the USB to the left', design, jobId: UUID }), 'editor');
    assert.equal(routeTurn({ message: 'can you make the case smaller?', design, jobId: UUID }), 'editor');
    assert.equal(routeTurn({ message: 'why did it fail', design, jobId: UUID }), 'explainer');
    assert.equal(routeTurn({ message: 'what does U2 do', design }), 'explainer');
    assert.equal(routeTurn({ message: 'is the USB on the left?', jobId: UUID }), 'explainer');
    assert.equal(routeTurn({ message: 'why did it fail' }), 'designer');
  });
});

describe('designer', () => {
  it('builds an off-template brief the rules refuse, reporting tools and costs', async () => {
    assert.equal(interpretBrief('A freezer door alarm that beeps if it warms above -10 degrees').ok, false);
    const { outcome, of, created } = await turn(replay('off-freezer-alarm'), { message: 'A freezer door alarm that beeps if it warms above -10 degrees' });
    assert.equal(outcome, 'built');
    assert.equal(created.length, 1);
    assert.ok('design' in created[0]! && created[0].design.title === 'Freezer alarm');
    assert.deepEqual(of('tool').map(t => t.name).slice(0, 2), ['list_catalog', 'get_module']);
    assert.ok(of('tool').every(t => typeof t.ms === 'number' && t.tokens > 0 && t.costUsd > 0 && t.estimated));
    const usage = of('done')[0]!.usage;
    assert.equal(usage.calls, 3);
    assert.equal(usage.estimated, true);
    assert.ok(usage.costUsd > 0 && usage.costUsd <= 2);
    assert.equal(usage.pipelineMs, 30000);
  });

  it('declines plainly when the catalog has no such part, and builds nothing', async () => {
    const { outcome, of, created } = await turn(replay('off-plant-moisture'), { message: 'plant moisture alarm' });
    assert.equal(outcome, 'declined');
    assert.equal(created.length, 0);
    const decline = of('decline')[0]!;
    assert.match(decline.message, /no soil moisture probe/);
    assert.ok(decline.closest && decline.closestBrief);
  });

  it('feeds validator issues back so the model can correct itself', async () => {
    const { outcome, of, created } = await turn(replay('designer-corrects-itself'), { message: 'A dusk lamp that also beeps' });
    assert.equal(outcome, 'built');
    const proposals = of('tool').filter(t => t.name === 'propose_design');
    assert.deepEqual(proposals.map(p => p.ok), [false, true]);
    assert.match(proposals[0]!.summary, /Rejected/);
    assert.equal(created.length, 1);
  });

  it('falls back to the rule interpreter when the model fails before designing', async () => {
    const failing: ModelProvider = { name: 'anthropic', model: 'claude-sonnet-5-5', reserveFactor: 1, call: async () => { throw new Error('529 overloaded for sk-ant-secret123456'); } };
    const { outcome, of, created, events } = await turn(failing, { message: 'A freezer alarm' });
    assert.equal(outcome, 'fallback');
    assert.equal(of('fallback').length, 1);
    assert.equal(created.length, 0);
    assert.doesNotMatch(JSON.stringify(events), /sk-ant/);
  });

  it('falls back on a refusal and on running out of output room', async () => {
    for (const stopReason of ['refusal', 'max_tokens'] as const) {
      const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [], stopReason }] });
      assert.equal((await turn(provider, { message: 'A lamp' })).outcome, 'fallback');
    }
  });

  it('runs no tool from a response cut off by max_tokens', async () => {
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 't', name: 'propose_design', input: {} }], stopReason: 'max_tokens' }] });
    const { of, created } = await turn(provider, { message: 'A lamp' });
    assert.equal(of('tool').length, 0);
    assert.equal(created.length, 0);
  });

  it('treats a blank answer as a failure, not a finished turn', async () => {
    for (const stopReason of ['end_turn', 'other'] as const) {
      const { outcome } = await turn(replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [], stopReason }] }), { message: 'A lamp' });
      assert.equal(outcome, 'fallback');
    }
  });

  it('only announces a design once the build service has accepted it', async () => {
    const { board } = fakeBoard([passing]);
    const { BoardServiceError } = await import('../src/agents/board-client.js');
    const refusing: BoardClient = { ...board, create: async () => { throw new BoardServiceError('Board queue is full', 429); } };
    const events: AgentEvent[] = [];
    await runTurn({ message: 'A freezer' }, { provider: replay('off-freezer-alarm'), board: refusing, emit: e => events.push(e) });
    assert.equal(events.some(e => e.type === 'design'), false);
  });

  it('stops a model that keeps calling tools without finishing', async () => {
    const call = { content: [{ type: 'tool_use' as const, id: 't', name: 'list_catalog', input: {} }], stopReason: 'tool_use' as const };
    const { outcome, of } = await turn(replayProvider({ id: 'x', provenance: 'authored', calls: Array(20).fill(call) }), { message: 'A lamp' });
    assert.equal(outcome, 'fallback');
    assert.equal(of('done')[0]!.usage.calls, 8);
  });

  it('tells the model about a tool that does not exist, without crashing', async () => {
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 't', name: 'flash_device', input: {} }], stopReason: 'tool_use' }, { content: [{ type: 'text', text: 'I can only design.' }], stopReason: 'end_turn' }] });
    const { outcome, of } = await turn(provider, { message: 'A lamp' });
    assert.equal(of('tool')[0]!.ok, false);
    assert.equal(outcome, 'answered');
  });
});

describe('the $2 cap', () => {
  it('stops before the call that would cross it, and never exceeds it', async () => {
    // A worst-case model: it uses every output token it is allowed, on every call.
    let calls = 0;
    const greedy: ModelProvider = {
      name: 'anthropic', model: 'claude-sonnet-5-5', reserveFactor: 1,
      async call(request) {
        calls++;
        return { content: [{ type: 'tool_use', id: `t${calls}`, name: 'list_catalog', input: {} }], stopReason: 'tool_use', model: 'claude-sonnet-5-5', usage: { inputTokens: Math.ceil(JSON.stringify(request).length / 3), outputTokens: request.maxTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      },
    };
    const { outcome, of } = await turn(greedy, { message: 'A lamp' }, [passing], 0.2);
    const spent = of('done')[0]!.usage;
    assert.equal(outcome, 'fallback');
    assert.ok(spent.calls < 8, String(spent.calls));
    assert.ok(spent.costUsd <= 0.2, String(spent.costUsd));
    assert.ok(spent.costUsd > 0.15, String(spent.costUsd));
  });

  it('carries one budget across the designer and every fixer retry', async () => {
    const provider = replay('fix-board-too-small');
    const { of } = await turn(provider, { message: 'make the case smaller', design: designOf(TIMER), jobId: UUID }, [tooSmall, passing]);
    const usage = of('done')[0]!.usage;
    assert.equal(usage.calls, 3);
    assert.equal(of('call').length, 3);
    assert.ok(Math.abs(of('call').reduce((s, c) => s + c.costUsd, 0) - usage.costUsd) < 1e-9);
  });
});

describe('fixer', () => {
  const edit = { design: designOf(TIMER), jobId: UUID, brief: TIMER };

  it('fixes a failing build with a new job based on the failed one', async () => {
    const { outcome, of, created } = await turn(replay('fix-board-too-small'), { message: 'make the case smaller', ...edit }, [tooSmall, passing]);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 2);
    assert.deepEqual(created[0]!.edits, { board: { widthMm: 40, heightMm: 40, cornerRadiusMm: 3 } });
    assert.deepEqual(created[1]!.edits, { board: { widthMm: 75, heightMm: 75, cornerRadiusMm: 3 } });
    const jobs = of('job');
    assert.equal(jobs[0]!.baseJobId, UUID);
    assert.equal(jobs[1]!.baseJobId, jobs[0]!.jobId);
    assert.equal(created[1]!.baseJobId, jobs[0]!.jobId);
    assert.match(jobs[1]!.label, /Fix 1 of 2/);
    assert.deepEqual(of('job-result').map(r => r.ok), [false, true]);
    assert.ok(of('message').some(m => m.role === 'fixer' && /after 1 retry/.test(m.text)));
  });

  it('can change a pin, and re-emits the design it changed', async () => {
    const buzzed = designOf(`${TIMER} and a buzzer`);
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Longer session.', ops: [{ op: 'set_behavior', label: 'Session length', value: '45 min' }] } }], stopReason: 'tool_use' }, ...fixture('fix-pin').calls] });
    const { outcome, of, created } = await turn(provider, { message: 'make it 45 minutes', design: buzzed, jobId: UUID }, [tooSmall, passing]);
    assert.equal(outcome, 'built');
    const second = created[1]! as { design: CircuitDesign };
    assert.ok(second.design.nets.find(n => n.id === 'BUZZER')!.endpoints.some(e => e.pin === 'GPIO18'));
    assert.equal(of('design').length, 2);
  });

  it('stops after two retries, whatever the model wants', async () => {
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Small.', edits: { board: { widthMm: 60, heightMm: 60 } } } }], stopReason: 'tool_use' }, ...fixture('fix-never-works').calls] });
    const { outcome, created, of } = await turn(provider, { message: 'make it smaller', ...edit }, [tooSmall]);
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 3);
    assert.equal(provider.remaining(), 2);
    assert.match(of('message').at(-1)!.text, /still has problems after 2 retries/);
    assert.match(of('message').at(-1)!.text, /Nothing has been printed/);
  });

  it('refuses a fix outside its limits, and can give up honestly', async () => {
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Small.', edits: { board: { widthMm: 60, heightMm: 60 } } } }], stopReason: 'tool_use' }, ...fixture('fix-overreach').calls] });
    const { outcome, of, created } = await turn(provider, { message: 'make it smaller', ...edit }, [tooSmall]);
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 1);
    const fix = of('tool').find(t => t.name === 'propose_fix')!;
    assert.equal(fix.ok, false);
    assert.match(fix.summary, /outside the fixer/);
    assert.ok(of('message').some(m => /renderer crashed/.test(m.text)));
  });

  it('counts a layout the build service refuses against the retry limit, and tells the fixer why', async () => {
    const { board, created } = fakeBoard([tooSmall]);
    const { BoardServiceError } = await import('../src/agents/board-client.js');
    let calls = 0;
    const refusing: BoardClient = { ...board, create: async input => { if (++calls > 1) throw new BoardServiceError('R2 would leave the board.', 400); return board.create(input); } };
    const seen: string[] = [];
    const inner = replayProvider({ id: 'x', provenance: 'authored', calls: [
      { content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Small.', edits: { board: { widthMm: 60, heightMm: 60 } } } }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'r', name: 'read_job', input: {} }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'f1', name: 'propose_fix', input: { reason: 'Bigger.', edits: { board: { widthMm: 90, heightMm: 90 } } } }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'r2', name: 'read_job', input: {} }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'f2', name: 'propose_fix', input: { reason: 'Bigger again.', edits: { board: { widthMm: 100, heightMm: 100 } } } }], stopReason: 'tool_use' },
    ] });
    const provider: ModelProvider = { ...inner, call: request => { seen.push(JSON.stringify(request.messages)); return inner.call(request); } };
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ message: 'make it smaller', ...edit }, { provider, board: refusing, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 1);
    assert.equal(calls, 3);
    assert.ok(seen.some(m => /lastChangeRefusedByBuildService/.test(m)));
  });

  it('refuses to go back to a layout that already failed, including the first one', async () => {
    const fix = (id: string, size: number) => ({ content: [{ type: 'tool_use' as const, id, name: 'propose_fix', input: { reason: 'Try this.', edits: { board: { widthMm: size, heightMm: size } } } }], stopReason: 'tool_use' as const });
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [
      { content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Small.', edits: { board: { widthMm: 60, heightMm: 60 } } } }], stopReason: 'tool_use' },
      fix('a', 90), fix('b', 60),
      { content: [{ type: 'tool_use', id: 'g', name: 'give_up', input: { reason: 'Out of ideas.' } }], stopReason: 'tool_use' },
    ] });
    const { created, of } = await turn(provider, { message: 'make it smaller', ...edit }, [tooSmall]);
    assert.equal(created.length, 2);
    assert.ok(of('tool').some(t => /already tried/.test(t.summary)));
  });

  it('refuses a fix that changes nothing, so it can never waste a retry', async () => {
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [
      { content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Small.', edits: { board: { widthMm: 60, heightMm: 60 } } } }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'f', name: 'propose_fix', input: { reason: 'Rebuild.', ops: [] } }], stopReason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 'g', name: 'give_up', input: { reason: 'Out of ideas.' } }], stopReason: 'tool_use' },
    ] });
    const { created, of } = await turn(provider, { message: 'make it smaller', ...edit }, [tooSmall]);
    assert.equal(created.length, 1);
    assert.ok(of('tool').some(t => /changes nothing/.test(t.summary)));
  });

  it('refuses to repeat a change that already failed', async () => {
    const same = { content: [{ type: 'tool_use' as const, id: 'f', name: 'propose_fix', input: { reason: 'Bigger.', edits: { board: { widthMm: 90, heightMm: 90 } } } }], stopReason: 'tool_use' as const };
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Small.', edits: { board: { widthMm: 60, heightMm: 60 } } } }], stopReason: 'tool_use' }, same, same, { content: [{ type: 'tool_use', id: 'g', name: 'give_up', input: { reason: 'Out of ideas.' } }], stopReason: 'tool_use' }] });
    const { created, of } = await turn(provider, { message: 'make it smaller', ...edit }, [tooSmall]);
    assert.equal(created.length, 2);
    assert.ok(of('tool').some(t => /already tried|changes nothing/.test(t.summary)));
  });

  it('takes a layout refusal from the job API as an answer, with nothing queued', async () => {
    const { board } = fakeBoard([passing]);
    const { BoardServiceError } = await import('../src/agents/board-client.js');
    const refusing: BoardClient = { ...board, create: async () => { throw new BoardServiceError('U1 would leave the board.', 400); } };
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ message: 'make it smaller', ...edit }, { provider: replay('edit-smaller-case'), board: refusing, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'no-change');
    assert.ok(events.some(e => e.type === 'message' && /U1 would leave the board\. Nothing was queued/.test(e.text)));
    assert.equal(events.some(e => e.type === 'error'), false);
  });

  it('does not report success when the service ignored a layout edit', async () => {
    const { board, created } = fakeBoard([passing]);
    const ignoring: BoardClient = { ...board, get: async id => { const job = await board.get(id); return { ...job, input: { kind: 'design', sourceSha256: 'x' } } as AgentJob; } };
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ message: 'move the USB to the left', ...edit }, { provider: replay('edit-usb-left'), board: ignoring, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 1);
    assert.ok(events.some(e => e.type === 'message' && /ignored the layout change/.test(e.text)));
  });
});

describe('editor', () => {
  const current = { design: designOf(TIMER), jobId: UUID, brief: TIMER };

  it('adds a buzzer as graph operations, shows the diff, and lays the board out afresh for the new part', async () => {
    const { outcome, of, created } = await turn(replay('edit-add-buzzer'), { message: 'add a buzzer', ...current });
    assert.equal(outcome, 'built');
    const built = created[0]! as { design: CircuitDesign; baseJobId?: string };
    assert.equal(built.baseJobId, undefined);
    assert.ok(built.design.parts.some(p => p.id === 'BZ1'));
    assert.deepEqual(validateDesign(built.design), []);
    assert.ok(of('design')[0]!.changes.some(c => /Added BZ1/.test(c)));
    assert.equal(of('design')[0]!.brief, `${TIMER}. add a buzzer`);
  });

  it('keeps the base job when a change leaves the parts alone, or when the maker has placed things by hand', async () => {
    const longer = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: 'Longer.', ops: [{ op: 'set_behavior', label: 'Session length', value: '45 min' }] } }], stopReason: 'tool_use' }] });
    assert.equal((await turn(longer, { message: 'make it 45 minutes', ...current })).created[0]!.baseJobId, UUID);
    const placed = await turn(replay('edit-add-buzzer'), { message: 'add a buzzer', ...current, edits: { usbEdge: 'left' } });
    assert.equal(placed.created[0]!.baseJobId, UUID);
  });

  it('says so when the build on screen is not the design being changed', async () => {
    const { board } = fakeBoard([passing]);
    const events: AgentEvent[] = [];
    for (const input of [{ kind: 'source', sourceSha256: 'x' }, { kind: 'design', designContentId: 'older', sourceSha256: 'x' }]) {
      const pinned: BoardClient = { ...board, get: async id => ({ ...(await board.get(id)), input }) as AgentJob };
      await runTurn({ message: 'add a buzzer', ...current }, { provider: replay('edit-add-buzzer'), board: pinned, emit: e => events.push(e), pollMs: 1 });
    }
    const said = events.flatMap(e => (e.type === 'message' ? [e.text] : []));
    assert.ok(said.some(t => /TSX edits/.test(t)));
    assert.ok(said.some(t => /older build/.test(t)));
  });

  it('turns layout requests into structured edits on the job API', async () => {
    const usb = await turn(replay('edit-usb-left'), { message: 'move the USB to the left', ...current });
    assert.deepEqual(usb.created[0]!.edits, { usbEdge: 'left' });
    assert.deepEqual(usb.of('edit')[0]!.changes, ['USB on the left edge']);
    const smaller = await turn(replay('edit-smaller-case'), { message: 'make the case smaller', ...current });
    assert.deepEqual(smaller.created[0]!.edits, { board: { widthMm: 80, heightMm: 65, cornerRadiusMm: 3 } });
    assert.equal(smaller.of('tool')[0]!.name, 'read_job');
  });

  it('keeps earlier layout edits when a later one adds to them', async () => {
    const { created } = await turn(replay('edit-usb-left'), { message: 'move the USB to the left', ...current, edits: { board: { widthMm: 90, heightMm: 70, cornerRadiusMm: 5 } } });
    assert.deepEqual(created[0]!.edits, { board: { widthMm: 90, heightMm: 70, cornerRadiusMm: 5 }, usbEdge: 'left' });
  });

  it('declines a part the catalog lacks, and hands a different device to the designer', async () => {
    const servo = await turn(replay('edit-out-of-catalog'), { message: 'add a servo', ...current });
    assert.equal(servo.outcome, 'declined');
    assert.equal(servo.created.length, 0);
    const other = await turn(replay('edit-other-device'), { message: 'actually make it a freezer alarm', ...current });
    assert.equal(other.outcome, 'built');
    assert.equal((other.created[0]! as { baseJobId?: string }).baseJobId, undefined);
  });
});

describe('explainer', () => {
  const current = { design: designOf(TIMER), jobId: UUID };

  it('answers from the record and starts no build', async () => {
    const { outcome, of, created } = await turn(replay('explain-failure'), { message: 'why did it fail', ...current });
    assert.equal(outcome, 'answered');
    assert.equal(created.length, 0);
    assert.equal(of('tool')[0]!.name, 'read_job');
    assert.match(of('message')[0]!.text, /pcb_component_outside_board_error/);
  });

  it('strips an overclaim even if the model writes one', async () => {
    const { of } = await turn(replay('explain-overclaims'), { message: 'does it work', ...current });
    const text = of('message')[0]!.text;
    assert.doesNotMatch(text, /has been printed and flashed/);
    assert.match(text, /The firmware compiled/);
    assert.match(text, /Nothing has been printed/);
  });

  it('has no tool that can build or change anything', async () => {
    const seen: string[] = [];
    const spy: ModelProvider = { name: 'replay', model: 'claude-sonnet-5-5', reserveFactor: 1, async call(request) { seen.push(...request.tools.map(t => t.name)); return { content: [{ type: 'text', text: 'Fine.' }], stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }; } };
    await turn(spy, { message: 'what does U2 do', ...current });
    assert.deepEqual(seen.sort(), ['get_design', 'get_module', 'read_job']);
  });
});

describe('the claim guard covers everything a model wrote', () => {
  it('cleans tool summaries, job labels and declines as well as messages', async () => {
    const overclaim = 'This board has been printed and flashed.';
    const provider = replayProvider({ id: 'x', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'e', name: 'propose_edit', input: { summary: overclaim, edits: { usbEdge: 'left' } } }], stopReason: 'tool_use' }] });
    const edited = await turn(provider, { message: 'move the USB to the left', design: designOf(TIMER), jobId: UUID });
    assert.doesNotMatch(JSON.stringify(edited.events), /has been printed and flashed/);
    const decline = replayProvider({ id: 'y', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'd', name: 'decline', input: { message: overclaim, closest: overclaim, closest_brief: 'A lamp' } }], stopReason: 'tool_use' }] });
    const declined = await turn(decline, { message: 'a rocket' });
    assert.doesNotMatch(JSON.stringify(declined.events), /has been printed and flashed/);
  });
});

describe('stopping', () => {
  it('stops without spending further when the chat closes', async () => {
    const controller = new AbortController();
    let calls = 0;
    const provider: ModelProvider = { name: 'replay', model: 'claude-sonnet-5-5', reserveFactor: 1, async call() { calls++; controller.abort(); return { content: [{ type: 'tool_use', id: 't', name: 'list_catalog', input: {} }], stopReason: 'tool_use', model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }; } };
    const { outcome } = await turn(provider, { message: 'A lamp' }, [passing], undefined, controller.signal);
    assert.equal(outcome, 'stopped');
    assert.equal(calls, 1);
  });

  it('reports a board service refusal instead of a false success', async () => {
    const { board } = fakeBoard([]);
    const events: AgentEvent[] = [];
    const refusing: BoardClient = { ...board, create: async () => { const { BoardServiceError } = await import('../src/agents/board-client.js'); throw new BoardServiceError('Board queue is full', 429); } };
    const outcome = await runTurn({ message: 'A freezer' }, { provider: replay('off-freezer-alarm'), board: refusing, emit: e => events.push(e) });
    assert.equal(outcome, 'error');
    assert.ok(events.some(e => e.type === 'error' && /queue is full/.test(e.message)));
  });
});
