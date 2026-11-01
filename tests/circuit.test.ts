import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, MODULE } from '../src/circuit/catalog.js';
import { exportRevision } from '../src/circuit/export.js';
import { contentId, diffDesigns, fingerprint } from '../src/circuit/graph.js';
import { EXAMPLE_BRIEFS, interpretBrief, MAX_BRIEF_LENGTH } from '../src/circuit/interpret.js';
import { physicalLayout, schematicLayout } from '../src/circuit/layout.js';
import type { CircuitDesign, DesignOptions, Interpretation, TemplateId } from '../src/circuit/model.js';
import { currentRevision, EMPTY_SESSION, submitBrief } from '../src/circuit/session.js';
import { buildDesign } from '../src/circuit/templates.js';
import { checkDesign } from '../src/circuit/validate.js';

function accepted(brief: string, choice?: TemplateId): Interpretation {
  const result = interpretBrief(brief, choice);
  if (!result.ok) assert.fail(`expected "${brief}" to be accepted, got ${result.rejection.reason}: ${result.rejection.message} ${result.rejection.details.join(' ')}`);
  return result.interpretation;
}

function rejected(brief: unknown, choice?: TemplateId) {
  const result = interpretBrief(brief, choice);
  if (result.ok) assert.fail(`expected ${JSON.stringify(brief)} to be rejected, got ${result.interpretation.template}`);
  return result.rejection;
}

function endpointsOf(design: CircuitDesign, netId: string): string[] {
  const net = design.nets.find(n => n.id === netId);
  assert.ok(net, `net ${netId} exists`);
  return net.endpoints.map(e => `${e.part}.${e.pin}`);
}

/** Every option combination each template can produce. */
function allVariants(): Interpretation[] {
  const out: Interpretation[] = [];
  const base = (template: TemplateId, o: Partial<DesignOptions>): Interpretation => ({ template, chosenBy: 'brief', recognized: [], notes: [], options: { buzzer: false, display: template !== 'light-lamp', sensor: 'ds18b20', pins: {}, ...o } });
  for (const buzzer of [false, true]) out.push(base('focus-timer', { buzzer }));
  out.push(base('light-lamp', {}), base('light-lamp', { pins: { led: 26 } }));
  for (const sensor of ['ds18b20', 'bme280'] as const) for (const display of [false, true]) for (const buzzer of [false, true]) out.push(base('temp-monitor', { sensor, display, buzzer }));
  return out;
}

test('the three example briefs each select their own template and build a clean graph', () => {
  for (const example of EXAMPLE_BRIEFS) {
    const interpretation = accepted(example.brief);
    assert.equal(interpretation.template, example.template);
    assert.deepEqual(checkDesign(buildDesign(interpretation)), []);
  }
});

test('ordinary phrasing is understood and parameters change the design', () => {
  const timer = buildDesign(accepted('pomodoro thing with a dial and a little screen that chimes'));
  assert.ok(timer.parts.some(p => p.module === MODULE.piezo), 'chime adds a piezo');
  assert.ok(timer.parts.some(p => p.module === MODULE.encoder), 'dial maps to the encoder');

  const quiet = buildDesign(accepted('a focus timer with a knob and screen'));
  assert.ok(!quiet.parts.some(p => p.module === MODULE.piezo), 'no buzzer unless asked');

  const humid = buildDesign(accepted('room temperature and humidity monitor'));
  assert.ok(humid.parts.some(p => p.module === MODULE.bme280));
  assert.deepEqual(endpointsOf(humid, 'I2C_SDA'), ['U1.GPIO21', 'U2.SDA', 'U3.SDA'], 'OLED and BME280 share the I²C bus');

  const headless = buildDesign(accepted('temperature logger without a screen'));
  assert.ok(!headless.parts.some(p => p.module === MODULE.oled));
  assert.ok(!headless.nets.some(n => n.id.startsWith('I2C')), 'no dangling I²C nets when nothing uses them');

  const lamp = accepted('night light that switches on below 20 percent, LED on GPIO26');
  assert.equal(lamp.options.darkPercent, 20);
  assert.deepEqual(endpointsOf(buildDesign(lamp), 'LED_DRIVE'), ['R2.1', 'U1.GPIO26']);

  assert.equal(accepted('thermometer that alerts above 86 F').options.alertC, 30);
  assert.equal(accepted('a 50 minute focus timer with a screen').options.focusMinutes, 50);
});

