// One model of a schematic sheet, whatever it came from: a carrier design, a chip plan, a partial plan while the
// agent is still adding to it, or a board that only has circuit.json. The canvas draws this and nothing else, so
// the sheet you watch grow is the sheet you end up editing.
import { CATALOG } from '../../../../src/circuit/catalog';
import type { CircuitDesign, ModuleCategory, PinKind } from '../../../../src/circuit/model';
import type { BoardPlan } from '../../../../src/blocks/contract';
import type { BoardModel } from '../pcbModel';

export type NetKind = 'power' | 'ground' | 'signal';
export type SymbolKind = 'chip' | 'resistor' | 'capacitor' | 'inductor' | 'led' | 'diode' | 'ldr' | 'piezo' | 'switch';

export interface SheetPin { id: string; label: string; number: string | null; role: PinKind | 'other'; required: boolean; net: string | null }
export interface SheetPart { ref: string; name: string; value?: string; symbol: SymbolKind; pins: SheetPin[]; module?: string; /** The block that owns it, on a chip board. */ inst?: string }
export interface SheetNet { id: string; name: string; kind: NetKind }
/** Where a chip board's blocks join. Keyed as the plan's links are: inst.PORT. */
export interface SheetPort { key: string; inst: string; port: string; label: string; /** Everything the library says about it, for hover. */ full: string; kind: string; links: string[] }
export interface SheetSection { id: string; title: string; notes: string[]; reference?: string; parts: string[]; ports?: SheetPort[] }
export interface Sheet { title: string; origin: 'design' | 'plan' | 'board'; sections: SheetSection[]; parts: SheetPart[]; nets: SheetNet[] }

export const EMPTY_SHEET: Sheet = { title: '', origin: 'design', sections: [], parts: [], nets: [] };

const SYMBOL_OF_MODULE: Record<string, SymbolKind> = { block: 'chip', resistor: 'resistor', ldr: 'ldr', led: 'led', piezo: 'piezo' };
const CATEGORY_TITLE: Record<ModuleCategory, string> = { controller: 'Controller', input: 'Input', sensor: 'Sensor', display: 'Display', output: 'Output', passive: 'Support' };
const CATEGORY_ORDER: readonly ModuleCategory[] = ['controller', 'input', 'sensor', 'display', 'output', 'passive'];

/** Carrier designs have no sections of their own. Each module gets one, and the passives go with what they serve. */
export function sheetFromDesign(design: CircuitDesign): Sheet {
  const netOfPin = new Map<string, string>();
  for (const net of design.nets) for (const e of net.endpoints) netOfPin.set(`${e.part}.${e.pin}`, net.id);
  const parts: SheetPart[] = design.parts.map(p => {
    const def = CATALOG.get(p.module);
    return {
      ref: p.id,
      name: def?.name ?? p.module,
      symbol: SYMBOL_OF_MODULE[def?.symbol ?? 'block'] ?? 'chip',
      module: p.module,
      ...(p.value ? { value: p.value } : {}),
      pins: (def?.pins ?? []).map((pin, i) => ({ id: pin.id, label: pin.label, number: String(i + 1), role: pin.kind, required: pin.required, net: netOfPin.get(`${p.id}.${pin.id}`) ?? null })),
    };
  });
  const categoryOf = (ref: string): ModuleCategory => CATALOG.get(design.parts.find(p => p.id === ref)?.module ?? '')?.category ?? 'passive';
  // Passives join whatever they share a signal with, except the controller: every signal reaches that.
  const group = new Map(parts.map(p => [p.ref, p.ref]));
  const find = (ref: string): string => { const up = group.get(ref); return !up || up === ref ? ref : find(up); };
  for (const net of design.nets) {
    if (net.kind !== 'signal') continue;
    const near = net.endpoints.map(e => e.part).filter(ref => categoryOf(ref) !== 'controller');
    for (const ref of near.slice(1)) {
      const [a, b] = [find(near[0]!), find(ref)];
      // Two modules on one bus keep their own sections. Only a passive is pulled in.
      if (a !== b && (isPassive(a) || isPassive(b))) group.set(isPassive(a) ? a : b, isPassive(a) ? b : a);
    }
  }
  function isPassive(ref: string) { return ['resistor', 'capacitor'].includes(parts.find(p => p.ref === ref)?.symbol ?? ''); }
  const groups = new Map<string, string[]>();
  for (const p of parts) { const root = find(p.ref); groups.set(root, [...(groups.get(root) ?? []), p.ref]); }
  const lead = (refs: string[]) => [...refs].sort((a, b) => CATEGORY_ORDER.indexOf(categoryOf(a)) - CATEGORY_ORDER.indexOf(categoryOf(b)))[0]!;
  const sections: SheetSection[] = [...groups.values()]
    .map(refs => {
      const first = lead(refs);
      const part = design.parts.find(p => p.id === first)!;
      const def = CATALOG.get(part.module);
      const chosen = design.parts.filter(p => refs.includes(p.id));
      const notes = [
        ...chosen.filter(p => p.role).slice(0, 2).map(p => (chosen.length > 1 ? `${p.id}: ${p.role}` : p.role)),
        ...design.notes.filter(n => n.part && refs.includes(n.part)).map(n => n.text),
      ];
      return { id: `s-${first}`, title: `${CATEGORY_TITLE[def?.category ?? 'passive']} — ${def?.name ?? part.module}`, notes, parts: refs };
    })
    .sort((a, b) => CATEGORY_ORDER.indexOf(categoryOf(a.parts[0]!)) - CATEGORY_ORDER.indexOf(categoryOf(b.parts[0]!)) || a.id.localeCompare(b.id));
  const loose = design.notes.filter(n => !n.part).map(n => n.text);
  if (loose.length) sections.push({ id: 's-notes', title: 'Notes', notes: loose, parts: [] });
  return { title: design.title, origin: 'design', parts, sections, nets: design.nets.map(n => ({ id: n.id, name: n.name, kind: n.kind })) };
}

