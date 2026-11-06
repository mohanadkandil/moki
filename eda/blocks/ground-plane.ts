import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import type { PlanGraph } from '../../src/blocks/graph.js';

export interface GroundPlaneContext {
  circuit: any[];
  graph: PlanGraph;
  mapping: Record<string, Record<string, string>>;
}
export type GroundPlaneDirection = 'left' | 'right' | 'up' | 'down';
export interface GroundPlaneAttemptAudit {
  attempt: number;
  elapsedMs: number;
  status: 'failed' | 'solved' | 'timed-out' | 'invalid';
  routedConnections: number;
  failedConnections: string[];
  changedBusDirections: Record<string, GroundPlaneDirection>;
  error?: string;
}
export interface GroundPlaneAudit {
  scope: 'native-ground-plane-routing-input-only';
  connections: number;
  aliases: Array<{ connection: string; ref: string; pad: string; canonicalSourcePort: string; aliasSourcePort: string; pcbPort: string; obstaclePad: string }>;
  directions: Array<{ connection: string; ref: string; pad: string; direction: 'left' | 'right' | 'up' | 'down' }>;
  requiresNativeDrcAndPhysicalCopperGate: true;
  attempts?: GroundPlaneAttemptAudit[];
}

/** Correct repeated physical-pad ownership for the native fanout solver. This
 * supplies logical routing identity only: it neither connects copper nor proves
 * contact between the repeated lands. Physical copper validation remains hard.
 */
