// The Firmware agent. Replay and a fake compiler only: no model, no PlatformIO, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { interpretBrief } from '../src/circuit/interpret.js';
import { buildDesign } from '../src/circuit/templates.js';
import { MODULE } from '../src/circuit/catalog.js';
import type { CircuitDesign } from '../src/circuit/model.js';
import type { BoardClient } from '../src/agents/board-client.js';
import type { AgentJob } from '../src/agents/facts.js';
import { compilerErrors, MAX_COMPILE_TRIES, runFirmware, type CompileApp } from '../src/agents/firmware.js';
import { appProject, appTarget, checkAppSource } from '../src/agents/firmware-project.js';
import { JobBudget, replayProvider, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent } from '../src/agents/protocol.js';
import { applyChange } from '../src/agents/roles.js';
import { validateDesign } from '../src/agents/tools.js';
import { contentId } from '../src/circuit/graph.js';
import { runTurn } from '../src/agents/turn.js';

const design = (brief: string): CircuitDesign => {
  const read = interpretBrief(brief);
  assert.ok(read.ok);
  return buildDesign(read.interpretation);
};
const timer = design('A 25 minute focus timer with a small screen and a knob');
const monitor = design('A temperature monitor with a small screen and a chime');
const HEADERS = appTarget(timer).headers;
const GOOD = '#include <Arduino.h>\n#include "pins.h"\n#include <Wire.h>\nvoid setup() { pinMode(PIN_SW1_SW, INPUT_PULLUP); }\nvoid loop() {}\n';

