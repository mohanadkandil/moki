import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent } from '../../../../src/agents/protocol';
import type { CircuitDesign } from '../../../../src/circuit/model';
import type { BoardPlan } from '../../../../src/blocks/contract';
import { contentId } from '../../../../src/circuit/graph';
import { useArtifact } from '../../board/api';
import type { BoardJob } from '../../board/types';
import { titleBlock } from '../Canvas';
import type { CanvasWait } from '../canvasWait';
import { inFlight } from '../facts';
import { PaneState } from '../PaneState';
import { useBoardModel } from '../useBoardModel';
import { checkOps, useChipBlocks } from './api';
import type { SheetOp } from './ops';
import SchematicCanvas from './SchematicCanvas';
import { EMPTY_SHEET, graphFromAudit, revealOnly, sheetFromBoard, sheetFromDesign, sheetFromGraph, withPorts, type BlockInfo, type SchematicAudit, type Sheet, type SheetGraph } from './sheet';

export interface SchematicContext {
  partial: Extract<AgentEvent, { type: 'plan.partial' }> | null;
  design: CircuitDesign | null;
  who: string | null;
  step: string | null;
  submit: (ops: readonly SheetOp[], lines: readonly string[], next: CircuitDesign | null) => Promise<string | null>;
  blocked: string | null;
  /** What the canvas says with no build and nobody drawing. */
  empty: CanvasWait;
}

const asJson = (res: Response) => res.json() as Promise<unknown>;
const REVEAL_MS = 200;

/** A partial with nothing drawable yet still has a step to show, so it isn't a sheet. */
function sheetOfPartial(partial: SchematicContext['partial'], blocks: readonly BlockInfo[] | null): Sheet | null {
  if (!partial) return null;
  if (partial.design?.parts.length) return sheetFromDesign(partial.design);
  if (blocks && partial.plan && partial.graph?.parts.length) return withPorts(sheetFromGraph(partial.plan, partial.graph as SheetGraph), partial.plan, blocks);
  return null;
}

/** New parts land one at a time in sheet order, however many arrived together. Anything already drawn stays drawn. */
function useReveal(sheet: Sheet, live: boolean): Sheet {
  const [shown, setShown] = useState<ReadonlySet<string> | null>(null);
  const known = useRef(sheet);
  const order = useMemo(() => [...sheet.sections.flatMap(s => s.parts), ...sheet.parts.map(p => p.ref)], [sheet]);
  useEffect(() => {
    if (!live) { setShown(null); known.current = sheet; return; }
    setShown(prev => prev ?? new Set(known.current.parts.map(p => p.ref)));
    known.current = sheet;
    const timer = window.setInterval(() => {
      setShown(prev => {
        const next = order.find(ref => !prev?.has(ref));
        return next ? new Set([...(prev ?? []), next]) : prev;
      });
    }, REVEAL_MS);
    return () => window.clearInterval(timer);
  }, [sheet, live, order]);
  return useMemo(() => (live && shown ? revealOnly(sheet, shown) : sheet), [sheet, live, shown]);
}

interface Resolved { sheet: Sheet; design: CircuitDesign | null; plan?: BoardPlan; graph?: SheetGraph }

