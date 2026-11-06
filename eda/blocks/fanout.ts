import { createElement as e } from 'react';
import {
  checkPadTraceClearance,
  checkHoleTraceClearance,
  checkViaTraceClearance,
  checkEachPcbTraceNonOverlapping,
  checkPcbTracesOutOfBoard,
  checkCopperToCutoutClearance,
} from '@tscircuit/checks';

type HintAudit = {
  ref: string;
  pad: string;
  diagnosticPcbTraceId: string;
  diagnosticSourceTraceId: string;
  diagnosticPcbPortId: string;
  netName: string;
  lengthMm: number;
};
const EPS = 1e-5;
const near = (a: any, b: any) =>
  Number.isFinite(a?.x) && Number.isFinite(a?.y) && Math.hypot(a.x - b.x, a.y - b.y) < EPS;
const exactlyOne = (items: any[], label: string) => {
  if (items.length !== 1) throw new Error(`Footprint hint requires exactly one ${label}`);
  return items[0];
};

/** Only the compiler-owned four SHT40 local pcbPath exits may predate routing.
 * Native pcbPath insertion has no is_manual_route flag; source/pad identity plus
 * the exact finite footprint profile is the proof. This is not a routed-Cu bypass.
 */
function verifyFootprintHints(circuit: any[]): { traces: any[]; audit: HintAudit[] } {
  const traces = circuit.filter((i) => i.type === 'pcb_trace'),
    audit: HintAudit[] = [];
  if (!traces.length) return { traces, audit };
  if (circuit.some((i) => i.type === 'pcb_via'))
    throw new Error('Footprint hint preflight cannot contain routed vias');
  const sensors = circuit.filter(
    (i) =>
      i.type === 'source_component' &&
      i.manufacturer_part_number === 'SHT40-AD1B-R2' &&
      i.supplier_part_numbers?.jlcpcb?.includes('C2909890'),
  );
  if (!sensors.length || traces.length !== sensors.length * 4)
    throw new Error('Pre-routed footprint hints require only four exact SHT40 local traces per sensor');
  if (
    traces.some((t) => typeof t.pcb_trace_id !== 'string' || !t.pcb_trace_id) ||
    new Set(traces.map((t) => t.pcb_trace_id)).size !== traces.length
  )
    throw new Error('Footprint hint PCB trace identities must be unique');
  const seen = new Set<string>();
  for (const trace of traces) {
    const source = exactlyOne(
      circuit.filter((i) => i.type === 'source_trace' && i.source_trace_id === trace.source_trace_id),
      'hint source trace',
    );
    if (
      source.connected_source_port_ids?.length !== 1 ||
      source.connected_source_net_ids?.length !== 1 ||
      source.min_trace_thickness !== 0.15
    )
      throw new Error('Footprint hint requires one physical source port and one named net at0.15mm');
    const pin = exactlyOne(
      circuit.filter(
        (i) => i.type === 'source_port' && i.source_port_id === source.connected_source_port_ids[0],
      ),
      'hint source port',
    );
    const owner = exactlyOne(
      sensors.filter((i) => i.source_component_id === pin.source_component_id),
      'actual SHT40 owner',
    );
    const pad = String(pin.pin_number),
      labels: Record<string, string> = { '1': 'SDA', '2': 'SCL', '3': 'VDD', '4': 'VSS' };
    if (!labels[pad] || pin.name !== labels[pad] || !pin.port_hints?.includes(`pin${pad}`))
      throw new Error('Footprint hint physical SHT40 pin identity differs');
    const key = `${owner.source_component_id}.${pad}`;
    if (seen.has(key)) throw new Error('Duplicate footprint hint physical pin');
    seen.add(key);
    const component = exactlyOne(
      circuit.filter(
        (i) => i.type === 'pcb_component' && i.source_component_id === owner.source_component_id,
      ),
      'hint PCB component',
    );
    const port = exactlyOne(
      circuit.filter(
        (i) =>
          i.type === 'pcb_port' &&
          i.source_port_id === pin.source_port_id &&
          i.pcb_component_id === component.pcb_component_id,
      ),
      'hint PCB port',
    );
    const land = exactlyOne(
      circuit.filter(
        (i) =>
          i.type === 'pcb_smtpad' &&
          i.pcb_port_id === port.pcb_port_id &&
          i.pcb_component_id === component.pcb_component_id,
      ),
      'hint physical land',
    );
    const net = exactlyOne(
      circuit.filter(
        (i) => i.type === 'source_net' && i.source_net_id === source.connected_source_net_ids[0],
      ),
      'hint named net',
    );
    if (
      typeof net.name !== 'string' ||
      !net.name ||
      circuit.filter((i) => i.type === 'source_net' && i.name === net.name).length !== 1 ||
      source.subcircuit_id !== pin.subcircuit_id ||
      trace.subcircuit_id !== source.subcircuit_id ||
      port.subcircuit_id !== source.subcircuit_id ||
      !pin.subcircuit_connectivity_map_key ||
      pin.subcircuit_connectivity_map_key !== source.subcircuit_connectivity_map_key ||
      net.subcircuit_connectivity_map_key !== source.subcircuit_connectivity_map_key
    )
      throw new Error('Footprint hint source/net/subcircuit identity differs');
    if (
      component.layer !== 'top' ||
      port.layers?.length !== 1 ||
      port.layers[0] !== 'top' ||
      land.layer !== 'top' ||
      !land.port_hints?.includes(`pin${pad}`) ||
      !near(land, port)
    )
      throw new Error('Footprint hint lacks exact top-layer pad-to-port membership');
    const rotation = component.rotation,
      origin = component.footprint_origin;
    if (
      !Number.isFinite(rotation) ||
      Math.abs(rotation / 90 - Math.round(rotation / 90)) > EPS ||
      !Number.isFinite(origin?.x) ||
      !Number.isFinite(origin?.y)
    )
      throw new Error('Footprint hints require a finite cardinal native placement');
    const angle = (rotation * Math.PI) / 180;
    const world = (x: number, y: number) => ({
      x: origin.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: origin.y + x * Math.sin(angle) + y * Math.cos(angle),
    });
    const side = ['1', '2'].includes(pad) ? -1 : 1,
      y = ['1', '4'].includes(pad) ? 0.40005 : -0.40005;
    const a = world(side * 0.677418, y),
      b = world(side * 1.2, y);
    const route = trace.route;
    if (
      !Array.isArray(route) ||
      route.length !== 2 ||
      route.some((p) => p.route_type !== 'wire' || p.layer !== 'top' || p.width !== 0.15) ||
      !near(route[0], port) ||
      !near(route[0], a) ||
      !near(route[1], b) ||
      route[0].start_pcb_port_id !== port.pcb_port_id ||
      route[0].end_pcb_port_id !== undefined ||
      route[1].start_pcb_port_id !== undefined ||
      route[1].end_pcb_port_id !== undefined ||
      trace.is_antenna_trace !== false ||
      !Number.isFinite(trace.trace_length) ||
      Math.abs(trace.trace_length - 0.522582) > EPS
    )
      throw new Error('Footprint hint differs from exact native SHT40 local pcbPath geometry');
    audit.push({
      ref: owner.name,
      pad,
      diagnosticPcbTraceId: trace.pcb_trace_id,
      diagnosticSourceTraceId: source.source_trace_id,
      diagnosticPcbPortId: port.pcb_port_id,
      netName: net.name,
      lengthMm: trace.trace_length,
    });
  }
  const board = exactlyOne(
    circuit.filter((i) => i.type === 'pcb_board'),
    'hint board',
  );
  const outline = board.outline ?? [
    { x: board.center.x - board.width / 2, y: board.center.y - board.height / 2 },
    { x: board.center.x + board.width / 2, y: board.center.y - board.height / 2 },
    { x: board.center.x + board.width / 2, y: board.center.y + board.height / 2 },
    { x: board.center.x - board.width / 2, y: board.center.y + board.height / 2 },
  ];
  const inside = (p: any) => {
    let result = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i],
        b = outline[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
    }
    return result;
  };
  if (traces.some((t) => t.route.some((p: any) => !inside(p))))
    throw new Error('Footprint hint lies outside native board');
  const checks = structuredClone(circuit);
  for (const k of circuit.filter(
    (i) => i.type === 'pcb_keepout' && (i.layers ?? [i.layer]).includes('top'),
  )) {
    if (
      k.shape !== 'rect' ||
      !Number.isFinite(k.center?.x) ||
      !Number.isFinite(k.center?.y) ||
      !(k.width > 0) ||
      !(k.height > 0)
    )
      throw new Error('Unsupported top keepout for footprint hints');
    // The native trace checker honors excluded_pcb_component_ids. In particular,
    // the SHT body keepout excludes its own owner but still blocks foreign traces.
  }
  const clearance = Math.max(0.127, board.min_trace_to_pad_edge_clearance ?? 0.127);
  const errors = [
    ...checkEachPcbTraceNonOverlapping(checks, { minClearance: clearance }),
    ...checkPadTraceClearance(checks, { minClearance: clearance }),
    ...checkHoleTraceClearance(checks, {
      minClearance: Math.max(0.2, board.min_trace_to_hole_edge_clearance ?? 0.2),
    }),
    ...checkViaTraceClearance(checks, { minClearance: clearance }),
    ...checkPcbTracesOutOfBoard(checks, { margin: Math.max(0.127, board.min_board_edge_clearance ?? 0.127) }),
    ...checkCopperToCutoutClearance(checks, { elementTypes: ['pcb_trace'] }),
  ];
  if (errors.length)
    throw new Error('Footprint hints fail native geometry: ' + errors.map((e) => e.message).join('; '));
  return { traces, audit };
}