const tool = (id: string, name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use' as const, id, name, input }], stopReason: 'tool_use' as const });
const replay = (...calls: ReplayFixture['calls']) => replayProvider({ id: 'firmware', provenance: 'authored', calls });
const compile = (source: unknown, summary = 'Does the job.') => ({ source, summary });

describe('firmware source check', () => {
  it('accepts ordinary firmware', () => assert.deepEqual(checkAppSource(GOOD, HEADERS), []));
  it('ignores the same words in strings and comments', () => {
    assert.deepEqual(checkAppSource('#include <Arduino.h>\n// asm __has_include .incbin not real\nconst char* a = "asm __FILE__";\nvoid setup() {}\nvoid loop() {}\n', HEADERS), []);
  });
  for (const [name, source] of [
    ['an absolute path', '#include "/run/user/1000/sogo-apps/moki.env"\n'],
    ['a relative path', '#include "../../secret.h"\n'],
    ['a header not on the list', '#include <WiFi.h>\n'],
    ['a directive split by a comment', '#/**/include "/etc/passwd"\n'],
    ['a directive split by a line continuation', '#inc\\\nlude "/etc/passwd"\n'],
    ['a computed include', '#define F "/etc/passwd"\n#include F\n'],
    ['a digraph directive', '%:include "/etc/passwd"\n'],
    ['include_next', '#include_next <Arduino.h>\n'],
    ['#embed', '#embed "/etc/passwd"\n'],
    ['#import', '#import "/etc/passwd"\n'],
    ['#error', '#error nope\n'],
    ['a pragma', '#pragma GCC poison x\n'],
    ['_Pragma', '_Pragma("GCC dependency \\"/etc/passwd\\"")\n'],
    ['inline assembly', 'asm(".incbin \\"/etc/passwd\\"");\n'],
    ['__asm__', '__asm__("nop");\n'],
    ['.incbin text', 'const char* a = ".incbin";\n'],
    ['__has_include', '#if __has_include("/etc/passwd")\n#endif\n'],
    ['a raw string that could hide a directive', 'const char* a = R"(\n#include "/etc/passwd"\n)";\n'],
    ['a trigraph', '??=include "/etc/passwd"\n'],
    ['a section attribute', '__attribute__((section(".x"))) int y;\n'],
    ['an unclosed comment', '/* never closed\n'],
    ['a directive hidden by a spliced string', '"x\\ \n/* ";\n#include "/any"\n/* */\n'],
    ['a raw string split across a line', 'const char* a = R\\\n"(x)";\n'],
    ['assembly built by token pasting', '#define J(a,b) a##b\nJ(as,m)(".inc" "bin");\n'],
    ['assembly hidden after a digit separator', 'int a = 1\'0; asm("nop");\n'],
    ['something that is not text', 42],
    ['nothing', '   '],
    ['too much', 'x'.repeat(30_001)],
  ] as const) {
    it(`refuses ${name}`, () => assert.ok(checkAppSource(source, HEADERS).length > 0));
  }
});

describe('firmware project', () => {
  it('names pins from nets, whatever the template', () => {
    const pins = Object.fromEntries(appTarget(timer).pins.map(p => [p.name, p.gpio]));
    for (const name of ['PIN_SW1_CLK', 'PIN_SW1_DT', 'PIN_SW1_SW', 'PIN_U2_SDA', 'PIN_U2_SCL', 'PIN_I2C_SDA', 'PIN_I2C_SCL']) assert.equal(typeof pins[name], 'number', name);
    assert.equal(pins.PIN_I2C_SDA, pins.PIN_U2_SDA);
  });
  it('reaches an LED through its series resistor', () => {
    const lamp = design('A little night lamp that comes on when it gets dark');
    const led = appTarget(lamp).pins.find(p => p.part === lamp.parts.find(x => x.module === MODULE.led)!.id);
    assert.ok(led, 'the LED has a named pin');
    assert.equal(led.output, true);
  });
  it('gets libraries from the parts', () => {
    assert.ok(appTarget(timer).libs.some(l => l.includes('SSD1306')));
    assert.ok(!appTarget(timer).libs.some(l => l.includes('BME280')));
    assert.ok(!appTarget(timer).headers.includes('Adafruit_BME280.h'));
  });
  it('keeps model text out of platformio.ini and pins.h', () => {
    const project = appProject({ ...timer, title: 'Evil\n[env:esp32dev]\nextra_scripts = pre:x.py' }, GOOD, 'platformio/espressif32@6.10.0');
    assert.equal(project['src/main.cpp'], GOOD);
    assert.ok(!project['platformio.ini']!.includes('extra_scripts'));
    assert.ok(!project['README.md']!.includes('\n[env'));
    assert.match(project['include/pins.h']!, /constexpr int PIN_SW1_SW = \d+;/);
  });
  it('refuses a bad source at the last step too', () => {
    assert.throws(() => appProject(timer, '#include "/etc/passwd"\n', 'p'), /refused/);
  });
  it('strips this server\'s paths from compiler errors', () => {
    const out = compilerErrors('Compiling\n/home/sogo/repos/moki/var/firmware-agent/abc/firmware/src/main.cpp:3:1: error: oops\n*** [x] Error 1\n');
    assert.match(out, /main\.cpp:3:1: error: oops/);
    assert.ok(!out.includes('/home/sogo'));
  });
});

describe('validateDesign with custom firmware', () => {
  it('accepts a design and its app', () => {
    assert.deepEqual(validateDesign({ ...timer, app: { source: GOOD, brief: 'A game' } }), []);
    assert.deepEqual(validateDesign(timer, { customFirmware: true }), []);
  });
  it('refuses an unsafe app sent from a browser', () => {
    assert.ok(validateDesign({ ...timer, app: { source: '#include "/etc/passwd"\n', brief: 'x' } }).some(i => /plain file name/.test(i)));
    assert.ok(validateDesign({ ...timer, app: 'text' }).length > 0);
    assert.ok(validateDesign({ ...timer, app: null }).length > 0);
    assert.ok(validateDesign({ ...timer, app: { source: GOOD, brief: 7 } }).length > 0);
  });
  it('still needs a place on the board for every part', () => {
    // The temperature board has fixed spots. The focus-timer board stacks whatever it's given.
    assert.ok(validateDesign({ ...timer, template: 'temp-monitor' }, { customFirmware: true }).some(i => /no place/.test(i)));
    const lamp = design('A little night lamp that comes on when it gets dark');
    assert.deepEqual(validateDesign({ ...lamp, template: 'focus-timer' }, { customFirmware: true }), []);
  });
});

describe('runFirmware', () => {
  const run = async (provider: ReturnType<typeof replay>, compiler: CompileApp, previous?: string) => {
    const events: AgentEvent[] = [];
    const out = await runFirmware({ provider, budget: new JobBudget(2), emit: e => events.push(e), compile: compiler }, timer, 'A reaction game', previous);
    return { ...out, events };
  };
  const fail: CompileApp = async () => ({ ok: false, ms: 1, errors: 'main.cpp:1:1: error: nope' });

  it('fixes from compiler errors and returns what compiled', async () => {
    let compiles = 0;
    const compiler: CompileApp = async () => (++compiles === 1 ? { ok: false, ms: 1, errors: 'main.cpp:1:1: error: nope' } : { ok: true, ms: 1, errors: '' });
    const { result } = await run(replay(tool('a', 'get_pin_map', {}), tool('b', 'compile_app', compile(`${GOOD}// one`)), tool('c', 'compile_app', compile(`${GOOD}// two`))), compiler);
    assert.equal(compiles, 2);
    assert.ok(result?.kind === 'app');
    assert.equal(result.tries, 2);
    assert.ok(result.source.endsWith('// two'));
  });
  it(`stops after ${MAX_COMPILE_TRIES} compiles, even if the model would keep going`, async () => {
    let compiles = 0;
    const counted: CompileApp = async (...args) => { compiles++; return fail(...args); };
    const { result } = await run(replay(tool('a', 'compile_app', compile(GOOD)), tool('b', 'compile_app', compile(GOOD)), tool('c', 'compile_app', compile(GOOD)), tool('d', 'compile_app', compile(GOOD))), counted);
    assert.equal(compiles, MAX_COMPILE_TRIES);
    assert.ok(result?.kind === 'failed');
    assert.match(result.reason, /error: nope/);
  });
  it('holds the limit when one response asks for many compiles', async () => {
    let compiles = 0;
    const counted: CompileApp = async (...args) => { compiles++; return fail(...args); };
    const many = { content: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ type: 'tool_use' as const, id, name: 'compile_app', input: compile(GOOD) })), stopReason: 'tool_use' as const };
    const { result } = await run(replay(many), counted);
    assert.equal(compiles, MAX_COMPILE_TRIES);
    assert.ok(result?.kind === 'failed');
  });
  it('stops compiling once one has passed', async () => {
    let compiles = 0;
    const counted: CompileApp = async () => { compiles++; return { ok: true, ms: 1, errors: '' }; };
    const many = { content: ['a', 'b', 'c'].map(id => ({ type: 'tool_use' as const, id, name: 'compile_app', input: compile(GOOD) })), stopReason: 'tool_use' as const };
    await run(replay(many), counted);
    assert.equal(compiles, 1);
  });
  it('never hands a refused source to the compiler, and that costs no compile', async () => {
    let compiled = 0;
    const compiler: CompileApp = async () => { compiled++; return { ok: true, ms: 1, errors: '' }; };
    const { result, events } = await run(replay(tool('a', 'compile_app', compile('#include "/etc/passwd"\n')), tool('b', 'compile_app', compile(GOOD))), compiler);
    assert.equal(compiled, 1);
    assert.ok(result?.kind === 'app');
    assert.equal(result.tries, 1);
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /Refused/.test(e.summary)));
  });
  it('lets the model say the parts can\'t do it', async () => {
    const { result } = await run(replay(tool('a', 'give_up', { reason: 'There is no humidity sensor on this design.' })), fail);
    assert.ok(result?.kind === 'failed');
    assert.equal(result.tries, 0);
  });
  it('stops at the budget', async () => {
    const events: AgentEvent[] = [];
    await assert.rejects(runFirmware({ provider: replay(tool('a', 'compile_app', compile(GOOD))), budget: new JobBudget(0.000001), emit: e => events.push(e), compile: fail }, timer, 'A game'), /limit/);
  });
});