export function prepareGroundPlaneInput(input: any, context: GroundPlaneContext) {
  const { circuit, graph, mapping } = context;
  const sourceIssues = nativeNetlistIssues(graph, circuit, mapping);
  if (sourceIssues.length) throw new Error('Ground plane source identity failed: ' + sourceIssues.map(i => i.message).join('; '));
  if (!input || !Array.isArray(input.connections) || !Array.isArray(input.obstacles) || !Array.isArray(input.buses) || input.allowViaInPad !== false)
    throw new Error('Ground plane needs native plane input with via-in-pad disabled');
  const grounds = circuit.filter(c => c.type === 'source_net' && c.name === 'GND' && c.is_ground === true);
  if (grounds.length !== 1) throw new Error('Ground plane needs one actual GND source net');
  const ground = grounds[0];
  const next = structuredClone(input);
  const audit: GroundPlaneAudit = { scope: 'native-ground-plane-routing-input-only', connections: next.connections.length, aliases: [], directions: [], requiresNativeDrcAndPhysicalCopperGate: true };
  const groups = new Map<string, { ids: string[]; ref: string; pad: string; canonical: string; component: string }>();
  for (const part of graph.parts) {
    const source = circuit.find(c => c.type === 'source_component' && c.name === part.ref)!;
    const terminals = [...Object.values(part.part.pins).map(p => ({ pad: p.pad, omitted: false })), ...(part.part.omitPads ?? []).map(pad => ({ pad, omitted: true }))];
    const natives = terminals.map(p => mapping[part.ref]![p.pad]!);
    const resolved = nativeComponentPorts(circuit, source, natives, new Set(terminals.filter(p => p.omitted).map(p => mapping[part.ref]![p.pad]!)));
    for (let i = 0; i < terminals.length; i++) {
      const ports = resolved.byNative.get(natives[i]!)!;
      if (!ports.length) continue;
      const ids = ports.map(p => p.source_port_id);
      const item = { ids, ref: part.ref, pad: terminals[i]!.pad, canonical: ids[0]!, component: source.source_component_id };
      for (const id of ids) groups.set(id, item);
    }
  }
  const names = new Set<string>();
  const directions: Record<string, 'left' | 'right' | 'up' | 'down'> = {};
  for (const connection of next.connections) {
    if (names.has(connection.name)) throw new Error('Duplicate ground plane connection'); names.add(connection.name);
    const buses = next.buses.filter((b: any) => b.connectionNames?.includes(connection.name));
    if (buses.length !== 1 || buses[0].connectionNames.length !== 1 || buses[0].termination?.type !== 'plane' || buses[0].termination.layer !== 'bottom')
      throw new Error('Ground plane phase may contain only singleton bottom-plane buses');
    if (connection.pointsToConnect?.length !== 1 || connection.source_trace_id !== connection.name) throw new Error('Ground plane phase needs actual single-port source traces');
    const trace = circuit.find(c => c.type === 'source_trace' && c.source_trace_id === connection.source_trace_id);
    if (!trace || trace.connected_source_port_ids?.length !== 1 || trace.connected_source_net_ids?.length !== 1 || trace.connected_source_net_ids[0] !== ground.source_net_id)
      throw new Error('Ground plane connection does not identify an actual GND trace');
    const sourceId = trace.connected_source_port_ids[0], group = groups.get(sourceId);
    if (!group || group.canonical !== sourceId) throw new Error('Ground plane connection must start on a verified canonical physical pad');
    const point = connection.pointsToConnect[0];
    const ports = circuit.filter(c => c.type === 'pcb_port' && c.source_port_id === sourceId);
    if (ports.length !== 1) throw new Error('Ground source needs one canonical native PCB port');
    const pcbPort = ports[0];
    if (point.pcb_port_id !== pcbPort.pcb_port_id || Math.hypot(point.x - pcbPort.x, point.y - pcbPort.y) > 1e-6 || point.layer !== 'top')
      throw new Error('Ground plane point differs from actual native PCB pad');
    const component = circuit.find(c => c.type === 'pcb_component' && c.pcb_component_id === pcbPort.pcb_component_id && c.source_component_id === group.component);
    if (!component) throw new Error('Ground pad component identity differs');
    for (const alias of group.ids.filter(id => id !== sourceId)) {
      const aliasPorts = circuit.filter(c => c.type === 'pcb_port' && c.source_port_id === alias && c.pcb_component_id === component.pcb_component_id);
      if (aliasPorts.length !== 1) throw new Error('Repeated physical pad lacks its actual PCB port');
      const aliasPort = aliasPorts[0];
      const pads = circuit.filter(c => ['pcb_smtpad', 'pcb_plated_hole'].includes(c.type) && c.pcb_port_id === aliasPort.pcb_port_id && c.pcb_component_id === component.pcb_component_id);
      if (!pads.length) throw new Error('Repeated physical pad has no native copper');
      for (const pad of pads) {
        const padId = pad.pcb_smtpad_id ?? pad.pcb_plated_hole_id;
        const obstacles = next.obstacles.filter((o: any) => o.circuitJsonMetadata?.pcb_port_id === aliasPort.pcb_port_id && (o.circuitJsonMetadata?.pcb_smtpad_id === padId || o.circuitJsonMetadata?.pcb_plated_hole_id === padId));
        if (!obstacles.length || obstacles.some((o: any) => o.componentId !== component.pcb_component_id || !Array.isArray(o.connectedTo))) throw new Error('Repeated pad routing obstacle identity differs');
        for (const obstacle of obstacles) {
          for (const token of [connection.name, sourceId, pcbPort.pcb_port_id]) if (!obstacle.connectedTo.includes(token)) obstacle.connectedTo.push(token);
          audit.aliases.push({ connection: connection.name, ref: group.ref, pad: group.pad, canonicalSourcePort: sourceId, aliasSourcePort: alias, pcbPort: aliasPort.pcb_port_id, obstaclePad: padId });
        }
      }
    }
    const dx = point.x - component.center.x, dy = point.y - component.center.y;
    // Pad rows can be offset from the component's overall footprint centroid.
    // Use the pad's long axis for its outward normal, preserving actual copper.
    const pad = next.obstacles.find((o: any) => o.circuitJsonMetadata?.pcb_port_id === pcbPort.pcb_port_id && o.componentId === component.pcb_component_id);
    if (!pad) throw new Error('Ground point has no actual pad obstacle');
    const horizontal = pad.width > pad.height * 1.25, vertical = pad.height > pad.width * 1.25;
    const direction = horizontal && Math.abs(dx) > 1e-4 ? dx > 0 ? 'right' : 'left'
      : vertical && Math.abs(dy) > 1e-4 ? dy > 0 ? 'up' : 'down'
      : Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'up' : 'down';
    directions[buses[0].busId] = direction;
    audit.directions.push({ connection: connection.name, ref: group.ref, pad: group.pad, direction });
  }
  return { input: next, audit, options: { buses: next.buses, allowSameNetMerges: true, allowBlindAndBuriedVias: false, borderDistribution: 'even', compactBusTracks: true, busDirections: directions } };
}

