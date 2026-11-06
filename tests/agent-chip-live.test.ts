// Chip mode as the default path: which mode a turn takes, the Block Author, and the manufacturer datasheet route.
// Replay, a fake library and a fake board. No model, no compiler, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BlockDef, BlockDraft, BoardPlan, CatalogPart, GateResult, PinMap } from '../src/blocks/contract.js';
import { evaluateRequirements, REQUIREMENT_METRICS } from '../src/blocks/verify.js';
import type { BoardClient } from '../src/agents/board-client.js';
import { detail, labelUnreviewed, UNREVIEWED_NOTE, MANUFACTURER_HOSTS, namesPart, PartEvidence, runBlockAuthor, type ChipLibrary, type SchematicPlan } from '../src/agents/chip.js';
import type { DatasheetStore } from '../src/agents/datasheet.js';
import { withRetries } from '../src/agents/chip-library.js';
import { chipProject, chipTarget } from '../src/agents/firmware-project.js';
import { JobBudget, replayProvider, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent, TurnRequest } from '../src/agents/protocol.js';
import { runTurn } from '../src/agents/turn.js';
import { createAgentService } from '../server/agent-api.js';

const verify = { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements };
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const replay = (...calls: ReplayFixture['calls']) => replayProvider({ id: 'live', provenance: 'authored', calls });

const part: CatalogPart = { lcsc: 'C50506', mpn: 'DRV8833PWPR', catalogReceipt: 'sha256:r', importer: 'test', rawSha256: 'x', footprintSha256: 'y', pins: [], models: [], datasheetUrl: 'https://www.lcsc.com/datasheet/x.pdf' };
const QUOTE = 'Place a 10 uF bulk capacitor on VM close to the driver';
const pages = ['DRV8833 Dual H-Bridge Motor Driver', `Typical application. ${QUOTE}.`];
const sheets = (loaded: string[] = []): DatasheetStore => ({ load: async url => {
  loaded.push(url);
  if (url.includes('lcsc.com')) throw new Error('The datasheet host answered HTTP 403.');
  return { url, sha256: 'x', pages: url.includes('other') ? ['Some other part entirely'] : pages };
} });
const block = (id: string, extra: Partial<BlockDef> = {}): BlockDef => ({ schema: 'moki.block/1', id, version: 1, contentHash: 'x', title: id, summary: id, class: 'sensor', status: 'unreviewed', provenance: { author: 'human', reviews: [] }, parts: [], nets: [], params: [], ports: [], power: { sources: [], sinks: [] }, constraints: [], ...extra });
const pass: GateResult[] = [{ gate: 'erc', ok: true, issues: [] }, { gate: 'power', ok: true, issues: [] }];
const map: PinMap = { family: 'esp32s3', pio: { platform: 'platformio/espressif32@6.10.0', board: 'esp32-s3-devkitc-1', framework: 'arduino' }, pins: {}, libs: [], includes: [], usage: [] };
const mcu = block('core', { class: 'mcu', mcu: { family: 'esp32s3', pio: map.pio, pins: [], flashKb: 8192, ramKb: 512 } });
const library = (extra: Partial<ChipLibrary> = {}): ChipLibrary => ({
  blocks: () => [mcu], checkPlan: () => pass, pinMap: () => map, datasheets: sheets(),
  searchParts: async () => [part], getPart: async () => part,
  checkBlockDraft: () => pass, draftToBlock: draft => ({ ...(draft as unknown as BlockDef), contentHash: 'h', status: 'unreviewed', provenance: { ...draft.provenance, reviews: [] } }),
  ...extra,
});