/** What a chip design needs on top of its plan: the agent sends this for a partial plan, the build writes it after. */
export interface SheetGraph {
  parts: { ref: string; inst: string; title?: string; mpn?: string; value?: string; pins: { id: string; label: string; role?: string }[] }[];
  nets: { name: string; pins: { ref: string; pin: string }[] }[];
}

const ROLE_OF_BLOCK_PIN: Record<string, PinKind | 'other'> = { 'power-in': 'power-in', 'power-out': 'power-out', ground: 'ground', input: 'signal', output: 'signal', 'open-drain': 'signal', bidirectional: 'signal', passive: 'passive' };

export function chipSymbol(ref: string, pinCount: number, isSwitch = false): SymbolKind {
  if (isSwitch || /^(SW|S|BTN|K)\d/i.test(ref)) return 'switch';
  if (pinCount !== 2) return 'chip';
  if (/^R\d/i.test(ref)) return 'resistor';
  if (/^C\d/i.test(ref)) return 'capacitor';
  if (/^(L|FB)\d/i.test(ref)) return 'inductor';
  if (/^(LED|D)\d/i.test(ref)) return /^LED/i.test(ref) ? 'led' : 'diode';
  return 'chip';
}

/** A rail by what its name says. Only used where the source doesn't say outright, which a plan's graph doesn't. */
export function netKindOfName(name: string): NetKind {
  const upper = name.toUpperCase();
  if (/^(GND|VSS|AGND|DGND|PGND|EP)\d*$/.test(upper)) return 'ground';
  if (/^(\+|V\d|VCC|VDD|VBUS|VSYS|VBAT|VIN|VOUT|VREG|PLUS_)/.test(upper) || /^\d+V\d*$/.test(upper)) return 'power';
  return 'signal';
}

