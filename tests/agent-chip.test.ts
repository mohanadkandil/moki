// Chip-level agents against a small fake library and board. No model, no compiler, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BlockDef, BoardPlan, GateResult, PinMap } from '../src/blocks/contract.js';
import type { BoardClient } from '../src/agents/board-client.js';
import { checkAgentPlan, isClearance, outOfBounds, PartEvidence, planChanges, runChipFixer, sizedPlan, type BoardSizing, type ChipLibrary, type SchematicPlan } from '../src/agents/chip.js';
import { boardSizer } from '../src/agents/chip-library.js';
import type { DatasheetStore } from '../src/agents/datasheet.js';
import type { AgentJob } from '../src/agents/facts.js';
import { chipProject, chipTarget, checkAppSource } from '../src/agents/firmware-project.js';
import { JobBudget, replayProvider, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent, TurnRequest } from '../src/agents/protocol.js';
import { runTurn } from '../src/agents/turn.js';
import { parseTurn } from '../server/agent-api.js';

const block = (id: string, extra: Partial<BlockDef> = {}): BlockDef => ({
  schema: 'moki.block/1', id, version: 1, contentHash: 'x', title: id, summary: id, class: 'sensor', status: 'reviewed', provenance: { author: 'human', reviews: [] },
  parts: [], nets: [], params: [], ports: [], power: { sources: [], sinks: [] }, constraints: [], ...extra,
});
const mcu = block('rp2040-core', { class: 'mcu', mcu: { family: 'rp2040', pio: { platform: 'raspberrypi', board: 'pico', framework: 'arduino' }, pins: [], flashKb: 2048, ramKb: 264 } });
const ic = (lcsc: string) => ({ ref: 'U1', mpn: 'IC', lcsc, catalogReceipt: 'r', datasheet: { url: `https://example.com/${lcsc}.pdf` }, pinout: 'verified', at: { x: 0, y: 0 }, pins: Object.fromEntries(['1', '2', '3', '4', '5'].map(p => [p, { pad: p, role: 'passive' }])) }) as unknown as BlockDef['parts'][number];
const sensor = block('sht40', { status: 'unreviewed', title: 'SHT40 humidity sensor', parts: [ic('C2000')] });
const blocks = [mcu, sensor];
const QUOTE = 'Place a 100 nF capacitor close to VDD';
const sections = (): SchematicPlan['sections'] => [
  { id: 'core', title: 'MCU', purpose: 'Runs the firmware.', insts: ['core'], notes: ['RP2040 core.'] },
  { id: 'air', title: 'Humidity sensor', purpose: 'Reads humidity.', insts: ['air'], notes: ['100 nF on VDD per the datasheet.'], reference: { lcsc: 'C2000', datasheetUrl: 'https://evil.example/x.pdf', page: 2, figure: 'Figure 3', quote: QUOTE } },
];
const plan = (extra: Partial<SchematicPlan> = {}): SchematicPlan => ({
  schema: 'moki.plan/1', title: 'Humidity logger', layers: 2, sections: sections(),
  blocks: [{ inst: 'core', block: 'rp2040-core', version: 1, params: {} }, { inst: 'air', block: 'sht40', version: 1, params: {} }],
  links: [{ from: 'core.GP4', to: 'air.SDA' }, { from: 'core.PWR', to: 'air.VCC' }], ...extra,
});
const map: PinMap = { family: 'esp32s3', pio: { platform: 'platformio/espressif32@6.10.0', board: 'esp32-s3-devkitc-1', framework: 'arduino', environment: 's3' }, pins: { PIN_AIR_SDA: { gpio: 4, port: 'air.SDA' } }, libs: ['adafruit/Adafruit BusIO@1.17.0'], includes: ['Wire.h'], usage: [{ block: 'sht40', note: 'Call begin().' }] };
const pass: GateResult[] = [{ gate: 'erc', ok: true, issues: [] }, { gate: 'power', ok: true, issues: [] }];
const datasheets: DatasheetStore = { load: async url => ({ url, sha256: 'x', pages: ['Cover page', `Application notes. ${QUOTE} and keep traces short.`] }) };
const library = (check: (p: BoardPlan) => GateResult[] = () => pass, pins: PinMap = map): ChipLibrary => ({ blocks: () => blocks, checkPlan: check, pinMap: () => pins, datasheets });
const evidence = (chip = library()) => new PartEvidence(chip, blocks);

const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const replay = (...calls: ReplayFixture['calls']) => replayProvider({ id: 'chip', provenance: 'authored', calls });
const SOURCE = '#include <Arduino.h>\n#include "pins.h"\nvoid setup() {}\nvoid loop() {}\n';
const propose = tool('a', 'propose_plan', { plan: plan(), summary: 'A humidity logger.', app_brief: 'Print humidity every second.' });
const compiled = tool('b', 'compile_app', { source: SOURCE, summary: 'Prints humidity.' });
const compiled_ = compiled;
const finding = (section: string, extra: Record<string, unknown> = {}) => ({ section, status: 'match', claim: 'Decoupling follows the datasheet.', lcsc: 'C2000', page: 2, quote: QUOTE, ...extra });
const passes = tool('r', 'submit_review', { findings: [finding('core'), finding('air')] });

const finishedJob = (jobId: string, errors: number): AgentJob => ({
  jobId, status: 'done', totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: true, errors: Array.from({ length: errors }, () => ({ type: 'pcb_trace_error', message: 'Trace too close' })), warnings: [] },
  board: { widthMm: 50, heightMm: 40, layers: 2, traceCount: 1, viaCount: 0 }, stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'done', ms: 0 }], artifacts: {}, input: { kind: 'design', sourceSha256: 'x' },
} as unknown as AgentJob);
const fakeBoard = (errors: number[]) => {
  const created: { plan?: BoardPlan; baseJobId?: string }[] = [];
  const ids = new Map<string, number>();
  const board = {
    create: async (input: { plan?: BoardPlan; baseJobId?: string }) => { const jobId = `00000000-0000-4000-8000-00000000000${created.length}`; ids.set(jobId, errors[created.length] ?? 0); created.push(input); return { jobId }; },
    get: async (jobId: string) => finishedJob(jobId, ids.get(jobId) ?? 0),
    artifact: async () => null,
  } as unknown as BoardClient;
  return { board, created };
};
const turn = async (provider: ReturnType<typeof replay>, board: BoardClient, options: { chip?: ChipLibrary; compile?: () => Promise<{ ok: boolean; ms: number; errors: string }> } = {}) => {
  const events: AgentEvent[] = [];
  const outcome = await runTurn({ message: 'A humidity logger', mode: 'chip' }, { provider, board, emit: e => events.push(e), pollMs: 1, ...(options.chip !== null ? { chip: options.chip ?? library() } : {}), compileProject: options.compile ?? (async () => ({ ok: true, ms: 1, errors: '' })) });
  return { outcome, events, messages: events.flatMap(e => (e.type === 'message' ? [e.text] : [])) };
};

