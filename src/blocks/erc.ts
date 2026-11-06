import type { BlockDef, BlockDraft, BoardPlan, CatalogPart, Constraint, GateResult, PinMap, Port, SpiceCheck, Requirement } from './contract.js';
import { netNameIssues } from './graph.js';

type Issue = GateResult['issues'][number];
type Findings = { erc: Issue[]; power: Issue[] };
const issue = (f: Findings, rule: string, message: string, where?: string, gate: 'erc' | 'power' = 'erc', severity: Issue['severity'] = 'error') => f[gate].push({ rule, severity, ...(where ? { where } : {}), message });
const gates = (f: Findings): GateResult[] => (['erc', 'power'] as const).map(gate => ({ gate, ok: !f[gate].some(i => i.severity === 'error'), issues: f[gate] }));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const positive = (n: number) => finite(n) && n > 0;
const sha = (s: string) => /^[a-f0-9]{64}$/i.test(s);
const receipt = (s: string) => /^sha256:[a-f0-9]{64}$/i.test(s);
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

type Shape = 'string' | 'number' | 'boolean' | { enum: readonly unknown[] } | { array: Shape } | { record: Shape } | { fields: Record<string, Shape>; optional?: string[] } | { union: Shape[] } | { variants: Record<string, Shape>; key: string };
const obj = (fields: Record<string, Shape>, optional: string[] = []): Shape => ({ fields, optional });
const arr = (array: Shape): Shape => ({ array });
const en = (...values: unknown[]): Shape => ({ enum: values });
const record = (shape: Shape): Shape => ({ record: shape });
const value: Shape = { union: ['number', 'string'] };
const citation = obj({ url: 'string', sha256: 'string', pages: 'string', note: 'string' }, ['sha256', 'pages', 'note']);
const volts = obj({ min: 'number', max: 'number' });
const pose = obj({ x: 'number', y: 'number', rotation: 'number' }, ['rotation']);
const bus = obj({ protocol: 'string', role: en('controller', 'peripheral', 'passive'), signals: record('string'), i2cAddresses: arr('number') }, ['i2cAddresses']);
const port = obj({ id: 'string', label: 'string', kind: en('power-in', 'power-out', 'ground', 'bus', 'gpio', 'analog'), terminal: 'string', volts, fixedFunction: 'string', bus }, ['terminal', 'volts', 'fixedFunction', 'bus']);
const source = obj({ port: 'string', volts: 'number', maxMa: 'number', continuousMa: 'number', inputPort: 'string', efficiency: 'number', mode: en('regulated', 'external', 'charger'), conversion: en('linear', 'switching'), dropoutV: 'number', maxDissipationW: 'number', thermal: obj({ thetaJa: 'number', maxJunctionC: 'number', ambientC: 'number' }) }, ['continuousMa', 'inputPort', 'efficiency', 'mode', 'conversion', 'dropoutV', 'maxDissipationW', 'thermal']);
const constraintShapes: Record<Constraint['kind'], Shape> = {
  decoupling: obj({ kind: en('decoupling'), ic: 'string', powerPin: 'string', groundPin: 'string', caps: arr('string'), minUf: 'number', maxDistanceMm: 'number', citation }),
  pullup: obj({ kind: en('pullup'), pin: 'string', to: 'string', resistor: 'string', ohms: 'number', citation }),
  strap: obj({ kind: en('strap'), pin: 'string', safe: en('high', 'low', 'floating'), resistor: 'string', to: 'string', citation }, ['resistor', 'to']),
  'usb-c-sink': obj({ kind: en('usb-c-sink'), connector: 'string', cc1: 'string', cc2: 'string', resistors: arr('string'), ohms: 'number', citation }),
  'battery-path': obj({ kind: en('battery-path'), charger: 'string', batteryPort: 'string', systemPort: 'string', powerPath: en('isolated', 'load-sharing', 'integrated'), citation }, ['systemPort']),
  keepout: obj({ kind: en('keepout'), x: 'number', y: 'number', width: 'number', height: 'number', layers: arr('string'), purpose: 'string', excludeParts: arr('string'), citation }, ['excludeParts']),
  edge: obj({ kind: en('edge'), part: 'string', edge: en('left', 'right', 'top', 'bottom'), overhangMm: 'number', citation }, ['overhangMm']),
  ground: obj({ kind: en('ground'), pin: 'string', citation }),
};
const spiceCommon: Record<string, Shape> = { name: 'string', target: 'number', tolerance: 'number', citation };
const spiceShapes: Record<SpiceCheck['kind'], Shape> = {
  'rc-reset': obj({ ...spiceCommon, kind: en('rc-reset'), resistor: 'string', capacitor: 'string', supplyV: 'number', thresholdRatio: 'number' }),
  divider: obj({ ...spiceCommon, kind: en('divider'), upper: 'string', lower: 'string', inputV: 'number', upperOhm: 'number', lowerOhm: 'number', series: 'string' }, ['upperOhm', 'lowerOhm', 'series']),
  'resistor-current': obj({ ...spiceCommon, kind: en('resistor-current'), resistor: 'string', voltageV: 'number' }),
  'led-current': obj({ ...spiceCommon, kind: en('led-current'), resistor: 'string', supplyV: 'number', forwardV: 'number', switch: 'string', switchDropV: 'number' }, ['switch', 'switchDropV']),
  'charge-current': obj({ ...spiceCommon, kind: en('charge-current'), resistor: 'string', coefficient: 'number' }),
};
const fields: Record<string, Shape> = {
  schema: en('moki.block/1'), id: 'string', version: 'number', title: 'string', summary: 'string', class: 'string',
  parts: arr(obj({ ref: 'string', mpn: 'string', lcsc: 'string', catalogReceipt: 'string', datasheet: citation, pinout: en('verified', 'unverified'), pins: record(obj({ pad: 'string', role: en('power-in', 'power-out', 'ground', 'input', 'output', 'open-drain', 'bidirectional', 'passive', 'nc'), required: 'boolean', volts }, ['required', 'volts'])), at: pose, value: 'string', valueWhy: citation, omitPads: arr('string'), correction: citation, crystal: obj({ loadCapacitancePf: 'number' }), omitImportedVias: 'boolean', switch: en('normally-open'), footprint: obj({ source: en('jlcpcb', 'footprinter', 'kicad'), id: 'string', citation }) }, ['value', 'valueWhy', 'omitPads', 'correction', 'crystal', 'omitImportedVias', 'switch', 'footprint'])),
  nets: arr(obj({ name: 'string', pins: arr('string') })),
  params: arr(obj({ id: 'string', type: en('number', 'enum'), min: 'number', max: 'number', options: arr('string'), unit: 'string', default: value, why: 'string' }, ['min', 'max', 'options', 'unit'])),
  ports: arr(port), power: obj({ sources: arr(source), sinks: arr(obj({ port: 'string', typicalMa: 'number', peakMa: 'number' })) }),
  constraints: arr({ variants: constraintShapes, key: 'kind' }),
  spiceChecks: arr({ variants: spiceShapes, key: 'kind' }),
  firmware: obj({ libs: arr('string'), includes: arr('string'), usage: 'string' }),
  mcu: obj({ family: 'string', pio: obj({ platform: 'string', board: 'string', framework: 'string', environment: 'string' }, ['environment']), pins: arr(obj({ id: 'string', gpio: value, caps: arr('string'), reserved: 'string', fixedFunction: 'string' }, ['reserved', 'fixedFunction'])), flashKb: 'number', ramKb: 'number' }),
};
const draftShape = obj({ ...fields, provenance: obj({ author: en('human', 'agent'), authorId: 'string' }, ['authorId']) }, ['firmware', 'mcu', 'spiceChecks']);
const blockShape = obj({ ...fields, contentHash: 'string', status: en('reviewed', 'unreviewed'), provenance: obj({ author: en('human', 'agent'), authorId: 'string', reviews: arr(obj({ by: 'string', at: 'string', contentHash: 'string', verdict: en('pass', 'fail'), notes: 'string' })) }, ['authorId']) }, ['firmware', 'mcu', 'spiceChecks']);
const requirementShape = obj({
  id: 'string', plain: 'string', metric: en('battery_life_h', 'interface_present', 'board_size_mm', 'pin_capability', 'net_voltage', 'current_budget_ma', 'part_count', 'bom_cost_usd'),
  args: record(value), op: en('>=', '<=', '==', 'within', 'present'), value: { union: ['number', 'string', arr('number')] }, unit: 'string', source: en('brief', 'answer', 'default', 'inferred', 'maker'),
}, ['args', 'op', 'value', 'unit']);
const planShape = obj({ schema: en('moki.plan/1'), title: 'string', layers: en(2, 4), board: obj({ widthMm: 'number', heightMm: 'number', cornerRadiusMm: 'number' }, ['cornerRadiusMm']), blocks: arr(obj({ inst: 'string', block: 'string', version: 'number', params: record(value), at: pose }, ['at'])), links: arr(obj({ from: 'string', to: 'string' })), netNames: record('string'), sections: arr(obj({ id: 'string', title: 'string', purpose: 'string', insts: arr('string'), notes: arr('string'), reference: obj({ lcsc: 'string', datasheetUrl: 'string', page: 'number', figure: 'string', quote: 'string' }, ['figure']) }, ['reference'])), drafts: arr(draftShape), requirements: arr(requirementShape), app: obj({ source: 'string' }) }, ['board', 'netNames', 'sections', 'drafts', 'requirements', 'app']);
function shape(v: unknown, s: Shape, path: string, errors: string[]): void {
  if (typeof s === 'string') { if (s === 'number' ? !finite(v) : typeof v !== s) errors.push(`${path} must be ${s === 'number' ? 'a finite number' : s}`); return; }
  if ('enum' in s) { if (!s.enum.includes(v)) errors.push(`${path} has an unsupported value`); return; }
  if ('union' in s) { if (!s.union.some(a => { const e: string[] = []; shape(v, a, path, e); return !e.length; })) errors.push(`${path} has an invalid value`); return; }
  if ('array' in s) { if (!Array.isArray(v)) errors.push(`${path} must be an array`); else v.forEach((x, i) => shape(x, s.array, `${path}[${i}]`, errors)); return; }
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v))) { errors.push(`${path} must be a plain object`); return; }
  const o = v as Record<string, unknown>;
  if ('variants' in s) { const branch = Object.hasOwn(s.variants, String(o[s.key])) ? s.variants[String(o[s.key])] : undefined; if (!branch) errors.push(`${path} has an unsupported constraint kind`); else shape(v, branch, path, errors); return; }
  if ('record' in s) { for (const [k, x] of Object.entries(o)) shape(x, s.record, `${path}.${k}`, errors); return; }
  for (const k of Object.keys(o)) if (!Object.hasOwn(s.fields, k)) errors.push(`${path}.${k} is unknown`);
  for (const [k, spec] of Object.entries(s.fields)) { if (!(k in o) && s.optional?.includes(k)) continue; shape(o[k], spec, `${path}.${k}`, errors); }
}
function validShape(v: unknown, s: Shape, where: string, f: Findings): boolean { const e: string[] = []; shape(v, s, where, e); for (const message of e) issue(f, 'schema', message, where); return !e.length; }
function cited(c: { url: string; sha256?: string }, f: Findings, where: string) { try { const u = new URL(c.url); if (!['http:', 'https:'].includes(u.protocol)) throw 0; } catch { issue(f, 'citation', 'A primary-source HTTP(S) citation is required', where); } if (c.sha256 && !sha(c.sha256)) issue(f, 'citation', 'Invalid datasheet hash', where); }
function range(v: { min: number; max: number } | undefined, f: Findings, where: string) { if (v && (v.min < 0 || v.max < v.min)) issue(f, 'voltage-range', 'Voltage range must be nonnegative and ordered', where, 'power'); }
class Union {
  parent = new Map<string, string>();
  find(x: string): string { if (!this.parent.has(x)) this.parent.set(x, x); const p = this.parent.get(x)!; if (p !== x) this.parent.set(x, this.find(p)); return this.parent.get(x)!; }
  join(a: string, b: string) { const x = this.find(a); const y = this.find(b); if (x !== y) this.parent.set(y, x); }
}
type Pin = BlockDef['parts'][number]['pins'][string] & { terminal: string; part: string };
interface Model { block: BlockDef; u: Union; pins: Map<string, Pin>; parts: Map<string, BlockDef['parts'][number]>; ports: Map<string, Port>; nets: Set<string>; terminal(t: string): string | undefined; portNodes(p: Port): Map<string, string> }
function model(b: BlockDef, f: Findings, catalog?: Map<string, CatalogPart>): Model {
  const u = new Union(); const pins = new Map<string, Pin>(); const parts = new Map<string, BlockDef['parts'][number]>(); const ports = new Map<string, Port>(); const nets = new Set<string>();
  const unique = (set: Set<string>, id: string, what: string) => { if (!id || set.has(id)) issue(f, 'unique', `${what} must be nonempty and unique: ${id}`, b.id); set.add(id); };
  const partIds = new Set<string>();
  if (!b.id || !Number.isInteger(b.version) || b.version < 1 || !b.parts.length) issue(f, 'identity', 'A block needs an id, positive integer version and parts', b.id);
  for (const p of b.parts) {
    unique(partIds, p.ref, 'Part reference'); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.ref)) issue(f, 'reference', 'Part reference is not a valid local identifier', p.ref); parts.set(p.ref, p);
    if (!p.mpn || !p.lcsc || !receipt(p.catalogReceipt)) issue(f, 'catalog-receipt', 'Part needs exact MPN, supplier identity and sha256 catalog receipt', p.ref);
    if (p.value && !p.valueWhy) issue(f, 'value-provenance', 'Declared component values need a datasheet/reference citation', p.ref);
    cited(p.datasheet, f, p.ref); if (p.valueWhy) cited(p.valueWhy, f, p.ref); if (p.correction) cited(p.correction, f, p.ref);
    if (p.pinout !== 'verified') issue(f, 'pinout-unverified', 'Unverified pinouts cannot pass ERC', p.ref);
    const fallback = p.footprint && p.footprint.source !== 'jlcpcb';
    if (p.footprint) {
      cited(p.footprint.citation, f, p.ref);
      if (!p.footprint.id.trim() || !/^C[1-9]\d*$/.test(p.lcsc)) issue(f, 'footprint-identity', 'Explicit footprint still needs a real LCSC catalog identity and nonempty package id', p.ref);
      if (p.footprint.source === 'jlcpcb' && p.footprint.id.replace(/^jlcpcb:/, '') !== p.lcsc) issue(f, 'footprint-identity', 'JLCPCB footprint id must match the sourced part', p.ref);
      if (fallback) issue(f, 'fallback-layout-pending', 'Cited standard footprint requires native geometry/pad-map verification before layout approval', p.ref, 'erc', 'warning');
    }
    const padIds = new Set<string>(); if (!Object.keys(p.pins).length) issue(f, 'pinout', 'Part has no declared pin map', p.ref);
    for (const [id, pin] of Object.entries(p.pins)) { unique(padIds, pin.pad, `${p.ref} physical pad`); if (!id) issue(f, 'pinout', 'Logical pin name is empty', p.ref); if (pin.required && pin.role === 'nc') issue(f, 'required-nc', 'An NC pad cannot also be a required connection', `${p.ref}.${id}`); range(pin.volts, f, `${p.ref}.${id}`); pins.set(`${p.ref}.${id}`, { ...pin, terminal: `${p.ref}.${id}`, part: p.ref }); u.find(`${p.ref}.${id}`); }
    if (p.switch) {
      const contacts = Object.values(p.pins).filter(pin => pin.role !== 'nc');
      if (contacts.length !== 2 || contacts.some(pin => !['passive', 'ground'].includes(pin.role)) || p.value !== undefined) issue(f, 'switch-declaration', 'Normally-open switch needs exactly two passive/ground electrical contacts and no component value', p.ref);
      if (!p.datasheet.pages?.trim()) issue(f, 'switch-citation', 'Switch contact behavior needs a datasheet page citation', p.ref);
    }
    if ((p.omitPads?.length || p.omitImportedVias) && !p.correction) issue(f, 'footprint-correction', 'Omitted pads or imported routing vias need an audited correction citation', p.ref);
    if (p.crystal && !positive(p.crystal.loadCapacitancePf)) issue(f, 'crystal-load', 'Crystal load capacitance must be a positive manufacturer value in pF', p.ref);
    for (const pad of p.omitPads ?? []) unique(padIds, pad, `${p.ref} omitted pad`);
    if (catalog) {
      const c = catalog.get(p.lcsc);
      if (!c || !Array.isArray(c.pins) || c.pins.some(p => !p || typeof p.pad !== 'string' || !Array.isArray(p.labels)) || c.lcsc !== p.lcsc || c.mpn !== p.mpn || c.catalogReceipt !== p.catalogReceipt || !receipt(c.catalogReceipt) || !sha(c.rawSha256) || (!sha(c.footprintSha256) && !(fallback && !c.pins.length && c.footprintSha256 === ''))) issue(f, 'catalog-identity', 'Part does not match a verified catalog/importer receipt', p.ref);
      else { const actual = new Set(c.pins.map(a => a.pad)); if (!actual.size && !fallback) issue(f, 'catalog-pad', 'Missing importer pads require an explicit cited standard footprint and verified pinout', p.ref); if (actual.size) { for (const pad of padIds) if (!actual.has(pad)) issue(f, 'catalog-pad', `Pad ${pad} is absent from imported footprint`, p.ref); for (const pad of actual) if (!padIds.has(pad)) issue(f, 'catalog-pad', `Imported pad ${pad} is neither mapped nor explicitly omitted`, p.ref); } }
    }
  }
  const membership = new Map<string, string>();
  for (const net of b.nets) {
    unique(nets, net.name, 'Net name'); u.find(`net:${net.name}`); if (!net.pins.length) issue(f, 'net-empty', 'Net has no pins', net.name); const seen = new Set<string>();
    for (const t of net.pins) { unique(seen, t, 'Net pin'); if (!pins.has(t)) { issue(f, 'net-pin', `Unknown pin ${t}`, net.name); continue; } if (membership.has(t) && membership.get(t) !== net.name) issue(f, 'pin-multiple-nets', `${t} belongs to multiple nets`, net.name); membership.set(t, net.name); u.join(`net:${net.name}`, t); if (pins.get(t)!.role === 'nc') issue(f, 'nc-connected', `${t} is NC and cannot be wired`, net.name); }
  }
  const terminal = (t: string): string | undefined => { if (!(pins.has(t) || t.startsWith('net:') && nets.has(t.slice(4)))) { issue(f, 'terminal', `Unknown terminal ${t}`, b.id); return; } return u.find(t); };
  const portNodes = (p: Port) => { const out = new Map<string, string>(); for (const [signal, t] of Object.entries(p.bus?.signals ?? (p.terminal ? { '': p.terminal } : {}))) { const n = terminal(t); if (n) out.set(signal, n); } return out; };
  for (const p of b.ports) { if (!p.id || ports.has(p.id)) issue(f, 'unique', `Duplicate or empty port ${p.id}`, b.id); ports.set(p.id, p); range(p.volts, f, p.id);
    if (p.kind === 'bus' ? !p.bus || p.terminal !== undefined || !p.bus.protocol || !Object.keys(p.bus.signals).length : p.bus !== undefined || !p.terminal) issue(f, 'port-shape', 'Bus ports need named signals; other ports need one terminal', p.id);
    if (p.fixedFunction !== undefined && (p.kind !== 'gpio' || !functionName(p.fixedFunction))) issue(f, 'fixed-control-port', 'Dedicated control metadata requires a nonempty function and GPIO control terminal', p.id);
    for (const t of Object.values(p.bus?.signals ?? (p.terminal ? { '': p.terminal } : {}))) if (pins.get(t)?.role === 'nc') issue(f, 'nc-connected', 'NC pin cannot be exposed as a connected port', p.id);
    portNodes(p);
    if (p.bus?.i2cAddresses) { const a = p.bus.i2cAddresses; if (p.bus.protocol.toLowerCase() !== 'i2c' || a.some(n => !Number.isInteger(n) || n < 8 || n > 0x77) || new Set(a).size !== a.length) issue(f, 'i2c-address', 'I2C addresses must be unique unreserved 7-bit values', p.id); }
  }
  const paramIds = new Set<string>();
  for (const p of b.params) { unique(paramIds, p.id, 'Parameter'); if (p.type === 'number' ? typeof p.default !== 'number' || p.min !== undefined && p.default < p.min || p.max !== undefined && p.default > p.max || p.min !== undefined && p.max !== undefined && p.min > p.max || p.options !== undefined : typeof p.default !== 'string' || !p.options?.includes(p.default) || new Set(p.options).size !== p.options.length || p.min !== undefined || p.max !== undefined) issue(f, 'parameter', 'Invalid parameter bounds, options or default', p.id); }
  if (b.mcu) { if (!b.mcu.family || !positive(b.mcu.flashKb) || !positive(b.mcu.ramKb) || !b.mcu.pio.platform || !b.mcu.pio.board || !b.mcu.pio.framework) issue(f, 'mcu', 'MCU needs family, memory and PlatformIO target facts', b.id); const ids = new Set<string>(); const gpios = new Set<string>(); for (const p of b.mcu.pins) { unique(ids, p.id, 'MCU pin'); unique(gpios, String(p.gpio), 'MCU GPIO'); if (!pins.has(p.id) || typeof p.gpio === 'number' && (!Number.isInteger(p.gpio) || p.gpio < 0) || typeof p.gpio === 'string' && !p.gpio) issue(f, 'mcu-pin', 'MCU pin must identify a physical local pin and valid GPIO', p.id); } }
  const m = { block: b, u, pins, parts, ports, nets, terminal, portNodes };
  spiceDeclarations(m, f);
  return m;
}
function quantity(text: string | undefined, unit: 'uf' | 'ohm'): number | undefined {
  if (!text) return; const t = text.replace(/\s/g, '');
  const m = unit === 'uf' ? t.match(/^(\d+(?:\.\d+)?)([pnuµμm]?)F$/i) : t.match(/^(\d+(?:\.\d+)?)([kKMm]?)(?:Ω|Ω|ohms?|R)?$/i);
  if (!m) return; const scale = unit === 'uf' ? ({ p: 1e-6, n: 1e-3, u: 1, 'µ': 1, 'μ': 1, m: 1e3, '': 1e6 } as Record<string, number>)[m[2]!.toLowerCase()] : m[2] === 'M' ? 1e6 : m[2] === 'm' ? 1e-3 : m[2]!.toLowerCase() === 'k' ? 1e3 : 1;
  const n = Number(m[1]) * scale!; return finite(n) && (unit === 'ohm' ? n >= 0 : n > 0) ? n : undefined;
}
function spiceDeclarations(m: Model, f: Findings): void {
  const names = new Set<string>();
  const component = (ref: string, unit: 'uf' | 'ohm', name: string, statedOhm?: number) => {
    const p = m.parts.get(ref); const pins = p ? Object.values(p.pins).filter(p => p.role !== 'nc') : [];
    const v = statedOhm ?? quantity(p?.value, unit);
    if (!p || pins.length !== 2 || pins.some(p => p.role !== 'passive') || v === undefined || !positive(v)) issue(f, 'spice-component', `${name} needs a real two-terminal ${unit === 'uf' ? 'capacitor' : 'resistor'} reference with a positive declared value`, ref);
  };
  for (const c of m.block.spiceChecks ?? []) {
    if (!c.name.trim() || names.has(c.name)) issue(f, 'spice-name', 'SPICE check names must be nonempty and unique', m.block.id); names.add(c.name);
    cited(c.citation, f, c.name);
    if (!positive(c.target) || c.tolerance < 0) issue(f, 'spice-target', 'SPICE target must be positive and tolerance nonnegative', c.name);
    switch (c.kind) {
      case 'rc-reset':
        component(c.resistor, 'ohm', c.name); component(c.capacitor, 'uf', c.name);
        if (c.resistor === c.capacitor || !positive(c.supplyV) || c.thresholdRatio <= 0 || c.thresholdRatio >= 1) issue(f, 'spice-profile', 'RC reset needs distinct R/C, positive supply and a threshold strictly between zero and one', c.name);
        break;
      case 'divider':
        component(c.upper, 'ohm', c.name, c.upperOhm); component(c.lower, 'ohm', c.name, c.lowerOhm);
        if (c.series !== undefined) component(c.series, 'ohm', c.name);
        if (c.upper === c.lower || !positive(c.inputV)) issue(f, 'spice-profile', 'Divider needs distinct resistor references and positive input voltage', c.name);
        break;
      case 'resistor-current': component(c.resistor, 'ohm', c.name); if (!positive(c.voltageV)) issue(f, 'spice-profile', 'Resistor-current voltage must be positive', c.name); break;
      case 'led-current': component(c.resistor, 'ohm', c.name); if (!positive(c.supplyV) || !positive(c.forwardV) || c.supplyV <= c.forwardV + (c.switchDropV ?? 0)) issue(f, 'spice-profile', 'LED supply must exceed a positive forward voltage', c.name); break;
      case 'charge-current': component(c.resistor, 'ohm', c.name); if (!positive(c.coefficient)) issue(f, 'spice-profile', 'Charge-current coefficient must be positive', c.name); break;
      default: issue(f, 'spice-profile', 'Unsupported SPICE profile', m.block.id);
    }
  }
}
type Direction = 'read' | 'write' | 'both' | 'open-drain' | 'declared';
const functionName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const protocolName = (s: string) => { const p = functionName(s); return ['usb2', 'usb20'].includes(p) ? 'usb' : p === 'iic' ? 'i2c' : p === '1wire' ? 'onewire' : p; };
function busDirection(protocol: string, signal: string, role: NonNullable<Port['bus']>['role']): Direction {
  if (role === 'passive') return 'declared';
  const p = protocolName(protocol); const s = functionName(signal); const controller = role === 'controller';
  const clock = (): Direction => controller ? 'write' : 'read';
  const reverse = (): Direction => controller ? 'read' : 'write';
  if (p === 'i2c') return s === 'scl' && !controller ? 'read' : 'open-drain';
  if (p === 'spi') {
    if (['sck', 'sclk', 'clk', 'clock', 'mosi', 'copi', 'sdi', 'cs', 'csn', 'ss', 'nss', 'dc', 'reset', 'rst'].includes(s)) return clock();
    if (['miso', 'cipo', 'sdo', 'irq', 'int', 'busy'].includes(s)) return reverse();
  }
  if (p === 'i2s' && ['bclk', 'bck', 'sck', 'sclk', 'clk', 'lrclk', 'lrc', 'ws', 'mclk'].includes(s)) return clock();
  if (p === 'uart' || p === 'usart') {
    if (['tx', 'txd', 'rts'].includes(s)) return clock();
    if (['rx', 'rxd', 'cts'].includes(s)) return reverse();
  }
  if (p === 'usb' || p === 'usb2') return 'both';
  if (p === 'onewire' || p === '1wire') return 'open-drain';
  return 'declared';
}
function supportsRole(role: Pin['role'], direction: Direction): boolean {
  if (direction === 'read') return ['input', 'bidirectional', 'open-drain'].includes(role);
  if (direction === 'write') return ['output', 'bidirectional'].includes(role);
  if (direction === 'both') return role === 'bidirectional';
  if (direction === 'open-drain') return ['open-drain', 'bidirectional'].includes(role);
  return ['input', 'output', 'open-drain', 'bidirectional'].includes(role);
}
/** Function declarations describe actual pad capabilities; no MCU-family or GPIO-number inference. */
function pinFunctions(m: Model, f: Findings, root: (n: string) => string): void {
  const facts = m.block.mcu; const localRoot = (t: string) => root(m.u.find(t));
  for (const port of m.ports.values()) {
    if (!['bus', 'gpio', 'analog'].includes(port.kind)) continue;
    const nodes = m.portNodes(port); const visited = new Set<string>();
    for (const [signal, n] of nodes) {
      const at = `${m.block.id}.${port.id}${signal ? `.${signal}` : ''}`; const target = root(n);
      if (port.bus && visited.has(target)) issue(f, 'bus-signal-short', 'Distinct named bus signals share a physical net', at); visited.add(target);
      const attached = [...m.pins.values()].filter(p => localRoot(p.terminal) === target);
      const applications = facts?.pins.filter(p => localRoot(p.id) === target) ?? [];
      const protocol = port.bus ? protocolName(port.bus.protocol) : undefined;
      if (facts && !applications.length) issue(f, 'mcu-pin-unmapped', 'Application port has no declared MCU pin capability mapping', at);
      const direction = port.bus ? busDirection(port.bus.protocol, signal, port.bus.role) : port.fixedFunction ? 'read' : 'declared';
      for (const pin of attached) if (pin.role !== 'passive' && !supportsRole(pin.role, direction)) issue(f, 'pin-function-role', `Pad role ${pin.role} cannot implement ${port.bus?.protocol ?? port.kind} ${signal} (${direction})`, `${at}:${pin.terminal}`);
      for (const app of applications) {
        const pin = m.pins.get(app.id); if (!pin) continue;
        const caps = new Set(app.caps.map(functionName));
        const input = caps.has('input') || caps.has('bidirectional');
        const output = caps.has('output') || caps.has('bidirectional');
        const openDrain = output || caps.has('opendrain');
        const fixedBus = Boolean(app.fixedFunction && protocol && protocolName(app.fixedFunction) === protocol);
        const fixedControl = Boolean(app.fixedFunction && port.kind === 'gpio' && port.fixedFunction && functionName(app.fixedFunction) === functionName(port.fixedFunction) && ['input', 'bidirectional'].includes(pin.role) && input && caps.has(functionName(port.fixedFunction)));
        const fixedAllowed = fixedBus || fixedControl;
        if (port.fixedFunction && !fixedControl) issue(f, 'mcu-fixed-control', 'Dedicated control needs a matching fixed MCU function, input-capable pad and declared function capability', `${at}:${app.id}`);
        if (app.fixedFunction !== undefined && (!app.fixedFunction.trim() || !fixedAllowed)) issue(f, 'mcu-fixed-function', 'Dedicated pad may only be used on its matching fixed protocol bus or control terminal', `${at}:${app.id}`);
        if (app.reserved && !fixedAllowed) issue(f, 'reserved-mcu-pin', `Reserved MCU pin ${app.id}: ${app.reserved}`, at);
        const actualInput = pin.role === 'input' || pin.role === 'bidirectional';
        const actualOutput = pin.role === 'output' || pin.role === 'bidirectional';
        if (!supportsRole(pin.role, direction) || actualInput && !input || actualOutput && !output || pin.role === 'open-drain' && !openDrain || direction === 'read' && !input || direction === 'write' && !output || direction === 'both' && (!input || !output) || direction === 'open-drain' && (!input || !openDrain)) issue(f, 'mcu-direction', 'Declared MCU capabilities cannot implement this pin role/direction', `${at}:${app.id}`);
        if (protocol) {
          const matching = app.caps.some(cap => protocolName(cap) === protocol || functionName(cap) === `${protocol}${functionName(signal)}`);
          if (!matching) issue(f, 'mcu-protocol', `MCU pin has no declared ${port.bus!.protocol} function capability`, `${at}:${app.id}`);
          const specific = app.caps.filter(cap => cap.includes(':') && protocolName(cap.split(':')[0]!) === protocol);
          if (specific.length && !specific.some(cap => functionName(cap.split(':').slice(1).join(':')) === functionName(signal))) issue(f, 'mcu-protocol-signal', 'MCU pin does not support this specific bus signal', `${at}:${app.id}`);
        }
        if (port.kind === 'analog') {
          const analogInput = caps.has('adc') || caps.has('analog') || caps.has('analoginput') || caps.has('analogin');
          const analogOutput = caps.has('dac') || caps.has('analogoutput') || caps.has('analogout');
          if (pin.role === 'input' ? !input || !analogInput : pin.role === 'output' ? !output || !analogOutput : pin.role === 'bidirectional' ? !(input && analogInput || output && analogOutput) : true) issue(f, 'mcu-analog', 'Analog port needs a supported ADC input or DAC output pad', `${at}:${app.id}`);
        }
      }
    }
  }
}
function checks(m: Model, f: Findings, root: (n: string) => string = n => n, liveLoads = new Set<string>()) {
  const b = m.block; const ground = new Set([...m.ports.values()].filter(p => p.kind === 'ground').flatMap(p => [...m.portNodes(p).values()].map(root)));
  const power = new Set([...m.ports.values()].filter(p => ['power-in', 'power-out'].includes(p.kind)).flatMap(p => [...m.portNodes(p).values()].map(root)));
  const get = (t: string): string | undefined => { const n = m.terminal(t); return n === undefined ? undefined : root(n); };
  const sameNode = (a: string | undefined, c: string | undefined) => a !== undefined && c !== undefined && a === c;
  const twoPins = (ref: string) => { const p = m.parts.get(ref); const pins = [...m.pins.values()].filter(p => p.part === ref && p.role !== 'nc'); if (!p || pins.length !== 2 || pins.some(p => p.role !== 'passive')) { issue(f, 'two-terminal', `${ref} must be a two-terminal passive component`, b.id); return; } return { part: p, nodes: pins.map(p => get(p.terminal)) }; };
  const bridge = (ref: string, a: string | undefined, c: string | undefined) => { const p = twoPins(ref); return p && a !== c && (sameNode(p.nodes[0], a) && sameNode(p.nodes[1], c) || sameNode(p.nodes[1], a) && sameNode(p.nodes[0], c)); };
  const resistor = (ref: string, ohms: number) => { const v = quantity(m.parts.get(ref)?.value, 'ohm'); if (!v || !same(v, ohms)) issue(f, 'resistor-value', `${ref} must declare ${ohms} ohms, matching its actual value`, b.id); };
  for (const c of b.constraints) {
    cited(c.citation, f, `${b.id}:${c.kind}`);
    switch (c.kind) {
      case 'decoupling': {
        const ic = m.parts.get(c.ic); const powerPin = m.pins.has(c.powerPin) ? c.powerPin : `${c.ic}.${c.powerPin}`; const groundPin = m.pins.has(c.groundPin) ? c.groundPin : `${c.ic}.${c.groundPin}`;
        if (!ic || m.pins.get(powerPin)?.part !== c.ic || m.pins.get(groundPin)?.part !== c.ic || !['power-in', 'power-out'].includes(m.pins.get(powerPin)?.role ?? '') || m.pins.get(groundPin)?.role !== 'ground') issue(f, 'decoupling-pins', 'Decoupling must identify the IC supply and ground pins', b.id);
        const pn = get(powerPin); const gn = get(groundPin); let total = 0;
        if (!positive(c.minUf) || !positive(c.maxDistanceMm) || !c.caps.length || new Set(c.caps).size !== c.caps.length) issue(f, 'decoupling-constraint', 'Decoupling values, distance and unique capacitor list must be positive', b.id);
        for (const ref of c.caps) {
          const cap = m.parts.get(ref); const value = quantity(cap?.value, 'uf');
          if (!value || !bridge(ref, pn, gn)) issue(f, 'decoupling-net', `${ref} must be a valued capacitor directly across ${powerPin} and ${groundPin}`, b.id);
          else total += value;
          if (cap && ic && Math.hypot(cap.at.x - ic.at.x, cap.at.y - ic.at.y) > c.maxDistanceMm + 1e-6) issue(f, 'decoupling-distance', `${ref} exceeds the declared decoupling distance`, b.id);
        }
        if (total + 1e-9 < c.minUf) issue(f, 'decoupling-value', `Connected decoupling ${total} µF is below ${c.minUf} µF`, b.id);
        break;
      }
      case 'pullup': {
        const p = get(c.pin); const to = get(c.to); resistor(c.resistor, c.ohms);
        if (!positive(c.ohms) || !to || !power.has(to) || !bridge(c.resistor, p, to)) issue(f, 'pullup-net', 'Pull-up must bridge its signal to a declared positive supply through its resistor', c.pin);
        break;
      }
      case 'strap': {
        const pin = get(c.pin);
        if (c.safe === 'floating') {
          if (c.resistor || c.to || [...m.pins.values()].some(p => p.terminal !== c.pin && sameNode(get(p.terminal), pin))) issue(f, 'strap-state', 'Floating strap has a connected driver or bias network', c.pin);
        } else {
          const to = c.to ? get(c.to) : pin;
          const wired = c.resistor ? bridge(c.resistor, pin, to) && quantity(m.parts.get(c.resistor)?.value, 'ohm') !== undefined : sameNode(pin, to);
          if (!wired || !(c.safe === 'high' ? to && power.has(to) : to && ground.has(to))) issue(f, 'strap-state', `Strap needs a direct or resistive connection to a ${c.safe === 'high' ? 'supply' : 'ground'} terminal`, c.pin);
          if ([...m.pins.values()].some(p => ['output', 'power-out'].includes(p.role) && sameNode(get(p.terminal), pin) && !(p.role === 'power-out' && !c.resistor && c.safe === 'high' && power.has(pin!)))) issue(f, 'strap-driver', 'A directly connected output overrides the declared strap bias', c.pin);
        }
        break;
      }
      case 'usb-c-sink': {
        const a = get(m.pins.has(c.cc1) ? c.cc1 : `${c.connector}.${c.cc1}`); const d = get(m.pins.has(c.cc2) ? c.cc2 : `${c.connector}.${c.cc2}`);
        if (!m.parts.has(c.connector) || c.resistors.length !== 2 || new Set(c.resistors).size !== 2 || !same(c.ohms, 5100) || sameNode(a, d)) issue(f, 'usb-cc', 'USB-C sink needs separate CC1/CC2 nodes and two distinct 5.1 kΩ pull-downs', c.connector);
        for (const [i, ref] of c.resistors.entries()) { resistor(ref, 5100); if (![...ground].some(g => bridge(ref, i === 0 ? a : d, g))) issue(f, 'usb-cc-ground', `${ref} must connect only its CC pin to ground`, c.connector); }
        break;
      }
      case 'ground': { const n = get(c.pin); if (!n || !ground.has(n)) issue(f, 'ground-pin', 'Required pin is not wired to a declared ground terminal', c.pin); break; }
      case 'battery-path': {
        const battery = m.ports.get(c.batteryPort); const system = c.systemPort ? m.ports.get(c.systemPort) : undefined;
        const bn = battery?.terminal ? get(battery.terminal) : undefined; const sn = system?.terminal ? get(system.terminal) : undefined;
        const chargerPins = [...m.pins.values()].filter(p => p.part === c.charger);
        const outputs = chargerPins.filter(p => p.role === 'power-out').map(p => get(p.terminal)); const inputs = chargerPins.filter(p => p.role === 'power-in').map(p => get(p.terminal));
        if (!m.parts.has(c.charger) || !battery || !bn || !outputs.includes(bn) || !inputs.length || !chargerPins.some(p => p.role === 'ground' && ground.has(get(p.terminal)!))) issue(f, 'battery-path', 'Battery path needs a charger supply, ground and a battery port on its charge output', b.id);
        if (c.powerPath === 'isolated') { if (c.systemPort || bn && liveLoads.has(bn)) issue(f, 'battery-load-sharing', 'Isolated charger output cannot power a running system during charging', b.id); }
        else {
          if (!system || !sn || sn === bn || !['power-in', 'power-out'].includes(system.kind)) issue(f, 'battery-system', 'A power-path system port must be distinct from the battery terminal', b.id);
          if (c.powerPath === 'integrated' && !outputs.includes(sn)) issue(f, 'battery-integrated', 'Integrated power path requires a separate charger system output', b.id);
          if (c.powerPath === 'load-sharing') {
            const connects = (x: string | undefined, y: string | undefined) => [...m.parts.keys()].some(ref => ref !== c.charger && [...m.pins.values()].some(p => p.part === ref && sameNode(get(p.terminal), x)) && [...m.pins.values()].some(p => p.part === ref && sameNode(get(p.terminal), y)));
            if (!connects(bn, sn) || !inputs.some(n => connects(n, sn))) issue(f, 'battery-load-sharing', 'Discrete load sharing needs separate battery-to-system and input-to-system paths', b.id);
            issue(f, 'battery-switch-proof', 'Switch polarity, reverse blocking and charge termination still require independent topology review', b.id, 'erc', 'warning');
          }
        }
        break;
      }
      case 'keepout': if (c.excludeParts?.some(ref=>!m.parts.has(ref))) issue(f,'keepout-reference','Keepout exemptions must name actual local parts',b.id); if (!positive(c.width) || !positive(c.height) || !c.layers.length || c.layers.some(l => !['top', 'bottom', 'inner1', 'inner2', 'all'].includes(l)) || !c.purpose) issue(f, 'keepout', 'Keepout needs positive geometry, supported layers and purpose', b.id); else issue(f, 'layout-constraint-pending', 'Keepout realization must be checked against final imported PCB geometry', b.id, 'erc', 'warning'); break;
      case 'edge': if (!m.parts.has(c.part) || c.overhangMm !== undefined && c.overhangMm < 0) issue(f, 'edge', 'Edge constraint needs a known part and nonnegative overhang', b.id); else issue(f, 'layout-constraint-pending', 'Connector edge placement must be verified on the final PCB', c.part, 'erc', 'warning'); break;
      default: issue(f, 'constraint', 'Unsupported constraint cannot pass ERC', b.id);
    }
  }
}
interface Instance { inst: string; model: Model }
function graph(entries: Instance[], u: Union, f: Findings, boundary: boolean, connectedPorts = new Set<string>()) {
  const node = (e: Instance, local: string) => u.find(`${e.inst}:${e.model.u.find(local)}`);
  const portNode = (e: Instance, id: string, expected?: Port['kind']): string | undefined => { const p = e.model.ports.get(id); if (!p || !p.terminal || expected && p.kind !== expected) { issue(f, 'power-port', `Unknown or incompatible ${expected ?? 'power'} port ${id}`, e.inst, 'power'); return; } const t = e.model.terminal(p.terminal); return t === undefined ? undefined : node(e, t); };
  type Supply = { entry: Instance; fact: BlockDef['power']['sources'][number]; out: string; input?: string; min: number; max: number };
  const supplies: Supply[] = []; const boundaries = new Map<string, { min: number; max: number }>(); const ground = new Set<string>(); const groundOrigins = new Set<string>();
  const direct = new Map<string, { peak: number; typical: number }>(); const required = new Set<string>(); const allPins = new Map<string, Array<{ pin: Pin; entry: Instance }>>();
  for (const e of entries) {
    const b = e.model.block;
    for (const p of e.model.ports.values()) {
      if (p.kind === 'ground') for (const n of e.model.portNodes(p).values()) { ground.add(node(e, n)); if (boundary || b.power.sources.some(s => s.mode === 'external')) groundOrigins.add(node(e, n)); }
      if (boundary && p.kind === 'power-in') { const n = portNode(e, p.id); if (n && p.volts) boundaries.set(n, p.volts); else if (n) issue(f, 'voltage-unknown', 'Power input boundary needs a declared voltage range', `${e.inst}.${p.id}`, 'power'); }
    }
    const sourcePorts = new Set<string>(); const sinkPorts = new Set<string>();
    for (const s of b.power.sources) {
      if (sourcePorts.has(s.port)) issue(f, 'power-source-duplicate', 'Source port is declared twice', `${e.inst}.${s.port}`, 'power'); sourcePorts.add(s.port);
      const out = portNode(e, s.port, 'power-out'); const input = s.inputPort ? portNode(e, s.inputPort, 'power-in') : undefined;
      if (!positive(s.volts) || !positive(s.maxMa) || s.continuousMa !== undefined && (!positive(s.continuousMa) || s.continuousMa > s.maxMa) || s.efficiency !== undefined && (!positive(s.efficiency) || s.efficiency > 1) || s.dropoutV !== undefined && s.dropoutV < 0 || s.maxDissipationW !== undefined && !positive(s.maxDissipationW)) issue(f, 'power-facts', 'Source voltage/current/efficiency/derating facts are invalid', `${e.inst}.${s.port}`, 'power');
      if (s.mode !== 'external' && (!s.inputPort || !input)) issue(f, 'power-dependency', 'A regulated/charger source needs its upstream input port', `${e.inst}.${s.port}`, 'power');
      if (s.mode === 'external' && s.inputPort) issue(f, 'power-dependency', 'External source cannot also declare a regulator input dependency', `${e.inst}.${s.port}`, 'power');
      if (s.mode !== 'external' && !s.conversion) issue(f, 'conversion-unknown', 'Regulator conversion topology is required for current/thermal checks', `${e.inst}.${s.port}`, 'power');
      if (s.conversion === 'linear' && (s.dropoutV === undefined || !s.thermal && s.maxDissipationW === undefined)) issue(f, 'linear-proof', 'Linear source needs dropout and a thermal or power-dissipation bound', `${e.inst}.${s.port}`, 'power');
      if (s.conversion === 'switching' && s.efficiency === undefined) issue(f, 'efficiency-unknown', 'Switching source needs a conservative efficiency assumption', `${e.inst}.${s.port}`, 'power');
      if (s.thermal && (!positive(s.thermal.thetaJa) || s.thermal.maxJunctionC <= s.thermal.ambientC)) issue(f, 'thermal-facts', 'Thermal resistance and junction headroom must be positive', `${e.inst}.${s.port}`, 'power');
      const p = e.model.ports.get(s.port); if (p?.volts && (s.volts < p.volts.min || s.volts > p.volts.max)) issue(f, 'source-voltage', 'Source voltage is outside its output port range', `${e.inst}.${s.port}`, 'power');
      if (out && input && s.mode !== 'external') {
        const outputs = [...e.model.pins.values()].filter(p => p.role === 'power-out' && node(e, p.terminal) === out);
        if (!outputs.length || !outputs.some(p => [...e.model.pins.values()].some(q => q.part === p.part && q.role === 'power-in' && node(e, q.terminal) === input))) issue(f, 'regulator-dependency-net', 'Regulator dependency must reach the actual input and output pins of its IC', `${e.inst}.${s.port}`, 'power');
      }
      if (out) supplies.push({ entry: e, fact: s, out, ...(input ? { input } : {}), min: p?.volts?.min ?? s.volts, max: p?.volts?.max ?? s.volts });
    }
    for (const sink of b.power.sinks) {
      if (sinkPorts.has(sink.port)) issue(f, 'power-sink-duplicate', 'Sink port is declared twice', `${e.inst}.${sink.port}`, 'power'); sinkPorts.add(sink.port);
      if (sink.typicalMa < 0 || sink.peakMa < sink.typicalMa) issue(f, 'load-facts', 'Load currents must be nonnegative, with peak at least typical', `${e.inst}.${sink.port}`, 'power');
      const n = portNode(e, sink.port, 'power-in'); if (n) { const old = direct.get(n) ?? { peak: 0, typical: 0 }; direct.set(n, { peak: old.peak + sink.peakMa, typical: old.typical + sink.typicalMa }); required.add(n); }
    }
    for (const pin of e.model.pins.values()) {
      const n = node(e, pin.terminal); const all = allPins.get(n) ?? []; all.push({ pin, entry: e }); allPins.set(n, all);
      if (['power-in', 'power-out'].includes(pin.role)) {
        if (pin.role === 'power-in') required.add(n);
        const covered = b.constraints.some(c => c.kind === 'decoupling' && c.ic === pin.part && node(e, e.model.pins.has(c.powerPin) ? c.powerPin : `${c.ic}.${c.powerPin}`) === n);
        if (!covered) issue(f, 'decoupling-missing', 'IC supply pin has no declared decoupling requirement', `${e.inst}.${pin.terminal}`);
      }
      if (pin.role === 'nc' && (allPins.get(n)?.length ?? 0) > 1) issue(f, 'nc-connected', 'NC pin is wired through a plan link', `${e.inst}.${pin.terminal}`);
    }
    for (const p of e.model.ports.values()) if (p.kind === 'power-in') {
      const n = portNode(e, p.id); if (n) required.add(n);
      if (!b.power.sinks.some(s => s.port === p.id) && !b.power.sources.some(s => s.inputPort === p.id)) issue(f, 'load-unknown', 'Power input has no load budget or regulator dependency', `${e.inst}.${p.id}`, 'power');
    }
  }
  // Ground origins are collected across all instances before judging returns.
  // Function requirements follow connected nets, including GPIO/analog aliases in intermediary blocks.
  const analogRoots = new Set<string>();
  for (const e of entries) for (const p of e.model.ports.values()) if (p.kind === 'analog') for (const n of e.model.portNodes(p).values()) analogRoots.add(node(e, n));
  for (const e of entries) for (const app of e.model.block.mcu?.pins ?? []) if (analogRoots.has(node(e, app.id))) {
    const pin = e.model.pins.get(app.id); const caps = new Set(app.caps.map(functionName));
    const input = caps.has('input') || caps.has('bidirectional'); const output = caps.has('output') || caps.has('bidirectional');
    const adc = ['adc', 'analog', 'analoginput', 'analogin'].some(c => caps.has(c)); const dac = ['dac', 'analogoutput', 'analogout'].some(c => caps.has(c));
    if (app.fixedFunction) issue(f, 'mcu-fixed-function', 'Dedicated function pad cannot be reused through a connected analog endpoint', `${e.inst}.${app.id}`);
    if (pin?.role === 'input' ? !input || !adc : pin?.role === 'output' ? !output || !dac : pin?.role === 'bidirectional' ? !(input && adc || output && dac) : true) issue(f, 'mcu-analog', 'Connected analog endpoint requires a matching ADC input or DAC output capability on the MCU pad', `${e.inst}.${app.id}`);
    const root = node(e, app.id);
    const analogPeers = entries.filter(peer => [...peer.model.ports.values()].some(port => port.kind === 'analog' && [...peer.model.portNodes(port).values()].some(n => node(peer, n) === root)));
    const peerPins = (allPins.get(root) ?? []).filter(p => analogPeers.some(peer => peer.inst === p.entry.inst) && !(p.entry.inst === e.inst && p.pin.part === pin?.part));
    if (peerPins.some(p => ['input', 'bidirectional'].includes(p.pin.role)) && (!output || !dac || !pin || !['output', 'bidirectional'].includes(pin.role)))
      issue(f, 'mcu-analog-direction', 'An analog input consumer requires a real DAC-capable MCU output; ADC capability cannot generate an analog voltage', `${e.inst}.${app.id}`);
    if (peerPins.some(p => ['output', 'bidirectional'].includes(p.pin.role)) && (!input || !adc || !pin || !['input', 'bidirectional'].includes(pin.role)))
      issue(f, 'mcu-analog-direction', 'An analog output source requires an ADC-capable MCU input', `${e.inst}.${app.id}`);
  }
  for (const e of entries) pinFunctions(e.model, f, n => node(e, n));
  const activeBuses = new Map<string, Set<string>>();
  for (const e of entries) for (const p of e.model.ports.values()) if (p.bus && p.bus.role !== 'passive') for (const n of e.model.portNodes(p).values()) {
    const at = node(e, n); const owners = activeBuses.get(at) ?? new Set<string>(); owners.add(e.inst); activeBuses.set(at, owners);
  }
  if (!boundary) for (const [n, owners] of activeBuses) if (owners.size > 1 && !allPins.get(n)?.some(x => ['output', 'open-drain', 'bidirectional'].includes(x.pin.role))) issue(f, 'bus-driver-missing', 'Connected active bus endpoints are all inputs; no pad can drive this signal', n);
  for (const [n, ps] of allPins) {
    // A connected application signal made solely of active inputs has no driver.
    // Passive switches/headers and biased monitoring nets remain valid; the
    // latter are checked with pull-up/strap topology below.
    const activeInputs = ps.filter(p => p.pin.role === 'input');
    const signalDriver = ps.some(p => ['output', 'bidirectional', 'open-drain'].includes(p.pin.role));
    const hasBias = entries.some(e => e.model.block.constraints.some(c =>
      (c.kind === 'pullup' || c.kind === 'strap' && c.safe === 'high')
      && (() => { const t = e.model.terminal(c.pin); return t !== undefined && node(e, t) === n; })()));
    if (!boundary && activeInputs.length > 1 && !signalDriver && !hasBias && !ground.has(n) && !ps.some(p => p.pin.role === 'power-out'))
      issue(f, 'signal-driver-missing', 'Connected input pads have no signal driver or declared bias', activeInputs.map(p => `${p.entry.inst}.${p.pin.terminal}`).join(', '));
    for (const { pin, entry } of ps) if (pin.required) {
      const exposed = boundary && [...entry.model.ports.values()].some(p => [...entry.model.portNodes(p).values()].some(t => node(entry, t) === n));
      if (ps.length < 2 && !exposed) issue(f, 'required-pin-unconnected', 'Required pad has no real connection or exposed draft boundary', `${entry.inst}.${pin.terminal}`);
    }
    const drivers = ps.filter(p => ['output', 'power-out'].includes(p.pin.role));
    const distinctDrivers = new Set(drivers.map(p => p.pin.role === 'power-out' ? `${p.entry.inst}:${p.pin.part}:power` : `${p.entry.inst}:${p.pin.terminal}`));
    if (distinctDrivers.size > 1) issue(f, 'multiple-drivers', 'Multiple push-pull/power outputs share one net', drivers.map(p => `${p.entry.inst}.${p.pin.terminal}`).join(', '));
    if (drivers.length && ps.some(p => p.pin.role === 'open-drain')) issue(f, 'mixed-drivers', 'Push-pull and open-drain drivers share a net', drivers[0]!.entry.inst);
    if (ps.length > 1 && ps.some(p => p.pin.role === 'nc')) issue(f, 'nc-connected', 'NC pin is connected on the resulting net', ps.find(p => p.pin.role === 'nc')!.entry.inst);
    for (const { pin, entry } of ps) if (pin.role === 'ground' && (!ground.has(n) || !groundOrigins.has(n))) issue(f, 'ground-return', 'Ground pin has no connected external/boundary ground return', `${entry.inst}.${pin.terminal}`);
  }
  const supplyByRoot = new Map<string, Supply[]>(); for (const s of supplies) { const a = supplyByRoot.get(s.out) ?? []; a.push(s); supplyByRoot.set(s.out, a); }
  for (const [n, ss] of supplyByRoot) { if (ss.length > 1) issue(f, 'multiple-power-sources', 'Power sources are tied together without an explicit switched/isolated state model', ss.map(s => `${s.entry.inst}.${s.fact.port}`).join(', '), 'power'); if (ground.has(n)) issue(f, 'power-ground-short', 'Positive supply is shorted to ground', ss[0]!.entry.inst, 'power'); }
  const voltage = (n: string): { min: number; max: number } | undefined => { const s = supplyByRoot.get(n)?.[0]; return s ? { min: s.min, max: s.max } : boundaries.get(n); };
  for (const [n, ps] of allPins) if (ps.some(p => p.pin.role === 'power-out') && !supplyByRoot.has(n)) issue(f, 'power-output-unknown', 'IC power output has no declared voltage/current source budget', n, 'power');
  for (const n of required) if (!voltage(n)) issue(f, 'power-source-missing', 'Power input has no declared source on its actual net', n, 'power');
  const biased = new Map<string, Array<{ min: number; max: number }>>();
  for (const e of entries) for (const c of e.model.block.constraints) if (c.kind === 'pullup' || c.kind === 'strap' && c.safe === 'high' && c.to) {
    const p = e.model.terminal(c.pin); const to = e.model.terminal(c.to!); const v = to === undefined ? undefined : voltage(node(e, to));
    if (p && v) { const n = node(e, p); const a = biased.get(n) ?? []; a.push(v); biased.set(n, a); }
  }
  for (const e of entries) {
    for (const p of e.model.ports.values()) if (p.kind !== 'bus' && p.volts && p.terminal) { const n = e.model.terminal(p.terminal); const v = n === undefined ? undefined : voltage(node(e, n)); if (v && (v.min < p.volts.min - 1e-6 || v.max > p.volts.max + 1e-6)) issue(f, 'voltage-domain', 'Connected supply exceeds the port voltage range', `${e.inst}.${p.id}`, 'power'); }
    for (const p of e.model.pins.values()) if (p.volts) { const n = node(e, p.terminal); const supply = voltage(n); const outputPins = allPins.get(n)?.filter(p => p.pin.role === 'output' || p.pin.role === 'bidirectional') ?? []; const ranges = [...(supply ? [supply] : []), ...(biased.get(n) ?? []), ...outputPins.flatMap(p => p.pin.volts ? [p.pin.volts] : [])]; for (const v of ranges) if (v.min < p.volts.min - 1e-6 || v.max > p.volts.max + 1e-6) issue(f, 'pin-voltage', 'Driven voltage is outside the pin voltage domain', `${e.inst}.${p.terminal}`, 'power'); }
  }
  const liveLoads = new Set([...direct.keys(), ...supplies.flatMap(s => s.input ? [s.input] : [])]);
  // A charger consumes programmed current while filling the cell even without a system load at BAT.
  for (const s of supplies) if (s.fact.mode === 'charger') {
    const load = direct.get(s.out) ?? { peak: 0, typical: 0 };
    direct.set(s.out, { peak: load.peak + s.fact.maxMa, typical: load.typical + (s.fact.continuousMa ?? s.fact.maxMa) });
  }
  const done = new Map<string, { peak: number; typical: number }>(); const active = new Set<string>();
  const demand = (n: string): { peak: number; typical: number } => {
    if (done.has(n)) return done.get(n)!;
    if (active.has(n)) { issue(f, 'power-cycle', 'Regulator dependency graph contains a cycle', n, 'power'); return { peak: 0, typical: 0 }; }
    active.add(n); const total = { ...(direct.get(n) ?? { peak: 0, typical: 0 }) };
    for (const s of supplies.filter(s => s.input === n)) {
      const load = demand(s.out); const v = voltage(n);
      if (!v || !positive(v.min)) issue(f, 'regulator-input', 'Regulator input source/range is unknown or includes zero volts', `${s.entry.inst}.${s.fact.port}`, 'power');
      const scale = s.fact.conversion === 'linear' ? 1 : s.fact.conversion === 'switching' && v && s.fact.efficiency ? s.max / (v.min * s.fact.efficiency) : 1;
      total.peak += load.peak * scale; total.typical += load.typical * scale;
    }
    active.delete(n); done.set(n, total); return total;
  };
  type Heat = { facts: NonNullable<BlockDef['power']['sources'][number]['thermal']>[]; limits: number[]; losses: number[]; ratings: number[]; where: string };
  const heat = new Map<string, Heat>();
  for (const s of supplies) {
    const load = demand(s.out); const continuous = s.fact.continuousMa ?? s.fact.maxMa;
    if (load.peak > s.fact.maxMa + 1e-6) issue(f, 'peak-current-budget', `Peak load ${load.peak.toFixed(2)} mA exceeds ${s.fact.maxMa} mA`, `${s.entry.inst}.${s.fact.port}`, 'power');
    if (load.typical > continuous + 1e-6) issue(f, 'continuous-current-budget', `Typical load ${load.typical.toFixed(2)} mA exceeds ${continuous} mA continuous budget`, `${s.entry.inst}.${s.fact.port}`, 'power');
    if (load.peak > continuous + 1e-6) issue(f, 'transient-unverified', 'Peak current exceeds the continuous thermal budget; burst duration/decoupling require transient verification', `${s.entry.inst}.${s.fact.port}`, 'power', 'warning');
    if (!s.input) continue; const vin = voltage(s.input); if (!vin) continue;
    if (s.fact.conversion === 'linear' && vin.min + 1e-6 < s.min + (s.fact.dropoutV ?? 0)) issue(f, 'dropout', 'Minimum regulator input cannot maintain the requested output and dropout headroom', `${s.entry.inst}.${s.fact.port}`, 'power');
    const current = boundary ? continuous : load.typical;
    const loss = s.fact.conversion === 'linear' ? Math.max(0, vin.max - s.min) * current / 1000 : s.fact.efficiency ? s.fact.volts * current / 1000 * (1 / s.fact.efficiency - 1) : NaN;
    const ratingLoss = s.fact.conversion === 'linear' ? Math.max(0, vin.max - s.min) * continuous / 1000 : s.fact.efficiency ? s.max * continuous / 1000 * (1 / s.fact.efficiency - 1) : NaN;
    const owner = [...s.entry.model.pins.values()].find(p => p.role === 'power-out' && node(s.entry, p.terminal) === s.out)?.part;
    if (owner) {
      const key = `${s.entry.inst}.${owner}`; const h = heat.get(key) ?? { facts: [], limits: [], losses: [], ratings: [], where: key };
      if (s.fact.thermal) h.facts.push(s.fact.thermal); if (s.fact.maxDissipationW !== undefined) h.limits.push(s.fact.maxDissipationW);
      h.losses.push(loss); h.ratings.push(ratingLoss); heat.set(key, h);
    }
    if (!boundary && s.fact.maxDissipationW !== undefined && ratingLoss > s.fact.maxDissipationW + 1e-9) issue(f, 'continuous-rating', 'Claimed continuous rating exceeds the regulator package dissipation bound', `${s.entry.inst}.${s.fact.port}`, 'power');
    if (s.fact.maxDissipationW !== undefined && loss > s.fact.maxDissipationW + 1e-9) issue(f, 'dissipation', 'Declared continuous load exceeds regulator power-dissipation limit', `${s.entry.inst}.${s.fact.port}`, 'power');
    if (s.fact.thermal && s.fact.thermal.ambientC + loss * s.fact.thermal.thetaJa > s.fact.thermal.maxJunctionC + 1e-6) issue(f, 'thermal-budget', 'Estimated junction temperature exceeds the declared thermal limit; derate continuousMa', `${s.entry.inst}.${s.fact.port}`, 'power');
    if (s.fact.thermal) issue(f, 'thermal-assumption', 'Thermal model is a declared board/ambient assumption, not measured hardware performance', `${s.entry.inst}.${s.fact.port}`, 'power', 'warning');
    // Validate the promised board-continuous rating even if this plan draws less current.
    if (!boundary && s.fact.thermal) { const ratingLoss = s.fact.conversion === 'linear' ? Math.max(0, vin.max - s.min) * continuous / 1000 : s.fact.efficiency ? s.fact.volts * continuous / 1000 * (1 / s.fact.efficiency - 1) : NaN; if (s.fact.thermal.ambientC + ratingLoss * s.fact.thermal.thetaJa > s.fact.thermal.maxJunctionC + 1e-6) issue(f, 'continuous-rating', 'Claimed continuous source rating is inconsistent with its thermal model', `${s.entry.inst}.${s.fact.port}`, 'power'); }
  }
  for (const h of heat.values()) if (h.losses.length > 1) {
    const actual = h.losses.reduce((s, n) => s + n, 0); const rating = h.ratings.reduce((s, n) => s + n, 0);
    if (h.facts.length) {
      const t = h.facts[0]!;
      if (h.facts.some(x => x.thetaJa !== t.thetaJa || x.maxJunctionC !== t.maxJunctionC || x.ambientC !== t.ambientC)) issue(f, 'shared-thermal-facts', 'Power outputs on the same IC must share one consistent thermal model', h.where, 'power');
      if (t.ambientC + actual * t.thetaJa > t.maxJunctionC + 1e-6) issue(f, 'shared-thermal-budget', 'Combined output/charging losses exceed the physical IC thermal limit', h.where, 'power');
      if (t.ambientC + rating * t.thetaJa > t.maxJunctionC + 1e-6) issue(f, 'shared-continuous-rating', 'Simultaneous promised continuous outputs exceed the physical IC thermal limit', h.where, 'power');
    }
    if (h.limits.length && (actual > Math.min(...h.limits) + 1e-9 || rating > Math.min(...h.limits) + 1e-9)) issue(f, 'shared-dissipation', 'Combined outputs exceed the physical IC dissipation bound', h.where, 'power');
  }
  for (const e of entries) {
    checks(e.model, f, n => node(e, n), boundary ? new Set() : liveLoads);
    if (!boundary) for (const c of e.model.block.constraints) if (c.kind === 'strap') {
      const p = e.model.terminal(c.pin); const attached = p ? allPins.get(node(e, p)) ?? [] : [];
      if (attached.some(x => x.entry.inst !== e.inst && ['output', 'power-out', 'open-drain', 'bidirectional'].includes(x.pin.role) && !(x.pin.role === 'power-out' && c.safe === 'high' && !c.resistor))) issue(f, 'strap-driver', 'External output can override the boot strap state', `${e.inst}.${c.pin}`);
    }
  }
  if (!boundary) {
    const bias = new Set<string>(); for (const e of entries) for (const c of e.model.block.constraints) if (c.kind === 'pullup') { const n = e.model.terminal(c.pin); if (n) bias.add(node(e, n)); }
    // A mux option on an unused application port is not an enabled bus. Once
    // linked as I2C, both physical signal nets still need verified pull-ups.
    for (const e of entries) for (const p of e.model.ports.values()) if (p.bus?.protocol.toLowerCase() === 'i2c') for (const [signal, n] of e.model.portNodes(p)) {
      const root = node(e, n);
      const internalOwners = new Set((allPins.get(root) ?? []).filter(x => x.entry.inst === e.inst && ['input', 'output', 'open-drain', 'bidirectional'].includes(x.pin.role)).map(x => x.pin.part));
      const peerBus = entries.some(peer => peer.inst !== e.inst && [...peer.model.ports.values()].some(port => port.bus?.protocol.toLowerCase() === 'i2c' && [...peer.model.portNodes(port).values()].some(n => node(peer, n) === root)));
      const active = connectedPorts.has(`${e.inst}.${p.id}`) || internalOwners.size > 1 || peerBus;
      if (active && ['SDA', 'SCL'].includes(signal.toUpperCase()) && !bias.has(root)) issue(f, 'i2c-pullup-missing', 'I2C signal needs a verified resistor pull-up on its connected bus', `${e.inst}.${p.id}.${signal}`);
    }
  }
}
function review(b: BlockDef, f: Findings) {
  if (!sha(b.contentHash)) issue(f, 'block-hash', 'Block content hash must identify an immutable revision', b.id);
  for (const r of b.provenance.reviews) if (!r.by || !finite(Date.parse(r.at)) || !sha(r.contentHash)) issue(f, 'review-receipt', 'Review receipt needs reviewer, date and content hash', b.id);
  if (b.status === 'unreviewed') issue(f, 'unreviewed', 'Block has not passed independent promotion review', b.id, 'erc', 'warning');
  else {
    const matching = b.provenance.reviews.filter(r => r.contentHash === b.contentHash).sort((a, d) => Date.parse(a.at) - Date.parse(d.at));
    const r = matching.at(-1);
    if (!r || r.verdict !== 'pass' || r.by === b.provenance.authorId) issue(f, 'review-promotion', 'Reviewed status needs an independent passing review of this exact content hash', b.id);
  }
}
export function checkBlockDraft(draft: BlockDraft, catalog?: Map<string, CatalogPart>): GateResult[] {
  const f: Findings = { erc: [], power: [] };
  if (!validShape(draft, draftShape, 'block', f)) { issue(f, 'schema', 'Power analysis unavailable for a malformed block', 'block', 'power'); return gates(f); }
  if (catalog !== undefined && !(catalog instanceof Map)) { issue(f, 'catalog', 'Catalog receipts must be supplied as a Map'); return gates(f); }
  const b = draft as BlockDef; const m = model(b, f, catalog);
  if (!catalog) issue(f, 'catalog-unchecked', 'Catalog payload identity/pad coverage was not checked without catalog receipts', b.id, 'erc', 'warning');
  issue(f, 'unreviewed', 'Agent/human draft cannot promote itself; independent review is separate', b.id, 'erc', 'warning');
  graph([{ inst: b.id, model: m }], new Union(), f, true); return gates(f);
}
interface PlanContext { entries: Instance[]; u: Union; endpoints: Map<string, { entry: Instance; port: Port }>; validLinks: Array<{ from: string; to: string }> }
function requirementDeclarations(requirements: Requirement[], f: Findings): void {
  const ids = new Set<string>();
  for (const r of requirements) {
    if (!r.id.trim() || ids.has(r.id) || !r.plain.trim()) issue(f, 'requirement-identity', 'Requirements need unique nonempty ids and plain descriptions', r.id); ids.add(r.id);
    const tuple = Array.isArray(r.value);
    if (Array.isArray(r.value) && r.value.length !== 2) issue(f, 'requirement-value', 'Requirement range must contain exactly two numbers', r.id);
    if (r.op === 'within' && (!tuple || r.metric !== 'board_size_mm' && (r.value as number[])[0]! > (r.value as number[])[1]!)) issue(f, 'requirement-range', 'Within requires a finite ordered lower/upper pair', r.id);
    if (['>=', '<='].includes(r.op ?? '') && !(r.metric === 'board_size_mm' && r.op === '<=' && tuple) && typeof r.value !== 'number') issue(f, 'requirement-value', 'Numeric comparison requires a numeric target', r.id);
    if (r.op === '==' && r.value === undefined || r.op === 'present' && r.value !== undefined && typeof r.value !== 'string' || typeof r.value === 'string' && !r.value.trim()) issue(f, 'requirement-value', 'Requirement operator and target are incompatible', r.id);
    const values = typeof r.value === 'number' ? [r.value] : tuple ? r.value as number[] : [];
    if (r.metric !== 'net_voltage' && values.some(n => n < 0) || r.metric === 'board_size_mm' && values.some(n => n <= 0) || r.metric === 'part_count' && values.some(n => !Number.isInteger(n))) issue(f, 'requirement-bounds', 'Requirement target is outside the metric domain', r.id);
  }
}
function planContext(plan: BoardPlan, blocks: BlockDef[], f: Findings): PlanContext | undefined {
  if (!validShape(plan, planShape, 'plan', f) || !Array.isArray(blocks)) return;
  requirementDeclarations(plan.requirements ?? [], f);
  if (!plan.blocks.length) issue(f, 'plan-empty', 'Plan needs at least one block');
  if (plan.board && (plan.board.widthMm <= 0 || plan.board.heightMm <= 0 || plan.board.cornerRadiusMm !== undefined && (plan.board.cornerRadiusMm < 0 || plan.board.cornerRadiusMm > Math.min(plan.board.widthMm, plan.board.heightMm) / 2))) issue(f, 'board-size', 'Board dimensions/radius are invalid');
  const entries: Instance[] = []; const u = new Union(); const endpoints = new Map<string, { entry: Instance; port: Port }>(); const insts = new Set<string>();
  const definitions = new Map<string, BlockDef>();
  for (const b of blocks) { if (!validShape(b, blockShape, 'definition', f)) continue; const key = `${b.id}@${b.version}`; if (definitions.has(key)) issue(f, 'duplicate-definition', 'Block definitions share an id/version', key); definitions.set(key, b); }
  for (const i of plan.blocks) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(i.inst) || insts.has(i.inst)) { issue(f, 'instance', 'Block instance names must be valid and unique', i.inst); continue; } insts.add(i.inst);
    const b = definitions.get(`${i.block}@${i.version}`); if (!b) { issue(f, 'block-missing', 'Requested block revision is unavailable', i.inst); continue; }
    review(b, f); const m = model(b, f); const e = { inst: i.inst, model: m }; entries.push(e);
    for (const id of Object.keys(i.params)) if (!b.params.some(p => p.id === id)) issue(f, 'parameter-unknown', 'Unknown instance parameter', `${i.inst}.${id}`);
    for (const p of b.params) { const v = i.params[p.id] ?? p.default; if (p.type === 'number' ? !finite(v) || p.min !== undefined && v < p.min || p.max !== undefined && v > p.max : typeof v !== 'string' || !p.options?.includes(v)) issue(f, 'parameter-value', 'Instance parameter violates its declared bounds/options', `${i.inst}.${p.id}`); if (v !== p.default) issue(f, 'parameter-rebuild-required', 'Changed parameters require a newly materialized/checked block revision; static nets and values cannot be assumed updated', `${i.inst}.${p.id}`); }
    for (const p of b.ports) { endpoints.set(`${i.inst}.${p.id}`, { entry: e, port: p }); for (const n of m.portNodes(p).values()) u.find(`${i.inst}:${m.u.find(n)}`); }
  }
  if (plan.sections) {
    const ids = new Set<string>(); const assigned = new Set<string>();
    for (const section of plan.sections) {
      if (!section.id.trim() || ids.has(section.id) || !section.title.trim() || !section.purpose.trim() || !section.insts.length) issue(f, 'schematic-section', 'Sections need unique ids, titles, purpose and block instances', section.id); ids.add(section.id);
      for (const inst of section.insts) { if (!insts.has(inst) || assigned.has(inst)) issue(f, 'section-partition', 'Each section instance must exist and appear exactly once', inst); assigned.add(inst); }
      if (section.reference) { const r = section.reference; cited({ url: r.datasheetUrl }, f, section.id); if (!Number.isInteger(r.page) || r.page < 1 || !r.quote.trim()) issue(f, 'section-citation', 'Reference circuit needs a positive integer datasheet page and a source note', section.id); if (!entries.some(e => section.insts.includes(e.inst) && e.model.block.parts.some(p => p.lcsc === r.lcsc))) issue(f, 'section-reference-part', 'Reference citation must identify a real sourced part in its section', section.id); }
    }
    for (const inst of insts) if (!assigned.has(inst)) issue(f, 'section-partition', 'Every block instance must belong to exactly one explicit schematic section', inst);
  }
  if (plan.drafts) { const seen = new Set<string>(); for (const d of plan.drafts) { const key = `${d.id}@${d.version}`; if (seen.has(key)) issue(f, 'inline-draft', 'Inline draft revisions must be unique', d.id); seen.add(key); if (!definitions.has(key)) issue(f, 'inline-draft-unresolved', 'Inline draft must be materialized and checked by the public block library', d.id); } }
  const links = new Set<string>(); const validLinks: PlanContext['validLinks'] = [];
  for (const link of plan.links) {
    const a = endpoints.get(link.from); const d = endpoints.get(link.to); const key = [link.from, link.to].sort().join('|');
    if (!a || !d || link.from === link.to || links.has(key)) { issue(f, 'link', 'Link references unknown/same ports or duplicates an existing link', `${link.from} -> ${link.to}`); continue; } links.add(key);
    if (a.port.kind === 'bus' || d.port.kind === 'bus') {
      if (!a.port.bus || !d.port.bus || a.port.bus.protocol.toLowerCase() !== d.port.bus.protocol.toLowerCase() || Object.keys(a.port.bus.signals).sort().join('|') !== Object.keys(d.port.bus.signals).sort().join('|')) { issue(f, 'bus-match', 'Linked buses need the same protocol and named signal set', key); continue; }
    } else {
      const powerKinds = ['power-in', 'power-out'];
      if (a.port.kind === 'ground' || d.port.kind === 'ground' ? a.port.kind !== d.port.kind : powerKinds.includes(a.port.kind) || powerKinds.includes(d.port.kind) ? !powerKinds.includes(a.port.kind) || !powerKinds.includes(d.port.kind) : !['gpio', 'analog'].includes(a.port.kind) || !['gpio', 'analog'].includes(d.port.kind)) { issue(f, 'port-match', 'Linked port kinds are electrically incompatible', key); continue; }
    }
    if (a.port.fixedFunction || d.port.fixedFunction) {
      const mismatch = a.port.fixedFunction && d.port.fixedFunction && functionName(a.port.fixedFunction) !== functionName(d.port.fixedFunction);
      if (a.port.kind !== 'gpio' || d.port.kind !== 'gpio' || mismatch || a.entry.model.block.mcu && !a.port.fixedFunction || d.entry.model.block.mcu && !d.port.fixedFunction) { issue(f, 'fixed-control-link', 'Dedicated controls must connect matching GPIO controls, with explicit MCU control metadata', key); continue; }
    }
    const aa = a.entry.model.portNodes(a.port); const dd = d.entry.model.portNodes(d.port);
    for (const [signal, n] of aa) { const q = dd.get(signal); if (q !== undefined) u.join(`${a.entry.inst}:${a.entry.model.u.find(n)}`, `${d.entry.inst}:${d.entry.model.u.find(q)}`); }
    validLinks.push(link);
  }
  const buses = new Map<string, Array<{ instance: string; port: Port }>>();
  for (const [id, x] of endpoints) if (x.port.bus) { const ns = [...x.entry.model.portNodes(x.port)].map(([signal, n]) => `${signal}:${u.find(`${x.entry.inst}:${x.entry.model.u.find(n)}`)}`).sort(); const key = `${x.port.bus.protocol.toLowerCase()}|${ns.join('|')}`; const a = buses.get(key) ?? []; a.push({ instance: id, port: x.port }); buses.set(key, a); }
  for (const bus of buses.values()) {
    const controllers = bus.filter(x => x.port.bus?.role === 'controller'); const devices = bus.filter(x => x.port.bus?.role === 'peripheral');
    const protocol = protocolName(bus[0]!.port.bus!.protocol);
    const externalUsb = protocol === 'usb' && bus.some(x => x.port.bus?.role === 'passive');
    if (controllers.length > 1 || devices.length && !controllers.length && !externalUsb) issue(f, 'bus-controller', 'Bus needs one controller when peripherals are connected', bus.map(b => b.instance).join(', '));
    if (devices.length && !controllers.length && externalUsb) issue(f, 'usb-external-host', 'USB peripheral relies on an external host through the declared passive connector', bus.map(b => b.instance).join(', '), 'erc', 'warning');
    for (const d of devices) if (d.port.bus?.protocol.toLowerCase() === 'i2c' && !d.port.bus.i2cAddresses?.length) issue(f, 'i2c-address-unknown', 'I2C peripheral must declare its selected address', d.instance);
    const addresses = new Map<number, string>(); for (const device of devices) for (const a of device.port.bus?.i2cAddresses ?? []) { if (addresses.has(a)) issue(f, 'i2c-address-collision', `I2C address 0x${a.toString(16)} is claimed by two peripherals`, `${addresses.get(a)}, ${device.instance}`); addresses.set(a, device.instance); }
  }
  return { entries, u, endpoints, validLinks };
}
export function checkPlan(plan: BoardPlan, blocks: BlockDef[]): GateResult[] {
  const f: Findings = { erc: [], power: [] }; const c = planContext(plan, blocks, f);
  if (!c) issue(f, 'schema', 'Power analysis unavailable for a malformed plan', 'plan', 'power'); else graph(c.entries, c.u, f, false, new Set(c.validLinks.flatMap(link => [link.from, link.to])));
  if (c) for (const message of netNameIssues(plan, blocks)) issue(f, 'net-name', message, 'plan');
  return gates(f);
}
export function pinMap(plan: BoardPlan, blocks: BlockDef[]): PinMap {
  const checked = checkPlan(plan, blocks); const errors = checked.flatMap(g => g.issues.filter(i => i.severity === 'error'));
  if (errors.length) throw new Error(`Cannot map pins: ${errors.map(e => e.message).join('; ')}`);
  const f: Findings = { erc: [], power: [] }; const c = planContext(plan, blocks, f)!; const mcus = c.entries.filter(e => e.model.block.mcu);
  if (mcus.length !== 1) throw new Error('Pin map requires exactly one MCU block'); const mcu = mcus[0]!; const facts = mcu.model.block.mcu!;
  const out: PinMap = { family: facts.family, pio: structuredClone(facts.pio), pins: {}, libs: [], includes: [], usage: [] };
  for (const e of c.entries) { const fw = e.model.block.firmware; if (fw) { out.libs.push(...fw.libs); out.includes.push(...fw.includes); if (fw.usage) out.usage.push({ block: e.inst, note: fw.usage }); } }
  const keys = new Set<string>(); const connected = new Set(c.validLinks.flatMap(l => [l.from, l.to]));
  for (const [endpoint, remote] of c.endpoints) {
    if (remote.entry.inst === mcu.inst || remote.port.fixedFunction || !connected.has(endpoint) || ['ground', 'power-in', 'power-out'].includes(remote.port.kind)) continue;
    for (const [signal, n] of remote.entry.model.portNodes(remote.port)) {
      const root = c.u.find(`${remote.entry.inst}:${remote.entry.model.u.find(n)}`);
      const candidates = facts.pins.filter(p => !p.fixedFunction && c.u.find(`${mcu.inst}:${mcu.model.u.find(p.id)}`) === root);
      if (!candidates.length) continue; if (candidates.length !== 1) throw new Error(`Ambiguous MCU pin for ${endpoint}`); const p = candidates[0]!;
      if (p.reserved) throw new Error(`Reserved MCU pin ${p.id}: ${p.reserved}`);
      const key = `PIN_${remote.entry.inst}_${remote.port.id}${signal ? `_${signal}` : ''}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (keys.has(key)) throw new Error(`Pin name collision: ${key}`); keys.add(key);
      out.pins[key] = { gpio: p.gpio, port: `${endpoint}${signal ? `.${signal}` : ''}` };
    }
  }
  out.libs = [...new Set(out.libs)].sort(); out.includes = [...new Set(out.includes)].sort(); return out;
}
