// Library blocks for boards that need no code: real JLCPCB parts, values cited from their datasheets. They snap together:
// a light sensor or a two-wire probe drives an LED switch or a buzzer switch, from USB-C power. Fetches the catalog and
// writes src/blocks/data/discrete-{parts,blocks}.json. `npx tsx scripts/generate-discrete-blocks.ts`
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlockDef, BlockDraft, BlockPart, CatalogPart } from '../src/blocks/contract.js';

// Registering parts writes to the store, and these go in the repo instead.
const store = mkdtempSync(join(tmpdir(), 'moki-discrete-'));
process.env.MOKI_BLOCK_LIBRARY_DIR = store;
const { checkBlockDraft, getPart } = await import('../src/blocks/index.js');
const { contentHash } = await import('../src/blocks/library.js');

const LCSC = { ldr: 'C10081', fet: 'C8545', led: 'C5440667', buzzer: 'C96093', diode: 'C81598', terminal: 'C2974924', usb: 'C165948', r5k1: 'C23186', r100k: 'C25803', r1m: 'C22935', r10k: 'C25804', r150: 'C22808', c10u: 'C15850' } as const;
const catalog = new Map<string, CatalogPart>();
for (const lcsc of Object.values(LCSC)) catalog.set(lcsc, await getPart(lcsc));
const of = (lcsc: string) => catalog.get(lcsc)!;
const sheet = (lcsc: string, pages: string, note: string) => ({ url: of(lcsc).datasheetUrl!, pages, note });

const V5 = { min: 4.5, max: 5.5 };
type Pins = BlockPart['pins'];
const passive = (...names: Array<[string, string]>): Pins => Object.fromEntries(names.map(([name, pad]) => [name, { pad, role: 'passive' as const, required: true }]));
const part = (ref: string, lcsc: string, pins: Pins, datasheet: BlockPart['datasheet'], value?: string, valueWhy?: BlockPart['valueWhy']): BlockPart => ({ ref, mpn: of(lcsc).mpn, lcsc, catalogReceipt: of(lcsc).catalogReceipt, pinout: 'verified', pins, datasheet, at: { x: 0, y: 0 }, ...(value ? { value, valueWhy: valueWhy! } : {}) });
const resistor = (ref: string, lcsc: string, value: string, why: BlockPart['valueWhy']) => part(ref, lcsc, passive(['1', '1'], ['2', '2']), sheet(lcsc, '2', 'Thick film chip resistor, 0603.'), value, why);
const fet = (ref: string) => part(ref, LCSC.fet, { G: { pad: '1', role: 'input', required: true }, S: { pad: '2', role: 'ground', required: true }, D: { pad: '3', role: 'passive', required: true } }, sheet(LCSC.fet, '1-2', 'SOT-23: 1 gate, 2 source, 3 drain. 60 V, 115 mA. Threshold from 1 V; the catalog lists 2.5 V as its maximum. At 5 V gate drive, on-resistance is 7 ohm at most at 50 mA.'));
const base = { schema: 'moki.block/1' as const, version: 1, params: [], provenance: { author: 'agent' as const, authorId: 'chip_live' } };
const ports = {
  v5: { id: 'V5', label: '5 V', kind: 'power-in' as const, terminal: 'net:V5', volts: V5 },
  gnd: { id: 'GND', label: 'GND', kind: 'ground' as const, terminal: 'net:GND' },
};

