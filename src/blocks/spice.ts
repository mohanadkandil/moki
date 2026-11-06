import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { runWorker } from '../board/process.js';
import { checkPlan } from './erc.js';
import { schematicHash } from './review.js';
import type { BlockDef, BlockPart, BoardPlan, Citation, GateResult, SpiceCheck } from './contract.js';

export interface SpiceTask { kind: SpiceCheck['kind']; values: number[]; threshold?: number; openSwitches?: number }
interface Profile { where: string; recipe: SpiceCheck; task: SpiceTask; unit: string; openSwitches?: string[] }
export interface SpiceOptions { artifactDir?: string; timeoutMs?: number; bun?: string }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function fail(message: string): never { throw new Error(message); }
function bound(n: unknown, min: number, max: number): number { return finite(n) && n >= min && n <= max ? n : fail('SPICE numeric parameter is outside its safe profile bounds'); }
function cited(c: Citation | undefined): void {
  if (!c || !c.pages?.trim()) fail('SPICE recipe and component values need a datasheet page citation');
  let url: URL; try { url = new URL(c.url); } catch { fail('Invalid SPICE citation'); }
  if (url!.protocol !== 'https:' || c.sha256 && !/^[a-f0-9]{64}$/i.test(c.sha256)) fail('Invalid SPICE citation');
}
function quantity(p: BlockPart, type: 'R' | 'C'): number {
  cited(p.valueWhy);
  if (!p.ref.startsWith(type)) fail(`${p.ref} is not identified as a ${type === 'R' ? 'resistor' : 'capacitor'}`);
  const text = p.value?.replace(/\s/g, '') ?? '';
  const m = type === 'R' ? text.match(/^(\d+(?:\.\d+)?)([kKMm]?)(?:Ω|Ω|ohms?|R)?$/i) : text.match(/^(\d+(?:\.\d+)?)([pnuµμm]?)F$/);
  if (!m) fail(`Unsupported actual ${type} value on ${p.ref}`);
  const scale = type === 'R' ? ({ '': 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3 } as Record<string, number>)[m![2]!] : ({ '': 1, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3 } as Record<string, number>)[m![2]!];
  return bound(Number(m![1]) * scale!, type === 'R' ? 1 : 1e-12, type === 'R' ? 1e9 : 1);
}
class Union {
  p = new Map<string, string>();
  find(s: string): string { const p = this.p.get(s); if (!p) { this.p.set(s, s); return s; } if (p === s) return s; const root = this.find(p); this.p.set(s, root); return root; }
  join(a: string, b: string) { this.p.set(this.find(a), this.find(b)); }
}
/** Numeric-only fixed templates. No model-authored directives, names, paths or netlists. */
export function createSpiceNetlist(task: SpiceTask): string {
  if (!task || !Array.isArray(task.values)) fail('Invalid SPICE worker task');
  if (task.openSwitches !== undefined && (task.kind !== 'rc-reset' || !Number.isSafeInteger(task.openSwitches) || task.openSwitches < 1 || task.openSwitches > 32)) fail('Invalid explicit open-switch model');
  let body: string;
  const n = task.values;
  switch (task.kind) {
    case 'rc-reset': {
      if (n.length !== 3) fail('Invalid RC task'); const r = bound(n[0], 1, 1e9), c = bound(n[1], 1e-12, 1), v = bound(n[2], .01, 60);
      bound(task.threshold, .01, .99); const tau = bound(r * c, 1e-7, 10);
      body = `V1 supply 0 DC ${v}\nR1 supply out ${r}\nC1 out 0 ${c} IC=0\n.tran ${tau / 500} ${tau * 8} UIC\n.save v(out)`; break;
    }
    case 'divider': {
      if (n.length !== 3) fail('Invalid divider task'); const r1 = bound(n[0], 1, 1e9), r2 = bound(n[1], 1, 1e9), v = bound(n[2], .01, 60);
      body = `V1 supply 0 DC ${v}\nR1 supply out ${r1}\nR2 out 0 ${r2}\n.tran 1u 10u\n.save v(out)`; break;
    }
    case 'resistor-current': case 'led-current': {
      if (n.length !== (task.kind === 'led-current' ? 3 : 2)) fail('Invalid current task'); const r = bound(n[0], 1, 1e9), v = bound(n[1], .01, 60);
      const vf = task.kind === 'led-current' ? bound(n[2], .01, v) : 0;
      body = `V1 supply 0 DC ${v}\nR1 supply out ${r}\nVdrop out 0 DC ${vf}\n.tran 1u 10u\n.save i(V1)`; break;
    }
    case 'charge-current': {
      if (n.length !== 2) fail('Invalid charge task'); const r = bound(n[0], 1, 1e9), coefficient = bound(n[1], .001, 1e6);
      // Ideal documented Icharge = coefficient(A*ohm)/Rprog law. Not an IC macromodel.
      body = `Vprog prog 0 DC 1\nRprog prog 0 ${r}\nFmirror 0 out Vprog ${-coefficient}\nRload out 0 1\n.tran 1u 10u\n.save v(out)`; break;
    }
    default: fail('Unsupported required SPICE profile');
  }
  const switches = task.openSwitches ? `* ${task.openSwitches} explicitly declared normally-open reset switch(es): out-to-ground contacts held OPEN\n` : '';
  return `Moki fixed ${task.kind} profile\n${switches}${body!}\n.end\n`;
}
function profiles(plan: BoardPlan, blocks: BlockDef[]): Profile[] {
  const u = new Union(), definitions = new Map(blocks.map(b => [`${b.id}@${b.version}`, b]));
  const entries = plan.blocks.map(i => ({ inst: i.inst, b: definitions.get(`${i.block}@${i.version}`)! }));
  const endpoint = new Map<string, Map<string, string>>();
  for (const { inst, b } of entries) {
    for (const net of b.nets) for (const pin of net.pins) u.join(`${inst}:net:${net.name}`, `${inst}:${pin}`);
    for (const port of b.ports) endpoint.set(`${inst}.${port.id}`, new Map(Object.entries(port.bus?.signals ?? { '': port.terminal! }).map(([key, t]) => [key, `${inst}:${t}`])));
  }
  for (const link of plan.links) for (const [key, node] of endpoint.get(link.from)!) u.join(node, endpoint.get(link.to)!.get(key)!);
  const ground = new Set<string>(), rails = new Map<string, number[]>();
  for (const { inst, b } of entries) {
    for (const p of b.ports) if (p.kind === 'ground') ground.add(u.find(`${inst}:${p.terminal}`));
    for (const source of b.power.sources) {
      const p = b.ports.find(p => p.id === source.port)!; const node = u.find(`${inst}:${p.terminal}`);
      rails.set(node, [...rails.get(node) ?? [], source.volts]);
    }
  }
  const allPins = entries.flatMap(({ inst, b }) => b.parts.flatMap(part => Object.entries(part.pins).map(([name, pin]) => ({ inst, part, name, pin, node: u.find(`${inst}:${part.ref}.${name}`) }))));
  const supply = (node: string, volts: number) => rails.get(node)?.some(v => Math.abs(v - volts) < 1e-6) ?? false;
  const out: Profile[] = [];
  for (const { inst, b } of entries) {
    const part = (ref: string) => b.parts.find(p => p.ref === ref) ?? fail(`Unknown SPICE component ${ref}`);
    const pins = (p: BlockPart) => allPins.filter(pin => pin.inst === inst && pin.part.ref === p.ref);
    const two = (ref: string, type: 'R' | 'C', statedOhm?: number) => { const p = part(ref), ps = pins(p); if (ps.length !== 2 || ps.some(p => p.pin.role !== 'passive') || ps[0]!.node === ps[1]!.node) fail(`${ref} must be a wired two-terminal passive`); return { p, nodes: ps.map(p => p.node), value: statedOhm === undefined ? quantity(p, type) : bound(statedOhm, 1, 1e9) }; };
    const onlyInputs = (node: string, allowed: BlockPart[], allowOpenReset = false): string[] => {
      const openSwitches = new Set<string>();
      for (const p of allPins.filter(p => p.node === node && !(p.inst === inst && allowed.includes(p.part)))) {
        if (allowOpenReset && p.part.switch === 'normally-open') {
          const electrical = allPins.filter(q => q.inst === p.inst && q.part === p.part && q.pin.role !== 'nc');
          if (electrical.length !== 2 || electrical.some(q => !['passive', 'ground'].includes(q.pin.role)) || p.part.value !== undefined ||
            electrical.filter(q => q.node === node).length !== 1 || !electrical.some(q => q.node !== node && ground.has(q.node))) fail('Explicit normally-open reset switch must have exactly two passive/ground electrical pins from reset to ground and no R/C value');
          cited(p.part.datasheet); openSwitches.add(`${p.inst}.${p.part.ref}`); continue;
        }
        if (p.pin.role !== 'input') fail('SPICE profile omits a load or driver on the measured node');
      }
      if (openSwitches.size > 32) fail('Too many explicit reset switches');
      return [...openSwitches];
    };
    for (const recipe of b.spiceChecks ?? []) {
      cited(recipe.citation); if (!recipe.name?.trim() || recipe.name.length > 160) fail('SPICE check needs a bounded name');
      bound(recipe.target, 0, 1e9); bound(recipe.tolerance, 0, 1e9);
      let task: SpiceTask, unit: string, openSwitches: string[] = [];
      if (recipe.kind === 'rc-reset' || recipe.kind === 'divider') {
        const a = two(recipe.kind === 'rc-reset' ? recipe.resistor : recipe.upper, 'R', recipe.kind === 'divider' ? recipe.upperOhm : undefined);
        const c = two(recipe.kind === 'rc-reset' ? recipe.capacitor : recipe.lower, recipe.kind === 'rc-reset' ? 'C' : 'R', recipe.kind === 'divider' ? recipe.lowerOhm : undefined);
        if (a.p === c.p) fail('SPICE profile components must be distinct');
        const shared = a.nodes.filter(n => c.nodes.includes(n)); if (shared.length !== 1) fail('RC/divider components must share exactly one node');
        const mid = shared[0]!, high = a.nodes.find(n => n !== mid)!, low = c.nodes.find(n => n !== mid)!;
        const v = recipe.kind === 'rc-reset' ? recipe.supplyV : recipe.inputV;
        if (!ground.has(low) || !supply(high, v) || ground.has(mid) || rails.has(mid)) fail('RC/divider wiring or declared supply does not match the actual network');
        // A resistor that only feeds inputs carries no DC current, so it doesn't load the node. Its far side has to prove that.
        const series = recipe.kind === 'divider' && recipe.series ? two(recipe.series, 'R') : undefined;
        if (series) {
          if (series.p === a.p || series.p === c.p || !series.nodes.includes(mid)) fail('Series resistor must leave the measured node');
          onlyInputs(series.nodes.find(n => n !== mid)!, [series.p]);
        }
        openSwitches = onlyInputs(mid, [a.p, c.p, ...(series ? [series.p] : [])], recipe.kind === 'rc-reset');
        task = { kind: recipe.kind, values: [a.value, c.value, v], ...(recipe.kind === 'rc-reset' ? { threshold: recipe.thresholdRatio } : {}), ...(openSwitches.length ? { openSwitches: openSwitches.length } : {}) }; unit = recipe.kind === 'rc-reset' ? 'ms' : 'V';
      } else {
        const r = two(recipe.resistor, 'R'); const low = r.nodes.find(n => ground.has(n)), high = r.nodes.find(n => !ground.has(n));
        if (recipe.kind === 'charge-current') {
          if (!low || !high) fail('Charger programming resistor must return to ground');
          const charger = b.constraints.filter(c => c.kind === 'battery-path').map(c => c.charger);
          const ic = allPins.find(p => p.inst === inst && p.node === high && charger.includes(p.part.ref) && /^(PROG|ISET)$/i.test(p.name));
          if (!ic || !['input', 'passive'].includes(ic.pin.role)) fail('Charge profile resistor must reach the declared charger PROG/ISET pin');
          if (allPins.some(p => p.node === high && !(p.inst === inst && (p.part === r.p || p === ic)))) fail('Charge programming network has an unmodeled branch');
          task = { kind: recipe.kind, values: [r.value, recipe.coefficient] };
        } else if (recipe.kind === 'led-current') {
          const high = r.nodes.find(n => supply(n, recipe.supplyV)), mid = r.nodes.find(n => n !== high);
          if (!high || !mid) fail('LED resistor does not reach the declared supply');
          const closed = recipe.switch ? part(recipe.switch) : undefined;
          if (closed && !pins(closed).some(q => /^(S|SOURCE|E|EMITTER)$/i.test(q.name) && ground.has(q.node))) fail('LED switch must return to ground');
          if (Boolean(closed) !== (recipe.switchDropV !== undefined)) fail('An LED switch needs both the transistor and its on-state drop');
          const led = b.parts.find(p => p.ref.startsWith('D') && pins(p).length === 2 && pins(p).every(q => q.pin.role === 'passive') && pins(p).some(q => /^(A|ANODE)$/i.test(q.name) && q.node === mid) && pins(p).some(q => /^(K|CATHODE)$/i.test(q.name) && (ground.has(q.node) || (closed ? pins(closed).some(d => /^(D|DRAIN|C|COLLECTOR)$/i.test(d.name) && d.node === q.node) : false))));
          if (!led) fail('LED profile needs an actual series anode/cathode LED to ground');
          cited(led.datasheet); onlyInputs(mid, [r.p, led]);
          task = { kind: recipe.kind, values: [r.value, recipe.supplyV, recipe.forwardV + (closed ? bound(recipe.switchDropV, 0, recipe.supplyV) : 0)] };
        } else if (recipe.kind === 'resistor-current') {
          if (!low || !high || !supply(high, recipe.voltageV)) fail('Resistor current profile must match actual rail and ground');
          task = { kind: recipe.kind, values: [r.value, recipe.voltageV] };
        } else fail('Unsupported required SPICE profile');
        unit = 'mA';
      }
      createSpiceNetlist(task!); out.push({ where: `${inst}.${recipe.name}`, recipe, task: task!, unit: unit!, ...(openSwitches.length ? { openSwitches } : {}) });
      if (out.length > 32) fail('At most 32 SPICE checks may run in one plan');
    }
  }
  return out;
}
/** Absolute tolerance uses profile units: RC milliseconds, divider volts, currents milliamps. */
export async function runSpiceChecks(plan: BoardPlan, blocks: BlockDef[], options: SpiceOptions = {}): Promise<GateResult> {
  const gate: GateResult = { gate: 'spice', ok: false, issues: [], measurements: [] };
  try { gate.inputHash = schematicHash(plan, blocks); } catch { /* Schema failures are returned below. */ }
  let phase: 'model'|'engine' = 'model';
  try {
    const prereq = checkPlan(plan, blocks).flatMap(g => g.issues.filter(i => i.severity === 'error'));
    if (prereq.length) fail(`SPICE requires a valid ERC/power plan: ${prereq.map(i => i.message).slice(0, 5).join('; ')}`);
    const checks = profiles(plan, blocks);
    if (!checks.length) return { gate: 'spice', inputHash: gate.inputHash, ok: true, issues: [{ rule: 'spice-coverage', severity: 'warning', message: 'No applicable SPICE profiles declared; electrical behavior is not simulated' }], measurements: [] };
    phase = 'engine';
    const timeout = bound(options.timeoutMs ?? 30_000, 100, 60_000);
    const root = resolve(options.artifactDir ?? process.env.MOKI_BLOCK_SPICE_DIR ?? 'var/block-spice'); await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'run-')), input = join(dir, 'input.json'), output = join(dir, 'output.json');
    const data = JSON.stringify({ schema: 'moki.spice-input/1', tasks: checks.map(c => c.task) });
    await writeFile(input, data, { mode: 0o600 });
    const runner = fileURLToPath(new URL('../../eda/blocks/spice-runner.ts', import.meta.url));
    const result = await runWorker(options.bun ?? process.env.MOKI_BUN ?? join(homedir(), '.bun/bin/bun'), [runner, input, output], fileURLToPath(new URL('../../eda/', import.meta.url)), timeout);
    if (result.code !== 0) fail(`SPICE engine failed: ${(result.stderr || result.stdout).slice(-1500)}`);
    if ((await stat(output)).size > 16 * 1024 * 1024) fail('SPICE result exceeded the audit size bound');
    const raw = JSON.parse(await readFile(output, 'utf8'));
    if (raw.schema !== 'moki.spice-output/1' || raw.inputSha256 !== createHash('sha256').update(data).digest('hex') || !Array.isArray(raw.results) || raw.results.length !== checks.length) fail('SPICE result identity mismatch');
    for (const [index, c] of checks.entries()) {
      const measured = measure(c.task, raw.results[index].result);
      const ok = Math.abs(measured - c.recipe.target) <= c.recipe.tolerance;
      gate.measurements!.push({ where: c.where, name: c.recipe.kind, measured, target: c.recipe.target, tolerance: c.recipe.tolerance, unit: c.unit, ok });
      if (!ok) gate.issues.push({ rule: 'spice-target', severity: 'error', where: c.where, message: `Measured ${measured} ${c.unit}; target ${c.recipe.target} ± ${c.recipe.tolerance} ${c.unit}` });
      if (c.openSwitches?.length) gate.issues.push({ rule: 'spice-open-switch', severity: 'warning', where: c.where, message: `Explicit normally-open contacts held open: ${c.openSwitches.join(', ')}; pressed/bounce behavior is not simulated` });
      if (['led-current', 'charge-current'].includes(c.task.kind)) gate.issues.push({ rule: 'spice-ideal-model', severity: 'warning', where: c.where, message: c.task.kind === 'led-current' ? 'Fixed forward-voltage LED model; not diode temperature/tolerance or dynamic behavior' : 'Ideal datasheet programming-current law; not a charger macromodel, battery, thermal or safety prediction' });
    }
    gate.issues.push({ rule: 'spice-coverage', severity: 'warning', message: 'Only declared isolated profiles are simulated; this is not whole-board analog verification' });
    gate.issues.push({ rule: 'spice-evidence', severity: 'warning', message: `Fixed netlists and raw engine results: ${output}` });
    gate.ok = !gate.issues.some(i => i.severity === 'error');
    await writeFile(join(dir, 'gate.json'), JSON.stringify({ plan, blockHashes: blocks.map(b => ({ id: b.id, version: b.version, contentHash: b.contentHash })), checks, gate }, null, 2), { mode: 0o600 });
  } catch (error) { gate.ok = false; gate.issues.push({ rule: phase === 'model' ? 'spice-model' : 'spice-unavailable', severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
  return gate;
}
function measure(task: SpiceTask, result: any): number {
  const graphs = result?.simulationResultCircuitJson;
  if (!Array.isArray(graphs)) fail('SPICE returned no measured graphs');
  const current = task.kind === 'resistor-current' || task.kind === 'led-current';
  const graph = graphs.find((g: any) => g.type === `simulation_transient_${current ? 'current' : 'voltage'}_graph` && (current ? /^v1(?:#branch)?$/i.test(g.name) || /^i\(v1\)$/i.test(g.name) : g.name === 'out'));
  const levels = current ? graph?.current_levels : graph?.voltage_levels, times = graph?.timestamps_ms;
  if (!Array.isArray(levels) || !levels.length || !Array.isArray(times) || times.length !== levels.length || levels.some(v => !finite(v)) || times.some((v, i) => !finite(v) || i > 0 && v < times[i - 1])) fail('SPICE returned invalid measured samples');
  if (task.kind === 'rc-reset') {
    const threshold = task.values[2]! * task.threshold!;
    const i = levels.findIndex(v => v >= threshold); if (i < 1 || levels[i] <= levels[i - 1]) fail('RC threshold not crossed in simulation');
    return times[i - 1] + (times[i] - times[i - 1]) * (threshold - levels[i - 1]) / (levels[i] - levels[i - 1]);
  }
  return current ? -levels.at(-1)! * 1000 : task.kind === 'charge-current' ? levels.at(-1)! * 1000 : levels.at(-1)!;
}
