import { compareDesigns } from '../rewire/diff.js';
import { moduleDef } from './catalog.js';
import type { CircuitDesign, PinRef } from './model.js';

// Deterministic identity for designs.
// - fingerprint: the wiring only (template, parts, nets). Same wiring, same fingerprint.
// - contentId: wiring plus the firmware settings, so two exports that differ in any way differ here.

export function canonicalTopology(design: CircuitDesign): string {
  const parts = [...design.parts]
    .map(p => ({ id: p.id, module: p.module, value: p.value ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nets = [...design.nets]
    .map(n => ({ id: n.id, kind: n.kind, volts: n.volts ?? null, analog: n.analog ?? false, endpoints: [...n.endpoints].map(e => `${e.part}.${e.pin}`).sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ template: design.template, parts, nets });
}

/** Two independent 32-bit FNV-1a passes, hex. A change detector, not a security hash. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 0x200) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function fingerprint(design: CircuitDesign): string {
  return hash(canonicalTopology(design));
}

export function contentId(design: CircuitDesign): string {
  const behavior = [...design.behavior].map(b => [b.label, b.value]).sort((x, y) => x[0]!.localeCompare(y[0]!));
  // Only a design with custom firmware hashes it, so every other design keeps its id.
  return hash(`${canonicalTopology(design)}|${JSON.stringify(behavior)}${design.app ? `|${design.app.source}` : ''}${design.requirements?.length ? `|${JSON.stringify(design.requirements)}` : ''}`);
}

export interface DesignChange {
  kind: 'part-added' | 'part-removed' | 'part-changed' | 'net-added' | 'net-removed' | 'net-changed' | 'net-property' | 'template-changed' | 'setting-changed';
  subject: string;
  text: string;
}

function partName(design: CircuitDesign, id: string): string {
  const part = design.parts.find(p => p.id === id);
  return part ? `${moduleDef(part.module).name}${part.value ? ` ${part.value}` : ''}` : id;
}

const key = (e: PinRef) => `${e.part}.${e.pin}`;

/**
 * Maker-facing sentences for a wiring change. The comparison itself is compareDesigns (set
 * semantics over net membership, replaced parts and net properties); this only phrases it.
 */
export function diffDesigns(before: CircuitDesign, after: CircuitDesign): DesignChange[] {
  const diff = compareDesigns(before, after);
  if (!diff.comparable) {
    return [{ kind: 'template-changed', subject: after.template, text: `Switched from the ${before.title.toLowerCase()} to the ${after.title.toLowerCase()}` }];
  }
  const changes: DesignChange[] = [];
  const partChanged = new Set(diff.parts.filter(p => p.kind !== 'value').map(p => p.part));
  const netsOf = (part: string) => [...new Set(diff.connections.filter(c => c.kind === 'join' && c.endpoint.part === part).map(c => c.netName))];
  for (const p of diff.parts) {
    if (p.kind === 'added') changes.push({ kind: 'part-added', subject: p.part, text: `Added ${p.part}, ${partName(after, p.part)} (on ${netsOf(p.part).join(', ')})` });
    else if (p.kind === 'removed') changes.push({ kind: 'part-removed', subject: p.part, text: `Removed ${p.part}, ${partName(before, p.part)}` });
    else if (p.kind === 'replaced') changes.push({ kind: 'part-changed', subject: p.part, text: `${p.part} is now ${partName(after, p.part)}, replacing ${partName(before, p.part)}; its pins reconnect to ${netsOf(p.part).join(', ')}` });
    else changes.push({ kind: 'part-changed', subject: p.part, text: `${p.part} changes from ${p.before} to ${p.after}` });
  }

  const beforeNets = new Set(before.nets.map(n => n.id));
  const afterNets = new Map(after.nets.map(n => [n.id, n]));
  const byNet = new Map<string, { name: string; leave: string[]; join: string[] }>();
  for (const c of diff.connections) {
    const entry = byNet.get(c.net) ?? { name: c.netName, leave: [], join: [] };
    entry[c.kind].push(key(c.endpoint));
    byNet.set(c.net, entry);
  }
  for (const [net, { name, leave, join }] of byNet) {
    if (!beforeNets.has(net)) { changes.push({ kind: 'net-added', subject: net, text: `New connection ${name}: ${afterNets.get(net)!.endpoints.map(key).join(', ')}` }); continue; }
    if (!afterNets.has(net)) { changes.push({ kind: 'net-removed', subject: net, text: `Removed connection ${name}` }); continue; }
    // Pins of added, removed or replaced parts are already described with their part.
    const ownPart = (k: string) => partChanged.has(k.split('.')[0]!);
    const l = leave.filter(k => !ownPart(k));
    const j = join.filter(k => !ownPart(k));
    if (l.length === 1 && j.length === 1 && l[0]!.split('.')[0] === j[0]!.split('.')[0]) {
      changes.push({ kind: 'net-changed', subject: net, text: `${name} moved from ${l[0]} to ${j[0]}` });
      continue;
    }
    for (const k of l) changes.push({ kind: 'net-changed', subject: net, text: `${k} leaves ${name}` });
    for (const k of j) changes.push({ kind: 'net-changed', subject: net, text: `${k} joins ${name}` });
  }
  for (const n of diff.nets) changes.push({ kind: 'net-property', subject: n.net, text: `${n.netName}: ${n.before} → ${n.after}` });
  return changes;
}

/** Changes to the firmware settings recorded with a design (session length, thresholds…). */
export function settingsChanges(before: CircuitDesign, after: CircuitDesign): DesignChange[] {
  const old = new Map(before.behavior.map(b => [b.label, b.value]));
  const next = new Map(after.behavior.map(b => [b.label, b.value]));
  const out: DesignChange[] = [];
  for (const [label, value] of next) {
    const was = old.get(label);
    if (was === undefined) out.push({ kind: 'setting-changed', subject: label, text: `${label}: ${value}` });
    else if (was !== value) out.push({ kind: 'setting-changed', subject: label, text: `${label}: ${was} → ${value}` });
  }
  for (const [label, was] of old) if (!next.has(label)) out.push({ kind: 'setting-changed', subject: label, text: `${label} removed (was ${was})` });
  return out;
}
