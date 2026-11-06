/** Finite pad-normal DRV8833PWPR exits for tscircuit's native saved fanout.
 * No path search, electrical changes, neck-down or DRC exemptions. Native global
 * routing and final copper/netlist/clearance checks remain mandatory.
 */
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkHoleTraceClearance,
  checkViaTraceClearance,
  checkPcbTracesOutOfBoard,
  checkCopperToCutoutClearance,
} from '@tscircuit/checks';
import type { PlanGraph } from '../../src/blocks/graph.js';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import { nativePlacementIssues } from '../../src/blocks/native-placement.js';
import type { NativeFanoutProposal } from './fanout.js';

const EPS = 1e-5;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const one = <T>(items: T[], label: string): T => {
  if (items.length !== 1) throw Error(`DRV8833 escape requires exactly one ${label}`);
  return items[0]!;
};
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < EPS;
const turn = (x: number, y: number, quarter: number) => {
  switch (((quarter % 4) + 4) % 4) {
    case 1: return { x: -y, y: x };
    case 2: return { x: -x, y: -y };
    case 3: return { x: y, y: -x };
    default: return { x, y };
  }
};

export function createDrv8833EscapeProposals(
  circuit: any[], graph: PlanGraph, mapping: Record<string, Record<string, string>>,
) {
  if (!Array.isArray(circuit) || !Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || !mapping)
    throw Error('DRV8833 escapes require actual native circuit, graph and import map');
  const drivers = graph.parts.filter(p => p.part.lcsc === 'C50506');
  const proposals: NativeFanoutProposal[] = [];
  const audit: Array<{
    ref: string; pad: string; net: string; sourceTraceId: string; sourcePortId: string;
    pcbPortId: string; landId: string; widthMm: number; lengthMm: number;
    normal: { x: number; y: number };
  }> = [];
  if (!drivers.length) return { proposals, audit, netNames: [] as string[] };
  if (circuit.some(e => e.type === 'pcb_trace' || e.type === 'pcb_via'))
    throw Error('DRV8833 escapes must be planned before routed copper');
  const netlist = nativeNetlistIssues(graph, circuit, mapping);
  if (netlist.length) throw Error('DRV8833 native source graph differs: ' + netlist.map(e => e.message).join('; '));
  const placement = nativePlacementIssues(graph, circuit);
  if (!placement.ok) throw Error('DRV8833 native placement differs: ' + placement.issues.map(e => e.message).join('; '));
  const board = one(circuit.filter(e => e.type === 'pcb_board'), 'native board');
  if (![2, 4].includes(board.num_layers) || ![board.width, board.height, board.center?.x, board.center?.y].every(finite) || board.width <= 0 || board.height <= 0)
    throw Error('DRV8833 escapes require a finite two/four-layer native board');
  const traceRule = board.min_trace_width ?? 0.15;
  const clearance = Math.max(0.127, board.min_trace_to_pad_edge_clearance ?? 0.127);
  if (!finite(traceRule) || traceRule <= 0 || !finite(clearance)) throw Error('Invalid native DRV8833 trace rules');
  const outline: Array<{ x: number; y: number }> = Array.isArray(board.outline) && board.outline.length >= 3
    ? board.outline
    : [
      { x: board.center.x - board.width / 2, y: board.center.y - board.height / 2 },
      { x: board.center.x + board.width / 2, y: board.center.y - board.height / 2 },
      { x: board.center.x + board.width / 2, y: board.center.y + board.height / 2 },
      { x: board.center.x - board.width / 2, y: board.center.y + board.height / 2 },
    ];
  if (outline.some(p => !finite(p.x) || !finite(p.y))) throw Error('Invalid native DRV8833 board outline');
  const insideBoard = (p: { x: number; y: number }) => {
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i]!, b = outline[j]!;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const diagnostics: any[] = [];
  for (const driver of drivers) {
    if (driver.part.mpn !== 'DRV8833PWPR') throw Error('Unsupported C50506 manufacturer identity');
    const source = one(circuit.filter(e => e.type === 'source_component' && e.name === driver.ref && e.manufacturer_part_number === driver.part.mpn && e.supplier_part_numbers?.jlcpcb?.includes('C50506')), 'actual DRV8833 source');
    const component = one(circuit.filter(e => e.type === 'pcb_component' && e.source_component_id === source.source_component_id), 'actual DRV8833 placement');
    const origin = component.footprint_origin;
    const quarter = Math.round(component.rotation / 90);
    if (component.layer !== 'top' || !origin || ![origin.x, origin.y, component.rotation].every(finite) || Math.abs(component.rotation - quarter * 90) > EPS)
      throw Error('DRV8833 escapes require actual cardinal top-layer placement');
    const resolved = nativeComponentPorts(circuit, source, Object.values(mapping[driver.ref] ?? {}));
    // Verify all sixteen physical perimeter lands, not an ID/name-only shortcut.
    const lands = Array.from({ length: 16 }, (_, index) => {
      const pad = String(index + 1), native = mapping[driver.ref]?.[pad];
      if (!native) throw Error(`Missing DRV8833 import mapping ${driver.ref}.${pad}`);
      const pin = one(resolved.byNative.get(native) ?? [], `physical source pin ${driver.ref}.${pad}`);
      if (pin.pin_number !== index + 1 || !pin.port_hints?.includes(`pin${pad}`)) throw Error('Contradictory physical DRV8833 pin identity');
      const port = one(circuit.filter(e => e.type === 'pcb_port' && e.source_port_id === pin.source_port_id && e.pcb_component_id === component.pcb_component_id), `actual PCB port ${driver.ref}.${pad}`);
      const land = one(circuit.filter(e => e.type === 'pcb_smtpad' && e.pcb_port_id === port.pcb_port_id && e.pcb_component_id === component.pcb_component_id), `physical land ${driver.ref}.${pad}`);
      if (!['pill', 'rotated_pill'].includes(land.shape) || land.layer !== 'top' || port.layers?.length !== 1 || port.layers[0] !== 'top' || !land.port_hints?.includes(`pin${pad}`) || ![land.x, land.y, port.x, port.y, land.width, land.height, land.ccw_rotation ?? 0].every(finite) || !close(land, port))
        throw Error('DRV8833 native pad-to-port geometry differs');
      const orientation = (((land.ccw_rotation ?? 0) - component.rotation) % 180 + 180) % 180;
      if (Math.min(orientation, 180 - orientation) > EPS || land.width < 0.3 || land.width > 0.4 || land.height < 1.2 || land.height > 1.4)
        throw Error('Unsupported DRV8833 perimeter land dimensions/orientation');
      const local = turn(land.x - origin.x, land.y - origin.y, -quarter);
      const side = index < 8 ? -1 : 1;
      const expectedX = (index < 8 ? index - 3.5 : 11.5 - index) * 0.65;
      if (Math.abs(local.y - side * 2.85) > 0.005 || Math.abs(local.x - expectedX) > 0.005)
        throw Error('Unsupported DRV8833 physical pad row/pitch');
      return { pad, pin, port, land, side };
    });
    for (const { pad, pin, port, land, side } of lands) {
      const nets = graph.nets.filter(n => n.pins.some(p => p.ref === driver.ref && p.pad === pad));
      if (!nets.length) continue; // Physically present, intentionally unconnected pins.
      const net = one(nets, `graph net for ${driver.ref}.${pad}`);
      if (net.pins.some(p => graph.parts.find(q => q.ref === p.ref)!.part.pins[p.logical]?.role === 'ground')) continue;
      const sourceNet = one(circuit.filter(e => e.type === 'source_net' && e.name === net.name), `native net ${net.name}`);
      const trace = one(circuit.filter(e => e.type === 'source_trace' && e.connected_source_port_ids?.includes(pin.source_port_id) && e.connected_source_net_ids?.includes(sourceNet.source_net_id)), `native source trace for ${driver.ref}.${pad}`);
      if (trace.connected_source_port_ids.length !== 1 || trace.connected_source_net_ids.length !== 1 || pin.subcircuit_id !== trace.subcircuit_id || sourceNet.subcircuit_id !== trace.subcircuit_id || port.subcircuit_id !== trace.subcircuit_id || !pin.subcircuit_connectivity_map_key || pin.subcircuit_connectivity_map_key !== trace.subcircuit_connectivity_map_key || sourceNet.subcircuit_connectivity_map_key !== trace.subcircuit_connectivity_map_key)
        throw Error('DRV8833 physical source/net membership differs');
      const width = trace.min_trace_thickness;
      if (!finite(width) || width < traceRule - EPS || width > land.width + EPS)
        throw Error('DRV8833 source width cannot fit the physical pad or native rule');
      const normal = turn(0, side, quarter), length = land.height / 2 + 0.5;
      const start = { route_type: 'wire' as const, x: port.x, y: port.y, layer: 'top' as const, width };
      const end = { ...start, x: start.x + normal.x * length, y: start.y + normal.y * length };
      if (!insideBoard(start) || !insideBoard(end)) throw Error('DRV8833 native geometry lies outside the board outline');
      proposals.push({ ref: driver.ref, pad, route: [start, end] });
      audit.push({ ref: driver.ref, pad, net: net.name, sourceTraceId: trace.source_trace_id, sourcePortId: pin.source_port_id, pcbPortId: port.pcb_port_id, landId: land.pcb_smtpad_id, widthMm: width, lengthMm: length, normal });
      diagnostics.push({ type: 'pcb_trace', pcb_trace_id: `drv8833_escape_diagnostic_${audit.length}`, source_trace_id: trace.source_trace_id, source_net_id: sourceNet.source_net_id, connection_name: sourceNet.source_net_id, connectsTo: [port.pcb_port_id], subcircuit_id: trace.subcircuit_id, route: [{ ...start, start_pcb_port_id: port.pcb_port_id }, end] });
    }
  }
  const netBySourcePort = new Map<string, string>();
  for (const part of graph.parts) {
    const source = one(circuit.filter(e => e.type === 'source_component' && e.name === part.ref), `source ${part.ref}`);
    const natives = [...Object.values(part.part.pins).map(pin => mapping[part.ref]![pin.pad]!), ...(part.part.omitPads ?? []).map(pad => mapping[part.ref]![pad]!)];
    const optional = new Set((part.part.omitPads ?? []).map(pad => mapping[part.ref]![pad]!));
    const resolved = nativeComponentPorts(circuit, source, natives, optional);
    for (const pin of Object.values(part.part.pins)) {
      const nets = graph.nets.filter(net => net.pins.some(p => p.ref === part.ref && p.pad === pin.pad));
      if (nets.length > 1) throw Error('DRV8833 escape foreign-pad source belongs to multiple graph nets');
      if (!nets.length) continue;
      for (const actual of resolved.byNative.get(mapping[part.ref]![pin.pad]!) ?? [])
        netBySourcePort.set(actual.source_port_id, nets[0]!.name);
    }
  }
  // Native checks infer contact at an unassigned free endpoint. That must not
  // convert accidental contact with a foreign land into permission to merge
  // nets. Recheck actual foreign geometry as isolated obstacles, after proving
  // its source ownership from the graph/native ports (never a pad's net label).
  for (const [index, trace] of diagnostics.entries()) {
    const net = audit[index]!.net;
    const foreign = circuit.filter(e => e.type === 'pcb_smtpad' || e.type === 'pcb_plated_hole').filter(pad => {
      const port = circuit.find(e => e.type === 'pcb_port' && e.pcb_port_id === pad.pcb_port_id && e.pcb_component_id === pad.pcb_component_id);
      return !port || netBySourcePort.get(port.source_port_id) !== net;
    }).map(pad => {
      const projected = structuredClone(pad);
      const id = pad.type === 'pcb_smtpad' ? 'pcb_smtpad_id' : 'pcb_plated_hole_id';
      projected[id] = `drv8833_foreign_projection_${pad[id]}`;
      delete projected.pcb_port_id;
      delete projected.port_hints;
      delete projected.source_net_id;
      delete projected.connectedTo;
      return projected;
    });
    const checked = [...structuredClone(circuit), structuredClone(trace), ...foreign];
    const errors = [
      ...checkPadTraceClearance(checked, { minClearance: clearance }),
      ...checkEachPcbTraceNonOverlapping(checked, { minClearance: clearance }),
    ];
    if (errors.length) throw Error('DRV8833 pad-normal exits fail native geometry at a proven foreign pad: ' + errors.map(e => e.message).join('; '));
  }
  // Native geometric checks see every actual foreign/NC pad and keepout, not
  // merely pads listed in the motor net. A net label never excuses foreign Cu.
  const checked = [...structuredClone(circuit), ...diagnostics];
  const errors = [
    ...checkEachPcbTraceNonOverlapping(checked, { minClearance: clearance }),
    ...checkPadTraceClearance(checked, { minClearance: clearance }),
    ...checkHoleTraceClearance(checked, { minClearance: Math.max(0.2, board.min_trace_to_hole_edge_clearance ?? 0.2) }),
    ...checkViaTraceClearance(checked, { minClearance: clearance }),
    ...checkPcbTracesOutOfBoard(checked, { margin: Math.max(0.2, board.min_board_edge_clearance ?? 0.2) }),
    ...checkCopperToCutoutClearance(checked, { elementTypes: ['pcb_trace'] }),
  ];
  if (errors.length) throw Error('DRV8833 pad-normal exits fail native geometry: ' + errors.map(e => e.message).join('; '));
  return { proposals, audit, netNames: [...new Set(audit.map(e => e.net))].sort() };
}
