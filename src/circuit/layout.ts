import { moduleDef } from './catalog.js';
import type { CircuitDesign, Direction, ModuleDef, Net, NetKind, PartInstance, PhysicalDrawing, SchematicSymbol, TemplateId } from './model.js';

// Geometry for both views, derived from one CircuitDesign. Every drawn pin and every wire carries
// the net ID it belongs to, so selection and highlighting in either view use the same topology.

export interface Pt { x: number; y: number }

// ───────────────────────────── Schematic ─────────────────────────────

export interface SchematicPin { part: string; pin: string; label: string; base: Pt; end: Pt; side: Direction; net: string | null }
export interface SchematicPart { id: string; module: string; symbol: SchematicSymbol; name: string; value?: string; box: { x: number; y: number; w: number; h: number }; pins: SchematicPin[] }
export interface SchematicWire { net: string; a: Pt; b: Pt }
export interface PowerFlag { net: string; kind: 'power' | 'ground'; at: Pt; dir: 'up' | 'down'; label: string }
export interface NetLabel { net: string; at: Pt; text: string }
export interface SchematicLayout { width: number; height: number; parts: SchematicPart[]; wires: SchematicWire[]; flags: PowerFlag[]; junctions: Array<{ net: string; at: Pt }>; labels: NetLabel[] }

const LEAD = 20;
const PITCH = 20;
const MCU_X = 40;
const MCU_W = 150;
const BLOCK_W = 140;
const FLAG_SPACE = 34;
const TOP = 70;
const GROUP_GAP = 40;
/** Space above the first side pin: room for the top pin labels and the module name. */
export const BLOCK_HEADER = 52;

/** Vertical arrangement of the peripheral column, per template. Missing parts are skipped. */
const SCHEMATIC_GROUPS: Record<TemplateId, string[][]> = {
  'focus-timer': [['U2'], ['SW1'], ['BZ1']],
  'light-lamp': [['LDR1', 'R1'], ['R2', 'D1']],
  'temp-monitor': [['R1', 'U3'], ['U2'], ['BZ1']],
};

function netIndex(design: CircuitDesign): Map<string, Net> {
  const map = new Map<string, Net>();
  for (const net of design.nets) for (const e of net.endpoints) map.set(`${e.part}.${e.pin}`, net);
  return map;
}

function translatePart(part: SchematicPart, dx: number, dy: number): void {
  part.box.x += dx; part.box.y += dy;
  for (const pin of part.pins) { pin.base.x += dx; pin.base.y += dy; pin.end.x += dx; pin.end.y += dy; }
}

function extent(part: SchematicPart, nets: Map<string, Net>): { top: number; bottom: number } {
  let top = part.box.y;
  let bottom = part.box.y + part.box.h;
  for (const pin of part.pins) {
    const kind = nets.get(`${part.id}.${pin.pin}`)?.kind;
    const flag = kind === 'power' || kind === 'ground' ? FLAG_SPACE : 0;
    top = Math.min(top, pin.end.y - (pin.side === 'up' ? flag : 0));
    bottom = Math.max(bottom, pin.end.y + (pin.side === 'down' ? flag : 0));
  }
  return { top, bottom };
}

function blockPart(instance: PartInstance, def: ModuleDef, nets: Map<string, Net>, x: number, y: number): SchematicPart {
  const isMcu = def.category === 'controller';
  const shown = def.pins.filter(p => !isMcu || nets.has(`${instance.id}.${p.id}`));
  const top = shown.filter(p => p.kind === 'power-in' || p.kind === 'power-out');
  const bottom = shown.filter(p => p.kind === 'ground');
  const side = shown.filter(p => p.kind === 'gpio' || p.kind === 'signal');
  const w = isMcu ? MCU_W : BLOCK_W;
  const h = Math.max(70, BLOCK_HEADER + side.length * PITCH);
  const pins: SchematicPin[] = [];
  const spread = (list: typeof shown, edgeY: number, dir: 'up' | 'down') => list.forEach((p, i) => {
    const px = x + w / 2 + (i - (list.length - 1) / 2) * 40;
    pins.push({ part: instance.id, pin: p.id, label: p.label, base: { x: px, y: edgeY }, end: { x: px, y: edgeY + (dir === 'up' ? -LEAD : LEAD) }, side: dir, net: nets.get(`${instance.id}.${p.id}`)?.id ?? null });
  });
  spread(top, y, 'up');
  spread(bottom, y + h, 'down');
  side.forEach((p, i) => {
    const py = y + BLOCK_HEADER + i * PITCH;
    const bx = isMcu ? x + w : x;
    pins.push({ part: instance.id, pin: p.id, label: p.label, base: { x: bx, y: py }, end: { x: isMcu ? bx + LEAD : bx - LEAD, y: py }, side: isMcu ? 'right' : 'left', net: nets.get(`${instance.id}.${p.id}`)?.id ?? null });
  });
  return { id: instance.id, module: def.id, symbol: 'block', name: def.name, ...(instance.value ? { value: instance.value } : {}), box: { x, y, w, h }, pins };
}

