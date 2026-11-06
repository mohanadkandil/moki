// The edit operations the canvas and the Editor share. Pure: no model, no server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { BoardPlan } from '../src/blocks/contract.js';
import { planGraph } from '../src/blocks/graph.js';
import { realChipLibrary, sheetGraph } from '../src/agents/chip-library.js';
import { applyDesignOps, applyPlanOps, parseOps, type DesignOp } from '../src/agents/edits.js';
import { applyChange } from '../src/agents/roles.js';
import { generateBoardSource } from '../src/board/codegen.js';
import { interpretBrief } from '../src/circuit/interpret.js';
import { buildDesign } from '../src/circuit/templates.js';

const read = interpretBrief('A temperature monitor with a probe and a screen');
assert.ok(read.ok);
const design = buildDesign(read.interpretation);
const apply = (...ops: DesignOp[]) => applyDesignOps(design, ops);
const plan = (): BoardPlan => ({ schema: 'moki.plan/1', title: 'x', layers: 2,
  blocks: [{ inst: 'core', block: 'mcu', version: 1, params: {} }, { inst: 'air', block: 'sht40', version: 1, params: {} }],
  links: [{ from: 'core.I2C', to: 'air.I2C' }],
  sections: [{ id: 'a', title: 'MCU', purpose: 'p', insts: ['core'], notes: ['one'] }, { id: 'b', title: 'Air', purpose: 'p', insts: ['air'], notes: ['two'] }] });

describe('parsing', () => {
  it('accepts every op in the contract', () => {
    const ops = [{ op: 'rename_net', net: 'a', name: 'SENSE' }, { op: 'set_value', part: 'R1', value: '10 kΩ' }, { op: 'add_note', text: 'A note', part: 'R1' }, { op: 'remove_note', text: 'A note' }, { op: 'add_block', inst: 'x', block: 'b', version: 2, params: { n: 1 }, section: 's' }, { op: 'remove_block', inst: 'x' }, { op: 'link', from: 'a.P', to: 'b.Q' }, { op: 'unlink', from: 'a.P', to: 'b.Q' }];
    const parsed = parseOps(ops);
    assert.ok('ops' in parsed);
    assert.deepEqual(parsed.ops, ops);
  });
  for (const [name, op] of [
    ['a net name with a newline', { op: 'rename_net', net: 'a', name: 'x\ny' }],
    ['a value too long', { op: 'set_value', part: 'R1', value: 'x'.repeat(41) }],
    ['an empty note', { op: 'add_note', text: '' }],
    ['a block with a bad name', { op: 'add_block', inst: '../x', block: 'b' }],
    ['params holding an object', { op: 'add_block', inst: 'x', block: 'b', params: { a: {} } }],
    ['a link with no port', { op: 'link', from: 'a', to: 'b.Q' }],
    ['an unknown op', { op: 'run_code', code: 'x' }],
  ] as const) it(`refuses ${name}`, () => assert.ok('error' in parseOps([op])));
  it('caps what an agent can change at once, and lets a person\'s longer draft through', () => {
    const many = Array.from({ length: 13 }, () => ({ op: 'remove_note', text: 'x' }));
    assert.ok('error' in parseOps(many));
    assert.ok('ops' in parseOps(many, 40));
  });
});

describe('carrier designs', () => {
  const net = design.nets.find(n => n.kind === 'signal')!;
  const resistor = design.parts.find(p => p.module.startsWith('resistor'))!;
  it('renames a net, and refuses a name already taken', () => {
    const out = apply({ op: 'rename_net', net: net.name, name: 'SENSE' });
    assert.ok('design' in out);
    assert.equal(out.design.nets.find(n => n.id === net.id)!.name, 'SENSE');
    assert.match((apply({ op: 'rename_net', net: net.name, name: 'GND' }) as { error: string }).error, /already/);
    assert.ok('error' in apply({ op: 'rename_net', net: 'nope', name: 'X' }));
  });
  it('sets a value', () => {
    const out = apply({ op: 'set_value', part: resistor.id, value: '10 kΩ' });
    assert.ok('design' in out);
    assert.equal(out.design.parts.find(p => p.id === resistor.id)!.value, '10 kΩ');
    assert.ok('error' in apply({ op: 'set_value', part: 'nope', value: '1' }));
  });
  it('adds and removes notes', () => {
    const added = apply({ op: 'add_note', text: 'Keep this short', part: resistor.id });
    assert.ok('design' in added);
    assert.ok(added.design.notes.some(n => n.text === 'Keep this short' && n.part === resistor.id));
    const gone = applyDesignOps(added.design, [{ op: 'remove_note', text: 'Keep this short' }]);
    assert.ok('design' in gone);
    assert.equal(gone.design.notes.length, design.notes.length);
    assert.ok('error' in apply({ op: 'remove_note', text: 'Not there' }));
    assert.ok('error' in apply({ op: 'add_note', text: 'x y', part: 'nope' }));
  });
  it('refuses block ops in one plain sentence', () => {
    for (const op of [{ op: 'add_block', inst: 'x', block: 'b' }, { op: 'remove_block', inst: 'x' }, { op: 'link', from: 'a.B', to: 'c.D' }, { op: 'unlink', from: 'a.B', to: 'c.D' }] as DesignOp[]) assert.match((apply(op) as { error: string }).error, /built from modules/);
  });
  it('never changes the design it was given, and a renamed net still builds', () => {
    const before = JSON.stringify(design);
    const out = apply({ op: 'rename_net', net: net.name, name: 'SENSE' }, { op: 'set_value', part: resistor.id, value: '10 kΩ' });
    assert.equal(JSON.stringify(design), before);
    assert.ok('design' in out);
    assert.match(generateBoardSource(out.design), /SENSE/);
  });
  it('goes through the validators in the Editor', () => {
    assert.match((applyChange(design, { ops: [{ op: 'add_note', text: 'This board works.' }] }) as { error: string }).error, /claim/);
    assert.ok('design' in applyChange(design, { ops: [{ op: 'add_note', text: 'Keep the probe lead short.' }] }));
  });
});

