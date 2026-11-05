import { CATALOG } from './catalog.js';
import type { CircuitDesign, PinDef } from './model.js';

// Structural checks on the design graph. They prove the graph is internally consistent (every
// reference resolves, supplies match, GPIO capabilities fit the job). They are NOT an electrical
// rule check, a simulation or evidence that hardware works.

export interface GraphIssue {
  code:
    | 'shape' | 'duplicate-part' | 'unknown-module' | 'duplicate-net' | 'dangling-part' | 'dangling-pin'
    | 'pin-reused' | 'net-too-small' | 'required-unconnected' | 'power-source' | 'supply-range'
    | 'ground-mix' | 'power-in-signal' | 'reserved-gpio' | 'gpio-capability' | 'gpio-short' | 'signal-without-gpio'
    | 'source-volts' | 'signal-on-rail' | 'pullup' | 'duplicate-net-name';
  message: string;
  part?: string;
  net?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runtime shape check for designs that arrive from outside the type system (imports, storage). */
export function shapeIssues(value: unknown): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const bad = (message: string) => issues.push({ code: 'shape', message });
  if (!isRecord(value)) { bad('Design is not an object.'); return issues; }
  const optional = (v: unknown, type: 'string' | 'boolean') => v === undefined || typeof v === type;
  if (value.schema !== 'moki.circuit-preview/1') bad('Unknown design schema.');
  if (!['focus-timer', 'light-lamp', 'temp-monitor'].includes(String(value.template))) bad('Unknown template.');
  if (typeof value.title !== 'string') bad('title must be text.');
  if (!Array.isArray(value.parts)) bad('parts must be an array.');
  else value.parts.forEach((p, i) => { if (!isRecord(p) || typeof p.id !== 'string' || !p.id || typeof p.module !== 'string' || typeof p.role !== 'string' || !optional(p.value, 'string')) bad(`parts[${i}] is malformed.`); });
  if (!Array.isArray(value.nets)) bad('nets must be an array.');
  else value.nets.forEach((n, i) => {
    if (!isRecord(n) || typeof n.id !== 'string' || !n.id || typeof n.name !== 'string' || !['power', 'ground', 'signal'].includes(String(n.kind)) || typeof n.why !== 'string' || !Array.isArray(n.endpoints)) { bad(`nets[${i}] is malformed.`); return; }
    if (n.volts !== undefined && (typeof n.volts !== 'number' || !Number.isFinite(n.volts))) bad(`nets[${i}].volts must be a number.`);
    if (!optional(n.analog, 'boolean')) bad(`nets[${i}].analog must be true or false.`);
    n.endpoints.forEach((e, j) => { if (!isRecord(e) || typeof e.part !== 'string' || typeof e.pin !== 'string') bad(`nets[${i}].endpoints[${j}] is malformed.`); });
  });
  if (!Array.isArray(value.notes)) bad('notes must be an array.');
  else value.notes.forEach((n, i) => { if (!isRecord(n) || !['warning', 'info'].includes(String(n.level)) || typeof n.text !== 'string' || !optional(n.part, 'string') || !optional(n.net, 'string')) bad(`notes[${i}] is malformed.`); });
  if (!Array.isArray(value.behavior)) bad('behavior must be an array.');
  else value.behavior.forEach((b, i) => { if (!isRecord(b) || typeof b.label !== 'string' || typeof b.value !== 'string') bad(`behavior[${i}] is malformed.`); });
  if (value.requirements !== undefined && !Array.isArray(value.requirements)) bad('requirements must be a list.');
  if (value.app !== undefined && (!isRecord(value.app) || typeof value.app.source !== 'string' || typeof value.app.brief !== 'string')) bad('app needs its source and brief as text.');
  return issues;
}

