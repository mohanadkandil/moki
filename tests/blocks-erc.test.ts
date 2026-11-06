import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkBlockDraft, checkPlan, pinMap } from '../src/blocks/erc.js';
import type { BlockDef, BlockDraft, BlockPart, BoardPlan, CatalogPart, GateResult } from '../src/blocks/contract.js';

// SYNTHETIC fixtures exercise the generic checker. These are not real supplier IDs or validated physical devices.
const hash = (s: string) => createHash('sha256').update(`SYNTHETIC:${s}`).digest('hex');
const cite = { url: 'https://example.invalid/SYNTHETIC-datasheet.pdf', pages: '1' };
const role = (pad: string, kind: BlockPart['pins'][string]['role']) => ({ pad, role: kind });
function part(ref: string, pins: BlockPart['pins'], value?: string, x = 0, y = 0): BlockPart { return { ref, pins, mpn: `SYNTHETIC:${ref}`, lcsc: `SYNTHETIC:${ref}`, catalogReceipt: `sha256:${hash(ref)}`, datasheet: cite, pinout: 'verified', at: { x, y }, ...(value ? { value, valueWhy: cite } : {}) }; }
const passive = (ref: string, val: string, x = 1, y = 0) => part(ref, { A: role('1', 'passive'), B: role('2', 'passive') }, val, x, y);
function blank(id: string): BlockDef { return { schema: 'moki.block/1', id, version: 1, contentHash: hash(id), title: `SYNTHETIC ${id}`, summary: 'Test fixture only', class: 'synthetic', status: 'unreviewed', provenance: { author: 'agent', authorId: 'SYNTHETIC-AUTHOR', reviews: [] }, parts: [], nets: [], ports: [], params: [], power: { sources: [], sinks: [] }, constraints: [] }; }
function draft(b: BlockDef): BlockDraft { const { contentHash, status, provenance, ...rest } = structuredClone(b); return { ...rest, provenance: { author: provenance.author, authorId: provenance.authorId } }; }
function cat(b: BlockDef): Map<string, CatalogPart> { return new Map(b.parts.map(p => [p.lcsc, { lcsc: p.lcsc, mpn: p.mpn, catalogReceipt: p.catalogReceipt, importer: 'SYNTHETIC test importer', rawSha256: hash(p.ref), footprintSha256: hash(p.ref + 'footprint'), pins: Object.entries(p.pins).map(([id, pin]) => ({ pad: pin.pad, labels: [id] })), models: [] }])); }
function supply(): BlockDef { const b = blank('source'); b.parts = [part('J1', { P: role('1', 'passive'), G: role('2', 'ground') })]; b.nets = [{ name: 'P', pins: ['J1.P'] }, { name: 'G', pins: ['J1.G'] }]; b.ports = [{ id: 'OUT', label: '5V', kind: 'power-out', terminal: 'net:P', volts: { min: 5, max: 5 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }]; b.power.sources = [{ port: 'OUT', volts: 5, maxMa: 1000, mode: 'external' }]; return b; }
function regulator(): BlockDef { const b = blank('reg'); b.parts = [part('U1', { IN: role('1', 'power-in'), GND: role('2', 'ground'), OUT: role('3', 'power-out'), NC: role('4', 'nc') }), passive('C1', '1uF'), passive('C2', '1uF', -1)]; b.nets = [{ name: 'IN', pins: ['U1.IN', 'C1.A'] }, { name: 'OUT', pins: ['U1.OUT', 'C2.A'] }, { name: 'G', pins: ['U1.GND', 'C1.B', 'C2.B'] }]; b.ports = [{ id: 'IN', label: 'Input', kind: 'power-in', terminal: 'net:IN', volts: { min: 4.5, max: 5.25 } }, { id: 'OUT', label: 'Output', kind: 'power-out', terminal: 'net:OUT', volts: { min: 3.3, max: 3.3 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }]; b.power.sources = [{ port: 'OUT', volts: 3.3, maxMa: 600, continuousMa: 250, inputPort: 'IN', mode: 'regulated', conversion: 'linear', dropoutV: .4, thermal: { thetaJa: 184, maxJunctionC: 125, ambientC: 25 } }]; b.constraints = ['IN', 'OUT'].map((pin, i) => ({ kind: 'decoupling', ic: 'U1', powerPin: pin, groundPin: 'GND', caps: [`C${i + 1}`], minUf: 1, maxDistanceMm: 2, citation: cite })); return b; }
function logic(id: 'mcu' | 'sensor'): BlockDef { const b = blank(id); const controller = id === 'mcu'; b.parts = [part('U1', { VDD: role('1', 'power-in'), GND: role('2', 'ground'), SDA: role('3', 'open-drain'), SCL: role('4', 'open-drain') }), passive('C1', '1uF')]; b.nets = [{ name: 'VCC', pins: ['U1.VDD', 'C1.A'] }, { name: 'G', pins: ['U1.GND', 'C1.B'] }, { name: 'SDA', pins: ['U1.SDA'] }, { name: 'SCL', pins: ['U1.SCL'] }]; b.ports = [{ id: 'VCC', label: 'Power', kind: 'power-in', terminal: 'net:VCC', volts: { min: 3, max: 3.6 } }, { id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:G' }, { id: 'I2C', label: 'I2C', kind: 'bus', bus: { protocol: 'i2c', role: controller ? 'controller' : 'peripheral', signals: { SDA: 'U1.SDA', SCL: 'U1.SCL' }, ...(controller ? {} : { i2cAddresses: [0x40] }) } }]; b.power.sinks = [{ port: 'VCC', typicalMa: controller ? 200 : 25, peakMa: controller ? 500 : 50 }]; b.constraints = [{ kind: 'decoupling', ic: 'U1', powerPin: 'VDD', groundPin: 'GND', caps: ['C1'], minUf: 1, maxDistanceMm: 2, citation: cite }];
  if (controller) { b.mcu = { family: 'SYNTHETIC-STM32', pio: { platform: 'ststm32', board: 'SYNTHETIC_TEST_BOARD', framework: 'arduino' }, pins: [{ id: 'U1.SDA', gpio: 'PA0', caps: ['input', 'output', 'i2c'] }, { id: 'U1.SCL', gpio: 'PA1', caps: ['input', 'output', 'i2c'] }], flashKb: 64, ramKb: 20 }; for (const [i, signal] of ['SDA', 'SCL'].entries()) { const ref = `R${i + 1}`; b.parts.push(passive(ref, '4.7k')); b.nets.find(n => n.name === signal)!.pins.push(`${ref}.A`); b.nets[0]!.pins.push(`${ref}.B`); b.constraints.push({ kind: 'pullup', pin: `U1.${signal}`, to: 'net:VCC', resistor: ref, ohms: 4700, citation: cite }); } }
  b.firmware = { libs: ['SYNTHETIC/Test'], includes: ['SyntheticDriver.h'], usage: `SYNTHETIC ${id} pin map example` }; return b;
}
function setup() { const blocks = [supply(), regulator(), logic('mcu'), logic('sensor')]; const plan: BoardPlan = { schema: 'moki.plan/1', title: 'Synthetic complete plan', layers: 2, blocks: blocks.map(b => ({ inst: b.id, block: b.id, version: b.version, params: {} })), links: [{ from: 'source.OUT', to: 'reg.IN' }, { from: 'reg.OUT', to: 'mcu.VCC' }, { from: 'reg.OUT', to: 'sensor.VCC' }, ...['reg', 'mcu', 'sensor'].map(id => ({ from: 'source.GND', to: `${id}.GND` })), { from: 'mcu.I2C', to: 'sensor.I2C' }] }; return { blocks, plan }; }
const errors = (g: GateResult[]) => g.flatMap(g => g.issues.filter(i => i.severity === 'error'));
const rules = (g: GateResult[]) => errors(g).map(i => i.rule);
function passes(g: GateResult[]) { assert.deepEqual(errors(g), []); for (const a of g) assert.equal(a.ok, !a.issues.some(i => i.severity === 'error')); }
function fails(g: GateResult[], rule?: string) { assert.ok(errors(g).length, JSON.stringify(g)); if (rule) assert.ok(rules(g).includes(rule), JSON.stringify(g)); for (const a of g) assert.equal(a.ok, !a.issues.some(i => i.severity === 'error')); }

test('synthetic complete draft and plan pass without promoting review or claiming hardware proof', () => { const { blocks, plan } = setup(); const original = structuredClone({ blocks, plan }); for (const b of blocks) passes(checkBlockDraft(draft(b), cat(b))); const g = checkPlan(plan, blocks); passes(g); assert.ok(g.flatMap(g => g.issues).some(i => i.rule === 'transient-unverified')); assert.deepEqual({ blocks, plan }, original); });
test('malformed/unknown/nonfinite schema and author-supplied promotion fail closed', () => { const b = draft(regulator()); for (const mutate of [(b: any) => { b.extra = 1; }, (b: any) => { b.status = 'reviewed'; }, (b: any) => { b.parts[0].at.x = Infinity; }, (b: any) => { b.power.sources[0].maxMa = NaN; }, (b: any) => { b.constraints.push({ kind: 'magic', citation: cite }); }, (b: any) => { b.constraints[0].caps = null; }]) { const d = structuredClone(b); mutate(d); fails(checkBlockDraft(d)); } for (const v of [null, [], {}, { ...b, constructor: 1 }]) fails(checkBlockDraft(v as any)); });
test('catalog identity, physical pad coverage and verified pinouts are hard gates', () => { for (const mutate of [(b: BlockDraft) => { b.parts[0]!.pinout = 'unverified'; }, (b: BlockDraft) => { b.parts[0]!.mpn = 'Wrong'; }, (b: BlockDraft) => { b.parts[0]!.pins.IN!.pad = '99'; }, (b: BlockDraft) => { delete b.parts[0]!.pins.NC; }]) { const b = regulator(); const d = draft(b); mutate(d); fails(checkBlockDraft(d, cat(b))); } });
test('duplicate references/nets, unknown pins, NC wiring and incomplete supplies fail', () => { for (const mutate of [(b: BlockDraft) => { b.parts.push(structuredClone(b.parts[0]!)); }, (b: BlockDraft) => { b.nets.push(structuredClone(b.nets[0]!)); }, (b: BlockDraft) => { b.nets[0]!.pins.push('U9.X'); }, (b: BlockDraft) => { b.nets[0]!.pins.push('U1.NC'); }, (b: BlockDraft) => { b.nets[0]!.pins.push('U1.OUT'); }, (b: BlockDraft) => { b.ports = b.ports.filter(p => p.id !== 'IN'); }]) { const d = draft(regulator()); mutate(d); fails(checkBlockDraft(d)); } });
test('decoupling checks actual capacitor value, both nets and placement, not labels alone', () => { for (const mutate of [(b: BlockDraft) => { b.parts.find(p => p.ref === 'C1')!.value = '100nF'; }, (b: BlockDraft) => { b.parts.find(p => p.ref === 'C1')!.at.x = 5; }, (b: BlockDraft) => { b.nets[0]!.pins = ['U1.IN']; b.nets[1]!.pins.push('C1.A'); }, (b: BlockDraft) => { b.constraints.shift(); }]) { const d = draft(regulator()); mutate(d); fails(checkBlockDraft(d)); } });
test('actual pull-up values and their supply-net membership are required', () => { for (const mutate of [(b: BlockDraft) => { b.parts.find(p => p.ref === 'R1')!.value = '5.1k'; }, (b: BlockDraft) => { b.nets[0]!.pins = b.nets[0]!.pins.filter(p => p !== 'R1.B'); b.nets[1]!.pins.push('R1.B'); }]) { const b = draft(logic('mcu')); mutate(b); fails(checkBlockDraft(b)); } });
test('peak and continuous rail budgets are separate and regulator input draws propagate upstream', () => { const { blocks, plan } = setup(); blocks[1]!.power.sources[0]!.maxMa = 540; fails(checkPlan(plan, blocks), 'peak-current-budget'); blocks[1]!.power.sources[0]!.maxMa = 600; blocks[1]!.power.sources[0]!.continuousMa = 210; fails(checkPlan(plan, blocks), 'continuous-current-budget'); blocks[1]!.power.sources[0]!.continuousMa = 250; blocks[0]!.power.sources[0]!.maxMa = 540; fails(checkPlan(plan, blocks), 'peak-current-budget'); });
test('linear dropout/thermal and switching conversion losses are enforced', () => { let { blocks, plan } = setup(); blocks[1]!.power.sources[0]!.continuousMa = 600; fails(checkPlan(plan, blocks), 'continuous-rating'); blocks[1]!.power.sources[0]!.continuousMa = 250; blocks[1]!.power.sources[0]!.thermal!.ambientC = 70; fails(checkPlan(plan, blocks), 'thermal-budget'); ({ blocks, plan } = setup()); blocks[0]!.power.sources[0]!.volts = 3.4; blocks[0]!.ports[0]!.volts = { min: 3.4, max: 3.4 }; fails(checkPlan(plan, blocks), 'dropout'); ({ blocks, plan } = setup()); const s = blocks[1]!.power.sources[0]!; s.conversion = 'switching'; s.efficiency = .5; delete s.thermal; delete s.dropoutV; s.continuousMa = 600; blocks[0]!.power.sources[0]!.maxMa = 700; fails(checkPlan(plan, blocks), 'peak-current-budget'); });
test('missing source, ground return or voltage compatibility fail on actual plan links', () => { for (const mutate of [(p: BoardPlan) => { p.links = p.links.filter(l => l.to !== 'reg.IN'); }, (p: BoardPlan) => { p.links = p.links.filter(l => l.to !== 'sensor.GND'); }, (p: BoardPlan) => { p.links.find(l => l.to === 'sensor.VCC')!.from = 'source.OUT'; }]) { const { blocks, plan } = setup(); mutate(plan); fails(checkPlan(plan, blocks)); } });
test('bus protocol/signal mismatch, missing I2C pull-ups and address collisions fail', () => { let { blocks, plan } = setup(); blocks[3]!.ports[2]!.bus!.protocol = 'spi'; fails(checkPlan(plan, blocks), 'bus-match'); ({ blocks, plan } = setup()); blocks[2]!.constraints = blocks[2]!.constraints.filter(c => c.kind !== 'pullup'); fails(checkPlan(plan, blocks), 'i2c-pullup-missing'); ({ blocks, plan } = setup()); const second = structuredClone(plan.blocks[3]!); second.inst = 'sensor2'; plan.blocks.push(second); plan.links.push({ from: 'reg.OUT', to: 'sensor2.VCC' }, { from: 'source.GND', to: 'sensor2.GND' }, { from: 'mcu.I2C', to: 'sensor2.I2C' }); fails(checkPlan(plan, blocks), 'i2c-address-collision'); });
test('open-drain bus is safe, while multiple push-pull outputs or mixed drivers are rejected', () => { const { blocks, plan } = setup(); passes(checkPlan(plan, blocks)); blocks[2]!.parts[0]!.pins.SDA!.role = 'output'; fails(checkPlan(plan, blocks), 'mixed-drivers'); blocks[3]!.parts[0]!.pins.SDA!.role = 'output'; fails(checkPlan(plan, blocks), 'multiple-drivers'); });
test('STM32 string GPIO pin maps use actual linked pins and aggregate includes/libraries', () => { const { blocks, plan } = setup(); const map = pinMap(plan, blocks); assert.equal(map.family, 'SYNTHETIC-STM32'); assert.deepEqual(map.pins, { PIN_SENSOR_I2C_SDA: { gpio: 'PA0', port: 'sensor.I2C.SDA' }, PIN_SENSOR_I2C_SCL: { gpio: 'PA1', port: 'sensor.I2C.SCL' } }); assert.deepEqual(map.includes, ['SyntheticDriver.h']); assert.deepEqual(map.libs, ['SYNTHETIC/Test']); assert.equal(Object.keys(map.pins).length, 2); });
test('numeric RP2040-style GPIOs remain numbers and reserved MCU pads cannot enter firmware maps', () => { const { blocks, plan } = setup(); const m = blocks[2]!.mcu!; m.family = 'SYNTHETIC-RP2040'; m.pio.platform = 'raspberrypi'; m.pins[0]!.gpio = 4; m.pins[1]!.gpio = 5; assert.equal(pinMap(plan, blocks).pins.PIN_SENSOR_I2C_SDA!.gpio, 4); m.pins[0]!.reserved = 'SYNTHETIC-reserved'; assert.throws(() => pinMap(plan, blocks), /Reserved/); });
test('reviewed status needs an independent current-hash receipt, never self-promotion', () => { const { blocks, plan } = setup(); const b = blocks[2]!; b.status = 'reviewed'; fails(checkPlan(plan, blocks), 'review-promotion'); b.provenance.reviews.push({ by: 'SYNTHETIC-AUTHOR', at: '2026-11-05T00:00:00Z', contentHash: b.contentHash, verdict: 'pass', notes: 'Synthetic receipt' }); fails(checkPlan(plan, blocks), 'review-promotion'); b.provenance.reviews[0]!.by = 'SYNTHETIC-INDEPENDENT-REVIEWER'; passes(checkPlan(plan, blocks)); b.provenance.reviews[0]!.contentHash = hash('stale'); fails(checkPlan(plan, blocks), 'review-promotion'); });

function usbSink(): BlockDef { const b = supply(); b.id = 'usb'; b.contentHash = hash(b.id); b.parts[0]!.pins.CC1 = role('3', 'passive'); b.parts[0]!.pins.CC2 = role('4', 'passive'); b.parts.push(passive('R1', '5.1k'), passive('R2', '5.1k')); b.nets[1]!.pins.push('R1.B', 'R2.B'); b.nets.push({ name: 'CC1', pins: ['J1.CC1', 'R1.A'] }, { name: 'CC2', pins: ['J1.CC2', 'R2.A'] }); b.constraints.push({ kind: 'usb-c-sink', connector: 'J1', cc1: 'CC1', cc2: 'CC2', resistors: ['R1', 'R2'], ohms: 5100, citation: cite }); return b; }
function charger(): BlockDef { const b = regulator(); b.id = 'charger'; b.contentHash = hash(b.id); b.ports[1]!.id = 'BAT'; b.ports[1]!.volts = { min: 2.7, max: 4.2 }; b.power.sources = [{ port: 'BAT', volts: 4.2, maxMa: 100, inputPort: 'IN', mode: 'charger', conversion: 'linear', dropoutV: .2, thermal: { thetaJa: 230, ambientC: 25, maxJunctionC: 125 } }]; b.constraints.push({ kind: 'battery-path', charger: 'U1', batteryPort: 'BAT', powerPath: 'isolated', citation: cite }); return b; }
test('USB-C CC pull-downs require two distinct 5.1k resistors to actual ground', () => { passes(checkBlockDraft(draft(usbSink()))); for (const mutate of [(b: BlockDraft) => { b.parts.find(p => p.ref === 'R1')!.value = '10k'; }, (b: BlockDraft) => { b.nets.find(n => n.name === 'CC1')!.pins.push('J1.CC2'); }, (b: BlockDraft) => { const c = b.constraints[0]!; if (c.kind === 'usb-c-sink') c.resistors[1] = 'R1'; }, (b: BlockDraft) => { b.nets[1]!.pins = b.nets[1]!.pins.filter(t => t !== 'R2.B'); b.nets[0]!.pins.push('R2.B'); }]) { const b = draft(usbSink()); mutate(b); fails(checkBlockDraft(b)); } });
test('strap safe states use actual resistor paths and reject plan-level overriding outputs', () => { const b = logic('mcu'); b.constraints.push({ kind: 'strap', pin: 'U1.SDA', safe: 'high', resistor: 'R1', to: 'net:VCC', citation: cite }); passes(checkBlockDraft(draft(b))); const bad = draft(b); const c = bad.constraints.at(-1)!; if (c.kind === 'strap') c.to = 'net:G'; fails(checkBlockDraft(bad), 'strap-state'); const { blocks, plan } = setup(); blocks[2] = b; fails(checkPlan(plan, blocks), 'strap-driver'); });
test('isolated charger accepts charge-only use, counts charging input demand and rejects running system on BAT', () => { const c = charger(); passes(checkBlockDraft(draft(c))); const usb = supply(); let p: BoardPlan = { schema: 'moki.plan/1', title: 'SYNTHETIC charge-only', layers: 2, blocks: [usb, c].map(b => ({ inst: b.id, block: b.id, version: 1, params: {} })), links: [{ from: 'source.OUT', to: 'charger.IN' }, { from: 'source.GND', to: 'charger.GND' }] }; passes(checkPlan(p, [usb, c])); usb.power.sources[0]!.maxMa = 90; fails(checkPlan(p, [usb, c]), 'peak-current-budget'); usb.power.sources[0]!.maxMa = 1000; const load = logic('sensor'); load.ports[0]!.volts = { min: 2.7, max: 4.2 }; load.ports = load.ports.filter(p => p.kind !== 'bus'); p.blocks.push({ inst: load.id, block: load.id, version: 1, params: {} }); p.links.push({ from: 'charger.BAT', to: 'sensor.VCC' }, { from: 'source.GND', to: 'sensor.GND' }); fails(checkPlan(p, [usb, c, load]), 'battery-load-sharing'); });
test('claiming load sharing or integrated system output without the required separate paths fails', () => { for (const powerPath of ['load-sharing', 'integrated'] as const) { const b = draft(charger()); const c = b.constraints.at(-1)!; if (c.kind === 'battery-path') { c.powerPath = powerPath; c.systemPort = 'BAT'; } fails(checkBlockDraft(b), 'battery-system'); } });
test('5V push-pull status outputs cannot directly drive a 3.3V input', () => { const { blocks, plan } = setup(); blocks[3]!.parts[0]!.pins.SDA = { pad: '3', role: 'output', volts: { min: 0, max: 5 } }; blocks[2]!.parts[0]!.pins.SDA = { pad: '3', role: 'input', volts: { min: 0, max: 3.6 } }; fails(checkPlan(plan, blocks), 'pin-voltage'); });
test('cyclic regulator dependencies and changed unmaterialized parameter values fail closed', () => { const a = regulator(); const b = structuredClone(a); b.id = 'reg2'; b.contentHash = hash(b.id); const p: BoardPlan = { schema: 'moki.plan/1', title: 'SYNTHETIC cycle', layers: 2, blocks: [a, b].map(b => ({ inst: b.id, block: b.id, version: 1, params: {} })), links: [{ from: 'reg.OUT', to: 'reg2.IN' }, { from: 'reg2.OUT', to: 'reg.IN' }, { from: 'reg.GND', to: 'reg2.GND' }] }; fails(checkPlan(p, [a, b]), 'power-cycle'); const { blocks, plan } = setup(); blocks[2]!.params.push({ id: 'frequency', type: 'number', min: 1, max: 100, default: 10, why: 'SYNTHETIC finite variant' }); passes(checkPlan(plan, blocks)); plan.blocks[2]!.params.frequency = 20; fails(checkPlan(plan, blocks), 'parameter-rebuild-required'); });
test('pin-map macro collisions after sanitization are rejected', () => { const { blocks, plan } = setup(); const b = blocks[3]!; const p = b.ports[2]!; p.id = 'I2C-X'; p.bus!.role = 'passive'; delete p.bus!.i2cAddresses; const q = structuredClone(p); q.id = 'I2C_X'; b.ports.push(q); plan.links = plan.links.filter(l => l.to !== 'sensor.I2C'); plan.links.push({ from: 'mcu.I2C', to: 'sensor.I2C-X' }, { from: 'mcu.I2C', to: 'sensor.I2C_X' }); passes(checkPlan(plan, blocks)); assert.throws(() => pinMap(plan, blocks), /Pin name collision/); });
test('malformed catalog evidence and unknown plan references return error gates without throwing', () => { const b = regulator(); const c = cat(b); c.set(b.parts[0]!.lcsc, {} as CatalogPart); fails(checkBlockDraft(draft(b), c), 'catalog-identity'); for (const mutate of [(p: BoardPlan) => { p.blocks.push(structuredClone(p.blocks[0]!)); }, (p: BoardPlan) => { p.links.push({ from: 'source.OUT', to: 'missing.IN' }); }, (p: BoardPlan) => { p.blocks[0]!.params.unknown = 1; }, (p: BoardPlan) => { p.links.push(structuredClone(p.links[0]!)); }]) { const { blocks, plan } = setup(); mutate(plan); fails(checkPlan(plan, blocks)); } });
test('direct ground boot straps are supported without requiring a fictitious resistor', () => { const b = draft(logic('mcu')); b.parts[0]!.pins.STRAP = role('5', 'input'); b.nets[1]!.pins.push('U1.STRAP'); b.constraints.push({ kind: 'strap', pin: 'U1.STRAP', safe: 'low', to: 'net:G', citation: cite }); passes(checkBlockDraft(b)); });
test('parallel supply pads on the same IC share a source and decoupling rail', () => { const { blocks, plan } = setup(); const b = blocks[1]!; b.parts[0]!.pins.OUT2 = role('5', 'power-out'); b.nets[1]!.pins.push('U1.OUT2'); b.parts[0]!.pins.IN2 = role('6', 'power-in'); b.nets[0]!.pins.push('U1.IN2'); passes(checkBlockDraft(draft(b), cat(b))); passes(checkPlan(plan, blocks)); });
test('explicit schematic sections partition all instances and cite positive datasheet pages', () => { const { blocks, plan } = setup(); plan.sections = plan.blocks.map(i => ({ id: i.inst, title: `SYNTHETIC ${i.inst}`, purpose: 'Synthetic schematic section test', insts: [i.inst], notes: ['Synthetic fixture, no fabrication claim'], reference: { lcsc: blocks.find(b => b.id === i.block)!.parts[0]!.lcsc, datasheetUrl: cite.url, page: 1, quote: 'Synthetic reference-circuit note' } })); passes(checkPlan(plan, blocks)); const before = structuredClone(plan); plan.sections[0]!.reference!.page = 0; fails(checkPlan(plan, blocks), 'section-citation'); Object.assign(plan, structuredClone(before)); plan.sections[0]!.insts.push('missing'); fails(checkPlan(plan, blocks), 'section-partition'); Object.assign(plan, structuredClone(before)); plan.sections.pop(); fails(checkPlan(plan, blocks), 'section-partition'); Object.assign(plan, structuredClone(before)); plan.sections[1]!.insts.push(plan.sections[0]!.insts[0]!); fails(checkPlan(plan, blocks), 'section-partition'); });
test('inline drafts require materialization and cannot carry a forged reviewed status', () => { const { blocks, plan } = setup(); plan.drafts = [draft(blocks[2]!)]; passes(checkPlan(plan, blocks)); (plan.drafts[0] as any).status = 'reviewed'; fails(checkPlan(plan, blocks), 'schema'); delete (plan.drafts[0] as any).status; plan.drafts[0]!.id = 'unresolved'; fails(checkPlan(plan, blocks), 'inline-draft-unresolved'); });
test('cited standard-footprint fallback preserves real supplier identity and leaves geometry verification pending', () => { const b = supply(); const p = b.parts[0]!; p.lcsc = 'C131337'; p.mpn = 'B2B-PH-K-S(LF)(SN)'; p.footprint = { source: 'footprinter', id: 'pinrow2_p2mm', citation: { url: 'https://www.jst-mfg.com/product/pdf/eng/ePH.pdf', pages: '1' } }; const c = cat(b); const evidence = c.get(p.lcsc)!; evidence.importer = 'SYNTHETIC fallback fixture using a genuine known identity'; evidence.pins = []; evidence.footprintSha256 = ''; const g = checkBlockDraft(draft(b), c); passes(g); assert.ok(g.flatMap(g => g.issues).some(i => i.rule === 'fallback-layout-pending')); const d = draft(b); delete d.parts[0]!.footprint; fails(checkBlockDraft(d, c)); const unverified = draft(b); unverified.parts[0]!.pinout = 'unverified'; fails(checkBlockDraft(unverified, c), 'pinout-unverified'); });
test('shared-IC SYS and charger outputs cannot hide combined thermal loss behind separate per-rail models', () => { const b = regulator(); b.parts[0]!.pins.OUTB = role('5', 'power-out'); b.parts.push(passive('C3', '1uF')); b.nets.push({ name: 'OUTB', pins: ['U1.OUTB', 'C3.A'] }); b.nets[2]!.pins.push('C3.B'); b.ports.push({ id: 'OUTB', label: 'Second output', kind: 'power-out', terminal: 'net:OUTB', volts: { min: 3.3, max: 3.3 } }); b.power.sources.push({ ...structuredClone(b.power.sources[0]!), port: 'OUTB' }); b.constraints.push({ kind: 'decoupling', ic: 'U1', powerPin: 'OUTB', groundPin: 'GND', caps: ['C3'], minUf: 1, maxDistanceMm: 2, citation: cite }); fails(checkBlockDraft(draft(b)), 'shared-thermal-budget'); for (const s of b.power.sources) s.continuousMa = 100; passes(checkBlockDraft(draft(b))); });
test('unused regulator outputs still require a declared voltage/current budget', () => { const b = draft(regulator()); b.power.sources = []; b.power.sinks.push({ port: 'IN', typicalMa: 0, peakMa: 0 }); fails(checkBlockDraft(b), 'power-output-unknown'); });

test('I2C rejects input-only pads, missing protocol capabilities and unsupported signal muxes', () => {
  for (const mutate of [
    (b: BlockDef) => { b.parts[0]!.pins.SDA!.role = 'input'; b.mcu!.pins[0]!.caps = ['input', 'i2c']; },
    (b: BlockDef) => { b.mcu!.pins[0]!.caps = ['input', 'i2c']; },
    (b: BlockDef) => { b.mcu!.pins[0]!.caps = ['input', 'output']; },
    (b: BlockDef) => { b.mcu!.pins[0]!.caps = ['input', 'output', 'i2c', 'i2c:SCL']; },
  ]) { const { blocks, plan } = setup(); mutate(blocks[2]!); fails(checkBlockDraft(draft(blocks[2]!))); fails(checkPlan(plan, blocks)); assert.throws(() => pinMap(plan, blocks), /Cannot map pins/); }
  const { blocks, plan } = setup(); blocks[2]!.mcu!.pins[0]!.caps = ['input', 'output', 'i2c:SDA']; passes(checkPlan(plan, blocks));
});
function directionalBus(protocol: 'spi' | 'i2s' | 'uart') {
  const { blocks, plan } = setup(); const output = protocol === 'spi' ? 'SCK' : protocol === 'i2s' ? 'BCLK' : 'TX'; const input = protocol === 'spi' ? 'MISO' : protocol === 'i2s' ? 'SD' : 'RX';
  for (const [i, b] of blocks.entries()) if (i >= 2) { b.ports[2]!.bus!.protocol = protocol; b.ports[2]!.bus!.signals = { [output]: 'U1.SCL', [input]: 'U1.SDA' }; delete b.ports[2]!.bus!.i2cAddresses; b.parts[0]!.pins.SCL!.role = i === 2 ? 'output' : 'input'; b.parts[0]!.pins.SDA!.role = i === 2 ? 'input' : 'output'; }
  blocks[2]!.mcu!.pins[0]!.caps = ['input', protocol]; blocks[2]!.mcu!.pins[1]!.caps = ['output', protocol]; return { blocks, plan };
}
test('SPI, I2S and UART clock/transmit pads require output capability while receive pads may be input-only', () => {
  for (const protocol of ['spi', 'i2s', 'uart'] as const) { const { blocks, plan } = directionalBus(protocol); passes(checkPlan(plan, blocks)); blocks[2]!.parts[0]!.pins.SCL!.role = 'input'; blocks[2]!.mcu!.pins[1]!.caps = ['input', protocol]; fails(checkPlan(plan, blocks), 'mcu-direction'); }
});
test('ADC input ports require analog capability in addition to a digital input capability', () => {
  const { blocks, plan } = setup(); blocks[2]!.parts[0]!.pins.SDA!.role = 'input'; blocks[2]!.mcu!.pins[0]!.caps = ['input', 'adc']; blocks[3]!.parts[0]!.pins.SDA!.role = 'output';
  for (const b of blocks.slice(2)) b.ports[2] = { id: 'I2C', label: 'Synthetic analog port', kind: 'analog', terminal: 'U1.SDA' };
  passes(checkPlan(plan, blocks)); blocks[2]!.mcu!.pins[0]!.caps = ['input']; fails(checkPlan(plan, blocks), 'mcu-analog');
});
test('required pads accept exposed draft boundaries but need an actual connection in a complete plan', () => {
  const { blocks, plan } = setup(); const b = blocks[2]!; b.parts[0]!.pins.REQ = { ...role('5', 'input'), required: true }; b.mcu!.pins.push({ id: 'U1.REQ', gpio: 'PA2', caps: ['input'] }); b.ports.push({ id: 'REQ', label: 'Required external input', kind: 'gpio', terminal: 'U1.REQ' });
  passes(checkBlockDraft(draft(b))); fails(checkPlan(plan, blocks), 'required-pin-unconnected');
  blocks[3]!.parts[0]!.pins.REQ = role('5', 'output'); blocks[3]!.ports.push({ id: 'REQ', label: 'Synthetic source', kind: 'gpio', terminal: 'U1.REQ' }); plan.links.push({ from: 'mcu.REQ', to: 'sensor.REQ' }); passes(checkPlan(plan, blocks));
  const isolated = draft(b); isolated.ports = isolated.ports.filter(p => p.id !== 'REQ'); isolated.nets.push({ name: 'REQ_ONLY', pins: ['U1.REQ'] }); fails(checkBlockDraft(isolated), 'required-pin-unconnected');
  const contradictory = draft(regulator()); contradictory.parts[0]!.pins.NC!.required = true; fails(checkBlockDraft(contradictory), 'required-nc');
});
test('all five safe SPICE profiles accept cited positive part values without pretending execution occurred', () => {
  const b = draft(logic('mcu')); b.spiceChecks = [
    { kind: 'rc-reset', name: 'Synthetic reset', resistor: 'R1', capacitor: 'C1', supplyV: 3.3, thresholdRatio: .63, target: .005, tolerance: .001, citation: cite },
    { kind: 'divider', name: 'Synthetic divider', upper: 'R1', lower: 'R2', inputV: 3.3, target: 1.65, tolerance: .01, citation: cite },
    { kind: 'resistor-current', name: 'Synthetic resistor', resistor: 'R1', voltageV: 3.3, target: .0007, tolerance: .0001, citation: cite },
    { kind: 'led-current', name: 'Synthetic LED', resistor: 'R1', supplyV: 3.3, forwardV: 2, target: .000277, tolerance: .00001, citation: cite },
    { kind: 'charge-current', name: 'Synthetic charge', resistor: 'R1', coefficient: 890, target: .189, tolerance: .001, citation: cite },
  ]; const result = checkBlockDraft(b); passes(result); assert.deepEqual(result.map(g => g.gate), ['erc', 'power']);
  for (const mutate of [
    (b: any) => { b.spiceChecks[0].resistor = 'MISSING'; },
    (b: any) => { b.spiceChecks[0].capacitor = 'R2'; },
    (b: any) => { b.spiceChecks[0].thresholdRatio = 1; },
    (b: any) => { b.spiceChecks[1].lower = 'R1'; },
    (b: any) => { b.spiceChecks[2].voltageV = Infinity; },
    (b: any) => { b.spiceChecks[3].forwardV = 4; },
    (b: any) => { b.spiceChecks[4].coefficient = 0; },
    (b: any) => { b.spiceChecks[4].citation.url = ''; },
    (b: any) => { b.spiceChecks[0].name = b.spiceChecks[1].name; },
    (b: any) => { b.spiceChecks[0].target = 0; },
    (b: any) => { b.spiceChecks[0].tolerance = -1; },
    (b: any) => { b.spiceChecks[0].kind = 'arbitrary-script'; },
    (b: any) => { b.parts.find((p: any) => p.ref === 'R1').value = '0'; },
  ]) { const bad = structuredClone(b); mutate(bad); fails(checkBlockDraft(bad)); }
});

test('I2S data direction follows actual connected pads, so two receive-only ends cannot pass', () => {
  const { blocks, plan } = directionalBus('i2s'); passes(checkPlan(plan, blocks));
  blocks[3]!.parts[0]!.pins.SDA!.role = 'input'; fails(checkPlan(plan, blocks), 'bus-driver-missing');
  blocks[2]!.parts[0]!.pins.SDA!.role = 'output'; blocks[2]!.mcu!.pins[0]!.caps = ['output', 'i2s']; passes(checkPlan(plan, blocks));
});
function fixedUsbSetup() {
  const { blocks, plan } = setup();
  for (const [index, b] of blocks.entries()) if (index >= 2) {
    b.ports[2]!.bus = { protocol: 'usb2', role: index === 2 ? 'peripheral' : 'passive', signals: { DP: 'U1.SDA', DM: 'U1.SCL' } };
    b.parts[0]!.pins.SDA!.role = index === 2 ? 'bidirectional' : 'passive'; b.parts[0]!.pins.SCL!.role = index === 2 ? 'bidirectional' : 'passive';
    b.parts = b.parts.filter(p => !p.ref.startsWith('R')); for (const n of b.nets) n.pins = n.pins.filter(t => !t.startsWith('R')); b.constraints = b.constraints.filter(c => c.kind !== 'pullup');
  }
  for (const p of blocks[2]!.mcu!.pins) { p.caps = ['input', 'output', 'usb']; p.reserved = 'SYNTHETIC fixed native USB pad'; p.fixedFunction = 'usb2'; }
  return { blocks, plan };
}
test('reserved dedicated USB pads require matching native capability and never become application GPIO macros', () => {
  const { blocks, plan } = fixedUsbSetup(); passes(checkPlan(plan, blocks)); assert.deepEqual(pinMap(plan, blocks).pins, {});
  const original = structuredClone(blocks[2]!);
  delete blocks[2]!.mcu!.pins[0]!.fixedFunction; fails(checkPlan(plan, blocks), 'reserved-mcu-pin');
  blocks[2] = structuredClone(original); blocks[2]!.mcu!.pins[0]!.caps = ['input', 'usb']; fails(checkPlan(plan, blocks), 'mcu-direction');
  blocks[2] = structuredClone(original); blocks[2]!.mcu!.pins[0]!.fixedFunction = 'i2c'; fails(checkPlan(plan, blocks), 'mcu-fixed-function');
  blocks[2] = structuredClone(original); blocks[2]!.ports.push({ id: 'USB_AS_GPIO', label: 'Forbidden arbitrary remap', kind: 'gpio', terminal: 'U1.SDA' }); fails(checkPlan(plan, blocks), 'mcu-fixed-function');
  blocks[2] = structuredClone(original); blocks[2]!.mcu!.pins.shift(); fails(checkPlan(plan, blocks), 'mcu-pin-unmapped');
});
test('normally-open switches are explicit cited two-contact devices rather than zero-ohm resistors', () => {
  const b = draft(logic('mcu')); const sw = part('SW1', { A: role('1', 'passive'), B: role('2', 'passive') }); sw.switch = 'normally-open'; b.parts.push(sw); passes(checkBlockDraft(b));
  for (const mutate of [
    (b: any) => { b.parts.at(-1).value = ''; },
    (b: any) => { b.parts.at(-1).value = '0'; },
    (b: any) => { b.parts.at(-1).pins.B.role = 'output'; },
    (b: any) => { b.parts.at(-1).pins.C = role('3', 'passive'); },
    (b: any) => { b.parts.at(-1).datasheet = { url: cite.url }; },
    (b: any) => { b.parts.at(-1).switch = 'normally-closed'; },
  ]) { const bad = structuredClone(b); mutate(bad); fails(checkBlockDraft(bad)); }
});

function fixedControlsSetup() {
  const { blocks, plan } = setup(); const mcu = blocks[2]!; const controls = blank('controls');
  for (const [index, name] of ['reset', 'boot'].entries()) {
    const id = name.toUpperCase(); const terminal = `U1.${id}`; mcu.parts[0]!.pins[id] = { ...role(String(index + 5), 'input'), required: true };
    mcu.parts.push(passive(`R${index + 3}`, '10k')); mcu.nets.push({ name: id, pins: [terminal, `R${index + 3}.A`] }); mcu.nets[0]!.pins.push(`R${index + 3}.B`);
    mcu.ports.push({ id, label: `Dedicated ${name}`, kind: 'gpio', fixedFunction: name, terminal });
    mcu.mcu!.pins.push({ id: terminal, gpio: name === 'boot' ? 0 : 'EN', caps: ['input', name], reserved: `Synthetic fixed ${name} control`, fixedFunction: name });
    mcu.constraints.push({ kind: 'pullup', pin: terminal, to: 'net:VCC', resistor: `R${index + 3}`, ohms: 10000, citation: cite });
    const sw = part(`SW${index + 1}`, { A: role('1', 'passive'), B: role('2', 'passive') }); sw.switch = 'normally-open'; controls.parts.push(sw); controls.nets.push({ name: id, pins: [`${sw.ref}.A`] }); controls.ports.push({ id, label: `Fixed ${name} switch`, kind: 'gpio', terminal: `net:${id}`, fixedFunction: name });
    plan.links.push({ from: `mcu.${id}`, to: `controls.${id}` });
  }
  controls.nets.push({ name: 'GND', pins: ['SW1.B', 'SW2.B'] }); controls.ports.push({ id: 'GND', label: 'Ground', kind: 'ground', terminal: 'net:GND' });
  blocks.push(controls); plan.blocks.push({ inst: controls.id, block: controls.id, version: 1, params: {} }); plan.links.push({ from: 'source.GND', to: 'controls.GND' }); return { blocks, plan };
}
test('fixed BOOT/RESET controls remain connectable with declared input capabilities and stay outside application pin maps', () => {
  const { blocks, plan } = fixedControlsSetup(); passes(checkPlan(plan, blocks)); passes(checkBlockDraft(draft(blocks[2]!)));
  assert.deepEqual(Object.keys(pinMap(plan, blocks).pins).sort(), ['PIN_SENSOR_I2C_SCL', 'PIN_SENSOR_I2C_SDA']);
  for (const mutate of [
    (b: BlockDef[]) => { b[2]!.mcu!.pins.find(p => p.fixedFunction === 'reset')!.caps = ['input']; },
    (b: BlockDef[]) => { b[2]!.mcu!.pins.find(p => p.fixedFunction === 'reset')!.fixedFunction = 'boot'; },
    (b: BlockDef[]) => { b[2]!.parts[0]!.pins.RESET!.role = 'output'; },
    (b: BlockDef[]) => { delete b[2]!.ports.find(p => p.id === 'RESET')!.fixedFunction; },
    (b: BlockDef[]) => { b[2]!.ports.push({ id: 'ARBITRARY_APP_GPIO', label: 'Forbidden remap', kind: 'gpio', terminal: 'U1.RESET' }); },
    (b: BlockDef[]) => { b.at(-1)!.ports.find(p => p.id === 'RESET')!.fixedFunction = 'boot'; },
  ]) { const copy = structuredClone(blocks); mutate(copy); fails(checkPlan(plan, copy)); assert.throws(() => pinMap(plan, copy)); }
});
test('requirements preserve closed metric/operator/source values without declaring that a target was verified', () => {
  const { blocks, plan } = setup(); plan.requirements = [
    { id: 'life', plain: 'Run for at least eight hours', metric: 'battery_life_h', args: { batteryMah: 1000 }, op: '>=', value: 8, unit: 'h', source: 'brief' },
    { id: 'bus', plain: 'Provide an I2C interface', metric: 'interface_present', args: { interface: 'i2c' }, op: 'present', source: 'maker' },
    { id: 'size', plain: 'Board width at most sixty millimetres', metric: 'board_size_mm', args: { axis: 'width' }, op: '<=', value: 60, unit: 'mm', source: 'brief' },
    { id: 'pin', plain: 'Input-capable signal pin', metric: 'pin_capability', args: { pin: 'mcu.U1.SDA', capability: 'input' }, op: 'present', source: 'inferred' },
    { id: 'volts', plain: 'Supply remains in the requested range', metric: 'net_voltage', args: { net: 'V3V3' }, op: 'within', value: [3, 3.6], unit: 'V', source: 'brief' },
    { id: 'current', plain: 'Provide the requested current budget', metric: 'current_budget_ma', args: { rail: 'V3V3' }, op: '>=', value: 500, unit: 'mA', source: 'brief' },
    { id: 'parts', plain: 'Use no more than forty parts', metric: 'part_count', op: '<=', value: 40, source: 'brief' },
    { id: 'cost', plain: 'Keep the BOM under the target cost', metric: 'bom_cost_usd', op: '<=', value: 12.5, unit: 'USD', source: 'maker' },
  ]; const original = structuredClone(plan); const g = checkPlan(plan, blocks); passes(g); assert.equal(g.some(g => g.gate === 'verify'), false); assert.deepEqual(plan, original);
  for (const mutate of [
    (p: any) => { p.requirements[0].metric = 'invented_metric'; },
    (p: any) => { p.requirements[0].op = 'approximately'; },
    (p: any) => { p.requirements[0].source = 'model'; },
    (p: any) => { p.requirements[0].value = Infinity; },
    (p: any) => { p.requirements[0].id = p.requirements[1].id; },
    (p: any) => { p.requirements[0].plain = ' '; },
    (p: any) => { p.requirements[0].measured = 8; },
    (p: any) => { p.requirements[0].args = { invalidNested: { x: 1 } }; },
    (p: any) => { p.requirements[4].value = [3.6, 3]; },
    (p: any) => { p.requirements[4].value = [3, 3.3, 3.6]; },
    (p: any) => { p.requirements[4].value = 3.3; },
    (p: any) => { p.requirements[6].value = -1; },
    (p: any) => { p.requirements[6].value = 1.5; },
    (p: any) => { p.requirements[2].value = 0; },
    (p: any) => { p.requirements[0].value = '8'; },
  ]) { const bad = structuredClone(plan); mutate(bad); fails(checkPlan(bad, blocks)); }
});

test('analog requirements propagate to MCU GPIO endpoints and across intermediary aliases', () => {
  const { blocks, plan } = setup(); blocks[2]!.parts[0]!.pins.SDA!.role = 'input'; blocks[2]!.mcu!.pins[0]!.caps = ['input']; blocks[3]!.parts[0]!.pins.SDA!.role = 'output';
  blocks[2]!.ports[2] = { id: 'I2C', label: 'GPIO input', kind: 'gpio', terminal: 'U1.SDA' }; blocks[3]!.ports[2] = { id: 'I2C', label: 'Analog source', kind: 'analog', terminal: 'U1.SDA' };
  fails(checkPlan(plan, blocks), 'mcu-analog'); assert.throws(() => pinMap(plan, blocks)); blocks[2]!.mcu!.pins[0]!.caps.push('adc'); passes(checkPlan(plan, blocks));
  const bridge = blank('alias'); bridge.parts = [part('J1', { A: role('1', 'passive'), B: role('2', 'passive') })]; bridge.nets = [{ name: 'SIGNAL', pins: ['J1.A', 'J1.B'] }]; bridge.ports = [{ id: 'DIGITAL', label: 'GPIO alias', kind: 'gpio', terminal: 'J1.A' }, { id: 'ANALOG', label: 'Analog alias', kind: 'analog', terminal: 'J1.B' }];
  blocks.push(bridge); plan.blocks.push({ inst: bridge.id, block: bridge.id, version: 1, params: {} }); plan.links = plan.links.filter(l => l.to !== 'sensor.I2C'); plan.links.push({ from: 'mcu.I2C', to: 'alias.DIGITAL' }, { from: 'alias.ANALOG', to: 'sensor.I2C' });
  passes(checkPlan(plan, blocks)); blocks[2]!.mcu!.pins[0]!.caps = ['input']; fails(checkPlan(plan, blocks), 'mcu-analog');
});

test('board size requirements keep coordinatewise dimensions including width greater than height',()=>{
 const {blocks,plan}=setup();
 for(const op of ['<=','within'] as const){plan.requirements=[{id:'board',plain:'Fits60by40mm',metric:'board_size_mm',op,value:[60,40],source:'maker'}];passes(checkPlan(plan,blocks));}
 plan.requirements=[{id:'volts',plain:'Voltage range',metric:'net_voltage',args:{net:'3V3'},op:'within',value:[3.6,3.0],source:'maker'}];fails(checkPlan(plan,blocks),'requirement-range');
});

test('connected GPIO inputs need a real driver; bidirectional ADC pads may drive digital loads',()=>{
 const {blocks,plan}=setup();
 for(const b of blocks.slice(2)){b.ports[2]={id:'I2C',label:'Signal',kind:'gpio',terminal:'U1.SDA'};b.constraints=b.constraints.filter(c=>c.kind!=='pullup'||c.pin!=='U1.SDA');}
 blocks[2]!.parts[0]!.pins.SDA!.role='input'; blocks[2]!.mcu!.pins[0]!.caps=['input'];
 blocks[3]!.parts[0]!.pins.SDA!.role='input';
 fails(checkPlan(plan,blocks),'signal-driver-missing');
 blocks[2]!.parts[0]!.pins.SDA!.role='bidirectional'; blocks[2]!.mcu!.pins[0]!.caps=['input','output','adc'];
 blocks[2]!.ports[2]!.kind='analog'; passes(checkPlan(plan,blocks));
 blocks[2]!.mcu!.pins[0]!.caps=['input','output']; fails(checkPlan(plan,blocks),'mcu-analog');
});

test('an unused I2C mux option needs no pullups, while a linked bus still does',()=>{
 const {blocks,plan}=setup();
 blocks[2]!.constraints=blocks[2]!.constraints.filter(c=>c.kind!=='pullup');
 plan.links=plan.links.filter(l=>l.from!=='mcu.I2C');
 // Keep the unused peripheral's standalone controller rule out of this case.
 blocks[3]!.ports[2]!.bus!.role='passive';delete blocks[3]!.ports[2]!.bus!.i2cAddresses;
 passes(checkPlan(plan,blocks));
 plan.links.push({from:'mcu.I2C',to:'sensor.I2C'});
 fails(checkPlan(plan,blocks),'i2c-pullup-missing');
});

function compositeLogicFixture() {
 const {blocks,plan}=setup(),mcu=blocks[2]!,sensor=blocks[3]!;
 const rename=(s:string)=>s.replace(/^U1\./,'U2.').replace(/^C1\./,'C_SENSOR.');
 for(const p of structuredClone(sensor.parts)){p.ref=p.ref==='U1'?'U2':'C_SENSOR';p.at.x+=5;mcu.parts.push(p);}
 for(const n of sensor.nets)mcu.nets.find(q=>q.name===n.name)!.pins.push(...n.pins.map(rename));
 mcu.constraints.push({kind:'decoupling',ic:'U2',powerPin:'VDD',groundPin:'GND',caps:['C_SENSOR'],minUf:1,maxDistanceMm:2,citation:cite});
 plan.blocks=plan.blocks.filter(b=>b.inst!=='sensor');plan.links=plan.links.filter(l=>!l.from.startsWith('sensor.')&&!l.to.startsWith('sensor.'));
 return {blocks:blocks.slice(0,3),plan,mcu};
}
test('a composite MCU/peripheral block still requires pullups for its internal I2C bus',()=>{
 const {blocks,plan,mcu}=compositeLogicFixture();passes(checkPlan(plan,blocks));
 mcu.constraints=mcu.constraints.filter(c=>c.kind!=='pullup');fails(checkPlan(plan,blocks),'i2c-pullup-missing');
});
test('an ADC inside a composite block cannot drive an internal analog consumer',()=>{
 const {blocks,plan,mcu}=compositeLogicFixture();mcu.ports[2]={id:'ANALOG',label:'Internal analog net',kind:'analog',terminal:'U1.SDA'};
 mcu.parts.find(p=>p.ref==='U1')!.pins.SDA!.role='bidirectional';mcu.mcu!.pins[0]!.caps=['input','output','adc'];
 mcu.parts.find(p=>p.ref==='U2')!.pins.SDA!.role='input';fails(checkPlan(plan,blocks),'mcu-analog-direction');
 mcu.parts.find(p=>p.ref==='U2')!.pins.SDA!.role='output';passes(checkPlan(plan,blocks));
});
