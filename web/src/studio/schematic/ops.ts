// Edits are operations on the design. A draft is a list of them, grouped in undoable steps. Nothing here draws.
import { CATALOG, moduleDef } from '../../../../src/circuit/catalog';
import type { CircuitDesign, NetKind } from '../../../../src/circuit/model';
import { checkDesign, type GraphIssue } from '../../../../src/circuit/validate';
import type { BoardPlan } from '../../../../src/blocks/contract';
import { applyDesignOps, applyPlanOps, type DesignOp } from '../../../../src/agents/edits';
import type { DraftMark } from './layout';
import type { Sheet, SheetGraph } from './sheet';

export type SheetOp = DesignOp;

export interface Draft { steps: readonly (readonly SheetOp[])[]; undone: readonly (readonly SheetOp[])[] }
export const NO_DRAFT: Draft = { steps: [], undone: [] };
export const draftOps = (draft: Draft): SheetOp[] => draft.steps.flat();
export const undoDraft = (draft: Draft): Draft => (draft.steps.length ? { steps: draft.steps.slice(0, -1), undone: [...draft.undone, draft.steps.at(-1)!] } : draft);
export const redoDraft = (draft: Draft): Draft => (draft.undone.length ? { steps: [...draft.steps, draft.undone.at(-1)!], undone: draft.undone.slice(0, -1) } : draft);

export const applyOps = (design: CircuitDesign, ops: readonly SheetOp[]) => applyDesignOps(design, [...ops]);

// What a half-finished edit is allowed to look like. Each of these is fixed by the next wire. Anything else is wrong now.
const STILL_WIRING: ReadonlySet<GraphIssue['code']> = new Set(['required-unconnected', 'net-too-small', 'signal-without-gpio', 'power-source']);

/** Takes the step, or says why not, in a sentence. */
export function tryStep(base: CircuitDesign, draft: Draft, step: readonly SheetOp[]): { draft: Draft; design: CircuitDesign } | { refused: string } {
  const applied = applyOps(base, [...draftOps(draft), ...step]);
  if ('error' in applied) return { refused: applied.error };
  const before = new Set(checkDesign(base).map(i => i.message));
  const wrong = checkDesign(applied.design).find(i => !STILL_WIRING.has(i.code) && !before.has(i.message));
  if (wrong) return { refused: wrong.message };
  return { draft: { steps: [...draft.steps, step], undone: [] }, design: applied.design };
}

/**
 * The plan a chip draft makes, as far as the browser can tell. A rename is left to the server: the op names a net
 * as a person sees it, and only the server can find which port that is.
 */
export function planAfter(base: BoardPlan, ops: readonly SheetOp[]) {
  return applyPlanOps(base, ops.filter(op => op.op !== 'rename_net'));
}

/** On a chip board the local applier only catches what can't apply at all. The plan's checks run on the server. */
export function tryPlanStep(base: BoardPlan, draft: Draft, step: readonly SheetOp[]): { draft: Draft; plan: BoardPlan } | { refused: string } {
  const applied = planAfter(base, [...draftOps(draft), ...step]);
  if ('error' in applied) return { refused: applied.error };
  return { draft: { steps: [...draft.steps, step], undone: [] }, plan: applied.plan };
}

/** The server said the last step can't apply. It's gone, and redo can't bring it back. */
export const dropLastStep = (draft: Draft): Draft => ({ steps: draft.steps.slice(0, -1), undone: draft.undone });

/** A name for another copy of a block, unique on this plan. */
export function nextInst(blockId: string, taken: readonly string[]): string {
  const clean = blockId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 34);
  const base = /^[A-Za-z_]/.test(clean) ? clean : `b-${clean}`;
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Only the parts of blocks still on the plan, so a removed block's parts don't come back as a section of their own. */
export function graphForPlan(graph: SheetGraph, plan: Pick<BoardPlan, 'blocks'>): SheetGraph {
  const insts = new Set(plan.blocks.map(b => b.inst));
  return { ...graph, parts: graph.parts.filter(p => insts.has(p.inst)) };
}

/** What the plan's links did since the base, by port. */
export function portMarksOf(base: Sheet, next: Sheet): Map<string, DraftMark> {
  const marks = new Map<string, DraftMark>();
  const linksIn = (sheet: Sheet) => new Map(sheet.sections.flatMap(s => s.ports ?? []).map(p => [p.key, p.links]));
  const before = linksIn(base);
  for (const [key, links] of linksIn(next)) {
    const had = before.get(key);
    if (!had) continue;
    if (links.some(l => !had.includes(l))) marks.set(key, 'added');
    else if (had.some(l => !links.includes(l))) marks.set(key, 'removed');
  }
  return marks;
}

/** What still has to be true before a rebuild is worth starting. Empty means the draft can go to the server. */
export function blockers(base: CircuitDesign, next: CircuitDesign): string[] {
  const before = new Set(checkDesign(base).map(i => i.message));
  return checkDesign(next).filter(i => !before.has(i.message)).map(i => i.message);
}