function twoPinPart(instance: PartInstance, def: ModuleDef, nets: Map<string, Net>, cx: number, cy: number): SchematicPart {
  const [first, second] = def.pins;
  if (!first || !second || def.pins.length !== 2) throw new Error(`${def.id} is not a two-terminal part`);
  const kindOf = (pin: string): NetKind | undefined => nets.get(`${instance.id}.${pin}`)?.kind;
  // Supplies at the top, ground at the bottom, so power flags never point into the part.
  const flip = kindOf(first.id) === 'ground' || kindOf(second.id) === 'power';
  const [upper, lower] = flip ? [second, first] : [first, second];
  const make = (p: typeof first, dir: 'up' | 'down'): SchematicPin => ({
    part: instance.id, pin: p.id, label: p.label,
    base: { x: cx, y: cy + (dir === 'up' ? -20 : 20) }, end: { x: cx, y: cy + (dir === 'up' ? -40 : 40) }, side: dir,
    net: nets.get(`${instance.id}.${p.id}`)?.id ?? null,
  });
  return { id: instance.id, module: def.id, symbol: def.symbol, name: def.name, ...(instance.value ? { value: instance.value } : {}), box: { x: cx - 10, y: cy - 20, w: 20, h: 40 }, pins: [make(upper, 'up'), make(lower, 'down')] };
}

function sharedPinY(passive: SchematicPart, block: SchematicPart): { passivePin: SchematicPin; blockPin: SchematicPin } | null {
  for (const pp of passive.pins) for (const bp of block.pins) if (pp.net && pp.net === bp.net && bp.side === 'left') return { passivePin: pp, blockPin: bp };
  return null;
}

