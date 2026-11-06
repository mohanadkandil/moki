// Edits on a chip-level plan: the same operations whether a person drew them or the Editor proposed them.
// Pure, given the block library. An op that can't apply stops there; one that applies but leaves the plan
// failing its checks still returns the plan, so a half-wired draft can be drawn.
import type { BlockDef, BoardPlan, GateResult } from '../blocks/contract.js';
import { applyPlanOps, type DesignOp } from './edits.js';
import type { SheetGraph } from './protocol.js';

/** A net as a plan sees it: its name now, and the ports on it. */
export interface PlanNet { name: string; ports?: string[] }

export interface PlanEditTools {
  blocks: readonly BlockDef[];
  check(plan: BoardPlan, blocks: BlockDef[]): GateResult[];
  graph?(plan: BoardPlan, blocks: BlockDef[]): SheetGraph;
  nets?(plan: BoardPlan, blocks: BlockDef[]): PlanNet[];
}

export type PlanEdit =
  | { ok: true; plan: BoardPlan; changes: string[]; warnings: string[] }
  | { ok: false; reason: string; opIndex: number }
  | { ok: false; reason: string; plan: BoardPlan; changes: string[]; warnings: string[] };

const describe = (op: DesignOp, title?: string): string => {
  switch (op.op) {
    case 'add_block': return `Added ${title ?? op.block} as ${op.inst}`;
    case 'remove_block': return `Removed ${op.inst}`;
    case 'link': return `Linked ${op.from} to ${op.to}`;
    case 'unlink': return `Unlinked ${op.from} from ${op.to}`;
    case 'set_value': return `Set ${op.part} to ${op.value}`;
    case 'add_note': return 'Added a note';
    case 'remove_note': return 'Removed a note';
    case 'rename_net': return `Renamed ${op.net} to ${op.name}`;
    default: return op.op;
  }
};

/** Fills in what only the library knows, or says in plain words why this op can't be done. */
function prepare(op: DesignOp, plan: BoardPlan, tools: PlanEditTools): { op: DesignOp; title?: string } | { refused: string } {
  const blocks = tools.blocks as BlockDef[];
  const defOf = (inst: string) => {
    const instance = plan.blocks.find(b => b.inst === inst);
    return instance && blocks.find(b => b.id === instance.block && b.version === instance.version);
  };
  switch (op.op) {
    case 'add_block': {
      const revisions = blocks.filter(b => b.id === op.block);
      const def = op.version === undefined ? revisions.reduce<BlockDef | undefined>((best, b) => (!best || b.version > best.version ? b : best), undefined) : revisions.find(b => b.version === op.version);
      if (!def) return { refused: `There’s no block called ${op.block}${op.version === undefined ? '' : `, version ${op.version},`} in the library.` };
      return { op: { ...op, version: def.version }, title: def.title };
    }
    case 'remove_part': {
      const part = tools.graph?.(plan, blocks).parts.find(p => p.ref === op.id);
      if (!part) return { refused: `There’s no part ${op.id} on this board.` };
      const def = defOf(part.inst);
      if (def?.parts.length === 1) return { op: { op: 'remove_block', inst: part.inst } };
      return { refused: `${op.id} is part of the ${def?.title ?? part.inst} block. Remove the whole block, or change its values.` };
    }
    case 'set_value': {
      const [inst, param] = op.part.split('.');
      const def = inst ? defOf(inst) : undefined;
      if (def && param && !def.params.some(p => p.id === param)) return { refused: `${def.title} has no setting called ${param}.` };
      return { op };
    }
    case 'rename_net': {
      const nets = tools.nets?.(plan, blocks) ?? [];
      const net = nets.find(n => n.name === op.net);
      if (!net) return { refused: `There’s no net called ${op.net} on this board.` };
      if (!net.ports?.length) return { refused: `${op.net} is inside a block, so its name comes from that block.` };
      if (op.name !== op.net && nets.some(n => n.name === op.name)) return { refused: `There’s already a net called ${op.name}.` };
      // A net renamed twice keeps one entry, on the port it already had.
      const port = net.ports.find(p => plan.netNames?.[p]) ?? net.ports[0]!;
      return { op: { op: 'rename_net', net: port, name: op.name } };
    }
    default: return { op };
  }
}