/** Exact distance between closed line segments, including intersecting interiors. */
function segmentDistance(a: any, b: any, c: any, d: any): number {
  const cross = (p: any, q: any, r: any) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const distance = (p: any, q: any, r: any) => {
    const dx = r.x - q.x,
      dy = r.y - q.y,
      t = Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - q.x - t * dx, p.y - q.y - t * dy);
  };
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b));
}

export interface NativeFanoutProposal {
  ref: string;
  pad: string;
  route: Array<{ route_type: 'wire'; x: number; y: number; layer: 'top' | 'bottom'; width: number }>;
}

/** Bind compiler-validated escapes to actual native ports. Render geometry in a
 * separate routingDisabled RootCircuit first; add this node to the final board
 * BEFORE its first render, and assign routingPhaseIndex=0 to every native net
 * named in returned netNames. Net-connected source traces are merged into SRJ
 * net connections; selecting their port traces alone does not select those nets.
 * A normal render starts routing immediately.
 * Numeric IDs below are diagnostic evidence only, never final-circuit selectors.
 * allowPreRoutedFootprintHints is a code-owned routingDisabled-preflight option
 * permitting only the verified four SHT40 pcbPath exits; it never permits a
 * previous automatic route. Existing hints remain obstacles to foreign exits.
 * The core's saved fanout stage retains each stub and routes from its outer exit
 * in the automatic default follow-up stage. It still runs native fabrication DRC.
 * topGroundPlane is an explicit compiler strategy: it verifies native top-layer
 * access and pour identity, then leaves GND to that physical plane. It does NOT
 * prove pour contact, thermal spokes, island continuity or plated barrel joins;
 * the caller must require the independent physical copper gate before acceptance.
 */