const LIGHT_NOTE = 'GL5528: 8 to 20 kohm at 10 lux, 1 Mohm in the dark. The 10 lux check uses the middle of that range, 14 kohm.';
const dark = sheet(LCSC.ldr, '1', LIGHT_NOTE);
const usbWhy = { url: 'https://community.infineon.com/t5/Knowledge-Base-Articles/USB-Type-C-connector-Rp-Rd-and-Ra-termination-resistors/ta-p/253544', note: 'Manufacturer KBA: a sink has a fixed 5.1 kohm Rd on each CC pin.' };
const USB_PINS: Pins = passive(['A1B12', 'A1B12'], ['B1A12', 'B1A12'], ['A4B9', 'A4B9'], ['B4A9', 'B4A9'], ['CC1', 'A5'], ['CC2', 'B5']);
// Nothing here uses USB data, so those pads stay unconnected on purpose.
const USB_UNUSED: Pins = Object.fromEntries(['A6', 'A7', 'A8', 'B6', 'B7', 'B8'].map(pad => [pad, { pad, role: 'nc' as const }]));
const usbPads = Object.fromEntries(of(LCSC.usb).pins.filter(pin => !USB_PINS[pin.pad] && !['A5', 'B5'].includes(pin.pad) && /^\d+$/.test(pin.pad)).map(pin => [`SHELL${pin.pad}`, { pad: pin.pad, role: 'passive' as const }]));

