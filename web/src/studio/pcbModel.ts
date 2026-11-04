// The PCB as the canvas needs it, read from circuit.json alone. Everything is in board millimetres with y up, as the file has it.
// Nets come from the file's own connectivity keys, so a highlighted net is exactly what tscircuit connected.
import { num, obj, objects, str, type Json } from './facts';

export interface Pin { number: number | null; label: string; net: string | null; x: number; y: number }
export interface Pad { x: number; y: number; w: number; h: number; round: boolean; rotation: number; holeW: number; holeH: number; layers: readonly string[]; net: string | null; pin: string | null }
export type Silk =
  | { kind: 'text'; x: number; y: number; size: number; text: string; rotation: number; anchor: string; layer: string }
  | { kind: 'path'; points: readonly (readonly [number, number])[]; width: number; layer: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; width: number; rotation: number; filled: boolean; layer: string }
  | { kind: 'circle'; x: number; y: number; r: number; width: number; layer: string };
export interface Envelope { x: number; y: number; w: number; h: number }
export interface Part { ref: string; name: string | null; x: number; y: number; rotation: number; layer: string; envelope: Envelope; pads: Pad[]; silk: Silk[]; pins: Pin[] }
export interface TraceRun { layer: string; width: number; points: readonly (readonly [number, number])[] }
export interface Trace { net: string | null; runs: TraceRun[] }
export interface Via { x: number; y: number; outer: number; hole: number; net: string | null }
export interface Hole { x: number; y: number; d: number }
export interface Pour { layer: string; net: string | null; path: string }
export interface Net { id: string; name: string; power: boolean; ground: boolean; pins: readonly { ref: string; label: string }[] }
export interface SchematicBox { ref: string; x: number; y: number; w: number; h: number }
export interface BoardModel {
  board: { x: number; y: number; w: number; h: number; layers: number; outline: readonly (readonly [number, number])[] };
  parts: Part[]; traces: Trace[]; vias: Via[]; holes: Hole[]; pours: Pour[]; silk: Silk[]; nets: Map<string, Net>; schematic: SchematicBox[];
}

const point = (v: unknown): [number, number] | null => { const p = obj(v); const [x, y] = [num(p.x), num(p.y)]; return x !== null && y !== null ? [x, y] : null; };
const byId = (items: Json[], key: string) => new Map(items.map(i => [String(i[key]), i]));

function ring(vertices: unknown): string {
  const pts = objects(vertices).map(point).filter((p): p is [number, number] => Boolean(p));
  return pts.length ? `M${pts.map(([x, y]) => `${x} ${-y}`).join('L')}Z` : '';
}

function silkOf(e: Json): Silk | null {
  const layer = str(e.layer) ?? 'top';
  if (e.type === 'pcb_silkscreen_text') {
    const at = point(e.anchor_position);
    return at && str(e.text) ? { kind: 'text', x: at[0], y: at[1], size: num(e.font_size) ?? 1, text: str(e.text)!, rotation: num(e.ccw_rotation) ?? 0, anchor: str(e.anchor_alignment) ?? 'center', layer } : null;
  }
  if (e.type === 'pcb_silkscreen_path') {
    const points = objects(e.route).map(point).filter((p): p is [number, number] => Boolean(p));
    return points.length > 1 ? { kind: 'path', points, width: num(e.stroke_width) ?? 0.15, layer } : null;
  }
  if (e.type === 'pcb_silkscreen_rect') {
    const at = point(e.center);
    return at ? { kind: 'rect', x: at[0], y: at[1], w: num(e.width) ?? 0, h: num(e.height) ?? 0, width: num(e.stroke_width) ?? 0.15, rotation: num(e.ccw_rotation) ?? 0, filled: e.is_filled === true, layer } : null;
  }
  if (e.type === 'pcb_silkscreen_circle') {
    const at = point(e.center);
    return at ? { kind: 'circle', x: at[0], y: at[1], r: num(e.radius) ?? 0, width: num(e.stroke_width) ?? 0.15, layer } : null;
  }
  return null;
}

