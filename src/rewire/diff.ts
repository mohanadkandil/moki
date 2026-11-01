import type { CircuitDesign, PinRef } from '../circuit/model.js';

export type PartChange = {
  kind: 'added' | 'removed' | 'replaced' | 'value';
  part: string;
  before?: string;
  after?: string;
};

export type ConnectionChange = {
  kind: 'join' | 'leave';
  net: string;
  netName: string;
  endpoint: PinRef;
};

export type NetChange = { net: string; netName: string; before: string; after: string };

/** Logical membership changes, not a claim about the wires on a person's real bench. */
export type DesignDiff =
  | { comparable: false; reason: string }
  | { comparable: true; parts: PartChange[]; connections: ConnectionChange[]; nets: NetChange[]; unchanged: boolean };

const pinKey = (pin: PinRef) => JSON.stringify([pin.part, pin.pin]);
const partValue = (part: CircuitDesign['parts'][number]) => part.value ?? part.module;

/** Compare revisions within one supported circuit family. Reference designators are stable there. */
export function compareDesigns(before: CircuitDesign, after: CircuitDesign): DesignDiff {
  if (before.template !== after.template) {
    return { comparable: false, reason: 'These drafts are different circuit families. Review the complete new circuit.' };
  }
  const oldParts = new Map(before.parts.map(part => [part.id, part]));
  const newParts = new Map(after.parts.map(part => [part.id, part]));
  const parts: PartChange[] = [];
  const replaced = new Set<string>();
  for (const old of before.parts) {
    const next = newParts.get(old.id);
    if (!next) parts.push({ kind: 'removed', part: old.id, before: partValue(old) });
    else if (old.module !== next.module) {
      replaced.add(old.id);
      parts.push({ kind: 'replaced', part: old.id, before: partValue(old), after: partValue(next) });
    } else if (old.value !== next.value) {
      parts.push({ kind: 'value', part: old.id, before: partValue(old), after: partValue(next) });
    }
  }
  for (const next of after.parts) {
    if (!oldParts.has(next.id)) parts.push({ kind: 'added', part: next.id, after: partValue(next) });
  }

  // A net is an electrical set, not a list of physical jumper segments. Changes describe a pin
  // leaving or joining that set. Never infer an exact jumper route from endpoint order.
  const oldNets = new Map(before.nets.map(net => [net.id, net]));
  const newNets = new Map(after.nets.map(net => [net.id, net]));
  const connections: ConnectionChange[] = [];
  const nets: NetChange[] = [];
  for (const old of before.nets) {
    const next = newNets.get(old.id);
    if (next && (old.kind !== next.kind || old.volts !== next.volts || Boolean(old.analog) !== Boolean(next.analog))) {
      const describe = (net: typeof old) => `${net.kind}${net.volts === undefined ? '' : `, ${net.volts} V`}${net.analog ? ', read as analog' : ''}`;
      nets.push({ net: next.id, netName: next.name, before: describe(old), after: describe(next) });
    }
    const nextPins = new Set(next?.endpoints.map(pinKey) ?? []);
    for (const pin of old.endpoints) {
      if (!nextPins.has(pinKey(pin)) || replaced.has(pin.part)) {
        connections.push({ kind: 'leave', net: old.id, netName: old.name, endpoint: { ...pin } });
      }
    }
  }
  for (const next of after.nets) {
    const old = oldNets.get(next.id);
    const oldPins = new Set(old?.endpoints.map(pinKey) ?? []);
    for (const pin of next.endpoints) {
      if (!oldPins.has(pinKey(pin)) || replaced.has(pin.part)) {
        connections.push({ kind: 'join', net: next.id, netName: next.name, endpoint: { ...pin } });
      }
    }
  }
  return { comparable: true, parts, connections, nets, unchanged: parts.length === 0 && connections.length === 0 && nets.length === 0 };
}
