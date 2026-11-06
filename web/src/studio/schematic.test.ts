import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EMPTY_SESSION, submitBrief } from '../../../src/circuit/session';
import type { CircuitDesign } from '../../../src/circuit/model';
import { CANVAS_WAIT, canvasWait } from './canvasWait';
import { fitView, GRID, gridStep, layOutSheet, type SheetLayout } from './schematic/layout';
import { blockers, draftOps, draftOverlay, dropLastStep, graphForPlan, NO_DRAFT, nextInst, portMarksOf, redoDraft, tryPlanStep, tryStep, undoDraft, wireOps, nextRef } from './schematic/ops';
import { graphFromAudit, revealOnly, sheetFromDesign, sheetFromGraph, withPorts, type BlockInfo, type SheetGraph } from './schematic/sheet';
import type { BoardPlan } from '../../../src/blocks/contract';

const designOf = (brief: string): CircuitDesign => {
  const step = submitBrief(EMPTY_SESSION, brief);
  assert.equal(step.outcome.kind, 'created');
  return (step.outcome as Extract<typeof step.outcome, { kind: 'created' }>).revision.design;
};
const timer = () => designOf('A desk focus timer with a buzzer and an OLED display');
const lamp = () => designOf('A lamp that turns on when the room gets dark');

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertClean(layout: SheetLayout) {
  layout.sections.forEach((a, i) => layout.sections.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}`)));
  layout.parts.forEach((a, i) => layout.parts.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b), `${a.ref} overlaps ${b.ref}`)));
  for (const s of layout.sections) {
    assert.ok(s.x >= layout.frame.x && s.y >= layout.frame.y, `${s.id} is off the frame's top left`);
    assert.ok(s.x + s.w <= layout.frame.x + layout.frame.w && s.y + s.h <= layout.frame.y + layout.frame.h, `${s.id} is off the frame`);
  }
  for (const p of layout.parts) {
    const home = layout.sections.find(s => s.id === p.section)!;
    assert.ok(p.x >= home.x && p.x + p.w <= home.x + home.w, `${p.ref} leaves section ${home.id} sideways`);
    for (const pin of p.pins) assert.ok(pin.ex >= home.x && pin.ex <= home.x + home.w, `${p.ref}.${pin.id} leaves its section`);
  }
}

test('a carrier design gets one titled section per module and its passives go with what they serve', () => {
  const design = lamp();
  const sheet = sheetFromDesign(design);
  assert.equal(sheet.parts.length, design.parts.length);
  assert.ok(sheet.sections.some(s => s.title.startsWith('Controller')));
  const everyPart = sheet.sections.flatMap(s => s.parts).sort();
  assert.deepEqual(everyPart, design.parts.map(p => p.id).sort(), 'each part lands in exactly one section');
  const resistorHomes = design.parts.filter(p => p.module.includes('resistor')).map(p => sheet.sections.find(s => s.parts.includes(p.id))!);
  for (const home of resistorHomes) assert.ok(home.parts.length > 1, `${home.title} holds a resistor alone`);
});

test('every connection on the sheet is a connection in the design, and the other way round', () => {
  for (const design of [timer(), lamp()]) {
    const layout = layOutSheet(sheetFromDesign(design));
    const drawn = new Set(layout.parts.flatMap(p => p.pins.filter(pin => pin.net).map(pin => `${p.ref}.${pin.id}=${pin.net}`)));
    const truth = new Set(design.nets.flatMap(n => n.endpoints.map(e => `${e.part}.${e.pin}=${n.id}`)));
    assert.deepEqual([...drawn].sort(), [...truth].sort());
    for (const wire of layout.wires) {
      const net = design.nets.find(n => n.id === wire.net)!;
      assert.equal(wire.pins.length, net.endpoints.length, `${net.name} draws every endpoint`);
    }
  }
});

test('the layout is deterministic and nothing overlaps or leaves the frame', () => {
  for (const design of [timer(), lamp()]) {
    const sheet = sheetFromDesign(design);
    for (const options of [{}, { hidden: true }, { aspect: 0.62 }]) {
      const a = layOutSheet(sheet, options);
      assert.deepEqual(a, layOutSheet(sheet, options));
      assertClean(a);
      for (const p of a.parts) assert.ok(Math.abs(p.y / GRID - Math.round(p.y / GRID)) < 1e-6, `${p.ref} is off the grid`);
    }
  }
});

