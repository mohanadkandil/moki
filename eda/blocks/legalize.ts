import type { BlockPart, BoardPlan, Pose } from '../../src/blocks/contract.js';
import type { PlanGraph, PlacedPart } from '../../src/blocks/graph.js';

export interface FootprintEnvelope { minX: number; maxX: number; minY: number; maxY: number; layers?: string[] }
interface ImportedFootprint { component: (props: any) => any; pins?: Map<string, string> }
export interface PlacementChange { ref: string; inst: string; localRef: string; from: Pose; to: Pose }
/** Envelope injection is for replaying captured actual native geometry in pure tests. */
export interface LegalizeOptions { envelopes?: Map<BlockPart, FootprintEnvelope> }
const MARGIN = .15, STEP = .25, RADIUS = 12, EPS = 1e-8;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const norm = (a: number) => (a % 360 + 360) % 360;
function mm(v: unknown, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  if (finite(v)) return v;
  if (typeof v === 'string') { const m = v.trim().match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(mm|mil|in|um|µm)?$/i); if (m) return Number(m[1]) * ({ mm: 1, mil: .0254, in: 25.4, um: .001, 'µm': .001, '': 1 }[m[2]?.toLowerCase() ?? '']!); }
  throw new Error(`Cannot legalize unsupported footprint dimension ${String(v)}`);
}
/** Footprint angles are degrees, never lengths or implicit string numbers. */
function degrees(v: unknown, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  if (finite(v)) return v;
  if (typeof v === 'string') {
    const match = v.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*deg$/i);
    if (match && finite(Number(match[1]))) return Number(match[1]);
  }
  throw new Error(`Cannot legalize unsupported footprint angle ${String(v)}`);
}
function rotate(x: number, y: number, angle: number) { const a = degrees(angle) * Math.PI / 180; return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }; }
function bounds(points: Array<{ x: number; y: number }>, layers?: string[]): FootprintEnvelope {
  if (!points.length || points.some(p => !finite(p.x) || !finite(p.y))) throw new Error('Cannot legalize missing/nonfinite actual footprint geometry');
  const b = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)), layers };
  if (b.maxX - b.minX <= EPS || b.maxY - b.minY <= EPS) throw new Error('Cannot legalize degenerate actual footprint envelope'); return b;
}
function normalizeLayers(layers: unknown): string[] {
  if (layers === undefined) return ['top'];
  if (!Array.isArray(layers) || !layers.length) throw new Error('Cannot legalize an invalid footprint/keepout layer set');
  return layers.map(layer => {
    const name = ({ 'F.Cu': 'top', 'F.CrtYd': 'top', 'B.Cu': 'bottom', 'B.CrtYd': 'bottom' } as Record<string, string>)[String(layer)] ?? layer;
    if (!['top', 'bottom', 'inner1', 'inner2', 'all'].includes(name)) throw new Error(`Cannot legalize unsupported layer ${String(layer)}`); return name;
  });
}
function corners(b: FootprintEnvelope) { return [{ x: b.minX, y: b.minY }, { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }]; }
function world(b: FootprintEnvelope, at: Pose) { return bounds(corners(b).map(p => { const q = rotate(p.x, p.y, at.rotation ?? 0); return { x: q.x + at.x, y: q.y + at.y }; }), b.layers); }
/** Read trusted converted React footprints or fallback CircuitJSON arrays, not guessed package names. */
export function footprintEnvelope(part: BlockPart, imported: ImportedFootprint): FootprintEnvelope {
  const node = imported.component({ name: part.ref, pcbX: 0, pcbY: 0, pcbRotation: 0 });
  if (!node?.props?.footprint) throw new Error(`Cannot legalize ${part.ref}: imported component has no actual footprint`);
  const points: Array<{ x: number; y: number }> = [], layers = new Set<string>();
  const omitted = new Set((part.omitPads ?? []).map(p => imported.pins?.get(p)).filter(Boolean));
  const add = (x: number, y: number, t: Pose) => { const p = rotate(x, y, t.rotation ?? 0); points.push({ x: p.x + t.x, y: p.y + t.y }); };
  const rect = (w: number, h: number, t: Pose) => { if (w <= 0 || h <= 0) throw new Error('Invalid actual footprint dimensions'); for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) add(x, y, t); };
  const walk = (item: any, parent: Pose): void => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(child => walk(child, parent)); return; }
    const p = item.props ?? item, type = typeof item.type === 'string' ? item.type.toLowerCase().replaceAll('_', '') : '';
    const court = type.startsWith('courtyard') || type.startsWith('pcbcourtyard');
    const pad = ['smtpad', 'pcbsmtpad', 'platedhole', 'pcbplatedhole'].includes(type);
    if (!court && !pad && !p.children) return;
    const hints = p.portHints ?? p.port_hints ?? [];
    if (['smtpad', 'pcbsmtpad', 'platedhole', 'pcbplatedhole'].includes(type) && hints.some((h: string) => omitted.has(h))) return;
    const x = mm(p.pcbX ?? p.x ?? p.center?.x, 0), y = mm(p.pcbY ?? p.y ?? p.center?.y, 0), local = rotate(x, y, parent.rotation ?? 0);
    const rotation = [p.pcbRotation, p.ccwRotation, p.ccw_rotation].find(value => value !== undefined);
    const t = { x: parent.x + local.x, y: parent.y + local.y, rotation: degrees(parent.rotation, 0) + degrees(rotation, 0) };
    const path = p.outline ?? p.points;
    if (court || pad) {
      if (type.includes('platedhole')) layers.add('all');
      else for (const layer of normalizeLayers(p.layers ?? [p.layer ?? 'top'])) layers.add(layer);
      if (Array.isArray(path)) { if (path.length < 3) throw new Error('Invalid actual courtyard/pad outline'); for (const q of path) add(mm(q.x), mm(q.y), t); }
      else {
        const diameter = p.outerDiameter ?? p.outer_diameter ?? p.diameter ?? (p.radius === undefined ? undefined : mm(p.radius) * 2);
        const w = mm(p.width ?? p.outerWidth ?? p.outer_width ?? p.rectPadWidth ?? p.rect_pad_width ?? diameter);
        const h = mm(p.height ?? p.outerHeight ?? p.outer_height ?? p.rectPadHeight ?? p.rect_pad_height ?? diameter);
        rect(w, h, t);
      }
    }
    walk(p.children, t);
  };
  walk(node.props.footprint, { x: 0, y: 0, rotation: 0 });
  return bounds(points, [...layers]);
}
function overlaps(a: FootprintEnvelope, b: FootprintEnvelope) { return a.minX < b.maxX + MARGIN - EPS && a.maxX + MARGIN > b.minX + EPS && a.minY < b.maxY + MARGIN - EPS && a.maxY + MARGIN > b.minY + EPS; }
function insideBoard(b: FootprintEnvelope, plan: BoardPlan): boolean {
  if (!plan.board) return true;
  const { widthMm: w, heightMm: h } = plan.board, radius = plan.board.cornerRadiusMm ?? 0;
  if (!finite(w) || !finite(h) || !finite(radius) || w <= MARGIN * 2 || h <= MARGIN * 2 || radius < 0 || radius > Math.min(w, h) / 2) throw new Error('Cannot legalize invalid explicit board bounds');
  const hw = w / 2 - MARGIN, hh = h / 2 - MARGIN, r = Math.max(0, radius - MARGIN);
  return corners(b).every(p => Math.abs(p.x) <= hw + EPS && Math.abs(p.y) <= hh + EPS && (!r || Math.hypot(Math.max(0, Math.abs(p.x) - (hw - r)), Math.max(0, Math.abs(p.y) - (hh - r))) <= r + EPS));
}
const rotatable = (p: PlacedPart) => /^[RC]\d+$/.test(p.localRef) && Object.values(p.part.pins).length === 2 && Object.values(p.part.pins).every(pin => pin.role === 'passive');
const angles = (p: PlacedPart) => rotatable(p) ? [norm(p.at.rotation ?? 0), norm((p.at.rotation ?? 0) + 90)] : [norm(p.at.rotation ?? 0)];
const offsets = (() => { const out: Array<{ x: number; y: number; d: number }> = []; for (let x = -RADIUS; x <= RADIUS; x += STEP) for (let y = -RADIUS; y <= RADIUS; y += STEP) if (Math.hypot(x, y) <= RADIUS + EPS) out.push({ x, y, d: x * x + y * y }); return out.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y); })();

