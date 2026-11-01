import { contentId, diffDesigns, fingerprint, settingsChanges, type DesignChange } from './graph.js';
import { interpretBrief, normalizeBrief, TEMPLATE_NAMES } from './interpret.js';
import type { CircuitDesign, Interpretation, Rejection, TemplateId } from './model.js';
import { buildDesign } from './templates.js';
import { checkDesign, type GraphIssue } from './validate.js';

// Revision history for one working session.
// - A brief that changes the wiring OR the recorded settings creates a new revision whose
//   `changes` describe exactly that step (wiring sentences, then setting edits).
// - A brief that is only reworded (same content id) keeps the revision and updates its wording.
// - A rejected brief never replaces the last good drawing.

export interface Revision {
  number: number;
  brief: string;
  interpretation: Interpretation;
  design: CircuitDesign;
  /** Wiring identity: unchanged by setting edits. */
  fingerprint: string;
  /** Wiring plus settings: unique per distinct revision content. */
  contentId: string;
  /** What this revision changed relative to the one before it. */
  changes: DesignChange[];
}

export interface LabSession {
  revisions: Revision[];
  /** The latest brief that could not be drawn; cleared by the next accepted brief. */
  rejected: { brief: string; rejection: Rejection } | null;
}

export type SubmitOutcome =
  | { kind: 'created'; revision: Revision }
  | { kind: 'unchanged'; revision: Revision }
  | { kind: 'rejected'; rejection: Rejection }
  | { kind: 'internal-error'; rejection: Rejection; issues: GraphIssue[] };

export const EMPTY_SESSION: LabSession = { revisions: [], rejected: null };

export function currentRevision(session: LabSession): Revision | null {
  return session.revisions.at(-1) ?? null;
}

/** `build` is replaceable only so tests can simulate a faulty template. */
export function submitBrief(session: LabSession, brief: unknown, choice?: TemplateId, build: (i: Interpretation) => CircuitDesign = buildDesign): { session: LabSession; outcome: SubmitOutcome } {
  const result = interpretBrief(brief, choice);
  const text = typeof brief === 'string' ? normalizeBrief(brief) : '';
  if (!result.ok) {
    return { session: { ...session, rejected: { brief: text, rejection: result.rejection } }, outcome: { kind: 'rejected', rejection: result.rejection } };
  }
  const design = build(result.interpretation);
  const issues = checkDesign(design);
  if (issues.length) {
    // The preview's own template is at fault, not the person's brief.
    const rejection: Rejection = {
      reason: 'internal',
      message: `The preview’s ${TEMPLATE_NAMES[result.interpretation.template]} template produced an inconsistent circuit, so it was not drawn. This is a fault in the preview, not in your brief.`,
      details: issues.map(i => i.message),
    };
    return { session: { ...session, rejected: { brief: text, rejection } }, outcome: { kind: 'internal-error', rejection, issues } };
  }
  const print = fingerprint(design);
  const id = contentId(design);
  const previous = currentRevision(session);
  if (previous && previous.contentId === id) {
    // Same wiring and settings: keep the revision and its change list; record the newer wording.
    const updated: Revision = { ...previous, brief: text, interpretation: result.interpretation, design };
    return { session: { revisions: [...session.revisions.slice(0, -1), updated], rejected: null }, outcome: { kind: 'unchanged', revision: updated } };
  }
  let changes: DesignChange[] = [];
  if (previous) {
    const wiring = previous.fingerprint === print ? [] : diffDesigns(previous.design, design);
    const sameFamily = previous.design.template === design.template;
    changes = [...wiring, ...(sameFamily ? settingsChanges(previous.design, design) : [])];
  }
  const revision: Revision = { number: (previous?.number ?? 0) + 1, brief: text, interpretation: result.interpretation, design, fingerprint: print, contentId: id, changes };
  return { session: { revisions: [...session.revisions, revision], rejected: null }, outcome: { kind: 'created', revision } };
}