const sizing = (over: Partial<BoardSizing> = {}): BoardSizing => ({ minimum: { widthMm: 40, heightMm: 60, cornerRadiusMm: 2 }, chosen: { widthMm: 46, heightMm: 66, cornerRadiusMm: 2 }, sections: [{ inst: 'core', widthMm: 37.46, heightMm: 44.77 }, { inst: 'air', widthMm: 6.7, heightMm: 10.91 }], ...over });
const sizedLibrary = (size: ChipLibrary['sizeBoard'] = async plan => sizing(plan.board ? { fits: plan.board.widthMm >= 40 && plan.board.heightMm >= 60 } : {})): ChipLibrary => ({ ...library(), sizeBoard: size });

describe('chip-level firmware target', () => {
  it('follows the MCU block', () => {
    const project = chipProject('A logger', map, SOURCE);
    assert.match(project['platformio.ini']!, /default_envs = s3\n\n\[env:s3\]/);
    assert.match(project['platformio.ini']!, /board = esp32-s3-devkitc-1\nframework = arduino/);
    assert.match(project['include/pins.h']!, /constexpr int PIN_AIR_SDA = 4;/);
  });
  it('sets native USB for the S3 from code, and no block can add a flag', () => {
    const ini = chipProject('A logger', map, SOURCE)['platformio.ini']!;
    assert.match(ini, /build_flags =\n  -DARDUINO_USB_MODE=1\n  -DARDUINO_USB_CDC_ON_BOOT=1\n/);
    assert.throws(() => chipTarget({ ...map, pio: { ...map.pio, board: 'x\nbuild_flags = -DEVIL' } }), /Unsafe/);
  });
  it('takes a named pin such as PA9', () => {
    assert.match(chipProject('x', { ...map, pins: { PIN_TX: { gpio: 'PA9', port: 'uart.TX' } } }, SOURCE)['include/pins.h']!, /PIN_TX = PA9;/);
  });
  for (const [name, bad] of [
    ['a newline in a platform', { ...map, pio: { ...map.pio, platform: 'x\nextra_scripts = pre:evil.py' } }],
    ['a newline in a library', { ...map, libs: ['a/b@1\nextra_scripts = evil.py'] }],
    ['an unpinned library', { ...map, libs: ['adafruit/Anything'] }],
    ['a library from a URL', { ...map, libs: ['https://evil.example/x.git@1'] }],
    ['a pinned library no one approved', { ...map, libs: ['evil/lib@1.0.0'] }],
    ['a platform no one approved', { ...map, pio: { ...map.pio, platform: 'evil/platform@1.0.0' } }],
    ['a path as a header', { ...map, includes: ['../../secret.h'] }],
    ['an absolute header', { ...map, includes: ['/etc/passwd'] }],
    ['code in a pin id', { ...map, pins: { PIN_X: { gpio: '1;\n#include "/etc/passwd"', port: 'a.b' } } }],
  ] as const) {
    it(`refuses ${name} from a block`, () => assert.throws(() => chipTarget(bad as PinMap), /Unsafe|No one has approved/));
  }
  it('allows a listed header in a folder, and no path tricks', () => {
    const headers = ['Arduino.h', 'driver/i2s.h'];
    assert.deepEqual(checkAppSource('#include <driver/i2s.h>\n', headers), []);
    assert.ok(checkAppSource('#include <driver/../i2s.h>\n', headers).length);
    assert.ok(checkAppSource('#include <driver/adc.h>\n', headers).length);
  });
});

