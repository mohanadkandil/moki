/** Proof-only completion of native saved fanout source IDs. No geometry, source
 * netlist or diagnostics are changed. Call before copper pours and retain every
 * native physical/placement/source/DRC gate after attribution. */
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import type { PlanGraph } from '../../src/blocks/graph.js';

export type NativeExitRoutePoint =
  | { route_type: 'wire'; x: number; y: number; width: number; layer: string }
  | {
      route_type: 'via';
      x: number;
      y: number;
      from_layer: string;
      to_layer: string;
      via_diameter: number;
      via_hole_diameter: number;
    };
export interface NativeExitPhaseEvidence {
  props: { phaseIndex: number; pcbTracePaths: Array<{ connection: string; route: NativeExitRoutePoint[] }> };
  audit: Array<{
    ref: string;
    pad: string;
    netName: string;
    route: NativeExitRoutePoint[];
    diagnosticSourceTraceId?: string;
  }>;
}
export interface NativeExitSourceRepair {
  pcbTraceId: string;
  ref: string;
  pad: string;
  sourceTraceId: string;
  sourceNetId: string;
  netName: string;
  kind: 'saved-prefix' | 'saved-exit-join';
}
export interface NativeExitProofOptions {
  nativeRoutingInputs?: readonly any[];
  /** INTERNAL compiler option only. The caller must independently gate every
   * physical net (including drilled copper) and every actual trace's width.
   * Canonical native joins may merge into other same-net copper while keeping
   * their original pair labels; this never authorizes a missing source ID. */
  existingJoinGeometry?: 'defer-to-physical-network-oracle';
}
const one = <T>(items: T[], label: string): T => {
  if (items.length !== 1) throw Error(`Native exit source proof requires exactly one ${label}`);
  return items[0]!;
};
const blank = (v: unknown) => v === undefined || v === null || v === '';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (p: any) => finite(p?.x) && finite(p?.y);
const distance = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
// Representation tolerance for native port bindings only, never saved geometry/DRC.
const samePortPoint = (a: any, b: any) => point(a) && point(b) && distance(a, b) <= 1e-7;
type PadHandoff = { portId: string; endpoint: any; land: any };
const wireCapInsideLand = (p: any, land: any) => {
  if (
    p.route_type !== 'wire' ||
    !point(p) ||
    !finite(p.width) ||
    p.width <= 0 ||
    land.type !== 'pcb_smtpad' ||
    !['rect', 'rotated_rect'].includes(land.shape) ||
    land.layer !== p.layer ||
    !point(land) ||
    !finite(land.width) ||
    !finite(land.height) ||
    land.width <= 0 ||
    land.height <= 0
  )
    return false;
  const rotation = land.shape === 'rotated_rect' ? land.ccw_rotation : 0;
  if (!finite(rotation)) return false;
  const angle = (-rotation * Math.PI) / 180,
    dx = p.x - land.x,
    dy = p.y - land.y;
  return (
    Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) + p.width / 2 <= land.width / 2 &&
    Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) + p.width / 2 <= land.height / 2
  );
};
const atHandoff = (p: any, handoff: PadHandoff) =>
  p.route_type === 'wire' &&
  p.x === handoff.endpoint.x &&
  p.y === handoff.endpoint.y &&
  p.layer === handoff.endpoint.layer;

const geometry = (p: any) =>
  p.route_type === 'wire'
    ? [p.route_type, p.x, p.y, p.layer, p.width]
    : [p.route_type, p.x, p.y, p.from_layer, p.to_layer, p.via_diameter, p.via_hole_diameter];
const sameRoute = (a: any[], b: any[]) =>
  Array.isArray(a) &&
  a.length === b.length &&
  a.every((p, i) => JSON.stringify(geometry(p)) === JSON.stringify(geometry(b[i])));

/** Matches installed native getSavedAutoroutingPhaseTracesFromPaths, including
 * its two coincident bottom contact wires for a terminal via. */