export function readBoard(circuit: unknown): BoardModel | null {
  if (!Array.isArray(circuit)) return null;
  const all = objects(circuit);
  const ofType = (t: string) => all.filter(e => e.type === t);
  const boardRow = ofType('pcb_board')[0];
  if (!boardRow) return null;
  const center = point(boardRow.center) ?? [0, 0];
  const sources = byId(ofType('source_component'), 'source_component_id');
  const components = ofType('pcb_component');
  const refOf = (componentId: unknown) => {
    const row = components.find(c => c.pcb_component_id === componentId);
    return row ? str(sources.get(String(row.source_component_id))?.name) : null;
  };
  const sourcePorts = byId(ofType('source_port'), 'source_port_id');
  const pcbPorts = byId(ofType('pcb_port'), 'pcb_port_id');
  const netKey = (row?: Json) => str(row?.subcircuit_connectivity_map_key);
  const keyOfPcbPort = (id: unknown) => netKey(sourcePorts.get(String(pcbPorts.get(String(id))?.source_port_id)));
  const sourceNets = ofType('source_net');
  const sourceTraces = ofType('source_trace');
  const keyOfConnection = (name: unknown) => netKey(sourceNets.find(n => n.source_net_id === name)) ?? netKey(sourceTraces.find(t => t.source_trace_id === name));

  // Every net that has a pin, named by the file where it can be.
  const pinsByKey = new Map<string, { ref: string; label: string }[]>();
  for (const port of sourcePorts.values()) {
    const key = netKey(port);
    const ref = str(sources.get(String(port.source_component_id))?.name);
    if (!key || !ref) continue;
    pinsByKey.set(key, [...(pinsByKey.get(key) ?? []), { ref, label: str(port.name) ?? String(port.pin_number ?? '') }]);
  }
  const nets = new Map<string, Net>();
  for (const [id, pins] of pinsByKey) {
    const row = sourceNets.find(n => netKey(n) === id);
    nets.set(id, { id, name: str(row?.name) ?? `${pins[0]!.ref}.${pins[0]!.label}`, power: row?.is_power === true, ground: row?.is_ground === true, pins });
  }

  const padsByPart = new Map<string, Pad[]>();
  const addPad = (componentId: unknown, pad: Pad) => { const key = String(componentId); padsByPart.set(key, [...(padsByPart.get(key) ?? []), pad]); };
  const pinName = (portId: unknown) => str(sourcePorts.get(String(pcbPorts.get(String(portId))?.source_port_id))?.name);
  for (const e of ofType('pcb_plated_hole')) {
    const [x, y] = [num(e.x), num(e.y)];
    if (x === null || y === null) continue;
    const d = num(e.outer_diameter);
    const [w, h] = [d ?? num(e.outer_width) ?? num(e.rect_pad_width) ?? 1, d ?? num(e.outer_height) ?? num(e.rect_pad_height) ?? 1];
    const holeD = num(e.hole_diameter);
    addPad(e.pcb_component_id, { x, y, w, h, round: e.shape !== 'circular_hole_with_rect_pad' && e.shape !== 'rect', rotation: num(e.ccw_rotation) ?? 0, holeW: holeD ?? num(e.hole_width) ?? 0, holeH: holeD ?? num(e.hole_height) ?? 0, layers: ['top', 'bottom'], net: keyOfPcbPort(e.pcb_port_id), pin: pinName(e.pcb_port_id) });
  }
  for (const e of ofType('pcb_smtpad')) {
    const [x, y] = [num(e.x), num(e.y)];
    if (x === null || y === null) continue;
    const r = num(e.radius);
    addPad(e.pcb_component_id, { x, y, w: r !== null ? r * 2 : num(e.width) ?? 1, h: r !== null ? r * 2 : num(e.height) ?? 1, round: e.shape === 'circle' || e.shape === 'pill', rotation: num(e.ccw_rotation) ?? 0, holeW: 0, holeH: 0, layers: [str(e.layer) ?? 'top'], net: keyOfPcbPort(e.pcb_port_id), pin: pinName(e.pcb_port_id) });
  }
  const silkRows = [...ofType('pcb_silkscreen_text'), ...ofType('pcb_silkscreen_path'), ...ofType('pcb_silkscreen_rect'), ...ofType('pcb_silkscreen_circle')];
  const parts: Part[] = components.flatMap(c => {
    const ref = refOf(c.pcb_component_id);
    const at = point(c.center);
    if (!ref || !at) return [];
    const source = sources.get(String(c.source_component_id));
    const silk = silkRows.filter(s => s.pcb_component_id === c.pcb_component_id);
    // The silk outline is the module's footprint on the board, where the pads alone are only its pin row.
    const outline = silk.find(s => s.type === 'pcb_silkscreen_rect');
    const outlineAt = outline && point(outline.center);
    const envelope = outlineAt ? { x: outlineAt[0], y: outlineAt[1], w: num(outline!.width) ?? 0, h: num(outline!.height) ?? 0 } : { x: at[0], y: at[1], w: num(c.width) ?? 1, h: num(c.height) ?? 1 };
    const pins: Pin[] = [...pcbPorts.values()].filter(p => p.pcb_component_id === c.pcb_component_id).map(p => {
      const port = sourcePorts.get(String(p.source_port_id));
      return { number: num(port?.pin_number), label: str(port?.name) ?? '', net: netKey(port), x: num(p.x) ?? 0, y: num(p.y) ?? 0 };
    }).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    return [{ ref, name: str(source?.manufacturer_part_number) ?? str(source?.display_value), x: at[0], y: at[1], rotation: num(c.rotation) ?? 0, layer: str(c.layer) ?? 'top', envelope, pads: padsByPart.get(String(c.pcb_component_id)) ?? [], silk: silk.map(silkOf).filter((s): s is Silk => Boolean(s)), pins }];
  });

  const traces: Trace[] = ofType('pcb_trace').map(t => {
    const route = objects(t.route);
    const ports = [...(Array.isArray(t.connectsTo) ? t.connectsTo : []), ...route.flatMap(r => [r.start_pcb_port_id, r.end_pcb_port_id])].filter(Boolean);
    const net = ports.map(keyOfPcbPort).find(Boolean) ?? keyOfConnection(t.connection_name) ?? keyOfConnection(t.source_trace_id);
    const runs: TraceRun[] = [];
    let run: { layer: string; width: number; points: [number, number][] } | undefined;
    for (const r of route) {
      if (r.route_type !== 'wire') { run = undefined; continue; }
      const at = point(r);
      const layer = str(r.layer);
      if (!at || !layer) continue;
      if (run?.layer !== layer) {
        const from: [number, number] | undefined = run?.points.at(-1);
        const next: { layer: string; width: number; points: [number, number][] } = { layer, width: num(r.width) ?? 0.15, points: from ? [from] : [] };
        runs.push(next);
        run = next;
      }
      run.points.push(at);
    }
    return { net: net ?? null, runs: runs.filter(r => r.points.length > 1) };
  });
  const traceKeys = new Map(ofType('pcb_trace').map((t, i) => [t.pcb_trace_id, traces[i]!.net]));
  const vias: Via[] = ofType('pcb_via').flatMap(v => {
    const at = point(v);
    return at ? [{ x: at[0], y: at[1], outer: num(v.outer_diameter) ?? 0.6, hole: num(v.hole_diameter) ?? 0.3, net: netKey(v) ?? traceKeys.get(v.pcb_trace_id) ?? null }] : [];
  });
  const holes: Hole[] = ofType('pcb_hole').flatMap(h => {
    const at = point(h);
    return at ? [{ x: at[0], y: at[1], d: num(h.hole_diameter) ?? num(h.hole_width) ?? 1 }] : [];
  });
  const pours: Pour[] = ofType('pcb_copper_pour').flatMap(p => {
    const brep = obj(p.brep_shape);
    const outer = ring(obj(brep.outer_ring).vertices);
    if (!outer) return [];
    const inner = objects(brep.inner_rings).map(r => ring(r.vertices)).join('');
    return [{ layer: str(p.layer) ?? 'top', net: keyOfConnection(p.source_net_id), path: outer + inner }];
  });
  const schematic: SchematicBox[] = ofType('schematic_component').flatMap(c => {
    const at = point(c.center);
    const ref = str(sources.get(String(c.source_component_id))?.name);
    if (!at || !ref) return [];
    const size = obj(c.size);
    const [hw, hh] = [(num(size.width) ?? 0) / 2, (num(size.height) ?? 0) / 2];
    const ports = ofType('schematic_port').filter(p => p.schematic_component_id === c.schematic_component_id).map(p => point(p.center)).filter((p): p is [number, number] => Boolean(p));
    const xs = [at[0] - hw, at[0] + hw, ...ports.map(p => p[0])];
    const ys = [at[1] - hh, at[1] + hh, ...ports.map(p => p[1])];
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return [{ ref, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }];
  });
  const w = num(boardRow.width) ?? 0;
  const h = num(boardRow.height) ?? 0;
  const outline = objects(boardRow.outline).map(point).filter((p): p is [number, number] => Boolean(p));
  return {
    board: { x: center[0], y: center[1], w, h, layers: num(boardRow.num_layers) ?? 2, outline },
    // Biggest first, so a small part lying on a big one is the one a click finds.
    parts: parts.sort((a, b) => b.envelope.w * b.envelope.h - a.envelope.w * a.envelope.h),
    traces, vias, holes, pours,
    silk: silkRows.filter(s => !s.pcb_component_id).map(silkOf).filter((s): s is Silk => Boolean(s)),
    nets, schematic,
  };
}

