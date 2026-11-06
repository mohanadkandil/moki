import { createElement as e, cloneElement, isValidElement } from 'react';
import type { PlanGraph } from '../../src/blocks/graph.js';

const TARGET_LCSCS = new Set(['C2861252', 'C28060', 'C910544']);
const BOARD_ELEMENTS = new Set(['net', 'trace', 'copperpour', 'keepout', 'autoroutingphase', 'board', 'breakout', 'fanout', 'group']);

/** Reparent whole compiler block instances for native automatic fanout.
 * The target IC supplies the group's world anchor, with group rotation zero.
 * Child components receive local offsets; their world poses, footprint, pin and
 * supplier props remain unchanged. Trace/net objects are retained unchanged.
 * Core calculates its boundary from positioned children plus1mm padding.
 * Nets wholly inside one target instance move with it; shared nets, pours,
 * keepouts and other board elements stay on the board.
 * This tree operation proves no native exit creation or routing success: callers
 * must inspect actual breakout points, placement, netlist, DRC and copper output.
 */
export function organizeNativeBreakouts(nodes: readonly any[], graph: PlanGraph) {
  if (!Array.isArray(nodes) || !graph || !Array.isArray(graph.parts) || !Array.isArray(graph.nets)) throw new Error('Native breakouts require flat nodes and an actual plan graph');
  const byRef = new Map<string, PlanGraph['parts'][number]>();
  for (const part of graph.parts) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(part.ref) || !part.inst || byRef.has(part.ref)) throw new Error('Native breakouts require globally unique component references and block instances');
    byRef.set(part.ref, part);
  }
  const instances = [...new Set(graph.parts.filter((part) => TARGET_LCSCS.has(part.part.lcsc)).map((part) => part.inst))];
  const groups = new Map(instances.map((inst, index) => {
    const anchor = graph.parts.find((part) => part.inst === inst && TARGET_LCSCS.has(part.part.lcsc))!;
    if (!Number.isFinite(anchor.at.x) || !Number.isFinite(anchor.at.y)) throw new Error(`Native breakout ${inst} lacks a finite target IC anchor`);
    const group = { inst, anchor, name: `compiler_breakout_${index + 1}`, children: [] as any[], partRefs: [] as string[], traceCount: 0, boardCrossGroupTraceCount: 0, netNames: [] as string[] };
    return [inst, group] as const;
  }));
  const netOwner = new Map<string, string>(), graphNetNames = new Set<string>();
  for (const net of graph.nets) {
    if (!net.name || graphNetNames.has(net.name) || !Array.isArray(net.pins) || !net.pins.length || net.pins.some((pin) => !byRef.has(pin.ref))) throw new Error('Native breakouts require unique actual graph nets and known endpoint references');
    graphNetNames.add(net.name);
    const owners = new Set(net.pins.map((pin) => byRef.get(pin.ref)!.inst));
    if (owners.size === 1 && groups.has([...owners][0]!)) netOwner.set(net.name, [...owners][0]!);
  }
  const nativePartCounts = new Map<string, number>();
  const nativeNetCounts = new Map<string, number>();
  const ownership = new Map<number, string>();
  const existingNames = new Set(nodes.filter((node) => isValidElement(node)).map((node) => (node as any).props?.name));
  for (const group of groups.values()) if (existingNames.has(group.name)) throw new Error(`Native breakout name ${group.name} already exists`);
  const fromReference = (selector: unknown) => {
    if (typeof selector !== 'string') return undefined;
    const direct = selector.trim().match(/^\.?([A-Za-z][A-Za-z0-9_]*)\s*>\s*\.?[A-Za-z0-9_]+$/) ?? selector.trim().match(/^\.?([A-Za-z][A-Za-z0-9_]*)\.[A-Za-z0-9_]+$/);
    return direct?.[1];
  };
  for (const [index, node] of nodes.entries()) {
    if (!isValidElement(node)) continue;
    const element = node as any, props = element.props ?? {};
    let inst: string | undefined, groupedNode = node;
    if (element.type === 'net') {
      nativeNetCounts.set(props.name, (nativeNetCounts.get(props.name) ?? 0) + 1);
      inst = netOwner.get(props.name);
      if (inst) groups.get(inst)!.netNames.push(props.name);
    } else if (element.type === 'trace') {
      const selectors = [props.from, props.to, ...(Array.isArray(props.path) ? props.path : [])];
      const owners = new Set(selectors.flatMap((selector) => {
        const ref = fromReference(selector), part = ref ? byRef.get(ref) : undefined;
        return part && groups.has(part.inst) ? [part.inst] : [];
      }));
      if (owners.size === 1) {
        inst = [...owners][0]!;
        groups.get(inst)!.traceCount++;
      } else if (owners.size > 1) {
        // Native auto-boundary detection needs both target groups visible from
        // this board-level trace; assigning it to either would bias ownership.
        for (const owner of owners) groups.get(owner)!.boardCrossGroupTraceCount++;
      }
    } else if (!BOARD_ELEMENTS.has(element.type)) {
      const part = byRef.get(props.name);
      if (part) {
        nativePartCounts.set(part.ref, (nativePartCounts.get(part.ref) ?? 0) + 1);
        if (groups.has(part.inst)) {
          if (!Number.isFinite(props.pcbX) || !Number.isFinite(props.pcbY) || Math.abs(props.pcbX - part.at.x) > 1e-6 || Math.abs(props.pcbY - part.at.y) > 1e-6 || Math.abs((props.pcbRotation ?? 0) - (part.at.rotation ?? 0)) > 1e-6) throw new Error(`Native part ${part.ref} lacks its actual fixed compiler world pose`);
          inst = part.inst;
          groups.get(inst)!.partRefs.push(part.ref);
          const anchor = groups.get(inst)!.anchor.at;
          groupedNode = cloneElement(element, { pcbX: props.pcbX - anchor.x, pcbY: props.pcbY - anchor.y });
        }
      }
    }
    if (inst) {
      ownership.set(index, inst);
      groups.get(inst)!.children.push(groupedNode);
    }
  }
  for (const part of graph.parts) {
    if (groups.has(part.inst) && nativePartCounts.get(part.ref) !== 1) throw new Error(`Native breakout must resolve exactly one original part node for ${part.ref}`);
    if ((nativePartCounts.get(part.ref) ?? 0) > 1) throw new Error(`Duplicate native component reference ${part.ref}`);
  }
  for (const name of netOwner.keys()) if (nativeNetCounts.get(name) !== 1) throw new Error(`Native breakout must resolve exactly one original net node for ${name}`);
  const emitted = new Set<string>(), output: any[] = [];
  const audit = instances.map((inst) => {
    const group = groups.get(inst)!;
    if (!group.partRefs.length || (!group.traceCount && !group.boardCrossGroupTraceCount)) throw new Error(`Native breakout instance ${inst} has no complete part/trace cluster`);
    return { inst, name: group.name, anchorRef: group.anchor.ref, targetLcscs: graph.parts.filter((part) => part.inst === inst && TARGET_LCSCS.has(part.part.lcsc)).map((part) => part.part.lcsc), partRefs: [...group.partRefs], traceCount: group.traceCount, boardCrossGroupTraceCount: group.boardCrossGroupTraceCount, netCount: group.netNames.length, netNames: [...group.netNames], originalPartPoses: graph.parts.filter((part) => part.inst === inst).map((part) => ({ ref: part.ref, ...part.at })), relativePartPoses: graph.parts.filter((part) => part.inst === inst).map((part) => ({ ref: part.ref, x: part.at.x - group.anchor.at.x, y: part.at.y - group.anchor.at.y, rotation: part.at.rotation ?? 0 })), transform: { pcbX: group.anchor.at.x, pcbY: group.anchor.at.y, pcbRotation: 0 }, padding: '3mm', autorouter: 'auto', fanoutPourNetMap: { bottom: 'GND' }, requiresNativePlacementNetlistDrcAndCopperChecks: true };
  });
  for (const [index, node] of nodes.entries()) {
    const inst = ownership.get(index);
    if (!inst) { output.push(node); continue; }
    if (emitted.has(inst)) continue;
    emitted.add(inst);
    const group = groups.get(inst)!;
    output.push(e('breakout', { name: group.name, pcbX: group.anchor.at.x, pcbY: group.anchor.at.y, pcbRotation: 0, autorouter: 'auto', padding: '3mm', fanoutPourNetMap: { bottom: 'GND' } }, ...group.children));
  }
  return { nodes: output, audit };
}
