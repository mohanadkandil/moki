import { CATALOG, moduleDef } from '../circuit/catalog.js';
import type { CircuitDesign } from '../circuit/model.js';
import { boardMetadata } from './codegen.js';
import { footprintFor } from './catalog-footprints.js';
import { MODULE_MECH } from '../../eda/enclosure/module-mech.js';

export type MakerEdits = {
  placements?: Array<{ refdes: string; x: number; y: number; rotation: number }>;
  board?: { widthMm: number; heightMm: number; cornerRadiusMm: number };
  usbEdge?: 'left' | 'right' | 'top' | 'bottom';
};
type Point = { x: number; y: number };
type Edge = NonNullable<MakerEdits['usbEdge']>;
export interface LayoutPart { refdes: string; module: string; center: Point; origin: Point; localCenter: Point; rotation: number }
export interface BoardLayout {
  schema: 'moki.board-layout/1';
  board: { widthMm: number; heightMm: number; cornerRadiusMm: number };
  usbEdge: Edge;
  parts: LayoutPart[];
  mountingHoles: { x: number; y: number; diameterMm: number }[];
}
const EPS = 0.002;
const EDGES: Edge[] = ['left', 'right', 'top', 'bottom'];
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const angle = (n: number) => round(((n % 360) + 360) % 360) % 360;
const rotate = (p: Point, deg: number): Point => { const a = deg * Math.PI / 180; return { x: round(p.x * Math.cos(a) - p.y * Math.sin(a)), y: round(p.x * Math.sin(a) + p.y * Math.cos(a)) }; };
function num(n: unknown, label: string): number { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${label} must be a finite number`); return n; }
function object(v: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error(`${label} must be an object`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw new Error(`Unknown ${label} field: ${k}`);
  return v as Record<string, unknown>;
}
function boardSize(b: BoardLayout['board']) {
  const w = num(b.widthMm, 'Board width'); const h = num(b.heightMm, 'Board height'); const r = num(b.cornerRadiusMm, 'Corner radius');
  if (w < 20 || h < 20 || w > 300 || h > 300) throw new Error('Board dimensions must be between 20 and 300 mm');
  if (r < 0 || r > Math.min(w, h) / 2) throw new Error('Corner radius must be between zero and half the smaller board dimension');
}
export function parseMakerEdits(value: unknown): MakerEdits {
  const v = object(value, ['placements', 'board', 'usbEdge'], 'edits'); const out: MakerEdits = {};
  if ('placements' in v) {
    if (!Array.isArray(v.placements)) throw new Error('placements must be an array');
    const seen = new Set<string>();
    out.placements = v.placements.map((p, i) => {
      const e = object(p, ['refdes', 'x', 'y', 'rotation'], `placement ${i + 1}`);
      if (typeof e.refdes !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(e.refdes)) throw new Error('Each placement needs a valid refdes');
      if (seen.has(e.refdes)) throw new Error(`Duplicate placement: ${e.refdes}`); seen.add(e.refdes);
      return { refdes: e.refdes, x: num(e.x, `${e.refdes} x`), y: num(e.y, `${e.refdes} y`), rotation: angle(num(e.rotation, `${e.refdes} rotation`)) };
    });
  }
  if ('board' in v) {
    const b = object(v.board, ['widthMm', 'heightMm', 'cornerRadiusMm'], 'board');
    out.board = { widthMm: num(b.widthMm, 'Board width'), heightMm: num(b.heightMm, 'Board height'), cornerRadiusMm: num(b.cornerRadiusMm, 'Corner radius') }; boardSize(out.board);
  }
  if ('usbEdge' in v) { if (!EDGES.includes(v.usbEdge as Edge)) throw new Error('usbEdge must be left, right, top or bottom'); out.usbEdge = v.usbEdge as Edge; }
  return out;
}
export function layoutOutline(board: BoardLayout['board']): Point[] {
  boardSize(board); const { widthMm: w, heightMm: h, cornerRadiusMm: r } = board;
  if (!r) return [{ x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }, { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }];
  // At most 0.01 mm chord error, including large-radius boards.
  const steps = Math.max(12, Math.ceil((Math.PI / 2) / (2 * Math.acos(Math.max(-1, 1 - 0.01 / r)))));
  return [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]].flatMap(([x, y, a]) => Array.from({ length: steps + 1 }, (_, i) => { const p = rotate({ x: r, y: 0 }, a! + i * 90 / steps); return { x: round(x! + p.x), y: round(y! + p.y) }; }));
}
function localCenter(module: string): Point {
  const pins = footprintFor(module).pins;
  return { x: (Math.min(...pins.map(p => p.x - p.outerDiameter / 2)) + Math.max(...pins.map(p => p.x + p.outerDiameter / 2))) / 2,
    y: (Math.min(...pins.map(p => p.y - p.outerDiameter / 2)) + Math.max(...pins.map(p => p.y + p.outerDiameter / 2))) / 2 };
}
function place(part: LayoutPart, center: Point, rotation: number): LayoutPart {
  const rot = angle(rotation); const offset = rotate(part.localCenter, rot);
  return { ...part, rotation: rot, center: { ...center }, origin: { x: round(center.x - offset.x), y: round(center.y - offset.y) } };
}
function controller(layout: BoardLayout) {
  const parts = layout.parts.filter(p => moduleDef(p.module).category === 'controller');
  if (parts.length !== 1) throw new Error('Maker edits require exactly one catalog controller'); return parts[0]!;
}
function usbPoint(part: LayoutPart): Point {
  const d = moduleDef(part.module); const mech = MODULE_MECH[part.module]!;
  const a = mech.apertures(d.size.w, d.size.h, mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm).find(a => a.purpose === 'usb');
  if (!a || a.outwardLocal?.x !== 0 || a.outwardLocal?.y !== 1) throw new Error('Controller USB geometry is unsupported');
  const p = rotate({ x: a.x - d.size.w / 2, y: d.size.h / 2 - a.y }, part.rotation);
  return { x: part.origin.x + p.x, y: part.origin.y + p.y };
}
const edgeRotation: Record<Edge, number> = { bottom: 0, right: 90, top: 180, left: 270 };
function inferEdge(part: LayoutPart): Edge {
  const match = EDGES.find(e => Math.abs(angle(part.rotation) - edgeRotation[e]) < EPS);
  if (!match) throw new Error('Controller USB must face outward at a cardinal angle'); return match;
}
function mountingHoles(board: BoardLayout['board']): BoardLayout['mountingHoles'] {
  // Preserve 4 mm defaults and keep the case's 3.5 mm standoff foot inside larger fillets.
  const inset = Math.max(4, board.cornerRadiusMm - (board.cornerRadiusMm - 3.5) / Math.SQRT2);
  return [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: round(x * (board.widthMm / 2 - inset)), y: round(y * (board.heightMm / 2 - inset)), diameterMm: 3.2 })));
}
export function layoutForDesign(design: CircuitDesign): BoardLayout {
  const m = boardMetadata(design);
  const layout: BoardLayout = { schema: 'moki.board-layout/1', board: { widthMm: m.widthMm, heightMm: m.heightMm, cornerRadiusMm: m.cornerRadiusMm }, usbEdge: 'bottom', mountingHoles: structuredClone(m.mountingHoles),
    parts: m.parts.map(p => { const c = localCenter(p.module); return { refdes: p.id, module: p.module, origin: { x: p.x, y: p.y }, localCenter: c, center: { x: round(p.x + c.x), y: round(p.y + c.y) }, rotation: 0 }; }) };
  validateStructure(layout); return layout;
}
function inferredRadius(outline: any, w: number, h: number): number {
  if (!Array.isArray(outline) || !outline.length) return 0;
  const pts = outline.map((p: any) => ({ x: num(p.x, 'Outline x'), y: num(p.y, 'Outline y') }));
  const top = pts.filter(p => Math.abs(Math.abs(p.y) - h / 2) < EPS);
  const side = pts.filter(p => Math.abs(Math.abs(p.x) - w / 2) < EPS);
  if (!top.length || !side.length) throw new Error('Maker edits require a rectangular or rounded rectangular board');
  const r = round(Math.max(w / 2 - Math.max(...top.map(p => Math.abs(p.x))), h / 2 - Math.max(...side.map(p => Math.abs(p.y)))));
  if (r > 0 && pts.length < 16) throw new Error('Board outline is not a supported rounded rectangle');
  for (const p of pts) {
    const qx = Math.abs(p.x) - (w / 2 - r); const qy = Math.abs(p.y) - (h / 2 - r);
    const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    if (Math.abs(distance) > 0.01) throw new Error('Maker edits require a rectangular or rounded rectangular board');
  }
  // A custom cutout or a missing corner arc must not be reconstructed as a larger safe board.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!; const b = pts[(i + 1) % pts.length]!;
    const x = Math.abs((a.x + b.x) / 2) - (w / 2 - r); const y = Math.abs((a.y + b.y) / 2) - (h / 2 - r);
    const distance = Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0) - r;
    if (Math.abs(distance) > 0.03) throw new Error('Board outline has an unsupported cutout or corner sampling');
  }
  return r;
}
export function layoutFromCircuit(circuit: any[], metadata?: any): BoardLayout {
  if (!Array.isArray(circuit)) throw new Error('Base circuit must be an array');
  const boards = circuit.filter(e => e.type === 'pcb_board');
  if (boards.length !== 1) throw new Error('Maker edits require a single board'); const b = boards[0];
  if (Math.abs(num(b.center?.x, 'Board centre x')) > EPS || Math.abs(num(b.center?.y, 'Board centre y')) > EPS) throw new Error('Maker edits require a centred board');
  if (b.num_layers !== 2) throw new Error('Maker edits require a two-layer catalog carrier');
  if (circuit.some(e => e.type === 'pcb_group') || circuit.some(e => e.type === 'pcb_component' && (e.pcb_group_id || e.parent_pcb_group_id || e.positioned_relative_to_pcb_group_id))) throw new Error('Maker edits do not support grouped or nested PCB placements');
  const carrierHoles = circuit.filter(e => e.type === 'pcb_hole');
  if (carrierHoles.length !== 4 || carrierHoles.some(e => e.hole_shape !== 'circle' || typeof e.hole_diameter !== 'number' || !Number.isFinite(e.hole_diameter) || Math.abs(e.hole_diameter - 3.2) > EPS)) throw new Error('Maker edits require four circular 3.2 mm mounting holes');
  const widthMm = num(b.width, 'Board width'); const heightMm = num(b.height, 'Board height');
  const sources = new Map(circuit.filter(e => e.type === 'source_component').map(e => [e.source_component_id, e]));
  const parts: LayoutPart[] = circuit.filter(e => e.type === 'pcb_component').map(c => {
    const s = sources.get(c.source_component_id); const refdes = s?.name;
    if (typeof refdes !== 'string') throw new Error('Base component has no reference designator');
    const module = metadata?.parts?.find((p: any) => (p.id ?? p.refdes) === refdes)?.module ?? [...CATALOG.values()].find(m => String(s.manufacturer_part_number ?? '').startsWith(m.name))?.id;
    if (!module || !CATALOG.has(module) || !MODULE_MECH[module]) throw new Error(`${refdes} has no supported catalog mechanical geometry`);
    const rotation = angle(num(c.rotation, `${refdes} rotation`));
    const center = { x: num(c.center?.x, `${refdes} centre x`), y: num(c.center?.y, `${refdes} centre y`) };
    const origin = { x: num(c.footprint_origin?.x, `${refdes} footprint origin x`), y: num(c.footprint_origin?.y, `${refdes} footprint origin y`) };
    const local = rotate({ x: center.x - origin.x, y: center.y - origin.y }, -rotation);
    const expected = localCenter(module);
    if (Math.hypot(local.x - expected.x, local.y - expected.y) > 0.02) throw new Error(`${refdes} footprint centre differs from its catalog geometry`);
    const pins = footprintFor(module).pins; const pads = circuit.filter(e => e.type === 'pcb_plated_hole' && e.pcb_component_id === c.pcb_component_id);
    if (pads.length !== pins.length) throw new Error(`${refdes} needs complete catalog pad geometry`);
    for (const pin of pins) {
      const matches = pads.filter(p => p.port_hints?.includes(`pin${pin.number}`));
      if (matches.length !== 1) throw new Error(`${refdes} has missing or ambiguous catalog pads`);
      const at = rotate(pin, rotation); const pad = matches[0];
      if (pad.shape !== 'circle' || Math.abs(num(pad.hole_diameter, `${refdes} pad drill`) - pin.holeDiameter) > EPS || Math.abs(num(pad.outer_diameter, `${refdes} pad diameter`) - pin.outerDiameter) > EPS || !Array.isArray(pad.layers) || pad.layers.length !== 2 || !pad.layers.includes('top') || !pad.layers.includes('bottom')) throw new Error(`${refdes} pad dimensions or layers differ from its catalog geometry`);
      if (Math.hypot(num(pad.x, `${refdes} pad x`) - origin.x - at.x, num(pad.y, `${refdes} pad y`) - origin.y - at.y) > 0.02) throw new Error(`${refdes} pads differ from its catalog geometry`);
    }
    return { refdes, module, center, origin, localCenter: local, rotation };
  });
  const layout: BoardLayout = { schema: 'moki.board-layout/1', board: { widthMm, heightMm, cornerRadiusMm: inferredRadius(b.outline, widthMm, heightMm) }, usbEdge: 'bottom', parts,
    mountingHoles: carrierHoles.map(e => ({ x: num(e.x, 'Mounting hole x'), y: num(e.y, 'Mounting hole y'), diameterMm: num(e.hole_diameter, 'Mounting hole diameter') })) };
  layout.usbEdge = inferEdge(controller(layout)); validateStructure(layout); return layout;
}

type Envelope = { polygon: Point[]; usb: boolean };
function envelopes(part: LayoutPart): Envelope[] {
  const d = moduleDef(part.module); const m = MODULE_MECH[part.module]; if (!m) throw new Error(`${part.refdes} has no mechanical geometry`);
  const pins = footprintFor(part.module).pins;
  const pad = { x: pins.reduce((s, p) => s + p.x, 0) / pins.length, y: pins.reduce((s, p) => s + p.y, 0) / pins.length };
  const body = m.bodyMm ?? { w: d.size.w, h: d.size.h }; const bodyAt = m.bodyMm ? pad : { x: 0, y: 0 };
  const rects = [{ ...bodyAt, ...body, usb: false }, ...m.blocks(d.size.w, d.size.h, m.socketMm + m.spacerMm + m.pcbMm + m.componentsMm).map(b => ({ x: m.bodyMm ? pad.x + b.x : b.x - d.size.w / 2, y: m.bodyMm ? pad.y - b.y : d.size.h / 2 - b.y, w: b.w, h: b.h, usb: b.label === 'micro-usb' })), ...pins.map(p => ({ x: p.x, y: p.y, w: p.outerDiameter, h: p.outerDiameter, usb: false }))];
  return rects.map(b => ({ usb: b.usb, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => { const p = rotate({ x: b.x + x! * b.w / 2, y: b.y + y! * b.h / 2 }, part.rotation); return { x: p.x + part.origin.x, y: p.y + part.origin.y }; }) }));
}
function inside(p: Point, b: BoardLayout['board'], margin = 0): boolean {
  const w = b.widthMm / 2 - margin; const h = b.heightMm / 2 - margin; const r = Math.max(0, b.cornerRadiusMm - margin);
  if (Math.abs(p.x) > w + EPS || Math.abs(p.y) > h + EPS) return false;
  return Math.hypot(Math.max(0, Math.abs(p.x) - (w - r)), Math.max(0, Math.abs(p.y) - (h - r))) <= r + EPS;
}
function overlap(a: Point[], b: Point[], clearance = 0.2): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!; const q = polygon[(i + 1) % polygon.length]!; const len = Math.hypot(q.x - p.x, q.y - p.y); const n = { x: (p.y - q.y) / len, y: (q.x - p.x) / len };
    const aa = a.map(v => v.x * n.x + v.y * n.y); const bb = b.map(v => v.x * n.x + v.y * n.y);
    if (Math.max(...aa) + clearance <= Math.min(...bb) + EPS || Math.max(...bb) + clearance <= Math.min(...aa) + EPS) return false;
  }
  return true;
}
function distanceToRect(p: Point, polygon: Point[]): number {
  // Return zero inside, otherwise distance to the closest edge.
  let sign = 0; let inside = true; let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!; const dx = b.x - a.x; const dy = b.y - a.y;
    const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
    if (Math.abs(cross) > EPS) { if (sign && Math.sign(cross) !== sign) inside = false; sign = Math.sign(cross); }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return inside ? 0 : distance;
}
// A failed physical layout is still a valid edit base when its identity and pose data are trustworthy.
function validateStructure(layout: BoardLayout): void {
  if (layout.schema !== 'moki.board-layout/1') throw new Error('Unsupported board layout schema');
  boardSize(layout.board); if (!EDGES.includes(layout.usbEdge)) throw new Error('Invalid USB edge');
  const seen = new Set<string>();
  for (const part of layout.parts) {
    if (seen.has(part.refdes)) throw new Error(`Duplicate part: ${part.refdes}`); seen.add(part.refdes);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(part.refdes)) throw new Error('Invalid part reference designator');
    if (!CATALOG.has(part.module)) throw new Error(`${part.refdes} has no supported catalog module`);
    const catalogCenter = localCenter(part.module);
    if (Math.hypot(part.localCenter.x - catalogCenter.x, part.localCenter.y - catalogCenter.y) > 0.02) throw new Error(`${part.refdes} has an unsupported local footprint centre`);
    for (const p of [part.center, part.origin, part.localCenter]) { num(p.x, `${part.refdes} x`); num(p.y, `${part.refdes} y`); } num(part.rotation, `${part.refdes} rotation`);
    const expected = place(part, part.center, part.rotation);
    if (Math.hypot(expected.origin.x - part.origin.x, expected.origin.y - part.origin.y) > EPS) throw new Error(`${part.refdes} has inconsistent centre and footprint origin`);
  }
  controller(layout);
  for (const h of layout.mountingHoles) {
    num(h.x, 'Mounting hole x'); num(h.y, 'Mounting hole y');
    if (num(h.diameterMm, 'Mounting hole diameter') <= 0) throw new Error('Mounting hole diameter must be positive');
  }
}
export function validateLayout(layout: BoardLayout): void {
  validateStructure(layout);
  const ctrl = controller(layout); const usb = usbPoint(ctrl); const edge = layout.usbEdge;
  if (inferEdge(ctrl) !== edge) throw new Error(`USB must face outward at the ${edge} edge`);
  const edgePos = edge === 'left' ? -layout.board.widthMm / 2 : edge === 'right' ? layout.board.widthMm / 2 : edge === 'top' ? layout.board.heightMm / 2 : -layout.board.heightMm / 2;
  if (Math.abs((edge === 'left' || edge === 'right' ? usb.x : usb.y) - edgePos) > 0.02) throw new Error(`Controller USB must remain at the ${edge} board edge`);
  const shapes = layout.parts.map(p => ({ part: p, envelopes: envelopes(p) }));
  for (const { part, envelopes: bounds } of shapes) for (const env of bounds) for (const point of env.polygon) {
    const p = { ...point };
    // Only the connector itself may protrude, up to its modeled overhang. Its board projection must fit the fillet.
    if (part.refdes === ctrl.refdes && env.usb) {
      if (edge === 'bottom') p.y = Math.max(p.y, edgePos); if (edge === 'top') p.y = Math.min(p.y, edgePos);
      if (edge === 'left') p.x = Math.max(p.x, edgePos); if (edge === 'right') p.x = Math.min(p.x, edgePos);
    }
    if (!inside(p, layout.board)) throw new Error(`${part.refdes} extends outside the board outline`);
  }
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i]!; const b = shapes[j]!;
    if (a.envelopes.some(x => b.envelopes.some(y => overlap(x.polygon, y.polygon)))) throw new Error(`${a.part.refdes} overlaps ${b.part.refdes} (0.2 mm module clearance required)`);
  }
  for (const hole of layout.mountingHoles) {
    num(hole.x, 'Mounting hole x'); num(hole.y, 'Mounting hole y'); const d = num(hole.diameterMm, 'Mounting hole diameter');
    if (d <= 0 || !inside(hole, layout.board, d / 2 + 0.5)) throw new Error('Mounting hole does not clear the board outline');
    for (const s of shapes) if (s.envelopes.some(e => distanceToRect(hole, e.polygon) < d / 2 + 0.5 - EPS)) throw new Error(`${s.part.refdes} obstructs a mounting hole`);
  }
  for (let i = 0; i < layout.mountingHoles.length; i++) for (let j = i + 1; j < layout.mountingHoles.length; j++) {
    const a = layout.mountingHoles[i]!; const b = layout.mountingHoles[j]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < (a.diameterMm + b.diameterMm) / 2 + 0.5 - EPS) throw new Error('Mounting holes overlap');
  }
}
function fits(layout: BoardLayout): boolean {
  try { validateLayout(layout); return true; } catch { return false; }
}
export function applyMakerEdits(base: BoardLayout, input: MakerEdits): { layout: BoardLayout; edits: MakerEdits; summary: string[] } {
  validateStructure(base); const edits = parseMakerEdits(input); const layout = structuredClone(base); const summary: string[] = [];
  if (edits.board) { layout.board = { ...edits.board }; layout.mountingHoles = mountingHoles(layout.board); }
  if (edits.usbEdge) layout.usbEdge = edits.usbEdge;
  const ctrl = controller(layout);
  for (const p of edits.placements ?? []) {
    const i = layout.parts.findIndex(part => part.refdes === p.refdes); if (i < 0) throw new Error(`Unknown part: ${p.refdes}`);
    layout.parts[i] = place(layout.parts[i]!, { x: p.x, y: p.y }, p.rotation);
  }
  if ((edits.board || edits.usbEdge) && !edits.placements?.some(p => p.refdes === ctrl.refdes)) {
    const i = layout.parts.findIndex(p => p.refdes === ctrl.refdes); let moved = place(layout.parts[i]!, layout.parts[i]!.center, edgeRotation[layout.usbEdge]);
    const usb = usbPoint(moved); const delta = { x: 0, y: 0 };
    if (layout.usbEdge === 'bottom') delta.y = -layout.board.heightMm / 2 - usb.y;
    if (layout.usbEdge === 'top') delta.y = layout.board.heightMm / 2 - usb.y;
    if (layout.usbEdge === 'left') delta.x = -layout.board.widthMm / 2 - usb.x;
    if (layout.usbEdge === 'right') delta.x = layout.board.widthMm / 2 - usb.x;
    moved = place(moved, { x: round(moved.center.x + delta.x), y: round(moved.center.y + delta.y) }, moved.rotation); layout.parts[i] = moved;
    // Parts can sit on either side of the controller on a compact board. If it lands on one, it slides along its edge to the nearest clear spot.
    const sideways = layout.usbEdge === 'left' || layout.usbEdge === 'right';
    const span = sideways ? layout.board.heightMm : layout.board.widthMm;
    for (let step = 1; step <= span && !fits(layout); step++) for (const slide of [step, -step]) {
      layout.parts[i] = place(moved, { x: round(moved.center.x + (sideways ? 0 : slide)), y: round(moved.center.y + (sideways ? slide : 0)) }, moved.rotation);
      if (fits(layout)) break;
    }
    if (!fits(layout)) layout.parts[i] = moved;
  }
  validateLayout(layout);
  if (base.board.widthMm !== layout.board.widthMm || base.board.heightMm !== layout.board.heightMm) summary.push(`Board resized to ${layout.board.widthMm} × ${layout.board.heightMm} mm`);
  if (base.board.cornerRadiusMm !== layout.board.cornerRadiusMm) summary.push(`Corner radius changed to ${layout.board.cornerRadiusMm} mm`);
  if (base.usbEdge !== layout.usbEdge) summary.push(`USB moved to the ${layout.usbEdge} edge`);
  for (const part of layout.parts) {
    const old = base.parts.find(p => p.refdes === part.refdes)!; const dx = round(part.center.x - old.center.x); const dy = round(part.center.y - old.center.y);
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) summary.push(`${part.refdes} moved ${round(Math.hypot(dx, dy))} mm (X ${dx >= 0 ? '+' : ''}${dx}, Y ${dy >= 0 ? '+' : ''}${dy})`);
    if (angle(old.rotation) !== part.rotation) summary.push(`${part.refdes} rotated to ${part.rotation}°`);
  }
  return { layout, edits, summary };
}
