import type { PlanGraph } from '../../src/blocks/graph.js';

/** Reserve the known RP2040 profile's fine-pitch signal channels before supply
 * meshes. This selects native routing phases only; it creates no copper or
 * routes, changes no net, and leaves clock and saved fanout ownership intact.
 */
export function selectRpCriticalSignalNets(
  graph: PlanGraph,
  touched: ReadonlySet<string>,
  clockNetNames: ReadonlySet<string>,
): Set<string> {
  if (!Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || typeof touched?.has !== 'function' || typeof clockNetNames?.has !== 'function')
    throw Error('RP phase ordering requires an actual graph and existing phase ownership sets');
  const byRef = new Map(graph.parts.map(p => [p.ref, p]));
  if (byRef.size !== graph.parts.length) throw Error('RP phase ordering requires unique component references');
  const rpRefs = new Set(graph.parts.filter(p => p.part.lcsc === 'C2040' && p.part.mpn === 'RP2040' && p.block.id === 'rp2040-minimal' && [3, 4].includes(p.block.version)).map(p => p.ref));
  const selected = new Set<string>();
  if (!rpRefs.size) return selected;
  const seen = new Set<string>();
  for (const net of graph.nets) {
    if (!net.name || seen.has(net.name) || !Array.isArray(net.pins) || !net.pins.length)
      throw Error('RP phase ordering requires unique named nets with actual endpoints');
    seen.add(net.name);
    const roles = net.pins.map(pin => {
      const actual = byRef.get(pin.ref)?.part.pins[pin.logical];
      if (!actual || actual.pad !== pin.pad || typeof actual.role !== 'string')
        throw Error(`RP phase ordering lacks physical pin/role correspondence for ${pin.ref}.${pin.pad}`);
      return actual.role;
    });
    if (touched.has(net.name) || clockNetNames.has(net.name)) continue;
    if (!net.pins.some(pin => rpRefs.has(pin.ref))) continue;
    if (roles.some(role => ['power-in', 'power-out', 'ground'].includes(role))) continue;
    selected.add(net.name);
  }
  return selected;
}
