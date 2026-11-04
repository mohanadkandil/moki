// A draft of maker edits before it's a job. The server validates and has the last word; this catches the
// obvious problems while the part is still under the pointer, and says what a draft changes in plain words.
import type { BoardModel, Part } from './pcbModel';

export type UsbEdge = 'left' | 'right' | 'top' | 'bottom';
export interface Placement { refdes: string; x: number; y: number; rotation: number }
export interface BoardSize { widthMm: number; heightMm: number; cornerRadiusMm: number }
export interface BoardEdits { placements: Placement[]; board?: BoardSize; usbEdge?: UsbEdge }
export interface EditDraft { placements: Readonly<Record<string, Placement>>; board?: BoardSize; usbEdge?: UsbEdge }
export const NO_EDITS: EditDraft = { placements: {} };

const fmt = (n: number) => `${+n.toFixed(1)}`;
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
const turn = (deg: number) => ((deg % 360) + 360) % 360;

/** A placement that returns a part to where it was isn't an edit. */
export function setPlacement(draft: EditDraft, part: Part, next: Omit<Placement, 'refdes'>): EditDraft {
  const { [part.ref]: _gone, ...rest } = draft.placements;
  const unmoved = near(next.x, part.x) && near(next.y, part.y) && near(turn(next.rotation), turn(part.rotation));
  const mm = (v: number) => Math.round(v * 1000) / 1000;
  return { ...draft, placements: unmoved ? rest : { ...rest, [part.ref]: { refdes: part.ref, x: mm(next.x), y: mm(next.y), rotation: next.rotation } } };
}

export const placed = (draft: EditDraft, part: Part): Omit<Placement, 'refdes'> => draft.placements[part.ref] ?? { x: part.x, y: part.y, rotation: part.rotation };
export const hasEdits = (draft: EditDraft) => Object.keys(draft.placements).length > 0 || Boolean(draft.board) || Boolean(draft.usbEdge);
export const toEdits = (draft: EditDraft): BoardEdits => ({ placements: Object.values(draft.placements), ...(draft.board ? { board: draft.board } : {}), ...(draft.usbEdge ? { usbEdge: draft.usbEdge } : {}) });

/** Where a point of a part lands once the part is placed. It turns about the part's centre. */
export function placePoint(part: Part, at: Omit<Placement, 'refdes'>, x: number, y: number): [number, number] {
  const a = ((at.rotation - part.rotation) * Math.PI) / 180;
  const [dx, dy] = [x - part.x, y - part.y];
  return [at.x + dx * Math.cos(a) - dy * Math.sin(a), at.y + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** The placed part's footprint on the board, as a box. Edits turn in quarter steps, so it stays one. */
export function placedBox(part: Part, at: Omit<Placement, 'refdes'>) {
  const [x, y] = placePoint(part, at, part.envelope.x, part.envelope.y);
  const sideways = Math.abs(turn(at.rotation - part.rotation) % 180) === 90;
  const [w, h] = sideways ? [part.envelope.h, part.envelope.w] : [part.envelope.w, part.envelope.h];
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
}

/** What the draft does, for the bar above the canvas and for the chat. */
export function describeEdits(model: BoardModel, draft: EditDraft): string[] {
  const lines: string[] = [];
  for (const placement of Object.values(draft.placements)) {
    const part = model.parts.find(p => p.ref === placement.refdes);
    if (!part) continue;
    const [dx, dy] = [placement.x - part.x, placement.y - part.y];
    const moves = [
      !near(dx, 0) ? `${fmt(Math.abs(dx))} mm ${dx < 0 ? 'left' : 'right'}` : null,
      !near(dy, 0) ? `${fmt(Math.abs(dy))} mm ${dy < 0 ? 'down' : 'up'}` : null,
    ].filter(Boolean);
    const spun = turn(placement.rotation - part.rotation);
    const said = [moves.length ? `moved ${moves.join(', ')}` : null, !near(spun, 0) ? `turned ${fmt(spun)}°` : null].filter(Boolean);
    if (said.length) lines.push(`${part.ref} ${said.join(' and ')}`);
  }
  if (draft.board) lines.push(`Board ${fmt(draft.board.widthMm)} × ${fmt(draft.board.heightMm)} mm, ${fmt(draft.board.cornerRadiusMm)} mm corners`);
  if (draft.usbEdge) lines.push(`USB on the ${draft.usbEdge} edge`);
  return lines;
}

/** Only for what changed: a template's own layout isn't this draft's problem. */
export function editProblems(model: BoardModel, draft: EditDraft): string[] {
  const out: string[] = [];
  const b = draft.board ? { w: draft.board.widthMm, h: draft.board.heightMm } : { w: model.board.w, h: model.board.h };
  const [x0, x1, y0, y1] = [model.board.x - b.w / 2, model.board.x + b.w / 2, model.board.y - b.h / 2, model.board.y + b.h / 2];
  const boxes = model.parts.map(part => ({ part, box: placedBox(part, placed(draft, part)), moved: Boolean(draft.placements[part.ref]) }));
  for (const { part, box, moved } of boxes) {
    if (!moved && !draft.board) continue;
    if (box.x0 < x0 - 0.01 || box.x1 > x1 + 0.01 || box.y0 < y0 - 0.01 || box.y1 > y1 + 0.01) out.push(`${part.ref} doesn’t fit on the board there.`);
  }
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(c => {
    if (!a.moved && !c.moved) return;
    if (a.box.x0 < c.box.x1 && c.box.x0 < a.box.x1 && a.box.y0 < c.box.y1 && c.box.y0 < a.box.y1) out.push(`${a.part.ref} would overlap ${c.part.ref}.`);
  }));
  return out;
}

/** What the job itself says about being an edit: its base, and the server's own account of what changed. Absent on every other job. */
export function editOrigin(job: { input?: unknown; editSummary?: unknown }): { baseJobId: string | null; lines: string[] } | null {
  const input = (job.input ?? {}) as { baseJobId?: unknown; edits?: unknown };
  if (!input.edits) return null;
  return { baseJobId: typeof input.baseJobId === 'string' ? input.baseJobId : null, lines: Array.isArray(job.editSummary) ? job.editSummary.filter((l): l is string => typeof l === 'string') : [] };
}

/** The radius an outline was cut with, read from where its straight right edge stops. */
export function cornerRadiusOf(board: BoardModel['board']): number {
  const right = board.x + board.w / 2;
  const top = board.y + board.h / 2;
  const ys = board.outline.filter(p => Math.abs(p[0] - right) < 0.001).map(p => p[1]);
  return ys.length ? Math.max(0, +(top - Math.max(...ys)).toFixed(2)) : 0;
}