export function sheetFromGraph(plan: Pick<BoardPlan, 'title' | 'sections'> & Partial<Pick<BoardPlan, 'blocks'>>, graph: SheetGraph): Sheet {
  const netOfPin = new Map<string, string>();
  for (const net of graph.nets) for (const p of net.pins) netOfPin.set(`${p.ref}.${p.pin}`, net.name);
  const parts: SheetPart[] = graph.parts.map(p => {
    const pins: SheetPin[] = p.pins.map(pin => ({ id: pin.id, label: pin.label, number: pin.id, role: ROLE_OF_BLOCK_PIN[pin.role ?? ''] ?? 'other', required: false, net: netOfPin.get(`${p.ref}.${pin.id}`) ?? null }));
    return { ref: p.ref, name: p.mpn ?? p.title ?? p.ref, symbol: chipSymbol(p.ref, pins.length), pins, inst: p.inst, ...(p.value ? { value: p.value.replace(/\s*Ohm$/i, 'Ω') } : {}) };
  });
  const declared = plan.sections ?? [];
  const sections: SheetSection[] = declared.map(s => ({
    id: s.id,
    title: s.title,
    notes: s.notes,
    ...(s.reference ? { reference: `${s.reference.lcsc} · datasheet p${s.reference.page}${s.reference.figure ? ` · Fig ${s.reference.figure}` : ''}` } : {}),
    parts: graph.parts.filter(p => s.insts.includes(p.inst)).map(p => p.ref),
  }));
  const placed = new Set(sections.flatMap(s => s.parts));
  for (const inst of new Set(graph.parts.filter(p => !placed.has(p.ref)).map(p => p.inst))) {
    const members = graph.parts.filter(p => p.inst === inst);
    sections.push({ id: inst, title: members[0]?.title ?? inst, notes: [], parts: members.map(p => p.ref) });
  }
  return { title: plan.title, origin: 'plan', parts, sections, nets: graph.nets.map(n => ({ id: n.name, name: n.name, kind: netKindOfName(n.name) })) };
}

type AuditRow = { type: string; [key: string]: unknown };
export interface SchematicAudit { section: string; parts: { ref: string; inst: string; lcsc?: string }[]; circuitJson: AuditRow[] }

/** schematic-circuit.json, which a chip build writes, read into the same graph the agent sends live. */
export function graphFromAudit(audit: readonly SchematicAudit[]): SheetGraph {
  const parts = new Map<string, SheetGraph['parts'][number]>();
  const nets = new Map<string, Map<string, { ref: string; pin: string }>>();
  for (const section of audit) {
    const rows = section.circuitJson;
    const byType = (type: string) => rows.filter(r => r.type === type);
    const refOfComponent = new Map(byType('source_component').map(c => [String(c.source_component_id), c]));
    const portRef = new Map<string, { ref: string; pin: string }>();
    for (const port of byType('source_port')) {
      const component = refOfComponent.get(String(port.source_component_id));
      if (!component) continue;
      const ref = String(component.name);
      const owner = section.parts.find(p => p.ref === ref);
      const entry = parts.get(ref) ?? {
        ref,
        inst: owner?.inst ?? section.section,
        ...(typeof component.manufacturer_part_number === 'string' ? { mpn: component.manufacturer_part_number } : {}),
        ...(valueOf(component) ? { value: valueOf(component)! } : {}),
        pins: [],
      };
      const number = String(port.pin_number ?? port.name);
      const hints = Array.isArray(port.port_hints) ? port.port_hints.map(String) : [];
      // The hints are its logical names and its number. The first that isn't just "pin3" or "3" is what the datasheet calls it.
      const label = hints.find(h => !/^(pin)?\d+$/i.test(h)) ?? number;
      if (!entry.pins.some(p => p.id === number)) entry.pins.push({ id: number, label, role: port.requires_ground ? 'ground' : 'other' });
      parts.set(ref, entry);
      portRef.set(String(port.source_port_id), { ref, pin: number });
    }
    const netName = new Map(byType('source_net').map(n => [String(n.source_net_id), String(n.name)]));
    for (const trace of byType('source_trace')) {
      const named = (trace.connected_source_net_ids as unknown[] | undefined)?.map(id => netName.get(String(id))).find(Boolean);
      if (!named) continue;
      const members = nets.get(named) ?? new Map<string, { ref: string; pin: string }>();
      for (const id of (trace.connected_source_port_ids as unknown[] | undefined) ?? []) {
        const pin = portRef.get(String(id));
        if (pin) members.set(`${pin.ref}.${pin.pin}`, pin);
      }
      nets.set(named, members);
    }
  }
  return { parts: [...parts.values()], nets: [...nets].map(([name, pins]) => ({ name, pins: [...pins.values()] })) };
}