function expanded(route: NativeExitRoutePoint[]) {
  if (!Array.isArray(route) || route.length < 2) throw Error('Native exit audit has no literal path');
  const first = route[0]!,
    last = route.at(-1)!;
  if (first.route_type !== 'wire' || first.layer !== 'top' || !finite(first.width) || first.width <= 0)
    throw Error('Native exit must begin with finite top pad wire');
  const wires = last.route_type === 'via' ? route.slice(0, -1) : route;
  if (
    wires.length < 2 ||
    wires.some((p) => p.route_type !== 'wire' || !point(p) || p.layer !== 'top' || p.width !== first.width)
  )
    throw Error('Unsupported native exit literal wire geometry');
  if (last.route_type === 'wire') {
    if (route.length !== 2 || distance(first, last) <= 1e-6)
      throw Error('Native straight exit must have two distinct points');
    return structuredClone(route);
  }
  if (
    !point(last) ||
    last.from_layer !== 'top' ||
    last.to_layer !== 'bottom' ||
    last.via_diameter !== 0.6 ||
    last.via_hole_diameter !== 0.3 ||
    distance(last, wires.at(-1)) > 1e-8 ||
    distance(first, last) <= 0.3
  )
    throw Error('Unsupported native exit terminal via geometry');
  return [
    ...structuredClone(wires),
    { route_type: 'wire', x: last.x, y: last.y, width: first.width, layer: 'top' },
    structuredClone(last),
    ...Array.from({ length: 2 }, () => ({
      route_type: 'wire',
      x: last.x,
      y: last.y,
      width: first.width,
      layer: 'bottom',
    })),
  ];
}

