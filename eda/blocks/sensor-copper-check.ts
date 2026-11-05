import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import polygon from 'polygon-clipping';
import { unzipSync, strFromU8 } from 'fflate';

const AREA_EPS = 1e-7, EPS = 1e-6, BODY_MM = 1.6, STEPS = 48;
const SEC = 1 / Math.cos(Math.PI / STEPS);
type Point = [number, number]; type Poly = Point[][]; type Multi = Poly[];
const finite = (n: any, label: string): number => { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Nonfinite/missing ${label}`); return n; };
const positive = (n: any, label: string): number => { const v = finite(n, label); if (v <= 0) throw new Error(`Nonpositive ${label}`); return v; };
const ring = (points: any[]): Point[] => {
  if (!Array.isArray(points) || points.length < 3) throw new Error('Unsupported/malformed copper polygon');
  const out = points.map(p => [finite(Array.isArray(p) ? p[0] : p.x, 'polygon x'), finite(Array.isArray(p) ? p[1] : p.y, 'polygon y')] as Point);
  if (out[0]![0] !== out.at(-1)![0] || out[0]![1] !== out.at(-1)![1]) out.push(out[0]!); return out;
};
const rect = (x: number, y: number, w: number, h: number, rotation = 0): Poly => {
  finite(x, 'rect x'); finite(y, 'rect y'); positive(w, 'rect width'); positive(h, 'rect height'); finite(rotation, 'rect rotation');
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [ring([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([dx, dy]) => [x + dx! * c - dy! * s, y + dx! * s + dy! * c]))];
};
// Outer copper is circumscribed; drill voids are inscribed: approximation cannot hide copper.
const circle = (x: number, y: number, r: number, outer = true): Poly => {
  finite(x, 'circle x'); finite(y, 'circle y'); positive(r, 'circle radius');
  return [ring(Array.from({ length: STEPS }, (_, i) => [x + Math.cos(i * 2 * Math.PI / STEPS) * r * (outer ? SEC : 1), y + Math.sin(i * 2 * Math.PI / STEPS) * r * (outer ? SEC : 1)]))];
};
const capsule = (ax: number, ay: number, bx: number, by: number, radius: number, outer = true): Poly => {
  [ax, ay, bx, by].forEach(v => finite(v, 'capsule coordinate')); positive(radius, 'capsule radius');
  if (Math.hypot(bx - ax, by - ay) < EPS) return circle(ax, ay, radius, outer);
  const angle = Math.atan2(by - ay, bx - ax), r = radius * (outer ? SEC : 1);
  return [ring([...Array.from({ length: 25 }, (_, i) => [bx + r * Math.cos(angle - Math.PI / 2 + i * Math.PI / 24), by + r * Math.sin(angle - Math.PI / 2 + i * Math.PI / 24)]), ...Array.from({ length: 25 }, (_, i) => [ax + r * Math.cos(angle + Math.PI / 2 + i * Math.PI / 24), ay + r * Math.sin(angle + Math.PI / 2 + i * Math.PI / 24)])])];
};
const pill = (x: number, y: number, w: number, h: number, rotation = 0, outer = true): Poly => {
  positive(w, 'pill width'); positive(h, 'pill height'); finite(rotation, 'pill rotation');
  const r = Math.min(w, h) / 2, d = Math.abs(w - h) / 2, a = (rotation + (h > w ? 90 : 0)) * Math.PI / 180;
  return capsule(x - d * Math.cos(a), y - d * Math.sin(a), x + d * Math.cos(a), y + d * Math.sin(a), r, outer);
};
const area = (multi: Multi): number => finite(multi.reduce((sum, poly) => sum + poly.reduce((a, r, i) => a + (i ? -1 : 1) * Math.abs(r.reduce((s, p, j) => s + p[0] * r[(j + 1) % r.length]![1] - r[(j + 1) % r.length]![0] * p[1], 0) / 2), 0), 0), 'polygon area');
const difference = (a: any, ...b: any[]): Multi => b.length ? polygon.difference(a, ...b) as Multi : [a];
const intersection = (a: any, b: any): Multi => polygon.intersection(a, b) as Multi;
const bounds = (shape: Poly): [number, number, number, number] => { const p = shape.flat(); return [Math.min(...p.map(p => p[0])), Math.min(...p.map(p => p[1])), Math.max(...p.map(p => p[0])), Math.max(...p.map(p => p[1]))]; };
const touching = (a: Poly, b: Poly): boolean => { const x = bounds(a), y = bounds(b); return x[0] <= y[2] && x[2] >= y[0] && x[1] <= y[3] && x[3] >= y[1]; };

function smtShape(p: any): Poly {
  switch (p.shape) {
    case 'rect': if (p.ccw_rotation !== undefined && p.ccw_rotation !== 0) throw new Error('Ambiguous rect pad rotation'); return rect(p.x, p.y, p.width, p.height);
    case 'rotated_rect': return rect(p.x, p.y, p.width, p.height, finite(p.ccw_rotation, 'pad rotation'));
    case 'polygon': return [ring(p.points)]; // Circuit JSON points are absolute board coordinates.
    case 'circle':
      if (p.radius !== undefined && p.diameter !== undefined && Math.abs(positive(p.radius, 'pad radius') * 2 - positive(p.diameter, 'pad diameter')) > EPS) throw new Error('Ambiguous circular pad dimensions');
      return circle(p.x, p.y, p.radius === undefined ? positive(p.diameter, 'pad diameter') / 2 : positive(p.radius, 'pad radius'));
    case 'pill': case 'rotated_pill':
      if (p.radius !== undefined && Math.abs(positive(p.radius, 'pill radius') - Math.min(p.width, p.height) / 2) > EPS) throw new Error('Unsupported non-stadium pill pad geometry');
      return pill(p.x, p.y, p.width, p.height, p.shape === 'rotated_pill' ? finite(p.ccw_rotation, 'pill rotation') : 0);
    default: throw new Error(`Unsupported native SMT pad geometry ${p.shape}`);
  }
}
function platedShape(p: any): { copper: Poly; drill: Poly } {
  if (p.type === 'pcb_via' || p.shape === 'circle' || p.shape === undefined && p.outer_diameter !== undefined) {
    const outer = positive(p.outer_diameter, 'annulus outer diameter'), drill = positive(p.hole_diameter, 'annulus drill diameter');
    if (outer <= drill) throw new Error('Invalid plated annulus dimensions');
    return { copper: circle(p.x, p.y, outer / 2), drill: circle(p.x, p.y, drill / 2, false) };
  }
  if (['pill', 'oval'].includes(p.shape)) {
    const ow = positive(p.outer_width, 'outer width'), oh = positive(p.outer_height, 'outer height'), hw = positive(p.hole_width, 'hole width'), hh = positive(p.hole_height, 'hole height');
    if (ow <= hw || oh <= hh) throw new Error('Invalid plated pill annulus');
    return { copper: pill(p.x, p.y, ow, oh, p.ccw_rotation ?? 0), drill: pill(p.x, p.y, hw, hh, p.ccw_rotation ?? 0, false) };
  }
  if (['circular_hole_with_rect_pad', 'pill_hole_with_rect_pad', 'rotated_pill_hole_with_rect_pad'].includes(p.shape)) {
    const x = finite(p.x, 'plated x') + (p.hole_offset_x ?? 0), y = finite(p.y, 'plated y') + (p.hole_offset_y ?? 0);
    const drill = p.hole_shape === 'circle' ? circle(x, y, positive(p.hole_diameter, 'hole diameter') / 2, false) : pill(x, y, p.hole_width, p.hole_height, p.hole_ccw_rotation ?? 0, false);
    const copper = rect(p.x, p.y, p.rect_pad_width, p.rect_pad_height, p.rect_ccw_rotation ?? 0);
    if (area(difference(drill, copper)) > AREA_EPS) throw new Error('Drill is outside its plated pad');
    return { copper, drill };
  }
  throw new Error(`Unsupported native plated-hole geometry ${p.shape}`);
}

type Flash = { x: number; y: number; aperture: string; width?: number; height?: number; shape: Poly };
function pasteFlashes(text: string): Flash[] {
  const format = text.match(/%FSLAX(\d)(\d)Y(\d)(\d)\*%/);
  if (!format || format[2] !== format[4] || !text.includes('%MOMM*%')) throw new Error('Unsupported paste coordinate format/units');
  if ([...text.matchAll(/%TF\.FilePolarity,([^*]+)\*%/g)].some(m => m[1] !== 'Positive')) throw new Error('Unsupported negative paste file polarity');
  const scale = 10 ** Number(format[2]), apertures = new Map<string, { type: string; args: number[] }>();
  const macros = new Map<string, string>();
  for (const m of text.matchAll(/%AM([A-Z_0-9]+)\*([\s\S]*?)%/g)) {
    if (macros.has(m[1]!)) throw new Error('Duplicate paste aperture macro');
    macros.set(m[1]!, m[2]!.split('*').map(s => s.replace(/\s/g, '')).filter(s => s && !s.startsWith('0')).join('*'));
  }
  for (const m of text.matchAll(/%ADD(\d+)([A-Z_0-9]+),([^*]+)\*%/g)) {
    if (apertures.has(m[1]!)) throw new Error('Duplicate paste aperture');
    const args = m[3]!.split('X').map(Number); if (args.some(n => !Number.isFinite(n))) throw new Error('Invalid paste aperture dimensions');
    apertures.set(m[1]!, { type: m[2]!, args });
  }
  // Bounded pinned-converter flash audit: transforms/regions are never silently ignored.
  const commands = text.replace(/%([\s\S]*?)%/g, (_all, command) => {
    if (!/^(TF\.|TA\.|TD|AM|ADD|FSLAX|MOMM\*|LPD\*)/.test(command)) throw new Error(`Unsupported paste extended command ${command.slice(0, 30)}`);
    return '';
  }).split('*').map(c => c.trim()).filter(Boolean);
  let code = '', x: number | undefined, y: number | undefined, region: Point[] | undefined; const flashes: Flash[] = [];
  for (const command of commands) {
    if (command.startsWith('G04') || ['G01', 'G75', 'M02'].includes(command)) continue;
    if (command === 'G36') { if (region) throw new Error('Nested paste region'); region = []; continue; }
    if (command === 'G37') {
      if (!region) throw new Error('Unopened paste region');
      const shape = [ring(region)], box = bounds(shape);
      flashes.push({ x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, aperture: 'REGION', shape }); region = undefined; continue;
    }
    const selection = command.match(/^(?:G54)?D(\d+)$/); if (selection) { code = selection[1]!; continue; }
    const operation = command.match(/^(?:G01)?(?:X(-?\d+))?(?:Y(-?\d+))?D0([123])$/);
    if (!operation) throw new Error(`Unsupported paste operation ${command.slice(0, 40)}`);
    if (operation[1] !== undefined) x = Number(operation[1]) / scale; if (operation[2] !== undefined) y = Number(operation[2]) / scale;
    if (region) {
      finite(x, 'paste region x'); finite(y, 'paste region y');
      if (operation[3] === '3' || operation[3] === '2' && region.length) throw new Error('Unsupported paste region flash/multiple contours');
      region.push([x!, y!]); continue;
    }
    if (operation[3] === '2') continue;
    if (operation[3] !== '3') throw new Error('Unsupported paste draw/region; flash-only audit required');
    finite(x, 'paste x'); finite(y, 'paste y');
    const aperture = apertures.get(code); if (!aperture) throw new Error('Missing paste flash aperture');
    const [w, h] = aperture.args; let shape: Poly; let dimensions: { width?: number; height?: number } = {};
    switch (aperture.type) {
      case 'R': if (aperture.args.length !== 2) throw new Error('Unsupported holed paste rectangle'); shape = rect(x!, y!, w!, h!); dimensions = { width: w, height: h }; break;
      case 'C': if (aperture.args.length !== 1) throw new Error('Unsupported holed paste circle'); shape = circle(x!, y!, positive(w, 'paste diameter') / 2); break;
      case 'O': if (aperture.args.length !== 2) throw new Error('Unsupported holed paste obround'); shape = pill(x!, y!, w!, h!); break;
      case 'VERTPILL': case 'HORZPILL': {
        const expected = aperture.type === 'VERTPILL' ? '21,1,$1,$2-$3,0.0,0.0,0.0*1,1,$3,0.0,0.0-$4*1,1,$3,0.0,$4' : '21,1,$1-$3,$2,0.0,0.0,0.0*1,1,$3,0.0-$4,0.0*1,1,$3,$4,0.0';
        if (macros.get(aperture.type) !== expected || aperture.args.length !== 4 || Math.abs(aperture.args[2]! - Math.min(w!, h!)) > EPS || Math.abs(aperture.args[3]! - Math.abs(w! - h!) / 2) > EPS || (aperture.type === 'VERTPILL' ? h! < w! : w! < h!)) throw new Error('Unsupported/modified paste pill macro');
        shape = pill(x!, y!, w!, h!); break;
      }
      default: throw new Error(`Unsupported flashed paste aperture ${aperture.type}`);
    }
    flashes.push({ x: x!, y: y!, aperture: code, ...dimensions, shape });
  }
  if (region) throw new Error('Unclosed paste region');
  return flashes;
}

export async function checkSensorCopper(directory: string) {
  const dir = resolve(directory), cj: any[] = JSON.parse(await readFile(resolve(dir, 'circuit.json'), 'utf8')), map = JSON.parse(await readFile(resolve(dir, 'import-map.json'), 'utf8'));
  if (!Array.isArray(cj) || !Array.isArray(map.parts)) throw new Error('Malformed sensor audit inputs');
  const parts = map.parts.filter((p: any) => p.lcsc === 'C2909890');
  const actualSources = cj.filter(x => x.type === 'source_component' && (x.supplier_part_numbers?.jlcpcb?.includes('C2909890') || x.manufacturer_part_number === 'SHT40-AD1B-R2'));
  if (actualSources.some(s => !parts.some((p: any) => p.ref === s.name))) throw new Error('Physical SHT40 missing from import map');
  if (!parts.length) return { ok: true, checked: false, violations: [] };
  if (new Set(parts.map((p: any) => p.ref)).size !== parts.length) throw new Error('Duplicate sensor import identity');
  const boards = cj.filter(x => x.type === 'pcb_board');
  if (boards.length !== 1 || ![2, 4].includes(boards[0].num_layers)) throw new Error('Unsupported/missing native board copper layer count');
  const allLayers = boards[0].num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'];
  const layers = (values: any, span = false): string[] => {
    if (!Array.isArray(values) || !values.length || values.some(v => !allLayers.includes(v) && v !== 'all')) throw new Error('Unsupported/missing copper layers');
    if (values.includes('all')) return allLayers;
    const indexes = values.map(v => allLayers.indexOf(v)); return span ? allLayers.slice(Math.min(...indexes), Math.max(...indexes) + 1) : values;
  };
  const platedLayers = (e: any): string[] => {
    const endpoints = e.from_layer !== undefined || e.to_layer !== undefined ? layers([e.from_layer, e.to_layer], true) : undefined;
    const declared = e.layers === undefined ? endpoints ?? allLayers : layers(e.layers, true);
    if (endpoints && (declared.length !== endpoints.length || declared.some(l => !endpoints.includes(l)))) throw new Error('Contradictory native via layer span');
    return declared;
  };
  const records: Array<{ layer: string; shape: Poly; type: string; id: string; owner?: string }> = [];
  const drills: Array<{ layers: string[]; shape: Poly }> = [];
  const add = (e: any, shape: Poly, ls: string[]) => { for (const layer of ls) records.push({ layer, shape, type: e.type, id: e[`${e.type}_id`] ?? e.id ?? 'unidentified', owner: e.pcb_component_id }); };
  for (const e of cj) {
    if (typeof e.type === 'string' && e.type.startsWith('pcb_copper_') && e.type !== 'pcb_copper_pour') throw new Error(`Unsupported native copper primitive ${e.type}`);
    if (e.type === 'pcb_smtpad') add(e, smtShape(e), layers([e.layer]));
    if (e.type === 'pcb_copper_pour') {
      if (e.shape !== 'brep' || !Array.isArray(e.brep_shape?.inner_rings)) throw new Error('Unsupported native pour audit');
      add(e, [ring(e.brep_shape.outer_ring.vertices), ...e.brep_shape.inner_rings.map((r: any) => ring(r.vertices))], layers([e.layer]));
    }
    if (e.type === 'pcb_via' || e.type === 'pcb_plated_hole') { const s = platedShape(e), ls = platedLayers(e); add(e, s.copper, ls); drills.push({ layers: ls, shape: s.drill }); }
    if (e.type === 'pcb_hole') {
      let shape: Poly;
      if (e.hole_shape === 'circle') shape = circle(e.x, e.y, positive(e.hole_diameter, 'nonplated hole diameter') / 2, false);
      else if (['pill', 'oval', 'rotated_pill'].includes(e.hole_shape)) shape = pill(e.x, e.y, e.hole_width, e.hole_height, e.ccw_rotation ?? 0, false);
      else if (e.hole_shape === 'rect') shape = rect(e.x, e.y, e.hole_width, e.hole_height, e.ccw_rotation ?? 0);
      else throw new Error(`Unsupported native drill geometry ${e.hole_shape}`);
      drills.push({ layers: allLayers, shape });
    }
  }
  for (const trace of cj.filter(e => e.type === 'pcb_trace')) {
    if (!Array.isArray(trace.route) || trace.route.length < 2) throw new Error('Unsupported native trace route');
    for (const v of trace.route.filter((p: any) => p.route_type === 'via')) {
      const matching = cj.filter(e => e.type === 'pcb_via' && Math.hypot(e.x - v.x, e.y - v.y) < EPS);
      if (matching.some(e => Math.abs(e.outer_diameter - v.via_diameter) > EPS || Math.abs(e.hole_diameter - v.via_hole_diameter) > EPS)) throw new Error('Contradictory route/native via annulus dimensions');
      const s = platedShape({ ...v, type: 'pcb_via', outer_diameter: v.via_diameter, hole_diameter: v.via_hole_diameter });
      const ls = layers([v.from_layer, v.to_layer], true);
      if (matching.some(e => { const m = platedLayers(e); return m.length !== ls.length || m.some(l => !ls.includes(l)); })) throw new Error('Contradictory route/native via layer span');
      add(trace, s.copper, ls); drills.push({ layers: ls, shape: s.drill });
    }
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1], b = trace.route[i];
      if (![a, b].every(p => ['wire', 'via'].includes(p.route_type))) throw new Error('Unsupported native trace segment');
      const wire = a.route_type === 'wire' ? a : b.route_type === 'wire' ? b : undefined;
      if (!wire) { if (Math.hypot(a.x - b.x, a.y - b.y) > EPS) throw new Error('Unsupported via-to-via trace segment'); continue; }
      if (a.route_type === 'wire' && b.route_type === 'wire' && a.layer !== b.layer) throw new Error('Unmodeled trace layer transition');
      const width = Math.max(a.route_type === 'wire' ? positive(a.width, 'trace width') : 0, b.route_type === 'wire' ? positive(b.width, 'trace width') : 0);
      add(trace, capsule(a.x, a.y, b.x, b.y, width / 2), layers([wire.layer]));
    }
  }
  const zip = unzipSync(new Uint8Array(await readFile(resolve(dir, 'gerbers.zip'))));
  const pasteCache = new Map<string, Flash[]>(), violations: any[] = [], sensors: any[] = [];
  for (const p of parts) {
    const sources = cj.filter(x => x.type === 'source_component' && x.name === p.ref);
    if (sources.length !== 1) throw new Error(`Missing/ambiguous physical sensor source ${p.ref}`);
    const components = cj.filter(x => x.type === 'pcb_component' && x.source_component_id === sources[0].source_component_id);
    if (components.length !== 1) throw new Error(`Missing/ambiguous physical sensor component ${p.ref}`);
    const pcb = components[0], x = finite(pcb.center?.x, 'sensor centre x'), y = finite(pcb.center?.y, 'sensor centre y'), rotation = finite(pcb.rotation, 'sensor rotation');
    if (Math.abs(rotation / 90 - Math.round(rotation / 90)) > EPS) throw new Error('Unsupported non-cardinal sensor body orientation');
    if (!['top', 'bottom'].includes(pcb.layer)) throw new Error('Unsupported sensor component layer');
    const pads = cj.filter(x => x.type === 'pcb_smtpad' && x.pcb_component_id === pcb.pcb_component_id);
    const pinNumbers = pads.map(p => Array.isArray(p.port_hints) ? p.port_hints.filter((h: any) => /^pin[1-4]$/.test(h)) : []);
    if (pads.length !== 4 || pinNumbers.some(n => n.length !== 1) || new Set(pinNumbers.flat()).size !== 4 || pads.some(p => p.port_hints.some((h: any) => /^(pin5|EP|PAD)$/i.test(h)) || p.layer !== pcb.layer || !['rect', 'rotated_rect'].includes(p.shape) || p.width > .6 || p.height > .6 || Math.hypot(p.x - x, p.y - y) > 1.1)) throw new Error('Functional sensor pads/omitted EP mismatch');
    // Bind allowed contact copper to the retained importer revision, not movable self-declared pads.
    // This is a process-specific geometry guard; it is not manufacturer land-pattern/assembly approval.
    const offsets = [[-.677418, .40005], [-.677418, -.40005], [.677418, -.40005], [.677418, .40005]];
    const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const local = (px: number, py: number): Point => [(px - x) * c + (py - y) * s, -(px - x) * s + (py - y) * c];
    for (const [i, pad] of pads.entries()) {
      const expected = offsets[Number(pinNumbers[i]![0]!.slice(3)) - 1]!, centre = local(pad.x, pad.y);
      const outline = smtShape(pad)[0]!.map(([px, py]) => local(px, py));
      const w = Math.max(...outline.map(p => p[0])) - Math.min(...outline.map(p => p[0])), h = Math.max(...outline.map(p => p[1])) - Math.min(...outline.map(p => p[1]));
      if (Math.hypot(centre[0] - expected[0]!, centre[1] - expected[1]!) > 1e-4 || Math.abs(w - .5050028) > 1e-4 || Math.abs(h - .419989) > 1e-4 || (pad.corner_radius ?? 0) !== 0 || (pad.rect_border_radius ?? 0) !== 0) throw new Error('Sensor contact-pad geometry differs from the pinned importer; explicit footprint review required');
    }
    const body = rect(x, y, BODY_MM, BODY_MM);
    const keepouts = cj.filter(k => k.type === 'pcb_keepout' && k.excluded_pcb_component_ids?.includes(pcb.pcb_component_id));
    const ko = keepouts.find(k => k.shape === 'rect' && k.excluded_pcb_component_ids.length === 1 && Math.abs(finite(k.center?.x, 'keepout centre x') - x) <= EPS && Math.abs(finite(k.center?.y, 'keepout centre y') - y) <= EPS && positive(k.width, 'keepout width') >= BODY_MM - EPS && positive(k.height, 'keepout height') >= BODY_MM - EPS && allLayers.every(l => layers(k.layers).includes(l)));
    if (!ko) throw new Error(`Sensor ${p.ref} keepout must be centred on and cover actual1.6mm body on every copper layer`);
    const allowed = pads.map(smtShape), forbidden = new Map(allLayers.map(layer => [layer, layer === pcb.layer ? difference(body, ...allowed) : [body] as Multi]));
    for (const record of records) {
      if (record.type === 'pcb_smtpad' && record.owner === pcb.pcb_component_id || !touching(body, record.shape)) continue;
      const holes = drills.filter(d => d.layers.includes(record.layer) && touching(body, d.shape)).map(d => d.shape);
      const copper = holes.length ? difference(record.shape, ...holes) : [record.shape];
      const overlap = area(intersection(forbidden.get(record.layer)!, copper));
      if (overlap > AREA_EPS) violations.push({ ref: p.ref, layer: record.layer, type: record.type, id: record.id, overlapMm2: overlap });
    }
    const pasteName = pcb.layer === 'top' ? 'F_Paste.gbr' : 'B_Paste.gbr';
    if (!zip[pasteName]) throw new Error(`Missing actual ${pasteName}`);
    if (!pasteCache.has(pasteName)) pasteCache.set(pasteName, pasteFlashes(strFromU8(zip[pasteName]!)));
    const near = pasteCache.get(pasteName)!.filter(f => touching(body, f.shape) && area(intersection(body, f.shape)) > AREA_EPS);
    // Pinned converter0.0.121 emits70% rectangular paste; another process needs explicit review.
    const pasteOk = near.length === 4 && pads.every(pad => {
      const box = bounds(smtShape(pad)), w = (box[2] - box[0]) * .7, h = (box[3] - box[1]) * .7;
      return near.filter(f => Math.hypot(f.x - pad.x, f.y - pad.y) < 1e-5 && f.width !== undefined && f.height !== undefined && Math.abs(f.width - w) < 1e-5 && Math.abs(f.height - h) < 1e-5).length === 1;
    });
    if (!pasteOk) violations.push({ ref: p.ref, layer: pcb.layer, type: 'paste', id: pasteName, message: 'Actual paste must have exactly4 matching70% rectangular functional-pad flashes and no other aperture intrusion' });
    sensors.push({ ref: p.ref, body: { center: { x, y }, width: BODY_MM, height: BODY_MM }, pads: pads.map(p => ({ hints: p.port_hints, x: p.x, y: p.y, width: p.width, height: p.height })), keepout: ko, paste: { near: near.map(({ shape, ...f }) => f), pasteOk, centralFlash: near.some(f => Math.hypot(f.x - x, f.y - y) < .1) } });
  }
  const result = { checked: true, ok: !violations.length, method: 'Polygon intersection against each actual1.6mm sensor body on every board copper layer; functional-pad exceptions only on its mounted layer. Copper subtracts drill voids; conservative circumscribed48-gon outer/inscribed drill geometry. Actual pinned-converter70% rectangular paste apertures/flashes.', ...sensors[0], sensors, violations };
  await writeFile(resolve(dir, 'sensor-copper-check.json'), JSON.stringify(result, null, 2)); return result;
}
if (import.meta.main) { const result = await checkSensorCopper(process.argv[2]!); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 2; }