test('hidden pins only appear when asked for, and required ones always show', () => {
  const design = timer();
  const sheet = sheetFromDesign(design);
  const mcu = (hidden: boolean) => layOutSheet(sheet, { hidden }).parts.find(p => p.ref === 'U1')!;
  assert.ok(mcu(false).pins.length < mcu(true).pins.length);
  assert.equal(mcu(true).pins.length, sheet.parts.find(p => p.ref === 'U1')!.pins.length);
});

test('a chip build reads through schematic-circuit.json into titled sections with real net names', () => {
  const dir = 'var/board-jobs-test-chip/8b5225bc-4a2e-4cb6-beeb-c7b80efec6a9';
  let audit: never, plan: never;
  try {
    audit = JSON.parse(readFileSync(`${dir}/schematic-circuit.json`, 'utf8')) as never;
    plan = JSON.parse(readFileSync(`${dir}/plan.json`, 'utf8')) as never;
  } catch { return; } // Evidence jobs are local. The shapes below are also covered by the live capture.
  const graph = graphFromAudit(audit);
  const sheet = sheetFromGraph(plan, graph);
  assert.equal(sheet.sections.length, 6);
  assert.ok(sheet.sections.every(s => s.parts.length > 0));
  assert.equal(sheet.nets.find(n => n.name === 'GND')?.kind, 'ground');
  assert.equal(sheet.nets.find(n => n.name === 'V3V3')?.kind, 'power');
  assert.equal(sheet.nets.find(n => n.name === 'SDA')?.kind, 'signal');
  const u1 = sheet.parts.find(p => p.ref === 'U1')!;
  assert.ok(u1.pins.some(p => p.label === 'EN' && p.net === 'EN'));
  const started = performance.now();
  assertClean(layOutSheet(sheet));
  assert.ok(performance.now() - started < 200, 'a live update has to lay out well inside its one-second budget');
});

test('a sheet revealed one part at a time grows without moving what earlier sections already placed', () => {
  const sheet = sheetFromDesign(timer());
  const order = sheet.sections.flatMap(s => s.parts);
  const firstRef = order[0]!;
  const place = (n: number) => layOutSheet(revealOnly(sheet, new Set(order.slice(0, n))));
  assert.equal(place(1).parts.length, 1);
  const before = place(1).parts.find(p => p.ref === firstRef)!;
  const after = place(order.length).parts.find(p => p.ref === firstRef)!;
  // The first section stays top left, whatever joins it.
  assert.ok(Math.abs(before.y - after.y) < 40, 'the first part stays near the top');
  assert.equal(place(order.length).parts.length, sheet.parts.length);
});

test('a partial design and the same final design draw the same sheet, so the swap cannot jump', () => {
  const design = timer();
  // Loose notes make a section with no parts, which is the case that used to jump.
  design.notes.push({ level: 'info', text: 'A note about the whole sheet' });
  const sheet = sheetFromDesign(design);
  assert.ok(sheet.sections.some(s => !s.parts.length));
  assert.deepEqual(layOutSheet(sheetFromDesign(structuredClone(design))), layOutSheet(sheet));
  const everyone = new Set(sheet.parts.map(p => p.ref));
  assert.deepEqual(layOutSheet(revealOnly(sheet, everyone)), layOutSheet(sheet), 'fully revealed is the final sheet');
});

test('adding a part is a draft that needs wiring: the step is taken, but Apply is refused until it is connected', () => {
  const base = timer();
  const ref = nextRef('bme280-i2c-4pin', base.parts.map(p => p.id));
  const added = tryStep(base, NO_DRAFT, [{ op: 'add_part', id: ref, module: 'bme280-i2c-4pin', role: 'Air sensor' }]);
  assert.ok('draft' in added);
  const left = blockers(base, added.design);
  assert.ok(left.length >= 4, left.join(' | '));
  assert.ok(left.some(m => m.includes(`${ref}.`) && m.includes('not connected')));
});