test('unsupported parts and voltages are rejected with the reason, never dropped', () => {
  for (const brief of ['a lamp that runs from the wall socket', 'temperature monitor that switches a 12V fan', 'focus timer with an e-ink display', 'night light with a neopixel ring', 'battery powered temperature monitor', 'focus timer on an Arduino Uno', 'a lamp with a servo that points it']) {
    const r = rejected(brief);
    assert.equal(r.reason, 'unsupported', brief);
    assert.ok(r.details.length > 0, `${brief} explains why`);
  }
  const outOfTemplate = rejected('a night lamp with a screen and a knob');
  assert.equal(outOfTemplate.reason, 'unsupported');
  assert.equal(outOfTemplate.details.length, 2, 'both screen and knob are named');
});

test('ambiguous and unrecognized briefs are not mapped to a random template', () => {
  const both = rejected('a focus timer that also shows the room temperature');
  assert.equal(both.reason, 'ambiguous');
  assert.deepEqual(both.candidates, ['focus-timer', 'temp-monitor']);
  const chosen = accepted('a focus timer that also shows the room temperature', 'temp-monitor');
  assert.equal(chosen.template, 'temp-monitor');
  assert.equal(chosen.chosenBy, 'user');
  assert.match(chosen.notes.join(' '), /focus timer were not used/);

  assert.equal(rejected('a friendly robot companion').reason, 'unrecognized');
  assert.equal(rejected('   ').reason, 'empty');
  assert.equal(rejected('timer '.repeat(MAX_BRIEF_LENGTH)).reason, 'too-long');
  assert.equal(rejected(42).reason, 'invalid-input');
  assert.equal(rejected('focus timer', 'toaster' as TemplateId).reason, 'invalid-input');
});

test('pin requests are checked against what the ESP32 pin can do', () => {
  const cases: Array<[string, RegExp]> = [
    ['lamp with the LED on GPIO34', /input-only/],
    ['lamp with the LED on GPIO6', /flash/],
    ['lamp with the LED on GPIO2', /strapping/],
    ['temperature monitor with a screen, probe on GPIO21', /I²C SDA/],
    ['night lamp, LED on GPIO27 and LED on GPIO26', /two pins/],
    ['focus timer with a screen using pin 26', /not which part/],
    ['temperature and humidity monitor, data on GPIO13', /doesn’t have/],
    ['lamp with the LED on GPIO44', /isn’t a pin/],
  ];
  for (const [brief, pattern] of cases) {
    const r = rejected(brief);
    assert.equal(r.reason, 'invalid-parameter', brief);
    assert.match(`${r.message} ${r.details.join(' ')}`, pattern, brief);
  }
  for (const brief of ['lamp below 150%', 'temperature probe alert above 200 C', 'focus timer with a screen for 25 minutes or 50 minutes']) assert.equal(rejected(brief).reason, 'invalid-parameter', brief);
});

test('every reachable design is a connected graph with no dangling references', () => {
  for (const variant of allVariants()) {
    const design = buildDesign(variant);
    const label = JSON.stringify(variant.options);
    assert.deepEqual(checkDesign(design), [], label);
    assert.equal(new Set(design.parts.map(p => p.id)).size, design.parts.length, `unique part IDs ${label}`);
    const seen = new Set<string>();
    for (const net of design.nets) {
      assert.ok(net.why.length > 40, `${net.id} explains itself`);
      for (const end of net.endpoints) {
        const part = design.parts.find(p => p.id === end.part);
        assert.ok(part, `${net.id} → ${end.part} exists`);
        assert.ok(CATALOG.get(part.module)!.pins.some(p => p.id === end.pin), `${end.part}.${end.pin} exists on ${part.module}`);
        const key = `${end.part}.${end.pin}`;
        assert.ok(!seen.has(key), `${key} is on one net only`);
        seen.add(key);
      }
    }
    // Every part touches the graph: nothing floats.
    for (const part of design.parts) assert.ok(design.nets.some(n => n.endpoints.some(e => e.part === part.id)), `${part.id} is connected`);
  }
});