export function repairNativeExits(
  circuit: any[],
  graph: PlanGraph,
  mapping: Record<string, Record<string, string>>,
  phases: readonly NativeExitPhaseEvidence[],
  options: NativeExitProofOptions = {},
) {
  if (!Array.isArray(circuit) || !Array.isArray(phases) || !phases.length)
    throw Error('Native exit source proof requires circuit and phase evidence');
  if (
    options.existingJoinGeometry !== undefined &&
    options.existingJoinGeometry !== 'defer-to-physical-network-oracle'
  )
    throw Error('Unsupported existing native join geometry policy');
  const problems = nativeNetlistIssues(graph, circuit, mapping);
  if (problems.length)
    throw Error('Native exit source graph differs: ' + problems.map((p) => p.message).join('; '));
  const output = structuredClone(circuit),
    audit: NativeExitSourceRepair[] = [],
    deferredExistingTraceIds: string[] = [],
    viaAudit: Array<{ pcbViaId: string; connectivityKey: string }> = [];
  const board = one(
    output.filter((e) => e.type === 'pcb_board'),
    'native board',
  );
  if (![2, 4].includes(board.num_layers))
    throw Error('Native exit proof supports only two/four physical layers');
  const layers = board.num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'];
  const traces = output.filter((e) => e.type === 'pcb_trace');
  for (const [key, entries] of [
    ['pcb_trace_id', traces],
    ['pcb_via_id', output.filter((e) => e.type === 'pcb_via')],
  ] as const)
    if (
      entries.some((e) => typeof e[key] !== 'string' || !e[key]) ||
      new Set(entries.map((e) => e[key])).size !== entries.length
    )
      throw Error('Native exit proof requires unique trace/via identities');
  const phaseIds = phases.map((p) => p?.props?.phaseIndex);
  if (phaseIds.some((p) => !Number.isSafeInteger(p) || p! < 0) || new Set(phaseIds).size !== phaseIds.length)
    throw Error('Native exit phase indices must be unique finite integers');
  const proven = new Map<
    string,
    {
      trace: any;
      source: any;
      net: any;
      ref: string;
      pad: string;
      width: number;
      via?: any;
      end: any;
      graphNet: PlanGraph['nets'][number];
      handoff?: PadHandoff;
    }
  >();
  const verifyVia = (trace: any, p: any, key: string) => {
    if (
      !point(p) ||
      p.via_diameter !== 0.6 ||
      p.via_hole_diameter !== 0.3 ||
      !layers.includes(p.from_layer) ||
      !layers.includes(p.to_layer) ||
      p.from_layer === p.to_layer
    )
      throw Error('Native exit proof has unsupported route via');
    const owned = output.filter(
      (e) => e.type === 'pcb_via' && e.pcb_trace_id === trace.pcb_trace_id && e.x === p.x && e.y === p.y,
    );
    // Core deduplicates same-net physical holes across output traces. A global
    // owner is admissible only with canonical compiler identity, captured native
    // endpoint IDs, and its own exact literal via plus real annular approaches.
    const registeredGlobalOwner = (via: any) => {
      const owners = traces.filter((t) => t.pcb_trace_id === via.pcb_trace_id);
      if (owners.length !== 1) return false;
      const owner = owners[0]!;
      if (!/^source_net_\d+_mst\d+_\d+$/.test(owner.pcb_trace_id) || blank(owner.source_trace_id))
        return false;
      const sources = output.filter(
        (e) => e.type === 'source_trace' && e.source_trace_id === owner.source_trace_id,
      );
      if (sources.length !== 1) return false;
      const source = sources[0]!,
        nets = output.filter((e) => e.type === 'source_net' && e.source_net_id === owner.connection_name);
      if (nets.length !== 1) return false;
      const net = nets[0]!;
      if (
        source.subcircuit_connectivity_map_key !== key ||
        net.subcircuit_connectivity_map_key !== key ||
        via.subcircuit_connectivity_map_key !== key ||
        source.subcircuit_id !== trace.subcircuit_id ||
        owner.subcircuit_id !== source.subcircuit_id ||
        via.subcircuit_id !== source.subcircuit_id ||
        net.subcircuit_id !== source.subcircuit_id ||
        !source.connected_source_net_ids?.includes(net.source_net_id) ||
        !owner.pcb_trace_id.startsWith(net.source_net_id + '_mst') ||
        (!blank(owner.source_net_id) && owner.source_net_id !== net.source_net_id) ||
        !Array.isArray(owner.connectsTo) ||
        owner.connectsTo.length !== 2 ||
        new Set(owner.connectsTo).size !== 2
      )
        return false;
      const captures = (Array.isArray(options.nativeRoutingInputs) ? options.nativeRoutingInputs : [])
        .filter((r) => ['AutoroutingPipelineSolver9_PreloadedTraceGraph', 'AutoroutingPipelineSolver7_MultiGraph'].includes(r?.solver))
        .flatMap((r) => (r.input?.input ?? r.input)?.connections ?? [])
        .filter(
          (c) =>
            c.name === net.source_net_id &&
            Array.isArray(c.pointsToConnect) &&
            owner.connectsTo.every(
              (id: string) => c.pointsToConnect.filter((q: any) => q.pointId === id).length === 1,
            ),
        );
      if (captures.length !== 1 || !finite(captures[0].nominalTraceWidth)) return false;
      const matches = owner.route.flatMap((q: any, i: number) =>
        q.route_type === 'via' && q.x === via.x && q.y === via.y ? [i] : [],
      );
      if (matches.length !== 1) return false;
      const index = matches[0]!,
        q = owner.route[index],
        before = owner.route[index - 1],
        after = owner.route[index + 1];
      if (
        q.via_diameter !== 0.6 ||
        q.via_hole_diameter !== 0.3 ||
        q.from_layer !== via.from_layer ||
        q.to_layer !== via.to_layer ||
        before?.route_type !== 'wire' ||
        after?.route_type !== 'wire' ||
        before.x !== via.x ||
        before.y !== via.y ||
        after.x !== via.x ||
        after.y !== via.y ||
        before.layer === after.layer ||
        !layers.includes(before.layer) ||
        !layers.includes(after.layer)
      )
        return false;
      for (const direction of [-1, 1]) {
        const layer = owner.route[index + direction].layer;
        let previous = owner.route[index + direction],
          contact = false;
        for (let i = index + direction; i >= 0 && i < owner.route.length; i += direction) {
          const wire = owner.route[i];
          if (
            wire.route_type !== 'wire' ||
            wire.layer !== layer ||
            !point(wire) ||
            !finite(wire.width) ||
            wire.width < (board.min_trace_width ?? 0.15) ||
            wire.width > captures[0].nominalTraceWidth
          )
            break;
          if (
            Math.max(distance(previous, via), distance(wire, via)) +
              Math.min(previous.width, wire.width) / 2 >
            via.hole_diameter / 2 + 1e-7
          ) {
            contact = true;
            break;
          }
          previous = wire;
        }
        if (!contact) return false;
      }
      return true;
    };
    const shared = owned.length
      ? []
      : [
          ...new Map(
            [
              ...[...proven.values()]
                .filter(
                  (e) =>
                    e.via &&
                    e.source.subcircuit_connectivity_map_key === key &&
                    e.via.x === p.x &&
                    e.via.y === p.y,
                )
                .map((e) => e.via),
              ...output.filter(
                (e) => e.type === 'pcb_via' && e.x === p.x && e.y === p.y && registeredGlobalOwner(e),
              ),
            ].map((v) => [v.pcb_via_id, v]),
          ).values(),
        ];
    const via = one(owned.length ? owned : shared, 'physical barrel for ' + key);
    const directionMatches =
      shared.length > 0 || (via.from_layer === p.from_layer && via.to_layer === p.to_layer);
    if (
      via.outer_diameter !== 0.6 ||
      via.hole_diameter !== 0.3 ||
      !directionMatches ||
      JSON.stringify(via.layers) !== JSON.stringify(layers) ||
      via.subcircuit_id !== trace.subcircuit_id ||
      (!blank(via.subcircuit_connectivity_map_key) && via.subcircuit_connectivity_map_key !== key)
    )
      throw Error('Native exit actual barrel dimensions/span/source differ');
    if (blank(via.subcircuit_connectivity_map_key)) {
      via.subcircuit_connectivity_map_key = key;
      viaAudit.push({ pcbViaId: via.pcb_via_id, connectivityKey: key });
    }
    return via;
  };
  const checkOwnedBarrels = (trace: any, verified: any[]) => {
    const expected = new Set(
      verified.filter((v) => v.pcb_trace_id === trace.pcb_trace_id).map((v) => v.pcb_via_id),
    );
    const owned = output.filter((e) => e.type === 'pcb_via' && e.pcb_trace_id === trace.pcb_trace_id);
    if (owned.length !== expected.size || owned.some((v) => !expected.has(v.pcb_via_id)))
      throw Error('Native exit has unexpected physical barrels');
  };
  const physicalMarker = (
    id: unknown,
    p: any,
    net: PlanGraph['nets'][number],
    handoffs: readonly PadHandoff[] = [],
  ) => {
    const port = one(
      output.filter((e) => e.type === 'pcb_port' && e.pcb_port_id === id),
      'marked physical PCB port',
    );
    const atExit = handoffs.filter((h) => atHandoff(p, h));
    if (atExit.length && (atExit.length !== 1 || atExit[0]!.portId !== id))
      throw Error('Native exit handoff marker differs from canonical own pad');
    const contained =
      atExit.length === 1 && atExit[0]!.portId === id && wireCapInsideLand(p, atExit[0]!.land);
    if ((!samePortPoint(port, p) && !contained) || !port.layers?.includes(p.layer))
      throw Error('Native exit port marker differs from actual endpoint coordinates/layer');
    const sp = one(
      output.filter((e) => e.type === 'source_port' && e.source_port_id === port.source_port_id),
      'marked source port',
    );
    const owners = net.pins.filter((pin) => {
      const part = one(
        graph.parts.filter((p) => p.ref === pin.ref),
        'marked graph owner',
      );
      const source = one(
        output.filter((e) => e.type === 'source_component' && e.name === pin.ref),
        'marked source owner',
      );
      if (source.source_component_id !== sp.source_component_id) return false;
      const native = mapping[pin.ref]?.[pin.pad];
      if (!native) throw Error('Native exit marker missing actual pin mapping');
      const names = Object.values(part.part.pins).map((p) => {
        const n = mapping[pin.ref]?.[p.pad];
        if (!n) throw Error('Native exit marker missing native mapping');
        return n;
      });
      const optional = new Set(
        (part.part.omitPads ?? []).map((p) => mapping[pin.ref]?.[p]).filter((n): n is string => Boolean(n)),
      );
      const resolved = nativeComponentPorts(output, source, [...names, ...optional], optional);
      return (
        (resolved.byNative.get(native) ?? []).some((p) => p.source_port_id === sp.source_port_id) &&
        output.some(
          (e) =>
            e.type === 'pcb_component' &&
            e.source_component_id === source.source_component_id &&
            e.pcb_component_id === port.pcb_component_id,
        ) &&
        output.some(
          (e) =>
            ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type) &&
            e.pcb_port_id === port.pcb_port_id &&
            e.pcb_component_id === port.pcb_component_id,
        )
      );
    });
    if (owners.length !== 1) throw Error('Native exit marker conflicts with proved physical source net');
  };
  const checkMarkers = (
    trace: any,
    net: PlanGraph['nets'][number],
    startId?: string,
    handoffs: readonly PadHandoff[] = [],
  ) => {
    for (const [i, p] of trace.route.entries()) {
      if (p.start_pcb_port_id !== undefined) {
        if (i !== 0 || p.route_type !== 'wire')
          throw Error('Native exit unexpected interior start port marker');
        if (startId !== undefined && p.start_pcb_port_id !== startId)
          throw Error('Native exit wrong canonical start marker');
        physicalMarker(p.start_pcb_port_id, p, net, startId === undefined ? handoffs : []);
      }
      if (p.end_pcb_port_id !== undefined) {
        if (i !== trace.route.length - 1 || p.route_type !== 'wire')
          throw Error('Native exit unexpected interior end port marker');
        physicalMarker(p.end_pcb_port_id, p, net, handoffs);
      }
    }
  };
  for (const phase of phases) {
    if (
      !Array.isArray(phase.props.pcbTracePaths) ||
      !Array.isArray(phase.audit) ||
      phase.audit.length !== phase.props.pcbTracePaths.length
    )
      throw Error('Native exit phase requires complete unique path audit');
    const used = new Set<string>();
    for (const [index, path] of phase.props.pcbTracePaths.entries()) {
      const selector = /^\.([A-Za-z][A-Za-z0-9_]*) > \.pin([1-9]\d*)$/.exec(path.connection);
      if (!selector || used.has(path.connection))
        throw Error('Native exit requires unique physical selector');
      used.add(path.connection);
      const ref = selector[1]!,
        pad = selector[2]!;
      const proof = one<NativeExitPhaseEvidence['audit'][number]>(
        phase.audit.filter((a: NativeExitPhaseEvidence['audit'][number]) => a.ref === ref && a.pad === pad),
        'compiler physical audit',
      );
      if (!sameRoute(proof.route, path.route)) throw Error('Native exit literal path and audit differ');
      const expected = expanded(path.route);
      const trace = one(
        traces.filter((t) => {
          const id = /^saved_phase_(.+)_(\d+)_(\d+)$/.exec(t.pcb_trace_id);
          return id && Number(id[2]) === phase.props.phaseIndex && Number(id[3]) === index;
        }),
        'actual native saved prefix',
      );
      if (!sameRoute(trace.route, expected)) throw Error('Native exit serialized prefix geometry differs');
      const part = one(
        graph.parts.filter((p) => p.ref === ref),
        'physical graph component',
      );
      const logical = one(
        Object.entries(part.part.pins).filter(([, p]) => p.pad === pad),
        'logical physical pad',
      );
      const graphNet = one(
        graph.nets.filter((n) =>
          n.pins.some((p) => p.ref === ref && p.pad === pad && p.logical === logical[0]),
        ),
        'physical graph net',
      );
      if (proof.netName !== graphNet.name) throw Error('Native exit compiler audit net differs');
      const component = one(
        output.filter((e) => e.type === 'source_component' && e.name === ref),
        'source component',
      );
      const natives = Object.values(part.part.pins).map((p) => {
        const n = mapping[ref]?.[p.pad];
        if (!n) throw Error('Native exit missing physical import mapping');
        return n;
      });
      const optional = new Set(
        (part.part.omitPads ?? []).map((p) => mapping[ref]?.[p]).filter((n): n is string => Boolean(n)),
      );
      const resolved = nativeComponentPorts(output, component, [...natives, ...optional], optional);
      const native = mapping[ref]![pad]!;
      const sp = one(
        (resolved.byNative.get(native) ?? []).filter(
          (p) => p.name === native || p.port_hints?.includes(native),
        ),
        'canonical physical source port',
      );
      const pcb = one(
        output.filter(
          (e) => e.type === 'pcb_component' && e.source_component_id === component.source_component_id,
        ),
        'actual PCB owner',
      );
      const port = one(
        output.filter(
          (e) =>
            e.type === 'pcb_port' &&
            e.pcb_component_id === pcb.pcb_component_id &&
            e.source_port_id === sp.source_port_id,
        ),
        'canonical actual PCB port',
      );
      const start = trace.route[0];
      if (
        pcb.layer !== 'top' ||
        !output.some(
          (e) =>
            ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type) &&
            e.pcb_component_id === pcb.pcb_component_id &&
            e.pcb_port_id === port.pcb_port_id &&
            (e.port_hints?.includes(native) ||
              (native === `pin${pad}` &&
                sp.pin_number === Number(pad) &&
                sp.port_hints?.includes(native) &&
                e.port_hints?.includes(pad))),
        ) ||
        !samePortPoint(port, start) ||
        !port.layers?.includes(start.layer) ||
        (start.start_pcb_port_id !== undefined && start.start_pcb_port_id !== port.pcb_port_id)
      )
        throw Error('Native exit lacks exact actual physical pad/port start');
      const net = one(
        output.filter((e) => e.type === 'source_net' && e.name === graphNet.name),
        'named native source net',
      );
      const source = one(
        output.filter(
          (e) =>
            e.type === 'source_trace' &&
            e.connected_source_port_ids?.length === 1 &&
            e.connected_source_port_ids[0] === sp.source_port_id &&
            e.connected_source_net_ids?.length === 1 &&
            e.connected_source_net_ids[0] === net.source_net_id,
        ),
        'canonical one-port-to-net source trace',
      );
      if (
        trace.connection_name !== net.source_net_id ||
        trace.subcircuit_id !== source.subcircuit_id ||
        port.subcircuit_id !== source.subcircuit_id ||
        source.subcircuit_connectivity_map_key !== sp.subcircuit_connectivity_map_key ||
        source.subcircuit_connectivity_map_key !== net.subcircuit_connectivity_map_key ||
        !source.subcircuit_connectivity_map_key ||
        (proof.diagnosticSourceTraceId !== undefined &&
          proof.diagnosticSourceTraceId !== source.source_trace_id) ||
        (!blank(trace.source_trace_id) && trace.source_trace_id !== source.source_trace_id) ||
        (!blank(trace.source_net_id) && trace.source_net_id !== net.source_net_id)
      )
        throw Error('Native exit source/net/subcircuit metadata conflict');
      // A native DRC marker can name the same physical pad at a literal
      // handoff point inside its copper rather than at the port center. Derive
      // this exception from actual rectangular land geometry, never a flag.
      const handoffLand =
        trace.route.length === 2 && trace.route.every((p: any) => p.route_type === 'wire')
          ? output.find(
              (e) =>
                e.type === 'pcb_smtpad' &&
                e.pcb_component_id === pcb.pcb_component_id &&
                e.pcb_port_id === port.pcb_port_id &&
                wireCapInsideLand(trace.route[0], e) &&
                wireCapInsideLand(trace.route[1], e),
            )
          : undefined;
      const handoff: PadHandoff | undefined = handoffLand
        ? { portId: port.pcb_port_id, endpoint: trace.route[1], land: handoffLand }
        : undefined;
      checkMarkers(trace, graphNet, port.pcb_port_id, handoff ? [handoff] : []);
      const last = path.route.at(-1)!;
      const via =
        last.route_type === 'via'
          ? verifyVia(trace, last, source.subcircuit_connectivity_map_key)
          : undefined;
      checkOwnedBarrels(trace, via ? [via] : []);
      proven.set(trace.pcb_trace_id, {
        trace,
        source,
        net,
        ref,
        pad,
        width: start.width,
        via,
        end: trace.route.at(-1),
        graphNet,
        handoff,
      });
      if (blank(trace.source_trace_id)) {
        trace.source_trace_id = source.source_trace_id;
        trace.source_net_id = net.source_net_id;
        audit.push({
          pcbTraceId: trace.pcb_trace_id,
          ref,
          pad,
          sourceTraceId: source.source_trace_id,
          sourceNetId: net.source_net_id,
          netName: net.name,
          kind: 'saved-prefix',
        });
      }
    }
  }
  if (options.nativeRoutingInputs !== undefined && !Array.isArray(options.nativeRoutingInputs))
    throw Error('Native exit proof requires captured routing inputs');
  for (const trace of traces.filter((t) => /^source_net_\d+_mst\d+_\d+$/.test(t.pcb_trace_id))) {
    if (
      !Array.isArray(trace.connectsTo) ||
      trace.connectsTo.length !== 2 ||
      new Set(trace.connectsTo).size !== 2 ||
      trace.connectsTo.some((id: unknown) => typeof id !== 'string' || !id.endsWith('_exit'))
    )
      continue;
    const exits = trace.connectsTo.map((id: string) => proven.get(id.slice(0, -5)));
    if (exits.some((e: unknown) => !e)) continue;
    const [left, right] = exits as [
      NonNullable<ReturnType<typeof proven.get>>,
      NonNullable<ReturnType<typeof proven.get>>,
    ];
    if (
      left.net.source_net_id !== right.net.source_net_id ||
      trace.connection_name !== left.net.source_net_id ||
      !trace.pcb_trace_id.startsWith(left.net.source_net_id + '_mst') ||
      trace.subcircuit_id !== left.source.subcircuit_id ||
      trace.subcircuit_id !== right.source.subcircuit_id ||
      (!blank(trace.source_net_id) && trace.source_net_id !== left.net.source_net_id)
    )
      throw Error('Native saved join conflicts with audited physical source net');
    if (!blank(trace.source_trace_id)) {
      const existing = one(
        output.filter((e) => e.type === 'source_trace' && e.source_trace_id === trace.source_trace_id),
        'existing native join source',
      );
      if (
        existing.subcircuit_id !== left.source.subcircuit_id ||
        existing.subcircuit_connectivity_map_key !== left.source.subcircuit_connectivity_map_key ||
        !existing.connected_source_net_ids?.includes(left.net.source_net_id)
      )
        throw Error('Native saved join existing source metadata conflicts');
      if (options.existingJoinGeometry === 'defer-to-physical-network-oracle') {
        // Existing compiler-owned source identity and declared prefix/net
        // ownership were checked above. Defer only the obsolete pair geometry,
        // never source attribution; the caller's actual all-net Cu and width
        // gates are mandatory before acceptance, independently of these IDs.
        deferredExistingTraceIds.push(trace.pcb_trace_id);
        continue;
      }
    }
    const candidates = (options.nativeRoutingInputs ?? [])
      .filter((r) => ['AutoroutingPipelineSolver9_PreloadedTraceGraph', 'AutoroutingPipelineSolver7_MultiGraph'].includes(r?.solver))
      .flatMap((r) => (r.input?.input ?? r.input)?.connections ?? [])
      .filter(
        (c) =>
          c.name === left.net.source_net_id &&
          Array.isArray(c.pointsToConnect) &&
          trace.connectsTo.every((id: string) => c.pointsToConnect.some((p: any) => p.pointId === id)),
      );
    if (!candidates.length) continue;
    const connection = one<any>(candidates, 'captured native join connection');
    const nominal = connection.nominalTraceWidth,
      floor = board.min_trace_width ?? 0.15;
    if (
      !finite(nominal) ||
      !finite(floor) ||
      floor <= 0 ||
      nominal < floor ||
      !finite(connection.width) ||
      connection.width < floor ||
      connection.width > nominal
    )
      throw Error('Native saved join violates captured native widths');
    for (const [i, e] of [left, right].entries()) {
      const p = one<any>(
        connection.pointsToConnect.filter((p: any) => p.pointId === trace.connectsTo[i]),
        'native saved exit input',
      );
      if (p.x !== e.end.x || p.y !== e.end.y || p.layer !== e.end.layer || p.pcb_port_id !== undefined)
        throw Error('Native join captured exit differs from audited physical endpoint');
    }
    const route = trace.route;
    if (
      !Array.isArray(route) ||
      route.length < 2 ||
      route[0].route_type !== 'wire' ||
      route.at(-1).route_type !== 'wire'
    )
      throw Error('Unsupported native join route endpoints');
    let currentLayer = route[0].layer;
    const viaProofs = new Map<any, any>();
    const viaTraversals = new Map<any, { from: string; to: string }>();
    const annularWireContact = (index: number, direction: number, layer: string, barrel: any) => {
      const adjacent = route[index + direction];
      if (adjacent?.route_type !== 'wire' || adjacent.layer !== layer || !finite(adjacent.width))
        return false;
      let previous = { x: barrel.x, y: barrel.y, width: adjacent.width };
      for (let i = index + direction; i >= 0 && i < route.length; i += direction) {
        const wire = route[i];
        if (
          wire.route_type !== 'wire' ||
          wire.layer !== layer ||
          !point(wire) ||
          !finite(wire.width) ||
          wire.width < floor ||
          wire.width > nominal
        )
          return false;
        if (
          Math.max(distance(previous, barrel), distance(wire, barrel)) +
            Math.min(previous.width, wire.width) / 2 >
          barrel.hole_diameter / 2 + 1e-7
        )
          return true;
        previous = wire;
      }
      return false;
    };
    for (const [index, p] of route.entries()) {
      if (!point(p)) throw Error('Invalid native join route geometry');
      if (p.route_type === 'wire') {
        if (
          !layers.includes(p.layer) ||
          p.layer !== currentLayer ||
          !finite(p.width) ||
          p.width < floor ||
          p.width > nominal
        )
          throw Error('Native join wire layer/width differs');
      } else if (p.route_type === 'via') {
        const barrel = verifyVia(trace, p, left.source.subcircuit_connectivity_map_key);
        const before = route[index - 1],
          after = route[index + 1];
        let outgoing = p.to_layer;
        if (p.from_layer !== currentLayer || (after?.route_type === 'wire' && after.layer !== p.to_layer)) {
          // Native route reversal may retain the via's original direction
          // annotation. Prove traversal from actual coincident wire contacts
          // through the verified full through barrel, never by relabeling Cu.
          if (
            before?.route_type !== 'wire' ||
            after?.route_type !== 'wire' ||
            before.layer !== currentLayer ||
            before.x !== p.x ||
            before.y !== p.y ||
            after.x !== p.x ||
            after.y !== p.y ||
            before.layer === after.layer ||
            !barrel.layers.includes(before.layer) ||
            !barrel.layers.includes(after.layer) ||
            !annularWireContact(index, -1, before.layer, barrel) ||
            !annularWireContact(index, 1, after.layer, barrel)
          )
            throw Error('Native join discontinuous via lacks actual coincident annular copper proof');
          outgoing = after.layer;
        }
        viaProofs.set(p, barrel);
        viaTraversals.set(p, { from: currentLayer, to: outgoing });
        currentLayer = outgoing;
      } else throw Error('Unsupported native join geometry');
    }
    checkOwnedBarrels(trace, [...viaProofs.values()]);
    const contact = (r: any[], e: typeof left, reversed = false) => {
      const p = r[0];
      if (distance(p, e.end) >= (p.width + e.width) / 2 - 1e-7) return false;
      if (!e.via) return p.layer === e.end.layer;
      // Native endpoint grid rounding can move a join center slightly relative
      // to the exact captured saved exit. Prove physical copper, not a larger
      // coordinate tolerance: the full endpoint cap must be inside this exact
      // already-proved same-net barrel's outer disk, and a contiguous wire run
      // on a physical barrel layer must reach positive copper outside its drill.
      if (e.via.layers.includes(p.layer) && distance(p, e.via) + p.width / 2 < e.via.outer_diameter / 2) {
        let previous = p;
        for (const wire of r.slice(1)) {
          if (wire.route_type !== 'wire' || wire.layer !== p.layer) break;
          if (
            Math.max(distance(previous, e.via), distance(wire, e.via)) +
              Math.min(previous.width, wire.width) / 2 >
            e.via.hole_diameter / 2 + 1e-7
          )
            return true;
          previous = wire;
        }
      }
      if (p.layer !== e.end.layer) return false;
      // A native join can reuse the saved through barrel to leave on an inner
      // layer. Require the exact already-proved physical hole at the endpoint,
      // then positive annular copper on that layer; a wire inside its drill is
      // still not a contact. No unrelated or near-coincident barrel is inferred.
      if (p.x !== e.via.x || p.y !== e.via.y) return false;
      for (let i = 1; i < r.length; i++) {
        const q = r[i];
        if (q.route_type === 'wire' && q.x === e.via.x && q.y === e.via.y && q.layer === e.end.layer)
          continue;
        if (
          q.route_type !== 'via' ||
          viaProofs.get(q)?.pcb_via_id !== e.via.pcb_via_id ||
          (reversed ? viaTraversals.get(q)?.to : viaTraversals.get(q)?.from) !== e.end.layer
        )
          return false;
        const awayLayer = reversed ? viaTraversals.get(q)!.from : viaTraversals.get(q)!.to;
        let previous = p;
        for (const wire of r.slice(i + 1)) {
          if (wire.route_type !== 'wire' || wire.layer !== awayLayer) return false;
          if (
            Math.max(distance(previous, e.via), distance(wire, e.via)) +
              Math.min(previous.width, wire.width) / 2 >
            e.via.hole_diameter / 2 + 1e-7
          )
            return true;
          previous = wire;
        }
        return false;
      }
      return false;
    };
    if (
      !(contact(route, left) && contact([...route].reverse(), right, true)) &&
      !(contact(route, right) && contact([...route].reverse(), left, true))
    )
      throw Error('Native join lacks physical saved-exit/annular contact: ' + trace.pcb_trace_id);
    checkMarkers(
      trace,
      left.graphNet,
      undefined,
      [left.handoff, right.handoff].filter((h): h is PadHandoff => Boolean(h)),
    );
    if (!blank(trace.source_trace_id)) continue;
    trace.source_trace_id = left.source.source_trace_id;
    trace.source_net_id = left.net.source_net_id;
    audit.push({
      pcbTraceId: trace.pcb_trace_id,
      ref: left.ref,
      pad: left.pad,
      sourceTraceId: trace.source_trace_id,
      sourceNetId: trace.source_net_id,
      netName: left.net.name,
      kind: 'saved-exit-join',
    });
  }
  return {
    circuit: output,
    audit,
    viaAudit,
    deferredExistingTraceIds,
    unrepairedTraceIds: traces.filter((t) => blank(t.source_trace_id)).map((t) => t.pcb_trace_id) as string[],
  };
}
