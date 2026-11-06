/** Finite RP2040 power/ground pad-to-via fanout, not a pathfinder.
 * Native fanout preserves these local escapes; native routing/DRC still decides
 * whether the rest of the selected board can route. No via-in-pad is permitted.
 */
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkHoleTraceClearance,
  checkViaTraceClearance,
  checkViaPadClearance,
  checkViasInPads,
  checkSameNetViaSpacing,
  checkDifferentNetViaSpacing,
  checkViasOffBoard,
  checkPcbTracesOutOfBoard,
  checkCopperToCutoutClearance,
} from '@tscircuit/checks';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import { nativePlacementIssues } from '../../src/blocks/native-placement.js';
import type { PlanGraph } from '../../src/blocks/graph.js';
import type { RpClockPhase } from './rp-clock.js';
type Point = { x: number; y: number };
type Wire = Point & { route_type: 'wire'; layer: 'top' | 'bottom'; width: number };
type Via = Point & {
  route_type: 'via';
  from_layer: 'top';
  to_layer: 'bottom';
  via_diameter: number;
  via_hole_diameter: number;
};
export type RpEscapeRoutePoint = Wire | Via;
export interface RpEscapePhase {
  scope:
    | 'finite-rp2040-ground-native-escapes'
    | 'finite-rp2040-power-ground-native-escapes'
    | 'finite-rp2040-power-ground-application-native-escapes'
    | 'finite-rp2040-coupled-usb-power-native-escapes';
  props: null | {
    name: string;
    phaseIndex: 1;
    autorouter: 'fanout';
    connections: string[];
    pcbTracePaths: Array<{ connection: string; route: RpEscapeRoutePoint[] }>;
  };
  netNames: string[];
  audit: Array<{
    ref: string;
    pad: string;
    netName: string;
    selector: string;
    route: RpEscapeRoutePoint[];
    via: Point;
    diagnosticSourceTraceId: string;
    diagnosticSourcePortId: string;
    diagnosticPcbPortId: string;
    diagnosticSourceNetId: string;
    kind?: 'application-gpio' | 'usb-signal';
  }>;
  sourceTraceWidthOverrides: Array<{ ref: string; pad: string; widthMm: number }>;
}
const WIDTH = 0.15,
  VIA = 0.6,
  DRILL = 0.3,
  EPS = 1e-5;