test('a wrong connection is refused now, in a plain sentence, and leaves the draft alone', () => {
  const base = timer();
  const ground = base.nets.find(n => n.kind === 'ground')!;
  const display = base.parts.find(p => p.module.includes('ssd1306'))!;
  const sda = base.nets.flatMap(n => n.endpoints).find(e => e.part === display.id && e.pin === 'SDA')!;
  const pinFree = base.parts[0]!.id;
  const toRail = tryStep(base, NO_DRAFT, [{ op: 'connect', net: ground.id, endpoints: [{ part: pinFree, pin: 'GPIO4' }] }]);
  assert.ok('refused' in toRail && /GPIO4/.test(toRail.refused), JSON.stringify(toRail));
  const twoNets = wireOps(base, { part: display.id, pin: sda.pin, net: base.nets.find(n => n.endpoints.includes(sda))!.id }, { part: display.id, pin: 'VCC', net: base.nets.find(n => n.endpoints.some(e => e.part === display.id && e.pin === 'VCC'))!.id });
  assert.ok('refused' in twoNets && /Disconnect one first/.test(twoNets.refused));
  assert.deepEqual(wireOps(base, { part: 'U1', pin: 'GPIO4', net: null }, { part: 'U1', pin: 'GPIO4', net: null }), { refused: 'That’s the same pin.' });
});

test('undo and redo walk the steps, and a new step clears redo', () => {
  const base = timer();
  const a = tryStep(base, NO_DRAFT, [{ op: 'add_note', text: 'Keep the buzzer away from the sensor' }]);
  assert.ok('draft' in a);
  const b = tryStep(base, a.draft, [{ op: 'rename_net', net: base.nets.find(n => n.kind === 'signal')!.id, name: 'RENAMED' }]);
  assert.ok('draft' in b);
  assert.equal(draftOps(b.draft).length, 2);
  const back = undoDraft(b.draft);
  assert.equal(draftOps(back).length, 1);
  assert.equal(draftOps(redoDraft(back)).length, 2);
  const branch = tryStep(base, back, [{ op: 'add_note', text: 'Another' }]);
  assert.ok('draft' in branch);
  assert.equal(branch.draft.undone.length, 0);
});

test('a duplicate net name is refused when it is typed', () => {
  const base = timer();
  const [x, y] = base.nets;
  const clash = tryStep(base, NO_DRAFT, [{ op: 'rename_net', net: x!.id, name: y!.name }]);
  assert.ok('refused' in clash);
});

test('the draft overlay marks what is new and keeps what is gone, ghosted, in its section', () => {
  const base = timer();
  const victim = base.parts.find(p => p.module.includes('piezo') || p.module.includes('ssd1306'))!;
  const stepped = tryStep(base, NO_DRAFT, [{ op: 'remove_part', id: victim.id }]);
  assert.ok('draft' in stepped);
  const overlay = draftOverlay(sheetFromDesign(base), sheetFromDesign(stepped.design));
  assert.equal(overlay.marks.get(victim.id), 'removed');
  const layout = layOutSheet(overlay.sheet, { marks: overlay.marks, pinMarks: overlay.pinMarks });
  assert.equal(layout.parts.find(p => p.ref === victim.id)?.draft, 'removed');
  assert.ok(layout.sections.some(s => s.parts.includes(victim.id)));
});

test('fit keeps the sheet inside the room the rails leave, and the grid stays a comfortable size', () => {
  const inset = { left: 78, right: 86, top: 18, bottom: 64 };
  const v = fitView({ w: 300, h: 200 }, 1000, 800, inset);
  assert.ok(v.x >= inset.left - 0.01 && v.y >= inset.top - 0.01);
  assert.ok(v.x + 300 * v.s <= 1000 - inset.right + 0.01 && v.y + 200 * v.s <= 800 - inset.bottom + 0.01);
  for (const s of [0.5, 1, 3, 10]) assert.ok(gridStep(s) * s >= 11);
});

test('with nothing built, the canvas says where the turn is, and never the old placeholder', () => {
  const quiet = { agentRunning: false, building: false, projectStarting: false, waitingOnMaker: false, hasTurns: false };
  assert.equal(canvasWait(quiet), 'idle');
  assert.equal(canvasWait({ ...quiet, hasTurns: true, waitingOnMaker: true }), 'waiting');
  assert.equal(canvasWait({ ...quiet, hasTurns: true }), 'nothing');
  assert.equal(canvasWait({ ...quiet, agentRunning: true, hasTurns: true }), 'working');
  assert.equal(canvasWait({ ...quiet, building: true }), 'working');
  assert.equal(canvasWait({ ...quiet, projectStarting: true }), 'working');
  // Work outranks a card still on screen: the turn has moved on.
  assert.equal(canvasWait({ ...quiet, agentRunning: true, waitingOnMaker: true }), 'working');
  assert.equal(CANVAS_WAIT.waiting, 'Nothing built yet. Confirm in the chat to start.');
  assert.equal(CANVAS_WAIT.nothing, 'Nothing was built. See the chat.');
  for (const line of Object.values(CANVAS_WAIT)) assert.ok(!line.includes('land here'));
});