const PREFIX: Readonly<Record<string, string>> = { resistor: 'R', led: 'D', ldr: 'LDR', piezo: 'BZ' };
export function nextRef(moduleId: string, taken: readonly string[]): string {
  const def = moduleDef(moduleId);
  const prefix = PREFIX[def.symbol] ?? (def.category === 'input' ? 'SW' : 'U');
  let n = 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** A net a new wire can name, unique against what's there. */
export function nameForWire(design: CircuitDesign, part: string, label: string): string {
  const base = `${part}_${label}`.replace(/[^A-Za-z0-9_+.-]/g, '_').slice(0, 20);
  let name = base;
  let n = 2;
  while (design.nets.some(net => net.name === name || net.id === name)) name = `${base}_${n++}`;
  return name;
}

interface PinAt { part: string; pin: string; net: string | null }

/** Joining two pins: onto whichever net already exists, or a new one. Two different nets are a real question, so that's refused. */
export function wireOps(design: CircuitDesign, a: PinAt, b: PinAt): SheetOp[] | { refused: string } {
  if (a.part === b.part && a.pin === b.pin) return { refused: 'That’s the same pin.' };
  if (a.net && a.net === b.net) return { refused: 'Those pins are already connected.' };
  if (a.net && b.net) {
    const [x, y] = [design.nets.find(n => n.id === a.net)?.name ?? a.net, design.nets.find(n => n.id === b.net)?.name ?? b.net];
    return { refused: `${a.part}.${a.pin} is on ${x} and ${b.part}.${b.pin} is on ${y}. Disconnect one first.` };
  }
  const on = a.net ?? b.net;
  if (on) { const loose = a.net ? b : a; return [{ op: 'connect', net: on, endpoints: [{ part: loose.part, pin: loose.pin }] }]; }
  const kind = wireKind(design, a) ?? wireKind(design, b) ?? 'signal';
  return [{ op: 'connect', net: nameForWire(design, a.part, a.pin), endpoints: [{ part: a.part, pin: a.pin }, { part: b.part, pin: b.pin }], kind, why: 'Connected on the schematic.' }];
}

function wireKind(design: CircuitDesign, at: PinAt): NetKind | null {
  const module = design.parts.find(p => p.id === at.part)?.module;
  const pin = CATALOG.get(module ?? '')?.pins.find(p => p.id === at.pin);
  if (pin?.kind === 'ground') return 'ground';
  if (pin?.kind === 'power-in' || pin?.kind === 'power-out') return 'power';
  return null;
}

export function describeOp(op: SheetOp, design: CircuitDesign | null): string {
  const nameOf = (id: string) => design?.nets.find(n => n.id === id || n.name === id)?.name ?? id;
  switch (op.op) {
    case 'add_part': return `Add ${op.id} · ${CATALOG.get(op.module)?.name ?? op.module}`;
    case 'remove_part': return `Remove ${op.id}`;
    case 'connect': return `Connect ${op.endpoints.map(e => `${e.part}.${e.pin}`).join(', ')} to ${nameOf(op.net)}`;
    case 'disconnect': return `Disconnect ${op.part}.${op.pin} from ${nameOf(op.net)}`;
    case 'rename_net': return `Rename ${nameOf(op.net)} to ${op.name}`;
    case 'set_value': return `Set ${op.part} to ${op.value}`;
    case 'add_note': return `Add a note${op.part ? ` on ${op.part}` : ''}`;
    case 'remove_note': return 'Remove a note';
    case 'set_pin': return `Move ${nameOf(op.net)} to GPIO${op.gpio}`;
    case 'set_behavior': return `Set ${op.label} to ${op.value}`;
    case 'remove_behavior': return `Remove ${op.label}`;
    case 'add_block': return `Add ${op.inst}`;
    case 'remove_block': return `Remove block ${op.inst}`;
    case 'link': return `Link ${op.from} to ${op.to}`;
    case 'unlink': return `Unlink ${op.from} from ${op.to}`;
  }
}

/** A draft's sheet keeps what it removed, ghosted where it was, and marks what's new. */
export function draftOverlay(base: Sheet, next: Sheet): { sheet: Sheet; marks: Map<string, DraftMark>; pinMarks: Map<string, { mark: DraftMark; was?: string }> } {
  const marks = new Map<string, DraftMark>();
  const pinMarks = new Map<string, { mark: DraftMark; was?: string }>();
  const nameOf = (s: Sheet, id: string | null) => (id ? s.nets.find(n => n.id === id)?.name ?? id : undefined);
  const wasIn = new Map(base.parts.map(p => [p.ref, p]));
  // A section the base didn't have is new as a whole, whether or not its parts are drawn yet.
  for (const section of next.sections) if (!base.sections.some(s => s.id === section.id)) marks.set(`section:${section.id}`, 'added');
  for (const part of next.parts) {
    const before = wasIn.get(part.ref);
    if (!before) { marks.set(part.ref, 'added'); continue; }
    for (const pin of part.pins) {
      const old = before.pins.find(q => q.id === pin.id);
      if ((old?.net ?? null) === pin.net) continue;
      const was = nameOf(base, old?.net ?? null);
      pinMarks.set(`${part.ref}.${pin.id}`, { mark: pin.net ? 'added' : 'removed', ...(was ? { was } : {}) });
    }
  }
  const gone = base.parts.filter(p => !next.parts.some(q => q.ref === p.ref));
  for (const part of gone) marks.set(part.ref, 'removed');
  const sections = [...next.sections.map(s => ({ ...s, parts: [...s.parts] }))];
  for (const part of gone) {
    const home = base.sections.find(s => s.parts.includes(part.ref));
    const stay = sections.find(s => s.id === home?.id);
    if (stay) stay.parts.push(part.ref);
    else sections.push({ ...(home ?? { id: `s-${part.ref}`, title: part.name, notes: [] }), parts: [part.ref] });
  }
  const netNames = [...next.nets, ...base.nets.filter(n => !next.nets.some(m => m.id === n.id))];
  return { sheet: { ...next, sections, parts: [...next.parts, ...gone], nets: netNames }, marks, pinMarks };
}