/** Deterministic compiler-only placement: primary anchors and authored electrical data stay fixed. */
export function legalizePlanGraph(plan: BoardPlan, graph: PlanGraph, imports: Map<BlockPart, ImportedFootprint>, options: LegalizeOptions = {}): { graph: PlanGraph; changes: PlacementChange[] } {
  if (!graph.parts.length || graph.parts.length > 512) throw new Error('Cannot legalize empty/excessive part graph');
  const output: PlanGraph = { ...graph, parts: graph.parts.map(p => ({ ...p, at: { ...p.at } })) };
  const envelopes = new Map<PlacedPart, FootprintEnvelope>();
  for (const p of output.parts) {
    if (!finite(p.at.x) || !finite(p.at.y) || !finite(p.at.rotation ?? 0)) throw new Error(`Cannot legalize invalid part pose ${p.ref}`);
    const supplied = options.envelopes?.get(p.part), imported = imports.get(p.part);
    if (!supplied && !imported) throw new Error(`Cannot legalize missing actual footprint ${p.inst}.${p.localRef}`);
    const b = supplied ?? footprintEnvelope(p.part, imported!); envelopes.set(p, bounds(corners(b), normalizeLayers(b.layers)));
  }
  const keepouts: Array<{ box: FootprintEnvelope; inst: string; exclude: string[]; layers: string[]; purpose: string }> = [];
  for (const [index, instance] of plan.blocks.entries()) {
    const representative = output.parts.find(p => p.inst === instance.inst); if (!representative) throw new Error(`Cannot legalize missing block ${instance.inst}`);
    const anchor = instance.at ?? { x: (index % 3 - 1) * 34, y: -Math.floor(index / 3) * 32 };
    for (const k of representative.block.constraints) if (k.kind === 'keepout') {
      if (!finite(k.width) || !finite(k.height) || k.width <= 0 || k.height <= 0) throw new Error(`Invalid keepout in ${instance.inst}`);
      const q = rotate(k.x, k.y, anchor.rotation ?? 0);
      keepouts.push({ box: world({ minX: -k.width / 2, maxX: k.width / 2, minY: -k.height / 2, maxY: k.height / 2 }, { x: anchor.x + q.x, y: anchor.y + q.y, rotation: anchor.rotation }), inst: instance.inst, exclude: k.excludeParts ?? [], layers: normalizeLayers(k.layers), purpose: k.purpose });
    }
  }
  const localPart = (p: PlacedPart, ref: string) => output.parts.find(q => q.inst === p.inst && q.localRef === ref);
  const decaps = (p: PlacedPart) => p.block.constraints.filter(c => c.kind === 'decoupling' && c.caps.includes(p.localRef));
  // Translation cannot repair an impossible origin-distance versus envelope separation.
  for (const p of output.parts) for (const d of decaps(p)) if (d.kind === 'decoupling') {
    const ic = localPart(p, d.ic); if (!ic || !finite(d.maxDistanceMm) || d.maxDistanceMm <= 0) throw new Error(`Invalid decoupling reference ${p.inst}.${p.localRef}`);
    const a = world(envelopes.get(ic)!, { x: 0, y: 0, rotation: ic.at.rotation });
    const lowerBound = Math.min(...angles(p).map(rotation => {
      const b = world(envelopes.get(p)!, { x: 0, y: 0, rotation });
      return Math.min(Math.max(0, -(a.minX - MARGIN - b.maxX)), Math.max(0, a.maxX + MARGIN - b.minX), Math.max(0, -(a.minY - MARGIN - b.maxY)), Math.max(0, a.maxY + MARGIN - b.minY));
    }));
    if (lowerBound > d.maxDistanceMm + EPS) throw new Error(`Cannot legalize ${p.inst}.${p.localRef}: actual courtyard/pad envelope separation from ${d.ic} requires at least ${lowerBound.toFixed(3)} mm origin distance, exceeding declared ${d.maxDistanceMm} mm`);
  }
  const fixed = output.parts.filter(p => p.localRef === p.block.parts[0]?.ref), placed = new Map<PlacedPart, FootprintEnvelope>();
  const valid = (p: PlacedPart, at: Pose): string | undefined => {
    const box = world(envelopes.get(p)!, at);
    if (!insideBoard(box, plan)) return 'explicit board bounds';
    for (const k of keepouts) {
      if (k.inst === p.inst && k.exclude.includes(p.localRef)) continue;
      const layers = envelopes.get(p)!.layers ?? ['top'];
      if (!k.layers.some(l => l === 'all' || layers.includes('all') || layers.includes(l))) continue;
      if (overlaps(box, k.box)) return `keepout ${k.inst}: ${k.purpose}`;
    }
    for (const [other, bounds] of placed) if (other !== p && overlaps(box, bounds)) return `courtyard/pad envelope ${other.inst}.${other.localRef}`;
    for (const d of decaps(p)) if (d.kind === 'decoupling') {
      const ic = localPart(p, d.ic)!;
      if (!placed.has(ic)) return `unplaced decoupling IC ${d.ic}`;
      if (Math.hypot(at.x - ic.at.x, at.y - ic.at.y) > d.maxDistanceMm + EPS) return `decoupling ${d.ic} exceeds ${d.maxDistanceMm} mm world-origin distance`;
    }
    return undefined;
  };
  for (const p of fixed) { const why = valid(p, p.at); if (why) throw new Error(`Cannot legalize fixed anchor ${p.inst}.${p.localRef}: ${why}`); placed.set(p, world(envelopes.get(p)!, p.at)); }
  const category = (p: PlacedPart) => /^C\d+$/.test(p.localRef) && rotatable(p) ? 1 : /^R\d+$/.test(p.localRef) && rotatable(p) ? 2 : 0;
  const tightness = (p: PlacedPart) => Math.min(Infinity, ...decaps(p).map(c => c.kind === 'decoupling' ? c.maxDistanceMm : Infinity));
  const area = (p: PlacedPart) => { const b = envelopes.get(p)!; return (b.maxX - b.minX) * (b.maxY - b.minY); };
  const movable = output.parts.filter(p => !fixed.includes(p)).sort((a, b) => category(a) - category(b) || tightness(a) - tightness(b) || area(b) - area(a) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const sectionRotations = new Map(plan.blocks.map(instance => [instance.inst, instance.at?.rotation ?? 0]));
  const changes: PlacementChange[] = [];
  for (const p of movable) {
    const from = { ...p.at }; let found: Pose | undefined, why = 'no feasible local candidate';
    for (const offset of offsets) {
      for (const rotation of angles(p)) {
        // Rank offsets in the section's authored frame. A cardinal section
        // rotation must rotate an equal-distance tie, not choose a different
        // local capacitor position because world X happens to sort first.
        const displacement = rotate(offset.x, offset.y, sectionRotations.get(p.inst) ?? 0);
        const at = { x: from.x + displacement.x, y: from.y + displacement.y, rotation };
        const reason = valid(p, at); if (!reason) { found = at; break; } why = reason;
      }
      if (found) break;
    }
    if (!found) throw new Error(`Cannot legalize ${p.inst}.${p.localRef} within ${RADIUS} mm on ${STEP} mm grid: ${why}; fixed anchors and declared constraints were preserved`);
    p.at = found; placed.set(p, world(envelopes.get(p)!, found));
    if (Math.hypot(found.x - from.x, found.y - from.y) > EPS || Math.abs(norm(found.rotation ?? 0) - norm(from.rotation ?? 0)) > EPS) changes.push({ ref: p.ref, inst: p.inst, localRef: p.localRef, from, to: { ...found } });
  }
  // Recheck all declared distance constraints after every secondary IC has its final pose.
  for (const p of output.parts) { const why = valid(p, p.at); if (why) throw new Error(`Final legalized placement invalid for ${p.inst}.${p.localRef}: ${why}`); }
  return { graph: output, changes };
}