describe('checking a plan from a model', () => {
  const check = (value: unknown, chip = library()) => checkAgentPlan(value, chip, blocks, evidence(chip));
  it('passes a sectioned plan with a real citation, and takes the URL from the catalog', async () => {
    const good = plan();
    assert.deepEqual((await check(good)).issues, []);
    assert.equal(good.sections[1]!.reference!.datasheetUrl, 'https://example.com/C2000.pdf');
  });
  it('refuses firmware inside a plan, and claims in its title or notes', async () => {
    assert.ok((await check(plan({ app: { source: 'x' } }))).issues.length);
    assert.ok((await check(plan({ title: 'This board works' }))).issues.length);
    assert.ok((await check('nope')).issues.length);
    const claims = plan(); claims.sections[0]!.notes = ['This board works.'];
    assert.ok((await check(claims)).issues.some(i => /claims/.test(i)));
  });
  it('turns a thrown check into an issue', async () => {
    assert.match((await check(plan(), library(() => { throw new Error('bad shape'); }))).issues[0]!, /bad shape/);
  });
  it('needs every block in exactly one section', async () => {
    const missing = plan(); missing.sections[0]!.insts = [];
    assert.ok((await check(missing)).issues.some(i => /isn't in any section/.test(i)));
    const twice = plan(); twice.sections[0]!.insts = ['core', 'air'];
    assert.ok((await check(twice)).issues.some(i => /two sections/.test(i)));
    assert.ok((await check({ ...plan(), sections: [] })).issues.some(i => /sections/.test(i)));
  });
  it('needs a design note and a purpose', async () => {
    const bare = plan(); bare.sections[0]!.notes = []; bare.sections[1]!.purpose = '';
    const { issues } = await check(bare);
    assert.ok(issues.some(i => /design notes/.test(i)));
    assert.ok(issues.some(i => /purpose/.test(i)));
  });
  it('refuses an IC with no cited reference circuit', async () => {
    const bare = plan(); delete bare.sections[1]!.reference;
    assert.ok((await check(bare)).issues.some(i => /must cite the reference circuit/.test(i)));
  });
  it('refuses a made-up quote, a wrong page, too short a quote, and another part\'s datasheet', async () => {
    for (const change of [{ quote: 'Place a 47 uF capacitor on VDD' }, { page: 1 }, { quote: '100 nF' }, { page: 99 }]) {
      const bad = plan(); Object.assign(bad.sections[1]!.reference!, change);
      assert.ok((await check(bad)).issues.some(i => /isn’t|not on page/.test(i)), JSON.stringify(change));
    }
    const other = plan(); other.sections[1]!.reference!.lcsc = 'C9999';
    assert.ok((await check(other)).issues.some(i => /isn't one of its parts/.test(i)));
  });
  it('says so when no datasheet can be read', async () => {
    const { datasheets: _none, ...noSheets } = library();
    assert.ok((await check(plan(), noSheets)).issues.some(i => /Datasheets aren’t available/.test(i)));
  });
  it('refuses new blocks on a server that can\'t check them', async () => {
    assert.ok((await check(plan({ drafts: [{ id: 'x' } as never] }))).issues.some(i => /New blocks aren’t available/.test(i)));
  });
});

describe('what the Fixer may change', () => {
  it('lets a schematic fix change a value, but not a build fix, because review has passed', () => {
    const changed = plan(); changed.blocks[1]!.params = { rate: 2 };
    assert.equal(outOfBounds(plan(), changed, blocks, 'schematic'), null);
    assert.match(outOfBounds(plan(), changed, blocks, 'build')!, /already been reviewed/);
  });
  it('refuses moving a power link', () => {
    const withPower = [{ ...mcu, ports: [{ id: 'PWR', label: 'PWR', kind: 'power-out' }, { id: 'GP4', label: 'GP4', kind: 'gpio' }, { id: 'GP6', label: 'GP6', kind: 'gpio' }] } as BlockDef, sensor];
    const moved = plan({ links: [{ from: 'core.GP4', to: 'air.SDA' }, { from: 'core.GP6', to: 'air.VCC' }] });
    assert.ok(outOfBounds(plan(), moved, withPower));
  });
  it('allows params, placement, board, layers and moving an MCU pin', () => {
    const moved = plan({ layers: 4, board: { widthMm: 60, heightMm: 50 }, links: [{ from: 'core.GP6', to: 'air.SDA' }, { from: 'core.PWR', to: 'air.VCC' }] });
    moved.blocks[1]!.at = { x: 5, y: 5 };
    assert.equal(outOfBounds(plan(), moved, blocks), null);
  });
  for (const [name, change] of [
    ['adding a block', (p: BoardPlan) => p.blocks.push({ inst: 'more', block: 'sht40', version: 1, params: {} })],
    ['removing a block', (p: BoardPlan) => p.blocks.pop()],
    ['swapping a block', (p: BoardPlan) => { p.blocks[1]!.block = 'rp2040-core'; }],
    ['removing a link', (p: BoardPlan) => p.links.pop()],
    ['adding a link', (p: BoardPlan) => p.links.push({ from: 'air.SCL', to: 'air.SDA' })],
    ['moving a peripheral end', (p: BoardPlan) => { p.links[0]!.to = 'air.SCL'; }],
  ] as const) {
    it(`refuses ${name}`, () => { const p = plan(); change(p); assert.ok(outOfBounds(plan(), p, blocks)); });
  }
});

describe('a chip-level turn', () => {
  it('answers honestly on a server with no block library', async () => {
    const { board, created } = fakeBoard([]);
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ message: 'A logger', mode: 'chip' }, { provider: replay(), board, emit: e => events.push(e) });
    assert.equal(outcome, 'no-change');
    assert.equal(created.length, 0);
    assert.ok(events.some(e => e.type === 'message' && /aren’t available/.test(e.text)));
  });
  it('builds the plan with compiled firmware, and code labels unreviewed blocks', async () => {
    const { board, created } = fakeBoard([0]);
    const { outcome, events, messages } = await turn(replay(propose, passes, compiled), board);
    assert.equal(outcome, 'built');
    assert.equal(created[0]?.plan?.app?.source, SOURCE);
    assert.ok(messages.some(m => /Unreviewed blocks in this board: SHT40 humidity sensor\. They stay labelled unreviewed/.test(m)));
    assert.ok(messages.some(m => /No person has reviewed this schematic/.test(m)));
    assert.ok(messages.some(m => /SPICE checks aren’t available/.test(m)));
    assert.equal(created[0]?.plan?.sections?.[1]?.reference?.datasheetUrl, 'https://example.com/C2000.pdf');
    const planned = events.find((e): e is Extract<AgentEvent, { type: 'plan' }> => e.type === 'plan');
    assert.deepEqual(planned?.unreviewed, ['SHT40 humidity sensor']);
  });
  it('sends ERC issues back, and builds nothing until they pass', async () => {
    const { board, created } = fakeBoard([0]);
    let checks = 0;
    const chip = library(() => (++checks === 1 ? [{ gate: 'erc', ok: false, issues: [{ rule: 'decoupling', severity: 'error', where: 'air', message: 'No capacitor' }] }] : pass));
    const { events } = await turn(replay(propose, propose, passes, compiled), board, { chip });
    assert.equal(created.length, 1);
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /ERC decoupling at air: No capacitor/.test(e.summary)));
  });
  it('declines when no block fits', async () => {
    const { board, created } = fakeBoard([]);
    const { outcome } = await turn(replay(tool('a', 'decline', { message: 'No LoRa block yet.', closest: 'A USB logger.' })), board);
    assert.equal(outcome, 'declined');
    assert.equal(created.length, 0);
  });
  it('names the compile gate and builds nothing when firmware fails', async () => {
    const { board, created } = fakeBoard([]);
    const { outcome, messages } = await turn(replay(propose, passes, compiled, compiled, compiled), board, { compile: async () => ({ ok: false, ms: 1, errors: 'main.cpp:1: error: nope' }) });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(messages.some(m => /Compile gate failed/.test(m) && /error: nope/.test(m)));
  });
  it('names the ERC gate when the pin map can\'t be made', async () => {
    const { board, created } = fakeBoard([]);
    const chip: ChipLibrary = { ...library(), pinMap: () => { throw new Error('Reserved MCU pin IO0: strap'); } };
    const { outcome, messages } = await turn(replay(propose, passes), board, { chip });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(messages.some(m => /ERC gate failed/.test(m) && /IO0/.test(m)));
  });
  const fix = (id: string, width: number) => tool(id, 'propose_fix', { reason: 'More room.', plan: plan({ board: { widthMm: width, heightMm: 50 } }) });
  it('fixes a failed build as a new job, keeping the firmware', async () => {
    const { board, created } = fakeBoard([3, 0]);
    const { outcome } = await turn(replay(propose, passes, compiled, fix('c', 70)), board);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 2);
    assert.equal(created[1]?.baseJobId, '00000000-0000-4000-8000-000000000000');
    assert.equal(created[1]?.plan?.app?.source, SOURCE);
    assert.equal(created[1]?.plan?.board?.widthMm, 70);
  });
  it('stops after 2 fixes and never shows the board as done', async () => {
    const { board, created } = fakeBoard([3, 3, 3, 0]);
    const { outcome, messages } = await turn(replay(propose, passes, compiled, fix('c', 70), fix('d', 80)), board);
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 3);
    assert.ok(messages.some(m => /still has problems/.test(m) && /DRC/.test(m)));
  });
  it('reports a job that threw as one sentence and its message, with the source left in the job', async () => {
    const error = `Chip EDA failed (exit 1): 11 | const norm = (a: number) => (a % 360 + 360) % 360;
12 | function mm(v: unknown, fallback?: number): number {
16 |   throw new Error(\`Cannot legalize unsupported footprint dimension \${String(v)}\`);
                 ^
error: Cannot legalize unsupported footprint dimension 180deg
      at mm (/home/sogo/repos/moki/eda/blocks/legalize.ts:16:13)
      at map (1:11)
`;
    const thrown = { jobId: '00000000-0000-4000-8000-000000000000', status: 'failed', error, totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: false, errors: [], warnings: [] }, board: { widthMm: 0, heightMm: 0, layers: 2, traceCount: 0, viaCount: 0 }, stages: [{ name: 'codegen', status: 'done', ms: 0 }], artifacts: {}, input: { kind: 'plan' } };
    const board = { create: async () => ({ jobId: thrown.jobId }), get: async () => thrown, artifact: async () => null } as unknown as BoardClient;
    const quoting = tool('g', 'give_up', { reason: 'The pipeline threw.\n11 | const norm = (a: number) => a;\n   ^\n   at mm (/home/sogo/repos/moki/eda/blocks/legalize.ts:16:13)' });
    const { outcome, events, messages } = await turn(replay(propose, passes, compiled, quoting), board);
    assert.equal(outcome, 'build-failed');
    const sentence = 'The build failed during layout. Cannot legalize unsupported footprint dimension 180deg.';
    const result = events.find(e => e.type === 'job-result') as Extract<AgentEvent, { type: 'job-result' }>;
    assert.deepEqual(result.problems, [sentence]);
    assert.equal(messages.at(-1), sentence);
    assert.equal(messages.at(-2), 'The pipeline threw.');
    for (const text of [...messages, ...result.problems]) assert.doesNotMatch(text, /const norm|\d+ \||\^|legalize\.ts|\/home\//);
    assert.equal(thrown.error, error);
  });
  it('refuses a fix that redesigns the board, or repeats itself', async () => {
    const { board, created } = fakeBoard([3, 0]);
    const swap = plan(); swap.blocks[1]!.block = 'rp2040-core';
    const { events } = await turn(replay(propose, passes, compiled, tool('c', 'propose_fix', { reason: 'Swap.', plan: swap }), tool('d', 'propose_fix', { reason: 'Same.', plan: plan() }), fix('e', 70)), board);
    assert.equal(created.length, 2);
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /add, remove or swap/.test(e.summary)));
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /already tried/.test(e.summary)));
  });
});

