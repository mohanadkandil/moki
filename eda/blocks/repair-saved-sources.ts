/** Complete lost native saved-prefix source metadata from compiler audit only.
 * Never changes geometry or removes/check-filters errors. Final native DRC and
 * physical copper/source gates must run again on the returned cloned circuit.
 */
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import type { PlanGraph } from '../../src/blocks/graph.js';

type Wire = {
  route_type: 'wire';
  x: number;
  y: number;
  width: number;
  layer: string;
  [key: string]: unknown;
};
export interface SavedPhaseEvidence {
  props: { phaseIndex: number; pcbTracePaths: Array<{ connection: string; route: Wire[] }> };
  audit: Array<{
    ref: string;
    pad: string;
    netNames: string[];
    widthMm: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
  }>;
  preRoutedFootprintHints?: Array<{ ref: string; pad: string; netName: string }>;
}
export interface SourceRepairAudit {
  pcbTraceId: string;
  ref: string;
  pad: string;
  sourceTraceId: string;
  sourceNetId: string;
  netName: string;
  kind: 'saved-prefix' | 'saved-exit-join';
}
const one = <T>(items: T[], label: string): T => {
  if (items.length !== 1) throw new Error(`Saved source repair requires exactly one ${label}`);
  return items[0]!;
};
const blank = (id: unknown) => id === undefined || id === null || id === '';
const same = (a: any, b: any) =>
  a?.route_type === 'wire' &&
  b?.route_type === 'wire' &&
  Number.isFinite(a.x) &&
  Number.isFinite(a.y) &&
  Number.isFinite(a.width) &&
  a.width > 0 &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.layer === b.layer;
const routeEquals = (a: any, b: any) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === 2 &&
  b.length === 2 &&
  a.every((p: any, i: number) => same(p, b[i])) &&
  a[0].width === a[1].width &&
  a[0].layer === a[1].layer;

