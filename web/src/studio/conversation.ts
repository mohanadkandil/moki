// The chat's record and how a typed message becomes a design. Nothing here calls a model: a follow-up
// is read by the same rule-based interpreter as the first brief, together with the brief before it.
import { contentId } from '../../../src/circuit/graph';
import { interpretBrief, TEMPLATE_NAMES } from '../../../src/circuit/interpret';
import type { Interpretation, Rejection, TemplateId } from '../../../src/circuit/model';
import type { LabSession } from '../../../src/circuit/session';
import { currentRevision } from '../../../src/circuit/session';
import type { BoardJob } from '../board/types';
import type { AgentTurn } from './agentChat';

export const WORDMARK = 'Workshop';

/** The validated design a job was built from, if this session still holds it. A template's name can't identify it: a 25 and a 45 minute timer share one. */
export function designForRerun(job: BoardJob, session: LabSession) {
  const id = job.input?.kind === 'design' ? job.input.designContentId : undefined;
  return (id && session.revisions.find(r => contentId(r.design) === id)?.design) || null;
}

export type Turn =
  | { id: string; kind: 'brief'; text: string }
  | { id: string; kind: 'edit'; text: string }
  | { id: string; kind: 'reading'; title: string; meanings: string[]; changes: string[]; notes: string[]; followUp: boolean }
  | { id: string; kind: 'say'; tone: 'refuse' | 'unchanged' | 'error'; title: string; lines: string[]; candidates?: TemplateId[]; canEdit?: boolean; brief?: string }
  | { id: string; kind: 'run'; label: string | null; job: BoardJob | null; lost?: string | null; startedAt?: number | null; waitedMs?: number | null }
  | AgentTurn;

export interface Plan { brief: string; choice?: TemplateId }

/**
 * Decide what the interpreter reads. The first brief is read alone. A follow-up is read with the brief
 * before it, so "use GPIO 18 for the buzzer" keeps the knob and screen. Naming a different template
 * starts a new design, and a follow-up that conflicts falls back to reading it alone if that works.
 */
export function planBrief(session: LabSession, text: string): Plan {
  const previous = currentRevision(session);
  if (!previous) return { brief: text };
  const alone = interpretBrief(text);
  if (alone.ok && alone.interpretation.template !== previous.design.template) return { brief: text };
  const brief = `${previous.brief}. ${text}`;
  const together = interpretBrief(brief, previous.design.template);
  if (together.ok) return { brief, choice: previous.design.template };
  if (alone.ok) return { brief: text };
  return { brief, choice: previous.design.template };
}

/**
 * The interpreter still speaks as the wiring-only preview it was written for. These two notes and the
 * word "preview" would be false here, where a case and firmware are built. The rule logic is untouched.
 */
export function cleanNote(note: string): string {
  if (/^Enclosures and PCB layout are not drawn/.test(note)) return 'A brief can’t set the case’s color, shape or layout yet. The case is generated to fit the board.';
  if (/^Wi-Fi and Bluetooth are inside/.test(note)) return 'Wi-Fi and Bluetooth are on the ESP32 module, but the generated firmware doesn’t use them.';
  return rename(note);
}

const rename = (text: string) => text
  .replace(/\bthe preview catalog\b/g, 'the parts catalog')
  .replace(/\b[Tt]his preview\b/g, WORDMARK)
  .replace(/\b[Tt]he preview’s\b/g, `${WORDMARK}’s`)
  .replace(/\b[Tt]he preview\b/g, WORDMARK);

export function cleanRejection(rejection: Rejection): { title: string; lines: string[] } {
  return { title: rename(rejection.message), lines: rejection.details.map(rename) };
}

export function readingOf(interpretation: Interpretation): string[] {
  return interpretation.recognized.map(r => r.meaning);
}

export const templateName = (id: string | undefined): string | null =>
  id && id in TEMPLATE_NAMES ? TEMPLATE_NAMES[id as TemplateId] : null;

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const STORAGE_KEY = 'workshop.studio.v1';
export interface Saved { turns: Turn[]; session: LabSession; canvasJobId: string | null }

export function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Saved;
    return Array.isArray(value?.turns) && value.session ? value : null;
  } catch { return null; }
}

export function save(value: Saved | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* Private mode or full storage: the session just won't survive a reload. */ }
}
