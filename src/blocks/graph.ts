import type { BlockDef, BlockPart, BoardPlan, Pose } from './contract.js';

export interface PlacedPart {
  ref: string;
  inst: string;
  localRef: string;
  block: BlockDef;
  part: BlockPart;
  at: Pose;
}
export interface PlanGraph {
  parts: PlacedPart[];
  nets: Array<{ name: string; pins: Array<{ ref: string; logical: string; pad: string }>; /** The ports on this net, as a plan names them. */ ports?: string[] }>;
}
class Union {
  parents = new Map<string, string>();
  find(s: string): string {
    if (!this.parents.has(s)) this.parents.set(s, s);
    const p = this.parents.get(s)!;
    if (p === s) return s;
    const root = this.find(p);
    this.parents.set(s, root);
    return root;
  }
  join(a: string, b: string) {
    this.parents.set(this.find(a), this.find(b));
  }
}
/** A chip net's name becomes part of a source selector, so it stays a plain identifier. */
export const CHIP_NET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** Materialize only validated data; electrical aliases never depend on matching display names. */
export function planGraph(plan: BoardPlan, definitions: BlockDef[]): PlanGraph {
  const u = new Union(),
    parts: PlacedPart[] = [],
    refs = new Set<string>(),
    endpoint = new Map<string, string[]>(),
    names = new Map<string, string[]>();
  const prefixCount = new Map<string, number>();
  const allocate = (wanted: string) => {
    if (!refs.has(wanted)) {
      refs.add(wanted);
      return wanted;
    }
    const prefix = wanted.match(/^[A-Za-z_]+/)?.[0] ?? 'U';
    let n = prefixCount.get(prefix) ?? 1;
    while (refs.has(`${prefix}${n}`)) n++;
    prefixCount.set(prefix, n + 1);
    refs.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  };
  // Reserve every globally unique original reference, so repeats cannot steal a later name.
  const occurrences = new Map<string, number>();
  for (const i of plan.blocks) {
    const b = definitions.find((b) => b.id === i.block && b.version === i.version);
    if (!b) throw new Error(`Unknown block ${i.block}`);
    for (const p of b.parts) occurrences.set(p.ref, (occurrences.get(p.ref) ?? 0) + 1);
  }
  for (const [ref, n] of occurrences) if (n === 1) refs.add(ref);
  plan.blocks.forEach((i, index) => {
    const b = definitions.find((b) => b.id === i.block && b.version === i.version)!;
    const pose = i.at ?? { x: ((index % 3) - 1) * 34, y: -Math.floor(index / 3) * 32 };
    const angle = ((pose.rotation ?? 0) * Math.PI) / 180;
    const token = (t: string) => `${i.inst}:${t}`;
    for (const p of b.parts) {
      const ref = occurrences.get(p.ref) === 1 ? p.ref : allocate(p.ref);
      parts.push({
        ref,
        inst: i.inst,
        localRef: p.ref,
        block: b,
        part: p,
        at: {
          x: pose.x + p.at.x * Math.cos(angle) - p.at.y * Math.sin(angle),
          y: pose.y + p.at.x * Math.sin(angle) + p.at.y * Math.cos(angle),
          rotation: (pose.rotation ?? 0) + (p.at.rotation ?? 0),
        },
      });
      for (const id of Object.keys(p.pins)) u.find(token(`${p.ref}.${id}`));
    }
    for (const n of b.nets) {
      const net = token(`net:${n.name}`);
      names.set(net, [n.name, i.inst]);
      for (const pin of n.pins) u.join(net, token(pin));
    }
    for (const p of b.ports) {
      const entries = p.bus ? Object.entries(p.bus.signals) : [['', p.terminal!]];
      for (const [signal, terminal] of entries) {
        const key = `${i.inst}.${p.id}${signal ? '.' + signal : ''}`;
        endpoint.set(key, [token(terminal!)]);
      }
    }
  });
  for (const l of plan.links) {
    const directA = endpoint.get(l.from),
      directB = endpoint.get(l.to);
    if (directA && directB) {
      u.join(directA[0]!, directB[0]!);
      continue;
    }
    const a = [...endpoint].filter(([k]) => k.startsWith(l.from + '.'));
    for (const [key, nodes] of a) {
      const suffix = key.slice(l.from.length);
      const peer = endpoint.get(l.to + suffix);
      if (!peer) throw new Error(`Unmatched bus link ${l.from} -> ${l.to}`);
      u.join(nodes[0]!, peer[0]!);
    }
  }
  // A person's names. A name goes with its net, and a net has one name.
  const chosen = new Map<string, string>();
  for (const [port, name] of Object.entries(plan.netNames ?? {})) {
    const terminal = endpoint.get(port);
    if (!terminal) throw new Error(`${port} is named in netNames, but it isn't a port on this board`);
    if (!CHIP_NET_NAME.test(name)) throw new Error(`${name} can't be a net name. Use letters, digits and underscores, starting with a letter.`);
    const root = u.find(terminal[0]!);
    const named = chosen.get(root);
    if (named && named !== name) throw new Error(`One net can't be called both ${named} and ${name}.`);
    if ([...chosen].some(([other, n]) => n === name && other !== root)) throw new Error(`Two nets can't both be called ${name}.`);
    chosen.set(root, name);
  }
  const taken = new Set(chosen.values());
  const groups = new Map<string, PlanGraph['nets'][number]['pins']>();
  const grounds = new Set<string>();
  for (const p of parts)
    for (const [logical, pin] of Object.entries(p.part.pins)) {
      if (pin.role === 'nc') continue;
      const root = u.find(`${p.inst}:${p.localRef}.${logical}`);
      if (pin.role === 'ground') grounds.add(root);
      const pins = groups.get(root) ?? [];
      pins.push({ ref: p.ref, logical, pad: pin.pad });
      groups.set(root, pins);
    }
  const used = new Set<string>();
  const nets: PlanGraph['nets'] = [];
  for (const [root, pins] of groups) {
    const labels = [...names]
      .filter(([t]) => u.find(t) === root)
      .map(([, n]) => n)
      .sort((a, b) => a[0]!.localeCompare(b[0]!));
    const own = chosen.get(root);
    if (own && grounds.has(root)) throw new Error('The ground net keeps its own name, because the ground pour is built from it.');
    if (!own && !labels.length && pins.length === 1) continue;
    let name = own ?? labels[0]?.[0] ?? `N_${pins[0]!.ref}_${pins[0]!.logical}`;
    if (!own) {
      if (used.has(name) || taken.has(name)) name = `${labels[0]?.[1] ?? 'local'}_${name}`;
      while (used.has(name) || taken.has(name)) name += '_';
    }
    used.add(name);
    const ports = [...endpoint].filter(([, terminals]) => u.find(terminals[0]!) === root).map(([port]) => port).sort();
    nets.push({ name, pins, ...(ports.length ? { ports } : {}) });
  }
  return { parts, nets };
}

/** What's wrong with a plan's own net names, in one sentence each. ERC reports these. */
export function netNameIssues(plan: BoardPlan, definitions: BlockDef[]): string[] {
  if (!plan.netNames || !Object.keys(plan.netNames).length) return [];
  try {
    planGraph(plan, definitions);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