describe('chip-level plans', () => {
  const on = (...ops: DesignOp[]) => applyPlanOps(plan(), ops);
  it('adds a block to a section, or gives it its own', () => {
    const inSection = on({ op: 'add_block', inst: 'x', block: 'b', section: 'b' });
    assert.ok('plan' in inSection);
    assert.ok(inSection.plan.sections![1]!.insts.includes('x'));
    const alone = on({ op: 'add_block', inst: 'x', block: 'b', params: { n: 1 } });
    assert.ok('plan' in alone);
    assert.deepEqual(alone.plan.sections!.at(-1)!.insts, ['x']);
    assert.ok('error' in on({ op: 'add_block', inst: 'core', block: 'b' }));
    assert.ok('error' in on({ op: 'add_block', inst: 'x', block: 'b', section: 'nope' }));
  });
  it('removes a block with its links and an emptied section', () => {
    const out = on({ op: 'remove_block', inst: 'air' });
    assert.ok('plan' in out);
    assert.equal(out.plan.links.length, 0);
    assert.equal(out.plan.sections!.length, 1);
    assert.ok('error' in on({ op: 'remove_block', inst: 'nope' }));
  });
  it('links and unlinks either way round', () => {
    assert.ok('error' in on({ op: 'link', from: 'air.I2C', to: 'core.I2C' }));
    const out = on({ op: 'unlink', from: 'air.I2C', to: 'core.I2C' });
    assert.ok('plan' in out);
    assert.equal(out.plan.links.length, 0);
    assert.ok('error' in on({ op: 'unlink', from: 'a.B', to: 'c.D' }));
  });
  it('sets a block param and keeps numbers as numbers', () => {
    const out = on({ op: 'set_value', part: 'air.rate', value: '2' }, { op: 'set_value', part: 'air.mode', value: 'fast' });
    assert.ok('plan' in out);
    assert.deepEqual(out.plan.blocks[1]!.params, { rate: 2, mode: 'fast' });
    assert.ok('error' in on({ op: 'set_value', part: 'R1', value: '2' }));
  });
  it('adds and removes section notes', () => {
    const out = on({ op: 'add_note', text: 'New', section: 'a' }, { op: 'remove_note', text: 'one' });
    assert.ok('plan' in out);
    assert.deepEqual(out.plan.sections![0]!.notes, ['New']);
    assert.match((on({ op: 'add_note', text: 'x' }) as { error: string }).error, /section/);
  });
  it('refuses part-level ops in plain words', () => {
    for (const [op, words] of [[{ op: 'add_part', id: 'x', module: 'm', role: 'r' }, /Add a block/], [{ op: 'remove_part', id: 'R1' }, /belongs to a block/], [{ op: 'connect', net: 'n', endpoints: [] }, /Link them/], [{ op: 'rename_net', net: 'n', name: 'm' }, /come from its blocks/]] as const) assert.match((on(op as DesignOp) as { error: string }).error, words);
  });
  it('never changes the plan it was given', () => {
    const start = plan(), before = JSON.stringify(start);
    applyPlanOps(start, [{ op: 'remove_block', inst: 'air' }]);
    assert.equal(JSON.stringify(start), before);
  });
});

it('keeps edits.ts free of server code, because the web bundle imports it', () => {
  const imports = [...readFileSync('src/agents/edits.ts', 'utf8').matchAll(/^import (type )?.* from '([^']+)'/gm)].map(m => [Boolean(m[1]), m[2]]);
  for (const [typeOnly, from] of imports) assert.ok(typeOnly || from === '../circuit/catalog.js', String(from));
});

describe('the drawing sent to the canvas', () => {
  it('has the contract\'s shape, from a real block', async () => {
    const blocks = await realChipLibrary().blocks();
    const block = blocks.find(b => b.parts.length > 1)!;
    const drawing = sheetGraph(planGraph({ schema: 'moki.plan/1', title: 'x', layers: 2, blocks: [{ inst: 'one', block: block.id, version: block.version, params: {} }], links: [] }, blocks));
    assert.equal(drawing.parts.length, block.parts.length);
    const part = drawing.parts[0]!;
    assert.deepEqual(Object.keys(part).filter(k => !['value'].includes(k)).sort(), ['inst', 'mpn', 'pins', 'ref', 'title']);
    assert.equal(part.inst, 'one');
    assert.equal(part.title, block.title);
    assert.deepEqual(Object.keys(part.pins[0]!).sort(), ['id', 'label', 'role']);
    const names = new Map(drawing.parts.map(p => [p.ref, new Set(p.pins.map(pin => pin.id))]));
    assert.ok(drawing.nets.length > 0);
    for (const net of drawing.nets) for (const pin of net.pins) {
      assert.deepEqual(Object.keys(pin).sort(), ['pin', 'ref']);
      assert.ok(names.get(pin.ref)?.has(pin.pin), `${pin.ref}.${pin.pin} is on the sheet`);
    }
  });
});
