/** Finite source-width-preserving USB sink exits for the known RP core.
 * Native saved fanout/global routing performs all pathfinding. No DRC waiver,
 * electrical change, via insertion or generic footprint fallback is provided.
 */
import { checkEachPcbTraceNonOverlapping, checkPadTraceClearance, checkViaTraceClearance, checkHoleTraceClearance, checkPcbTracesOutOfBoard, checkCopperToCutoutClearance } from '@tscircuit/checks';
import { createNativeFanoutPhase, type NativeFanoutProposal } from './fanout.js';
import type { PlanGraph } from '../../src/blocks/graph.js';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import { nativePlacementIssues } from '../../src/blocks/native-placement.js';

type Point = { x: number; y: number };
export interface UsbSinkPrefix {
  selector?: string; from?: string; netName?: string; net?: string;
  route: readonly (Point & { route_type: string; layer?: string; width?: number; via_diameter?: number; via_hole_diameter?: number; from_layer?: string; to_layer?: string })[];
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const one = <T>(items: T[], label: string): T => { if (items.length !== 1) throw Error(`USB sink escape requires one ${label}`); return items[0]!; };
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
const rotate = (p: Point, q: number): Point => { switch (((q % 4) + 4) % 4) { case 1: return { x: -p.y, y: p.x }; case 2: return { x: -p.x, y: -p.y }; case 3: return { x: p.y, y: -p.x }; default: return { ...p }; } };

export function createUsbSinkEscapeProposals(circuit: any[], graph: PlanGraph, mapping: Record<string, Record<string, string>>, prefixes: readonly UsbSinkPrefix[] = []) {
  const proposals: NativeFanoutProposal[] = [];
  const audit: Array<{ ref: string; pad: string; netName: string; selector: string; route: NativeFanoutProposal['route']; diagnosticSourceTraceId: string; diagnosticSourcePortId: string; diagnosticPcbPortId: string; diagnosticSourceNetId: string; lengthMm: number; widthMm: number }> = [];
  if (!Array.isArray(circuit) || !Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || !mapping || !Array.isArray(prefixes)) throw Error('USB sink exits require actual circuit/graph/import evidence');
  const mcus = graph.parts.filter(p => p.part.lcsc === 'C2040');
  if (!mcus.length) return { proposals, audit, netNames: [] as string[] };
  const mcu = one(mcus, 'RP2040');
  if (mcu.part.mpn !== 'RP2040' || mcu.block.id !== 'rp2040-minimal' || ![3, 4].includes(mcu.block.version)) throw Error('Unsupported immutable RP USB sink profile');
  if (circuit.some(e => ['pcb_trace', 'pcb_via'].includes(e.type))) throw Error('USB sink exits must precede routed copper');
  const sourceIssues = nativeNetlistIssues(graph, circuit, mapping), placement = nativePlacementIssues(graph, circuit);
  if (sourceIssues.length || !placement.ok) throw Error('USB sink actual source/placement differs: ' + [...sourceIssues, ...placement.issues].map(e => e.message).join('; '));
  const board = one(circuit.filter(e => e.type === 'pcb_board'), 'native board');
  if (![2, 4].includes(board.num_layers) || ![board.width, board.height, board.center?.x, board.center?.y].every(finite) || board.width <= 0 || board.height <= 0) throw Error('Unsupported USB sink board geometry');
  const constraint = one(mcu.block.constraints.filter(c => c.kind === 'usb-c-sink'), 'same-instance USB sink constraint');
  if (constraint.kind !== 'usb-c-sink' || constraint.ohms !== 5100 || constraint.resistors.length !== 2 || new Set(constraint.resistors).size !== 2) throw Error('Unsupported CC termination profile');
  const tvs = one(graph.parts.filter(p => p.inst === mcu.inst && p.part.lcsc === 'C7519'), 'same-instance C7519');
  const connector = one(graph.parts.filter(p => p.inst === mcu.inst && p.localRef === constraint.connector), 'constraint USB connector');
  if (tvs.part.mpn !== 'USBLC6-2SC6') throw Error('C7519 manufacturer identity differs');
  const netBySource = new Map<string, string>();
  const resolvedByRef = new Map<string, ReturnType<typeof nativeComponentPorts>>();
  for (const part of graph.parts) {
    const source = one(circuit.filter(e => e.type === 'source_component' && e.name === part.ref), `native source ${part.ref}`);
    const names = [...Object.values(part.part.pins).map(p => mapping[part.ref]![p.pad]!), ...(part.part.omitPads ?? []).map(p => mapping[part.ref]![p]!)];
    const resolved = nativeComponentPorts(circuit, source, names, new Set((part.part.omitPads ?? []).map(p => mapping[part.ref]![p]!)));
    resolvedByRef.set(part.ref, resolved);
    for (const pin of Object.values(part.part.pins)) {
      const nets = graph.nets.filter(n => n.pins.some(p => p.ref === part.ref && p.pad === pin.pad));
      if (nets.length > 1) throw Error('Ambiguous USB sink physical net membership');
      if (nets.length) for (const p of resolved.byNative.get(mapping[part.ref]![pin.pad]!) ?? []) netBySource.set(p.source_port_id, nets[0]!.name);
    }
  }
  const endpoint = (ref: string, pad: string) => {
    const part = one(graph.parts.filter(p => p.ref === ref), `graph part ${ref}`);
    const source = one(circuit.filter(e => e.type === 'source_component' && e.name === ref && e.manufacturer_part_number === part.part.mpn && e.supplier_part_numbers?.jlcpcb?.includes(part.part.lcsc)), `actual source ${ref}`);
    const pin = one(resolvedByRef.get(ref)?.byNative.get(mapping[ref]?.[pad]!) ?? [], `physical source ${ref}.${pad}`);
    if (pin.pin_number !== Number(pad) || !pin.port_hints?.includes(`pin${pad}`)) throw Error('USB sink physical alias differs');
    const component = one(circuit.filter(e => e.type === 'pcb_component' && e.source_component_id === source.source_component_id), `PCB owner ${ref}`);
    const port = one(circuit.filter(e => e.type === 'pcb_port' && e.source_port_id === pin.source_port_id && e.pcb_component_id === component.pcb_component_id), `PCB port ${ref}.${pad}`);
    const land = one(circuit.filter(e => e.type === 'pcb_smtpad' && e.pcb_port_id === port.pcb_port_id && e.pcb_component_id === component.pcb_component_id), `physical land ${ref}.${pad}`);
    if (component.layer !== 'top' || !['rect', 'rotated_rect', 'pill', 'rotated_pill'].includes(land.shape) || land.layer !== 'top' || port.layers?.length !== 1 || port.layers[0] !== 'top' || !land.port_hints?.includes(`pin${pad}`) || ![land.x, land.y, port.x, port.y, land.width, land.height, component.footprint_origin?.x, component.footprint_origin?.y, component.rotation, land.ccw_rotation ?? 0].every(finite) || land.width <= 0 || land.height <= 0 || !near(land, port) || Math.abs(component.rotation / 90 - Math.round(component.rotation / 90)) > 1e-7 || Math.abs((land.ccw_rotation ?? 0) / 90 - Math.round((land.ccw_rotation ?? 0) / 90)) > 1e-7) throw Error('Unsupported actual USB sink pad geometry');
    const net = one(graph.nets.filter(n => n.pins.some(p => p.ref === ref && p.pad === pad)), `physical graph net ${ref}.${pad}`);
    const nativeNet = one(circuit.filter(e => e.type === 'source_net' && e.name === net.name), `native net ${net.name}`);
    const trace = one(circuit.filter(e => e.type === 'source_trace' && e.connected_source_port_ids?.includes(pin.source_port_id) && e.connected_source_net_ids?.includes(nativeNet.source_net_id)), `actual trace ${ref}.${pad}`);
    if (trace.connected_source_port_ids.length !== 1 || trace.connected_source_net_ids.length !== 1 || pin.subcircuit_id !== trace.subcircuit_id || port.subcircuit_id !== trace.subcircuit_id || nativeNet.subcircuit_id !== trace.subcircuit_id || !pin.subcircuit_connectivity_map_key || pin.subcircuit_connectivity_map_key !== trace.subcircuit_connectivity_map_key || nativeNet.subcircuit_connectivity_map_key !== trace.subcircuit_connectivity_map_key) throw Error('USB sink physical source/net/subcircuit differs');
    return { part, pin, component, port, land, net, nativeNet, trace };
  };
  const diagnostics: any[] = [];
  const propose = (e: ReturnType<typeof endpoint>, pad: string, normal: Point, expectedNormalSpan: number, expectedTangentSpan: number) => {
    if (!['rect', 'rotated_rect'].includes(e.land.shape)) throw Error('Unsupported finite USB sink land shape');
    const axisW = rotate({ x: 1, y: 0 }, Math.round((e.land.ccw_rotation ?? 0) / 90)), axisH = { x: -axisW.y, y: axisW.x };
    const projection = (n: Point) => Math.abs(n.x * axisW.x + n.y * axisW.y) * e.land.width + Math.abs(n.x * axisH.x + n.y * axisH.y) * e.land.height;
    const normalSpan = projection(normal), tangentSpan = projection({ x: -normal.y, y: normal.x });
    if (Math.abs(normalSpan - expectedNormalSpan) > 0.005 || Math.abs(tangentSpan - expectedTangentSpan) > 0.005) throw Error('USB sink physical land size/normal differs');
    const isPower = e.net.pins.some(p => ['power-in', 'power-out', 'ground'].includes(graph.parts.find(q => q.ref === p.ref)!.part.pins[p.logical]!.role));
    const width = e.trace.min_trace_thickness;
    if (width !== (isPower ? 0.3 : 0.15) || width < (board.min_trace_width ?? 0.15) || width > tangentSpan) throw Error('USB sink source width differs or violates native pad/rule');
    const length = normalSpan / 2 + 0.5, start = { route_type: 'wire' as const, x: e.port.x, y: e.port.y, layer: 'top' as const, width };
    const route = [start, { ...start, x: start.x + normal.x * length, y: start.y + normal.y * length }];
    const selector = `.${e.part.ref} > .pin${pad}`;
    proposals.push({ ref: e.part.ref, pad, route });
    audit.push({ ref: e.part.ref, pad, netName: e.net.name, selector, route, diagnosticSourceTraceId: e.trace.source_trace_id, diagnosticSourcePortId: e.pin.source_port_id, diagnosticPcbPortId: e.port.pcb_port_id, diagnosticSourceNetId: e.nativeNet.source_net_id, lengthMm: length, widthMm: width });
    diagnostics.push({ type: 'pcb_trace', pcb_trace_id: `usb_sink_stub_${audit.length}`, source_trace_id: e.trace.source_trace_id, source_net_id: e.nativeNet.source_net_id, subcircuit_id: e.trace.subcircuit_id, route: [{ ...start, start_pcb_port_id: e.port.pcb_port_id }, route[1]] });
  };
  for (let number = 1; number <= 6; number++) {
    const pad = String(number), e = endpoint(tvs.ref, pad), quarter = Math.round(e.component.rotation / 90), local = rotate({ x: e.port.x - e.component.footprint_origin.x, y: e.port.y - e.component.footprint_origin.y }, -quarter);
    const x = number <= 3 ? (number - 2) * 0.94996 : (5 - number) * 0.94996, side = number <= 3 ? -1 : 1;
    if (Math.abs(local.x - x) > 0.005 || Math.abs(local.y - side * 1.149096) > 0.005) throw Error('C7519 physical row/pin order differs');
    propose(e, pad, rotate({ x: 0, y: side }, quarter), 1.072007, 0.532003);
  }
  for (const [index, localRef] of constraint.resistors.entries()) {
    const resistor = one(graph.parts.filter(p => p.inst === mcu.inst && p.localRef === localRef), `CC resistor ${localRef}`);
    if (resistor.part.lcsc !== 'C23186' || resistor.part.mpn !== '0603WAF5101T5E') throw Error('Unsupported actual CC resistor profile');
    const e = endpoint(resistor.ref, '1'), opposite = endpoint(resistor.ref, '2'), center = e.component.footprint_origin;
    const dx = e.port.x - center.x, dy = e.port.y - center.y, distance = Math.hypot(dx, dy);
    const normal = { x: Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0, y: Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0 };
    const cc = index === 0 ? constraint.cc1 : constraint.cc2, contact = connector.part.pins[cc];
    if (Math.abs(distance - 0.753364) > 0.005 || (Math.abs(dx) > 1e-5 && Math.abs(dy) > 1e-5) || !near(opposite.port, { x: center.x - dx, y: center.y - dy }) || !contact || !e.net.pins.some(p => p.ref === connector.ref && p.logical === cc && p.pad === contact.pad) || !opposite.net.pins.some(p => graph.parts.find(q => q.ref === p.ref)!.part.pins[p.logical]!.role === 'ground')) throw Error('Actual CC resistor/connector/ground correspondence differs');
    propose(e, '1', normal, 0.8064754, 0.8640064);
  }
  // Core's public binder also enforces exact port selectors, native membership,
  // constant source widths and complete supplied connection coverage.
  createNativeFanoutPhase(circuit, proposals);
  const prefixGeometry: any[] = [];
  for (const path of prefixes) {
    const selector = path.selector ?? path.from, name = path.netName ?? path.net, match = selector?.match(/^\.([A-Za-z][A-Za-z0-9_]*)\s*>\s*\.pin([1-9]\d*)$/);
    if (!match || !name || !path.route.length || path.route[0]!.route_type !== 'wire' || path.route.some((p: UsbSinkPrefix['route'][number]) => !finite(p.x) || !finite(p.y) || !['wire', 'via'].includes(p.route_type) || (p.route_type === 'wire' && (!finite(p.width) || p.width < (board.min_trace_width ?? 0.15) || !['top', 'bottom', ...(board.num_layers === 4 ? ['inner1', 'inner2'] : [])].includes(p.layer ?? ''))))) throw Error('USB sink prefix lacks valid geometry and a verified physical selector/net');
    const e = endpoint(match[1]!, match[2]!);
    if (e.net.name !== name || !near(path.route[0]!, e.port)) throw Error('USB sink prefix differs from actual source/physical endpoint');
    const id = `usb_sink_prefix_${prefixGeometry.length}`;
    prefixGeometry.push({ type: 'pcb_trace', pcb_trace_id: id, source_trace_id: e.trace.source_trace_id, source_net_id: e.nativeNet.source_net_id, subcircuit_id: e.trace.subcircuit_id, route: structuredClone(path.route) });
    for (const point of path.route) if (point.route_type === 'via') {
      if (point.via_diameter !== 0.6 || point.via_hole_diameter !== 0.3 || point.from_layer !== 'top' || point.to_layer !== 'bottom') throw Error('Unsupported USB sink prefix via');
      prefixGeometry.push({ type: 'pcb_via', pcb_via_id: id + '_via', pcb_trace_id: id, x: point.x, y: point.y, outer_diameter: point.via_diameter, hole_diameter: point.via_hole_diameter, layers: board.num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'], from_layer: 'top', to_layer: 'bottom' });
    }
  }
  const outline: Point[] = Array.isArray(board.outline) && board.outline.length >= 3 ? board.outline : [{ x: board.center.x - board.width / 2, y: board.center.y - board.height / 2 }, { x: board.center.x + board.width / 2, y: board.center.y - board.height / 2 }, { x: board.center.x + board.width / 2, y: board.center.y + board.height / 2 }, { x: board.center.x - board.width / 2, y: board.center.y + board.height / 2 }];
  if (outline.some(p => !finite(p.x) || !finite(p.y))) throw Error('Invalid USB sink board outline');
  const inside = (p: Point) => { let hit = false; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i]!, b = outline[j]!; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit; } return hit; };
  if (proposals.some(p => p.route.some(p => !inside(p)))) throw Error('USB sink exits lie outside actual board outline');
  const clearance = Math.max(0.127, board.min_trace_to_pad_edge_clearance ?? 0.127);
  for (const [index, trace] of diagnostics.entries()) {
    const foreign = circuit.filter(e => ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type)).filter(pad => { const port = circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === pad.pcb_port_id && e.pcb_component_id === pad.pcb_component_id); return !port || netBySource.get(port.source_port_id) !== audit[index]!.netName; }).map(pad => { const copy = structuredClone(pad), id = pad.type === 'pcb_smtpad' ? 'pcb_smtpad_id' : 'pcb_plated_hole_id'; copy[id] = `usb_sink_foreign_${copy[id]}`; for (const key of ['pcb_port_id', 'port_hints', 'source_net_id', 'connectedTo']) delete copy[key]; return copy; });
    const input = [...structuredClone(circuit), structuredClone(trace), ...foreign, ...prefixGeometry.filter(e => e.type === 'pcb_via')];
    const errors = [...checkEachPcbTraceNonOverlapping(input, { minClearance: clearance }), ...checkPadTraceClearance(input, { minClearance: clearance }), ...checkViaTraceClearance(input, { minClearance: clearance })];
    if (errors.length) throw Error('USB sink exits fail proven foreign geometry: ' + errors.map(e => e.message).join('; '));
  }
  const checked = [...structuredClone(circuit), ...diagnostics, ...prefixGeometry];
  const errors = [...checkEachPcbTraceNonOverlapping(checked, { minClearance: clearance }), ...checkPadTraceClearance(checked, { minClearance: clearance }), ...checkViaTraceClearance(checked, { minClearance: clearance }), ...checkHoleTraceClearance(checked, { minClearance: Math.max(0.2, board.min_trace_to_hole_edge_clearance ?? 0.2) }), ...checkPcbTracesOutOfBoard(checked, { margin: Math.max(0.2, board.min_board_edge_clearance ?? 0.2) }), ...checkCopperToCutoutClearance(checked, { elementTypes: ['pcb_trace'] })];
  if (errors.length) throw Error('USB sink/prefixes fail native geometry: ' + errors.map(e => e.message).join('; '));
  return { proposals, audit, netNames: [...new Set(audit.map(p => p.netName))] };
}