test('both views are drawn from the same topology', () => {
  for (const variant of allVariants()) {
    const design = buildDesign(variant);
    const schematic = schematicLayout(design);
    const physical = physicalLayout(design);
    const netIds = new Set(design.nets.map(n => n.id));
    for (const net of design.nets) {
      for (const end of net.endpoints) {
        const sPin = schematic.parts.find(p => p.id === end.part)?.pins.find(p => p.pin === end.pin);
        const pPin = physical.parts.find(p => p.id === end.part)?.pins.find(p => p.pin === end.pin);
        assert.equal(sPin?.net, net.id, `schematic ${end.part}.${end.pin}`);
        assert.equal(pPin?.net, net.id, `wiring ${end.part}.${end.pin}`);
      }
      // Each physical endpoint is reached by a wire of that net.
      const pins = net.endpoints.map(e => physical.parts.find(p => p.id === e.part)!.pins.find(p => p.pin === e.pin)!.at);
      for (const at of pins) assert.ok(physical.wires.some(w => w.net === net.id && (same(w.from, at) || same(w.to, at))), `wire reaches ${net.id} at ${at.x},${at.y}`);
    }
    for (const w of [...schematic.wires, ...physical.wires]) assert.ok(netIds.has(w.net), `wire on known net ${w.net}`);
    for (const f of schematic.flags) assert.ok(netIds.has(f.net));
    // Power flags point away from their parts; ground never sits on top of a two-pin symbol.
    for (const f of schematic.flags) if (f.kind === 'ground') assert.equal(f.dir, 'down');
    // Signal nets in the schematic are drawn as wires unless all endpoints coincide.
    for (const net of design.nets.filter(n => n.kind === 'signal')) {
      const ends = net.endpoints.map(e => schematic.parts.find(p => p.id === e.part)!.pins.find(p => p.pin === e.pin)!.end);
      const coincide = ends.every(e => same(e, ends[0]!));
      assert.ok(coincide || schematic.wires.some(w => w.net === net.id), `${net.id} has schematic wiring`);
    }
  }
});