export function schematicLayout(design: CircuitDesign): SchematicLayout {
  const nets = netIndex(design);
  const instances = new Map(design.parts.map(p => [p.id, p]));
  const mcuInstance = design.parts.find(p => moduleDef(p.module).category === 'controller');
  if (!mcuInstance) throw new Error('Design has no controller');
  const signalNetsWithMcu = design.nets.filter(n => n.kind === 'signal' && n.endpoints.some(e => e.part === mcuInstance.id)).length;
  const colX = MCU_X + MCU_W + LEAD + 40 + signalNetsWithMcu * PITCH;

  // Peripheral column.
  const placed: SchematicPart[] = [];
  const groups = SCHEMATIC_GROUPS[design.template].map(g => g.filter(id => instances.has(id))).filter(g => g.length);
  const grouped = new Set(groups.flat());
  for (const p of design.parts) if (p.id !== mcuInstance.id && !grouped.has(p.id)) groups.push([p.id]);
  let cursor = TOP;
  for (const group of groups) {
    const members: SchematicPart[] = [];
    const defs = group.map(id => moduleDef(instances.get(id)!.module));
    const allTwoPin = defs.every(d => d.symbol !== 'block');
    if (allTwoPin) {
      group.forEach((id, i) => members.push(twoPinPart(instances.get(id)!, defs[i]!, nets, colX + 30, i * 80)));
    } else {
      let x = colX;
      const blockIndex = defs.findIndex(d => d.symbol === 'block');
      const passives = group.filter((_, i) => defs[i]!.symbol !== 'block').length;
      const block = blockPart(instances.get(group[blockIndex]!)!, defs[blockIndex]!, nets, colX + passives * 60 + LEAD, 0);
      group.forEach((id, i) => {
        if (i === blockIndex) return;
        const part = twoPinPart(instances.get(id)!, defs[i]!, nets, x + 30, 0);
        const shared = sharedPinY(part, block);
        if (shared) translatePart(part, 0, shared.blockPin.end.y - shared.passivePin.end.y);
        members.push(part);
        x += 60;
      });
      members.push(block);
    }
    const ext = members.map(m => extent(m, nets));
    const top = Math.min(...ext.map(e => e.top));
    const bottom = Math.max(...ext.map(e => e.bottom));
    for (const m of members) translatePart(m, 0, cursor - top);
    placed.push(...members);
    cursor += bottom - top + GROUP_GAP;
  }

  // Controller: GPIO pins line up with the parts they serve wherever pin spacing allows.
  const mcuDef = moduleDef(mcuInstance.module);
  const mcu = blockPart(mcuInstance, mcuDef, nets, MCU_X, 0);
  const endAt = new Map<string, Pt>();
  for (const part of placed) for (const pin of part.pins) endAt.set(`${part.id}.${pin.pin}`, pin.end);
  const side = mcu.pins.filter(p => p.side === 'right');
  const desired = side.map(pin => {
    const net = nets.get(`${mcu.id}.${pin.pin}`)!;
    const others = net.endpoints.filter(e => e.part !== mcu.id).map(e => endAt.get(`${e.part}.${e.pin}`)!).filter(Boolean);
    return { pin, y: others.length ? Math.min(...others.map(o => o.y)) : 0 };
  }).sort((a, b) => a.y - b.y || a.pin.pin.localeCompare(b.pin.pin));
  let last = -Infinity;
  for (const d of desired) {
    const y = Math.max(d.y, last + PITCH);
    d.pin.base.y = y; d.pin.end.y = y; last = y;
  }
  const firstY = desired[0]?.pin.base.y ?? TOP + 60;
  const mcuTop = firstY - BLOCK_HEADER;
  const mcuBottom = Math.max(last + 30, mcuTop + 80);
  mcu.box.y = mcuTop; mcu.box.h = mcuBottom - mcuTop;
  for (const pin of mcu.pins) {
    if (pin.side === 'up') { pin.base.y = mcuTop; pin.end.y = mcuTop - LEAD; }
    if (pin.side === 'down') { pin.base.y = mcuBottom; pin.end.y = mcuBottom + LEAD; }
  }
  const parts = [mcu, ...placed];
  for (const p of parts) for (const pin of p.pins) endAt.set(`${p.id}.${pin.pin}`, pin.end);

  // Signal routing: straight where aligned, otherwise a vertical trunk in its own channel.
  const wires: SchematicWire[] = [];
  const trunkNets: Array<{ net: Net; points: Pt[] }> = [];
  const fixedHorizontals: Array<{ net: string; y: number; x1: number; x2: number }> = [];
  for (const net of design.nets) {
    if (net.kind !== 'signal') continue;
    const points = uniquePoints(net.endpoints.map(e => endAt.get(`${e.part}.${e.pin}`)!));
    if (points.length < 2) continue;
    if (points.every(p => p.y === points[0]!.y)) {
      const xs = points.map(p => p.x);
      wires.push({ net: net.id, a: { x: Math.min(...xs), y: points[0]!.y }, b: { x: Math.max(...xs), y: points[0]!.y } });
      fixedHorizontals.push({ net: net.id, y: points[0]!.y, x1: Math.min(...xs), x2: Math.max(...xs) });
    } else if (points.every(p => p.x === points[0]!.x)) {
      const ys = points.map(p => p.y);
      wires.push({ net: net.id, a: { x: points[0]!.x, y: Math.min(...ys) }, b: { x: points[0]!.x, y: Math.max(...ys) } });
    } else {
      trunkNets.push({ net, points });
    }
  }
  const channelX = (i: number) => MCU_X + MCU_W + LEAD + 20 + i * PITCH;
  const order = bestChannelOrder(trunkNets, fixedHorizontals, channelX);
  order.forEach((t, i) => {
    const x = channelX(i);
    const taps = new Map<string, { y: number; x: number }>();
    for (const p of t.points) {
      if (p.x === x) continue;
      const key = `${p.y}:${p.x > x ? 'r' : 'l'}`;
      const prev = taps.get(key);
      if (!prev || Math.abs(p.x - x) > Math.abs(prev.x - x)) taps.set(key, p);
    }
    for (const p of taps.values()) wires.push({ net: t.net.id, a: { x, y: p.y }, b: { x: p.x, y: p.y } });
    const ys = t.points.map(p => p.y);
    wires.push({ net: t.net.id, a: { x, y: Math.min(...ys) }, b: { x, y: Math.max(...ys) } });
  });

  // Junction dots where three or more wire arms meet on one net.
  const junctions: Array<{ net: string; at: Pt }> = [];
  for (const net of design.nets) {
    if (net.kind !== 'signal') continue;
    const segs = wires.filter(w => w.net === net.id);
    const pinEnds = net.endpoints.map(e => endAt.get(`${e.part}.${e.pin}`)!);
    const candidates = uniquePoints([...pinEnds, ...segs.flatMap(s => [s.a, s.b])]);
    for (const c of candidates) {
      let arms = pinEnds.filter(p => same(p, c)).length;
      for (const s of segs) {
        if (same(s.a, c) || same(s.b, c)) arms += 1;
        else if (onSegment(c, s)) arms += 2;
      }
      if (arms >= 3) junctions.push({ net: net.id, at: c });
    }
  }

  const flags: PowerFlag[] = [];
  const labels: NetLabel[] = [];
  for (const part of parts) for (const pin of part.pins) {
    const net = nets.get(`${part.id}.${pin.pin}`);
    if (!net) continue;
    if (net.kind === 'power' || net.kind === 'ground') flags.push({ net: net.id, kind: net.kind, at: pin.end, dir: pin.side === 'down' ? 'down' : 'up', label: net.name });
    if (net.kind === 'signal' && part.id === mcu.id) labels.push({ net: net.id, at: { x: pin.end.x + 6, y: pin.end.y - 5 }, text: net.name });
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of parts) { xs.push(p.box.x, p.box.x + p.box.w + 120); ys.push(p.box.y, p.box.y + p.box.h); for (const pin of p.pins) { xs.push(pin.end.x); ys.push(pin.end.y); } }
  for (const f of flags) ys.push(f.at.y + (f.dir === 'up' ? -FLAG_SPACE : FLAG_SPACE));
  const width = Math.ceil(Math.max(...xs) + 30);
  const height = Math.ceil(Math.max(...ys) + 40);
  return { width, height, parts, wires, flags, junctions, labels };
}

