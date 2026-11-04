import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODULE, pinDef } from '../src/circuit/catalog.js';
import { buildDesign } from '../src/circuit/templates.js';
import type { CircuitDesign, DesignOptions, TemplateId } from '../src/circuit/model.js';
import { firmwareProject, generateFirmware, compileFirmware } from '../src/firmware/index.js';

function design(template: TemplateId, options: Partial<DesignOptions> = {}): CircuitDesign {
  return buildDesign({ template, chosenBy: 'user', recognized: [], notes: [], options: { buzzer: true, display: true, sensor: 'ds18b20', pins: {}, ...options } });
}
const variants = [design('focus-timer'), design('light-lamp'), design('temp-monitor'), design('temp-monitor', { sensor: 'bme280' })];

test('each template and sensor variant generates precisely the graph GPIO set', () => {
  for (const graph of variants) {
    const header = firmwareProject(graph)['include/pins.h']!;
    const actual = [...header.matchAll(/constexpr int PIN_\w+ = (\d+);/g)].map(m => Number(m[1])).sort((a, b) => a - b);
    const mcu = graph.parts.find(p => p.module === MODULE.esp32)!;
    const expected = graph.nets.flatMap(n => n.endpoints.filter(e => e.part === mcu.id).map(e => pinDef(mcu.module, e.pin)?.gpio?.gpio)).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
    assert.deepEqual(actual, expected, graph.template);
    const cpp = firmwareProject(graph)['src/main.cpp']!;
    for (const [, name] of cpp.matchAll(/\b(PIN_\w+)\b/g)) assert.ok(header.includes(`int ${name} =`), `${name} has graph assignment`);
    assert.ok(!cpp.includes('TODO'));
  }
});

test('pin reassignment changes the header without changing driver code', () => {
  for (const graph of variants) {
    const changed = structuredClone(graph);
    const end = changed.nets.flatMap(n => n.endpoints).find(e => e.pin === (graph.template === 'light-lamp' ? 'GPIO25' : 'GPIO23'))!;
    end.pin = 'GPIO26';
    const before = firmwareProject(graph), after = firmwareProject(changed);
    assert.notEqual(after['include/pins.h'], before['include/pins.h']);
    assert.ok(after['include/pins.h']!.includes('= 26;'));
    assert.equal(after['src/main.cpp'], before['src/main.cpp']);
  }
});

test('I2C pins follow a graph remap and ambiguous bus topology is rejected', () => {
  const graph = design('temp-monitor', { sensor: 'bme280' });
  const sda = graph.nets.find(n => n.id === 'I2C_SDA')!;
  sda.endpoints.find(e => e.pin === 'GPIO21')!.pin = 'GPIO26';
  assert.match(firmwareProject(graph)['include/pins.h']!, /PIN_I2C_SDA = 26/);
  const bmeEnd = sda.endpoints.find(e => e.part === 'U3')!;
  sda.endpoints = sda.endpoints.filter(e => e !== bmeEnd);
  graph.nets.push({ id: 'SECOND_BUS', name: 'SECOND_BUS', kind: 'signal', why: 'test', endpoints: [bmeEnd, { part: 'U1', pin: 'GPIO25' }] });
  assert.throws(() => firmwareProject(graph), /share an I2C bus/);
});

