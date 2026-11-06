import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentEvent } from '../../../src/agents/protocol';
import { interpretBrief } from '../../../src/circuit/interpret';
import { EMPTY_SESSION } from '../../../src/circuit/session';
import { buildDesign } from '../../../src/circuit/templates';
import type { CircuitDesign } from '../../../src/circuit/model';
import { activityBlocks, activityLine, adoptAgentDesign, interruptedText, toolSteps, agentLine, finishedLine, foldEvent, historyOf, agentLeftBuilding, isAgentTurn, isConfirmation, parseSse, pendingFromTurns, pendingRequest, plainError, settleAgentTurns, type AgentTurn, type AgentView } from './agentChat';

const blank = (): AgentView => ({ brief: 'A lamp', role: 'designer', model: 'm', items: [], working: true, usage: null });
const usage = { calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, capUsd: 2, agentMs: 1, pipelineMs: 2, estimated: false };
const designOf = (brief: string) => { const read = interpretBrief(brief); assert.ok(read.ok); return buildDesign(read.interpretation); };

it('the composer says plainly whether an agent is reading', () => {
  assert.equal(agentLine(null), 'Read by rules, not an AI model');
  assert.equal(agentLine({ enabled: false, provider: null, model: null, capUsd: 2, reason: 'x' }), 'Agent: off. Read by rules, not an AI model');
  assert.equal(agentLine({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', capUsd: 2, reason: null }), 'Agent: claude-sonnet-5-5, up to $2 a build');
});

it('parses whole server-sent events and keeps a partial one for later', () => {
  const event: AgentEvent = { type: 'role', role: 'fixer' };
  const text = `event: role\ndata: ${JSON.stringify(event)}\n\n: keepalive\n\nevent: role\ndata: {"ty`;
  const { events, rest } = parseSse(text);
  assert.deepEqual(events, [event]);
  assert.equal(rest, 'event: role\ndata: {"ty');
  assert.deepEqual(parseSse(`${rest}pe":"role","role":"editor"}\n\n`).events, [{ type: 'role', role: 'editor' }]);
});

it('drops a broken event instead of ending the stream', () => {
  assert.deepEqual(parseSse('event: x\ndata: {nope\n\n').events, []);
});

it('shows one model call\'s tokens once, across the tools it asked for', () => {
  const shared = { left: 0 };
  const tool = (name: string): AgentEvent => ({ type: 'tool', role: 'designer', name, ms: 1, ok: true, summary: '', tokens: 100, costUsd: 0.01, sharedWith: 1, estimated: false });
  let view = foldEvent(blank(), tool('a'), shared);
  view = foldEvent(view, tool('b'), shared);
  const single: AgentEvent = { type: 'tool', role: 'designer', name: 'c', ms: 1, ok: true, summary: '', tokens: 50, costUsd: 0.02, sharedWith: 0, estimated: false };
  view = foldEvent(view, single, shared);
  assert.deepEqual(view.items.map(i => (i.kind === 'tool' ? i.tokens : -1)), [100, null, 50]);
});

it('closes the turn with its usage, and a fallback replaces the brief with the reason', () => {
  const done = foldEvent(blank(), { type: 'done', outcome: 'built', usage }, { left: 0 });
  assert.equal(done.working, false);
  assert.equal(done.usage, usage);
  const fallback = foldEvent(blank(), { type: 'fallback', reason: 'The model service failed.' }, { left: 0 });
  assert.equal(fallback.brief, null);
  assert.deepEqual(fallback.items, [{ kind: 'note', text: 'The model service failed. Reading this by rules instead.' }]);
});

it('shows what changed, and adds nothing for a first design', () => {
  const design = designOf('A little lamp that turns on when the room gets darker than 30%');
  assert.equal(foldEvent(blank(), { type: 'design', design, brief: 'x', changes: [] }, { left: 0 }).items.length, 0);
  const changed = foldEvent(blank(), { type: 'edit', edits: { usbEdge: 'left' }, changes: ['USB on the left edge'] }, { left: 0 });
  assert.deepEqual(changed.items, [{ kind: 'changes', lines: ['USB on the left edge'] }]);
});

it('sends only words for context, newest last, and never tool results', () => {
  const agent = { id: 'a', kind: 'agent', view: { ...blank(), items: [{ kind: 'tool', role: 'designer', name: 'x', ms: 1, ok: true, summary: 'secret detail', tokens: 1, costUsd: 0, estimated: false }, { kind: 'message', role: 'designer', text: 'Built.' }] } };
  assert.equal(isAgentTurn(agent), true);
  assert.equal(isAgentTurn({ kind: 'brief' }), false);
  assert.equal(isAgentTurn(null), false);
  assert.deepEqual(historyOf([{ id: 'b', kind: 'brief', text: 'first' }, { id: 'r', kind: 'run' }, agent]), [{ role: 'user', text: 'first' }, { role: 'user', text: 'A lamp' }, { role: 'agent', text: 'Built.' }]);
  assert.equal(historyOf(Array.from({ length: 12 }, () => ({ kind: 'brief', text: 't' }))).length, 6);
});

it('a chat restored from storage has nothing still working', () => {
  const working: AgentTurn = { id: 'a', kind: 'agent', view: blank() };
  const other = { id: 'b', kind: 'brief', text: 'x' };
  const [settled, untouched] = settleAgentTurns<unknown>([working, other]);
  assert.equal((settled as AgentTurn).view.working, false);
  assert.equal(untouched, other);
});

describe('a turn the server restart cut off', () => {
  const requirements = [{ id: 'a', plain: 'x', metric: 'interface_present', args: { kind: 'led' }, op: 'present', source: 'brief' }];
  const card = { kind: 'requirements', requirements, notCheckable: [], message: 'Sound right?', settled: 'confirmed', brief: 'A game', existing: false, mode: 'chip' };
  const view = (brief: string | null, working: boolean, items: unknown[]) => ({ brief, role: 'designer', model: null, working, usage: null, items });
  const errorOf = (turn: unknown) => (turn as AgentTurn).view.items.filter(i => i.kind === 'error');

  it('says so in one sentence, and offers Try again with what was asked', () => {
    const [settled] = settleAgentTurns<unknown>([{ id: 'a', kind: 'agent', view: view('A lamp', true, [{ kind: 'tool', role: 'designer', name: 'x', ms: 1, ok: true, summary: '', tokens: null, costUsd: null, estimated: false }]) }]);
    const [error] = errorOf(settled);
    assert.equal(error?.kind === 'error' && error.text, interruptedText());
    assert.equal(error?.kind === 'error' && error.interrupted?.retry, 'A lamp');
    assert.equal((interruptedText().match(/\./g) ?? []).length, 1);
    assert.equal(plainError(interruptedText()), interruptedText());
  });
  it('Try again confirms the checks again, instead of sending "Looks right" as a new brief', () => {
    const asked = { id: 'a', kind: 'agent', view: view('A game', false, [card]) };
    const cut = { id: 'b', kind: 'agent', view: view('Looks right, start the design', true, [{ kind: 'tool', role: 'reviewer', name: 'read_datasheet', ms: 0, ok: true, summary: '', tokens: null, costUsd: null, estimated: false }]) };
    const settled = settleAgentTurns<unknown>([asked, cut]);
    const pending = pendingFromTurns(settled);
    assert.equal(pending?.brief, 'A game');
    assert.equal(pending?.mode, 'chip');
    const request = pendingRequest('Looks right, start the design', pending!, {} as never);
    assert.equal(request.requirementsConfirmed, true);
    assert.equal(request.message, 'A game');
  });
  it('a turn split by a build still has something to retry', () => {
    const [, settled] = settleAgentTurns<unknown>([{ id: 'a', kind: 'agent', view: view('A lamp', false, []) }, { id: 'b', kind: 'agent', view: view(null, true, []) }]);
    const [error] = errorOf(settled);
    assert.equal(error?.kind === 'error' && error.interrupted?.retry, 'A lamp');
  });
  it('a finished chat comes back unchanged', () => {
    const turns = [{ id: 'a', kind: 'agent', view: view('A game', false, [card]) }];
    assert.deepEqual(settleAgentTurns<unknown>(turns), turns);
  });
});

describe('tool activity in the chat', () => {
  const step = (role: string, name: string, ms: number, extra: object = {}) => ({ kind: 'tool', role, name, ms, ok: true, summary: `${name} ${ms}`, tokens: null, costUsd: null, estimated: false, ...extra }) as never;

  it('twenty datasheet reads are one row, not twenty', () => {
    const tools = [step('reviewer', 'read_datasheet', 0, { callMs: 5000, tokens: 100, costUsd: 0.01 }), ...Array.from({ length: 19 }, () => step('reviewer', 'read_datasheet', 0))];
    const { steps, fromMemory } = toolSteps(tools);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.count, 20);
    assert.equal(steps[0]!.ms, 5000);
    assert.equal(steps[0]!.tokens, 100);
    assert.equal(fromMemory, 0);
  });
  it('a read answered from memory is no row at all, and its cost stays on the bill', () => {
    const { steps, fromMemory } = toolSteps([step('author', 'search_parts', 1500), step('author', 'get_part', 4, { tokens: 50, costUsd: 0.5 }), step('author', 'search_parts', 700), step('author', 'read_datasheet', 0)]);
    assert.deepEqual(steps.map(s => [s.name, s.count]), [['search_parts', 2]]);
    assert.equal(steps[0]!.tokens, 50);
    assert.equal(steps[0]!.costUsd, 0.5);
    assert.equal(fromMemory, 2);
  });
  it('only reads can disappear, and a failure never does', () => {
    const { steps } = toolSteps([step('designer', 'read_datasheet', 0, { ok: false, summary: 'no such part' }), step('designer', 'check_plan', 3), step('designer', 'propose_plan', 2)]);
    assert.deepEqual(steps.map(s => s.name), ['read_datasheet', 'check_plan', 'propose_plan']);
    assert.equal(steps[0]!.summaries[0], 'no such part');
  });
  it('a failure after a collapsed row is still shown, once', () => {
    const blocks = activityBlocks([step('designer', 'list_blocks', 1), step('designer', 'get_block', 1), { kind: 'error', text: 'Stopped' }, { kind: 'error', text: 'Again' }]);
    assert.deepEqual(blocks.map(b => ('tools' in b ? 'row' : b.item.kind === 'error' ? b.item.text : b.item.kind)), ['row', 'Stopped']);
  });
  it('a block author\'s work is the Designer\'s row, whatever is said afterwards', () => {
    const blocks = activityBlocks([step('designer', 'list_blocks', 1), step('author', 'search_parts', 1), step('designer', 'author_block', 1), step('author', 'get_part', 1), { kind: 'message', role: 'designer', text: 'Hi' }, step('reviewer', 'get_plan', 1)]);
    assert.deepEqual(blocks.map(b => ('tools' in b ? `${b.role}:${b.tools.length}` : b.item.kind)), ['designer:4', 'message', 'reviewer:1']);
  });
});

it('records an agent design as a revision the studio can diff and re-run', () => {
  const lamp = designOf('A little lamp that turns on when the room gets darker than 30%');
  const first = adoptAgentDesign(EMPTY_SESSION, 'a dusk glow', lamp);
  assert.equal(first.revisions[0]!.number, 1);
  assert.equal(first.revisions[0]!.brief, 'a dusk glow');
  assert.equal(adoptAgentDesign(first, 'again', lamp), first);
  const dimmer = { ...lamp, behavior: lamp.behavior.map(b => (b.label === 'Switch on below' ? { ...b, value: '20% of the sensor range' } : b)) };
  const second = adoptAgentDesign(first, 'darker', dimmer);
  assert.equal(second.revisions.length, 2);
  assert.ok(second.revisions[1]!.changes.some(c => /Switch on below/.test(c.text)));
});

describe('the chat side', () => {
  const pending = { brief: 'A timer', requirements: [{ id: 'life', plain: 'Runs 4 hours', metric: 'battery_life_h' as const, args: { capacity_mah: 1000 }, op: '>=' as const, value: 4, source: 'brief' as const }], existing: false };
  const design = { schema: 'moki.circuit-preview/1', template: 'focus-timer', title: 'A timer', parts: [], nets: [], notes: [], behavior: [] } as CircuitDesign;
  const context = { design, jobId: 'j', history: [] };
  it('reads a plain yes as confirming, and anything else as a change', () => {
    for (const text of ['ok', 'Yes.', 'looks good', 'Looks right, start the design', 'go ahead', 'Build it!']) assert.ok(isConfirmation(text), text);
    for (const text of ['make it 3 hours', 'no', 'ok but 3 hours', 'yes, and smaller']) assert.ok(!isConfirmation(text), text);
  });
  it('sends the original brief when confirming, and the new words when changing', () => {
    const yes = pendingRequest('ok', pending, {});
    assert.equal(yes.message, 'A timer');
    assert.equal(yes.requirementsConfirmed, true);
    const change = pendingRequest('3 hours', pending, {});
    assert.equal(change.message, '3 hours');
    assert.equal(change.brief, 'A timer');
    assert.equal(change.requirementsConfirmed, undefined);
  });
  it('keeps checks for a new device apart from the one on screen', () => {
    assert.equal(pendingRequest('ok', pending, context).design, undefined);
    assert.equal(pendingRequest('ok', { ...pending, existing: true }, context).design, design);
  });
});

it('keeps one requirement card with the latest answer', () => {
  const view = { brief: null, role: 'verifier', model: null, items: [], working: true, usage: null } as AgentView;
  const first = foldEvent(view, { type: 'verify', ok: true, results: [{ id: 'a', plain: 'A', status: 'unsupported', evidence: 'Not yet.' }] }, { left: 0 });
  const second = foldEvent(first, { type: 'verify', ok: true, results: [{ id: 'a', plain: 'A', status: 'pass', evidence: 'Measured.' }] }, { left: 0 });
  assert.equal(second.items.length, 1);
  assert.equal((second.items[0] as Extract<AgentView['items'][number], { kind: 'verify' }>).results[0]!.status, 'pass');
});

describe('a waiting card after a reload', () => {
  const card = { kind: 'requirements', requirements: [{ id: 'a', plain: 'A', metric: 'part_count', op: '<=', value: 5, source: 'brief' }], notCheckable: [], message: 'Sound right?', settled: 'open', brief: 'A timer', existing: false };
  const turn = (items: unknown[]) => ({ id: 't', kind: 'agent', view: { brief: null, role: 'verifier', model: null, items, working: false, usage: null } });
  it('is still waiting', () => {
    const found = pendingFromTurns([{ id: 'b', kind: 'brief', text: 'x' }, turn([card])]);
    assert.equal(found?.brief, 'A timer');
    assert.equal(found?.requirements.length, 1);
  });
  it('is not waiting once answered, or once the chat has moved on', () => {
    assert.equal(pendingFromTurns([turn([{ ...card, settled: 'confirmed' }])]), null);
    assert.equal(pendingFromTurns([turn([card]), turn([{ kind: 'message', role: 'designer', text: 'Later' }])]), null);
    assert.equal(pendingFromTurns([]), null);
  });
});

describe('reopening during a build', () => {
  const agent = (usage: unknown) => ({ id: 'a', kind: 'agent', view: { brief: null, role: 'designer', model: null, items: [], working: false, usage } });
  const run = (status: string) => ({ id: 'r', kind: 'run', label: null, job: { jobId: 'j', status } });
  it('notices the agent has gone, while the build goes on', () => assert.equal(agentLeftBuilding([agent(null), run('running')]), true));
  it('stays quiet when the agent finished, the build ended or no agent was involved', () => {
    assert.equal(agentLeftBuilding([agent({ calls: 1 }), run('running')]), false);
    assert.equal(agentLeftBuilding([agent(null), run('done')]), false);
    assert.equal(agentLeftBuilding([run('running')]), false);
    assert.equal(agentLeftBuilding([]), false);
  });
});


describe('the one line an agent shows', () => {
  const tool = (name: string, extra: object = {}) => ({ kind: 'tool', role: 'designer', name, ms: 0, ok: true, summary: '', tokens: null, costUsd: null, estimated: false, ...extra }) as never;
  it('says what is happening, and counts repeats', () => {
    assert.equal(activityLine([]), 'Working…');
    assert.equal(activityLine([tool('list_catalog')]), 'Working · reading the catalog…');
    assert.equal(activityLine([tool('list_catalog'), tool('get_module'), tool('get_module'), tool('get_module')]), 'Working · reading 3 modules…');
    assert.equal(activityLine([tool('something_new')]), 'Working · working…');
  });
  it('says what happened, in how long, and how many steps', () => {
    const done = [tool('list_catalog', { callMs: 4000 }), tool('get_module', { callMs: 3000 }), tool('propose_design', { callMs: 7000, ms: 20 })];
    assert.equal(finishedLine('designer', done), 'Designed in 14 s · 3 steps');
    assert.equal(finishedLine('verifier', [tool('submit_requirements', { callMs: 500 })]), 'Worked out the checks in under a second · 1 step');
  });
  it('doesn\'t say designed when it didn\'t', () => {
    assert.equal(finishedLine('designer', [tool('decline', { callMs: 3000 })]), 'Worked for 3 s · 1 step');
    assert.equal(finishedLine('designer', [tool('propose_design', { callMs: 3000, ok: false })]), 'Worked for 3 s · 1 step');
    assert.equal(finishedLine('fixer', [tool('give_up', { callMs: 3000 })]), 'Worked for 3 s · 1 step');
  });
  it('times the model call as well as the tool', () => {
    const shared = { left: 0 };
    const view = { brief: null, role: 'designer', model: null, items: [], working: true, usage: null } as AgentView;
    const called = foldEvent(view, { type: 'call', role: 'designer', index: 1, ms: 5000, inputTokens: 1, outputTokens: 1, costUsd: 0, estimated: false }, shared);
    const after = foldEvent(called, { type: 'tool', role: 'designer', name: 'list_catalog', ms: 2, ok: true, summary: '', tokens: 1, costUsd: 0, sharedWith: 1 } as never, shared);
    assert.equal((after.items[0] as { callMs?: number }).callMs, 5000);
  });
  it('adds up every call in a turn, including one that asked for two tools', () => {
    const shared = { left: 0 };
    let view = { brief: null, role: 'designer', model: null, items: [], working: true, usage: null } as AgentView;
    const call = (ms: number) => ({ type: 'call', role: 'designer', index: 1, ms, inputTokens: 1, outputTokens: 1, costUsd: 0, estimated: false }) as never;
    const step = (name: string, sharedWith: number) => ({ type: 'tool', role: 'designer', name, ms: 0, ok: true, summary: '', tokens: 1, costUsd: 0, sharedWith }) as never;
    for (const event of [call(4000), step('list_catalog', 0), call(3000), step('get_module', 1), step('get_module', 1), call(7000), step('propose_design', 0)]) view = foldEvent(view, event, shared);
    const tools = view.items as never[];
    assert.equal(finishedLine('designer', tools), 'Designed in 14 s · 4 steps');
  });
});

describe('the RP2040 motor controller failure', () => {
  // The saved turns from the real project, as the owner left them.
  const zeroCard = { id: 'a', kind: 'agent', view: { brief: 'Design an RP2040 motor controller', role: 'verifier', model: 'x', working: false, usage: null, items: [{ kind: 'requirements', requirements: [], notCheckable: ['That it uses an RP2040.', 'That it controls a motor.'], message: 'I\'ll build a motor controller based on the RP2040. Does that sound right?', settled: 'open', brief: 'Design an RP2040 motor controller', existing: false }] } };
  const failed = { id: 'b', kind: 'agent', view: { brief: 'Looks right, start the design', role: 'designer', model: 'x', working: false, usage: null, items: [{ kind: 'error', text: 'Confirming needs the requirements.' }, { kind: 'error', text: 'Lost contact with the agent. A build already queued keeps going.' }] } };

  it('keeps the question open after a turn that only failed, so Try again can answer it', () => {
    const pending = pendingFromTurns([zeroCard, failed]);
    assert.equal(pending?.brief, 'Design an RP2040 motor controller');
    const again = pendingRequest('Looks right, start the design', pending!, {} as never);
    assert.equal(again.message, 'Design an RP2040 motor controller');
    assert.equal(again.requirementsConfirmed, true);
    assert.deepEqual(again.requirements, []);
  });
  it('reads anything else typed under a card with no checks as a new request', () => {
    const again = pendingRequest('A stepper motor, 12 V', pendingFromTurns([zeroCard])!, {} as never);
    assert.equal(again.message, 'A stepper motor, 12 V');
    assert.equal(again.requirements, undefined);
    assert.equal(again.requirementsConfirmed, undefined);
  });
  it('still treats a card with checks as before', () => {
    const card = { ...zeroCard, view: { ...zeroCard.view, items: [{ ...zeroCard.view.items[0]!, requirements: [{ id: 'a' }] }] } };
    assert.deepEqual(pendingRequest('make it smaller', pendingFromTurns([card])!, {} as never).requirements, [{ id: 'a' }]);
  });
  it('keeps one error per turn, the first, which is what actually happened', () => {
    const shared = { left: 0 };
    const start = { brief: 'x', role: 'designer', model: null, items: [], working: true, usage: null } as AgentView;
    const once = foldEvent(start, { type: 'error', message: 'Another agent turn is running.' }, shared);
    const twice = foldEvent(once, { type: 'error', message: 'Lost contact with the agent.' }, shared);
    assert.deepEqual(twice.items, [{ kind: 'error', text: 'Another agent turn is running.' }]);
  });
  it('turns code words into a sentence, and leaves a person\'s words alone', () => {
    for (const raw of ['Confirming needs the requirements.', 'jobId is not valid.', 'message is required.', 'The agent service answered HTTP 500.', 'Failed to fetch', 'Invalid JSON', 'Request too large']) assert.equal(plainError(raw), 'That didn’t go through, and nothing was built.');
    assert.equal(plainError('Another agent turn is running. Try again when it lands.'), 'Another agent turn is running. Try again when it lands.');
  });
});

describe('a chip-level card', () => {
  const check = { id: 'usb', plain: 'It has USB-C power', metric: 'interface_present' as const, args: { kind: 'usb_c_sink' }, op: 'present' as const, source: 'inferred' as const };
  const pending = { brief: 'x', requirements: [check], existing: false, mode: 'chip' as const };
  it('sends its mode back with a yes and with a change, and a kit card sends none', () => {
    assert.equal(pendingRequest('yes', pending, {}).mode, 'chip');
    assert.equal(pendingRequest('it should be smaller', pending, {}).mode, 'chip');
    const { mode: _mode, ...kit } = pending;
    assert.equal(pendingRequest('yes', kit, {}).mode, undefined);
    const bare = { ...pending, noMcu: true };
    assert.equal(pendingRequest('yes', bare, {}).noMcu, true);
    assert.equal(pendingRequest('it should be smaller', bare, {}).noMcu, true);
    assert.equal(pendingRequest('yes', pending, {}).noMcu, undefined);
  });
  it('still knows its mode after a reload', () => {
    const turn = { id: 't', kind: 'agent', view: { brief: null, role: 'verifier', model: null, working: false, usage: null, items: [{ kind: 'requirements', requirements: [check], notCheckable: [], message: 'ok?', settled: 'open', brief: 'x', mode: 'chip' }] } };
    assert.equal(pendingFromTurns([turn])?.mode, 'chip');
  });
  it('shows the mode the server chose', () => {
    const view = foldEvent({ brief: null, role: 'verifier', model: null, items: [], working: true, usage: null } as AgentView, { type: 'requirements', requirements: [check], notCheckable: [], message: 'ok?', brief: 'x', existing: false, mode: 'chip' }, { left: 0 });
    assert.equal(view.items[0]?.kind === 'requirements' && view.items[0].mode, 'chip');
  });
});