function same(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function uniquePoints(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (!out.some(o => same(o, p))) out.push({ ...p });
  return out;
}

function onSegment(p: Pt, s: SchematicWire): boolean {
  if (Math.abs(s.a.y - s.b.y) < 0.01) return Math.abs(p.y - s.a.y) < 0.01 && p.x > Math.min(s.a.x, s.b.x) && p.x < Math.max(s.a.x, s.b.x);
  if (Math.abs(s.a.x - s.b.x) < 0.01) return Math.abs(p.x - s.a.x) < 0.01 && p.y > Math.min(s.a.y, s.b.y) && p.y < Math.max(s.a.y, s.b.y);
  return false;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

function bestChannelOrder(trunks: Array<{ net: Net; points: Pt[] }>, fixed: Array<{ net: string; y: number; x1: number; x2: number }>, channelX: (i: number) => number) {
  const sorted = [...trunks].sort((a, b) => a.net.id.localeCompare(b.net.id));
  if (sorted.length <= 1 || sorted.length > 6) return sorted;
  let best = sorted;
  let bestScore = Infinity;
  for (const order of permutations(sorted)) {
    const verticals = order.map((t, i) => ({ net: t.net.id, x: channelX(i), y1: Math.min(...t.points.map(p => p.y)), y2: Math.max(...t.points.map(p => p.y)) }));
    const horizontals = [...fixed, ...order.flatMap((t, i) => t.points.map(p => ({ net: t.net.id, y: p.y, x1: Math.min(p.x, channelX(i)), x2: Math.max(p.x, channelX(i)) })))];
    let score = 0;
    for (const v of verticals) for (const h of horizontals) if (h.net !== v.net && v.x > h.x1 && v.x < h.x2 && h.y > v.y1 && h.y < v.y2) score++;
    if (score < bestScore) { bestScore = score; best = order; }
  }
  return best;
}

// ───────────────────────────── Physical ─────────────────────────────

export interface PhysicalPin { part: string; pin: string; label: string; at: Pt; dir: Direction; net: string | null }
export interface PhysicalPart { id: string; module: string; drawing: PhysicalDrawing; name: string; value?: string; x: number; y: number; w: number; h: number; pins: PhysicalPin[] }
export interface PhysicalWire { net: string; kind: NetKind; color: string; d: string; from: Pt; to: Pt }
export interface PhysicalRail { side: 'top' | 'bottom'; x1: number; x2: number; y: number; rows: Array<{ net: string; kind: 'power' | 'ground'; y: number; label: string }> }
export interface PhysicalLayout { width: number; height: number; parts: PhysicalPart[]; wires: PhysicalWire[]; rails: PhysicalRail[]; splices: Array<{ net: string; at: Pt }> }

export const MAT = { w: 170, h: 132 };

/** Bench positions in millimetres, per template. Approximate arrangement for clarity. */
const PLACEMENT: Record<TemplateId, Record<string, Pt>> = {
  'focus-timer': { U1: { x: 66, y: 30 }, SW1: { x: 14, y: 40 }, U2: { x: 112, y: 36 }, BZ1: { x: 118, y: 84 } },
  'light-lamp': { U1: { x: 98, y: 30 }, LDR1: { x: 28, y: 42 }, R1: { x: 46, y: 64 }, R2: { x: 64, y: 58 }, D1: { x: 74, y: 86 } },
  'temp-monitor': { U1: { x: 38, y: 30 }, U2: { x: 102, y: 30 }, U3: { x: 106, y: 78 }, R1: { x: 90, y: 70 }, BZ1: { x: 138, y: 80 } },
};

/** Clear spots on the mat for parts a template has no position for, which custom firmware can add. */
const SPARE_SPOTS: readonly Pt[] = [{ x: 14, y: 88 }, { x: 34, y: 88 }, { x: 54, y: 88 }, { x: 74, y: 88 }, { x: 94, y: 88 }, { x: 142, y: 84 }, { x: 148, y: 30 }, { x: 148, y: 54 }, { x: 14, y: 16 }, { x: 42, y: 74 }];

const SIGNAL_COLORS = ['#ffc83d', '#3d8bff', '#ff8a3d', '#f4f4ef', '#5ce1e6', '#ff7ab6', '#c7f464', '#c08457'];
const POWER_COLOR = '#e5383b';
const GROUND_COLOR = '#1f2023';

const RAIL_ROWS = { top: { power: 9, ground: 14 }, bottom: { power: MAT.h - 14, ground: MAT.h - 9 } } as const;

const VEC: Record<Direction, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function curve(a: Pt, aDir: Pt, b: Pt, bDir: Pt): string {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const k = Math.min(30, Math.max(6, dist * 0.42));
  const c1 = { x: a.x + aDir.x * k, y: a.y + aDir.y * k };
  const c2 = { x: b.x + bDir.x * k, y: b.y + bDir.y * k };
  return `M${r2(a.x)} ${r2(a.y)} C${r2(c1.x)} ${r2(c1.y)} ${r2(c2.x)} ${r2(c2.y)} ${r2(b.x)} ${r2(b.y)}`;
}

export function physicalLayout(design: CircuitDesign): PhysicalLayout {
  const nets = netIndex(design);
  const placement = PLACEMENT[design.template];
  let spare = 0;
  const parts: PhysicalPart[] = design.parts.map(instance => {
    const def = moduleDef(instance.module);
    const at = placement[instance.id] ?? SPARE_SPOTS[spare++];
    if (!at) throw new Error(`No bench position for ${instance.id} in ${design.template}`);
    return {
      id: instance.id, module: def.id, drawing: def.drawing, name: def.name, ...(instance.value ? { value: instance.value } : {}),
      x: at.x, y: at.y, w: def.size.w, h: def.size.h,
      pins: def.pins.map(p => ({ part: instance.id, pin: p.id, label: p.label, at: { x: r2(at.x + p.physical.x), y: r2(at.y + p.physical.y) }, dir: p.physical.dir, net: nets.get(`${instance.id}.${p.id}`)?.id ?? null })),
    };
  });
  const pinAt = new Map<string, PhysicalPin>();
  for (const part of parts) for (const pin of part.pins) pinAt.set(`${part.id}.${pin.pin}`, pin);

  const wires: PhysicalWire[] = [];
  const splices: Array<{ net: string; at: Pt }> = [];
  const railUse = new Map<string, Set<'top' | 'bottom'>>();
  let colorIndex = 0;
  const x1 = 6;
  const x2 = MAT.w - 6;
  for (const net of design.nets) {
    const pins = net.endpoints.map(e => pinAt.get(`${e.part}.${e.pin}`)!);
    if (net.kind === 'power' || net.kind === 'ground') {
      const color = net.kind === 'power' ? POWER_COLOR : GROUND_COLOR;
      for (const pin of pins) {
        const side: 'top' | 'bottom' = pin.dir === 'up' ? 'top' : pin.dir === 'down' ? 'bottom' : pin.at.y < MAT.h / 2 ? 'top' : 'bottom';
        const y = RAIL_ROWS[side][net.kind];
        const x = Math.min(x2 - 14, Math.max(x1 + 3, pin.at.x + (pin.dir === 'left' ? -4 : pin.dir === 'right' ? 4 : 0)));
        const to = { x: r2(x), y };
        wires.push({ net: net.id, kind: net.kind, color, from: pin.at, to, d: curve(pin.at, VEC[pin.dir], to, side === 'top' ? VEC.down : VEC.up) });
        if (!railUse.has(net.id)) railUse.set(net.id, new Set());
        railUse.get(net.id)!.add(side);
      }
      continue;
    }
    const color = SIGNAL_COLORS[colorIndex++ % SIGNAL_COLORS.length]!;
    if (pins.length === 2) {
      const [a, b] = pins as [PhysicalPin, PhysicalPin];
      wires.push({ net: net.id, kind: net.kind, color, from: a.at, to: b.at, d: curve(a.at, VEC[a.dir], b.at, VEC[b.dir]) });
    } else {
      const approach = pins.map(p => ({ x: p.at.x + VEC[p.dir].x * 8, y: p.at.y + VEC[p.dir].y * 8 }));
      const at = { x: r2(approach.reduce((s, p) => s + p.x, 0) / approach.length), y: r2(approach.reduce((s, p) => s + p.y, 0) / approach.length) };
      splices.push({ net: net.id, at });
      for (const p of pins) {
        const dx = p.at.x - at.x; const dy = p.at.y - at.y; const len = Math.hypot(dx, dy) || 1;
        wires.push({ net: net.id, kind: net.kind, color, from: p.at, to: at, d: curve(p.at, VEC[p.dir], at, { x: dx / len, y: dy / len }) });
      }
    }
  }
  // Where a rail net appears on both strips, a jumper bridges them at the right edge.
  const powerNet = design.nets.find(n => n.kind === 'power');
  const groundNet = design.nets.find(n => n.kind === 'ground');
  [powerNet, groundNet].forEach((net, i) => {
    if (!net || railUse.get(net.id)?.size !== 2) return;
    const kind = net.kind as 'power' | 'ground';
    const x = x2 - 9 + i * 5;
    const from = { x, y: RAIL_ROWS.top[kind] };
    const to = { x, y: RAIL_ROWS.bottom[kind] };
    wires.push({ net: net.id, kind, color: kind === 'power' ? POWER_COLOR : GROUND_COLOR, from, to, d: `M${from.x} ${from.y} L${to.x} ${to.y}` });
  });
  const rails: PhysicalRail[] = (['top', 'bottom'] as const).map(side => ({
    side, x1, x2, y: side === 'top' ? 5 : MAT.h - 18,
    rows: [
      ...(powerNet ? [{ net: powerNet.id, kind: 'power' as const, y: RAIL_ROWS[side].power, label: powerNet.name }] : []),
      ...(groundNet ? [{ net: groundNet.id, kind: 'ground' as const, y: RAIL_ROWS[side].ground, label: groundNet.name }] : []),
    ],
  }));
  return { width: MAT.w, height: MAT.h, parts, wires, rails, splices };
}
