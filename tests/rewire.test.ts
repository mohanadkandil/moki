import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretBrief } from '../src/circuit/interpret.js';
import type { CircuitDesign } from '../src/circuit/model.js';
import { buildDesign } from '../src/circuit/templates.js';
import { compareDesigns } from '../src/rewire/diff.js';

// Fixtures are real template graphs with catalog pin ids, built through the same interpreter.
function design(brief: string): CircuitDesign {
  const result = interpretBrief(brief);
  if (!result.ok) assert.fail(`${brief}: ${result.rejection.message}`);
  return buildDesign(result.interpretation);
}

function comparable(before: CircuitDesign, after: CircuitDesign) {
  const result = compareDesigns(before, after);
  if (!result.comparable) assert.fail(result.reason);
  return result;
}

const pins = (r: ReturnType<typeof comparable>) => r.connections.map(c => [c.kind, `${c.endpoint.part}.${c.endpoint.pin}`, c.net]);

test('moving the LED pin reports one leave and one join, nothing else', () => {
  const result = comparable(design('night lamp, LED on GPIO25'), design('night lamp, LED on GPIO26'));
  assert.deepEqual(pins(result), [['leave', 'U1.GPIO25', 'LED_DRIVE'], ['join', 'U1.GPIO26', 'LED_DRIVE']]);
  assert.deepEqual(result.parts, []);
  assert.deepEqual(result.nets, []);
});

test('swapping the DS18B20 for a BME280 reconnects every pin of the replaced part', () => {
  const result = comparable(design('temperature monitor with a probe and a screen'), design('temperature and humidity monitor with a screen'));
  assert.deepEqual(result.parts.map(p => [p.kind, p.part]).sort(), [['removed', 'R1'], ['replaced', 'U3']]);
  const u3 = pins(result).filter(([, pin]) => String(pin).startsWith('U3.'));
  assert.deepEqual(u3.filter(([k]) => k === 'leave').map(([, p, n]) => `${p}@${n}`).sort(), ['U3.DQ@ONEWIRE', 'U3.GND@GND', 'U3.VDD@+3V3']);
  assert.deepEqual(u3.filter(([k]) => k === 'join').map(([, p, n]) => `${p}@${n}`).sort(), ['U3.GND@GND', 'U3.SCL@I2C_SCL', 'U3.SDA@I2C_SDA', 'U3.VIN@+3V3']);
  assert.ok(pins(result).some(([k, p, n]) => k === 'leave' && p === 'U1.GPIO4' && n === 'ONEWIRE'));
});

test('endpoint order, part order and prose edits do not invent electrical changes', () => {
  const before = design('focus timer with a knob, a screen and a buzzer');
  const after = structuredClone(before);
  after.nets.forEach(n => n.endpoints.reverse()); after.parts.reverse(); after.nets.reverse();
  after.nets[0]!.why = 'Updated explanation.'; after.title = 'A clearer title';
  assert.equal(comparable(before, after).unchanged, true);
});

test('different families cannot produce misleading incremental rework instructions', () => {
  assert.equal(compareDesigns(design('focus timer with a screen'), design('night lamp')).comparable, false);
});

test('a changed supply or analog reading is visible even when the same pins remain connected', () => {
  const before = design('night lamp');
  const after: CircuitDesign = { ...before, nets: before.nets.map(n => n.kind === 'power' ? { ...n, volts: 5 } : n.id === 'LIGHT_SENSE' ? { ...n, analog: false } : n) };
  const result = comparable(before, after);
  assert.equal(result.unchanged, false);
  assert.equal(result.connections.length, 0);
  assert.deepEqual(result.nets.map(n => [n.net, n.before, n.after]).sort(), [
    ['+3V3', 'power, 3.3 V', 'power, 5 V'],
    ['LIGHT_SENSE', 'signal, read as analog', 'signal'],
  ]);
});

test('removing the buzzer reports all its connections leaving without mutating either draft', () => {
  const before = design('focus timer with a knob, a screen and a buzzer');
  const after = design('focus timer with a knob and a screen, no buzzer');
  const original = structuredClone(before);
  const result = comparable(before, after);
  assert.deepEqual(result.parts, [{ kind: 'removed', part: 'BZ1', before: 'piezo-passive-12mm' }]);
  assert.deepEqual(pins(result).map(([k, p]) => `${k} ${p}`).sort(), ['leave BZ1.+', 'leave BZ1.-', 'leave U1.GPIO23']);
  assert.deepEqual(before, original);
});