const one = <T>(values: T[], name: string): T => {
  if (values.length !== 1) throw Error(`RP escape requires exactly one ${name}`);
  return values[0]!;
};
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
// Explicitly reviewed local candidates. All14 paths are rechecked against the
// complete actual native pad/drill geometry and the saved oscillator copper.
const exits: Record<string, Point[]> = {
  '1': [{ x: -2.1, y: 2.5 }],
  '10': [{ x: -2.1, y: -0.999871 }],
  '19': [{ x: -0.999998, y: -2.1 }],
  '22': [{ x: 0.199898, y: -2.1 }],
  '23': [
    { x: 0.599948, y: -2.9 },
    { x: 1, y: -2.5 },
  ],
  '33': [{ x: 2.1, y: -0.999871 }],
  '42': [{ x: 2.1, y: 2.600071 }],
  '43': [{ x: 2.599944, y: 4.55 }],
  '44': [{ x: 2.199894, y: 2.1 }],
  '45': [{ x: 1.799844, y: 4.55 }],
  '48': [
    { x: 0.599948, y: 2.9 },
    { x: 0.9, y: 2.5 },
  ],
  '49': [{ x: 0.199898, y: 2.1 }],
  '50': [
    { x: -0.200152, y: 2.9 },
    { x: -0.8, y: 2.5 },
  ],
  '57': [{ x: 2.1, y: 0.000127 }],
};
// Two finite inward application escapes, independently checked with all power
// paths and oscillator copper. They are emitted only for connected GPIO14/15.
const applicationExits: Record<string, Point[]> = {
  '17': [
    { x: -1.800098, y: -2.9 },
    { x: -2.5, y: -2.5 },
  ],
  '18': [
    { x: -1.400048, y: -2.9 },
    { x: -1.8, y: -2.1 },
  ],
};
// Relocate the adjacent power vias as one coupled profile, leaving the USB
// pair real off-pad through-barrel exits beyond the north pad row.
const usbPowerExits: Record<string, Point[]> = {
  '42': [{ x: 4.55, y: 2.600071 }],
  '44': [
    { x: 2.199894, y: 2.95 },
    { x: 2.65, y: 2.5 },
    { x: 2.65, y: 1.3 },
    { x: 2.1, y: 1.3 },
  ],
  '45': [{ x: 1.799844, y: 2.1 }],
};
const usbExits: Record<string, Point[]> = {
  '46': [
    { x: 1.4, y: 4.1 },
    { x: 1.8, y: 4.6 },
  ],
  '47': [
    { x: 1, y: 4.6 },
    { x: 0.8, y: 4.6 },
  ],
};
export function createRpEscapePhase(
  circuit: any[],
  graph: PlanGraph,
  mapping: Record<string, Record<string, string>>,
  clock: RpClockPhase,
  options: { applicationVias?: boolean; usbVias?: boolean; groundOnly?: boolean } = {},
): RpEscapePhase {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (k) =>
        options[k as keyof typeof options] !== undefined &&
        !['applicationVias', 'usbVias', 'groundOnly'].includes(k),
    ) ||
    Object.values(options).some((v) => v !== undefined && typeof v !== 'boolean')
  )
    throw Error('Unsupported RP escape options');
  if (options.groundOnly && (options.applicationVias || options.usbVias))
    throw Error('RP ground-only escapes cannot include application or USB vias');
  const empty: RpEscapePhase = {
    scope: options.groundOnly
      ? 'finite-rp2040-ground-native-escapes'
      : 'finite-rp2040-power-ground-native-escapes',
    props: null,
    netNames: [],
    audit: [],
    sourceTraceWidthOverrides: [],
  };
  if (!Array.isArray(circuit) || !graph?.parts || !graph?.nets || !mapping)
    throw Error('RP escape requires actual native geometry/graph/map');
  const mcus = graph.parts.filter((p) => p.part.lcsc === 'C2040');
  if (!mcus.length) return empty;
  const mcu = one(mcus, 'RP2040');
  const coupledUsb =
    options.usbVias === true &&
    graph.nets.some((n) => n.pins.some((p) => p.ref === mcu.ref && ['46', '47'].includes(p.pad)));
  if (mcu.block.id !== 'rp2040-minimal' || ![3, 4].includes(mcu.block.version) || mcu.part.mpn !== 'RP2040')
    throw Error('Unsupported immutable RP escape block revision');
  if (circuit.some((e) => ['pcb_trace', 'pcb_via'].includes(e.type)))
    throw Error('RP escape must be prepared before routing');
  if (!clock?.props || clock.audit.length !== 5)
    throw Error('RP escape requires independently validated native clock phase');
  const board = one(
    circuit.filter((e) => e.type === 'pcb_board'),
    'native board',
  );
  if (![2, 4].includes(board.num_layers)) throw Error('RP escape requires native2/4layer board');
  if (
    board.min_trace_width > WIDTH ||
    board.min_via_pad_diameter > VIA ||
    board.min_via_hole_diameter > DRILL
  )
    throw Error('RP escape fixed geometry violates stronger board rules');
  const placement = nativePlacementIssues(graph, circuit),
    sourceIssues = nativeNetlistIssues(graph, circuit, mapping);
  if (!placement.ok || sourceIssues.length)
    throw Error(
      'RP escape native placement/source graph differs: ' +
        [...placement.issues, ...sourceIssues].map((i) => i.message).join('; '),
    );
  const q = Math.round((mcu.at.rotation ?? 0) / 90);
  if (Math.abs((mcu.at.rotation ?? 0) - q * 90) > EPS)
    throw Error('RP escape requires cardinal MCU placement');
  const world = (p: Point) => {
    const t = turn(p, q);
    return { x: t.x + mcu.at.x, y: t.y + mcu.at.y };
  };
  const local = (p: Point) => turn({ x: p.x - mcu.at.x, y: p.y - mcu.at.y }, -q);
  const source = one(
    circuit.filter((e) => e.type === 'source_component' && e.name === mcu.ref),
    'MCU source',
  );
  const ports = nativeComponentPorts(circuit, source, Object.values(mapping[mcu.ref]!));
  const pcb = one(
    circuit.filter((e) => e.type === 'pcb_component' && e.source_component_id === source.source_component_id),
    'MCU PCB owner',
  );
  const checks = structuredClone(circuit),
    names = new Set<string>();
  // Independently enforce the task's no-via-in-pad rule even if caller metadata allows it.
  checks.find((e) => e.type === 'pcb_board').is_via_in_pad_allowed = false;
  for (const c of clock.audit) {
    const net = one(
        circuit.filter((e) => e.type === 'source_net' && e.name === c.net),
        'clock source net',
      ),
      trace = one(
        circuit.filter(
          (e) =>
            e.type === 'source_trace' &&
            e.connected_source_net_ids?.includes(net.source_net_id) &&
            e.display_name?.startsWith(c.from + ' to '),
        ),
        'clock source trace',
      );
    checks.push({
      type: 'pcb_trace',
      pcb_trace_id: 'rp_escape_clock_' + checks.length,
      source_trace_id: trace.source_trace_id,
      source_net_id: net.source_net_id,
      subcircuit_id: trace.subcircuit_id,
      route: structuredClone(c.route),
    });
  }
  // Select before constructing/checking routes: unused supply/USB barrels must
  // not constrain this two-ground-only finite profile. All actual pads remain.
  const selectedExits = options.groundOnly
    ? { '19': exits['19']!, '57': exits['57']! }
    : {
        ...exits,
        ...(options.applicationVias ? applicationExits : {}),
        ...(coupledUsb ? usbPowerExits : {}),
        ...(coupledUsb ? usbExits : {}),
      };
  for (const [pad, waypoints] of Object.entries(selectedExits)) {
    const application = Object.hasOwn(applicationExits, pad);
    const usb = Object.hasOwn(usbExits, pad);
    const logical = one(
      Object.entries(mcu.part.pins).filter(([, p]) => p.pad === pad),
      'physical MCU pin ' + pad,
    );
    const nets = graph.nets.filter((n) =>
      n.pins.some((p) => p.ref === mcu.ref && p.pad === pad && p.logical === logical[0]),
    );
    if ((application || usb) && !nets.length) continue;
    const net = one(nets, 'physical escape net ' + pad);
    if (
      application || usb
        ? logical[1].role !== 'bidirectional'
        : !['power-in', 'power-out', 'ground'].includes(logical[1].role) && pad !== '19'
    )
      throw Error('RP escape finite pin role differs ' + pad);
    if (options.groundOnly && logical[1].role !== (pad === '19' ? 'input' : 'ground'))
      throw Error('RP ground-only finite pin role differs ' + pad);
    const native = mapping[mcu.ref]?.[pad];
    if (!native) throw Error('RP escape missing actual physical map ' + pad);
    const main = one(
      (ports.byNative.get(native) ?? []).filter((p) => !/_internal_\d+$/.test(p.name)),
      'canonical MCU port ' + pad,
    );
    if (
      (application || usb) &&
      (main.pin_number !== Number(pad) ||
        main.name !== (usb ? (pad === '46' ? 'USB_DM' : 'USB_DP') : `GPIO${Number(pad) - 3}`) ||
        !main.port_hints?.includes(`pin${pad}`))
    )
      throw Error('RP application escape actual GPIO identity differs ' + pad);
    if (
      options.groundOnly &&
      (main.pin_number !== Number(pad) ||
        main.name !== (pad === '19' ? 'TESTEN' : 'GND') ||
        !main.port_hints?.includes(`pin${pad}`))
    )
      throw Error('RP ground-only actual physical identity differs ' + pad);
    const port = one(
      circuit.filter(
        (e) =>
          e.type === 'pcb_port' &&
          e.source_port_id === main.source_port_id &&
          e.pcb_component_id === pcb.pcb_component_id,
      ),
      'actual MCU pad port ' + pad,
    );
    const start = local(port);
    if (
      !Number.isFinite(start.x) ||
      !Number.isFinite(start.y) ||
      !port.layers?.includes('top') ||
      pcb.layer !== 'top'
    )
      throw Error('RP escape requires finite top native ports');
    const lands = circuit.filter(
      (e) =>
        e.type === 'pcb_smtpad' &&
        e.pcb_port_id === port.pcb_port_id &&
        e.pcb_component_id === pcb.pcb_component_id &&
        e.port_hints?.includes(native),
    );
    if (!lands.length) throw Error('RP escape lacks physical pad membership ' + pad);
    const nativeNet = one(
      circuit.filter((e) => e.type === 'source_net' && e.name === net.name),
      'native power/ground net',
    );
    if (options.groundOnly && nativeNet.is_ground !== true)
      throw Error('RP ground-only escape must belong to actual native ground net');
    const sourceTrace = one(
      circuit.filter(
        (e) =>
          e.type === 'source_trace' &&
          e.connected_source_port_ids?.length === 1 &&
          e.connected_source_port_ids[0] === main.source_port_id &&
          e.connected_source_net_ids?.length === 1 &&
          e.connected_source_net_ids[0] === nativeNet.source_net_id,
      ),
      'actual MCU one-port-to-net trace',
    );
    const points = [start, ...waypoints];
    const route: Array<Wire | Via> = points.map((p) => ({
      ...world(p),
      route_type: 'wire',
      layer: 'top',
      width: WIDTH,
    }));
    const end = world(waypoints.at(-1)!);
    route.push({
      ...end,
      route_type: 'via',
      from_layer: 'top',
      to_layer: 'bottom',
      via_diameter: VIA,
      via_hole_diameter: DRILL,
    });
    const selector = `.${mcu.ref} > .${native}`,
      id = 'rp_escape_diagnostic_' + pad;
    checks.push({
      type: 'pcb_trace',
      pcb_trace_id: id,
      source_trace_id: sourceTrace.source_trace_id,
      source_net_id: nativeNet.source_net_id,
      subcircuit_id: sourceTrace.subcircuit_id,
      route: [
        ...route.map((p, i) => ({ ...p, ...(i === 0 ? { start_pcb_port_id: port.pcb_port_id } : {}) })),
        { ...end, route_type: 'wire', layer: 'bottom', width: WIDTH },
      ],
    });
    checks.push({
      type: 'pcb_via',
      pcb_via_id: id + '_via',
      pcb_trace_id: id,
      x: end.x,
      y: end.y,
      outer_diameter: VIA,
      hole_diameter: DRILL,
      layers: board.num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'],
      from_layer: 'top',
      to_layer: 'bottom',
      subcircuit_id: sourceTrace.subcircuit_id,
      subcircuit_connectivity_map_key: sourceTrace.subcircuit_connectivity_map_key,
    });
    empty.audit.push({
      ref: mcu.ref,
      pad,
      netName: net.name,
      selector,
      route,
      via: end,
      diagnosticSourceTraceId: sourceTrace.source_trace_id,
      diagnosticSourcePortId: main.source_port_id,
      diagnosticPcbPortId: port.pcb_port_id,
      diagnosticSourceNetId: nativeNet.source_net_id,
      ...(application ? { kind: 'application-gpio' as const } : {}),
      ...(usb ? { kind: 'usb-signal' as const } : {}),
    });
    empty.sourceTraceWidthOverrides.push({ ref: mcu.ref, pad, widthMm: WIDTH });
    names.add(net.name);
  }
  if (options.groundOnly && (empty.audit.length !== 2 || names.size !== 1))
    throw Error('RP ground-only escapes require both canonical pins on one actual ground net');
  const outline: Point[] = board.outline ?? [
    { x: board.center.x - board.width / 2, y: board.center.y - board.height / 2 },
    { x: board.center.x + board.width / 2, y: board.center.y - board.height / 2 },
    { x: board.center.x + board.width / 2, y: board.center.y + board.height / 2 },
    { x: board.center.x - board.width / 2, y: board.center.y + board.height / 2 },
  ];
  if (outline.length < 3 || outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw Error('Unsupported RP escape board outline');
  const cross = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const signs = outline
    .map((p, i) => cross(p, outline[(i + 1) % outline.length]!, outline[(i + 2) % outline.length]!))
    .filter((v) => Math.abs(v) > EPS);
  if (!signs.length || signs.some((v) => Math.sign(v) !== Math.sign(signs[0]!)))
    throw Error('RP escape requires a convex board outline');
  const boardMargin = Math.max(0.127, board.min_board_edge_clearance ?? 0.127);
  for (const entry of empty.audit)
    for (const point of entry.route) {
      const radius = point.route_type === 'via' ? VIA / 2 : WIDTH / 2;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i]!,
          b = outline[(i + 1) % outline.length]!,
          length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!length || (Math.sign(signs[0]!) * cross(a, b, point)) / length < radius + boardMargin - EPS)
          throw Error('RP escape copper lies outside native board boundary/clearance');
      }
    }
  const clearance = Math.max(0.127, board.min_trace_to_pad_edge_clearance ?? 0.127);
  const errors = [
    ...checkEachPcbTraceNonOverlapping(checks, { minClearance: clearance }),
    ...checkPadTraceClearance(checks, { minClearance: clearance }),
    ...checkHoleTraceClearance(checks, {
      minClearance: Math.max(0.2, board.min_trace_to_hole_edge_clearance ?? 0.2),
    }),
    ...checkViaTraceClearance(checks, { minClearance: clearance }),
    ...checkViaPadClearance(checks, { minClearance: clearance }),
    ...checkViasInPads(checks),
    ...checkSameNetViaSpacing(checks),
    ...checkDifferentNetViaSpacing(checks, { minClearance: clearance }),
    ...checkViasOffBoard(checks),
    ...checkPcbTracesOutOfBoard(checks, { margin: Math.max(0.127, board.min_board_edge_clearance ?? 0.127) }),
    ...checkCopperToCutoutClearance(checks, { elementTypes: ['pcb_trace', 'pcb_via'] }),
  ];
  if (errors.length)
    throw Error('RP escape fixed profile fails native geometry: ' + errors.map((e) => e.message).join('; '));
  return {
    ...empty,
    ...(coupledUsb
      ? { scope: 'finite-rp2040-coupled-usb-power-native-escapes' as const }
      : empty.audit.some((a) => a.kind === 'application-gpio')
        ? { scope: 'finite-rp2040-power-ground-application-native-escapes' as const }
        : {}),
    netNames: [...names].sort(),
    props: {
      name: options.groundOnly
        ? 'rp2040-ground-escapes'
        : coupledUsb
          ? 'rp2040-coupled-usb-power-escapes'
          : 'rp2040-power-ground-escapes',
      phaseIndex: 1,
      autorouter: 'fanout',
      connections: empty.audit.map((a) => a.selector),
      pcbTracePaths: empty.audit.map((a) => ({ connection: a.selector, route: a.route })),
    },
  };
}