describe('the schematic reviewer', () => {
  const mismatch = tool('r', 'submit_review', { findings: [finding('core'), finding('air', { status: 'mismatch', claim: 'Decoupling value', expected: '100 nF', found: '10 nF' })] });
  it('sends a mismatch to the Fixer, reviews again, and only then builds', async () => {
    const { board, created } = fakeBoard([0]);
    const fixed = plan(); fixed.sections[1]!.notes = ['Now 100 nF, per the datasheet.'];
    const { outcome, events } = await turn(replay(propose, mismatch, tool('f', 'propose_fix', { reason: 'Use 100 nF.', plan: fixed }), passes, compiled), board);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 1);
    assert.deepEqual(created[0]?.plan?.sections?.[1]?.notes, ['Now 100 nF, per the datasheet.', 'Unreviewed block: SHT40 humidity sensor.']);
    const order = events.flatMap(e => (e.type === 'role' ? [e.role] : []));
    assert.deepEqual(order, ['designer', 'reviewer', 'fixer', 'reviewer', 'firmware']);
  });
  it('fails the gate and builds nothing when a mismatch survives 2 fixes', async () => {
    const { board, created } = fakeBoard([0]);
    const fixed = (note: string) => { const p = plan(); p.layers = note === 'a' ? 4 : 2; p.board = { widthMm: note === 'a' ? 60 : 70, heightMm: 50 }; return p; };
    const { outcome, messages } = await turn(replay(propose, mismatch, tool('f', 'propose_fix', { reason: 'One.', plan: fixed('a') }), mismatch, tool('g', 'propose_fix', { reason: 'Two.', plan: fixed('b') }), mismatch), board);
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(messages.some(m => /Schematic gate failed after 2 fixes/.test(m) && /Expected 100 nF, found 10 nF/.test(m)));
  });
  it('treats cannot-verify as not passing', async () => {
    const { board, created } = fakeBoard([0]);
    const unsure = tool('r', 'submit_review', { findings: [finding('core'), { section: 'air', status: 'cannot-verify', claim: 'Sensor address' }] });
    const { outcome, messages } = await turn(replay(propose, unsure, tool('g', 'give_up', { reason: 'The datasheet is silent.' })), board);
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(messages.some(m => /Schematic gate failed/.test(m) && /couldn't verify Sensor address/.test(m)));
  });
  it('shows out-of-scope risks without stopping the build', async () => {
    const { board, created } = fakeBoard([0]);
    const risky = tool('r', 'submit_review', { findings: [finding('core'), finding('air'), { section: 'air', status: 'out-of-scope', claim: 'Thermal limits under load' }] });
    const { outcome, messages } = await turn(replay(propose, risky, compiled), board);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 1);
    assert.ok(messages.some(m => /No schematic review can settle these: Thermal limits under load/.test(m)));
  });
  it('gives a passive no datasheet of its own, even though its block cites the IC\'s', async () => {
    const lead = block('reg', { parts: [ic('C100'), { ...ic('C200'), ref: 'C1' }] });
    const seen = new PartEvidence(library(), [lead]);
    assert.equal(await seen.urlFor('C100'), 'https://example.com/C100.pdf');
    assert.equal(await seen.urlFor('C200'), null);
    await assert.rejects(seen.sheet('C200'), /no datasheet.*application circuit/);
  });
  it('sends back a review that invents a citation or skips a section', async () => {
    const { board } = fakeBoard([0]);
    const invented = tool('r', 'submit_review', { findings: [finding('core'), finding('air', { quote: 'A sentence that is not in the datasheet' })] });
    const skipped = tool('s', 'submit_review', { findings: [finding('core')] });
    const { outcome, events } = await turn(replay(propose, invented, skipped, passes, compiled), board);
    assert.equal(outcome, 'built');
    const refused = events.filter(e => e.type === 'tool' && e.name === 'submit_review' && !e.ok);
    assert.equal(refused.length, 2);
  });
  it('writes the review receipt only after a review passes, and only from code', async () => {
    const { board } = fakeBoard([0]);
    const receipts: { by: string; findings: unknown[] }[] = [];
    const chip: ChipLibrary = { ...library(), recordSchematicReview: (_plan, review) => { receipts.push(review); return 'hash'; } };
    await turn(replay(propose, passes, compiled), board, { chip });
    assert.equal(receipts.length, 1);
    assert.match(receipts[0]!.by, /reviewer$/);
    assert.equal(receipts[0]!.findings.length, 2);
    const failing = tool('r', 'submit_review', { findings: [finding('core'), finding('air', { status: 'mismatch', claim: 'Value', expected: '1', found: '2' })] });
    const refused: unknown[] = [];
    const none: ChipLibrary = { ...library(), recordSchematicReview: (_plan, review) => { refused.push(review); return 'hash'; } };
    await turn(replay(propose, failing, tool('g', 'give_up', { reason: 'No.' })), fakeBoard([0]).board, { chip: none });
    assert.equal(refused.length, 0);
  });
  it('reviews again when a build fix moves a pin', async () => {
    const { board, created } = fakeBoard([3, 0]);
    const moved = plan({ links: [{ from: 'core.GP6', to: 'air.SDA' }, { from: 'core.PWR', to: 'air.VCC' }] });
    const { outcome, events } = await turn(replay(propose, passes, compiled, tool('f', 'propose_fix', { reason: 'Other pin.', plan: moved }), passes), board);
    assert.equal(outcome, 'built');
    assert.equal(created.length, 2);
    assert.equal(events.filter(e => e.type === 'role' && e.role === 'reviewer').length, 2);
  });
  it('sends SPICE failures to the Fixer without spending on a review, and reports measurements', async () => {
    const { board } = fakeBoard([0]);
    let runs = 0;
    const chip: ChipLibrary = { ...library(), runSpiceChecks: async () => (++runs === 1
      ? { gate: 'spice', ok: false, issues: [{ rule: 'divider', severity: 'error', where: 'reg', message: 'FB divider gives 3.6 V' }], measurements: [{ where: 'reg', name: 'output', measured: 3.6, target: 3.3, tolerance: 0.1, unit: 'V', ok: false }] }
      : { gate: 'spice', ok: true, issues: [], measurements: [{ where: 'reg', name: 'output', measured: 3.3, target: 3.3, tolerance: 0.1, unit: 'V', ok: true }] }) };
    const { outcome, messages, events } = await turn(replay(propose, tool('f', 'propose_fix', { reason: 'Fix the divider.', plan: plan({ layers: 4 }) }), passes, compiled), board, { chip });
    assert.equal(outcome, 'built');
    assert.equal(runs, 2);
    assert.ok(messages.some(m => /SPICE: reg output: 3\.6 V, target 3\.3 V ±0\.1 \(out of range\)/.test(m)));
    assert.deepEqual(events.flatMap(e => (e.type === 'role' ? [e.role] : [])), ['designer', 'fixer', 'reviewer', 'firmware']);
  });
  it('stops without paying for a fix when the simulator couldn\'t run', async () => {
    const { board, created } = fakeBoard([0]);
    const chip: ChipLibrary = { ...library(), runSpiceChecks: async () => ({ gate: 'spice', ok: false, issues: [{ rule: 'spice-unavailable', severity: 'error', message: 'Unsupported value on R1' }] }) };
    const { outcome, messages, events } = await turn(replay(propose), board, { chip });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(messages.some(m => /SPICE gate couldn’t run/.test(m) && /R1/.test(m)));
    assert.ok(!events.some(e => e.type === 'role' && e.role === 'fixer'));
  });
  it('a schematic fix can change a passive but never an IC', () => {
    const draft = (lcsc: string, cap: string) => ({ id: 'reg', parts: [ic(lcsc), { ...ic('C1'), ref: 'C1', pins: { 1: { pad: '1', role: 'passive' }, 2: { pad: '2', role: 'passive' } }, value: cap }] }) as never;
    const before = plan({ drafts: [draft('C100', '10 nF')] });
    assert.equal(outOfBounds(before, plan({ drafts: [draft('C100', '100 nF')] }), blocks, 'schematic'), null);
    assert.match(outOfBounds(before, plan({ drafts: [draft('C200', '10 nF')] }), blocks, 'schematic')!, /swap an IC/);
    assert.match(outOfBounds(before, plan({ drafts: [draft('C100', '100 nF')] }), blocks, 'build')!, /circuit/);
    assert.match(outOfBounds(before, plan({ drafts: [] }), blocks, 'schematic')!, /new blocks/);
  });
});