const draft = (extra: Record<string, unknown> = {}) => ({ schema: 'moki.block/1', id: 'drv8833-driver', version: 1, title: 'DRV8833 motor driver', summary: 'Two DC motors.', class: 'motor_driver', parts: [{ ref: 'U1', mpn: part.mpn, lcsc: part.lcsc, catalogReceipt: part.catalogReceipt, datasheet: { url: 'https://evil.example/fake.pdf' }, pinout: 'verified', at: { x: 0, y: 0 }, pins: Object.fromEntries(['1', '2', '3', '4', '5'].map(p => [p, { pad: p, role: 'passive' }])) }], nets: [], params: [], ports: [], power: { sources: [], sinks: [] }, constraints: [], ...extra });
const finishedJob = (jobId: string) => ({ jobId, status: 'done', totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: true, errors: [], warnings: [] }, board: { widthMm: 50, heightMm: 40, layers: 2, traceCount: 1, viaCount: 0 }, stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'done', ms: 0 }], artifacts: {}, input: { kind: 'plan' } });
const fakeBoard = () => {
  const created: { plan?: BoardPlan }[] = [];
  const board = { create: async (input: { plan?: BoardPlan }) => { created.push(input); return { jobId: '00000000-0000-4000-8000-000000000001' }; }, get: async (jobId: string) => finishedJob(jobId), artifact: async () => null } as unknown as BoardClient;
  return { board, created };
};
const run = async (request: TurnRequest, provider: ReturnType<typeof replay>, chip: ChipLibrary | null = library()) => {
  const events: AgentEvent[] = [];
  const { board, created } = fakeBoard();
  const outcome = await runTurn(request, { provider, board, emit: e => events.push(e), pollMs: 1, verify, ...(chip ? { chip } : {}), compileProject: async () => ({ ok: true, ms: 1, errors: '' }) });
  return { outcome, events, created, messages: events.flatMap(e => (e.type === 'message' ? [e.text] : [])) };
};

const cannot = tool('v1', 'cannot_build', { missing: ['RP2040'], closest_brief: 'An ESP32 board', chip_level: true, message: 'This kit has no RP2040. The closest is an ESP32 board.' });
const check = { id: 'usb', plain: 'It has USB-C power', metric: 'interface_present', args: { kind: 'usb_c_sink' }, op: 'present', source: 'inferred' };
const checks = tool('v2', 'submit_requirements', { requirements: [check], not_checkable: [], message: 'I’ll build it with USB-C power. Sound right?' });
const noChecks = tool('v2', 'submit_requirements', { requirements: [], not_checkable: [], message: 'I’ll build it.' });

describe('which mode a turn takes', () => {
  it('goes to chip level when the kit can’t do the brief, instead of declining', async () => {
    const { outcome, events, messages } = await run({ message: 'Design an RP2040 motor controller' }, replay(cannot, checks));
    assert.equal(outcome, 'awaiting-confirmation');
    assert.ok(!events.some(e => e.type === 'decline'));
    const card = events.find(e => e.type === 'requirements');
    assert.equal(card?.type === 'requirements' && card.mode, 'chip');
    assert.ok(messages.some(m => /custom board from real parts/.test(m)));
    assert.ok(!messages.some(m => /isn’t on|not available|once it/i.test(m)));
  });
  it('stays on the kit when the kit can do it, and the card says nothing about mode', async () => {
    const kit = tool('v', 'submit_requirements', { requirements: [{ ...check, plain: 'It runs from USB', args: { kind: 'usb_power' } }], not_checkable: [], message: 'I’ll build it to run from USB. Sound right?' });
    const { events } = await run({ message: 'A focus timer with a screen' }, replay(kit));
    const card = events.find(e => e.type === 'requirements');
    assert.ok(card?.type === 'requirements' && card.mode === undefined);
  });
  it('still declines mains voltage, because chip level won’t build it either', async () => {
    const mains = tool('v2', 'cannot_build', { missing: ['mains'], closest_brief: 'A low-voltage LED dimmer', message: 'No mains voltage here. The closest is a low-voltage LED dimmer.' });
    const { outcome, events } = await run({ message: 'A mains dimmer' }, replay(cannot, mains));
    assert.equal(outcome, 'declined');
    assert.equal(events.filter(e => e.type === 'decline').length, 1);
  });
  it('keeps the old honest answer on a server with chip mode off', async () => {
    const { outcome, events } = await run({ message: 'Design an RP2040 motor controller' }, replay(cannot), null);
    assert.equal(outcome, 'declined');
    assert.match(JSON.stringify(events.find(e => e.type === 'decline')), /Chip-level mode will cover/);
  });
  it('hands over when the kit Designer declines after all, and asks for new checks', async () => {
    const decline = tool('d', 'decline', { message: 'No soil probe in the kit.', closest: 'A light alarm', closest_brief: 'A light alarm' });
    const { outcome, events } = await run({ message: 'A soil moisture alarm', requirements: [], requirementsConfirmed: true }, replay(decline, checks));
    assert.equal(outcome, 'awaiting-confirmation');
    assert.ok(!events.some(e => e.type === 'decline'));
    const card = events.find(e => e.type === 'requirements');
    assert.equal(card?.type === 'requirements' && card.mode, 'chip');
  });
  it('a confirmed chip card goes to the chip Designer, not the kit', async () => {
    const decline = tool('d', 'decline', { message: 'No real part exists.', closest: 'x', closest_brief: 'x' });
    const { outcome, events } = await run({ message: 'A thing', mode: 'chip', requirements: [], requirementsConfirmed: true }, replay(decline));
    assert.equal(outcome, 'declined');
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'decline'));
  });
  it('with no checks to agree, starts the chip Designer straight away', async () => {
    const decline = tool('d', 'decline', { message: 'No real part exists.', closest: 'x', closest_brief: 'x' });
    const { events } = await run({ message: 'A thing' }, replay(cannot, noChecks, decline));
    assert.ok(events.some(e => e.type === 'role' && e.role === 'designer'));
    assert.ok(events.some(e => e.type === 'plan.partial'));
  });
  it('chip mode is on by default on a real server, and MOKI_CHIP=off turns it off', async () => {
    // A provider-less service builds the real library. Only the switch is under test, so no turn runs.
    assert.ok(createAgentService({ env: { MOKI_CHIP: 'off' } }));
    assert.ok(createAgentService({ env: {} }));
  });
});

