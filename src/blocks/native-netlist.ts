import type { PlanGraph } from './graph.js';
import { nativeComponentPorts } from './native-ports.js';
/** Check rendered source connectivity against the validated plan, including actual converter pin aliases. */
export function nativeNetlistIssues(
  graph: PlanGraph,
  circuit: unknown,
  mapping: Record<string, Record<string, string>>,
): Array<{ type: string; message: string }> {
  try {
    if (!Array.isArray(circuit)) throw new Error('Native circuit data is missing');
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x);
      if (!p) {
        parent.set(x, x);
        return x;
      }
      if (p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    const join = (a: string, b: string) => parent.set(find(a), find(b));
    const ports = new Map<string, string>(),
      reverse = new Map<string, string>();
    const components = circuit.filter((c) => c.type === 'source_component');
    if (
      components.length !== graph.parts.length ||
      components.some((c) => !graph.parts.some((p) => p.ref === c.name))
    )
      throw new Error('Native circuit contains unexpected source components');
    const recognized = new Set<string>(),
      internal: string[][] = [];
    for (const p of graph.parts) {
      const sources = circuit.filter((c) => c.type === 'source_component' && c.name === p.ref);
      if (sources.length !== 1) throw new Error(`Missing/duplicate native component ${p.ref}`);
      const terminals = [
        ...Object.entries(p.part.pins).map(([logical, pin]) => ({ logical, pad: pin.pad, omitted: false })),
        ...(p.part.omitPads ?? []).map((pad) => ({ logical: `omitted:${pad}`, pad, omitted: true })),
      ];
      const natives = terminals.map((pin) => {
        const native = mapping[p.ref]?.[pin.pad];
        if (!native) throw new Error(`No converter mapping ${p.ref}.${pin.pad}`);
        return native;
      });
      const resolved = nativeComponentPorts(
        circuit,
        sources[0],
        natives,
        new Set(terminals.filter((t) => t.omitted).map((t) => mapping[p.ref]![t.pad]!)),
      );
      internal.push(...resolved.connections);
      for (const [index, pin] of terminals.entries()) {
        const actual = resolved.byNative.get(natives[index]!)!;
        if (pin.omitted && !actual.length) continue;
        const id = actual[0].source_port_id;
        if (reverse.has(id))
          throw new Error(`Native port aliases distinct physical pads: ${p.ref}.${pin.pad}`);
        ports.set(`${p.ref}.${pin.logical}`, id);
        reverse.set(id, `${p.ref}.${pin.logical}`);
        for (const alias of actual) recognized.add(alias.source_port_id);
        find(id);
      }
    }
    const allPorts = circuit.filter((c) => c.type === 'source_port');
    if (
      allPorts.some((c) => !recognized.has(c.source_port_id)) ||
      new Set(allPorts.map((c) => c.source_port_id)).size !== allPorts.length
    )
      throw new Error('Native circuit contains unexpected/duplicate source ports');
    if (
      circuit.some(
        (c) =>
          c.type === 'source_component_internal_connection' &&
          !components.some((p) => p.source_component_id === c.source_component_id),
      )
    )
      throw new Error('Native internal connection has an unknown component');
    const wired = new Set<string>();
    for (const group of internal) {
      for (const id of group) join(group[0]!, id);
    }
    for (const trace of circuit.filter((c) => c.type === 'source_trace')) {
      for (const id of trace.connected_source_port_ids ?? []) {
        if (!recognized.has(id)) throw new Error('Native trace has an unknown source port');
        wired.add(id);
      }
      const ids = [...(trace.connected_source_port_ids ?? []), ...(trace.connected_source_net_ids ?? [])];
      for (const id of ids) join(trace.source_trace_id, id);
    }
    const expected = new Map<string, Set<string>>();
    for (const net of graph.nets) {
      const ids = net.pins.map((p) => ports.get(`${p.ref}.${p.logical}`)!);
      if (ids.some((id) => !id)) throw new Error(`Plan net ${net.name} lacks a mapped port`);
      const roots = new Set(ids.map(find));
      if (roots.size !== 1) throw new Error(`Rendered net ${net.name} is split across different source nets`);
      const root = roots.values().next().value!;
      if (expected.has(root)) throw new Error(`Rendered source shorts separate plan nets at ${net.name}`);
      expected.set(root, new Set(ids));
    }
    for (const [root, ids] of expected) {
      const actual = [...ports.values()].filter((id) => find(id) === root);
      if (actual.length !== ids.size || actual.some((id) => !ids.has(id)))
        throw new Error('Rendered source connectivity differs from the plan physical pin set');
    }
    const wiredRoots = new Set([...wired].map(find));
    const physicalRoots = new Map<string, number>();
    for (const id of ports.values()) physicalRoots.set(find(id), (physicalRoots.get(find(id)) ?? 0) + 1);
    for (const id of ports.values())
      if (!expected.has(find(id)) && (wiredRoots.has(find(id)) || physicalRoots.get(find(id))! > 1))
        throw new Error('Native circuit wires a physical terminal that the plan leaves isolated');
    return [];
  } catch (error) {
    return [
      {
        type: 'source_plan_netlist_mismatch',
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
