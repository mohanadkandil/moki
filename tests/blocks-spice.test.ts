import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSpiceNetlist, runSpiceChecks } from '../src/blocks/spice.js';
import type { BlockDef, BlockPart, BoardPlan } from '../src/blocks/contract.js';

// Explicit synthetic electrical test network, not supplier/hardware acceptance evidence.
const cite = { url: 'https://example.invalid/SYNTHETIC-reference.pdf', pages: '1', note: 'SYNTHETIC profile fixture' };
const pin = (pad: string, role: BlockPart['pins'][string]['role']) => ({ pad, role });
const p = (ref: string, pins: BlockPart['pins'], value?: string): BlockPart => ({ ref, pins, ...(value ? { value, valueWhy: cite } : {}), mpn: `SYNTHETIC-${ref}`, lcsc: `SYNTHETIC-${ref}`, catalogReceipt: `sha256:${'a'.repeat(64)}`, datasheet: cite, pinout: 'verified', at: { x: 0, y: 0 } });
const passive = (ref: string, value: string) => p(ref, { A: pin('1', 'passive'), B: pin('2', 'passive') }, value);
function setup() {
  const block: BlockDef = { schema: 'moki.block/1', id: 'synthetic-spice', version: 1, contentHash: 'a'.repeat(64), title: 'Synthetic SPICE network', summary: 'No real part claims', class: 'synthetic', status: 'unreviewed', provenance: { author: 'agent', authorId: 'SYNTHETIC', reviews: [] },
    parts: [p('J1', { P: pin('1', 'passive'), G: pin('2', 'ground') }), passive('R1', '10k'), passive('C1', '1uF'), passive('R2', '10k'), passive('R3', '10k'), passive('R4', '1k'), passive('R5', '1k'), p('D1', { A: pin('1', 'passive'), K: pin('2', 'passive') })],
    nets: [{ name: 'P', pins: ['J1.P', 'R1.A', 'R2.A', 'R4.A', 'R5.A'] }, { name: 'G', pins: ['J1.G', 'C1.B', 'R3.B', 'R4.B', 'D1.K'] }, { name: 'EN', pins: ['R1.B', 'C1.A'] }, { name: 'DIV', pins: ['R2.B', 'R3.A'] }, { name: 'LED', pins: ['R5.B', 'D1.A'] }],
    ports: [{ id: 'V', label: '3.3V', kind: 'power-out', terminal: 'net:P', volts: { min: 3.3, max: 3.3 } }, { id: 'G', label: 'Ground', kind: 'ground', terminal: 'net:G' }], params: [], power: { sources: [{ port: 'V', volts: 3.3, maxMa: 100, mode: 'external' }], sinks: [] }, constraints: [],
    spiceChecks: [
      { kind: 'rc-reset', name: 'reset', resistor: 'R1', capacitor: 'C1', supplyV: 3.3, thresholdRatio: .75, target: 13.86294, tolerance: .05, citation: cite },
      { kind: 'divider', name: 'divider', upper: 'R2', lower: 'R3', inputV: 3.3, target: 1.65, tolerance: .001, citation: cite },
      { kind: 'resistor-current', name: 'current', resistor: 'R4', voltageV: 3.3, target: 3.3, tolerance: .001, citation: cite },
      { kind: 'led-current', name: 'LED current', resistor: 'R5', supplyV: 3.3, forwardV: 2, target: 1.3, tolerance: .001, citation: cite },
    ] };
  const plan: BoardPlan = { schema: 'moki.plan/1', title: 'Synthetic SPICE', layers: 2, blocks: [{ inst: 'test', block: block.id, version: 1, params: {} }], links: [] };
  block.parts.push(p('U1', { IN: pin('1', 'power-in'), GND: pin('2', 'ground'), BAT: pin('3', 'power-out'), PROG: pin('4', 'input') }), passive('R6', '10k'), passive('C2', '1uF'), passive('C3', '1uF'));
  block.nets[0]!.pins.push('U1.IN', 'C2.A'); block.nets[1]!.pins.push('U1.GND', 'R6.B', 'C2.B', 'C3.B');
  block.nets.push({ name: 'BAT', pins: ['U1.BAT', 'C3.A'] }, { name: 'PROG', pins: ['U1.PROG', 'R6.A'] });
  block.ports.push({ id: 'IN', label: 'Synthetic charger input', kind: 'power-in', terminal: 'net:P', volts: { min: 3.3, max: 3.3 } });
  block.ports.push({ id: 'BAT', label: 'Synthetic battery output', kind: 'power-out', terminal: 'net:BAT', volts: { min: 2.5, max: 2.5 } });
  block.power.sources.push({ port: 'BAT', volts: 2.5, maxMa: 10, continuousMa: 10, inputPort: 'IN', mode: 'charger', conversion: 'linear', dropoutV: .2, thermal: { thetaJa: 100, maxJunctionC: 125, ambientC: 25 } });
  block.constraints.push({ kind: 'battery-path', charger: 'U1', batteryPort: 'BAT', powerPath: 'isolated', citation: cite }, ...(['IN', 'BAT'] as const).map((pin, i) => ({ kind: 'decoupling' as const, ic: 'U1', powerPin: pin, groundPin: 'GND', caps: [`C${i + 2}`], minUf: 1, maxDistanceMm: 2, citation: cite })));
  block.spiceChecks!.push({ kind: 'charge-current', name: 'charger programming', resistor: 'R6', coefficient: 100, target: 10, tolerance: .001, citation: cite });
  return { block: structuredClone(block), plan };
}
function withOpenSwitch() {
  const { block, plan } = setup(); block.spiceChecks = [block.spiceChecks![0]!];
  block.ports.push({ id: 'RESET', label: 'Reset node', kind: 'gpio', terminal: 'net:EN' });
  const button: BlockDef = { ...structuredClone(block), id: 'synthetic-button', parts: [{ ...p('K1', { CONTACT: pin('1', 'passive'), RETURN: pin('2', 'ground') }), switch: 'normally-open' }],
    nets: [{ name: 'EN', pins: ['K1.CONTACT'] }, { name: 'G', pins: ['K1.RETURN'] }],
    ports: [{ id: 'CONTACT', label: 'Contact', kind: 'gpio', terminal: 'net:EN' }, { id: 'G', label: 'Ground', kind: 'ground', terminal: 'net:G' }],
    constraints: [], power: { sources: [], sinks: [] } };
  delete button.spiceChecks;
  plan.blocks.push({ inst: 'button', block: button.id, version: 1, params: {} });
  plan.links.push({ from: 'test.RESET', to: 'button.CONTACT' }, { from: 'test.G', to: 'button.G' });
  return { block, button: structuredClone(button), plan };
}
async function temporary(t: test.TestContext) { const path = await mkdtemp(join(tmpdir(), 'moki-spice-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }

test('fixed numeric templates reject arbitrary directives, invalid quantities and unknown models', () => {
  for (const task of [{ kind: 'model-netlist', values: [] }, { kind: 'divider', values: [0, 100, 3.3] }, { kind: 'rc-reset', values: [1e9, 1, 3.3], threshold: .75 }, { kind: 'rc-reset', values: [10000, .000001, 3.3], threshold: 1 }, { kind: 'resistor-current', values: ['1k\n.include /etc/passwd', 5] }]) assert.throws(() => createSpiceNetlist(task as any));
  const netlist = createSpiceNetlist({ kind: 'charge-current', values: [10000, 1000] });
  assert.match(netlist, /Fmirror/); assert.doesNotMatch(netlist, /\.include|\.control|shell/);
});

test('missing recipes state limited coverage; malformed profiles and network mismatches cannot pass', async t => {
  const artifactDir = await temporary(t);
  const no = setup(); delete no.block.spiceChecks;
  const none = await runSpiceChecks(no.plan, [no.block], { artifactDir }); assert.equal(none.ok, true, JSON.stringify(none)); assert.ok(none.issues.some(i => i.rule === 'spice-coverage'));
  for (const mutate of [
    (b: BlockDef) => { (b.spiceChecks![0] as any).kind = 'unknown-profile'; },
    (b: BlockDef) => { b.spiceChecks![0]!.citation.pages = ''; },
    (b: BlockDef) => { b.parts.find(p => p.ref === 'R1')!.value = '10k\n.end'; },
    (b: BlockDef) => { b.nets[0]!.pins = b.nets[0]!.pins.filter(p => p !== 'R1.A'); b.nets[1]!.pins.push('R1.A'); },
    (b: BlockDef) => { const r = b.spiceChecks![0]!; if (r.kind === 'rc-reset') r.supplyV = 5; },
    (b: BlockDef) => { b.parts.push(passive('R99', '1k')); b.nets[2]!.pins.push('R99.A'); b.nets[1]!.pins.push('R99.B'); },
    (b: BlockDef) => { b.parts.find(p => p.ref === 'D1')!.pins = { K: pin('1', 'passive'), A: pin('2', 'passive') }; b.nets[4]!.pins = ['R5.B', 'D1.K']; b.nets[1]!.pins = b.nets[1]!.pins.filter(p => p !== 'D1.K'); b.nets[1]!.pins.push('D1.A'); },
  ]) {
    const { plan, block } = setup(); mutate(block); const result = await runSpiceChecks(plan, [block], { artifactDir }); assert.equal(result.ok, false, JSON.stringify(result));
  }
  assert.deepEqual(await readdir(artifactDir), []);
});

test('real pinned Bun/ngspice engine measures fixed profiles and rejects actual wrong R against target', { timeout: 20_000 }, async t => {
  const artifactDir = await temporary(t), { plan, block } = setup();
  const result = await runSpiceChecks(plan, [block], { artifactDir, timeoutMs: 9000 });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.measurements!.length, 5);
  assert.deepEqual(result.measurements!.map(m => m.unit), ['ms', 'V', 'mA', 'mA', 'mA']);
  const dir = join(artifactDir, (await readdir(artifactDir))[0]!);
  const raw = JSON.parse(await readFile(join(dir, 'output.json'), 'utf8'));
  assert.equal(raw.engine, '@tscircuit/ngspice-spice-engine@0.0.20'); assert.equal(raw.results.length, 5); assert.ok(raw.results.every((r: any) => r.netlist.includes('.tran') && r.result.simulationResultCircuitJson.length));
  const audit = process.env.MOKI_SPICE_TEST_EVIDENCE_DIR;
  if (audit) {
    await (await import('node:fs/promises')).mkdir(audit, { recursive: true });
    await writeFile(join(audit, 'native-profile-results.json'), JSON.stringify({ note: 'Synthetic integration test, actual pinned engine; not a physical circuit or real part acceptance', result, raw }, null, 2));
  }
  block.parts.find(p => p.ref === 'R1')!.value = '20k'; block.spiceChecks = [block.spiceChecks![0]!];
  const bad = await runSpiceChecks(plan, [block], { artifactDir, timeoutMs: 9000 });
  assert.equal(bad.ok, false); assert.ok(bad.issues.some(i => i.rule === 'spice-target'), JSON.stringify(bad)); assert.ok(bad.measurements![0]!.measured > 27);
  if (audit) await writeFile(join(audit, 'native-wrong-R-result.json'), JSON.stringify({ note: 'Actual R doubled while target unchanged; native simulation must fail', result: bad }, null, 2));
});


test('explicit normally-open switch rejects invalid cross-instance topology, values and undeclared loads', async t => {
  const artifactDir = await temporary(t);
  for (const mutate of [
    (b: BlockDef) => { delete b.parts[0]!.switch; },
    (b: BlockDef) => { b.parts[0]!.value = '10k'; b.parts[0]!.valueWhy = cite; },
    (b: BlockDef) => { b.parts[0]!.pins.RETURN!.role = 'output'; },
    (b: BlockDef) => { b.parts[0]!.pins.EXTRA = pin('3', 'passive'); b.nets[1]!.pins.push('K1.EXTRA'); },
    (b: BlockDef) => { b.parts[0]!.pins.RETURN!.role = 'passive'; b.parts.push(p('J2', { G: pin('1', 'ground') })); b.nets[1]!.pins = ['J2.G']; b.nets.push({ name: 'FLOATING', pins: ['K1.RETURN'] }); },
    (b: BlockDef) => { b.parts[0]!.datasheet.pages = ''; },
  ]) {
    const { block, button, plan } = withOpenSwitch(); mutate(button);
    const result = await runSpiceChecks(plan, [block, button], { artifactDir });
    assert.equal(result.ok, false, JSON.stringify(result));
  }
  assert.deepEqual(await readdir(artifactDir), []);
});

test('native RC correspondence includes only explicit normally-open cross-instance reset switch', { timeout: 12_000 }, async t => {
  const artifactDir = await temporary(t), { block, button, plan } = withOpenSwitch();
  block.parts.find(p=>p.ref==='R1')!.value='10kOhm';
  const result = await runSpiceChecks(plan, [block, button], { artifactDir, timeoutMs: 9000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.issues.some(i => i.rule === 'spice-open-switch' && i.message.includes('button.K1')));
  assert.ok(Math.abs(result.measurements![0]!.measured - 13.86294) < .05);
  const dir = join(artifactDir, (await readdir(artifactDir))[0]!);
  const raw = JSON.parse(await readFile(join(dir, 'output.json'), 'utf8'));
  assert.match(raw.results[0].netlist, /1 explicitly declared normally-open reset switch.*held OPEN/);
  const gateAudit = JSON.parse(await readFile(join(dir, 'gate.json'), 'utf8'));
  assert.deepEqual(gateAudit.checks[0].openSwitches, ['button.K1']);
  const audit = process.env.MOKI_SPICE_TEST_EVIDENCE_DIR;
  if (audit) await writeFile(join(audit, 'native-open-switch-result.json'), JSON.stringify({ note: 'Synthetic cross-instance switch fixture, explicit open-state model and actual native RC waveform', result, raw, checks: gateAudit.checks }, null, 2));
});

test('recipe errors are fixable model failures; missing engine stays infrastructure failure',async t=>{
 const dir=await temporary(t),{block,plan}=setup();
 const malformed=structuredClone(block);malformed.parts.find(p=>p.ref==='R1')!.value='banana';
 const recipe=await runSpiceChecks(plan,[malformed],{artifactDir:dir,bun:'/does-not-exist'});assert.equal(recipe.ok,false);assert.ok(recipe.issues.some(i=>i.rule==='spice-model'));assert.ok(!recipe.issues.some(i=>i.rule==='spice-unavailable'));
 const infra=await runSpiceChecks(plan,[block],{artifactDir:dir,bun:'/does-not-exist'});assert.equal(infra.ok,false);assert.ok(infra.issues.some(i=>i.rule==='spice-unavailable'));
});