/** The new section says what the block is, not just its id. */
function nameSection(plan: BoardPlan, op: DesignOp, blocks: readonly BlockDef[]): BoardPlan {
  if (op.op !== 'add_block' || op.section) return plan;
  const def = blocks.find(b => b.id === op.block && b.version === op.version);
  if (!def || !plan.sections) return plan;
  return { ...plan, sections: plan.sections.map(s => (s.id === op.inst ? { ...s, title: def.title.slice(0, 80), purpose: def.summary.slice(0, 240) } : s)) };
}

const BOARD_MARGIN_MM = 6;

/**
 * A new block on a board of fixed size needs a place on it, or layout fails after every other gate has run.
 * This takes the spot furthest from everything already there; layout legalizes the rest. Placement isn't part
 * of the reviewed circuit, so it never costs a review.
 */
function placeOnBoard(plan: BoardPlan, inst: string, blocks: readonly BlockDef[]): BoardPlan {
  const board = plan.board;
  const instance = plan.blocks.find(b => b.inst === inst);
  const defOf = (i: BoardPlan['blocks'][number]) => blocks.find(b => b.id === i.block && b.version === i.version);
  const def = instance && defOf(instance);
  const others = plan.blocks.filter(b => b.inst !== inst);
  if (!board || !instance || instance.at || !def || others.some(b => !b.at)) return plan;
  const taken = others.flatMap(other => {
    const angle = ((other.at!.rotation ?? 0) * Math.PI) / 180;
    return (defOf(other)?.parts ?? []).map(p => [other.at!.x + p.at.x * Math.cos(angle) - p.at.y * Math.sin(angle), other.at!.y + p.at.x * Math.sin(angle) + p.at.y * Math.cos(angle)] as const);
  });
  const halfW = board.widthMm / 2 - BOARD_MARGIN_MM, halfH = board.heightMm / 2 - BOARD_MARGIN_MM;
  let best: { x: number; y: number; clear: number } | null = null;
  for (let y = -halfH; y <= halfH; y += 2) for (let x = -halfW; x <= halfW; x += 2) {
    const own = def.parts.map(p => [x + p.at.x, y + p.at.y] as const);
    if (own.some(([px, py]) => Math.abs(px) > halfW || Math.abs(py) > halfH)) continue;
    const clear = Math.min(Infinity, ...own.flatMap(([px, py]) => taken.map(([tx, ty]) => Math.hypot(px - tx, py - ty))));
    if (!best || clear > best.clear) best = { x, y, clear };
  }
  if (!best) return plan;
  const at = { x: best.x, y: best.y };
  return { ...plan, blocks: plan.blocks.map(b => (b.inst === inst ? { ...b, at } : b)) };
}

export function editPlan(plan: BoardPlan, ops: readonly DesignOp[], tools: PlanEditTools): PlanEdit {
  if (!ops.length) return { ok: false, reason: 'There’s nothing to change yet.', opIndex: 0 };
  let next = plan;
  const changes: string[] = [];
  for (const [index, raw] of ops.entries()) {
    const ready = prepare(raw, next, tools);
    if ('refused' in ready) return { ok: false, reason: ready.refused, opIndex: index };
    const applied = applyPlanOps(next, [ready.op]);
    if ('error' in applied) return { ok: false, reason: applied.error, opIndex: index };
    next = nameSection(applied.plan, ready.op, tools.blocks);
    if (ready.op.op === 'add_block') next = placeOnBoard(next, ready.op.inst, tools.blocks);
    changes.push(describe(raw.op === 'rename_net' ? raw : ready.op, ready.title));
  }
  const gates = tools.check(next, tools.blocks as BlockDef[]);
  const issues = gates.flatMap(g => g.issues);
  const warnings = [...new Set(issues.filter(i => i.severity === 'warning').map(i => i.message))].slice(0, 5);
  const failed = issues.find(i => i.severity === 'error');
  return failed ? { ok: false, reason: failed.message, plan: next, changes, warnings } : { ok: true, plan: next, changes, warnings };
}
