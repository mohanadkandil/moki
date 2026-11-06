import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { boardMetadata, generateBoardSource } from '../src/board/codegen.js';
import { footprintFor } from '../src/board/catalog-footprints.js';
import { compactBoard, drawnBody } from '../src/board/compact.js';
import { MODULE_MECH } from '../eda/enclosure/module-mech.js';
import { applyMakerEdits, layoutForDesign, validateLayout } from '../src/board/edits.js';
import { MODULE, moduleDef } from '../src/circuit/catalog.js';
import type { CircuitDesign, PartInstance, SensorChoice, TemplateId } from '../src/circuit/model.js';
import { buildDesign } from '../src/circuit/templates.js';

const template = (id: TemplateId, sensor: SensorChoice = 'ds18b20') => buildDesign({ template: id, chosenBy: 'user', recognized: [], notes: [], options: { buzzer: true, display: true, sensor, pins: {} } });
const reaction = JSON.parse(readFileSync(new URL('./agent-fixtures/reaction-game-design.json', import.meta.url), 'utf8')) as CircuitDesign;
const withParts = (parts: Array<[string, string]>): CircuitDesign => ({ ...reaction, parts: parts.map(([id, module]): PartInstance => ({ id, module, role: id })), nets: [], notes: [], behavior: [] });

const designs: Record<string, CircuitDesign> = {
  'focus timer': template('focus-timer'), 'light lamp': template('light-lamp'), 'temperature, DS18B20': template('temp-monitor'), 'temperature, BME280': template('temp-monitor', 'bme280'), 'reaction game': reaction,
  'every kind of module at once': withParts([['U1', MODULE.esp32], ['U2', MODULE.oled], ['SW1', MODULE.encoder], ['U3', MODULE.bme280], ['BZ1', MODULE.piezo], ['D1', MODULE.led], ['R1', MODULE.resistor], ['R2', MODULE.resistor], ['LDR1', MODULE.ldr], ['U4', MODULE.ds18b20]]),
  'a controller alone': withParts([['U1', MODULE.esp32]]),
};
// Each board before this pass, measured from a real build. Reported, and held to.
const BEFORE: Record<string, number> = { 'focus timer': 90 * 100, 'light lamp': 90 * 105, 'temperature, DS18B20': 75 * 75, 'temperature, BME280': 75 * 75, 'reaction game': 90 * 100 };