/** Native best-attempt plans contain solved connections only. Never infer failure
 * from summary.failedBusIds, which belongs to the solver's own assignment pass. */
function failedGroundConnections(input: any, bestAttempt: any): string[] {
  if (!Array.isArray(input?.connections) || !Array.isArray(bestAttempt?.plans) || !bestAttempt.summary || !bestAttempt.plans.length)
    throw new Error('Native ground attempt has no usable solved-plan identities');
  const allNames = input.connections.map((connection: any) => connection.name);
  if (allNames.some((name: unknown) => typeof name !== 'string' || !name) || new Set(allNames).size !== allNames.length)
    throw new Error('Native ground connection identities are invalid');
  const known = new Set<string>(allNames), solved = new Set<string>();
  for (const plan of bestAttempt.plans) {
    if (typeof plan?.connectionName !== 'string' || !known.has(plan.connectionName) || solved.has(plan.connectionName))
      throw new Error('Native ground solved plans have unknown or duplicate connections');
    solved.add(plan.connectionName);
  }
  if (!Number.isInteger(bestAttempt.summary.routedConnectionCount) || bestAttempt.summary.routedConnectionCount !== solved.size)
    throw new Error('Native ground solved-plan count contradicts its summary');
  return allNames.filter((name: string) => !solved.has(name));
}

/** Enumerate only native cardinal-direction hints for at most two failed buses.
 * This does not compute paths or alter routing input, geometry or rule options.
 * The already attempted baseline is excluded, leaving at most15 alternatives. */
export function groundPlaneDirectionRetries(input: any, options: any, bestAttempt: any) {
  const failedConnections = failedGroundConnections(input, bestAttempt);
  if (failedConnections.length < 1 || failedConnections.length > 2)
    throw new Error(`Native ground direction retry needs one or two failures, got ${failedConnections.length}`);
  if (!Array.isArray(input.buses) || !options?.busDirections || typeof options.busDirections !== 'object')
    throw new Error('Native ground direction retry needs actual buses and baseline directions');
  const cardinal: GroundPlaneDirection[] = ['up', 'right', 'down', 'left'];
  const failedBuses = failedConnections.map((name: string) => {
    const buses = input.buses.filter((bus: any) => Array.isArray(bus.connectionNames) && bus.connectionNames.includes(name));
    if (buses.length !== 1 || buses[0].connectionNames.length !== 1 || typeof buses[0].busId !== 'string' || !buses[0].busId || buses[0].termination?.type !== 'plane' || buses[0].termination.layer !== 'bottom')
      throw new Error('Native ground retry requires unambiguous singleton bottom-plane buses');
    const busId = buses[0].busId as string, baseline = options.busDirections[busId] as GroundPlaneDirection;
    if (!cardinal.includes(baseline)) throw new Error('Native ground baseline direction is not cardinal');
    return { busId, directions: [baseline, ...cardinal.filter(direction => direction !== baseline)] };
  });
  if (new Set(failedBuses.map((bus: any) => bus.busId)).size !== failedBuses.length)
    throw new Error('Native ground retry buses alias distinct failed connections');
  const combinations: Record<string, GroundPlaneDirection>[] = [];
  const enumerate = (index: number, changed: Record<string, GroundPlaneDirection>) => {
    if (index === failedBuses.length) { combinations.push(changed); return; }
    const bus = failedBuses[index]!;
    for (const direction of bus.directions) enumerate(index + 1, { ...changed, [bus.busId]: direction });
  };
  enumerate(0, {});
  const alternatives = combinations.slice(1).map(changed => {
    const next = structuredClone(options);
    for (const [busId, direction] of Object.entries(changed)) next.busDirections[busId] = direction;
    return next;
  });
  return { failedConnections, alternatives };
}

