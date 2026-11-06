/** Native converters split repeated shapes of one physical pad into virtual ports.
 * Accept those only with matching, same-component native connection records. */
export function nativeComponentPorts(
  circuit: any[],
  source: any,
  natives: string[],
  optional = new Set<string>(),
) {
  const entries = circuit.filter(
    (c) => c.type === 'source_port' && c.source_component_id === source.source_component_id,
  );
  const byNative = new Map<string, any[]>(),
    claimed = new Map<string, string>();
  const claim = (p: any, native: string) => {
    if (typeof p.source_port_id !== 'string' || !p.source_port_id || claimed.has(p.source_port_id))
      throw new Error('Missing/duplicate native source port identity');
    claimed.set(p.source_port_id, native);
  };
  for (const native of natives) {
    if (byNative.has(native)) throw new Error('Native converter aliases distinct physical pads');
    const main = entries.filter(
      (p) =>
        p.name === native ||
        (/^pin\d+$/.test(native) &&
          p.pin_number === Number(native.slice(3)) &&
          p.port_hints?.includes(native)),
    );
    if (main.length !== 1 && !(optional.has(native) && main.length === 0))
      throw new Error(`Missing/ambiguous native port ${source.name}.${native}`);
    byNative.set(native, main);
    for (const p of main) {
      if (/^pin\d+$/.test(native)) {
        const number = Number(native.slice(3));
        if (
          (p.pin_number !== undefined && p.pin_number !== number) ||
          (p.port_hints !== undefined &&
            (!Array.isArray(p.port_hints) ||
              !p.port_hints.includes(native) ||
              p.port_hints.some(
                (hint: unknown) =>
                  typeof hint === 'string' &&
                  /^(?:pin)?\d+$/.test(hint) &&
                  Number(hint.replace(/^pin/, '')) !== number,
              )))
        )
          throw new Error(`Contradictory native physical identity ${source.name}.${native}`);
      }
      claim(p, native);
    }
  }
  const key = (ids: unknown) => {
    if (
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.some((id) => typeof id !== 'string') ||
      new Set(ids).size !== ids.length
    )
      throw new Error('Malformed native internal connection');
    return [...ids].sort().join('\0');
  };
  const declared = source.internally_connected_source_port_ids ?? [];
  if (!Array.isArray(declared)) throw new Error('Malformed native internal connections');
  const connections = circuit
    .filter(
      (c) =>
        c.type === 'source_component_internal_connection' &&
        c.source_component_id === source.source_component_id,
    )
    .map((c) => c.source_port_ids as string[]);
  const a = declared.map(key).sort(),
    b = connections.map(key).sort();
  if (new Set(a).size !== a.length || a.length !== b.length || a.some((v: string, i: number) => v !== b[i]))
    throw new Error('Native internal connection records disagree');
  const ids = new Set(entries.map((p) => p.source_port_id));
  for (const group of connections)
    if (group.some((id) => !ids.has(id)))
      throw new Error('Native internal connection has foreign/unknown ports');
  for (const p of entries.filter((p) => !claimed.has(p.source_port_id))) {
    const match = typeof p.name === 'string' && /^(pin\d+)_internal_[1-9]\d*$/.exec(p.name),
      native = match && match[1]!;
    const main = native && byNative.get(native)?.[0];
    if (
      !main ||
      !Array.isArray(p.port_hints) ||
      !p.port_hints.includes(native) ||
      !p.port_hints.includes(native.slice(3)) ||
      !p.port_hints.includes(p.name) ||
      p.port_hints.some(
        (hint: unknown) =>
          typeof hint === 'string' &&
          /^(?:pin)?\d+$/.test(hint) &&
          Number(hint.replace(/^pin/, '')) !== Number(native.slice(3)),
      ) ||
      (p.pin_number !== undefined && p.pin_number !== Number(native.slice(3))) ||
      !connections.some((g) => g.includes(p.source_port_id) && g.includes(main.source_port_id))
    )
      throw new Error(`Unexpected native source port ${source.name}.${p.name}`);
    claim(p, native);
    byNative.get(native)!.push(p);
  }
  return { byNative, connections };
}