const context = () => ({ provider: replay(), budget: new JobBudget(2, {}), emit: () => {} });
describe('a maker’s own datasheet', () => {
  it('finds the part by the start of its number, and doesn’t on a near miss', () => {
    assert.ok(namesPart(pages, 'DRV8833PWPR'));
    assert.ok(namesPart(['W25Q128JV 3V flash'], 'W25Q128JVSIQ'));
    assert.ok(!namesPart(pages, 'TPS63001DRCR'));
    assert.ok(!namesPart(pages, 'AB'));
  });
  it('reads it when the catalog copy answers 403, and a quote then passes', async () => {
    const evidence = new PartEvidence(library(), []);
    assert.match(await evidence.refute({ lcsc: part.lcsc, page: 2, quote: QUOTE }) ?? '', /403.*manufacturer/);
    await evidence.adopt(part.lcsc, 'https://www.ti.com/lit/ds/symlink/drv8833.pdf');
    assert.equal(await evidence.refute({ lcsc: part.lcsc, page: 2, quote: QUOTE }), null);
    assert.equal(await evidence.urlFor(part.lcsc), 'https://www.ti.com/lit/ds/symlink/drv8833.pdf');
  });
  it('refuses a host not on the list, and a PDF that doesn’t name the part', async () => {
    const evidence = new PartEvidence(library(), []);
    await assert.rejects(evidence.adopt(part.lcsc, 'https://example.com/drv8833.pdf'), /isn't a manufacturer/);
    await assert.rejects(evidence.adopt(part.lcsc, 'https://www.ti.com/other.pdf'), /doesn't name/);
    await assert.rejects(evidence.adopt(part.lcsc, 'https://evilti.com/drv8833.pdf'), /isn't a manufacturer/);
    assert.equal(await evidence.urlFor(part.lcsc), part.datasheetUrl);
    assert.ok(MANUFACTURER_HOSTS.every(h => !h.includes('/')));
  });
  it('never trusts the URL inside a draft', async () => {
    const loaded: string[] = [];
    const evidence = new PartEvidence(library({ datasheets: sheets(loaded) }), []);
    const provider = replay(tool('a', 'submit_block', { draft: draft(), notes: 'Check the bulk capacitor.' }));
    await runBlockAuthor({ ...context(), provider }, 'Drive two DC motors', '', [mcu], library(), evidence);
    await evidence.refute({ lcsc: part.lcsc, page: 2, quote: QUOTE });
    assert.ok(!loaded.some(url => url.includes('evil.example')));
  });
});

describe('the unreviewed label on the sheet', () => {
  const blocks = [block('a', { title: 'Block A' }), block('b', { title: 'Block B', status: 'reviewed' })];
  const plan = { schema: 'moki.plan/1', title: 'x', layers: 2, links: [], blocks: [{ inst: 'one', block: 'a', version: 1, params: {} }, { inst: 'two', block: 'b', version: 1, params: {} }], sections: [{ id: 'one', title: 'One', purpose: 'p', insts: ['one'], notes: ['Why.'] }, { id: 'two', title: 'Two', purpose: 'p', insts: ['two'], notes: ['Why.'] }] } as unknown as SchematicPlan;
  it('names only the unreviewed block, and can run twice', () => {
    const once = labelUnreviewed(plan, blocks);
    assert.deepEqual(once.sections[0]!.notes, ['Why.', `${UNREVIEWED_NOTE}Block A.`]);
    assert.deepEqual(once.sections[1]!.notes, ['Why.']);
    assert.deepEqual(labelUnreviewed(once, blocks), once);
  });
  it('takes a stale label off a block that has since been promoted', () => {
    const stale = labelUnreviewed(plan, blocks);
    assert.deepEqual(labelUnreviewed(stale, [{ ...blocks[0]!, status: 'reviewed' }, blocks[1]!]).sections[0]!.notes, ['Why.']);
  });
});

describe('retrying the catalog', () => {
  it('survives a passing 500, and still reports a service that stays down', async () => {
    let calls = 0;
    assert.equal(await withRetries(async () => { if (++calls < 3) throw new Error('HTTP 500'); return 'ok'; }, [0, 0, 0]), 'ok');
    assert.equal(calls, 3);
    await assert.rejects(withRetries(async () => { throw new Error('down'); }, [0]), /down/);
  });
});

describe('reading a large block', () => {
  const many = block('big', { parts: Array.from({ length: 40 }, (_, i) => ({ ref: `C${i}`, mpn: 'CAP', lcsc: `C${i + 100}`, catalogReceipt: 'r', datasheet: { url: 'https://x.example/a.pdf' }, pinout: 'verified' as const, at: { x: 0, y: 0 }, value: '100nF', valueWhy: { url: 'https://x.example/a.pdf', pages: '9', note: 'x'.repeat(900) }, pins: { 1: { pad: '1', role: 'passive' as const }, 2: { pad: '2', role: 'passive' as const } } })), nets: Array.from({ length: 900 }, (_, i) => ({ name: `N${i}`, pins: [`C${i % 40}.1`] })) });
  it('never cuts one off: a large block says to read by section, and every part can be reached', () => {
    const whole = detail(many) as { note?: string };
    assert.match(whole.note!, /read it by section/);
    const parts = detail(many, 'parts') as unknown as { value: { ref: string }[]; pages: number };
    assert.equal(parts.value.length, 40);
    assert.ok(JSON.stringify(parts).length < 24_000);
    const nets = detail(many, 'nets') as unknown as { value: string[]; pages: number };
    assert.ok(nets.pages >= 1);
    let seen = 0;
    for (let page = 1; page <= nets.pages; page++) seen += (detail(many, 'nets', page) as unknown as { value: string[] }).value.length;
    assert.equal(seen, 900);
    assert.match(String((detail(many, 'nope') as { error?: string }).error), /no section/);
  });
  it('sends a small block whole', () => {
    const small = detail(mcu) as { ports?: unknown; note?: string };
    assert.ok(small.ports);
    assert.equal(small.note, undefined);
  });
  it('a switch’s citation of its MCU isn’t its datasheet, and an IC’s is', async () => {
    const lead = (ref: string) => block('b', { parts: [{ ref, mpn: 'X', lcsc: 'C720477', catalogReceipt: 'r', datasheet: { url: 'https://www.ti.com/mcu.pdf' }, pinout: 'verified', at: { x: 0, y: 0 }, pins: {} }] });
    assert.equal(await new PartEvidence(library(), [lead('SW1')]).urlFor('C720477'), part.datasheetUrl);
    assert.equal(await new PartEvidence(library(), [lead('U1')]).urlFor('C720477'), 'https://www.ti.com/mcu.pdf');
  });
});

describe('firmware headers', () => {
  it('lets each family use what ships in its core, and no more', () => {
    const headers = (family: string) => chipTarget({ ...map, family }).headers;
    assert.ok(headers('esp32s3').includes('Preferences.h'));
    assert.ok(headers('rp2040').includes('Wire.h'));
    assert.ok(!headers('rp2040').includes('Preferences.h'));
    assert.ok(!headers('unknown').includes('Wire.h'));
  });
  it('sets the RP2040 toolchain from code, because its own has no build for this server', () => {
    const rp = { ...map, family: 'rp2040', pio: { platform: 'platformio/raspberrypi@1.20.0', board: 'pico', framework: 'arduino' } };
    const ini = chipProject('x', rp, '#include <Arduino.h>\nvoid setup() {}\nvoid loop() {}\n')['platformio.ini']!;
    assert.match(ini, /platform_packages =\n  platformio\/toolchain-gccarmnoneeabi@1\.100301\.220327/);
    assert.ok(!chipProject('x', map, '#include <Arduino.h>\nvoid setup() {}\nvoid loop() {}\n')['platformio.ini']!.includes('platform_packages'));
  });
});

describe('the Block Author', () => {
  const author = (input: Record<string, unknown>, chip = library()) => runBlockAuthor({ ...context(), provider: replay(tool('a', 'submit_block', { draft: draft(input), notes: '' }), tool('b', 'give_up', { reason: 'Stopped.' })) }, 'Drive two DC motors', '', [mcu], chip, new PartEvidence(chip, []));
  it('stamps who wrote it, and drops any review a model claims', async () => {
    const { result } = await author({ status: 'reviewed', contentHash: 'fake', provenance: { author: 'human', authorId: 'owner', reviews: [{ verdict: 'pass' }] } });
    assert.equal(result?.kind, 'block');
    const written = result!.kind === 'block' ? result!.draft as BlockDraft & { status?: unknown; contentHash?: unknown } : null;
    assert.equal(written!.provenance.author, 'agent');
    assert.match(written!.provenance.authorId!, /:author$/);
    assert.equal(written!.status, undefined);
    assert.equal(written!.contentHash, undefined);
    assert.equal((written!.provenance as { reviews?: unknown }).reviews, undefined);
  });
  for (const [name, input, why] of [
    ['an MCU', { mcu: { family: 'x' } }, /MCU comes from the library/],
    ['an id already in the library', { id: 'core' }, /taken/],
    ['a second version', { version: 2 }, /version is 1/],
    ['an odd id', { id: '../evil' }, /lowercase/],
    ['a library nobody approved', { firmware: { libs: ['evil/lib@1.0.0'], includes: [], usage: '' } }, /approved/],
  ] as const) {
    it(`refuses ${name}`, async () => {
      const events: AgentEvent[] = [];
      const chip = library();
      await runBlockAuthor({ provider: replay(tool('a', 'submit_block', { draft: draft(input), notes: '' }), tool('b', 'give_up', { reason: 'Stopped.' })), budget: new JobBudget(2, {}), emit: e => events.push(e) }, 'x', '', [mcu], chip, new PartEvidence(chip, []));
      assert.ok(events.some(e => e.type === 'tool' && !e.ok && why.test(e.summary)), JSON.stringify(events.filter(e => e.type === 'tool')));
    });
  }
  it('sends ERC failures back, and gives up rather than inventing', async () => {
    const chip = library({ checkBlockDraft: () => [{ gate: 'erc', ok: false, issues: [{ rule: 'decoupling', severity: 'error', message: 'No capacitor on VM.' }] }] });
    const { result } = await author({}, chip);
    assert.equal(result?.kind, 'give-up');
  });
});

describe('a board with an authored block, end to end on replay', () => {
  const sections: SchematicPlan['sections'] = [
    { id: 'core', title: 'MCU', purpose: 'Runs it.', insts: ['core'], notes: ['Core.'] },
    { id: 'motor', title: 'Motor driver', purpose: 'Drives motors.', insts: ['motor'], notes: ['Per the datasheet.'], reference: { lcsc: part.lcsc, datasheetUrl: '', page: 2, quote: QUOTE } },
  ];
  const plan: SchematicPlan = { schema: 'moki.plan/1', title: 'Motor board', layers: 2, sections, blocks: [{ inst: 'core', block: 'core', version: 1, params: {} }, { inst: 'motor', block: 'drv8833-driver', version: 1, params: {} }], links: [] };
  const finding = (section: string) => ({ section, status: 'match', claim: 'Follows the datasheet.', lcsc: part.lcsc, page: 2, quote: QUOTE });
  const SOURCE = '#include <Arduino.h>\n#include "pins.h"\nvoid setup() {}\nvoid loop() {}\n';
  const calls = [
    tool('d1', 'author_block', { function: 'Drive two DC motors from 5 V' }),
    tool('a1', 'read_datasheet', { lcsc: part.lcsc, find: 'application', url: 'https://www.ti.com/lit/ds/symlink/drv8833.pdf' }),
    tool('a2', 'submit_block', { draft: draft(), notes: 'Check the bulk capacitor.' }),
    tool('d2', 'propose_plan', { plan: { ...plan, drafts: [{ ...draft(), title: 'Quietly changed' }] }, summary: 'A motor board.', app_brief: 'Spin the motor.' }),
    tool('r', 'submit_review', { findings: [finding('core'), finding('motor')] }),
    tool('f', 'compile_app', { source: SOURCE, summary: 'Spins it.' }),
  ];
  it('code carries the block into the plan, unchanged, and labels it unreviewed in the chat', async () => {
    const { outcome, created, messages, events } = await run({ message: 'Motor board', mode: 'chip', requirements: [], requirementsConfirmed: true }, replay(...calls));
    assert.equal(outcome, 'built', JSON.stringify(messages));
    const sent = created[0]!.plan!;
    assert.equal(sent.drafts?.length, 1);
    assert.equal(sent.drafts![0]!.title, 'DRV8833 motor driver');
    assert.match(sent.drafts![0]!.provenance.authorId!, /:author$/);
    assert.equal(sent.sections![1]!.reference!.datasheetUrl, 'https://www.ti.com/lit/ds/symlink/drv8833.pdf');
    assert.ok(messages.some(m => /Unreviewed blocks in this board: .*DRV8833 motor driver/.test(m)));
    assert.ok(sent.sections![1]!.notes.includes(`${UNREVIEWED_NOTE}DRV8833 motor driver.`), 'code writes it on the sheet');
    assert.ok(sent.sections![0]!.notes.includes(`${UNREVIEWED_NOTE}core.`));
    assert.ok(events.some(e => e.type === 'role' && e.role === 'author'));
    const usage = events.find(e => e.type === 'done');
    assert.ok(usage?.type === 'done' && usage.usage.calls === calls.length);
  });
  it('tells the Designer the confirmed checks, and an authored block takes the class a check needs', async () => {
    const asked: string[] = [];
    const inner = replay(tool('d1', 'author_block', { function: 'Motor', class: 'motor_driver_x' }), tool('a1', 'read_datasheet', { lcsc: part.lcsc, find: 'application', url: 'https://www.ti.com/lit/ds/symlink/drv8833.pdf' }), tool('a2', 'submit_block', { draft: draft({ class: 'other' }), notes: '' }), tool('d2', 'propose_plan', { plan, summary: 'A motor board.', app_brief: 'Spin.' }), tool('r', 'submit_review', { findings: [finding('core'), finding('motor')] }), tool('f', 'compile_app', { source: SOURCE, summary: 'Spins it.' }));
    const provider = { ...inner, call(request: Parameters<typeof inner.call>[0]) { asked.push(JSON.stringify(request.messages[0])); return inner.call(request); } } as typeof inner;
    const { created, messages, events, outcome } = await run({ message: 'Motor board', mode: 'chip', requirements: [{ ...check, plain: 'It has a motor driver', args: { kind: 'motor_driver_x' } } as never], requirementsConfirmed: true }, provider, library({ factsFromPlan: () => ({ interfaces: ['motor_driver_x'], signals: {}, netVolts: {} }) }));
    assert.equal(outcome, 'built', JSON.stringify(events.filter(e => e.type !== 'call').slice(-5)));
    assert.ok(asked[0]!.includes('motor_driver_x') && asked[0]!.includes('finished board has to pass'), asked[0]);
    assert.equal(created[0]?.plan?.drafts?.[0]?.class, 'motor_driver_x', JSON.stringify(messages));
  });
  it('counts failed tries at new blocks, so a Designer can’t keep paying for them', async () => {
    const tries = [1, 2, 3, 4].flatMap(n => [tool(`d${n}`, 'author_block', { function: 'x' }), ...(n <= 3 ? [tool(`a${n}`, 'give_up', { reason: 'No part.' })] : [])]);
    const { events } = await run({ message: 'x', mode: 'chip', requirements: [], requirementsConfirmed: true }, replay(...tries, tool('z', 'decline', { message: 'No part exists for that.', closest: 'x', closest_brief: 'x' })));
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /limit for one board|No more new blocks/.test(e.summary)));
  });
  it('names the gate when a new block can’t be written, and doesn’t pretend', async () => {
    const giveUp = [tool('d1', 'author_block', { function: 'x' }), tool('a1', 'give_up', { reason: 'No datasheet could be read.' }), tool('d2', 'decline', { message: 'No block for that, because no datasheet could be read.', closest: 'x', closest_brief: 'x' })];
    const { outcome, events } = await run({ message: 'x', mode: 'chip', requirements: [], requirementsConfirmed: true }, replay(...giveUp));
    assert.equal(outcome, 'declined');
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && e.name === 'author_block'));
  });
});