describe('the turn request', () => {
  it('accepts only the chip mode', () => {
    assert.equal(parseTurn({ message: 'x', mode: 'chip' }).mode, 'chip');
    assert.equal(parseTurn({ message: 'x' }).mode, undefined);
    assert.throws(() => parseTurn({ message: 'x', mode: 'root' }), /mode/);
  });
});

describe('live drawing while the Designer works', () => {
  const partials = (events: AgentEvent[]) => events.filter((e): e is Extract<AgentEvent, { type: 'plan.partial' }> => e.type === 'plan.partial');
  const drawing = { parts: [], nets: [] };
  const drawn = (): ChipLibrary => ({ ...library(), planGraph: () => drawing });
  const designerOnly = async (...calls: ReplayFixture['calls']) => (await turn(replay(...calls), fakeBoard([0]).board, { chip: drawn() })).events;

  it('names each step, and sends the plan with its drawing once there is one', async () => {
    const steps = partials(await designerOnly(tool('l', 'list_blocks', {}), tool('g', 'get_block', { id: 'sht40' }), tool('c', 'check_plan', { plan: plan() }), propose, compiled, passes));
    assert.deepEqual(steps.map(s => s.step), ['Reading your brief', 'Reading the circuit blocks', 'Reading SHT40 humidity sensor', 'Checking the plan', 'Laying out the sections']);
    assert.equal(steps[1]!.plan, undefined);
    assert.equal(steps[3]!.plan?.title, 'Humidity logger');
    assert.deepEqual(steps[3]!.graph, drawing);
  });
  it('keeps a boastful draft off the canvas, and still reports the step', async () => {
    const steps = partials(await designerOnly(tool('c', 'check_plan', { plan: plan({ title: 'This board is proven to work.' }) }), propose, compiled, passes));
    assert.equal(steps[1]!.step, 'Checking the plan');
    assert.equal(steps[1]!.plan, undefined);
    assert.equal(steps[1]!.graph, undefined);
    assert.ok(steps[2]!.plan);
  });
  it('keeps a draft it can\'t draw off the canvas', async () => {
    const broken = { ...plan(), sections: [{ id: 'x', title: 'x', purpose: 'p', insts: ['core'], notes: 'not a list' }] };
    const noBlocks = { ...plan(), blocks: 'none' };
    const throwing: ChipLibrary = { ...library(), planGraph: () => { throw new Error('Unknown block'); } };
    for (const bad of [broken, noBlocks]) assert.equal(partials(await designerOnly(tool('c', 'check_plan', { plan: bad }), propose, compiled, passes))[1]!.plan, undefined);
    const { events } = await turn(replay(tool('c', 'check_plan', { plan: plan() }), propose, compiled, passes), fakeBoard([0]).board, { chip: throwing });
    assert.equal(partials(events)[1]!.plan, undefined);
  });
});

describe('which sections must cite a datasheet', () => {
  const pins = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { pad: String(i + 1), role: 'passive' as const }]));
  const tiny = block('tiny-sensor', { class: 'sensor', parts: [{ ...ic('C4000'), ref: 'U1', pins: pins(4) }] });
  const header = block('display-header', { class: 'display', parts: [{ ...ic('C3000'), ref: 'J1', pins: pins(6) }] });
  const issuesFor = async (def: BlockDef) => {
    const chip: ChipLibrary = { ...library(), blocks: () => [def] };
    const at = plan({ blocks: [{ inst: 'a', block: def.id, version: 1, params: {} }], links: [], sections: [{ id: 'a', title: 'A', purpose: 'Does a thing.', insts: ['a'], notes: ['A note.'] }] });
    return (await checkAgentPlan(at, chip, [def], new PartEvidence(chip, [def]))).issues;
  };
  it('asks a four-pin IC for its reference circuit', async () => assert.match((await issuesFor(tiny)).join(), /must cite the reference circuit/));
  it('doesn\'t ask a six-pad connector for one', async () => assert.deepEqual(await issuesFor(header), []));
});