const drafts: BlockDraft[] = [
  { ...base, id: 'usb-c-power-only', title: 'USB-C power, 5 V', summary: 'USB-C sink for 5 V only: no data lines and no ESD chip, for a board with nothing to talk to. Needs a known 5 V supply; no PD negotiation.', class: 'usb',
    parts: [part('J1', LCSC.usb, { ...USB_PINS, ...USB_UNUSED, ...usbPads }, sheet(LCSC.usb, '1', 'USB-C receptacle pinout.')), resistor('R1', LCSC.r5k1, '5.1k', usbWhy), resistor('R2', LCSC.r5k1, '5.1k', usbWhy), part('C1', LCSC.c10u, passive(['1', '1'], ['2', '2']), sheet(LCSC.c10u, '1', '10 uF, 25 V, X5R, 0805.'), '10uF', { url: of(LCSC.c10u).datasheetUrl!, pages: '1', note: 'Bulk capacitance at the power input. The value is a design choice, not from a datasheet.' })],
    nets: [{ name: 'GND', pins: ['J1.A1B12', 'J1.B1A12', ...Object.keys(usbPads).map(id => `J1.${id}`), 'R1.2', 'R2.2', 'C1.2'] }, { name: 'V5', pins: ['J1.A4B9', 'J1.B4A9', 'C1.1'] }, { name: 'CC1', pins: ['J1.CC1', 'R1.1'] }, { name: 'CC2', pins: ['J1.CC2', 'R2.1'] }],
    ports: [ports.gnd, { id: 'V5', label: '5 V out', kind: 'power-out', terminal: 'net:V5', volts: { min: 4.75, max: 5.25 } }],
    power: { sources: [{ port: 'V5', volts: 5, maxMa: 1500, mode: 'external' }], sinks: [] },
    constraints: [{ kind: 'usb-c-sink', connector: 'J1', cc1: 'CC1', cc2: 'CC2', resistors: ['R1', 'R2'], ohms: 5100, citation: usbWhy }] },
  { ...base, id: 'ldr-dark-detector', title: 'Dark detector', summary: 'Light sensor and resistor. DARK is low in room light and rises as it gets dark, enough to turn on a logic-level transistor. No code needed.', class: 'light_sensor',
    parts: [part('R1', LCSC.ldr, passive(['1', '1'], ['2', '2']), dark), resistor('R2', LCSC.r100k, '100k', { ...sheet(LCSC.fet, '2', 'Sets the switch point: at 10 lux the worst-case 20 kohm sensor gives 0.83 V, under the 1 V minimum threshold. In the dark, 1 Mohm gives 4.5 V, over the threshold.') })],
    nets: [{ name: 'V5', pins: ['R2.1'] }, { name: 'DARK', pins: ['R2.2', 'R1.1'] }, { name: 'GND', pins: ['R1.2'] }],
    ports: [ports.v5, ports.gnd, { id: 'DARK', label: 'High when dark', kind: 'analog', terminal: 'net:DARK' }],
    power: { sources: [], sinks: [{ port: 'V5', typicalMa: 0.05, peakMa: 0.5 }] }, constraints: [],
    spiceChecks: [
      { kind: 'divider', name: 'DARK at 10 lux, under the 1 V threshold', upper: 'R2', lower: 'R1', lowerOhm: 14_000, inputV: 5, target: 0.61, tolerance: 0.1, citation: dark },
      { kind: 'divider', name: 'DARK in the dark, over the threshold', upper: 'R2', lower: 'R1', lowerOhm: 1_000_000, inputV: 5, target: 4.55, tolerance: 0.1, citation: dark },
    ] },
  { ...base, id: 'two-wire-probe', title: 'Two-wire probe', summary: 'Two wires in a screw terminal. OUT goes high when something conducts between them, such as water or a closed circuit. No code needed.', class: 'probe',
    parts: [part('J1', LCSC.terminal, passive(['1', '1'], ['2', '2']), sheet(LCSC.terminal, '1', '2-way 5.08 mm screw terminal.')), resistor('R1', LCSC.r1m, '1M', sheet(LCSC.fet, '2', 'Holds the gate low with the wires apart. Gate leakage is 80 nA at most, so this stays well under the 1 V threshold.')), resistor('R2', LCSC.r10k, '10k', sheet(LCSC.fet, '2', 'Limits current into the gate from static on long wires. The gate takes no DC current, so it adds no error.'))],
    nets: [{ name: 'V5', pins: ['J1.1'] }, { name: 'SENSE', pins: ['J1.2', 'R1.1', 'R2.1'] }, { name: 'OUT', pins: ['R2.2'] }, { name: 'GND', pins: ['R1.2'] }],
    ports: [ports.v5, ports.gnd, { id: 'OUT', label: 'High when the wires conduct', kind: 'analog', terminal: 'net:OUT' }],
    power: { sources: [], sinks: [{ port: 'V5', typicalMa: 0.01, peakMa: 0.5 }] }, constraints: [],
    spiceChecks: [{ kind: 'divider', name: 'OUT with an assumed 200 kohm between the wires, over the threshold', upper: 'J1', upperOhm: 200_000, lower: 'R1', series: 'R2', inputV: 5, target: 4.17, tolerance: 0.1, citation: sheet(LCSC.fet, '2', 'Threshold from 1 V; the catalog lists 2.5 V at most. 200 kohm is an assumption about water between two wires, not a measurement.') }] },
  { ...base, id: 'led-switch', title: 'Warm white LED and switch', summary: 'A warm white LED and its resistor, switched by a transistor from IN. No code needed.', class: 'led',
    parts: [fet('Q1'), resistor('R1', LCSC.r150, '150', sheet(LCSC.led, '3-4', 'Forward voltage 2.7 to 3.3 V at 20 mA, 20 mA at most. 150 ohm keeps it under 20 mA with the lowest forward voltage on a 5.25 V supply.')), part('D1', LCSC.led, { A: { pad: '1', role: 'passive', required: true }, K: { pad: '2', role: 'passive', required: true } }, sheet(LCSC.led, '3-4', 'XL-4008WWC warm white, 20 mA at most, 2.7 to 3.3 V.'))],
    nets: [{ name: 'V5', pins: ['R1.1'] }, { name: 'ANODE', pins: ['R1.2', 'D1.A'] }, { name: 'SW', pins: ['D1.K', 'Q1.D'] }, { name: 'IN', pins: ['Q1.G'] }, { name: 'GND', pins: ['Q1.S'] }],
    ports: [ports.v5, ports.gnd, { id: 'IN', label: 'High turns the LED on', kind: 'analog', terminal: 'net:IN' }],
    power: { sources: [], sinks: [{ port: 'V5', typicalMa: 13, peakMa: 20 }] }, constraints: [],
    spiceChecks: [{ kind: 'led-current', name: 'LED current with the transistor on', resistor: 'R1', supplyV: 5, forwardV: 3, switch: 'Q1', switchDropV: 0.05, target: 13, tolerance: 2, citation: sheet(LCSC.led, '3-4', 'Forward voltage 2.7 to 3.3 V, 20 mA at most. The transistor drop is 0.05 V typical at 50 mA, from the 2N7002 sheet.') }] },
  { ...base, id: 'buzzer-switch', title: 'Buzzer and switch', summary: 'A 5 V buzzer with its own oscillator, switched by a transistor from IN, with a diode across it. It sounds whenever IN is high. No code needed.', class: 'buzzer',
    parts: [fet('Q1'), part('BZ1', LCSC.buzzer, { POS: { pad: '1', role: 'passive', required: true }, NEG: { pad: '2', role: 'passive', required: true } }, sheet(LCSC.buzzer, '2', 'TMB12A05: rated 5 V, 3 to 7 V, 30 mA at most.')), part('D1', LCSC.diode, { A: { pad: '2', role: 'passive', required: true }, K: { pad: '1', role: 'passive', required: true } }, sheet(LCSC.diode, '1', '1N4148W: 75 V, 150 mA. Takes the buzzer coil’s kick when the transistor turns off.'))],
    nets: [{ name: 'V5', pins: ['BZ1.POS', 'D1.K'] }, { name: 'SW', pins: ['BZ1.NEG', 'D1.A', 'Q1.D'] }, { name: 'IN', pins: ['Q1.G'] }, { name: 'GND', pins: ['Q1.S'] }],
    ports: [ports.v5, ports.gnd, { id: 'IN', label: 'High sounds the buzzer', kind: 'analog', terminal: 'net:IN' }],
    power: { sources: [], sinks: [{ port: 'V5', typicalMa: 30, peakMa: 30 }] }, constraints: [] },
];

