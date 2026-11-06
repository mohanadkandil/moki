/** Finite RP2040 signal pad-normal stubs, handed to native saved fanout.
 * No path search, via insertion, width change, DRC exemption or net mutation.
 */
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkViaTraceClearance,
  checkHoleTraceClearance,
  checkPcbTracesOutOfBoard,
  checkCopperToCutoutClearance,
} from '@tscircuit/checks';
import type { PlanGraph } from '../../src/blocks/graph.js';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import { nativePlacementIssues } from '../../src/blocks/native-placement.js';
import type { NativeFanoutProposal } from './fanout.js';
import type { RpClockPhase } from './rp-clock.js';
import type { RpEscapePhase } from './rp-escape.js';

type Point = { x: number; y: number };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const one = <T>(a: T[], name: string) => {
  if (a.length !== 1) throw Error(`RP signal escape requires one ${name}`);
  return a[0]!;
};
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
const turn = (p: Point, q: number): Point => {
  switch (((q % 4) + 4) % 4) {
    case 1:
      return { x: -p.y, y: p.x };
    case 2:
      return { x: -p.x, y: -p.y };
    case 3:
      return { x: p.y, y: -p.x };
    default:
      return { ...p };
  }
};
export function createRpSignalEscapeProposals(
  circuit: any[],
  graph: PlanGraph,
  mapping: Record<string, Record<string, string>>,
  clock: RpClockPhase,
  power: RpEscapePhase,
  excludedNetNames: ReadonlySet<string> = new Set(),
) {
  const proposals: NativeFanoutProposal[] = [];
  const audit: Array<{
    ref: string;
    pad: string;
    netName: string;
    selector: string;
    route: NativeFanoutProposal['route'];
    diagnosticSourceTraceId: string;
    diagnosticSourcePortId: string;
    diagnosticPcbPortId: string;
    diagnosticSourceNetId: string;
    lengthMm: number;
    kind: 'outward-stub' | 'inside-pad-handoff';
  }> = [];
  if (
    !Array.isArray(circuit) ||
    !Array.isArray(graph?.parts) ||
    !mapping ||
    typeof excludedNetNames?.has !== 'function'
  )
    throw Error('RP signal escape requires actual circuit, graph, import map and explicit exclusion set');
  const targets = graph.parts.filter((p) => p.part.lcsc === 'C2040');
  if (!targets.length) return { proposals, audit, netNames: [] as string[] };
  const mcu = one(targets, 'RP2040');
  if (mcu.part.mpn !== 'RP2040' || mcu.block.id !== 'rp2040-minimal' || ![3, 4].includes(mcu.block.version))
    throw Error('Unsupported immutable RP signal profile');
  if (circuit.some((e) => ['pcb_trace', 'pcb_via'].includes(e.type)))
    throw Error('RP signal escape must be prepared before routed copper');
  const netlist = nativeNetlistIssues(graph, circuit, mapping),
    placement = nativePlacementIssues(graph, circuit);
  if (netlist.length || !placement.ok)
    throw Error(
      'RP signal native source/placement differs: ' +
        [...netlist, ...placement.issues].map((e) => e.message).join('; '),
    );
  if (
    !clock?.props ||
    clock.audit.length !== 5 ||
    !power?.props ||
    power.audit.length < 14 ||
    power.audit.length > 18
  )
    throw Error(
      'RP signal escape requires the validated clock, fourteen power prefixes and known optional application/USB vias',
    );
  const board = one(
    circuit.filter((e) => e.type === 'pcb_board'),
    'native board',
  );
  if (
    ![2, 4].includes(board.num_layers) ||
    ![board.width, board.height, board.center?.x, board.center?.y].every(finite) ||
    board.min_trace_width > 0.15
  )
    throw Error('RP signal escape violates native board geometry/rules');
  const componentSource = one(
    circuit.filter(
      (e) =>
        e.type === 'source_component' &&
        e.name === mcu.ref &&
        e.manufacturer_part_number === 'RP2040' &&
        e.supplier_part_numbers?.jlcpcb?.includes('C2040'),
    ),
    'actual MCU source',
  );
  const component = one(
    circuit.filter(
      (e) => e.type === 'pcb_component' && e.source_component_id === componentSource.source_component_id,
    ),
    'actual MCU placement',
  );
  const origin = component.footprint_origin,
    q = Math.round(component.rotation / 90);
  if (
    component.layer !== 'top' ||
    !origin ||
    ![origin.x, origin.y, component.rotation].every(finite) ||
    Math.abs(component.rotation - q * 90) > 1e-5
  )
    throw Error('RP signal escape requires cardinal top-layer placement');
  const resolved = nativeComponentPorts(circuit, componentSource, Object.values(mapping[mcu.ref]!));
  const outline: Point[] =
    Array.isArray(board.outline) && board.outline.length >= 3
      ? board.outline
      : [
          { x: board.center.x - board.width / 2, y: board.center.y - board.height / 2 },
          { x: board.center.x + board.width / 2, y: board.center.y - board.height / 2 },
          { x: board.center.x + board.width / 2, y: board.center.y + board.height / 2 },
          { x: board.center.x - board.width / 2, y: board.center.y + board.height / 2 },
        ];
  if (outline.some((p) => !finite(p.x) || !finite(p.y))) throw Error('Invalid RP signal board outline');
  const inside = (p: Point) => {
    let hit = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i]!,
        b = outline[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const powerPads = ['1', '10', '19', '22', '23', '33', '42', '43', '44', '45', '48', '49', '50', '57'];
  const applicationPads = power.audit.filter((p) => !powerPads.includes(p.pad));
  const coupledUsb = power.scope === 'finite-rp2040-coupled-usb-power-native-escapes';
  if (
    new Set(power.audit.map((p) => p.pad)).size !== power.audit.length ||
    !powerPads.every((pad) => power.audit.some((p) => p.pad === pad)) ||
    applicationPads.some((p) =>
      ['17', '18'].includes(p.pad)
        ? p.kind !== 'application-gpio'
        : !['46', '47'].includes(p.pad) || p.kind !== 'usb-signal' || !coupledUsb,
    ) ||
    (applicationPads.length > 0 &&
      power.scope !== 'finite-rp2040-power-ground-application-native-escapes' &&
      !coupledUsb) ||
    power.audit.some((p) => p.ref !== mcu.ref || ![...powerPads, '17', '18', '46', '47'].includes(p.pad))
  )
    throw Error('RP signal requires complete distinct physical power prefixes');
  const prefix: any[] = [];
  for (const path of clock.audit) {
    const net = one(
      circuit.filter((e) => e.type === 'source_net' && e.name === path.net),
      'clock prefix net',
    );
    const source = one(
      circuit.filter(
        (e) =>
          e.type === 'source_trace' &&
          e.connected_source_net_ids?.includes(net.source_net_id) &&
          e.display_name?.startsWith(path.from + ' to '),
      ),
      'clock prefix source',
    );
    prefix.push({
      type: 'pcb_trace',
      pcb_trace_id: `rp_signal_clock_${prefix.length}`,
      source_trace_id: source.source_trace_id,
      source_net_id: net.source_net_id,
      subcircuit_id: source.subcircuit_id,
      route: structuredClone(path.route),
    });
  }
  for (const path of power.audit) {
    const source = one(
      circuit.filter(
        (e) =>
          e.type === 'source_trace' &&
          e.source_trace_id === path.diagnosticSourceTraceId &&
          e.connected_source_port_ids?.includes(path.diagnosticSourcePortId) &&
          e.connected_source_net_ids?.includes(path.diagnosticSourceNetId),
      ),
      'power prefix source',
    );
    const port = one(
      circuit.filter(
        (e) =>
          e.type === 'pcb_port' &&
          e.pcb_port_id === path.diagnosticPcbPortId &&
          e.source_port_id === path.diagnosticSourcePortId,
      ),
      'power prefix physical port',
    );
    const net = one(
      circuit.filter(
        (e) =>
          e.type === 'source_net' &&
          e.source_net_id === path.diagnosticSourceNetId &&
          e.name === path.netName,
      ),
      'power prefix named net',
    );
    const application = ['17', '18', '46', '47'].includes(path.pad);
    const physical = Object.entries(mcu.part.pins).filter(([, pin]) => pin.pad === path.pad);
    if (
      !near(path.route[0]!, port) ||
      (application
        ? physical.length !== 1 ||
          physical[0]![1].role !== 'bidirectional' ||
          !graph.nets.some(
            (n) =>
              n.name === net.name &&
              n.pins.some((p) => p.ref === mcu.ref && p.pad === path.pad && p.logical === physical[0]![0]),
          ) ||
          !circuit.some(
            (e) =>
              e.type === 'source_port' &&
              e.source_port_id === path.diagnosticSourcePortId &&
              e.source_component_id === componentSource.source_component_id &&
              e.pin_number === Number(path.pad),
          )
        : !['GND', 'V3V3', 'VCORE'].includes(net.name))
    )
      throw Error('RP signal power prefix differs from actual source/port');
    const prefixTraceId = `rp_signal_power_${prefix.length}`;
    prefix.push({
      type: 'pcb_trace',
      pcb_trace_id: prefixTraceId,
      source_trace_id: source.source_trace_id,
      source_net_id: net.source_net_id,
      subcircuit_id: source.subcircuit_id,
      route: structuredClone(path.route),
    });
    for (const point of path.route)
      if (point.route_type === 'via') {
        if (
          point.from_layer !== 'top' ||
          point.to_layer !== 'bottom' ||
          point.via_diameter !== 0.6 ||
          point.via_hole_diameter !== 0.3
        )
          throw Error('Unsupported RP signal prefix via geometry');
        prefix.push({
          type: 'pcb_via',
          pcb_via_id: `rp_signal_prefix_via_${prefix.length}`,
          pcb_trace_id: prefixTraceId,
          x: point.x,
          y: point.y,
          outer_diameter: point.via_diameter,
          hole_diameter: point.via_hole_diameter,
          from_layer: 'top',
          to_layer: 'bottom',
          layers: board.num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'],
        });
      }
  }
  const diagnostics: any[] = [];
  for (const physical of Object.values(mcu.part.pins)) {
    const pad = physical.pad,
      number = Number(pad);
    if (!Number.isInteger(number) || number < 1 || number > 56) continue;
    const nets = graph.nets.filter((n) => n.pins.some((p) => p.ref === mcu.ref && p.pad === pad));
    if (!nets.length) continue;
    const net = one(nets, `signal graph net ${pad}`);
    if (
      net.pins.some((p) =>
        ['power-in', 'power-out', 'ground'].includes(
          graph.parts.find((q) => q.ref === p.ref)!.part.pins[p.logical]!.role,
        ),
      ) ||
      clock.netNames.includes(net.name) ||
      excludedNetNames.has(net.name)
    )
      continue;
    const normalLocal =
      number <= 14
        ? { x: -1, y: 0 }
        : number <= 28
          ? { x: 0, y: -1 }
          : number <= 42
            ? { x: 1, y: 0 }
            : { x: 0, y: 1 };
    // GPIO14/15 (physical17/18) cannot take the long outward normal through
    // XIN. Their short handoff stays wholly in the actual pad copper and gives
    // native routing freedom to turn; it is not an off-pad escape or via permit.
    const insidePadHandoff = number === 17 || number === 18;
    // Stop USB_DM before the checked power45 via(1.799844,4.55).
    const length = insidePadHandoff ? 0.2 : number === 46 ? 0.6 : 0.925;
    const native = mapping[mcu.ref]?.[pad];
    if (!native) throw Error(`Missing actual RP signal mapping ${pad}`);
    const sourcePin = one(resolved.byNative.get(native) ?? [], `source pin ${pad}`);
    if (sourcePin.pin_number !== Number(pad) || !sourcePin.port_hints?.includes(`pin${pad}`))
      throw Error('RP signal physical pin alias differs');
    const port = one(
      circuit.filter(
        (e) =>
          e.type === 'pcb_port' &&
          e.source_port_id === sourcePin.source_port_id &&
          e.pcb_component_id === component.pcb_component_id,
      ),
      `PCB port ${pad}`,
    );
    const land = one(
      circuit.filter(
        (e) =>
          e.type === 'pcb_smtpad' &&
          e.pcb_port_id === port.pcb_port_id &&
          e.pcb_component_id === component.pcb_component_id,
      ),
      `physical land ${pad}`,
    );
    const local = turn({ x: port.x - origin.x, y: port.y - origin.y }, -q);
    if (
      !['rect', 'rotated_rect'].includes(land.shape) ||
      land.layer !== 'top' ||
      port.layers?.length !== 1 ||
      port.layers[0] !== 'top' ||
      !land.port_hints?.includes(`pin${pad}`) ||
      ![land.x, land.y, port.x, port.y, land.width, land.height, land.ccw_rotation ?? 0].every(finite) ||
      !near(land, port) ||
      Math.abs(local.x * normalLocal.x + local.y * normalLocal.y - 3.425) > 0.005 ||
      Math.abs(local.x * normalLocal.y - local.y * normalLocal.x) > 2.61 ||
      Math.abs(Math.min(land.width, land.height) - 0.2) > 0.005 ||
      Math.abs(Math.max(land.width, land.height) - 0.85) > 0.005
    )
      throw Error('Unsupported actual RP signal land geometry');
    const landQuarter = Math.round((land.ccw_rotation ?? 0) / 90),
      axis = turn(land.width > land.height ? { x: 1, y: 0 } : { x: 0, y: 1 }, landQuarter),
      normalWorld = turn(normalLocal, q);
    if (
      Math.abs((land.ccw_rotation ?? 0) - landQuarter * 90) > 1e-5 ||
      Math.abs(axis.x * normalWorld.x + axis.y * normalWorld.y) < 0.99999
    )
      throw Error('RP signal land long axis differs from its physical pad normal');
    const sourceNet = one(
      circuit.filter((e) => e.type === 'source_net' && e.name === net.name),
      `native signal net ${pad}`,
    );
    const source = one(
      circuit.filter(
        (e) =>
          e.type === 'source_trace' &&
          e.connected_source_port_ids?.includes(sourcePin.source_port_id) &&
          e.connected_source_net_ids?.includes(sourceNet.source_net_id),
      ),
      `actual signal trace ${pad}`,
    );
    if (
      source.min_trace_thickness !== 0.15 ||
      source.connected_source_port_ids.length !== 1 ||
      source.connected_source_net_ids.length !== 1 ||
      source.subcircuit_id !== sourcePin.subcircuit_id ||
      source.subcircuit_id !== sourceNet.subcircuit_id ||
      source.subcircuit_id !== port.subcircuit_id ||
      !sourcePin.subcircuit_connectivity_map_key ||
      sourcePin.subcircuit_connectivity_map_key !== source.subcircuit_connectivity_map_key ||
      sourcePin.subcircuit_connectivity_map_key !== sourceNet.subcircuit_connectivity_map_key
    )
      throw Error('RP signal source width/net membership differs');
    const normal = turn(normalLocal, q),
      start = { route_type: 'wire' as const, x: port.x, y: port.y, layer: 'top' as const, width: 0.15 };
    const route = [start, { ...start, x: start.x + normal.x * length, y: start.y + normal.y * length }];
    if (insidePadHandoff) {
      const end = turn({ x: route[1]!.x - land.x, y: route[1]!.y - land.y }, -landQuarter);
      if (Math.abs(end.x) + 0.075 > land.width / 2 || Math.abs(end.y) + 0.075 > land.height / 2)
        throw Error('RP signal internal handoff must remain wholly inside actual pad copper');
    }
    if (route.some((p) => !inside(p)))
      throw Error('RP signal native geometry lies outside the board outline');
    const selector = `.${mcu.ref} > .pin${pad}`;
    proposals.push({ ref: mcu.ref, pad, route });
    audit.push({
      ref: mcu.ref,
      pad,
      netName: net.name,
      selector,
      route,
      diagnosticSourceTraceId: source.source_trace_id,
      diagnosticSourcePortId: sourcePin.source_port_id,
      diagnosticPcbPortId: port.pcb_port_id,
      diagnosticSourceNetId: sourceNet.source_net_id,
      lengthMm: length,
      kind: insidePadHandoff ? 'inside-pad-handoff' : 'outward-stub',
    });
    diagnostics.push({
      type: 'pcb_trace',
      pcb_trace_id: `rp_signal_diagnostic_${pad}`,
      source_trace_id: source.source_trace_id,
      source_net_id: sourceNet.source_net_id,
      subcircuit_id: source.subcircuit_id,
      route: [{ ...route[0], start_pcb_port_id: port.pcb_port_id }, route[1]],
    });
  }
  const checked = [...structuredClone(circuit), ...prefix, ...diagnostics];
  const clearance = Math.max(0.127, board.min_trace_to_pad_edge_clearance ?? 0.127);
  const netBySource = new Map<string, string>();
  for (const part of graph.parts) {
    const source = one(
      circuit.filter((e) => e.type === 'source_component' && e.name === part.ref),
      `actual source ${part.ref}`,
    );
    const natives = [
      ...Object.values(part.part.pins).map((p) => mapping[part.ref]![p.pad]!),
      ...(part.part.omitPads ?? []).map((p) => mapping[part.ref]![p]!),
    ];
    const resolvedPart = nativeComponentPorts(
      circuit,
      source,
      natives,
      new Set((part.part.omitPads ?? []).map((p) => mapping[part.ref]![p]!)),
    );
    for (const pin of Object.values(part.part.pins)) {
      const nets = graph.nets.filter((n) => n.pins.some((p) => p.ref === part.ref && p.pad === pin.pad));
      if (nets.length > 1) throw Error('Ambiguous physical RP signal net ownership');
      if (nets.length)
        for (const p of resolvedPart.byNative.get(mapping[part.ref]![pin.pad]!) ?? [])
          netBySource.set(p.source_port_id, nets[0]!.name);
    }
  }
  // Project source-proven foreign lands without connectivity aliases so free
  // endpoint contact cannot silently join the stub to a different physical net.
  for (const [index, trace] of diagnostics.entries()) {
    const foreign = circuit
      .filter((e) => ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type))
      .filter((pad) => {
        const port = circuit.find(
          (e) =>
            e.type === 'pcb_port' &&
            e.pcb_port_id === pad.pcb_port_id &&
            e.pcb_component_id === pad.pcb_component_id,
        );
        return !port || netBySource.get(port.source_port_id) !== audit[index]!.netName;
      })
      .map((pad) => {
        const copy = structuredClone(pad),
          id = pad.type === 'pcb_smtpad' ? 'pcb_smtpad_id' : 'pcb_plated_hole_id';
        copy[id] = `rp_signal_foreign_${copy[id]}`;
        for (const key of ['pcb_port_id', 'port_hints', 'source_net_id', 'connectedTo']) delete copy[key];
        return copy;
      });
    const projected = [
      ...structuredClone(circuit),
      structuredClone(trace),
      ...foreign,
      ...prefix.filter((p) => p.type === 'pcb_via'),
    ];
    const errors = [
      ...checkEachPcbTraceNonOverlapping(projected, { minClearance: clearance }),
      ...checkPadTraceClearance(projected, { minClearance: clearance }),
      ...checkViaTraceClearance(projected, { minClearance: clearance }),
    ];
    if (errors.length)
      throw Error(
        'RP signal stub fails source-proven foreign geometry: ' + errors.map((e) => e.message).join('; '),
      );
  }
  const errors = [
    ...checkEachPcbTraceNonOverlapping(checked, { minClearance: clearance }),
    ...checkPadTraceClearance(checked, { minClearance: clearance }),
    ...checkViaTraceClearance(checked, { minClearance: clearance }),
    ...checkHoleTraceClearance(checked, {
      minClearance: Math.max(0.2, board.min_trace_to_hole_edge_clearance ?? 0.2),
    }),
    ...checkPcbTracesOutOfBoard(checked, { margin: Math.max(0.2, board.min_board_edge_clearance ?? 0.2) }),
    ...checkCopperToCutoutClearance(checked, { elementTypes: ['pcb_trace'] }),
  ];
  if (errors.length)
    throw Error(
      'RP signal/power/clock prefixes fail native geometry: ' + errors.map((e) => e.message).join('; '),
    );
  return { proposals, audit, netNames: [...new Set(audit.map((a) => a.netName))] };
}