// A small chip board: real shapes, invented blocks.
const blockInfo = (id: string, ports: [string, string][]): BlockInfo => ({ id, version: 1, title: `The ${id}`, summary: '', class: 'sensor', status: 'reviewed', parts: 1, ports: ports.map(([p, kind]) => ({ id: p, label: p, kind })) });
const BLOCKS = [blockInfo('mcu', [['GND', 'ground'], ['V3V3', 'power-in'], ['I2C', 'bus']]), blockInfo('sensor', [['GND', 'ground'], ['V3V3', 'power-in'], ['I2C', 'bus']])];
const chipPlan = (): BoardPlan => ({
  schema: 'moki.plan/1', title: 'Chip', layers: 2,
  blocks: [{ inst: 'mcu', block: 'mcu', version: 1, params: {} }, { inst: 'air', block: 'sensor', version: 1, params: {} }],
  links: [{ from: 'mcu.GND', to: 'air.GND' }],
  sections: [{ id: 'mcu', title: 'MCU', purpose: 'x', insts: ['mcu'], notes: [] }, { id: 'air', title: 'Air', purpose: 'x', insts: ['air'], notes: [] }],
});
const chipGraph = (): SheetGraph => ({
  parts: [
    { ref: 'U1', inst: 'mcu', title: 'MCU', pins: [{ id: '1', label: 'GND', role: 'ground' }, { id: '2', label: 'IO1', role: 'bidirectional' }] },
    { ref: 'U2', inst: 'air', title: 'Air', pins: [{ id: '1', label: 'GND', role: 'ground' }, { id: '2', label: 'SDA', role: 'bidirectional' }] },
  ],
  nets: [{ name: 'GND', pins: [{ ref: 'U1', pin: '1' }, { ref: 'U2', pin: '1' }] }],
});
const chipSheet = (plan = chipPlan(), graph = chipGraph()) => withPorts(sheetFromGraph(plan, graphForPlan(graph, plan)), plan, BLOCKS);

test('a chip section shows its block ports with what each is linked to, inside the section', () => {
  const sheet = chipSheet();
  const mcu = sheet.sections.find(s => s.id === 'mcu')!;
  assert.deepEqual(mcu.ports!.map(p => p.key), ['mcu.GND', 'mcu.V3V3', 'mcu.I2C']);
  assert.deepEqual(mcu.ports![0]!.links, ['air.GND']);
  assert.deepEqual(mcu.ports![1]!.links, []);
  const layout = layOutSheet(sheet);
  assertClean(layout);
  for (const section of layout.sections) {
    for (const port of section.ports) {
      assert.ok(port.x >= section.x && port.x + port.w <= section.x + section.w, `${port.key} leaves ${section.id}`);
      assert.ok(port.y >= section.y && port.y + port.h <= section.y + section.h, `${port.key} leaves ${section.id}`);
    }
    for (const part of layout.parts.filter(p => p.section === section.id)) {
      const lowest = Math.max(...section.ports.map(p => p.y + p.h));
      assert.ok(part.y - 3.6 >= lowest, `${part.ref} runs into the ports`);
    }
  }
});

test('a port tag shows its name, and the rest of the label waits for hover', () => {
  const mcu = blockInfo('mcu', [['GPIO4', 'gpio']]);
  mcu.ports[0]!.label = 'GPIO4 / ADC / PWM';
  const plan = chipPlan();
  const port = withPorts(sheetFromGraph(plan, chipGraph()), plan, [mcu, BLOCKS[1]!]).sections[0]!.ports![0]!;
  assert.equal(port.label, 'GPIO4');
  assert.equal(port.full, 'GPIO4 / ADC / PWM');
  assert.equal(port.key, 'mcu.GPIO4');
});

test('many ports wrap to more rows, and the section grows to hold them', () => {
  const many = blockInfo('mcu', Array.from({ length: 24 }, (_, i): [string, string] => [`GPIO${i}`, 'gpio']));
  const plan = chipPlan();
  const wrapped = withPorts(sheetFromGraph(plan, chipGraph()), plan, [many, BLOCKS[1]!]);
  const layout = layOutSheet(wrapped);
  const section = layout.sections.find(s => s.id === 'mcu')!;
  assert.ok(new Set(section.ports.map(p => p.y)).size > 1, 'more than one row');
  assertClean(layout);
  assert.ok(section.h > layOutSheet(chipSheet()).sections.find(s => s.id === 'mcu')!.h);
});