export function repairSavedSources(
  circuit: any[],
  graph: PlanGraph,
  mapping: Record<string, Record<string, string>>,
  phase: SavedPhaseEvidence,
  options: { nativeRoutingInputs?: readonly any[] } = {},
) {
  if (
    !Array.isArray(circuit) ||
    !Array.isArray(phase?.props?.pcbTracePaths) ||
    !Array.isArray(phase.audit) ||
    !Number.isSafeInteger(phase.props.phaseIndex)
  )
    throw new Error('Malformed saved source repair evidence');
  const failures = nativeNetlistIssues(graph, circuit, mapping);
  if (failures.length)
    throw new Error(
      'Saved source repair cannot establish physical source graph: ' +
        failures.map((f) => f.message).join('; '),
    );
  const output = structuredClone(circuit),
    audit: SourceRepairAudit[] = [];
  const proven = new Map<
    string,
    { trace: any; sourceTrace: any; sourceNet: any; netName: string; ref: string; pad: string }
  >();
  const ids = output.filter((e) => e.type === 'pcb_trace').map((e) => e.pcb_trace_id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
    throw new Error('Saved source repair requires unique PCB trace identities');
  for (const trace of output.filter(
    (e) => e.type === 'pcb_trace' && e.pcb_trace_id.startsWith('saved_phase_'),
  )) {
    const candidates = phase.props.pcbTracePaths
      .map((path, index) => ({ path, index }))
      .filter(({ path }) => routeEquals(trace.route, path.route));
    if (!candidates.length && !blank(trace.source_trace_id)) continue;
    const { path, index } = one(candidates, 'literal audited two-point prefix');
    const identity = /^saved_phase_(.+)_(\d+)_(\d+)$/.exec(trace.pcb_trace_id);
    if (!identity || Number(identity[2]) !== phase.props.phaseIndex || Number(identity[3]) !== index)
      throw new Error('Saved prefix identity differs from audited phase/path index');
    const selector = /^\.([A-Za-z][A-Za-z0-9_]*) > \.pin([1-9]\d*)$/.exec(path.connection);
    if (!selector) throw new Error('Saved prefix lacks a canonical physical selector');
    const ref = selector[1]!,
      pad = selector[2]!;
    const standard = phase.audit.filter((a) => a.ref === ref && a.pad === pad);
    const hints = (phase.preRoutedFootprintHints ?? []).filter((a) => a.ref === ref && a.pad === pad);
    if (standard.length > 1 || hints.length > 1 || standard.length + hints.length === 0)
      throw new Error('Saved prefix lacks unique compiler fanout/footprint audit');
    if (
      hints.length &&
      standard.length &&
      (standard[0]!.netNames.length !== 1 || standard[0]!.netNames[0] !== hints[0]!.netName)
    )
      throw new Error('Saved footprint hint and fanout audit disagree');
    if (standard.length) {
      const a = standard[0]!;
      if (
        a.start.x !== path.route[0]!.x ||
        a.start.y !== path.route[0]!.y ||
        a.end.x !== path.route[1]!.x ||
        a.end.y !== path.route[1]!.y ||
        a.widthMm !== path.route[0]!.width
      )
        throw new Error('Saved prefix differs from compiler start/end/width audit');
    }
    const part = one(
      graph.parts.filter((p) => p.ref === ref),
      'graph component',
    );
    const physical = one(
      Object.entries(part.part.pins).filter(([, p]) => p.pad === pad),
      'logical physical-pad binding',
    );
    const net = one(
      graph.nets.filter((n) =>
        n.pins.some((p) => p.ref === ref && p.pad === pad && p.logical === physical[0]),
      ),
      'graph physical net',
    );
    const expectedNames = standard.length ? standard[0]!.netNames : [hints[0]!.netName];
    if (expectedNames.length !== 1 || expectedNames[0] !== net.name)
      throw new Error('Saved prefix audit disagrees with graph physical net');
    const source = one(
      output.filter((e) => e.type === 'source_component' && e.name === ref),
      'actual source component',
    );
    const natives = Object.values(part.part.pins).map((p) => {
      const native = mapping[ref]?.[p.pad];
      if (!native) throw new Error('Saved prefix physical import mapping missing');
      return native;
    });
    const optional = new Set(
      (part.part.omitPads ?? []).map((p) => mapping[ref]?.[p]).filter((n): n is string => Boolean(n)),
    );
    const all = [...natives, ...optional];
    const resolved = nativeComponentPorts(output, source, all, optional);
    const native = mapping[ref]?.[pad];
    const sourcePort = one(
      (resolved.byNative.get(native!) ?? []).filter(
        (p) => p.name === native || p.port_hints?.includes(native),
      ),
      'canonical physical source port',
    );
    const component = one(
      output.filter(
        (e) => e.type === 'pcb_component' && e.source_component_id === source.source_component_id,
      ),
      'actual PCB component',
    );
    const port = one(
      output.filter(
        (e) =>
          e.type === 'pcb_port' &&
          e.source_port_id === sourcePort.source_port_id &&
          e.pcb_component_id === component.pcb_component_id,
      ),
      'actual canonical PCB port',
    );
    const lands = output.filter(
      (e) =>
        ['pcb_smtpad', 'pcb_plated_hole'].includes(e.type) &&
        e.pcb_port_id === port.pcb_port_id &&
        e.pcb_component_id === component.pcb_component_id &&
        e.port_hints?.includes(native),
    );
    if (
      !lands.length ||
      port.x !== trace.route[0].x ||
      port.y !== trace.route[0].y ||
      !port.layers?.includes(trace.route[0].layer) ||
      // Native DRC attaches this marker after the pre-pour lifecycle hook.
      // Absence is allowed only after the independent exact physical proofs above.
      (trace.route[0].start_pcb_port_id !== undefined &&
        trace.route[0].start_pcb_port_id !== port.pcb_port_id) ||
      trace.route[1].end_pcb_port_id !== undefined
    )
      throw new Error('Saved prefix lacks exact actual pad/port start binding');
    const sourceNet = one(
      output.filter((e) => e.type === 'source_net' && e.name === net.name),
      'actual named source net',
    );
    const sourceTrace = one(
      output.filter(
        (e) =>
          e.type === 'source_trace' &&
          e.connected_source_port_ids?.length === 1 &&
          e.connected_source_port_ids[0] === sourcePort.source_port_id &&
          e.connected_source_net_ids?.length === 1 &&
          e.connected_source_net_ids[0] === sourceNet.source_net_id,
      ),
      'actual compiler one-port-to-net source trace',
    );
    if (
      sourceTrace.subcircuit_id !== port.subcircuit_id ||
      trace.subcircuit_id !== sourceTrace.subcircuit_id ||
      sourceTrace.subcircuit_connectivity_map_key !== sourceNet.subcircuit_connectivity_map_key ||
      sourceTrace.subcircuit_connectivity_map_key !== sourcePort.subcircuit_connectivity_map_key ||
      trace.connection_name !== sourceNet.source_net_id ||
      (!blank(trace.source_net_id) && trace.source_net_id !== sourceNet.source_net_id)
    )
      throw new Error('Saved prefix native source/net/subcircuit metadata conflict');
    proven.set(trace.pcb_trace_id, { trace, sourceTrace, sourceNet, netName: net.name, ref, pad });
    if (!blank(trace.source_trace_id)) {
      if (trace.source_trace_id !== sourceTrace.source_trace_id)
        throw new Error('Saved prefix has conflicting existing source trace metadata');
      continue;
    }
    trace.source_trace_id = sourceTrace.source_trace_id;
    trace.source_net_id = sourceNet.source_net_id;
    audit.push({
      pcbTraceId: trace.pcb_trace_id,
      ref,
      pad,
      sourceTraceId: sourceTrace.source_trace_id,
      sourceNetId: sourceNet.source_net_id,
      netName: net.name,
      kind: 'saved-prefix',
    });
  }
  if (options.nativeRoutingInputs !== undefined) {
    if (!Array.isArray(options.nativeRoutingInputs))
      throw new Error('Saved source repair requires native routing capture records');
    for (const trace of output.filter((e) => e.type === 'pcb_trace' && blank(e.source_trace_id))) {
      if (!/^source_net_\d+_mst\d+_\d+$/.test(trace.pcb_trace_id)) continue;
      if (
        !Array.isArray(trace.connectsTo) ||
        trace.connectsTo.length !== 2 ||
        new Set(trace.connectsTo).size !== 2 ||
        trace.connectsTo.some((id: unknown) => typeof id !== 'string' || !id.endsWith('_exit'))
      )
        throw new Error('Unattributed native join lacks two audited saved exits');
      const exits = trace.connectsTo.map((id: string) => {
        const p = proven.get(id.slice(0, -5));
        if (!p) throw new Error('Unattributed native join has an unproved saved exit');
        return p;
      });
      const left = exits[0]!,
        right = exits[1]!,
        netId = left.sourceNet.source_net_id;
      if (
        right.sourceNet.source_net_id !== netId ||
        right.netName !== left.netName ||
        trace.connection_name !== netId ||
        !trace.pcb_trace_id.startsWith(netId + '_mst') ||
        trace.subcircuit_id !== left.sourceTrace.subcircuit_id ||
        trace.subcircuit_id !== right.sourceTrace.subcircuit_id ||
        (!blank(trace.source_net_id) && trace.source_net_id !== netId)
      )
        throw new Error('Unattributed native join disagrees with canonical physical source net');
      const points = exits.map((p: any) => p.trace.route[1]);
      const candidates = options.nativeRoutingInputs
        .filter((r) => r?.solver === 'AutoroutingPipelineSolver9_PreloadedTraceGraph')
        .flatMap((r) => r.input?.input?.connections ?? [])
        .filter(
          (c) =>
            c.name === netId &&
            Array.isArray(c.pointsToConnect) &&
            trace.connectsTo.every((id: string) => c.pointsToConnect.some((p: any) => p.pointId === id)),
        );
      const connection = one(candidates, 'native routing connection confirming both saved exits');
      const width = left.trace.route[0].width,
        layer = left.trace.route[0].layer;
      if (
        right.trace.route[0].width !== width ||
        right.trace.route[0].layer !== layer ||
        connection.width !== width ||
        connection.nominalTraceWidth !== width
      )
        throw new Error('Unattributed native join width/layer differs from audited routing input');
      for (let i = 0; i < 2; i++) {
        const point = one<any>(
          connection.pointsToConnect.filter((p: any) => p.pointId === trace.connectsTo[i]),
          'native saved exit input point',
        );
        if (
          point.x !== points[i].x ||
          point.y !== points[i].y ||
          point.layer !== layer ||
          point.pcb_port_id !== undefined
        )
          throw new Error('Native routing input saved exit differs from actual audited prefix');
      }
      const route = trace.route;
      if (
        !Array.isArray(route) ||
        route.length < 2 ||
        route.some(
          (p) =>
            p.route_type !== 'wire' ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.width !== width ||
            p.layer !== layer,
        )
      )
        throw new Error('Unattributed native saved-exit join has unsupported route geometry');
      const contact = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y) < width / 2 - 1e-7;
      if (
        !(contact(route[0], points[0]) && contact(route.at(-1), points[1])) &&
        !(contact(route[0], points[1]) && contact(route.at(-1), points[0]))
      )
        throw new Error('Native join endpoints do not physically contact both saved-prefix wire envelopes');
      trace.source_trace_id = left.sourceTrace.source_trace_id;
      trace.source_net_id = netId;
      audit.push({
        pcbTraceId: trace.pcb_trace_id,
        ref: left.ref,
        pad: left.pad,
        sourceTraceId: trace.source_trace_id,
        sourceNetId: netId,
        netName: left.netName,
        kind: 'saved-exit-join',
      });
    }
  }
  return {
    circuit: output,
    audit,
    unrepairedTraceIds: output
      .filter((e) => e.type === 'pcb_trace' && blank(e.source_trace_id))
      .map((e) => e.pcb_trace_id),
  };
}