test('generation is byte deterministic, including its ZIP archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-firmware-'));
  try {
    for (const [i, graph] of variants.entries()) {
      const a = join(dir, String(i), 'a'), b = join(dir, String(i), 'b');
      const first = await generateFirmware(graph, a), second = await generateFirmware(graph, b);
      assert.deepEqual(first.files, second.files);
      for (const file of first.files) assert.deepEqual(await readFile(join(a, file)), await readFile(join(b, file)), file);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('behavior settings and sensor choices affect actual firmware', () => {
  const timer = firmwareProject(design('focus-timer', { focusMinutes: 7, buzzer: false }));
  assert.match(timer['src/main.cpp']!, /INITIAL_MINUTES = 7/);
  assert.ok(!timer['include/pins.h']!.includes('BUZZER'));
  const lamp = firmwareProject(design('light-lamp', { darkPercent: 42 }));
  assert.match(lamp['src/main.cpp']!, /DARK_PERCENT = 42/);
  assert.match(lamp['src/main.cpp']!, /LIGHT_PERCENT = 47/);
  const temperature = firmwareProject(design('temp-monitor', { sensor: 'bme280', alertC: -5, alertDirection: 'below' }));
  assert.match(temperature['src/main.cpp']!, /ALERT_C = -5/);
  assert.match(temperature['src/main.cpp']!, /ALERT_BELOW = true/);
  assert.match(temperature['src/main.cpp']!, /sensor.begin\(0x76/);
  assert.ok(!temperature['platformio.ini']!.includes('DallasTemperature'));
  const headless = firmwareProject(design('temp-monitor', { display: false, buzzer: false }));
  assert.ok(!headless['src/main.cpp']!.includes('Adafruit_SSD1306'));
  assert.ok(!headless['include/pins.h']!.includes('I2C'));
});

test('malformed settings and invalid GPIO connections fail before generating code', () => {
  const bad = design('focus-timer');
  bad.behavior[0]!.value = '25; arbitrary C++';
  assert.throws(() => firmwareProject(bad), /Invalid firmware behavior/);
  const invalid = design('light-lamp');
  invalid.nets.find(n => n.id === 'LED_DRIVE')!.endpoints.find(e => e.part === 'U1')!.pin = 'GPIO35';
  assert.throws(() => firmwareProject(invalid), /Invalid firmware graph/);
});

test('missing PlatformIO is explicitly not compiled and records a receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-firmware-'));
  try {
    await generateFirmware(variants[0]!, dir);
    const stage = await compileFirmware(dir, { platformioPath: join(dir, 'missing-pio') });
    assert.equal(stage.status, 'skipped');
    const receipt = JSON.parse(await readFile(join(dir, 'firmware-build.json'), 'utf8'));
    assert.equal(receipt.compiled, false);
    assert.equal(receipt.physicalFlash, false);
    assert.match(receipt.note, /not installed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('compiler failure and timeout cannot be reported as successful compilation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-firmware-'));
  try {
    await generateFirmware(variants[0]!, dir);
    const fake = join(dir, 'fake-pio');
    await writeFile(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "PlatformIO test"; exit 0; fi\necho "compiler error"\nexit 1\n', { mode: 0o755 });
    assert.equal((await compileFirmware(dir, { platformioPath: fake })).status, 'failed');
    await writeFile(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "PlatformIO test"; exit 0; fi\nsleep 10\n');
    const result = await compileFirmware(dir, { platformioPath: fake, timeoutMs: 30 });
    assert.equal(result.status, 'failed');
    assert.match(result.note!, /timed out/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('successful compilation records real tool versions and memory usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-firmware-'));
  try {
    await generateFirmware(variants[0]!, dir);
    const fake = join(dir, 'fake-pio');
    await writeFile(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "PlatformIO test"; exit 0; fi\ncat <<\'LOG\'\n - framework-arduinoespressif32 @ 3.20017.241212 \n - toolchain-xtensa-esp32 @ 8.4.0+2021r2-patch5\n|-- Adafruit SSD1306 @ 2.5.13\nRAM:   [=         ] 6.7% (used 22096 bytes from 327680 bytes)\nFlash: [==        ] 23.3% (used 305961 bytes from 1310720 bytes)\nLOG\n', { mode: 0o755 });
    assert.equal((await compileFirmware(dir, { platformioPath: fake })).status, 'done');
    const receipt = JSON.parse(await readFile(join(dir, 'firmware-build.json'), 'utf8'));
    assert.equal(receipt.compiled, true);
    assert.equal(receipt.toolVersions['framework-arduinoespressif32'], '3.20017.241212');
    assert.equal(receipt.toolVersions['Adafruit SSD1306'], '2.5.13');
    assert.equal(receipt.flash.usedBytes, 305961);
    assert.equal(receipt.ram.usedBytes, 22096);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsupported host toolchain produces a skipped receipt with the reason', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-firmware-'));
  try {
    await generateFirmware(variants[0]!, dir);
    const fake = join(dir, 'fake-pio');
    await writeFile(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "PlatformIO test"; exit 0; fi\necho "UnknownPackageError: toolchain is not available for linux_aarch64"\nexit 1\n', { mode: 0o755 });
    const stage = await compileFirmware(dir, { platformioPath: fake });
    assert.equal(stage.status, 'skipped');
    assert.match(stage.note!, /ARM64/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OLED text fits 21 columns', () => {
  for (const graph of variants) {
    const cpp = firmwareProject(graph)['src/main.cpp']!;
    for (const line of cpp.split('\n').filter(line => /\bscreen\(/.test(line) && !line.includes('void screen'))) {
      for (const [, literal] of line.matchAll(/"([^"\n]*)"/g)) assert.ok(literal!.length <= 21, literal);
    }
  }
});

test('compiler environment is filtered, escaped stdout cannot wedge timeout, and .pio is removed', { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-firmware-timeout-'));
  const fake = join(dir, 'fake-pio'), pidFile = join(dir, 'escaped.pid');
  process.env.MOKI_TEST_COMPILER_SECRET = 'not-for-workers';
  try {
    await generateFirmware(variants[0]!, dir);
    await mkdir(join(dir, 'firmware', '.pio'), { recursive: true });
    await writeFile(join(dir, 'firmware', '.pio', 'old-output'), 'remove me');
    await writeFile(fake, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "PlatformIO test"; exit 0; fi\nif [ -n "$MOKI_TEST_COMPILER_SECRET" ]; then echo LEAKED; exit 1; fi\nsetsid sh -c 'echo $$ > "$1"; exec sleep 30' sh '${pidFile}' &\nwait\n`, { mode: 0o755 });
    const start = performance.now();
    const result = await compileFirmware(dir, { platformioPath: fake, timeoutMs: 250 });
    assert.ok(performance.now() - start < 2000);
    assert.equal(result.status, 'failed'); assert.match(result.note!, /timed out/);
    assert.ok(Number(await readFile(pidFile, 'utf8')) > 0);
    assert.doesNotMatch(await readFile(join(dir, 'firmware-build.json'), 'utf8'), /LEAKED/);
    await assert.rejects(readFile(join(dir, 'firmware', '.pio', 'old-output')), /ENOENT/);
    assert.ok(await readFile(join(dir, 'firmware-compile.log')));
  } finally {
    delete process.env.MOKI_TEST_COMPILER_SECRET;
    try { process.kill(-Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});