export function createNativeFanoutPhase(
  circuit: any[],
  proposals: readonly NativeFanoutProposal[],
  options: {
    topGroundPlane?: boolean;
    retainGroundExits?: boolean;
    allowPreRoutedFootprintHints?: boolean;
  } = {},
) {
  if (!Array.isArray(circuit) || !Array.isArray(proposals))
    throw new Error('Native fanout requires circuit geometry and proposals');
  if (
    options.allowPreRoutedFootprintHints !== undefined &&
    typeof options.allowPreRoutedFootprintHints !== 'boolean'
  )
    throw new Error('Invalid pre-routed footprint hints option');
  if (!options.allowPreRoutedFootprintHints && circuit.some((item) => item.type === 'pcb_trace'))
    throw new Error('Native fanout must be prepared before routing');
  const footprintHints = options.allowPreRoutedFootprintHints
    ? verifyFootprintHints(circuit)
    : { traces: [], audit: [] as HintAudit[] };
  if (options.topGroundPlane !== undefined && typeof options.topGroundPlane !== 'boolean')
    throw new Error('Invalid top ground plane option');
  if (options.retainGroundExits !== undefined && typeof options.retainGroundExits !== 'boolean')
    throw new Error('Invalid retained ground exits option');
  if (options.retainGroundExits && !options.topGroundPlane)
    throw new Error('Retained ground exits require topGroundPlane');
  let groundNet: any;
  let groundPlane: {
    netName: 'GND';
    layer: 'top';
    diagnosticSourceNetId: string;
    diagnosticPourIds: string[];
    diagnosticSourcePortIds: string[];
    retainedExitCount: number;
    requiresPhysicalContinuityGate: true;
  } | null = null;
  if (options.topGroundPlane) {
    const nets = circuit.filter((item) => item.type === 'source_net' && item.name === 'GND');
    if (nets.length !== 1 || nets[0].is_ground !== true)
      throw new Error('Top ground plane requires one actual native ground net named GND');
    groundNet = nets[0];
    const pours = circuit.filter(
      (item) =>
        item.type === 'pcb_copper_pour' &&
        item.layer === 'top' &&
        item.source_net_id === groundNet.source_net_id &&
        item.shape === 'brep' &&
        item.brep_shape?.outer_ring?.vertices?.length >= 3,
    );
    if (!pours.length)
      throw new Error('Top ground plane requires actual nonempty native top GND pour geometry');
    const directPortIds = new Set(
      circuit
        .filter(
          (item) =>
            item.type === 'source_trace' && item.connected_source_net_ids?.includes(groundNet.source_net_id),
        )
        .flatMap((item) => item.connected_source_port_ids ?? []),
    );
    const groundPorts = circuit.filter(
      (item) =>
        item.type === 'source_port' &&
        (directPortIds.has(item.source_port_id) ||
          (groundNet.subcircuit_connectivity_map_key &&
            item.subcircuit_connectivity_map_key === groundNet.subcircuit_connectivity_map_key &&
            item.subcircuit_id === groundNet.subcircuit_id)),
    );
    if (!groundPorts.length) throw new Error('Top ground plane has no actual native ground ports');
    for (const source of groundPorts) {
      const ports = circuit.filter(
        (item) => item.type === 'pcb_port' && item.source_port_id === source.source_port_id,
      );
      if (
        !ports.length ||
        ports.some(
          (port) =>
            !port.layers?.includes('top') ||
            !circuit.some(
              (pad) =>
                ['pcb_smtpad', 'pcb_plated_hole'].includes(pad.type) &&
                pad.pcb_port_id === port.pcb_port_id &&
                pad.pcb_component_id === port.pcb_component_id,
            ),
        )
      )
        throw new Error(`Ground port ${source.source_port_id} lacks actual top-accessible pad copper`);
    }
    groundPlane = {
      netName: 'GND',
      layer: 'top',
      diagnosticSourceNetId: groundNet.source_net_id,
      diagnosticPourIds: pours.map((item) => item.pcb_copper_pour_id),
      diagnosticSourcePortIds: groundPorts.map((item) => item.source_port_id),
      retainedExitCount: 0,
      requiresPhysicalContinuityGate: true,
    };
  }
  const paths: Array<{ connection: string; route: NativeFanoutProposal['route'] }> = [];
  const audit: Array<{
    ref: string;
    pad: string;
    selector: string;
    netNames: string[];
    diagnosticSourcePortId: string;
    diagnosticPcbPortId: string;
    widthMm: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
    reason?: 'top-ground-plane-requires-physical-continuity';
  }> = [];
  const omittedGround: Array<{
    ref: string;
    pad: string;
    selector: string;
    netNames: string[];
    diagnosticSourcePortId: string;
    diagnosticPcbPortId: string;
    reason: 'top-ground-plane-requires-physical-continuity';
  }> = [];
  const retainedGround: typeof audit = [];
  const selectedNetNames = new Set<string>();
  const used = new Set<string>();
  for (const proposal of proposals) {
    if (!proposal || !/^[A-Za-z][A-Za-z0-9_]*$/.test(proposal.ref) || !/^[1-9]\d*$/.test(proposal.pad))
      throw new Error('Invalid native fanout reference or physical pad');
    const key = `${proposal.ref}.${proposal.pad}`;
    if (used.has(key)) throw new Error(`Duplicate native fanout proposal ${key}`);
    used.add(key);
    const components = circuit.filter(
      (item) => item.type === 'source_component' && item.name === proposal.ref,
    );
    if (components.length !== 1) throw new Error(`Fanout ${key} must resolve exactly one native component`);
    const pinAlias = `pin${proposal.pad}`;
    const sources = circuit.filter(
      (item) =>
        item.type === 'source_port' &&
        item.source_component_id === components[0].source_component_id &&
        String(item.pin_number) === proposal.pad &&
        item.port_hints?.includes(pinAlias),
    );
    if (sources.length !== 1)
      throw new Error(`Fanout ${key} must resolve one verified native physical pin and selector alias`);
    const source = sources[0];
    const traces = circuit.filter(
      (item) =>
        item.type === 'source_trace' && item.connected_source_port_ids?.includes(source.source_port_id),
    );
    const directNetIds = new Set(traces.flatMap((item) => item.connected_source_net_ids ?? []));
    const nets = circuit.filter(
      (item) =>
        item.type === 'source_net' &&
        (directNetIds.has(item.source_net_id) ||
          (source.subcircuit_connectivity_map_key &&
            item.subcircuit_connectivity_map_key === source.subcircuit_connectivity_map_key &&
            item.subcircuit_id === source.subcircuit_id)),
    );
    if (!nets.length || nets.some((item) => typeof item.name !== 'string' || !item.name.length))
      throw new Error(`Fanout ${key} must resolve actual native net membership`);
    const netNames: string[] = [...new Set(nets.map((item) => item.name as string))].sort();
    const ports = circuit.filter(
      (item) => item.type === 'pcb_port' && item.source_port_id === sources[0].source_port_id,
    );
    if (ports.length !== 1) throw new Error(`Fanout ${key} must resolve exactly one actual PCB port`);
    const port = ports[0];
    const pcbComponents = circuit.filter(
      (item) =>
        item.type === 'pcb_component' &&
        item.pcb_component_id === port.pcb_component_id &&
        item.source_component_id === components[0].source_component_id,
    );
    const pads = circuit.filter(
      (item) =>
        ['pcb_smtpad', 'pcb_plated_hole'].includes(item.type) &&
        item.pcb_port_id === port.pcb_port_id &&
        item.pcb_component_id === port.pcb_component_id &&
        item.port_hints?.includes(pinAlias),
    );
    if (pcbComponents.length !== 1 || pads.length === 0)
      throw new Error(`Fanout ${key} lacks actual pad-to-port membership`);
    if (!Array.isArray(proposal.route) || proposal.route.length !== 2)
      throw new Error(`Fanout ${key} requires one straight two-point exit`);
    const route = proposal.route.map((point: NativeFanoutProposal['route'][number]) => {
      if (
        point.route_type !== 'wire' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.width) ||
        point.width <= 0 ||
        !['top', 'bottom'].includes(point.layer)
      )
        throw new Error(`Invalid native fanout geometry ${key}`);
      return { route_type: 'wire' as const, x: point.x, y: point.y, layer: point.layer, width: point.width };
    });
    const start = route[0]!,
      end = route[1]!;
    if (
      start.layer !== end.layer ||
      start.width !== end.width ||
      !port.layers?.includes(start.layer) ||
      Math.hypot(start.x - port.x, start.y - port.y) > 1e-4 ||
      !Number.isFinite(port.x) ||
      !Number.isFinite(port.y)
    )
      throw new Error(
        `Fanout ${key} must start at its actual native port with constant width on an available layer`,
      );
    if (
      Math.hypot(end.x - start.x, end.y - start.y) <= 1e-4 ||
      (Math.abs(end.x - start.x) > 1e-6 && Math.abs(end.y - start.y) > 1e-6)
    )
      throw new Error(`Fanout ${key} must be a nonzero axis-aligned exit`);
    for (const hint of footprintHints.traces) {
      const proof = footprintHints.audit.find((a) => a.diagnosticPcbTraceId === hint.pcb_trace_id)!;
      if (hint.route[0].layer !== start.layer || netNames.includes(proof.netName)) continue;
      const clearance = Math.max(
        0.127,
        circuit.find((i) => i.type === 'pcb_board')?.min_trace_to_pad_edge_clearance ?? 0.127,
      );
      if (
        segmentDistance(start, end, hint.route[0], hint.route[1]) <
        clearance + (start.width + hint.route[0].width) / 2 - EPS
      )
        throw new Error(`Fanout ${key} violates retained footprint hint clearance`);
    }
    const selector = `.${proposal.ref} > .${pinAlias}`;
    const isPlaneGround = groundPlane && nets.some((net) => net.source_net_id === groundNet.source_net_id);
    if (isPlaneGround) {
      if (netNames.some((name) => name !== 'GND'))
        throw new Error(`Fanout ${key} has ambiguous ground net aliases`);
      if (!options.retainGroundExits) {
        omittedGround.push({
          ref: proposal.ref,
          pad: proposal.pad,
          selector,
          netNames,
          diagnosticSourcePortId: source.source_port_id,
          diagnosticPcbPortId: port.pcb_port_id,
          reason: 'top-ground-plane-requires-physical-continuity',
        });
        continue;
      }
    }
    if (!isPlaneGround) for (const name of netNames) selectedNetNames.add(name);
    paths.push({ connection: selector, route });
    const entry = {
      ref: proposal.ref,
      pad: proposal.pad,
      selector,
      netNames,
      diagnosticSourcePortId: sources[0].source_port_id,
      diagnosticPcbPortId: port.pcb_port_id,
      widthMm: start.width,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      ...(isPlaneGround ? { reason: 'top-ground-plane-requires-physical-continuity' as const } : {}),
    };
    audit.push(entry);
    if (isPlaneGround) retainedGround.push(entry);
  }
  if (groundPlane) groundPlane.retainedExitCount = retainedGround.length;
  const netNames = [...selectedNetNames].sort();
  if (!paths.length && !groundPlane)
    return {
      node: null,
      props: null,
      audit,
      netNames,
      omittedGround,
      retainedGround,
      groundPlane,
      preRoutedFootprintHints: footprintHints.audit,
    };
  const props = {
    name: 'compiler-pad-exits',
    phaseIndex: 0,
    autorouter: 'fanout',
    fanoutPourNetMap: groundPlane ? { top: 'GND' } : {},
    connections: paths.map((path) => path.connection),
    pcbTracePaths: paths,
  };
  return {
    node: e('autoroutingphase', props),
    props,
    audit,
    netNames,
    omittedGround,
    retainedGround,
    groundPlane,
    preRoutedFootprintHints: footprintHints.audit,
  };
}