function same(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

test('F1: everyday negations remove optional parts and cannot remove fixed ones', () => {
  const parts = (brief: string) => buildDesign(accepted(brief)).parts.map(p => p.id);
  assert.ok(!parts('A temperature monitor with a screen but no buzzer').includes('BZ1'));
  assert.ok(!parts('A silent focus timer with no sound').includes('BZ1'));
  assert.ok(!parts("A temperature monitor that doesn't need a screen").includes('U2'));
  assert.ok(!parts('A temperature monitor that doesn’t need a screen').includes('U2'));
  assert.ok(!parts('A focus timer with a screen and no buzzer').includes('BZ1'));
  assert.ok(parts('a lamp with no motor').includes('D1'), 'ruling out an unsupported part is fine');
  for (const brief of ['A focus timer without a knob', 'A focus timer with no screen', 'A lamp with no LED', 'A temperature monitor with a buzzer and no buzzer']) {
    assert.equal(rejected(brief).reason, 'unsupported', brief);
  }
});

test('F2: unsupported hardware, quantities and stray settings are named, never dropped', () => {
  const cases: Array<[string, RegExp]> = [
    ['A temperature monitor that logs to an SD card', /sd card/],
    ['A temperature monitor with a soil moisture sensor and a PIR motion sensor', /soil moisture sensor/],
    ['A focus timer with a light that flashes when done', /“light”/],
    ['A focus timer with a potentiometer instead of a knob', /potentiometer/],
    ['An ESP32 S3 focus timer', /esp32 s3/],
    ['An ESP32-C3 temperature monitor', /esp32-c3/],
    ['A lamp with 3 LEDs', /at most one LED/],
    ['A focus timer with two buttons', /at most one button/],
    ['A focus timer with buttons', /at most one/],
    ['focus timer with 50% brightness', /50%/],
    ['lamp that is 5 cm tall', /5 cm/],
    ['A night lamp that runs for 2 hours', /2 hours/],
  ];
  for (const [brief, pattern] of cases) {
    const r = rejected(brief);
    assert.equal(r.reason, 'unsupported', brief);
    assert.match(r.details.join(' '), pattern, brief);
  }
  assert.match(rejected('A focus timer that runs for 30 seconds').message, /minutes/);
  // Harmless description is accepted and listed as not used.
  const cosy = accepted('A cosy little lamp for my bedside table');
  assert.match(cosy.notes.join(' '), /Not used: “cosy”, “bedside”, “table”/);
});

test('F2: hour units, bare degrees and bare pin labels are read, and say how', () => {
  assert.equal(accepted('A 1 hour focus timer').options.focusMinutes, 60);
  assert.equal(accepted('A half an hour focus timer').options.focusMinutes, 30);
  assert.equal(accepted('A 1.5 hour focus timer').options.focusMinutes, 90);
  const degrees = accepted('A temperature monitor that alerts above 28 degrees');
  assert.equal(degrees.options.alertC, 28);
  assert.ok(degrees.recognized.some(r => /read as Celsius/.test(r.meaning)));
  const bare = accepted('A lamp with the LED on 26');
  assert.equal(bare.options.pins.led, 26);
  assert.ok(bare.recognized.some(r => /GPIO26/.test(r.meaning) && /board/.test(r.meaning)));
  assert.equal(accepted('temperature monitor with a screen, data on gpio13').options.pins.probe, 13);
});

test('F3: mains and high-voltage spellings are rejected', () => {
  for (const brief of ['A lamp powered from 230VAC', 'A temperature monitor with a 12-volt adapter', 'A temperature monitor with a 1000V probe', 'A lamp on 24VDC', 'A lamp on 12 VDC', 'A lamp on 9 volts', 'A lamp plugged into a wall socket']) {
    assert.equal(rejected(brief).reason, 'unsupported', brief);
  }
  accepted('A focus timer powered by 5V USB');
  accepted('A lamp running at 3.3V');
});

test('F4: threshold direction is honoured or rejected, never inverted', () => {
  const low = accepted('A temperature monitor that alerts when it falls below 5 °C');
  assert.equal(low.options.alertDirection, 'below');
  assert.ok(buildDesign(low).behavior.some(b => b.label === 'Alert below' && b.value.startsWith('5 °C')));
  assert.equal(accepted('A temperature monitor that alerts above 28 °C').options.alertDirection, 'above');
  const bright = rejected('A lamp that turns on when the room is brighter than 70%');
  assert.equal(bright.reason, 'invalid-parameter');
  assert.match(bright.message, /darker/);
  assert.equal(accepted('A lamp that turns on below 20 percent').options.darkPercent, 20);
});

test('R1: ranges, alternatives, negated thresholds and stray numbers are rejected, not half-read', () => {
  const cases: Array<[string, RegExp]> = [
    ['A temperature monitor that alerts between 18 and 24 C', /“between 18 and 24 c” gives a range/],
    ['A temperature monitor that alerts from 18 to 24 degrees', /“from 18 to 24 degrees” gives a range/],
    ['A temperature monitor that alerts at 18-24C', /“18-24c” gives a range/],
    ['A focus timer that runs 25 or 50 minutes', /“25 or 50 minutes” gives a range/],
    ['A temperature monitor that alerts when it is not above 30 C', /“not above 30 c” is a negated threshold/],
    ['A lamp that does not turn on below 30%', /negated threshold/],
  ];
  for (const [brief, pattern] of cases) {
    const r = rejected(brief);
    assert.equal(r.reason, 'invalid-parameter', brief);
    assert.match(r.message, pattern, brief);
  }
  const stray = rejected('A cosy lamp for my 2 kids');
  assert.equal(stray.reason, 'unsupported');
  assert.match(stray.details.join(' '), /“2” isn’t used/);
  // Model numbers, pin numbers and the supported OLED size are names, not stray values.
  accepted('A focus timer with a KY-040 knob and an SSD1306 screen on an ESP32 DevKitC V4');
  accepted('A focus timer with a 0.96 inch OLED');
  assert.equal(accepted('temperature monitor, probe on GPIO 13 and 30 C alarm').options.alertC, 30);
  assert.equal(accepted('A lamp with the LED on 26').options.pins.led, 26);
});

test('final-review gaps: lone PIR, outlet power and decimal sizes are quoted correctly', () => {
  assert.match(rejected('A lamp with a PIR').details.join(' '), /“pir”/);
  assert.match(rejected('A lamp from the outlet').details.join(' '), /Mains power/);
  const size = rejected('A focus timer with a 2.4 inch screen');
  assert.match(size.details.join(' '), /“2\.4 inch”/);
  assert.doesNotMatch(size.details.join(' '), /“4 inch/);
});

test('the integrity check catches broken graphs', () => {
  const good = buildDesign(accepted(EXAMPLE_BRIEFS[1]!.brief));
  const codes = (d: unknown) => checkDesign(d).map(i => i.code);
  assert.ok(codes({ ...good, parts: [...good.parts, { ...good.parts[1]! }] }).includes('duplicate-part'));
  assert.ok(codes({ ...good, nets: good.nets.map(n => n.id === 'LED_A' ? { ...n, endpoints: [...n.endpoints, { part: 'Q9', pin: '1' }] } : n) }).includes('dangling-part'));
  assert.ok(codes({ ...good, nets: good.nets.map(n => n.id === 'LED_A' ? { ...n, endpoints: [{ part: 'D1', pin: 'X' }, { part: 'R2', pin: '2' }] } : n) }).includes('dangling-pin'));
  assert.ok(codes({ ...good, nets: good.nets.map(n => n.id === 'LED_DRIVE' ? { ...n, endpoints: [{ part: 'U1', pin: 'GPIO35' }, { part: 'R2', pin: '1' }] } : n) }).includes('gpio-capability'), 'input-only pin cannot drive an LED');
  assert.ok(codes({ ...good, nets: good.nets.filter(n => n.id !== 'LED_A') }).includes('required-unconnected'));
  // F6(B): a rail relabelled 5 V while its only source is the 3.3 V regulator.
  assert.ok(codes({ ...good, nets: good.nets.map(n => n.kind === 'power' ? { ...n, volts: 5 } : n) }).includes('source-volts'));
  const temp = buildDesign(accepted(EXAMPLE_BRIEFS[2]!.brief));
  assert.ok(codes({ ...temp, nets: temp.nets.map(n => n.kind === 'power' ? { ...n, volts: 12 } : n) }).includes('supply-range'));
  assert.ok(codes({ schema: 'nope', parts: 'x' }).includes('shape'));
});

test('the validator rejects connections the review found it accepted', () => {
  const timer = buildDesign(accepted(EXAMPLE_BRIEFS[0]!.brief));
  const codes = (d: CircuitDesign) => checkDesign(d).map(i => i.code);
  const withNets = (map: (n: CircuitDesign['nets'][number]) => CircuitDesign['nets'][number] | null): CircuitDesign =>
    ({ ...timer, nets: timer.nets.map(map).filter((n): n is CircuitDesign['nets'][number] => n !== null) });
  // (A) SCL is driven by the ESP32: an input-only pin cannot be the clock.
  assert.ok(codes(withNets(n => n.id === 'I2C_SCL' ? { ...n, endpoints: [{ part: 'U1', pin: 'GPIO34' }, { part: 'U2', pin: 'SCL' }] } : n)).includes('gpio-capability'));
  // (C) A GPIO tied to the supply rail.
  assert.ok(codes(withNets(n => n.kind === 'power' ? { ...n, endpoints: [...n.endpoints, { part: 'U1', pin: 'GPIO25' }] } : n)).includes('signal-on-rail'));
  // (D2) A peripheral signal pin moved onto the rail, its own net removed.
  assert.ok(codes(withNets(n => n.id === 'I2C_SDA' ? null : n.kind === 'power' ? { ...n, endpoints: [...n.endpoints, { part: 'U2', pin: 'SDA' }] } : n)).includes('signal-on-rail'));
  // (E) The encoder switch relies on an internal pull-up; GPIO35 has none.
  assert.ok(codes(withNets(n => n.id === 'ENC_SW' ? { ...n, endpoints: [{ part: 'U1', pin: 'GPIO35' }, { part: 'SW1', pin: 'SW' }] } : n)).includes('pullup'));
  // F7: duplicate net names and loosely typed fields.
  assert.ok(codes(withNets(n => n.id === 'ENC_B' ? { ...n, name: 'ENC_A' } : n)).includes('duplicate-net-name'));
  assert.ok(codes({ ...timer, nets: timer.nets.map(n => n.kind === 'power' ? { ...n, volts: '3.3' as unknown as number } : n) }).includes('shape'));
  assert.ok(codes({ ...timer, parts: timer.parts.map(p => p.id === 'U2' ? { ...p, value: {} as unknown as string } : p) }).includes('shape'));
  assert.ok(codes({ ...timer, template: 'toaster' as TemplateId }).includes('shape'));
  assert.deepEqual(codes(timer), []);
});

test('topology is deterministic and fingerprints only change with the wiring', () => {
  const brief = EXAMPLE_BRIEFS[0]!.brief;
  assert.equal(fingerprint(buildDesign(accepted(brief))), fingerprint(buildDesign(accepted(brief))));
  const reordered = buildDesign(accepted(brief));
  reordered.parts.reverse(); reordered.nets.reverse();
  assert.equal(fingerprint(reordered), fingerprint(buildDesign(accepted(brief))));
  assert.notEqual(fingerprint(buildDesign(accepted('focus timer with a screen'))), fingerprint(buildDesign(accepted(brief))));
  // Settings change the content id but not the wiring fingerprint.
  const a = buildDesign(accepted('a 25 minute focus timer with a screen'));
  const b = buildDesign(accepted('a 45 minute focus timer with a screen'));
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(contentId(a), contentId(b));
});

test('revisions: settings edits, wiring diffs and rejections each report what actually changed', () => {
  let session = EMPTY_SESSION;
  let step = submitBrief(session, 'focus timer with a knob and a screen');
  assert.equal(step.outcome.kind, 'created');
  session = step.session;
  assert.equal(currentRevision(session)?.number, 1);

  step = submitBrief(session, 'a focus timer with a screen and the knob');
  assert.equal(step.outcome.kind, 'unchanged', 'rewording alone keeps the revision');
  session = step.session;
  assert.equal(currentRevision(session)?.brief, 'a focus timer with a screen and the knob');

  step = submitBrief(session, 'focus timer with a knob, a screen and a buzzer on GPIO18');
  assert.equal(step.outcome.kind, 'created');
  session = step.session;
  const rev2 = currentRevision(session)!;
  assert.equal(rev2.number, 2);
  assert.ok(rev2.changes.some(c => c.kind === 'part-added' && c.subject === 'BZ1'));
  assert.ok(rev2.changes.some(c => c.kind === 'net-added' && c.subject === 'BUZZER'));

  // F5: a settings-only edit is its own revision with only that change, and its own content id.
  step = submitBrief(session, 'a 45 minute focus timer with a knob, a screen and a buzzer on GPIO18');
  assert.equal(step.outcome.kind, 'created');
  session = step.session;
  const rev3 = currentRevision(session)!;
  assert.equal(rev3.fingerprint, rev2.fingerprint, 'same wiring');
  assert.notEqual(rev3.contentId, rev2.contentId);
  assert.deepEqual(rev3.changes.map(c => c.text), ['Session length: 25 min (default) → 45 min']);
  const exported = [exportRevision(rev2), exportRevision(rev3)];
  assert.notEqual(exported[0]!.contentId, exported[1]!.contentId, 'exports are distinguishable');
  assert.equal(exported[0]!.fingerprint, exported[1]!.fingerprint);

  step = submitBrief(session, 'a 45 minute focus timer with a knob, a screen and a buzzer on GPIO19');
  session = step.session;
  assert.deepEqual(currentRevision(session)!.changes.map(c => c.text), ['BUZZER moved from U1.GPIO18 to U1.GPIO19']);

  step = submitBrief(session, 'focus timer with a speaker');
  assert.equal(step.outcome.kind, 'rejected');
  assert.equal(step.session.revisions.length, 4, 'rejection does not add or remove revisions');
  assert.equal(currentRevision(step.session)?.number, 4, 'last good drawing stays current');
  assert.equal(step.session.rejected?.brief, 'focus timer with a speaker');

  step = submitBrief(step.session, 'a lamp for my desk');
  assert.equal(step.outcome.kind, 'created');
  assert.equal(step.session.rejected, null, 'an accepted brief clears the rejection');
  assert.deepEqual(currentRevision(step.session)!.changes.map(c => c.kind), ['template-changed']);
});

test('wiring sentences come from compareDesigns and include rail and property changes', () => {
  const probe = buildDesign(accepted('temperature monitor with a probe and a screen'));
  const bme = buildDesign(accepted('temperature and humidity monitor with a screen'));
  const swap = diffDesigns(probe, bme).map(c => c.text);
  assert.ok(swap.some(t => /^U3 is now BME280.*replacing DS18B20.*reconnect to .*\+3V3.*GND.*I2C_SCL.*I2C_SDA/.test(t)), swap.join('\n'));
  assert.ok(swap.includes('Removed R1, Resistor, ¼ W through-hole 4.7 kΩ'));
  assert.ok(swap.includes('Removed connection ONEWIRE'));
  const lamp = buildDesign(accepted(EXAMPLE_BRIEFS[1]!.brief));
  const relabelled: CircuitDesign = { ...lamp, nets: lamp.nets.map(n => n.kind === 'power' ? { ...n, volts: 5 } : n.id === 'LIGHT_SENSE' ? { ...n, analog: false } : n) };
  const props = diffDesigns(lamp, relabelled).map(c => c.text);
  assert.deepEqual(props.sort(), ['+3V3: power, 3.3 V → power, 5 V', 'LIGHT_SENSE: signal, read as analog → signal'].sort());
});

test('an internal template fault is reported as a product fault, not a problem with the brief', () => {
  const first = submitBrief(EMPTY_SESSION, EXAMPLE_BRIEFS[1]!.brief).session;
  const broken = (i: Interpretation) => { const d = buildDesign(i); return { ...d, nets: d.nets.filter(n => n.id !== 'LED_A') }; };
  const step = submitBrief(first, EXAMPLE_BRIEFS[1]!.brief.replace('30%', '20%'), undefined, broken);
  assert.equal(step.outcome.kind, 'internal-error');
  assert.equal(step.session.rejected?.rejection.reason, 'internal');
  assert.match(step.session.rejected!.rejection.message, /not in your brief/);
  assert.equal(step.session.revisions.length, 1, 'the last good drawing stays');
});

test('the export is labelled as a preview and carries a consistent netlist', () => {
  const step = submitBrief(EMPTY_SESSION, EXAMPLE_BRIEFS[2]!.brief);
  assert.equal(step.outcome.kind, 'created');
  const revision = currentRevision(step.session)!;
  const artifact = exportRevision(revision, new Date('2026-11-01T00:00:00Z'));
  assert.match(artifact.disclaimer, /Not a simulation/);
  assert.match(artifact.disclaimer, /ERC/);
  assert.deepEqual(artifact.graphStructureChecks.issues, []);
  assert.equal(artifact.fingerprint, revision.fingerprint);
  assert.equal(artifact.contentId, revision.contentId);
  assert.deepEqual(artifact.netlist.ONEWIRE, { name: 'ONEWIRE', pins: ['R1.2', 'U1.GPIO4', 'U3.DQ'] });
  assert.equal(Object.keys(artifact.netlist).length, revision.design.nets.length, 'one netlist entry per net');
  assert.deepEqual(JSON.parse(JSON.stringify(artifact)), artifact, 'serialisable');
  assert.equal(diffDesigns(revision.design, revision.design).length, 0);
});