describe('editing a board that exists', () => {
  const BASE = '00000000-0000-4000-8000-0000000000aa';
  const saved = () => plan({ app: { source: SOURCE } });
  const coreOnly = tool('r', 'submit_review', { findings: [finding('core')] });
  const edit = async (provider: ReturnType<typeof replay>, request: Partial<TurnRequest>, options: { chip?: ChipLibrary; savedPlan?: unknown; kind?: string } = {}) => {
    const events: AgentEvent[] = [];
    const created: { plan?: SchematicPlan; baseJobId?: string; ops?: unknown }[] = [];
    const reviews: unknown[] = [];
    const base = options.chip ?? library();
    const chip: ChipLibrary = { ...base, recordSchematicReview: (_plan, review) => { reviews.push(review); return 'hash'; } };
    let compiled = 0;
    const board = {
      create: async (input: { plan?: SchematicPlan }) => { created.push(input); return { jobId: `00000000-0000-4000-8000-00000000000${created.length - 1}` }; },
      get: async (jobId: string) => (jobId === BASE ? { ...finishedJob(jobId, 0), input: { kind: options.kind ?? 'plan', plan: options.savedPlan ?? saved() } } : finishedJob(jobId, 0)),
      artifact: async () => null,
    } as unknown as BoardClient;
    const outcome = await runTurn({ message: 'Apply my edit', mode: 'chip', jobId: BASE, ...request }, { provider, board, emit: e => events.push(e), pollMs: 1, chip, compileProject: async () => { compiled++; return { ok: true, ms: 1, errors: '' }; } });
    return { outcome, events, created, reviews, compiled: () => compiled, said: events.flatMap(e => (e.type === 'message' ? [e.text] : [])) };
  };

  it('runs a person\'s edit through review and keeps firmware when the wiring is the same, with no Editor', async () => {
    const { outcome, created, reviews, compiled, events, said } = await edit(replay(passes), { ops: [{ op: 'add_note', text: 'Keep it short.', section: 'core' }] });
    assert.equal(outcome, 'built');
    assert.equal(reviews.length, 1, 'a new review receipt, because the plan changed');
    assert.equal(compiled(), 0, 'firmware is kept');
    assert.equal(created[0]!.baseJobId, BASE);
    assert.deepEqual(created[0]!.ops, [{ op: 'add_note', text: 'Keep it short.', section: 'core' }]);
    assert.equal(created[0]!.plan!.app!.source, SOURCE);
    assert.ok(created[0]!.plan!.sections.find(s => s.id === 'core')!.notes.includes('Keep it short.'));
    assert.ok(!events.some(e => e.type === 'tool' && e.role === 'editor'), 'no model decided this change');
    assert.ok(!events.some(e => e.type === 'role' && e.role === 'designer'), 'never a new design');
    assert.ok(said.some(line => /second agent checks/.test(line)));
  });
  it('rewrites firmware from the old source when the wiring changes', async () => {
    const { outcome, created, compiled } = await edit(replay(coreOnly, compiled_), { ops: [{ op: 'remove_block', inst: 'air' }] });
    assert.equal(outcome, 'built');
    assert.equal(compiled(), 1);
    assert.equal(created[0]!.plan!.blocks.length, 1);
    assert.equal(created[0]!.plan!.links.length, 0);
  });
  it('refuses a person\'s edit in a sentence, with no model call and no job', async () => {
    const { outcome, created, events, said } = await edit(replay(), { ops: [{ op: 'remove_block', inst: 'nope' }] });
    assert.equal(outcome, 'no-change');
    assert.equal(created.length, 0);
    assert.ok(!events.some(e => e.type === 'call'));
    assert.match(said[0]!, /no block nope.*Nothing was built/);
  });
  it('lets the Editor use the same operations', async () => {
    const proposal = tool('e', 'propose_edit', { ops: [{ op: 'add_note', text: 'From the Editor.', section: 'core' }], summary: 'Added a note about the core.' });
    const { outcome, created, events } = await edit(replay(tool('g', 'get_plan', {}), proposal, passes), { message: 'add a note' });
    assert.equal(outcome, 'built');
    assert.ok(events.some(e => e.type === 'tool' && e.role === 'editor' && e.name === 'propose_edit' && e.ok));
    assert.deepEqual(created[0]!.ops, [{ op: 'add_note', text: 'From the Editor.', section: 'core' }]);
  });
  it('sends a bad Editor proposal back with the reason', async () => {
    const bad = tool('e', 'propose_edit', { ops: [{ op: 'add_part', id: 'R9', module: 'x', role: 'y' }], summary: 'Add a resistor.' });
    const good = tool('f', 'propose_edit', { ops: [{ op: 'add_note', text: 'A note.', section: 'core' }], summary: 'Added a note.' });
    const { events, outcome } = await edit(replay(bad, good, passes), { message: 'add a resistor' });
    assert.equal(outcome, 'built');
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'propose_edit' && !e.ok && /Add a block/.test(e.summary)));
  });
  it('holds a hand-added IC to the citation rule, through the Fixer', async () => {
    const chip = library();
    const twoSensors = { op: 'add_block', inst: 'air2', block: 'sht40' } as const;
    const { events } = await edit(replay(tool('g', 'give_up', { reason: 'I can’t find a citation.' })), { ops: [twoSensors] }, { chip });
    assert.ok(events.some(e => e.type === 'role' && e.role === 'fixer'));
    assert.ok(events.some(e => e.type === 'message' && /must cite the reference circuit/.test(e.text)));
  });
  it('drops the recorded ops when the Fixer changed the plan, since they no longer make it', async () => {
    const chip = library();
    const fixed = (() => { const next = plan(); next.sections.push({ id: 'air2', title: 'Second sensor', purpose: 'Reads humidity.', insts: ['air2'], notes: ['Same reference circuit.'], reference: next.sections[1]!.reference! }); next.blocks.push({ inst: 'air2', block: 'sht40', version: 1, params: {} }); return next; })();
    const fixTool = tool('x', 'propose_fix', { plan: fixed, reason: 'Added the citation.' });
    const review = tool('r', 'submit_review', { findings: [finding('core'), finding('air'), finding('air2')] });
    const { created, outcome } = await edit(replay(fixTool, review, compiled_), { ops: [{ op: 'add_block', inst: 'air2', block: 'sht40' }] }, { chip });
    assert.equal(outcome, 'built');
    assert.equal(created[0]!.ops, undefined);
    assert.equal(created[0]!.baseJobId, BASE);
  });
  it('keeps working when the library has moved on from a saved board\'s revisions', async () => {
    // Found by a real run: a saved plan pins revisions the latest-only list doesn't hold.
    const older = library();
    const chip: ChipLibrary = {
      ...older, blocks: () => [], blockHistory: () => blocks,
      checkPlan: (at, defs) => (at.blocks.every(i => defs.some(d => d.id === i.block && d.version === i.version)) ? pass : [{ gate: 'erc', ok: false, issues: [{ rule: 'block-missing', severity: 'error', message: 'Requested block revision is unavailable' }] }]),
    };
    const { outcome, created } = await edit(replay(passes), { ops: [{ op: 'add_note', text: 'Keep it short.', section: 'core' }] }, { chip });
    assert.equal(outcome, 'built');
    assert.equal(created.length, 1);
  });
  it('ends a refusal with a full sentence', async () => {
    const chip: ChipLibrary = { ...library(), checkPlan: () => [{ gate: 'erc', ok: false, issues: [{ rule: 'x', severity: 'error', message: 'Bus needs one controller' }] }] };
    const { said } = await edit(replay(), { ops: [{ op: 'add_note', text: 'Keep it short.', section: 'core' }] }, { chip });
    assert.equal(said[0], 'Bus needs one controller. Nothing was built.');
  });
  it('tells the Firmware agent what a person changed, and hands it the old source', async () => {
    const seen: string[] = [];
    const inner = replay(coreOnly, compiled_);
    const provider = { name: inner.name, model: inner.model, reserveFactor: inner.reserveFactor, call(request: Parameters<typeof inner.call>[0]) { seen.push(JSON.stringify(request.messages[0])); return inner.call(request); } } as ReturnType<typeof replay>;
    await edit(provider, { ops: [{ op: 'remove_block', inst: 'air' }] });
    const prompt = seen.at(-1)!;
    assert.match(prompt, /Removed air/);
    assert.doesNotMatch(prompt, /Apply my edit/);
    assert.match(prompt, /Arduino\.h/, 'the existing source goes with it');
  });
  it('won\'t treat another kind of build as a chip board', async () => {
    const { outcome, said, created } = await edit(replay(), { ops: [{ op: 'add_note', text: 'x y', section: 'core' }] }, { kind: 'design' });
    assert.equal(outcome, 'no-change');
    assert.equal(created.length, 0);
    assert.match(said[0]!, /isn’t a chip-level board/);
  });
});

