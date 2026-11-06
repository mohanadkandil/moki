// The server side of schematic edits: applies operations to a saved board, decides, and lists what can be added.
// The job API calls this. Nothing here builds anything.
import { applyDesignOps, MAX_DRAFT_OPS, parseOps, type DesignOp } from '../src/agents/edits.js';
import { sheetGraph } from '../src/agents/chip-library.js';
import { editPlan } from '../src/agents/plan-edit.js';
import type { SheetGraph } from '../src/agents/protocol.js';
import { applyChange } from '../src/agents/roles.js';
import type { BlockDef, BoardPlan } from '../src/blocks/contract.js';
import { planGraph } from '../src/blocks/graph.js';
import { checkPlan, listBlocks, resolvePlanBlocks } from '../src/blocks/library.js';
import { checkSchematicReview } from '../src/blocks/review.js';
import { CATALOG } from '../src/circuit/catalog.js';
import type { CircuitDesign } from '../src/circuit/model.js';

export type OpsBase = { kind: 'design'; design: CircuitDesign } | { kind: 'plan'; plan: BoardPlan };

export interface OpsCheck {
  ok: boolean;
  /** One sentence a maker can read. */
  reason?: string;
  /** Which op can't apply at all. Absent when the ops applied but the result fails its checks. */
  opIndex?: number;
  changes: string[];
  warnings: string[];
  design?: CircuitDesign;
  plan?: BoardPlan;
  graph?: SheetGraph;
  /** Only chip plans: no independent review matches this exact plan yet, so the job worker wouldn't route it. */
  needsReview?: boolean;
}

const refused = (reason: string, opIndex: number): OpsCheck => ({ ok: false, reason, opIndex, changes: [], warnings: [] });

function parsed(value: unknown): { ops: DesignOp[] } | OpsCheck {
  const result = parseOps(value, MAX_DRAFT_OPS);
  if ('ops' in result) return result;
  const at = /^ops\[(\d+)\]: (.*)$/s.exec(result.error);
  return at ? refused(at[2]!, Number(at[1])) : refused(result.error, 0);
}

/** The validators can list a lot, and their firmware check speaks in header files. A maker gets one sentence. */
function oneSentence(error: string, ops: DesignOp[]): string {
  const text = error.replace(/^That change fails validation: /, '');
  if (/^Firmware generator:|isn.t available for this design/.test(text)) {
    const removed = ops.find((op): op is Extract<DesignOp, { op: 'remove_part' }> => op.op === 'remove_part');
    return `This device’s firmware uses ${removed ? removed.id : 'that part'}. Ask the agent to change the firmware first.`;
  }
  return /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text;
}

function checkDesignOps(design: CircuitDesign, ops: DesignOp[], raw: unknown): OpsCheck {
  let next = design;
  for (const [index, op] of ops.entries()) {
    const applied = applyDesignOps(next, [op]);
    if ('error' in applied) return refused(applied.error, index);
    next = applied.design;
  }
  // The Editor's own rules, so a person and an agent can't get different answers.
  const change = applyChange(design, { ops: raw }, undefined, MAX_DRAFT_OPS);
  if ('error' in change) return { ok: false, reason: oneSentence(change.error, ops), changes: [], warnings: [], design: next };
  return { ok: true, changes: change.changes, warnings: [], design: change.design };
}

function checkPlanOps(plan: BoardPlan, ops: DesignOp[]): OpsCheck {
  const blocks = (at: BoardPlan) => resolvePlanBlocks(at);
  const draw = (at: BoardPlan, defs: BlockDef[]) => sheetGraph(planGraph(at, defs));
  const edit = editPlan(plan, ops, { blocks: blocks(plan), check: (at, defs) => checkPlan(at, defs), graph: draw, nets: (at, defs) => planGraph(at, defs).nets });
  if (!('plan' in edit)) return refused(edit.reason, edit.opIndex);
  // A half-wired draft may not be drawable yet. It's still the right answer, without a picture.
  let graph: SheetGraph | undefined;
  try { graph = draw(edit.plan, blocks(edit.plan)); } catch { /* Not drawable yet. */ }
  const shown = { changes: edit.changes, warnings: edit.warnings, plan: edit.plan, ...(graph ? { graph } : {}) };
  if (!edit.ok) return { ok: false, reason: edit.reason, ...shown };
  const needsReview = !checkSchematicReview(edit.plan, blocks(edit.plan)).ok;
  return { ok: true, ...shown, needsReview, ...(needsReview ? { warnings: [...edit.warnings, 'A second agent has to check this change against the datasheets before it can be built.'] } : {}) };
}

/** The board as it stands, so every sheet can be drawn from one source. Asks nothing of the checks: it's already built. */
function asItStands(base: OpsBase): OpsCheck {
  if (base.kind === 'design') return { ok: true, changes: [], warnings: [], design: base.design };
  let graph: SheetGraph | undefined;
  try { graph = sheetGraph(planGraph(base.plan, resolvePlanBlocks(base.plan))); } catch { /* The client falls back when there's no drawing. */ }
  return { ok: true, changes: [], warnings: [], plan: base.plan, ...(graph ? { graph } : {}) };
}

/** Dry run: what these operations would do to this board. With no operations, the board as it stands. */
export function checkOps(base: OpsBase, value: unknown): OpsCheck {
  const list = parsed(value);
  if (!('ops' in list)) return list;
  if (!list.ops.length) return asItStands(base);
  return base.kind === 'design' ? checkDesignOps(base.design, list.ops, value) : checkPlanOps(base.plan, list.ops);
}

export interface LibraryListing {
  modules: { id: string; name: string; category: string; pins: number }[];
  blocks: { id: string; version: number; title: string; summary: string; class: string; status: string; parts: number; ports: { id: string; label: string; kind: string }[]; params: { id: string; type: string; min?: number; max?: number; options?: string[]; unit?: string; default: number | string }[] }[];
}

/** Catalog modules for a carrier board, and the latest revision of each block for a chip board. Null for a mode that doesn't exist. */
export function libraryListing(mode: string | null, query: string | null): LibraryListing | null {
  if (mode !== null && mode !== 'carrier' && mode !== 'chip') return null;
  const q = (query ?? '').trim().toLowerCase().slice(0, 80);
  const matches = (...words: string[]) => !q || words.join(' ').toLowerCase().includes(q);
  return {
    modules: mode === 'chip' ? [] : [...CATALOG.values()].filter(m => matches(m.id, m.name, m.category)).map(m => ({ id: m.id, name: m.name, category: m.category, pins: m.pins.length })),
    blocks: mode === 'carrier' ? [] : listBlocks().filter(b => matches(b.id, b.title, b.summary, b.class)).map(b => ({
      id: b.id, version: b.version, title: b.title, summary: b.summary, class: b.class, status: b.status, parts: b.parts.length,
      ports: b.ports.map(p => ({ id: p.id, label: p.label, kind: p.kind })),
      params: b.params.map(p => ({ id: p.id, type: p.type, ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}), ...(p.options ? { options: p.options } : {}), ...(p.unit ? { unit: p.unit } : {}), default: p.default })),
    })),
  };
}
