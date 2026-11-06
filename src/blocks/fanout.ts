import type { PlanGraph } from './graph.js';

export interface FanoutProposal {
  ref: string; pad: string;
  route: Array<{ route_type: 'wire'; x: number; y: number; layer: 'top' | 'bottom'; width: number }>;
}
export interface FanoutDiagnostic { severity: 'error' | 'warning'; rule: string; ref?: string; pad?: string; message: string }
export interface FanoutPlan {
  ok: boolean;
  /** Diagnostic proposals must not be applied when ok=false. No circuit/source mutation occurs. */
  proposals: FanoutProposal[];
  diagnostics: FanoutDiagnostic[];
}
type Point = [number, number]; type Shape = Point[][];
export const FANOUT_TARGET_LCSCS = ['C2861252', 'C28060', 'C910544'] as const;
export const FANOUT_PLACEMENT_PADDING_MM = .6;
export const isFanoutTarget = (part: { lcsc: string }) => (FANOUT_TARGET_LCSCS as readonly string[]).includes(part.lcsc);
const CLEARANCE = .127, EPS = 1e-7, EXIT_MARGIN = .5, MAX_LENGTH = 2;
const finite = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);
const number = (v: any, label: string): number => { if (!finite(v)) throw new Error(`Missing/nonfinite ${label}`); return v; };
const positive = (v: any, label: string): number => { const n = number(v, label); if (n <= 0) throw new Error(`Nonpositive ${label}`); return n; };
const ring = (points: any[]): Point[] => {
  if (!Array.isArray(points) || points.length < 3) throw new Error('Malformed polygon');
  const result = points.map(p => [number(Array.isArray(p) ? p[0] : p.x, 'polygon x'), number(Array.isArray(p) ? p[1] : p.y, 'polygon y')] as Point);
  result.push(result[0]!); return result;
};
const rotate = ([x, y]: Point, quarter: number): Point => { switch ((quarter % 4 + 4) % 4) { case 1: return [-y, x]; case 2: return [-x, -y]; case 3: return [y, -x]; default: return [x, y]; } };
function rectangle(x: number, y: number, w: number, h: number, angle = 0): Shape {
  number(x, 'rect x'); number(y, 'rect y'); positive(w, 'rect width'); positive(h, 'rect height'); number(angle, 'rect angle');
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [ring([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([dx, dy]) => [x + dx! * c - dy! * s, y + dx! * s + dy! * c]))];
}
function capsule(a: Point, b: Point, radius: number, circumscribed = true): Shape {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]), r = positive(radius, 'capsule radius') * (circumscribed ? 1 / Math.cos(Math.PI / 48) : 1);
  return [ring([...Array.from({ length: 25 }, (_, i) => [b[0] + r * Math.cos(angle - Math.PI / 2 + i * Math.PI / 24), b[1] + r * Math.sin(angle - Math.PI / 2 + i * Math.PI / 24)]), ...Array.from({ length: 25 }, (_, i) => [a[0] + r * Math.cos(angle + Math.PI / 2 + i * Math.PI / 24), a[1] + r * Math.sin(angle + Math.PI / 2 + i * Math.PI / 24)])])];
}
function drillShape(p: any, circumscribed = true): Shape {
  const x = number(p.x, 'drill x') + (p.hole_offset_x ?? 0), y = number(p.y, 'drill y') + (p.hole_offset_y ?? 0);
  if (p.type === 'pcb_via' || p.hole_shape === 'circle' || p.shape === 'circle' || p.hole_shape === undefined && p.hole_diameter !== undefined) return capsule([x, y], [x, y], positive(p.hole_diameter, 'drill diameter') / 2, circumscribed);
  if (['pill', 'oval', 'rotated_pill'].includes(p.hole_shape ?? p.shape)) {
    const w = positive(p.hole_width, 'drill width'), h = positive(p.hole_height, 'drill height'), r = Math.min(w, h) / 2, d = Math.abs(w - h) / 2;
    const angle = ((p.hole_ccw_rotation ?? p.ccw_rotation ?? 0) + (h > w ? 90 : 0)) * Math.PI / 180;
    return capsule([x - d * Math.cos(angle), y - d * Math.sin(angle)], [x + d * Math.cos(angle), y + d * Math.sin(angle)], r, circumscribed);
  }
  if (p.hole_shape === 'rect') return rectangle(x, y, p.hole_width, p.hole_height, p.ccw_rotation ?? 0);
  throw new Error(`Unsupported native drill shape ${p.hole_shape ?? p.shape}`);
}
function padShape(p: any): Shape {
  if (p.shape === 'polygon') return [ring(p.points)];
  const x = number(p.x, 'pad x'), y = number(p.y, 'pad y');
  if (p.shape === 'circle' || p.outer_diameter !== undefined) { const r = positive(p.outer_diameter ?? p.diameter ?? p.radius * 2, 'pad diameter') / 2; return capsule([x, y], [x, y], r); }
  if (['rect', 'rotated_rect', 'pill', 'rotated_pill', 'oval'].includes(p.shape)) {
    const w = positive(p.width ?? p.outer_width, 'pad width'), h = positive(p.height ?? p.outer_height, 'pad height');
    const rotation = p.shape.startsWith('rotated_') || p.type === 'pcb_plated_hole' ? p.ccw_rotation ?? 0 : 0;
    // A bounding rectangle conservatively includes rounded-pad corners; no copper is skipped.
    return rectangle(x, y, w, h, rotation);
  }
  if (['circular_hole_with_rect_pad', 'pill_hole_with_rect_pad', 'rotated_pill_hole_with_rect_pad'].includes(p.shape)) return rectangle(x, y, p.rect_pad_width, p.rect_pad_height, p.rect_ccw_rotation ?? 0);
  throw new Error(`Unsupported foreign pad shape ${p.shape}`);
}
function box(shape: Shape) {
  const p = shape[0]!; return { left: Math.min(...p.map(p => p[0])), right: Math.max(...p.map(p => p[0])), bottom: Math.min(...p.map(p => p[1])), top: Math.max(...p.map(p => p[1])) };
}
const cross = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const on = (a: Point, b: Point, p: Point) => Math.abs(cross(a, b, p)) <= EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
function inside(point: Point, shape: Shape) {
  let result = false; const r = shape[0]!;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j]!, b = r[i]!; if (on(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function overlaps(a: Shape, b: Shape) {
  const x = box(a), y = box(b);
  if (x.left > y.right || x.right < y.left || x.bottom > y.top || x.top < y.bottom) return false;
  const ar = a[0]!, br = b[0]!;
  for (let i = 1; i < ar.length; i++) for (let j = 1; j < br.length; j++) {
    const p = ar[i - 1]!, q = ar[i]!, r = br[j - 1]!, s = br[j]!;
    if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0 || on(p, q, r) || on(p, q, s) || on(r, s, p) || on(r, s, q)) return true;
  }
  return inside(ar[0]!, b) || inside(br[0]!, a);
}

/** Straight, world-coordinate pad escapes. Routing, placement and final native DRC remain separate gates. */
export function planFanout(circuit: any[], graph: PlanGraph, mapping: Record<string, Record<string, string>>): FanoutPlan {
  const proposals: FanoutProposal[] = [], diagnostics: FanoutDiagnostic[] = [];
  const error = (rule: string, message: string, ref?: string, pad?: string) => diagnostics.push({ severity: 'error', rule, message, ...(ref ? { ref } : {}), ...(pad ? { pad } : {}) });
  try {
    if (!Array.isArray(circuit) || !Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || !mapping) throw new Error('Malformed fanout inputs');
    const boards = circuit.filter(e => e.type === 'pcb_board');
    if (boards.length !== 1) throw new Error('Fanout requires one native board');
    const board = boards[0];
    if (![2, 4].includes(board.num_layers)) throw new Error('Prototype requires a known two/four-layer native board');
    const copperLayers = board.num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'];
    const nativeLayers = (e: any): string[] => {
      if (e.type === 'pcb_smtpad') {
        if (typeof e.layer !== 'string' || !copperLayers.includes(e.layer)) throw new Error('Missing/unsupported native pad layer');
        return [e.layer];
      }
      if (!Array.isArray(e.layers) || !e.layers.length || e.layers.some((l: any) => typeof l !== 'string' || !copperLayers.includes(l))) throw new Error('Missing/unsupported native plated-pad/via layers');
      const indexes = e.layers.map((l: string) => copperLayers.indexOf(l)), span = copperLayers.slice(Math.min(...indexes), Math.max(...indexes) + 1);
      if (e.from_layer !== undefined || e.to_layer !== undefined) {
        if (!copperLayers.includes(e.from_layer) || !copperLayers.includes(e.to_layer)) throw new Error('Missing/unsupported native via layer endpoint');
        const endpoints = [copperLayers.indexOf(e.from_layer), copperLayers.indexOf(e.to_layer)], actual = copperLayers.slice(Math.min(...endpoints), Math.max(...endpoints) + 1);
        if (span.length !== actual.length || span.some(l => !actual.includes(l))) throw new Error('Contradictory native via layer span');
      }
      return span;
    };
    const boardShape: Shape = Array.isArray(board.outline) && board.outline.length >= 3 ? [ring(board.outline)] : rectangle(number(board.center?.x, 'board x'), number(board.center?.y, 'board y'), board.width, board.height);
    const turns = boardShape[0]!.slice(0, -1).map((p, i, r) => cross(p, r[(i + 1) % r.length]!, r[(i + 2) % r.length]!)).filter(v => Math.abs(v) > EPS);
    if (!turns.length || turns.some(v => Math.sign(v) !== Math.sign(turns[0]!))) throw new Error('Prototype requires a convex native board outline');
    const boardMargin = Math.max(CLEARANCE, board.min_board_edge_clearance ?? CLEARANCE);
    const holeMargin = Math.max(.2, number(board.min_trace_to_hole_edge_clearance ?? .2, 'native trace-to-hole clearance'));
    const allPads = circuit.filter(e => ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type)).map(pad => ({ pad, shape: padShape(pad), layers: nativeLayers(pad), voidShape: pad.type === 'pcb_plated_hole' ? drillShape(pad, false) : undefined }));
    const vias = circuit.filter(e => e.type === 'pcb_via').map(pad => {
      const outer = positive(pad.outer_diameter, 'via outer diameter'), drill = positive(pad.hole_diameter, 'via drill diameter');
      if (outer <= drill) throw new Error('Invalid native via annulus: drill removes its copper');
      return { pad, shape: capsule([pad.x, pad.y], [pad.x, pad.y], outer / 2), layers: nativeLayers(pad), voidShape: drillShape(pad, false) };
    });
    for (const p of allPads.filter(p => p.voidShape)) {
      const outer = box(p.shape), hole = box(p.voidShape!);
      if (hole.right - hole.left >= outer.right - outer.left || hole.top - hole.bottom >= outer.top - outer.bottom || p.voidShape![0]!.some(point => !inside(point, p.shape))) throw new Error('Invalid native plated-pad annulus');
    }
    const drills = [
      ...allPads.filter(p => p.pad.type === 'pcb_plated_hole').map(p => ({ ...p, shape: drillShape(p.pad) })),
      ...vias.map(p => ({ ...p, shape: drillShape(p.pad) })),
      ...circuit.filter(e => e.type === 'pcb_hole').map(pad => ({ pad, shape: drillShape(pad), layers: copperLayers })),
    ];
    const keepouts = circuit.filter(e => e.type === 'pcb_keepout').map(k => {
      if (!['rect', 'rotated_rect'].includes(k.shape)) throw new Error(`Unsupported keepout shape ${k.shape}`);
      if (!Array.isArray(k.layers) || !k.layers.length || k.layers.some((l: any) => typeof l !== 'string' || ![...copperLayers, 'all'].includes(l))) throw new Error('Missing/unsupported native keepout layers');
      if (k.excluded_pcb_component_ids !== undefined && (!Array.isArray(k.excluded_pcb_component_ids) || k.excluded_pcb_component_ids.some((id: any) => typeof id !== 'string'))) throw new Error('Malformed native keepout exclusions');
      return { k, shape: rectangle(k.center?.x, k.center?.y, k.width, k.height, k.ccw_rotation ?? 0) };
    });
    const netByPin = new Map<string, PlanGraph['nets'][number]>();
    for (const net of graph.nets) for (const p of net.pins) { const key = `${p.ref}.${p.pad}`; if (netByPin.has(key)) throw new Error(`Physical pin appears in multiple graph nets: ${key}`); netByPin.set(key, net); }
    const candidatePads = new Map<FanoutProposal, any>();
    const owners = new Map<FanoutProposal, string>();
    for (const part of graph.parts.filter(p => isFanoutTarget(p.part))) {
      const ref = part.ref;
      try {
        const sources = circuit.filter(e => e.type === 'source_component' && e.name === ref);
        if (sources.length !== 1 || sources[0].manufacturer_part_number !== part.part.mpn) throw new Error('Missing/ambiguous native source identity');
        const components = circuit.filter(e => e.type === 'pcb_component' && e.source_component_id === sources[0].source_component_id);
        if (components.length !== 1) throw new Error('Missing/ambiguous native component');
        const component = components[0], centre: Point = [number(component.center?.x, 'component x'), number(component.center?.y, 'component y')];
        const rotation = number(component.rotation, 'component rotation'), quarter = Math.round(rotation / 90);
        if (Math.abs(rotation / 90 - quarter) > 1e-6 || !['top', 'bottom'].includes(component.layer)) throw new Error('Prototype requires cardinal component orientation on an outer layer');
        const local = (p: Point) => rotate([p[0] - centre[0], p[1] - centre[1]], -quarter);
        const pads = allPads.filter(p => p.pad.pcb_component_id === component.pcb_component_id);
        const rectangular = pads.filter(p => ['rect', 'rotated_rect', 'pill', 'rotated_pill'].includes(p.pad.shape)).map(p => {
          const shape = [p.shape[0]!.map(local)], b = box(shape), c: Point = [(b.left + b.right) / 2, (b.bottom + b.top) / 2];
          return { ...p, localShape: shape, box: b, centre: c, w: b.right - b.left, h: b.top - b.bottom };
        });
        const elongated = rectangular.filter(p => Math.min(p.w, p.h) <= .45 && Math.max(p.w, p.h) >= Math.min(p.w, p.h) * 1.5);
        if (elongated.length < 6) throw new Error('Dense perimeter detection needs at least six elongated rectangular/pill pads');
        const extremes = { left: Math.min(...elongated.map(p => p.centre[0])), right: Math.max(...elongated.map(p => p.centre[0])), bottom: Math.min(...elongated.map(p => p.centre[1])), top: Math.max(...elongated.map(p => p.centre[1])) };
        const outer = { left: Math.min(...rectangular.map(p => p.box.left)), right: Math.max(...rectangular.map(p => p.box.right)), bottom: Math.min(...rectangular.map(p => p.box.bottom)), top: Math.max(...rectangular.map(p => p.box.top)) };
        const perimeter = elongated.map(p => {
          const normals: Point[] = [];
          if (p.w > p.h * 1.5 && Math.abs(p.centre[0] - extremes.left) < .05) normals.push([-1, 0]);
          if (p.w > p.h * 1.5 && Math.abs(p.centre[0] - extremes.right) < .05) normals.push([1, 0]);
          if (p.h > p.w * 1.5 && Math.abs(p.centre[1] - extremes.bottom) < .05) normals.push([0, -1]);
          if (p.h > p.w * 1.5 && Math.abs(p.centre[1] - extremes.top) < .05) normals.push([0, 1]);
          if (normals.length !== 1) throw new Error('Ambiguous perimeter pad direction');
          return { ...p, normal: normals[0]! };
        });
        const pitches = perimeter.flatMap((a, i) => perimeter.slice(i + 1).filter(b => a.normal[0] === b.normal[0] && a.normal[1] === b.normal[1]).map(b => Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1])));
        if (!pitches.length || Math.min(...pitches) > .8) throw new Error('Perimeter pad pitch is outside this dense-pad prototype');
        const eligiblePads = new Set(perimeter.map(p => p.pad));
        for (const p of pads) {
          const physical = Object.entries(part.part.pins).filter(([_name, pin]) => p.pad.port_hints?.includes(mapping[ref]?.[pin.pad]));
          if (physical.length !== 1) throw new Error('Native pad has no unique physical graph mapping');
          const [logical, pin] = physical[0]!, net = netByPin.get(`${ref}.${pin.pad}`);
          if (pin.role === 'nc' || !net || net.pins.length < 2 || eligiblePads.has(p.pad)) continue;
          const b = box([p.shape[0]!.map(local)]), x = (b.left + b.right) / 2, y = (b.bottom + b.top) / 2;
          const centreGround = pin.role === 'ground' && b.right - b.left > .45 && b.top - b.bottom > .45 && Math.abs(x) < Math.max(Math.abs(extremes.left), Math.abs(extremes.right)) / 2 && Math.abs(y) < Math.max(Math.abs(extremes.bottom), Math.abs(extremes.top)) / 2;
          if (!centreGround) throw new Error(`Connected noncentral pad ${logical}/${pin.pad} is not eligible for this perimeter fanout prototype`);
        }
        for (const p of perimeter) {
          const physical = Object.entries(part.part.pins).filter(([_name, pin]) => p.pad.port_hints?.includes(mapping[ref]?.[pin.pad]));
          if (physical.length !== 1) throw new Error('Native perimeter pad has no unique physical graph mapping');
          const [logical, pin] = physical[0]!, net = netByPin.get(`${ref}.${pin.pad}`);
          if (pin.role === 'nc' || !net || net.pins.length < 2) continue;
          const pcbPort = circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === p.pad.pcb_port_id), sourcePort = circuit.find(e => e.type === 'source_port' && e.source_port_id === pcbPort?.source_port_id);
          if (!sourcePort || sourcePort.source_component_id !== sources[0].source_component_id || sourcePort.pin_number !== Number(pin.pad) || Math.hypot(number(pcbPort.x, 'port x') - p.pad.x, number(pcbPort.y, 'port y') - p.pad.y) > 1e-4) throw new Error(`Native pad/source-port correspondence failed for ${logical}`);
          const power = net.pins.some(p => ['power-in', 'power-out', 'ground'].includes(graph.parts.find(g => g.ref === p.ref)?.part.pins[p.logical]?.role ?? ''));
          const width = power ? .3 : .15, n = p.normal;
          const length = n[0] < 0 ? p.centre[0] - outer.left + EXIT_MARGIN : n[0] > 0 ? outer.right - p.centre[0] + EXIT_MARGIN : n[1] < 0 ? p.centre[1] - outer.bottom + EXIT_MARGIN : outer.top - p.centre[1] + EXIT_MARGIN;
          if (!finite(length) || length < EXIT_MARGIN || length > MAX_LENGTH) throw new Error('Outward exit exceeds bounded stub length');
          const normal = rotate(n, quarter), start = { route_type: 'wire' as const, x: p.pad.x, y: p.pad.y, layer: component.layer as 'top' | 'bottom', width };
          const proposal: FanoutProposal = { ref, pad: pin.pad, route: [start, { ...start, x: start.x + normal[0] * length, y: start.y + normal[1] * length }] };
          proposals.push(proposal); candidatePads.set(proposal, p.pad); owners.set(proposal, component.pcb_component_id);
        }
      } catch (cause) { error('dense-fanout-geometry', cause instanceof Error ? cause.message : String(cause), ref); }
    }
    for (const proposal of proposals) {
      const [a, b] = proposal.route, from: Point = [a!.x, a!.y], to: Point = [b!.x, b!.y], sweep = capsule(from, to, a!.width / 2 + CLEARANCE);
      const edgeSweep = capsule(from, to, a!.width / 2 + boardMargin);
      if (edgeSweep[0]!.some(point => !inside(point, boardShape))) error('fanout-board', 'Swept stub violates native board-edge clearance', proposal.ref, proposal.pad);
      for (const obstacle of [...allPads, ...vias]) if (obstacle.pad !== candidatePads.get(proposal) && obstacle.layers.includes(a!.layer) && overlaps(sweep, obstacle.shape) && !(obstacle.voidShape && sweep[0]!.every(point => inside(point, obstacle.voidShape!)))) error(obstacle.pad.type === 'pcb_via' ? 'fanout-via-clearance' : 'fanout-pad-clearance', `Swept stub violates ${CLEARANCE} mm copper clearance to ${obstacle.pad.pcb_smtpad_id ?? obstacle.pad.pcb_plated_hole_id ?? obstacle.pad.pcb_via_id ?? 'foreign/NC pad'}`, proposal.ref, proposal.pad);
      const drillSweep = capsule(from, to, a!.width / 2 + holeMargin);
      for (const drill of drills) if (drill.layers.includes(a!.layer) && overlaps(drillSweep, drill.shape)) error('fanout-drill-clearance', `Swept stub violates ${holeMargin} mm drill-edge clearance to ${drill.pad.pcb_hole_id ?? drill.pad.pcb_plated_hole_id ?? drill.pad.pcb_via_id ?? 'native drill'}`, proposal.ref, proposal.pad);
      for (const { k, shape } of keepouts) if (!k.excluded_pcb_component_ids?.includes(owners.get(proposal)) && (k.layers?.includes(a!.layer) || k.layers?.includes('all')) && overlaps(sweep, shape)) error('fanout-keepout', 'Swept stub intersects a native copper keepout', proposal.ref, proposal.pad);
    }
    for (let i = 0; i < proposals.length; i++) for (let j = i + 1; j < proposals.length; j++) {
      const a = proposals[i]!, b = proposals[j]!; if (a.route[0]!.layer !== b.route[0]!.layer) continue;
      const sweep = capsule([a.route[0]!.x, a.route[0]!.y], [a.route[1]!.x, a.route[1]!.y], a.route[0]!.width / 2 + CLEARANCE), other = capsule([b.route[0]!.x, b.route[0]!.y], [b.route[1]!.x, b.route[1]!.y], b.route[0]!.width / 2);
      if (overlaps(sweep, other)) error('fanout-stub-clearance', `Proposed exit conflicts with ${b.ref}.${b.pad}`, a.ref, a.pad);
    }
  } catch (cause) { error('fanout-input', cause instanceof Error ? cause.message : String(cause)); }
  return { ok: !diagnostics.some(d => d.severity === 'error'), proposals, diagnostics };
}