export default function SchematicPane({ job, part, onPart, context }: { job: BoardJob | null; part: string | null; onPart: (ref: string | null) => void; context: SchematicContext }) {
  const designFile = useArtifact(job?.artifacts?.['design.json'], asJson);
  const auditFile = useArtifact(job?.artifacts?.['schematic-circuit.json'], asJson);
  const plan = (job?.input as { plan?: BoardPlan } | undefined)?.plan ?? null;
  // Live and final both carry ports, so a chip sheet lays out the same when the build lands.
  const blocks = useChipBlocks(Boolean(plan || context.partial?.plan));
  // The server draws a chip plan the same way for live, draft and final, so all three lay out alike. Null while it's
  // being asked, and undefined if it can't say, in which case the build's own record of the sheet stands in.
  const [serverGraph, setServerGraph] = useState<{ jobId: string; graph: SheetGraph | undefined } | null>(null);
  const planJobId = plan ? job?.jobId ?? null : null;
  useEffect(() => {
    if (!planJobId) return;
    const abort = new AbortController();
    void checkOps(planJobId, [], abort.signal).then(result => { if (!abort.signal.aborted) setServerGraph({ jobId: planJobId, graph: result?.graph }); });
    return () => abort.abort();
  }, [planJobId]);
  const graphAnswer = serverGraph?.jobId === planJobId ? serverGraph : null;
  const usesBoard = !job?.artifacts?.['design.json'] && !job?.artifacts?.['schematic-circuit.json'];
  const board = useBoardModel(usesBoard ? job?.artifacts?.['circuit.json'] : undefined);
  const jobKey = job?.jobId ?? null;
  const hasDesignFile = Boolean(job?.artifacts?.['design.json']);
  const hasAudit = Boolean(job?.artifacts?.['schematic-circuit.json']);
  const designNow = job?.input?.designContentId && context.design && contentId(context.design) === job.input.designContentId ? context.design : null;

  // What's built wins. Then the design in hand, whose job may still be running. Then the board file, which only reads.
  const resolved = useMemo((): Resolved | null => {
    if (hasDesignFile && designFile.state === 'ready') { const d = designFile.value as CircuitDesign; return { sheet: sheetFromDesign(d), design: d }; }
    if (plan && graphAnswer && blocks) {
      const graph = graphAnswer.graph ?? (hasAudit && auditFile.state === 'ready' ? graphFromAudit(auditFile.value as SchematicAudit[]) : null);
      if (graph) return { sheet: withPorts(sheetFromGraph(plan, graph), plan, blocks), design: null, plan, graph };
    }
    if (designNow) return { sheet: sheetFromDesign(designNow), design: designNow };
    if (!job && context.design) return { sheet: sheetFromDesign(context.design), design: context.design };
    if (usesBoard && board.state === 'ready' && board.model) return { sheet: sheetFromBoard(board.model, job?.input?.template ?? 'Board'), design: null };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey, hasDesignFile, hasAudit, designFile, auditFile, plan, graphAnswer, blocks, designNow, usesBoard, board, context.design]);

  // The last good sheet stays up while the next one loads, so a finished build never flashes empty.
  const held = useRef<Resolved | null>(null);
  if (resolved) held.current = resolved;
  const partialSheet = useMemo(() => sheetOfPartial(context.partial, blocks), [context.partial, blocks]);
  // Between the last partial and the build's own sheet there may be a moment with neither. The sheet on screen stays.
  const lastDrawn = useRef<Sheet | null>(null);
  const current = partialSheet ?? resolved?.sheet ?? held.current?.sheet ?? lastDrawn.current;
  if (current) lastDrawn.current = current;
  const working = context.who !== null;
  const sheet = useReveal(current ?? EMPTY_SHEET, Boolean(partialSheet) && working);

  const edit = useMemo(() => ({
    submit: context.submit,
    blocked: context.blocked,
    check: async (ops: readonly SheetOp[], signal: AbortSignal) => (jobKey ? checkOps(jobKey, ops, signal) : null),
  }), [context.submit, context.blocked, jobKey]);

  const title = useMemo(() => {
    if (!job) return [{ k: 'Title', v: sheet.title || 'New design' }, { k: 'Sheet', v: '1 of 1' }];
    const rows = titleBlock(job).map(([k, v]) => ({ k, v }));
    return sheet.title ? rows.map(r => (r.k === 'Title' ? { ...r, v: sheet.title } : r)) : rows;
  }, [job, sheet.title]);

  const live = Boolean(partialSheet) && working;
  const settled = live ? null : resolved ?? held.current;
  const chip = useMemo(() => (settled?.plan && settled.graph && blocks ? { plan: settled.plan, graph: settled.graph, blocks } : null), [settled?.plan, settled?.graph, blocks]);

  if (!current && !working) {
    const failedToRead = designFile.state === 'error' ? designFile.message : auditFile.state === 'error' ? auditFile.message : board.state === 'error' ? board.message : undefined;
    if (failedToRead) return <PaneState what="the schematic" error={failedToRead} />;
    if (job && !inFlight(job) && !job.artifacts?.['circuit.json'] && !hasDesignFile && !hasAudit) return <PaneState what="the schematic" absent="This build has no schematic." />;
    // Otherwise fall through to the empty sheet: it fills in as parts arrive, with no status note swapping in and out.
  }

  const design = live ? null : settled?.design ?? null;
  const reason = sheet.origin === 'board' ? (job?.input?.kind === 'design' ? 'This build is older than schematic editing. Re-run it to edit here.' : 'This build came from edited code, so it has no design to edit.') : undefined;
  return (
    <SchematicCanvas
      sheet={sheet}
      design={design}
      chip={chip}
      title={title}
      live={{ who: context.who, step: context.step }}
      edit={edit}
      part={part}
      onPart={onPart}
      {...(reason ? { readOnlyReason: reason } : {})}
    />
  );
}