describe('a turn with custom firmware', () => {
  const finished = (jobId: string, input: { design?: CircuitDesign }): AgentJob => ({
    jobId, status: 'done', totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: true, errors: [], warnings: [] }, board: { widthMm: 75, heightMm: 75, layers: 2, traceCount: 1, viaCount: 0 },
    stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'done', ms: 0 }], artifacts: {}, input: { kind: 'design', sourceSha256: 'x', ...(input.design?.app ? {} : {}) },
  } as unknown as AgentJob);
  const fakeBoard = () => {
    const created: { design?: CircuitDesign }[] = [];
    const board = {
      create: async (input: { design?: CircuitDesign }) => { created.push(input); return { jobId: `00000000-0000-4000-8000-00000000000${created.length}` }; },
      get: async (jobId: string) => finished(jobId, created.at(-1) ?? {}),
      artifact: async () => null,
    } as unknown as BoardClient;
    return { board, created };
  };
  const ok: CompileApp = async () => ({ ok: true, ms: 1, errors: '' });
  const proposal = tool('a', 'propose_design', { design: timer, summary: 'A reaction game.', custom_firmware: 'Wait a random time, beep, time the knob press.' });

  it('builds the design with the firmware that compiled, and says what is unproven', async () => {
    const { board, created } = fakeBoard();
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ message: 'A reaction-time game' }, { provider: replay(proposal, tool('b', 'compile_app', compile(GOOD))), board, compileApp: ok, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'built');
    assert.equal(created[0]?.design?.app?.source, GOOD);
    assert.match(created[0]?.design?.app?.brief ?? '', /random time/);
    assert.ok(events.some(e => e.type === 'role' && e.role === 'firmware'));
    assert.ok(events.some(e => e.type === 'message' && e.role === 'firmware' && /only been compiled/.test(e.text)));
    const announced = events.find((e): e is Extract<AgentEvent, { type: 'design' }> => e.type === 'design');
    assert.equal(announced?.design.app?.source, GOOD);
  });
  it('builds nothing when the compile gate fails, and names the gate', async () => {
    const { board, created } = fakeBoard();
    const events: AgentEvent[] = [];
    const bad: CompileApp = async () => ({ ok: false, ms: 1, errors: 'main.cpp:1:1: error: nope' });
    const outcome = await runTurn({ message: 'A reaction-time game' }, { provider: replay(proposal, tool('b', 'compile_app', compile(GOOD)), tool('c', 'compile_app', compile(GOOD)), tool('d', 'compile_app', compile(GOOD))), board, compileApp: bad, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'build-failed');
    assert.equal(created.length, 0);
    assert.ok(events.some(e => e.type === 'message' && /Compile gate failed/.test(e.text) && /error: nope/.test(e.text)));
    assert.ok(!events.some(e => e.type === 'design'));
  });
  it('refuses firmware smuggled inside a design', async () => {
    const { board, created } = fakeBoard();
    const events: AgentEvent[] = [];
    await runTurn({ message: 'A game' }, { provider: replay(tool('a', 'propose_design', { design: { ...timer, app: { source: GOOD, brief: 'x' } }, summary: 'A game.' }), { content: [{ type: 'text', text: 'Sorry.' }], stopReason: 'end_turn' }), board, compileApp: ok, emit: e => events.push(e), pollMs: 1 });
    assert.equal(created.length, 0);
    assert.ok(events.some(e => e.type === 'tool' && !e.ok && /firmware inside a design/.test(e.summary)));
  });
  it('doesn\'t call it built when custom firmware wasn\'t compiled on the job', async () => {
    const created: { design?: CircuitDesign }[] = [];
    const skipped = { ...finished('00000000-0000-4000-8000-000000000001', {}), stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'skipped', ms: 0 }] } as unknown as AgentJob;
    const board = { create: async (input: { design?: CircuitDesign }) => { created.push(input); return { jobId: '00000000-0000-4000-8000-000000000001' }; }, get: async () => skipped, artifact: async () => null } as unknown as BoardClient;
    const events: AgentEvent[] = [];
    const outcome = await runTurn({ message: 'A reaction-time game' }, { provider: replay(proposal, tool('b', 'compile_app', compile(GOOD))), board, compileApp: ok, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'build-failed');
    assert.ok(events.some(e => e.type === 'message' && /Compile gate failed/.test(e.text)));
  });
  it('keeps a growing brief within what validation accepts', async () => {
    const { board, created } = fakeBoard();
    const long: CircuitDesign = { ...monitor, app: { source: GOOD, brief: 'x'.repeat(1990) } };
    await runTurn({ message: 'beep twice', design: long, jobId: '11111111-1111-4111-8111-111111111111' }, {
      provider: replay(tool('a', 'change_firmware', { request: 'Beep twice on an alert.', summary: 'Beep twice.' }), tool('b', 'compile_app', compile(GOOD))),
      board, compileApp: ok, emit: () => {}, pollMs: 1 });
    assert.ok(created[0]?.design?.app!.brief.length! <= 2000);
    assert.deepEqual(validateDesign(created[0]?.design), []);
    assert.match(created[0]!.design!.app!.brief, /Beep twice/);
  });
  it('refuses a behaviour setting on custom firmware, because it wouldn\'t reach it', () => {
    const change = applyChange({ ...monitor, app: { source: GOOD, brief: 'x' } }, { ops: [{ op: 'set_behavior', label: 'Alert above', value: '30 °C' }] });
    assert.match((change as { error: string }).error, /change_firmware/);
  });
  it('gives a design a new id when only its firmware changes, and every other design its old one', () => {
    const base = contentId(monitor);
    assert.notEqual(contentId({ ...monitor, app: { source: GOOD, brief: 'x' } }), base);
    assert.notEqual(contentId({ ...monitor, app: { source: GOOD, brief: 'x' } }), contentId({ ...monitor, app: { source: `${GOOD}//`, brief: 'x' } }));
    assert.equal(contentId({ ...monitor }), base);
  });
  it('runs no firmware agent when a fixed program does the job', async () => {
    const { board, created } = fakeBoard();
    const events: AgentEvent[] = [];
    const never: CompileApp = async () => { throw new Error('no compile expected'); };
    await runTurn({ message: 'A focus timer' }, { provider: replay(tool('a', 'propose_design', { design: timer, summary: 'A timer.' })), board, compileApp: never, emit: e => events.push(e), pollMs: 1 });
    assert.equal(created[0]?.design?.app, undefined);
    assert.ok(!events.some(e => e.type === 'role' && e.role === 'firmware'));
  });
  it('changes firmware from the chat, keeping the parts and the lineage', async () => {
    const { board, created } = fakeBoard();
    const events: AgentEvent[] = [];
    const jobId = '11111111-1111-4111-8111-111111111111';
    const current: CircuitDesign = { ...monitor, app: { source: GOOD, brief: 'Show the temperature.' } };
    const outcome = await runTurn({ message: 'make it beep twice', design: current, jobId }, {
      provider: replay(tool('a', 'change_firmware', { request: 'Beep twice on an alert.', summary: 'Beep twice.' }), tool('b', 'compile_app', compile(`${GOOD}// twice`))),
      board, compileApp: ok, emit: e => events.push(e), pollMs: 1 });
    assert.equal(outcome, 'built');
    assert.ok(created[0]?.design?.app?.source.endsWith('// twice'));
    assert.deepEqual(created[0]?.design?.parts, monitor.parts);
    assert.equal((created[0] as { baseJobId?: string }).baseJobId, jobId);
  });
});