export const findPart = (model: BoardModel | null, ref: string | null) => (ref ? model?.parts.find(p => p.ref === ref) ?? null : null);

/** The pins that are wired, and how many there are in all. A 38-pin module shouldn't open as 38 rows. */
export function connectedPins(part: Part): Pin[] { return part.pins.filter(p => p.net !== null); }

/** A spanning tree per net, shortest wires first: which pads belong together, whatever the copper does. `at` moves a pad that's being dragged. */
export function airwires(model: BoardModel, at: (ref: string, x: number, y: number) => readonly [number, number] = (_, x, y) => [x, y]): { net: string; from: readonly [number, number]; to: readonly [number, number] }[] {
  const byNet = new Map<string, (readonly [number, number])[]>();
  for (const part of model.parts) {
    for (const pad of part.pads) if (pad.net) byNet.set(pad.net, [...(byNet.get(pad.net) ?? []), at(part.ref, pad.x, pad.y)]);
  }
  const wires: { net: string; from: readonly [number, number]; to: readonly [number, number] }[] = [];
  for (const [net, points] of byNet) {
    const linked = [points[0]!];
    const rest = points.slice(1);
    while (rest.length) {
      let best = { d: Infinity, i: 0, from: linked[0]! };
      rest.forEach((p, i) => {
        for (const q of linked) {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
          if (d < best.d) best = { d, i, from: q };
        }
      });
      const [next] = rest.splice(best.i, 1);
      wires.push({ net, from: best.from, to: next! });
      linked.push(next!);
    }
  }
  return wires;
}

/** Where a real point lands in the schematic drawing, from the matrix tscircuit writes on the file. */
export function schematicMatrix(svg: string): ((x: number, y: number) => [number, number]) | null {
  const m = /data-real-to-screen-transform="matrix\(([^)]+)\)"/.exec(svg);
  const v = m?.[1]!.split(',').map(Number);
  if (!v || v.length !== 6 || v.some(n => !Number.isFinite(n))) return null;
  const [a, b, c, d, e, f] = v as [number, number, number, number, number, number];
  return (x, y) => [a * x + c * y + e, b * x + d * y + f];
}