// Where each part sits inside its block, in mm. The screw terminal and buzzer are through-hole and much the biggest.
const AT: Record<string, Record<string, { x: number; y: number; rotation?: number }>> = {
  // The connector's mouth faces up, with nothing above it. The first block goes on the board's top edge, so a cable can reach it.
  'usb-c-power-only': { J1: { x: 0, y: 4, rotation: 180 }, R1: { x: -5, y: -3, rotation: 90 }, R2: { x: 5, y: -3, rotation: 90 }, C1: { x: 0, y: -3 } },
  'ldr-dark-detector': { R1: { x: 0, y: 0 }, R2: { x: 5.5, y: 0, rotation: 90 } },
  'two-wire-probe': { J1: { x: 0, y: 0 }, R1: { x: 8.5, y: 2 }, R2: { x: 8.5, y: -2 } },
  'led-switch': { D1: { x: 0, y: 4 }, R1: { x: 0, y: 1 }, Q1: { x: 0, y: -3 } },
  'buzzer-switch': { BZ1: { x: 0, y: 0 }, Q1: { x: 10, y: 3 }, D1: { x: 10, y: -3 } },
};
for (const draft of drafts) for (const placed of draft.parts) placed.at = AT[draft.id]![placed.ref]!;

let failed = false;
for (const draft of drafts) {
  const errors = checkBlockDraft(draft).flatMap(g => g.issues.filter(i => i.severity === 'error'));
  for (const issue of errors) { failed = true; console.error(`${draft.id}: ${issue.rule}${issue.where ? ` at ${issue.where}` : ''}: ${issue.message}`); }
}
rmSync(store, { recursive: true, force: true });
if (failed) process.exit(1);
const blocks: BlockDef[] = drafts.map(draft => ({ ...draft, contentHash: contentHash(draft), status: 'unreviewed', provenance: { ...draft.provenance, reviews: [] } }));
writeFileSync('src/blocks/data/discrete-parts.json', `${JSON.stringify([...catalog.values()], null, 1)}\n`);
writeFileSync('src/blocks/data/discrete-blocks.json', `${JSON.stringify(blocks, null, 1)}\n`);
console.log(`${blocks.length} blocks, ${catalog.size} parts`);