export function checkDesign(value: unknown): GraphIssue[] {
  const shape = shapeIssues(value);
  if (shape.length) return shape;
  const design = value as CircuitDesign;
  const issues: GraphIssue[] = [];
  const parts = new Map<string, { module: string; pins: readonly PinDef[]; supply?: { min: number; max: number }; provides?: number }>();
  for (const part of design.parts) {
    if (parts.has(part.id)) { issues.push({ code: 'duplicate-part', message: `Part ID ${part.id} is used twice.`, part: part.id }); continue; }
    const def = CATALOG.get(part.module);
    if (!def) { issues.push({ code: 'unknown-module', message: `${part.id} uses unknown module ${part.module}.`, part: part.id }); continue; }
    parts.set(part.id, { module: def.id, pins: def.pins, ...(def.supply ? { supply: def.supply } : {}), ...(def.provides !== undefined ? { provides: def.provides } : {}) });
  }

  const netIds = new Set<string>();
  const netNames = new Set<string>();
  const used = new Map<string, string>();
  for (const net of design.nets) {
    if (netIds.has(net.id)) issues.push({ code: 'duplicate-net', message: `Net ${net.id} is declared twice.`, net: net.id });
    netIds.add(net.id);
    if (netNames.has(net.name)) issues.push({ code: 'duplicate-net-name', message: `Two nets are named ${net.name}.`, net: net.id });
    netNames.add(net.name);
    if (net.endpoints.length < 2) issues.push({ code: 'net-too-small', message: `${net.name} connects fewer than two pins.`, net: net.id });
    const resolved: PinDef[] = [];
    for (const end of net.endpoints) {
      const part = parts.get(end.part);
      if (!part) { issues.push({ code: 'dangling-part', message: `${net.name} references missing part ${end.part}.`, net: net.id, part: end.part }); continue; }
      const pin = part.pins.find(p => p.id === end.pin);
      if (!pin) { issues.push({ code: 'dangling-pin', message: `${net.name} references ${end.part}.${end.pin}, which that module does not have.`, net: net.id, part: end.part }); continue; }
      const key = `${end.part}.${end.pin}`;
      const other = used.get(key);
      if (other) issues.push({ code: 'pin-reused', message: `${key} is on both ${other} and ${net.name}.`, net: net.id, part: end.part });
      used.set(key, net.name);
      resolved.push(pin);

      if (pin.kind === 'power-in' && net.kind === 'power') {
        if (part.supply && (net.volts === undefined || net.volts < part.supply.min || net.volts > part.supply.max)) {
          issues.push({ code: 'supply-range', message: `${end.part} needs ${part.supply.min}–${part.supply.max} V but ${net.name} is ${net.volts ?? 'unspecified'} V.`, net: net.id, part: end.part });
        }
      }
      if (net.kind === 'ground' && pin.kind !== 'ground' && pin.kind !== 'passive') issues.push({ code: 'ground-mix', message: `${key} (${pin.kind}) is on the ground net.`, net: net.id, part: end.part });
      if (net.kind !== 'ground' && pin.kind === 'ground') issues.push({ code: 'ground-mix', message: `Ground pin ${key} is on ${net.name}.`, net: net.id, part: end.part });
      if (net.kind === 'power' && (pin.kind === 'gpio' || pin.kind === 'signal')) issues.push({ code: 'signal-on-rail', message: `Signal pin ${key} is tied to the ${net.name} supply.`, net: net.id, part: end.part });
      if (pin.kind === 'power-out' && net.kind === 'power' && part.provides !== net.volts) issues.push({ code: 'source-volts', message: `${net.name} is labelled ${net.volts ?? 'unspecified'} V but its source ${key} provides ${part.provides ?? 'unknown'} V.`, net: net.id, part: end.part });
      if (net.kind === 'signal' && (pin.kind === 'power-in' || pin.kind === 'power-out')) issues.push({ code: 'power-in-signal', message: `Power pin ${key} is on signal net ${net.name}.`, net: net.id, part: end.part });
      if (pin.kind === 'gpio' && pin.gpio?.reserved) issues.push({ code: 'reserved-gpio', message: `${key} is a ${pin.gpio.reserved} pin and should not be used.`, net: net.id, part: end.part });
    }

    if (net.kind === 'power') {
      const sources = resolved.filter(p => p.kind === 'power-out').length;
      if (sources !== 1) issues.push({ code: 'power-source', message: `${net.name} has ${sources} supplies; it needs exactly one.`, net: net.id });
    }
    if (net.kind === 'signal') {
      const gpios = resolved.filter(p => p.kind === 'gpio');
      const signals = resolved.filter(p => p.kind === 'signal');
      if (gpios.length > 1) issues.push({ code: 'gpio-short', message: `${net.name} ties ${gpios.length} GPIO pins together.`, net: net.id });
      if (signals.length && !gpios.length) issues.push({ code: 'signal-without-gpio', message: `${net.name} has peripheral signals but no ESP32 pin.`, net: net.id });
      const g = gpios[0]?.gpio;
      const needsDrive = signals.some(s => s.need === 'drive' || s.need === 'bidirectional') || resolved.some(p => p.kind === 'passive');
      if (g) {
        if (net.analog) {
          if (!g.adc1) issues.push({ code: 'gpio-capability', message: `GPIO${g.gpio} has no ADC1 channel to read ${net.name}.`, net: net.id });
        } else if (needsDrive && !g.output) {
          issues.push({ code: 'gpio-capability', message: `GPIO${g.gpio} is input-only but ${net.name} needs it to drive the line.`, net: net.id });
        }
        if (signals.some(s => s.needsPullup) && !g.pullup) issues.push({ code: 'pullup', message: `GPIO${g.gpio} has no internal pull-up, which ${net.name} relies on.`, net: net.id });
      }
    }
  }

  for (const [id, part] of parts) {
    for (const pin of part.pins) {
      if (pin.required && !used.has(`${id}.${pin.id}`)) issues.push({ code: 'required-unconnected', message: `${id}.${pin.label} is not connected.`, part: id });
    }
  }
  return issues;
}