/** Native solver adapter. At most16 native attempts /60s; no partial copper. */
export async function groundPlaneAutorouter(input: any, context: GroundPlaneContext, onAudit?: (audit: GroundPlaneAudit) => void) {
  const prepared = prepareGroundPlaneInput(input, context);
  prepared.audit.attempts = [];
  onAudit?.(prepared.audit);
  const nativePackage: string = 'tscircuit';
  const { SOLVERS } = await import(nativePackage);
  let attemptOptions = structuredClone(prepared.options);
  let solver = new SOLVERS.FanoutSolver(structuredClone(prepared.input), attemptOptions as any);
  const handlers = new Map<string, Array<(event: any) => void>>();
  let started = false, stopped = false, finished = false, timer: ReturnType<typeof setTimeout> | undefined, output: any;
  let began = 0, attemptBegan = 0, attemptNumber = 1, recorded = false, alternatives: any[] | undefined;
  const emit = (name: string, event: any) => { for (const fn of handlers.get(name) ?? []) fn(event); };
  const attemptFailures = () => {
    try { return failedGroundConnections(prepared.input, (solver as any).bestAttempt); }
    catch { return [] as string[]; }
  };
  const record = (status: GroundPlaneAttemptAudit['status'], failures: string[], error?: unknown) => {
    if (recorded) return;
    recorded = true;
    const changedBusDirections = Object.fromEntries(Object.entries(attemptOptions.busDirections).filter(([id, direction]) => direction !== prepared.options.busDirections[id])) as Record<string, GroundPlaneDirection>;
    prepared.audit.attempts!.push({ attempt: attemptNumber, elapsedMs: performance.now() - attemptBegan, status,
      routedConnections: status === 'solved' ? prepared.input.connections.length : failures.length ? prepared.input.connections.length - failures.length : 0,
      failedConnections: failures, changedBusDirections,
      ...(error !== undefined ? { error: String(error instanceof Error ? error.message : error).slice(0, 600) } : {}) });
    onAudit?.(prepared.audit);
  };
  const cycle = () => {
    timer = undefined;
    if (stopped || finished) return;
    try {
      const until = Math.min(performance.now() + 100, began + 60_000);
      while (!stopped && !solver.failed && !solver.solved && performance.now() < until) solver.step();
      if (stopped) return;
      if (performance.now() - began >= 60_000) {
        record('timed-out', attemptFailures(), 'Native ground direction attempts exceeded60s');
        throw new Error('Native ground direction attempts exceeded60s; no partial copper accepted');
      }
      if (solver.failed) {
        const bestAttempt = (solver as any).bestAttempt;
        const failures = failedGroundConnections(prepared.input, bestAttempt);
        record('failed', failures, solver.error ?? 'Native ground plane fanout failed');
        if (failures.length < 1 || failures.length > 2) throw new Error(`Native ground direction retry needs one or two failures, got ${failures.length}`);
        if (alternatives === undefined) alternatives = groundPlaneDirectionRetries(prepared.input, prepared.options, bestAttempt).alternatives;
        const nextOptions = alternatives.shift();
        if (!nextOptions || attemptNumber >= 16) throw new Error(solver.error ?? 'Native ground directions exhausted; no partial copper accepted');
        attemptNumber++; attemptOptions = nextOptions; attemptBegan = performance.now(); recorded = false;
        solver = new SOLVERS.FanoutSolver(structuredClone(prepared.input), attemptOptions as any);
        timer = setTimeout(cycle, 0); return;
      }
      if (solver.solved) {
        const candidate = solver.getOutput();
        if (candidate.validation?.valid !== true || candidate.validation.checkedConnectionCount !== prepared.input.connections.length || candidate.validation.brokenOutConnectionCount !== prepared.input.connections.length || !Array.isArray(candidate.simpleRouteJson?.connections) || candidate.simpleRouteJson.connections.length !== 0) {
          record('invalid', attemptFailures(), 'Native ground plane solver validation failed');
          throw new Error('Native ground plane solver validation failed');
        }
        output = candidate; record('solved', []); finished = true;
        emit('complete', { traces: output.fanoutTraces }); return;
      }
      emit('progress', { progress: (attemptNumber - 1 + solver.progress) / 16, attempt: attemptNumber });
      timer = setTimeout(cycle, 0);
    } catch (error) {
      if (!stopped && !finished) { record('invalid', attemptFailures(), error); finished = true; emit('error', { error }); }
    }
  };
  return { on(name: string, fn: (event: any) => void) { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
    start() { if (started || stopped || finished) return; started = true; began = performance.now(); attemptBegan = began; timer = setTimeout(cycle, 0); },
    stop() { stopped = true; if (timer !== undefined) clearTimeout(timer); timer = undefined; },
    getOutputSimpleRouteJson() { return output?.simpleRouteJson; } };
}
