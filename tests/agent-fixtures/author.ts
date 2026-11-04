// Writes the replay fixtures: `npx tsx tests/agent-fixtures/author.ts`.
// These were written by hand, with no model involved. They exercise the harness, the validators and the
// pipeline; they say nothing about how well a real model designs. A live run records its own with
// `tsx src/agents/bench.ts --live`, and those are marked provenance "recorded".
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_BRIEFS, interpretBrief } from '../../src/circuit/interpret.js';
import type { CircuitDesign, DesignOptions, TemplateId } from '../../src/circuit/model.js';
import { buildDesign } from '../../src/circuit/templates.js';
import type { ContentBlock, ReplayCall, ReplayFixture } from '../../src/agents/model.js';

const here = dirname(fileURLToPath(import.meta.url));
let serial = 0;
const tool = (name: string, input: unknown = {}): ContentBlock => ({ type: 'tool_use', id: `toolu_${String(++serial).padStart(4, '0')}`, name, input });
const calls = (...blocks: ContentBlock[]): ReplayCall => ({ content: blocks, stopReason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const say = (text: string): ContentBlock => ({ type: 'text', text });

function design(template: TemplateId, options: Partial<DesignOptions>, title: string, roles: Record<string, string> = {}): CircuitDesign {
  const built = buildDesign({ template, chosenBy: 'brief', options: { buzzer: false, display: false, sensor: 'ds18b20', pins: {}, ...options }, recognized: [], notes: [] });
  return { ...built, title, parts: built.parts.map(p => (roles[p.id] ? { ...p, role: roles[p.id]! } : p)) };
}

const designerFlow = (brief: string, d: CircuitDesign, summary: string, modules: string[]): ReplayCall[] => [
  calls(tool('list_catalog')),
  calls(...modules.map(id => tool('get_module', { id }))),
  calls(tool('propose_design', { design: d, summary })),
];

const fixtures: ReplayFixture[] = [];
const add = (id: string, brief: string, list: ReplayCall[], note?: string) => fixtures.push({ id, brief, provenance: 'authored', ...(note ? { note } : {}), calls: list });

for (const example of EXAMPLE_BRIEFS) {
  const read = interpretBrief(example.brief);
  if (!read.ok) throw new Error(`Example brief no longer reads: ${example.brief}`);
  const built = buildDesign(read.interpretation);
  add(`template-${example.template}`, example.brief, designerFlow(example.brief, built, built.title, [...new Set(built.parts.map(p => p.module))]));
}

add('off-plant-moisture', 'plant moisture alarm', [
  calls(tool('list_catalog')),
  calls(tool('decline', { message: 'The catalog has no soil moisture probe, so this can’t read how wet the soil is yet.', closest: 'The closest is a temperature monitor with a BME280, which reads air humidity but can’t alarm on it yet.', closest_brief: 'A temperature monitor with a BME280 and a screen' })),
]);
const freezer = design('temp-monitor', { buzzer: true, alertC: -10, alertDirection: 'above' }, 'Freezer alarm', { U3: 'Probe that sits in the freezer.', BZ1: 'Beeps when the freezer warms up.' });
add('off-freezer-alarm', 'A freezer door alarm that beeps if it warms above -10 degrees', designerFlow('', freezer, 'A freezer alarm: a probe, and a beep above −10 °C.', ['esp32-devkitc-v4', 'ds18b20-to92', 'resistor-axial', 'piezo-passive-12mm']));
const nook = design('light-lamp', { darkPercent: 25 }, 'Reading nook glow', { D1: 'The glow itself, at indicator brightness.' });
add('off-reading-nook', 'A reading nook glow that comes on at dusk', designerFlow('', nook, 'A small glow that comes on when the room falls below 25% brightness.', ['esp32-devkitc-v4', 'ldr-5mm', 'resistor-axial', 'led-5mm-amber']));
const climate = design('temp-monitor', { display: true, sensor: 'bme280' }, 'Desk climate readout');
add('off-desk-climate', 'a desk air climate readout on a tiny screen', designerFlow('', climate, 'A BME280 and a small screen for the desk.', ['esp32-devkitc-v4', 'ssd1306-oled-128x64-i2c', 'bme280-i2c-4pin']));
const nursery = design('temp-monitor', { display: true, buzzer: true, sensor: 'bme280', alertC: 18, alertDirection: 'below' }, 'Nursery cold warning', { BZ1: 'Chirps when the room is too cold.' });
add('off-nursery-cold', 'Nursery too-cold warning that shows the room temperature and chirps under 18 degrees', designerFlow('', nursery, 'A room thermometer with a screen that chirps below 18 °C.', ['esp32-devkitc-v4', 'ssd1306-oled-128x64-i2c', 'bme280-i2c-4pin', 'piezo-passive-12mm']));

// A first attempt that the validators refuse, then a corrected one.
const lampBroken = structuredClone(nook);
lampBroken.parts.push({ id: 'BZ1', module: 'piezo-passive-12mm', role: 'Beeps.' });
add('designer-corrects-itself', 'A dusk lamp that also beeps', [
  calls(tool('list_catalog')),
  calls(tool('propose_design', { design: lampBroken, summary: 'A lamp with a beep.' })),
  calls(say('The lamp firmware can’t drive a piezo, so this is the lamp alone.'), tool('propose_design', { design: nook, summary: 'A dusk lamp, without the beep: its firmware has no sound.' })),
]);

const timer = design('focus-timer', { display: true }, 'Focus timer');
add('edit-add-buzzer', 'add a buzzer', [
  calls(tool('get_module', { id: 'piezo-passive-12mm' })),
  calls(tool('propose_edit', { summary: 'Added a piezo that chimes when a session ends.', ops: [
    { op: 'add_part', id: 'BZ1', module: 'piezo-passive-12mm', role: 'Chimes when a session ends.' },
    { op: 'connect', net: 'BUZZER', kind: 'signal', why: 'GPIO23 toggles a tone on the passive piezo.', endpoints: [{ part: 'U1', pin: 'GPIO23' }, { part: 'BZ1', pin: '+' }] },
    { op: 'connect', net: 'GND', endpoints: [{ part: 'BZ1', pin: '-' }] },
  ] })),
]);
add('edit-usb-left', 'move the USB to the left', [calls(tool('propose_edit', { summary: 'USB moves to the left edge.', edits: { usbEdge: 'left' } }))]);
add('edit-smaller-case', 'make the case smaller', [
  calls(tool('read_job')),
  calls(tool('propose_edit', { summary: 'A smaller board, so the case around it shrinks.', edits: { board: { widthMm: 80, heightMm: 65 } } })),
]);
add('edit-out-of-catalog', 'add a servo', [
  calls(tool('list_catalog')),
  calls(tool('decline', { message: 'The catalog has no servo yet.', closest: 'The closest moving output is the piezo chime.', closest_brief: 'Add a buzzer' })),
]);
add('edit-other-device', 'actually make it a freezer alarm', [calls(tool('start_new', { reason: 'A different device.' })), ...fixtures.find(f => f.id === 'off-freezer-alarm')!.calls]);

add('explain-part', 'what does U2 do', [
  calls(tool('get_design')),
  calls(say('U2 is the small screen. It shows the time left in the session.')),
]);
add('explain-failure', 'why did it fail', [
  calls(tool('read_job')),
  calls(say('The record says: pcb_component_outside_board_error. U1 sits partly outside the board, so routing was skipped.')),
]);
add('explain-overclaims', 'does it work', [
  calls(tool('read_job')),
  calls(say('The firmware compiled and the DRC shows no errors. The board has been printed and flashed and it works.')),
], 'A deliberate overclaim, to prove the guard removes it.');

add('fix-board-too-small', 'make the case smaller', [
  calls(tool('propose_edit', { summary: 'A much smaller board.', edits: { board: { widthMm: 40, heightMm: 40 } } })),
  calls(tool('read_job')),
  calls(tool('propose_fix', { reason: 'The record says pcb_component_outside_board_error: U1 is outside a 40 × 40 mm board. A 75 × 75 mm board holds it.', edits: { board: { widthMm: 75, heightMm: 75 } } })),
], 'The editor shrinks too far; the fixer reads the DRC error and grows the board.');
add('fix-pin', 'x', [
  calls(tool('read_job')),
  calls(tool('propose_fix', { reason: 'The record says the BUZZER route failed around GPIO23. GPIO18 sits on the same header with more room.', ops: [{ op: 'set_pin', net: 'BUZZER', gpio: 18 }] })),
]);
add('fix-never-works', 'x', [
  calls(tool('read_job')),
  calls(tool('propose_fix', { reason: 'Try a bigger board.', edits: { board: { widthMm: 90, heightMm: 90 } } })),
  calls(tool('read_job')),
  calls(tool('propose_fix', { reason: 'Try bigger again.', edits: { board: { widthMm: 110, heightMm: 110 } } })),
  calls(tool('read_job')),
  calls(tool('propose_fix', { reason: 'Would be a third retry and must never run.', edits: { board: { widthMm: 130, heightMm: 130 } } })),
]);
add('fix-overreach', 'x', [
  calls(tool('propose_fix', { reason: 'Remove the buzzer.', ops: [{ op: 'remove_part', id: 'BZ1' }] })),
  calls(tool('give_up', { reason: 'The record shows the renderer crashed, which a layout change can’t fix.' })),
]);

const clash = structuredClone(design('temp-monitor', { display: true }, 'Deliberately failing monitor'));
clash.parts.push({ id: 'R2', module: 'resistor-axial', value: '4.7 kΩ', role: 'A second pull-up, placed by codegen on top of R1. Deliberately failing bench case.' });
clash.nets.find(n => n.id === 'ONEWIRE')!.endpoints.push({ part: 'R2', pin: '1' });
clash.nets.find(n => n.id === '+3V3')!.endpoints.push({ part: 'R2', pin: '2' });
add('fix-overlap', 'A temperature monitor with two pull-ups', [
  calls(tool('propose_design', { design: clash, summary: 'A deliberately failing design: R2 lands on R1.' })),
  calls(tool('read_job')),
  calls(tool('propose_fix', { reason: 'The record shows DRC errors where R1 and R2 overlap. Moving R2 clear of R1 separates their pads.', edits: { placements: [{ refdes: 'R2', x: 24, y: -10, rotation: 0 }] } })),
], 'A deliberately failing design for the bench. The overlap comes from codegen placing both resistors at one spot.');

for (const fixture of fixtures) writeFileSync(resolve(here, `${fixture.id}.json`), `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`Wrote ${fixtures.length} fixtures`);