describe('a build fix and the review it carries', () => {
  const unplaced = (at: SchematicPlan) => ({ ...at, blocks: at.blocks.map(({ at: _at, ...i }) => i) });
  it('keeps a plan with no requirements that way, because they count toward the reviewed circuit', async () => {
    const before = plan();
    const moved = { ...before, blocks: before.blocks.map(b => (b.inst === 'air' ? { ...b, at: { x: 5, y: 5 } } : b)) };
    const chip = library();
    const { result } = await runChipFixer({ provider: replay(tool('f', 'propose_fix', { plan: moved, reason: 'Moved it.' })), budget: new JobBudget(2), emit: () => {} }, 'build', before, {}, blocks, chip, evidence(chip), []);
    assert.equal(result?.kind, 'fix');
    assert.equal('requirements' in (result as { plan: SchematicPlan }).plan, false);
    assert.deepEqual(unplaced((result as { plan: SchematicPlan }).plan).blocks, unplaced(before).blocks);
  });
});

describe('board size is code\u2019s, not a model\u2019s guess', () => {
  const guessed = tool('a', 'propose_plan', { plan: plan({ board: { widthMm: 55, heightMm: 40 } }), summary: 'A humidity logger.', app_brief: 'Print humidity every second.' });
  const size = (value: [number, number]) => [{ id: 'size', plain: 'Fits', metric: 'board_size_mm', op: '<=', value, source: 'maker' }] as unknown as NonNullable<SchematicPlan['requirements']>;

  it('replaces a guessed board with one that packs, for the job the maker gets', async () => {
    const { board, created } = fakeBoard([0]);
    const { outcome, events } = await turn(replay(guessed, passes, compiled), board, { chip: sizedLibrary() });
    assert.equal(outcome, 'built');
    assert.deepEqual(created[0]?.plan?.board, { widthMm: 46, heightMm: 66, cornerRadiusMm: 2 });
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'propose_plan' && /46 \u00d7 66 mm board/.test(e.summary)));
  });
  it('shows the Designer the envelopes, without a board to guess', async () => {
    const { board } = fakeBoard([0]);
    let shown = '';
    const provider = replay(tool('c', 'check_plan', { plan: plan() }), propose, passes, compiled);
    const seeing = { ...provider, call: async (request: Parameters<typeof provider.call>[0]) => { shown += JSON.stringify(request.messages); return provider.call(request); } } as typeof provider;
    await turn(seeing, board, { chip: sizedLibrary() });
    assert.match(shown, /reservedSectionEnvelopesMm/);
    assert.match(shown, /37\.46/);
    assert.match(shown, /codeWillUseMm/);
  });
  it('keeps a size the maker asked for, only if it packs and stays inside what they confirmed', async () => {
    const chip = sizedLibrary();
    const asked = plan({ board: { widthMm: 50, heightMm: 70 } });
    assert.deepEqual((await sizedPlan(asked, chip, size([50, 70])) as { plan: SchematicPlan }).plan.board, asked.board);
    assert.deepEqual((await sizedPlan(plan({ board: { widthMm: 30, heightMm: 30 } }), chip, size([50, 70])) as { plan: SchematicPlan }).plan.board, sizing().chosen);
    assert.deepEqual((await sizedPlan(plan({ board: { widthMm: 80, heightMm: 90 } }), chip, size([50, 70])) as { plan: SchematicPlan }).plan.board, sizing().chosen);
    assert.deepEqual((await sizedPlan(asked, chip) as { plan: SchematicPlan }).plan.board, sizing().chosen, 'No confirmed size means nobody asked for one.');
  });
  it('says so early when the maker\u2019s size can\u2019t hold the sections', async () => {
    const chip = sizedLibrary(async () => ({ sections: [], impossible: 'Automatic section packing found no arrangement in automatic board within confirmed size limits; reserved section envelopes: core 37.46\u00d744.77mm.' }));
    const out = await sizedPlan(plan(), chip, size([20, 20]));
    assert.match((out as { issue: string }).issue, /^Board size gate: .*37\.46/);
    const { board, created } = fakeBoard([0]);
    const { outcome, events } = await turn(replay(propose, tool('d', 'decline', { message: 'It can\u2019t fit.', closest: 'A bigger board.' })), board, { chip });
    assert.equal(outcome, 'declined');
    assert.equal(created.length, 0);
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'propose_plan' && !e.ok));
  });
  it('leaves the size to the job when the sizer can\u2019t run, and never keeps the guess', async () => {
    const chip = sizedLibrary(async () => { throw new Error('bun is missing'); });
    const out = await sizedPlan(plan({ board: { widthMm: 55, heightMm: 40 } }), chip) as { plan: SchematicPlan };
    assert.equal(out.plan.board, undefined);
  });
  it('asks the worker once for the same plan, whatever its words say', async () => {
    let runs = 0;
    const size = boardSizer(async () => { runs++; return { code: 0, stdout: `noise\n${JSON.stringify(sizing())}\n`, stderr: '' }; });
    assert.deepEqual((await size(plan())).chosen, sizing().chosen);
    await size(plan({ title: 'Renamed' }));
    assert.equal(runs, 1);
    await size(plan({ layers: 4 }));
    assert.equal(runs, 2);
    await assert.rejects(boardSizer(async () => ({ code: 1, stdout: '', stderr: 'boom' }))(plan()), /exit 1.*boom/);
  });
});

