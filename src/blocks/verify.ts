import type { BlockDef, BoardPlan, DeviceFacts, GateResult, Requirement, RequirementMetricDef, RequirementResult } from './contract.js';
import { checkPlan } from './erc.js';
import { schematicHash } from './review.js';

export const REQUIREMENT_METRICS: readonly RequirementMetricDef[] = [
  { metric: 'battery_life_h', plain: 'Ideal same-rail hours from battery capacity and typical input current; requires a known battery path.', args: { capacity_mah: 'number' }, ops: ['>=', '<='], unit: 'h', needs: ['power'] },
  { metric: 'current_budget_ma', plain: 'Conservative peak input current at one upstream supply.', args: {}, ops: ['<='], unit: 'mA', needs: ['power'] },
  { metric: 'interface_present', plain: 'A declared interface such as usb_c_sink, display or i2s_mic is present.', args: { kind: 'string' }, ops: ['present'], needs: ['plan'] },
  { metric: 'board_size_mm', plain: 'Board width and height each fit their corresponding positive bound.', args: {}, ops: ['within', '<='], unit: 'mm', needs: ['plan'] },
  { metric: 'pin_capability', plain: 'The named signal has a validated, nonempty MCU capability mapping.', args: { signal: 'string' }, ops: ['present'], needs: ['plan'] },
  { metric: 'net_voltage', plain: 'Actual SPICE voltage measurement lies in the specified interval.', args: { net: 'string' }, ops: ['within'], unit: 'V', needs: ['spice'] },
  { metric: 'part_count', plain: 'Count of declared board parts.', args: {}, ops: ['<=', '>='], needs: ['plan'] },
  { metric: 'bom_cost_usd', plain: 'Total BOM cost, only when every price is known.', args: {}, ops: ['<='], unit: 'USD', needs: ['catalog'] },
];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const object = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v) && [null, Object.prototype].includes(Object.getPrototypeOf(v)));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 160 && !/[\x00-\x1f\x7f]/.test(v);
const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const evidenceText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 8192;
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(finite);
function invalid(raw: unknown, ids: Set<string>): string | undefined {
  if (!object(raw)) return 'Requirement must be a plain object';
  if (!text(raw.id) || !/^[A-Za-z0-9_-]{1,30}$/.test(raw.id) || ids.has(raw.id)) return 'Requirement needs a short unique id';
  ids.add(raw.id);
  if (!text(raw.plain) || !['brief', 'answer', 'default', 'inferred', 'maker'].includes(raw.source)) return 'Requirement needs plain text and a valid source';
  if (Object.keys(raw).some(k => !['id', 'plain', 'metric', 'args', 'op', 'value', 'unit', 'source'].includes(k))) return 'Unknown requirement field';
  const metric = REQUIREMENT_METRICS.find(m => m.metric === raw.metric); if (!metric) return 'Unknown requirement metric';
  const op = raw.op ?? (metric.ops.length === 1 && metric.ops[0] === 'present' ? 'present' : undefined);
  if (!metric.ops.includes(op)) return 'Missing or unsupported comparison operator';
  if (raw.unit !== undefined && raw.unit !== metric.unit) return `Unit must be ${metric.unit ?? 'omitted'}`;
  if (raw.args !== undefined && !object(raw.args)) return 'Arguments must be a plain object';
  const args = raw.args ?? {};
  if (Object.keys(args).some(k => !Object.hasOwn(metric.args, k))) return 'Unknown metric argument';
  for (const [key, type] of Object.entries(metric.args)) {
    // An omitted battery override is equivalent to zero: use the design capacity.
    if (raw.metric === 'battery_life_h' && args[key] === undefined) continue;
    if (type === 'string' ? !text(args[key]) : !finite(args[key])) return `Invalid ${key} argument`;
    if (type === 'string' && !normal(args[key])) return `Invalid ${key} identifier`;
  }
  if (raw.metric === 'battery_life_h' && args.capacity_mah !== undefined && (args.capacity_mah < 0 || args.capacity_mah > 1e9)) return 'Battery capacity must be between zero and 1e9 mAh';
  if (op === 'present') return raw.value === undefined ? undefined : 'Presence checks do not take a target value';
  if (raw.metric === 'board_size_mm') return pair(raw.value) && raw.value.every(n => n > 0 && n <= 1e6) ? undefined : 'Board size needs positive [width,height] in mm';
  if (raw.metric === 'net_voltage') return pair(raw.value) && raw.value[0] >= 0 && raw.value[1] >= raw.value[0] && raw.value[1] <= 1e6 ? undefined : 'Voltage needs ordered nonnegative [low,high] in volts';
  if (!finite(raw.value) || raw.value < 0 || raw.value > 1e12) return 'Target must be a finite nonnegative number in the metric unit';
  if (raw.metric === 'part_count' && !Number.isSafeInteger(raw.value)) return 'Part count target must be an integer';
  return undefined;
}
function load(facts: DeviceFacts) { const l = facts.loadMa; return l && positive(l.typical) && positive(l.peak) && l.peak >= l.typical && typeof l.estimated === 'boolean' ? l : undefined; }
/** Unsupported has no completion pass. Gate.ok is false on failures; callers require every result to pass for done. */
export function evaluateRequirements(requirements: Requirement[], facts: DeviceFacts): GateResult {
  const gate: GateResult = { gate: 'verify', ok: true, issues: [], results: [] };
  if (!Array.isArray(requirements) || requirements.length > 12) return { gate: 'verify', ok: false, issues: [{ rule: 'requirement-schema', severity: 'error', message: 'Expected at most 12 requirements' }], results: [] };
  const ids = new Set<string>();
  for (const [index, raw] of requirements.entries()) {
    const error = invalid(raw, ids), id = object(raw) && typeof raw.id === 'string' ? raw.id : `invalid-${index}`;
    let result: RequirementResult;
    if (error) result = { id, status: 'fail', evidence: `Invalid requirement schema: ${error}` };
    else if (!object(facts)) result = { id, status: 'unsupported', evidence: 'Device facts are unavailable' };
    else result = evaluate(raw, facts);
    gate.results!.push(result);
    if (result.status !== 'pass') gate.issues.push({ rule: result.status === 'fail' ? 'requirement-failed' : 'requirement-unsupported', severity: result.status === 'fail' ? 'error' : 'warning', where: id, message: result.evidence });
  }
  gate.ok = !gate.results!.some(r => r.status === 'fail'); return gate;
}
function evaluate(r: Requirement, f: DeviceFacts): RequirementResult {
  const metric = REQUIREMENT_METRICS.find(m => m.metric === r.metric)!, op = r.op ?? 'present';
  const base = { id: r.id, ...(r.value !== undefined ? { target: r.value } : {}), ...(metric.unit ? { unit: metric.unit } : {}) };
  const unsupported = (evidence: string, extra: Partial<RequirementResult> = {}): RequirementResult => ({ ...base, status: 'unsupported', evidence, ...extra });
  const compare = (measured: number, evidence: string, estimated?: boolean): RequirementResult => ({ ...base, status: (op === '>=' ? measured >= Number(r.value) : measured <= Number(r.value)) ? 'pass' : 'fail', measured, evidence, ...(estimated !== undefined ? { estimated } : {}) });
  switch (r.metric) {
    case 'battery_life_h': {
      const l = load(f), override = r.args?.capacity_mah, capacity = positive(override) ? override : f.batteryMah;
      if (!l || !positive(capacity) || capacity > 1e9) return unsupported('Battery hours need positive known capacity and finite positive typical/peak load; zero/unknown load cannot predict runtime');
      const hours = capacity / l.typical;
      if (!finite(hours)) return unsupported('Battery estimate is outside finite numeric bounds');
      const evidence = `Ideal same-rail estimate: ${capacity} mAh / ${l.typical} mA = ${hours} h; excludes battery derating, duty-cycle variation, cutoff and unmodeled losses`;
      if (f.batteryPresent !== true) return unsupported(`No known battery/power path. Hypothetical ${evidence}`, { measured: hours, estimated: true });
      return compare(hours, evidence, true);
    }
    case 'current_budget_ma': { const l = load(f); return l ? compare(l.peak, 'Peak upstream input current from declared load/conversion facts; not a hardware current measurement', l.estimated) : unsupported('Peak input current is unknown, zero or malformed'); }
    case 'interface_present': {
      if (!Array.isArray(f.interfaces) || f.interfaces.some(i => !text(i))) return unsupported('Interface facts are unavailable or malformed');
      const wanted = normal(String(r.args!.kind)), present = f.interfaces.some(i => normal(i) === wanted);
      return { ...base, status: present ? 'pass' : 'fail', measured: present ? wanted : 'absent', target: wanted, evidence: `Declared interface ${wanted} ${present ? 'is present' : 'is absent'}` };
    }
    case 'board_size_mm': {
      if (!pair(f.boardMm) || f.boardMm.some(n => !positive(n))) return unsupported('Board width/height are not known positive dimensions');
      const target = r.value as [number, number]; return { ...base, status: f.boardMm.every((n, i) => n <= target[i]!) ? 'pass' : 'fail', measured: [...f.boardMm], evidence: `Board [width,height] ${f.boardMm.join(' × ')} mm compared coordinatewise to ${target.join(' × ')} mm; no implicit rotation` };
    }
    case 'pin_capability': {
      if (!object(f.signals)) return unsupported('Validated MCU signal facts are unavailable');
      const signal = String(r.args!.signal), keys = Object.keys(f.signals).filter(k => normal(k) === normal(signal));
      if (keys.length !== 1) return unsupported('Signal has no unique validated MCU capability mapping');
      const caps = f.signals[keys[0]!]; if (!Array.isArray(caps) || !caps.length || caps.some(c => !text(c))) return unsupported('Signal capability list is missing, empty or invalid');
      return { ...base, status: 'pass', measured: [...new Set(caps)].join(', '), target: signal, evidence: `Validated declared MCU pin functions for ${signal}: ${caps.join(', ')}` };
    }
    case 'net_voltage': {
      const net = String(r.args!.net), volts = object(f.netVolts) && Object.hasOwn(f.netVolts, net) ? f.netVolts[net] : undefined;
      const evidence = object(f.netVoltEvidence) && Object.hasOwn(f.netVoltEvidence, net) ? f.netVoltEvidence[net] : undefined;
      if (!finite(volts) || volts < 0 || !evidenceText(evidence)) return unsupported('Net voltage needs an actual SPICE measurement and its evidence; nominal design voltage alone is insufficient');
      const [lo, hi] = r.value as [number, number]; return { ...base, status: volts >= lo && volts <= hi ? 'pass' : 'fail', measured: volts, evidence: `SPICE net ${net}: ${volts} V. ${evidence}` };
    }
    case 'part_count': return Number.isSafeInteger(f.partCount) && f.partCount! >= 0 ? compare(f.partCount!, 'Count of declared parts across plan instances') : unsupported('Part count is unavailable');
    case 'bom_cost_usd': return finite(f.bomCostUsd) && f.bomCostUsd >= 0 ? compare(f.bomCostUsd, 'Complete supplied BOM cost in USD; pricing date/quantity belong to source evidence') : unsupported('Complete catalog price facts are unavailable; no cost is invented');
  }
}
class Union {
  p = new Map<string, string>();
  find(s: string): string { const p = this.p.get(s); if (!p) { this.p.set(s, s); return s; } if (p === s) return s; const root = this.find(p); this.p.set(s, root); return root; }
  join(a: string, b: string) { this.p.set(this.find(a), this.find(b)); }
}
/** Conservative plan facts. No BOM price/cell capacity or nominal-as-measured voltage is invented. */
export function factsFromPlan(plan: BoardPlan, blocks: BlockDef[], spice?: GateResult): DeviceFacts {
  const f: DeviceFacts = { interfaces: [], signals: Object.create(null), netVolts: Object.create(null), netVoltEvidence: Object.create(null), batteryPresent: false };
  try {
    // Requirement evaluation is separate from electrical validity and does not alter connectivity.
    const electrical = { ...plan }; delete electrical.requirements;
    if (checkPlan(electrical, blocks).some(g => !g.ok || g.issues.some(i => i.severity === 'error'))) return f;
    const defs = new Map(blocks.map(b => [`${b.id}@${b.version}`, b]));
    const entries = plan.blocks.map(i => ({ inst: i.inst, b: defs.get(`${i.block}@${i.version}`)! }));
    const u = new Union(), ports = new Map<string, Map<string, string>>();
    const local = (inst: string, t: string) => `${inst}:${t}`;
    for (const { inst, b } of entries) {
      for (const net of b.nets) for (const pin of net.pins) u.join(local(inst, `net:${net.name}`), local(inst, pin));
      for (const p of b.ports) ports.set(`${inst}.${p.id}`, new Map(Object.entries(p.bus?.signals ?? { '': p.terminal! }).map(([key, t]) => [key, local(inst, t)])));
    }
    for (const link of plan.links) for (const [key, t] of ports.get(link.from)!) u.join(t, ports.get(link.to)!.get(key)!);
    const node = (inst: string, port: string) => u.find(ports.get(`${inst}.${port}`)!.get('')!);
    const interfaces = new Set<string>();
    for (const { b } of entries) {
      interfaces.add(normal(b.id)); interfaces.add(normal(b.class));
      // A J part is a connector, whatever function its block is named for.
      if (b.parts.some(part => /^J\d/i.test(part.ref))) interfaces.add('connector');
      for (const p of b.ports) if (p.bus) interfaces.add(normal(p.bus.protocol));
      if (b.constraints.some(c => c.kind === 'usb-c-sink')) { interfaces.add('usb_c_sink'); interfaces.add('usb_power'); }
    }
    f.interfaces = [...interfaces].filter(Boolean).sort(); f.partCount = entries.reduce((n, e) => n + e.b.parts.length, 0);
    if (plan.board && positive(plan.board.widthMm) && positive(plan.board.heightMm)) f.boardMm = [plan.board.widthMm, plan.board.heightMm];
    const aliases = new Map<string, Array<{ caps: string[]; origin: string }>>();
    const add = (key: string, caps: string[], origin: string) => { const name = normal(key); aliases.set(name, [...aliases.get(name) ?? [], { caps, origin }]); };
    const mcus = entries.flatMap(({ inst, b }) => (b.mcu?.pins ?? []).filter(p => !p.reserved && !p.fixedFunction).map(p => ({ ...p, inst, root: u.find(local(inst, p.id)) })));
    for (const m of mcus) for (const key of [`${m.inst}.${m.id}`, `${m.inst}.${m.gpio}`, String(m.gpio), typeof m.gpio === 'number' ? `GPIO${m.gpio}` : String(m.gpio)]) add(key, m.caps, `${m.inst}.${m.id}`);
    for (const { inst, b } of entries) for (const p of b.ports.filter(p => ['bus', 'gpio', 'analog'].includes(p.kind) && !p.fixedFunction)) {
      const mapped: string[][] = [], mappedOrigins: string[] = [];
      for (const [signal, t] of ports.get(`${inst}.${p.id}`)!) {
        const actual = mcus.filter(m => m.root === u.find(t)); if (actual.length !== 1) continue;
        mapped.push(actual[0]!.caps);
        const origin = `${actual[0]!.inst}.${actual[0]!.id}`; mappedOrigins.push(origin);
        if (signal) for (const key of [`${inst}.${p.id}.${signal}`, `${p.id}.${signal}`]) add(key, actual[0]!.caps, origin);
      }
      if (mapped.length === ports.get(`${inst}.${p.id}`)!.size && mapped.length) {
        const common = mapped[0]!.filter(cap => mapped.every(c => c.includes(cap)));
        for (const key of [`${inst}.${p.id}`, p.id, inst, b.id]) add(key, common, [...new Set(mappedOrigins)].sort().join('|'));
      }
    }
    for (const [alias, rows] of aliases) {
      const signatures = new Set(rows.map(c => [...new Set(c.caps)].sort().join('\0'))), origins = new Set(rows.map(c => c.origin));
      if (signatures.size === 1 && origins.size === 1 && rows[0]!.caps.length) f.signals[alias] = [...new Set(rows[0]!.caps)];
    }
    // Count each direct sink once, then propagate downstream demand to its upstream root.
    const sources = entries.flatMap(({ inst, b }) => b.power.sources.map(s => ({ ...s, inst, b, out: node(inst, s.port), input: s.inputPort ? node(inst, s.inputPort) : undefined, maxV: b.ports.find(p => p.id === s.port)?.volts?.max ?? s.volts, minV: b.ports.find(p => p.id === s.port)?.volts?.min ?? s.volts })));
    const direct = new Map<string, { typical: number; peak: number }>();
    const addLoad = (at: string, typical: number, peak: number) => { const old = direct.get(at) ?? { typical: 0, peak: 0 }; direct.set(at, { typical: old.typical + typical, peak: old.peak + peak }); };
    for (const { inst, b } of entries) for (const sink of b.power.sinks) addLoad(node(inst, sink.port), sink.typicalMa, sink.peakMa);
    for (const s of sources) if (s.mode === 'charger') addLoad(s.out, s.continuousMa ?? s.maxMa, s.maxMa);
    const roots = sources.filter(s => s.mode === 'external' && !s.input);
    if (roots.length === 1) {
      const visited = new Set<string>(), active = new Set<string>();
      const demand = (at: string): { typical: number; peak: number } => {
        if (active.has(at)) throw new Error('Power cycle'); active.add(at); visited.add(at);
        const total = { ...direct.get(at) ?? { typical: 0, peak: 0 } };
        for (const s of sources.filter(s => s.input === at)) {
          const child = demand(s.out), upstream = sources.find(p => p.out === at);
          const scale = s.conversion === 'linear' ? 1 : s.conversion === 'switching' && upstream && positive(upstream.minV) && positive(s.efficiency) ? s.maxV / (upstream.minV * s.efficiency) : NaN;
          if (!positive(scale)) throw new Error('Unknown conversion'); total.typical += child.typical * scale; total.peak += child.peak * scale;
        }
        active.delete(at); return total;
      };
      const total = demand(roots[0]!.out);
      if ([...direct.keys()].every(n => visited.has(n)) && positive(total.typical) && positive(total.peak)) f.loadMa = { ...total, estimated: true };
      f.batteryPresent = ['battery', 'battery_source', 'lipo_battery', 'lipo'].includes(normal(roots[0]!.b.class));
    }
    // Bind only actual SPICE divider-output measurements to their real shared node.
    const artifact = spice?.issues.find(i => i.rule === 'spice-evidence')?.message;
    if (spice?.gate === 'spice' && spice.ok && spice.inputHash === schematicHash(plan, blocks) && !spice.issues.some(i => i.severity === 'error') && evidenceText(artifact)) {
      const measured = new Map<string, { volts: number; evidence: string }>();
      for (const { inst, b } of entries) for (const recipe of b.spiceChecks ?? []) if (recipe.kind === 'divider') {
        const m = spice.measurements?.find(m => m.where === `${inst}.${recipe.name}` && m.name === 'divider' && m.unit === 'V' && m.ok && finite(m.measured));
        if (!m) continue;
        const a = b.parts.find(p => p.ref === recipe.upper), c = b.parts.find(p => p.ref === recipe.lower); if (!a || !c) continue;
        const an = Object.keys(a.pins).map(p => u.find(local(inst, `${a.ref}.${p}`))), cn = Object.keys(c.pins).map(p => u.find(local(inst, `${c.ref}.${p}`)));
        const shared = [...new Set(an.filter(n => cn.includes(n)))]; if (shared.length === 1) measured.set(shared[0]!, { volts: m.measured, evidence: `${m.where}; ${artifact}` });
      }
      const names = new Map<string, Set<string>>();
      for (const { inst, b } of entries) for (const net of b.nets) {
        const root = u.find(local(inst, `net:${net.name}`)), value = measured.get(root);
        names.set(net.name, new Set([...(names.get(net.name) ?? []), root]));
        if (!value) continue;
        f.netVolts[`${inst}.${net.name}`] = value.volts; f.netVoltEvidence![`${inst}.${net.name}`] = value.evidence;
      }
      for (const [name, nodes] of names) if (nodes.size === 1) { const value = measured.get([...nodes][0]!); if (value) { f.netVolts[name] = value.volts; f.netVoltEvidence![name] = value.evidence; } }
    }
  } catch { /* Missing/malformed graph facts cannot be manufactured into evidence. */ }
  return f;
}
