import polygon from 'polygon-clipping';
import type { PlanGraph } from '../../src/blocks/graph.js';

type Point = [number, number]; type Poly = Point[][]; type Multi = Poly[];
interface Issue { rule: string; severity: 'error' | 'warning'; message: string; terminals?: string[] }
interface Primitive { id: string; type: string; layer: string; lower: Multi; upper: Multi; terminal?: string; barrel?: string }
interface Node { shape: Poly; box: number[]; primitive: Primitive }
interface DrillVoid { key: string; layers: string[]; lower: Multi; upper: Multi; box: number[] }
interface Annulus extends DrillVoid {
  id: string;
  circle?: { x: number; y: number; innerRadius: number; outerInradius: number; ownDrillUpper: Multi };
}
interface AnnulusCollarCertificate {
  id: string;
  layers: Array<{ layer: string; innerRadiusMm: number; outerRadiusMm: number; remainingPolygons: 1 }>;
}
export interface CopperNetlistOptions { policy?: 'top-plane' | 'physical-network'; scope?: 'ground' | 'all' }
interface CopperNetwork {
  name: string; expected: string[]; connectedGroups: string[][];
  islands: Array<{terminals:string[];bounds:number[];layers:string[];pourIds:string[]}>;
}
export interface CopperNetlistResult {
  ok: boolean; checked: true; scope: 'ground-only-actual-copper' | 'all-nets-actual-copper'; policy: 'top-plane' | 'physical-network'; issues: Issue[];
  groundNets: CopperNetwork[]; networks?: CopperNetwork[];
  annulusCollarCertificates?: AnnulusCollarCertificate[];
  counts: Record<string, number>; method: string;
}
const EPS = 1e-6, AREA = 1e-12, STEPS = 48, SEC = 1 / Math.cos(Math.PI / STEPS);
const number = (v: any, label: string): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Missing/nonfinite ${label}`); return v; };
const positive = (v: any, label: string): number => { const n = number(v, label); if (n <= 0) throw new Error(`Nonpositive ${label}`); return n; };
const ring = (p: any[]): Point[] => {
  if (!Array.isArray(p) || p.length < 3) throw new Error('Unsupported/malformed copper polygon');
  // Native BREP bulges describe circular arcs. This oracle proves straight
  // polygon edges only; replacing an inward arc with its chord can invent Cu.
  if (p.some(vertex => vertex?.bulge !== undefined && (typeof vertex.bulge !== 'number' || !Number.isFinite(vertex.bulge) || vertex.bulge !== 0))) throw new Error('Unsupported nonzero/nonfinite copper polygon bulge');
  const r = p.map(p => [number(Array.isArray(p) ? p[0] : p.x, 'polygon x'), number(Array.isArray(p) ? p[1] : p.y, 'polygon y')] as Point);
  if (r[0]![0] !== r.at(-1)![0] || r[0]![1] !== r.at(-1)![1]) r.push(r[0]!);
  if(Math.abs(r.reduce((s,p,i)=>s+p[0]*r[(i+1)%r.length]![1]-r[(i+1)%r.length]![0]*p[1],0)/2)<=AREA)throw new Error('Degenerate copper polygon');
  for(let i=1;i<r.length;i++)for(let j=i+2;j<r.length;j++){if(i===1&&j===r.length-1)continue;const a=r[i-1]!,b=r[i]!,c=r[j-1]!,d=r[j]!;if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)throw new Error('Self-intersecting copper polygon');}
  return r;
};
const bbox = (m: Multi): number[] => { const p = m.flat(2); return [Math.min(...p.map(p => p[0])), Math.min(...p.map(p => p[1])), Math.max(...p.map(p => p[0])), Math.max(...p.map(p => p[1]))]; };
const near = (a: number[], b: number[]) => a[0]! <= b[2]! + EPS && a[2]! + EPS >= b[0]! && a[1]! <= b[3]! + EPS && a[3]! + EPS >= b[1]!;
const area = (m: Multi): number => number(m.reduce((sum, p) => sum + p.reduce((a, r, h) => a + (h ? -1 : 1) * Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * p[1], 0) / 2), 0), 0), 'copper area');
const diff = (a: Multi, b: Multi[]): Multi => b.length ? polygon.difference(a as any, ...b as any) as Multi : a;
function capsule(ax: number, ay: number, bx: number, by: number, radius: number, upper: boolean): Poly {
  [ax, ay, bx, by].forEach(x => number(x, 'capsule coordinate')); const r = positive(radius, 'copper radius') * (upper ? SEC : 1), a = Math.atan2(by - ay, bx - ax);
  return [ring([...Array.from({ length: 25 }, (_, i) => [bx + r * Math.cos(a - Math.PI / 2 + i * Math.PI / 24), by + r * Math.sin(a - Math.PI / 2 + i * Math.PI / 24)]), ...Array.from({ length: 25 }, (_, i) => [ax + r * Math.cos(a + Math.PI / 2 + i * Math.PI / 24), ay + r * Math.sin(a + Math.PI / 2 + i * Math.PI / 24)])])];
}
function rect(x: number, y: number, w: number, h: number, angle = 0, radius = 0, upper = false): Poly {
  number(x, 'rectangle x'); number(y, 'rectangle y'); positive(w, 'rectangle width'); positive(h, 'rectangle height'); number(angle, 'rectangle rotation');
  if (!Number.isFinite(radius) || radius < 0 || radius > Math.min(w, h) / 2 + EPS) throw new Error('Invalid rounded rectangle radius');
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), points: Point[] = [];
  if (!radius) points.push([-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]);
  else for (let corner = 0; corner < 4; corner++) for (let i = 0; i <= 12; i++) {
    const t = (corner * 90 + i * 7.5) * Math.PI / 180, cx = [1, -1, -1, 1][corner]! * (w / 2 - radius), cy = [1, 1, -1, -1][corner]! * (h / 2 - radius);
    points.push([cx + radius * (upper ? SEC : 1) * Math.cos(t), cy + radius * (upper ? SEC : 1) * Math.sin(t)]);
  }
  return [ring(points.map(([dx, dy]) => [x + dx * c - dy * s, y + dx * s + dy * c]))];
}
function pill(x: number, y: number, w: number, h: number, angle: number, upper: boolean): Poly {
  positive(w, 'pill width'); positive(h, 'pill height'); const r = Math.min(w, h) / 2, d = Math.abs(w - h) / 2, a = (number(angle, 'pill rotation') + (h > w ? 90 : 0)) * Math.PI / 180;
  return capsule(x - d * Math.cos(a), y - d * Math.sin(a), x + d * Math.cos(a), y + d * Math.sin(a), r, upper);
}
function pad(p: any, upper: boolean): Poly {
  if (p.shape === 'polygon') return [ring(p.points)];
  const x = number(p.x, 'pad x'), y = number(p.y, 'pad y');
  if (p.shape === 'circle') return capsule(x, y, x, y, positive(p.outer_diameter ?? p.diameter ?? p.radius * 2, 'pad diameter') / 2, upper);
  if (['rect', 'rotated_rect'].includes(p.shape)) return rect(x, y, p.width, p.height, p.ccw_rotation ?? 0, p.corner_radius ?? p.rect_border_radius ?? 0, upper);
  if (['pill', 'oval', 'rotated_pill'].includes(p.shape)) return pill(x, y, p.width ?? p.outer_width, p.height ?? p.outer_height, p.ccw_rotation ?? 0, upper);
  if (['circular_hole_with_rect_pad', 'pill_hole_with_rect_pad', 'rotated_pill_hole_with_rect_pad'].includes(p.shape)) return rect(x, y, p.rect_pad_width, p.rect_pad_height, p.rect_ccw_rotation ?? 0, p.rect_border_radius ?? 0, upper);
  throw new Error(`Unsupported native pad geometry ${p.shape}`);
}
function drill(p: any, upper: boolean): Poly {
  const x = number(p.x, 'drill x') + number(p.hole_offset_x ?? 0, 'drill offset'), y = number(p.y, 'drill y') + number(p.hole_offset_y ?? 0, 'drill offset');
  if (p.hole_diameter !== undefined) return capsule(x, y, x, y, positive(p.hole_diameter, 'drill diameter') / 2, upper);
  if (['pill', 'oval', 'rotated_pill'].includes(p.hole_shape ?? p.shape)) return pill(x, y, p.hole_width, p.hole_height, p.hole_ccw_rotation ?? p.ccw_rotation ?? 0, upper);
  if (p.hole_shape === 'rect') return rect(x, y, p.hole_width, p.hole_height, p.ccw_rotation ?? 0);
  throw new Error('Unsupported drill geometry');
}
const cross = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const ringBoxes = new WeakMap<Point[],number[]>();
function ringBox(r:Point[]) { let b=ringBoxes.get(r);if(!b){b=bbox([[r]]);ringBoxes.set(r,b);}return b; }
function pointDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = dx * dx + dy * dy, t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function insideRing(p:Point,r:Point[]) { let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i]!,b=r[j]!;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside; }
function inside(p:Point,shape:Poly) {return insideRing(p,shape[0]!)&&!shape.slice(1).some(r=>insideRing(p,r));}
function touch(a: Poly, b: Poly): boolean {
  if (!near(bbox([a]), bbox([b]))) return false;
  if(inside(a[0]![0]!,b)||inside(b[0]![0]!,a))return true;
  for (const ar of a) for (const br of b) { if(!near(ringBox(ar),ringBox(br)))continue;for (let i = 1; i < ar.length; i++) for (let j = 1; j < br.length; j++) {
    const p = ar[i - 1]!, q = ar[i]!, r = br[j - 1]!, s = br[j]!;
    if (!near([Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])], [Math.min(r[0], s[0]), Math.min(r[1], s[1]), Math.max(r[0], s[0]), Math.max(r[1], s[1])])) continue;
    if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0 || Math.min(pointDistance(p, r, s), pointDistance(q, r, s), pointDistance(r, p, q), pointDistance(s, p, q)) <= EPS) return true;
  }}
  return false;
}
class Union {
  p: number[]; constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { return this.p[i] === i ? i : this.p[i] = this.find(this.p[i]!); }
  join(a: number, b: number) { this.p[this.find(a)] = this.find(b); }
}
function components(nodes: Node[]) {
  const u = new Union(nodes.length), order = nodes.map((_n, i) => i).sort((a, b) => nodes[a]!.box[0]! - nodes[b]!.box[0]!);
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
    const ai = order[i]!, bi = order[j]!, a = nodes[ai]!, b = nodes[bi]!;
    if (b.box[0]! > a.box[2]! + EPS) break;
    if (a.primitive.layer === b.primitive.layer && u.find(ai) !== u.find(bi) && near(a.box, b.box) && touch(a.shape, b.shape)) u.join(ai, bi);
  }
  const sameLayer = nodes.map((_n, i) => u.find(i)), barrels = new Map<string, number>();
  nodes.forEach((n, i) => { const key = n.primitive.barrel; if (key) { if (barrels.has(key)) u.join(i, barrels.get(key)!); else barrels.set(key, i); } });
  return { u, sameLayer };
}

/** A partial outer-ring notch does not erase an intact circular barrel. Prove
 * a complete positive lower-Cu collar around its upper-bounded own drill,
 * plus one connected remaining annulus on every physical layer. No net label
 * grants this certificate. Noncircular/off-centre barrels remain unsupported.
 */
function circularAnnulusCollar(a: Annulus, holes: DrillVoid[]): AnnulusCollarCertificate | undefined {
  const circle = a.circle;
  if (!circle) return;
  const layers: AnnulusCollarCertificate['layers'] = [];
  for (const layer of a.layers) {
    const foreign = holes.filter(h => h.key !== a.key && h.layers.includes(layer));
    let limit = circle.outerInradius;
    for (const h of foreign) {
      // Enclose the existing circumscribed drill polygons with a disk. This is
      // deliberately conservative for slots and irregular foreign holes.
      const x = (h.box[0]! + h.box[2]!) / 2, y = (h.box[1]! + h.box[3]!) / 2;
      const radius = Math.max(...h.upper.flat(2).map(p => Math.hypot(p[0] - x, p[1] - y)));
      limit = Math.min(limit, Math.hypot(x - circle.x, y - circle.y) - radius);
    }
    if (!(limit > circle.innerRadius + EPS)) return;
    const radius = (circle.innerRadius + limit) / 2;
    // The inscribed polygon must itself leave a full positive circular collar.
    if (!(radius / SEC > circle.innerRadius + EPS)) return;
    const remaining = diff(a.lower, foreign.map(h => h.upper));
    if (remaining.length !== 1 || area(remaining) <= AREA) return;
    const collar = diff([capsule(circle.x, circle.y, circle.x, circle.y, radius, false)], [circle.ownDrillUpper]);
    if (collar.length !== 1 || area(collar) <= AREA || area(diff(collar, [remaining])) > AREA) return;
    layers.push({ layer, innerRadiusMm: circle.innerRadius, outerRadiusMm: radius / SEC, remainingPolygons: 1 });
  }
  return { id: a.id, layers };
}

/** Physical copper proof. Source traces/net names never join geometry. */
export function checkCopperNetlist(graph: PlanGraph, circuit: any[], mapping: Record<string, Record<string, string>>, options: CopperNetlistOptions = {}): CopperNetlistResult {
  const issues: Issue[] = [], groundNets: CopperNetwork[] = [], networks: CopperNetwork[] = [], annulusCollarCertificates: AnnulusCollarCertificate[] = [], counts: Record<string, number> = {};
  const policy = options?.policy === 'physical-network' ? 'physical-network' : 'top-plane';
  const all = options?.scope === 'all';
  const report = (rule: string, message: string, terminals?: string[]) => issues.push({ rule, severity: 'error', message, ...(terminals ? { terminals } : {}) });
  const method = `${all ? 'All-net' : 'Ground-only'} actual-copper continuity and isolation; policy=${policy}. ${policy === 'top-plane' ? 'Every TOP ground piece directly touches TOP pour.' : 'Every ground pad piece shares one physical copper component containing an actual copper pour; direct TOP pour contact is optional.'} ${all ? 'Every graph net must have all actual terminal pieces in one physical copper component and no foreign terminal contact; non-ground nets need no pour. ' : ''}Per-layer polygon contact and physical plated barrels join layers. Partial circular-via outer-ring cuts require a complete positive copper collar and one remaining lower polygon on every layer after all actual drills. Positive connectivity uses inscribed copper/circumscribed drills and minimum endpoint trace width; short detection reverses bounds and uses maximum width. No electrical union by source trace, connectivity key, logical terminal alias or declared net. Rounded contacts are bounded48-gons;1e-6mm coordinate touch tolerance. Not impedance, ${all ? '' : 'other-net continuity or '}manufactured-board proof.`;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['policy', 'scope'].includes(key)) || options.policy !== undefined && !['top-plane', 'physical-network'].includes(options.policy) || options.scope !== undefined && !['ground', 'all'].includes(options.scope)) throw new Error('Invalid copper-netlist policy/scope options');
    if (!Array.isArray(circuit) || !Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || !mapping) throw new Error('Malformed copper oracle inputs');
    const boards = circuit.filter(e => e.type === 'pcb_board'); if (boards.length !== 1 || ![2, 4].includes(boards[0].num_layers)) throw new Error('Oracle requires one known2/4layer board');
    const stack = boards[0].num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'];
    const layers = (e: any, plated = false): string[] => {
      if (!plated) { if (!stack.includes(e.layer)) throw new Error(`Invalid/missing ${e.type} copper layer`); return [e.layer]; }
      if (!Array.isArray(e.layers) || !e.layers.length || e.layers.some((l: any) => !stack.includes(l))) throw new Error('Invalid/missing plated copper layers');
      const a = e.layers.map((l: string) => stack.indexOf(l)), span = stack.slice(Math.min(...a), Math.max(...a) + 1);
      // Native through-vias have all physical copper layers, even when a route changes
      // only top -> inner1. Route endpoints must be within the physical barrel span.
      if (e.from_layer !== undefined || e.to_layer !== undefined) { if (!span.includes(e.from_layer) || !span.includes(e.to_layer)) throw new Error('Contradictory via layer span'); }
      return span;
    };
    const rawPads = circuit.filter(e => ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type)), terminalOf = new Map<any, string>(), terminals = new Set<string>();
    for (const p of graph.parts) {
      const sources = circuit.filter(e => e.type === 'source_component' && e.name === p.ref); if (sources.length !== 1) throw new Error(`Unattested source identity ${p.ref}`);
      const source = sources[0], pcs = circuit.filter(e => e.type === 'pcb_component' && e.source_component_id === source.source_component_id); if (pcs.length !== 1) throw new Error(`Unattested PCB identity ${p.ref}`);
      for (const [logical, pin] of Object.entries(p.part.pins)) {
        const alias = mapping[p.ref]?.[pin.pad]; if (!alias) throw new Error(`Missing physical pad mapping ${p.ref}.${pin.pad}`);
        const ownedPorts = circuit.filter(e => e.type === 'source_port' && e.source_component_id === source.source_component_id);
        const numbered = ownedPorts.filter(e => String(e.pin_number) === pin.pad && e.port_hints?.includes(alias)), exact = ownedPorts.filter(e => e.name === alias), ports = numbered.length ? numbered : exact.length ? exact : ownedPorts.filter(e => e.port_hints?.includes(alias));
        if (ports.length !== 1) throw new Error(`Unattested native alias ${p.ref}.${pin.pad}`);
        const pads = rawPads.filter(e => e.pcb_component_id === pcs[0].pcb_component_id && e.port_hints?.includes(alias));
        if (!pads.length) throw new Error(`Missing actual physical pad ${p.ref}.${pin.pad}`);
        const terminal = `${p.ref}.${pin.pad}`; terminals.add(terminal);
        for (const pad of pads) {
          const port = circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === pad.pcb_port_id);
          const aliases = [...(source.internally_connected_source_port_ids ?? []), ...circuit.filter(e => e.type === 'source_component_internal_connection' && e.source_component_id === source.source_component_id).map(e => e.source_port_ids)].filter(ids => Array.isArray(ids) && ids.includes(ports[0].source_port_id));
          if (!port || port.pcb_component_id !== pcs[0].pcb_component_id || port.source_port_id !== ports[0].source_port_id && !aliases.some(ids => ids.includes(port.source_port_id))) throw new Error(`Pad/port physical identity mismatch ${terminal}/${logical}`);
          if (terminalOf.has(pad) && terminalOf.get(pad) !== terminal) throw new Error('One native pad aliases distinct physical graph terminals'); terminalOf.set(pad, terminal);
        }
      }
    }
    if (rawPads.some(p => !terminalOf.has(p))) throw new Error('Native copper pad has no attested graph physical identity');
    const primitives: Primitive[] = [], holes: DrillVoid[] = [], annuli: Annulus[] = [];
    const add = (e: any, lo: Multi, hi: Multi, ls: string[], terminal?: string, barrel?: string) => { for (const layer of ls) primitives.push({ id: e[`${e.type}_id`] ?? `${e.type}:${primitives.length}`, type: e.type, layer, lower: lo, upper: hi, ...(terminal ? { terminal } : {}), ...(barrel ? { barrel } : {}) }); };
    const plated = (e: any, terminal?: string) => {
      const ls = layers(e, true), dl: Multi = [drill(e, false)], du: Multi = [drill(e, true)], ol: Multi = [pad(e, false)], ou: Multi = [pad(e, true)];
      if (e.outer_diameter !== undefined) { if ((positive(e.outer_diameter, 'outer diameter') - positive(e.hole_diameter, 'hole diameter')) / 2 - Math.hypot(e.hole_offset_x??0,e.hole_offset_y??0) + EPS < .15) throw new Error('Plated annulus must remain at least0.15mm'); }
      else {
        const o=ol[0]![0]!,d=du[0]![0]!;
        if(!d.every(p=>inside(p,ol[0]!)))throw new Error('Drill is not wholly inside its plated pad');
        let clearance=Infinity;
        for(let i=1;i<o.length;i++)for(let j=1;j<d.length;j++)clearance=Math.min(clearance,pointDistance(o[i-1]!,d[j-1]!,d[j]!),pointDistance(o[i]!,d[j-1]!,d[j]!),pointDistance(d[j-1]!,o[i-1]!,o[i]!),pointDistance(d[j]!,o[i-1]!,o[i]!));
        if(clearance+EPS<.15)throw new Error('Plated annulus must remain at least0.15mm');
      }
      const key = JSON.stringify([e.x, e.y, e.hole_shape ?? (e.hole_diameter !== undefined ? 'circle' : e.shape), e.hole_diameter, e.hole_width, e.hole_height, e.hole_ccw_rotation ?? e.ccw_rotation ?? 0, e.hole_offset_x ?? 0, e.hole_offset_y ?? 0, ls]);
      holes.push({ key, layers: ls, lower: dl, upper: du, box: bbox(du) });
      const lower = diff(ol, [du]), upper = diff(ou, [dl]); if (!lower.length || area(lower) <= AREA) throw new Error('Drill erased plated copper');
      const circle = e.type === 'pcb_via' && e.shape === 'circle' && (e.hole_offset_x ?? 0) === 0 && (e.hole_offset_y ?? 0) === 0
        ? { x: e.x, y: e.y, innerRadius: e.hole_diameter / 2 * SEC, outerInradius: e.outer_diameter / 2 / SEC, ownDrillUpper: du } : undefined;
      annuli.push({ key, id:e.pcb_via_id??e.pcb_plated_hole_id??'unknown',layers:ls, lower, upper, box: bbox(upper), ...(circle ? { circle } : {}) }); add(e, lower, upper, ls, terminal, key);
    };
    for (const e of circuit) {
      if (e.type === 'pcb_smtpad') add(e, [pad(e, false)], [pad(e, true)], layers(e), terminalOf.get(e));
      if (e.type === 'pcb_plated_hole') plated(e, terminalOf.get(e));
      if (e.type === 'pcb_via') plated({ ...e, shape: 'circle' });
      if (e.type === 'pcb_hole') { const lower: Multi = [drill(e, false)], upper: Multi = [drill(e, true)]; holes.push({ key: `NPTH:${e.pcb_hole_id}`, layers: stack, lower, upper, box: bbox(upper) }); }
      if (typeof e.type === 'string' && e.type.startsWith('pcb_copper_') && !e.type.endsWith('_warning') && !e.type.endsWith('_error')) {
        if (e.type !== 'pcb_copper_pour' || e.shape !== 'brep' || !Array.isArray(e.brep_shape?.inner_rings)) throw new Error('Unsupported native copper region');
        const shape: Multi = [[ring(e.brep_shape.outer_ring.vertices), ...e.brep_shape.inner_rings.map((r: any) => ring(r.vertices))]]; add(e, shape, shape, layers(e));
      }
    }
    for (const t of circuit.filter(e => e.type === 'pcb_trace')) {
      if (!Array.isArray(t.route) || t.route.length < 2) throw new Error('Unsupported native trace geometry');
      const groups = new Map<string, { lower: Poly[]; upper: Poly[] }>();
      for (const v of t.route.filter((p: any) => p.route_type === 'via')) {
        const actual = circuit.filter(e => e.type === 'pcb_via' && Math.abs(e.x - v.x) <= EPS && Math.abs(e.y - v.y) <= EPS && e.outer_diameter === v.via_diameter && e.hole_diameter === v.via_hole_diameter && layers(e, true).includes(v.from_layer) && layers(e, true).includes(v.to_layer));
        if (actual.length !== 1) throw new Error('Route via lacks unique actual physical barrel geometry');
      }
      for (let i = 1; i < t.route.length; i++) {
        const a = t.route[i - 1], b = t.route[i]; if (![a, b].every(p => ['wire', 'via'].includes(p.route_type))) throw new Error('Unsupported native trace segment');
        const w = a.route_type === 'wire' ? a : b.route_type === 'wire' ? b : undefined;
        if (!w) { if (Math.hypot(a.x - b.x, a.y - b.y) > EPS) throw new Error('Unsupported via-to-via segment'); continue; }
        if (a.route_type === 'wire' && b.route_type === 'wire' && a.layer !== b.layer) throw new Error('Unplated trace layer transition'); layers(w);
        const widths=[a,b].filter(p=>p.route_type==='wire').map(p=>positive(p.width,'trace width'));
        const g = groups.get(w.layer) ?? { lower: [], upper: [] }; g.lower.push(capsule(a.x, a.y, b.x, b.y, Math.min(...widths)/2, false)); g.upper.push(capsule(a.x, a.y, b.x, b.y, Math.max(...widths)/2, true)); groups.set(w.layer, g);
      }
      // Keep each capsule separate: geometric contact joins adjacent segments. Avoid
      // numerically fragile union of many near-collinear rounded trace segments.
      for (const [layer, g] of groups) for (let i=0;i<g.lower.length;i++) add(t, [g.lower[i]!], [g.upper[i]!], [layer]);
    }
    // Do not join layers through erased/severed barrels. Centered circular
    // vias alone may prove an intact collar after every actual drill is cut.
    for (const a of annuli) {
      const cut = holes.some(h => a.key !== h.key && a.layers.some(l => h.layers.includes(l)) && near(a.box, h.box) && area(polygon.intersection(a.upper as any, h.upper as any) as Multi) > AREA);
      if (!cut) continue;
      const certificate = circularAnnulusCollar(a, holes);
      if (certificate) annulusCollarCertificates.push(certificate);
      else report('annulus-drilled-away', `A foreign drill invalidates the intact plated annulus/barrel proof ${a.id}; cross-layer continuity cannot be certified`);
    }
    const lowerNodes: Node[] = [], upperNodes: Node[] = [];
    for (const p of primitives) {
      const b = bbox(p.upper), cuts = holes.filter(h => h.layers.includes(p.layer) && near(b, h.box));
      p.lower = diff(p.lower, cuts.map(h => h.upper)); p.upper = diff(p.upper, cuts.map(h => h.lower));
      if (p.terminal && !p.lower.length) report('pad-drilled-away', `Actual pad copper was removed by drill voids: ${p.id}`, [p.terminal]);
      for (const shape of p.lower) lowerNodes.push({ shape, box: bbox([shape]), primitive: p });
      for (const shape of p.upper) upperNodes.push({ shape, box: bbox([shape]), primitive: p });
    }
    if (lowerNodes.length > 6000 || upperNodes.length > 6000) throw new Error('Copper oracle conductive-piece bound exceeded');
    const lower = components(lowerNodes), upper = components(upperNodes);
    const ground = graph.nets.filter(n => n.pins.some(p => graph.parts.find(g => g.ref === p.ref)?.part.pins[p.logical]?.role === 'ground'));
    if (!ground.length && !all) report('ground-expected-missing', 'Graph declares no ground terminal group');
    if (all) {
      if (!graph.nets.length) throw new Error('All-net oracle requires declared graph nets');
      const names = new Set<string>(), ownership = new Map<string, string>();
      for (const net of graph.nets) {
        if (typeof net.name !== 'string' || !net.name || names.has(net.name) || !Array.isArray(net.pins) || !net.pins.length) throw new Error('Invalid/duplicate physical graph net');
        names.add(net.name);
        for (const pin of net.pins) {
          const terminal = `${pin.ref}.${pin.pad}`, owner = ownership.get(terminal);
          if (owner !== undefined && owner !== net.name) throw new Error(`Physical terminal belongs to distinct graph nets: ${terminal}`);
          ownership.set(terminal, net.name);
        }
      }
    }
    for (const net of all ? graph.nets : ground) {
      const isGround = ground.includes(net), prefix = isGround ? 'ground' : 'net', label = isGround ? 'Ground' : `Net ${net.name}`;
      const expected = [...new Set(net.pins.map(p => `${p.ref}.${p.pad}`))], wanted = new Set(expected);
      if (expected.some(t => !terminals.has(t))) throw new Error(`Expected ${isGround ? 'ground' : 'net'} terminal is not physically attested`);
      const indices = lowerNodes.map((n, i) => wanted.has(n.primitive.terminal ?? '') ? i : -1).filter(i => i >= 0), top = indices.filter(i => lowerNodes[i]!.primitive.layer === 'top');
      const roots = new Map<number, Set<string>>();
      for (const i of indices) { const root = lower.u.find(i), group = roots.get(root) ?? new Set<string>(); group.add(`${lowerNodes[i]!.primitive.terminal}@${lowerNodes[i]!.primitive.id}`); roots.set(root, group); }
      if (roots.size !== 1 || !indices.length) report(`${prefix}-open`, `${label} physical copper pieces are disconnected; logical/internal aliases do not join them`, expected);
      if (isGround && policy === 'top-plane') {
        if (!top.length) report('top-ground-plane-missing', 'No actual TOP ground pad copper', expected);
        const pours = lowerNodes.filter(n => n.primitive.type === 'pcb_copper_pour' && n.primitive.layer === 'top');
        for (const i of top) if (!pours.some(p => near(p.box, lowerNodes[i]!.box) && touch(p.shape, lowerNodes[i]!.shape))) report('ground-pad-not-on-pour', `Physical TOP ground pad must directly touch actual TOP copper pour: ${lowerNodes[i]!.primitive.id}`, [lowerNodes[i]!.primitive.terminal!]);
      } else if (isGround && !lowerNodes.some((n,i) => n.primitive.type === 'pcb_copper_pour' && roots.has(lower.u.find(i)))) {
        report('ground-network-not-on-pour', 'Ground copper must physically connect to an actual copper pour', expected);
      }
      const netRoots = new Set(upperNodes.map((n, i) => wanted.has(n.primitive.terminal ?? '') ? upper.u.find(i) : -1).filter(i => i >= 0)), foreign = new Set<string>();
      upperNodes.forEach((n, i) => { const t = n.primitive.terminal; if (t && !wanted.has(t) && netRoots.has(upper.u.find(i))) foreign.add(t); });
      if (foreign.size) report(`${prefix}-short`, `${label} copper touches foreign, isolated or NC physical terminals`, [...foreign]);
      const islands = [...roots.keys()].map(root => {const ns=lowerNodes.filter((_n,i)=>lower.u.find(i)===root);return {terminals:[...new Set(ns.flatMap(n=>n.primitive.terminal?[n.primitive.terminal]:[]))],bounds:bbox(ns.map(n=>n.shape)),layers:[...new Set(ns.map(n=>n.primitive.layer))],pourIds:[...new Set(ns.filter(n=>n.primitive.type==='pcb_copper_pour').map(n=>n.primitive.id))]};});
      const network = { name: net.name, expected, connectedGroups: [...roots.values()].map(s => [...s]), islands };
      if (isGround) groundNets.push(network);
      if (all) networks.push(network);
    }
    Object.assign(counts, { physicalTerminals: terminals.size, physicalPadPieces: rawPads.length, primitives: primitives.length, lowerConductivePieces: lowerNodes.length, upperConductivePieces: upperNodes.length, physicalDrillRecords: holes.length, groundGroups: groundNets.length, ...(all ? { netGroups: networks.length } : {}) });
  } catch (cause) { report('copper-geometry-unverified', cause instanceof Error ? cause.message : String(cause)); }
  return { ok: !issues.some(i => i.severity === 'error'), checked: true, scope: all ? 'all-nets-actual-copper' : 'ground-only-actual-copper', policy, issues, groundNets, ...(all ? { networks } : {}), ...(annulusCollarCertificates.length ? { annulusCollarCertificates } : {}), counts, method };
}