describe('a compact carrier', () => {
  for (const [name, design] of Object.entries(designs)) {
    describe(name, () => {
      const board = boardMetadata(design);
      const body = (p: typeof board.parts[number]) => { const b = drawnBody(p.module); return { left: p.x + b.x - b.w / 2, right: p.x + b.x + b.w / 2, bottom: p.y + b.y - b.h / 2, top: p.y + b.y + b.h / 2 }; };
      it('passes every rule a hand-edited board has to pass', () => validateLayout(layoutForDesign(design)));
      it('keeps the USB exactly on the bottom edge', () => {
        const u1 = board.parts.find(p => moduleDef(p.module).category === 'controller')!;
        assert.ok(Math.abs(u1.y - moduleDef(u1.module).size.h / 2 + board.heightMm / 2) < 0.002, `${u1.y}`);
      });
      it('keeps every body inside the outline and 2 mm clear of its edge, which is what the lid\'s lip needs', () => {
        for (const p of board.parts) {
          const b = body(p);
          assert.ok(b.left >= -board.widthMm / 2 + 2 - 1e-6 && b.right <= board.widthMm / 2 - 2 + 1e-6 && b.top <= board.heightMm / 2 - 2 + 1e-6, p.id);
        }
      });
      it('keeps every body off the lid pillars, and leaves the holes in the corners', () => {
        assert.equal(board.mountingHoles.length, 4);
        for (const h of board.mountingHoles) {
          assert.equal(Math.abs(h.x), board.widthMm / 2 - 4); assert.equal(Math.abs(h.y), board.heightMm / 2 - 4);
          for (const p of board.parts) {
            const b = body(p);
            assert.ok(h.x <= b.left - 3.3 + 1e-6 || h.x >= b.right + 3.3 - 1e-6 || h.y <= b.bottom - 3.3 + 1e-6 || h.y >= b.top + 3.3 - 1e-6, `${p.id} under the pillar at ${h.x},${h.y}`);
          }
        }
      });
      it('leaves bodies clear of each other', () => {
        for (const [i, a] of board.parts.entries()) for (const c of board.parts.slice(i + 1)) {
          const p = body(a), q = body(c);
          assert.ok(p.right + 1.5 <= q.left + 1e-6 || q.right + 1.5 <= p.left + 1e-6 || p.top + 1.5 <= q.bottom + 1e-6 || q.top + 1.5 <= p.bottom + 1e-6, `${a.id} and ${c.id}`);
        }
      });
      it('is the same board every time, however the design lists its parts', () => {
        assert.deepEqual(boardMetadata(design), boardMetadata(structuredClone(design)));
        assert.deepEqual(boardMetadata({ ...design, parts: [...design.parts].reverse() }), board);
        if (design.nets.length) assert.equal(generateBoardSource({ ...design, parts: [...design.parts].reverse() }), generateBoardSource(design));
      });
      if (BEFORE[name]) it('is at least a fifth smaller than it was', () => {
        const area = board.widthMm * board.heightMm;
        assert.ok(area <= BEFORE[name]! * 0.8, `${board.widthMm} x ${board.heightMm} = ${area}, was ${BEFORE[name]}`);
      });
      it('is a board, not a strip', () => assert.ok(Math.max(board.widthMm, board.heightMm) / Math.min(board.widthMm, board.heightMm) <= 1.6, `${board.widthMm} x ${board.heightMm}`));
    });
  }
  it('searches quickly enough to run on the server\'s main thread, even at the 12-part limit', () => {
    const parts = [['U1', MODULE.esp32], ['U2', MODULE.oled], ['SW1', MODULE.encoder], ['U3', MODULE.bme280], ['BZ1', MODULE.piezo], ['D1', MODULE.led], ['D2', MODULE.led], ['R1', MODULE.resistor], ['R2', MODULE.resistor], ['R3', MODULE.resistor], ['R4', MODULE.resistor], ['R5', MODULE.resistor]] as const;
    const nets = reaction.nets.map(n => ({ kind: n.kind, endpoints: n.endpoints }));
    const started = performance.now();
    compactBoard(parts.map(([id, module]) => ({ id, module })), nets);
    // Generous for a shared host. It took 20 s when each candidate rebuilt its pin tables, and takes well under 1 s now.
    assert.ok(performance.now() - started < 5000, `${Math.round(performance.now() - started)} ms`);
  });
  it('moves the USB to any edge of a bigger board, sliding clear of whatever\'s there', () => {
    for (const name of ['focus timer', 'temperature, DS18B20', 'reaction game']) for (const usbEdge of ['left', 'right', 'top', 'bottom'] as const) {
      const { layout } = applyMakerEdits(layoutForDesign(designs[name]!), { board: { widthMm: 140, heightMm: 140, cornerRadiusMm: 3 }, usbEdge });
      assert.equal(layout.usbEdge, usbEdge, name);
    }
  });
  it('still refuses a USB edge when no spot along it is clear', () => {
    assert.throws(() => applyMakerEdits(layoutForDesign(designs['reaction game']!), { usbEdge: 'left' }), /overlaps|outside|obstructs/);
  });
  it('keeps the screen above the knob, so a hand on the knob doesn\'t cover it', () => {
    for (const name of ['focus timer', 'reaction game', 'every kind of module at once']) {
      const parts = boardMetadata(designs[name]!).parts;
      assert.ok(parts.find(p => p.module === MODULE.oled)!.y > parts.find(p => p.module === MODULE.encoder)!.y, name);
    }
  });
  it('leaves the viewing funnel room beside the screen, at the walls and at its neighbours', () => {
    for (const name of ['focus timer', 'reaction game', 'temperature, DS18B20']) {
      const board = boardMetadata(designs[name]!);
      const screen = board.parts.find(p => p.module === MODULE.oled)!;
      const left = screen.x - screen.widthMm / 2, right = screen.x + screen.widthMm / 2;
      assert.ok(left - 3.5 >= -board.widthMm / 2 - 1e-6 && right + 3.5 <= board.widthMm / 2 + 1e-6, name);
      for (const other of board.parts.filter(p => p !== screen)) {
        const b = drawnBody(other.module), near = other.y + b.y + b.h / 2 > screen.y - screen.heightMm / 2 && other.y + b.y - b.h / 2 < screen.y + screen.heightMm / 2;
        if (near) assert.ok(other.x + b.x + b.w / 2 + 3.5 <= left + 1e-6 || other.x + b.x - b.w / 2 - 3.5 >= right - 1e-6, `${name}: ${other.id}`);
      }
    }
  });
  it('keeps every lid opening clear of the screen\'s funnel at its widest, so the viewing angle holds', () => {
    // The case's own test at slope 0.7: the window, 4.27 mm wider per side at the lid, against each opening plus 1 mm.
    for (const [name, design] of Object.entries(designs)) {
      const board = boardMetadata(design);
      for (const screen of board.parts.filter(p => p.module === MODULE.oled)) {
        const funnel = { left: screen.x - 12.05 - 4.27, right: screen.x + 12.05 + 4.27, bottom: screen.y + 1.3 - 6.65 - 4.27, top: screen.y + 1.3 + 6.65 + 4.27 };
        for (const other of board.parts.filter(p => p !== screen)) {
          const mech = MODULE_MECH[other.module]!, def = moduleDef(other.module), body = drawnBody(other.module), leaded = Boolean(mech.bodyMm);
          for (const a of mech.apertures(def.size.w, def.size.h, mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm).filter(a => a.surface === 'lid')) {
            const pads = footprintFor(other.module).pins, padX = pads.reduce((s, p) => s + p.x, 0) / pads.length, padY = pads.reduce((s, p) => s + p.y, 0) / pads.length;
            const x = other.x + (leaded ? padX + a.x : a.x - def.size.w / 2), y = other.y + (leaded ? padY - a.y : def.size.h / 2 - a.y);
            const half = a.widthMm / 2 + 1, halfY = a.heightMm / 2 + 1;
            assert.ok(x + half <= funnel.left || x - half >= funnel.right || y + halfY <= funnel.bottom || y - halfY >= funnel.top, `${name}: ${other.id} (body ${body.w} mm) reaches the funnel`);
          }
        }
      }
    }
  });
  it('keeps a temperature sensor 6 mm from the warm ESP32, and the LED well away from the light sensor', () => {
    const temp = boardMetadata(designs['temperature, DS18B20']!).parts;
    const u1 = temp.find(p => p.id === 'U1')!, sensor = temp.find(p => p.module === MODULE.ds18b20)!;
    const uB = { x: u1.x, y: u1.y, w: u1.widthMm, h: u1.heightMm }, sB = drawnBody(sensor.module);
    assert.ok(Math.abs(uB.x - (sensor.x + sB.x)) - (uB.w + sB.w) / 2 >= 6 - 1e-6 || Math.abs(uB.y - (sensor.y + sB.y)) - (uB.h + sB.h) / 2 >= 6 - 1e-6);
    const lamp = boardMetadata(designs['light lamp']!).parts;
    const led = lamp.find(p => p.module === MODULE.led)!, ldr = lamp.find(p => p.module === MODULE.ldr)!;
    const at = (p: typeof led) => { const b = drawnBody(p.module); return { x: p.x + b.x, y: p.y + b.y }; };
    assert.ok(Math.hypot(at(led).x - at(ldr).x, at(led).y - at(ldr).y) >= 15);
  });
  it('draws a leaded part where the case and the 3D model put it, on its pads', () => {
    const b = drawnBody(MODULE.led);
    assert.deepEqual([b.w, b.h], [5.8, 5.8]);
    assert.equal(b.y, -6.5);
    const source = generateBoardSource(reaction);
    assert.match(source, /silkscreenrect pcbX=\{0\} pcbY=\{-6\.5\} width=\{5} height=\{5}/);
  });
  it('prints the board\'s identity clear of every part', () => {
    for (const [name, design] of Object.entries(designs).filter(([, d]) => d.nets.length)) {
      const match = /text=\{"(CARRIER [^"]+)"\} pcbX=\{(-?[\d.]+)\} pcbY=\{(-?[\d.]+)\}/.exec(generateBoardSource(design));
      assert.ok(match, name);
      const board = boardMetadata(design);
      assert.ok(Math.abs(Number(match[2])) < board.widthMm / 2 && Math.abs(Number(match[3])) < board.heightMm / 2, name);
    }
  });
});