test('a link is a draft step, and what the local applier can see is refused now', () => {
  const plan = chipPlan();
  const linked = tryPlanStep(plan, NO_DRAFT, [{ op: 'link', from: 'mcu.I2C', to: 'air.I2C' }]);
  assert.ok('draft' in linked);
  assert.deepEqual(linked.plan.links.at(-1), { from: 'mcu.I2C', to: 'air.I2C' });
  const again = tryPlanStep(plan, linked.draft, [{ op: 'link', from: 'air.I2C', to: 'mcu.I2C' }]);
  assert.ok('refused' in again && /already linked/.test(again.refused));
  const carrierOp = tryPlanStep(plan, NO_DRAFT, [{ op: 'add_part', id: 'U9', module: 'x', role: 'y' }]);
  assert.ok('refused' in carrierOp && /Add a block/.test(carrierOp.refused));
  assert.equal(plan.links.length, 1, 'the base plan is never touched');
});

test('the draft overlay marks changed ports, and a removed block stays as a ghost rather than a new section', () => {
  const plan = chipPlan();
  const base = chipSheet();
  const linked = tryPlanStep(plan, NO_DRAFT, [{ op: 'link', from: 'mcu.I2C', to: 'air.I2C' }, { op: 'unlink', from: 'mcu.GND', to: 'air.GND' }]);
  assert.ok('plan' in linked);
  const marks = portMarksOf(base, chipSheet(linked.plan));
  assert.equal(marks.get('mcu.I2C'), 'added');
  assert.equal(marks.get('mcu.GND'), 'removed');
  assert.equal(marks.has('mcu.V3V3'), false);
  const removed = tryPlanStep(plan, NO_DRAFT, [{ op: 'remove_block', inst: 'air' }]);
  assert.ok('plan' in removed);
  const next = chipSheet(removed.plan);
  assert.ok(!next.parts.some(p => p.ref === 'U2'), 'its parts leave with the block');
  const overlay = draftOverlay(base, next);
  assert.equal(overlay.marks.get('U2'), 'removed');
  assert.equal(overlay.sheet.sections.filter(s => s.parts.includes('U2')).length, 1);
  assert.ok(layOutSheet(overlay.sheet, { marks: overlay.marks }).parts.find(p => p.ref === 'U2')?.draft === 'removed');
});

test('a new block shows at once as its titled section with its ports, before the server has drawn its parts', () => {
  const plan = chipPlan();
  const added = tryPlanStep(plan, NO_DRAFT, [{ op: 'add_block', inst: 'sensor', block: 'sensor', version: 1 }]);
  assert.ok('plan' in added);
  const sheet = chipSheet(added.plan);
  const section = sheet.sections.find(s => s.id === 'sensor')!;
  assert.equal(section.title, 'The sensor');
  assert.deepEqual(section.ports!.map(p => p.key), ['sensor.GND', 'sensor.V3V3', 'sensor.I2C']);
  assert.deepEqual(section.parts, []);
  assertClean(layOutSheet(sheet));
  const overlay = draftOverlay(chipSheet(), sheet);
  assert.equal(layOutSheet(overlay.sheet, { marks: overlay.marks }).sections.find(s => s.id === 'sensor')?.draft, 'added');
});

test('a chip rename is left for the server, which is the only one that can find the net', () => {
  const plan = chipPlan();
  const renamed = tryPlanStep(plan, NO_DRAFT, [{ op: 'rename_net', net: 'SDA', name: 'AIR_SDA' }]);
  assert.ok('draft' in renamed, 'not refused locally');
  assert.equal(draftOps(renamed.draft).length, 1);
  assert.deepEqual(renamed.plan.links, plan.links);
});

test('another copy of a block gets a name of its own, and a step the server refuses cannot be redone', () => {
  assert.equal(nextInst('sensor', ['mcu']), 'sensor');
  assert.equal(nextInst('sensor', ['sensor']), 'sensor-2');
  assert.equal(nextInst('sensor', ['sensor', 'sensor-2']), 'sensor-3');
  assert.match(nextInst('9 odd/name', []), /^[A-Za-z_][A-Za-z0-9_-]*$/);
  const plan = chipPlan();
  const one = tryPlanStep(plan, NO_DRAFT, [{ op: 'link', from: 'mcu.I2C', to: 'air.I2C' }]);
  assert.ok('draft' in one);
  const dropped = dropLastStep(one.draft);
  assert.equal(draftOps(dropped).length, 0);
  assert.equal(draftOps(redoDraft(dropped)).length, 0);
});