describe('what a build Fixer may not do', () => {
  const clearanceJob = (jobId: string, errors: number): AgentJob => ({ ...finishedJob(jobId, errors), status: 'failed' });
  const boardOf = (errors: number[]) => {
    const created: { plan?: BoardPlan; baseJobId?: string }[] = [];
    const counts = new Map<string, number>();
    const board = {
      create: async (input: { plan?: BoardPlan; baseJobId?: string }) => { const jobId = `00000000-0000-4000-8000-00000000000${created.length}`; counts.set(jobId, errors[created.length] ?? 0); created.push(input); return { jobId }; },
      get: async (jobId: string) => (counts.get(jobId) ? clearanceJob(jobId, counts.get(jobId)!) : finishedJob(jobId, 0)),
      artifact: async () => null,
    } as unknown as BoardClient;
    return { board, created };
  };
  const fixBoard = (id: string, widthMm: number, layers = 2) => tool(id, 'propose_fix', { plan: plan({ layers: layers as 2 | 4, board: { widthMm, heightMm: 70 } }), reason: `Try ${widthMm} mm on ${layers} layers.` });
  const giveUp = tool('g', 'give_up', { reason: 'Nothing bounded helps.' });

  it('recognises a clearance failure', () => {
    assert.ok(isClearance({ type: 'pcb_trace_error', message: 'PCB trace .U5 > .pin11 to net.VCP_PUMP is too close to .U5 > .pin12 to net.VBUS (gap: 0.096mm)' }));
    assert.ok(isClearance({ type: 'pcb_via_clearance_error', message: 'Vias from different nets' }));
    assert.ok(!isClearance({ type: 'pcb_trace_error', message: 'Trace has dangling endpoint at (1, 2)' }));
  });
  it('refuses more layers for a clearance failure, and the turn never builds them', async () => {
    const { board, created } = boardOf([1]);
    const { outcome, events } = await turn(replay(propose, passes, compiled, fixBoard('x', 46, 4), giveUp), board, { chip: sizedLibrary() });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 1);
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'propose_fix' && !e.ok && /Layers stay at 2/.test(e.summary)));
  });
  it('still lets layers change when nothing was too close', async () => {
    const dangling = { ...finishedJob('00000000-0000-4000-8000-000000000000', 0), status: 'failed', drc: { checked: true, errors: [{ type: 'pcb_trace_error', message: 'Trace has a dangling endpoint' }], warnings: [] } } as unknown as AgentJob;
    let count = 0;
    const created: { plan?: BoardPlan }[] = [];
    const board = { create: async (input: { plan?: BoardPlan }) => { created.push(input); return { jobId: `00000000-0000-4000-8000-00000000000${count++}` }; }, get: async (jobId: string) => (jobId.endsWith('0') ? dangling : finishedJob(jobId, 0)), artifact: async () => null } as unknown as BoardClient;
    const { outcome } = await turn(replay(propose, passes, compiled, fixBoard('x', 46, 4), passes), board, { chip: sizedLibrary() });
    assert.equal(outcome, 'built');
    assert.equal(created[1]?.plan?.layers, 4);
  });
  it('refuses a board its sections can\u2019t pack on, with the real minimum', async () => {
    const { board, created } = boardOf([1]);
    const { events } = await turn(replay(propose, passes, compiled, fixBoard('x', 30), giveUp), board, { chip: sizedLibrary() });
    assert.equal(created.length, 1);
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'propose_fix' && !e.ok && /smallest board that holds them is 40 \u00d7 60 mm/.test(e.summary)));
  });
  it('goes back when a change makes errors go up, and won\u2019t try that change again', async () => {
    const { board, created } = boardOf([1, 17, 0]);
    // 1 error, then the 80 mm board takes it to 17. Code goes back to 46 mm. 80 mm again is refused, even with a block moved as well, and 90 mm builds.
    const again = plan({ board: { widthMm: 80, heightMm: 70 } });
    again.blocks[0]!.at = { x: 1, y: 2 };
    const { outcome, events, messages } = await turn(replay(propose, passes, compiled, fixBoard('x', 80), tool('y', 'propose_fix', { plan: again, reason: 'Again, with a move.' }), fixBoard('z', 90)), board, { chip: sizedLibrary() });
    assert.equal(outcome, 'built');
    assert.equal(created.length, 3);
    assert.equal(created[1]?.plan?.board?.widthMm, 80);
    assert.equal(created[2]?.plan?.board?.widthMm, 90);
    assert.equal(created[2]?.baseJobId, '00000000-0000-4000-8000-000000000000', 'The new job comes from the better board.');
    assert.ok(messages.some(m => /from 1 DRC error to 17, so I went back/.test(m)));
    assert.ok(events.some(e => e.type === 'tool' && e.name === 'propose_fix' && !e.ok && /already made DRC errors go up/.test(e.summary)));
  });
  it('says which attempt was closer when the last one was the worst', async () => {
    const { board } = boardOf([3, 1, 17]);
    const { outcome, messages } = await turn(replay(propose, passes, compiled, fixBoard('x', 80), fixBoard('y', 90)), board, { chip: sizedLibrary() });
    assert.equal(outcome, 'build-failed');
    assert.match(messages.at(-1)!, /The attempt before it was closer, with 1 DRC error\./);
  });
  it('doesn\u2019t count a job that threw before DRC as zero errors', async () => {
    const threw = { ...finishedJob('00000000-0000-4000-8000-000000000000', 0), status: 'failed', error: 'Chip EDA failed (exit 1): nope', drc: { checked: false, errors: [], warnings: [] }, stages: [] } as unknown as AgentJob;
    let count = 0;
    const board = { create: async () => ({ jobId: `00000000-0000-4000-8000-00000000000${count++}` }), get: async (jobId: string) => (jobId.endsWith('0') ? threw : clearanceJob(jobId, 1)), artifact: async () => null } as unknown as BoardClient;
    const { messages } = await turn(replay(propose, passes, compiled, fixBoard('x', 80), giveUp), board, { chip: sizedLibrary() });
    assert.ok(!messages.some(m => /went back/.test(m)));
  });
  it('names what changed between two plans', () => {
    const moved = plan({ layers: 4, board: { widthMm: 80, heightMm: 70 } });
    moved.blocks[0]!.at = { x: 1, y: 2 };
    moved.links = [...moved.links.slice(1), { from: 'core.GP5', to: 'air.SDA' }];
    assert.deepEqual(planChanges(plan(), moved), ['layers 2 to 4', 'board automatic to 80 \u00d7 70 mm', 'core moved to 1,2,0', 'link air.SDA to core.GP5']);
  });
});