function valueOf(component: AuditRow): string | null {
  for (const key of ['display_resistance', 'display_capacitance', 'display_inductance', 'display_value']) if (typeof component[key] === 'string') return component[key] as string;
  return null;
}

export interface BlockPortInfo { id: string; label: string; kind: string }
export interface BlockParamInfo { id: string; type: 'number' | 'enum'; min?: number; max?: number; options?: string[]; unit?: string; default: number | string }
export interface BlockInfo { id: string; version: number; title: string; summary: string; class: string; status: string; parts: number; ports: BlockPortInfo[]; params?: BlockParamInfo[] }

/** Adds each section's ports, from the library. A block the library doesn't list just has none to click. */
export function withPorts(sheet: Sheet, plan: Pick<BoardPlan, 'links' | 'sections' | 'blocks'>, blocks: readonly BlockInfo[]): Sheet {
  const infoOf = (inst: string) => { const id = plan.blocks.find(b => b.inst === inst)?.block; return id ? blocks.find(b => b.id === id) : undefined; };
  return {
    ...sheet,
    sections: sheet.sections.map(section => {
      const insts = plan.sections?.find(s => s.id === section.id)?.insts ?? [section.id];
      const ports = insts.flatMap(inst => (infoOf(inst)?.ports ?? []).map((port): SheetPort => {
        const key = `${inst}.${port.id}`;
        // "GPIO4 / ADC / PWM" says what the port can do. On the sheet, its name is enough.
        const short = port.label.split(' / ')[0]!;
        return { key, inst, port: port.id, label: insts.length > 1 ? `${inst}.${short}` : short, full: port.label, kind: port.kind, links: plan.links.flatMap(l => (l.from === key ? [l.to] : l.to === key ? [l.from] : [])) };
      }));
      // A block added by hand is titled with its id until something better is known, and the library knows.
      const titled = blocks.find(b => b.id === section.title)?.title;
      return { ...section, ...(titled ? { title: titled } : {}), ...(ports.length ? { ports } : {}) };
    }),
  };
}

/** A build with only circuit.json, such as edited TSX. Drawable, but there's no design to edit. */
export function sheetFromBoard(model: BoardModel, title: string): Sheet {
  const parts: SheetPart[] = model.parts.map(p => ({
    ref: p.ref,
    name: p.name ?? p.ref,
    symbol: chipSymbol(p.ref, p.pins.length),
    pins: p.pins.map((pin, i) => ({ id: pin.label || String(pin.number ?? i + 1), label: pin.label || String(pin.number ?? i + 1), number: pin.number === null ? null : String(pin.number), role: 'other', required: false, net: pin.net })),
  }));
  const chips = parts.filter(p => p.symbol === 'chip');
  const support = parts.filter(p => p.symbol !== 'chip');
  return {
    title,
    origin: 'board',
    parts,
    sections: [
      ...chips.map(p => ({ id: `s-${p.ref}`, title: p.name, notes: [], parts: [p.ref] })),
      ...(support.length ? [{ id: 's-support', title: 'Support', notes: [], parts: support.map(p => p.ref) }] : []),
    ],
    nets: [...model.nets.values()].map(n => ({ id: n.id, name: n.name, kind: n.ground ? 'ground' : n.power ? 'power' : 'signal' })),
  };
}

/**
 * Everything but the parts not yet revealed. A section waits for its first part. One that never had parts, like the
 * sheet's notes, stays: fully revealed has to lay out exactly like the final sheet, or the view jumps when the build lands.
 */
export function revealOnly(sheet: Sheet, visible: ReadonlySet<string>): Sheet {
  const parts = sheet.parts.filter(p => visible.has(p.ref));
  const sections = sheet.sections.filter(s => !s.parts.length || s.parts.some(ref => visible.has(ref))).map(s => ({ ...s, parts: s.parts.filter(ref => visible.has(ref)) }));
  return { ...sheet, parts, sections };
}

export const partLabelOf = (sheet: Sheet, ref: string): string => { const p = sheet.parts.find(q => q.ref === ref); return p ? `${p.ref} · ${p.name}` : ref; };
