// Pure helpers for the Board studio. No DOM or React, so they can be tested directly.
import type { BoardJob, JobStage } from './types';

/** The order the pipeline runs in. A stage the API reports outside this list is appended, not dropped. */
export const STAGE_ORDER = ['codegen', 'render', 'route', 'svg', 'gltf', 'fab', 'enclosure', 'firmware', 'firmware-compile'] as const;

export type CellState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'reused' | 'not-reported';
export interface TimingCell { name: string; state: CellState; ms: number | null; note?: string; share: number }

const inFlight = (job: BoardJob) => job.status === 'queued' || job.status === 'running';

/**
 * Stage cells for the strip. Bars are a linear share of the job total, so a cached run really looks
 * small. A stage the finished job never reported is shown as such rather than quietly hidden.
 */
export function timingCells(job: BoardJob): TimingCell[] {
  const reported = job.stages ?? [];
  const byName = new Map<string, JobStage>(reported.map(s => [s.name, s]));
  const names: string[] = [...STAGE_ORDER.filter(n => !(job.noFirmware && (n === 'firmware' || n === 'firmware-compile'))), ...reported.map(s => s.name).filter(n => !(STAGE_ORDER as readonly string[]).includes(n))];
  const sum = reported.reduce((a, s) => a + Math.max(0, s.ms), 0);
  const scale = Math.max(job.totalMs ?? 0, sum, 1);
  // The API reports a stage once it ends, so the one under way is the first in order it hasn't reported.
  const lastReported = names.reduce((last, n, i) => (byName.has(n) ? i : last), -1);
  return names.map((name, i) => {
    const stage = byName.get(name);
    if (stage) {
      // On a cache hit the API reports reused stages as skipped at 0 ms. Calling that "skipped" would
      // read as if the output were missing, so it says what happened: the earlier output was reused.
      const reused = stage.status === 'skipped' && /^cache hit/i.test(stage.note ?? '');
      return { name, state: reused ? 'reused' : stage.status, ms: stage.ms, note: stage.note, share: Math.max(0, stage.ms) / scale };
    }
    if (inFlight(job)) return { name, state: job.status === 'running' && i === nextPending(names, byName, lastReported) ? 'running' : 'pending', ms: null, share: 0 };
    return { name, state: 'not-reported', ms: null, share: 0 };
  });
}

function nextPending(names: string[], byName: Map<string, JobStage>, lastReported: number): number {
  for (let i = lastReported + 1; i < names.length; i++) if (!byName.has(names[i]!)) return i;
  return -1;
}

/** Time the job total holds beyond its named stages (queueing, process start). Null while it can't be said. */
export function unattributedMs(job: BoardJob): number | null {
  if (inFlight(job) || job.totalMs === undefined) return null;
  const sum = (job.stages ?? []).reduce((a, s) => a + Math.max(0, s.ms), 0);
  const rest = Math.round(job.totalMs - sum);
  return rest > 0 ? rest : null;
}

export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} ms`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the panels show. A job with outputs shows them, even a failed one. A job with none yet (still
 * running, or dead on arrival) keeps the last finished build on screen, and the studio says so.
 */
export function jobToDisplay(current: BoardJob | null, lastGood: BoardJob | null): BoardJob | null {
  if (!current) return lastGood;
  // Every job writes its source and a receipt up front, so those two don't count as outputs.
  const outputs = Object.keys(current.artifacts ?? {}).filter(name => name !== 'board.tsx' && name !== 'receipt.json');
  if (outputs.length > 0) return current;
  return lastGood ?? current;
}

/**
 * Whether the design rule check really ran. The API starts every job with an empty drc block, so
 * "no errors" means nothing until a render has finished. Without this, a build that crashed before
 * rendering would read as a clean DRC pass. Trusts drc.checked if present, else the render stage.
 */
export function drcRan(job: BoardJob): boolean {
  if (job.drc?.checked !== undefined) return job.drc.checked;
  return job.drc !== undefined && job.stages?.some(s => s.name === 'render' && s.status === 'done') === true;
}

export type CompileState =
  | { kind: 'compiled'; note?: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'not-compiled'; reason: string }
  | { kind: 'pending' }
  | { kind: 'none' };

export function compileState(job: BoardJob): CompileState {
  if (job.noFirmware) return { kind: 'none' };
  const stage = job.stages?.find(s => s.name === 'firmware-compile');
  if (!stage) {
    if (inFlight(job)) return { kind: 'pending' };
    const firmware = job.stages?.find(s => s.name === 'firmware');
    if (firmware && firmware.status !== 'done') return { kind: 'not-compiled', reason: firmware.note ?? `The firmware stage ${firmware.status === 'failed' ? 'failed' : 'was skipped'}.` };
    return { kind: 'not-compiled', reason: 'The build reported no compile step.' };
  }
  if (stage.status === 'done') return { kind: 'compiled', note: stage.note };
  if (stage.status === 'failed') return { kind: 'failed', reason: stage.note ?? 'The compiler reported an error.' };
  return { kind: 'not-compiled', reason: stage.note ?? 'The build gave no reason.' };
}

/**
 * Make a generated SVG scale and match the canvas. tscircuit writes fixed width and height with no
 * viewBox, so a browser would clip it instead of scaling. Extra CSS is appended so it wins by order.
 */
export function prepareSvg(text: string, css = ''): string {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return text;
  let tag = open[0];
  if (!/\bviewBox=/i.test(tag)) {
    const w = /\bwidth="([\d.]+)(?:px)?"/i.exec(tag)?.[1];
    const h = /\bheight="([\d.]+)(?:px)?"/i.exec(tag)?.[1];
    if (w && h) tag = tag.replace(/^<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  let out = text.slice(0, open.index) + tag + text.slice(open.index + open[0].length);
  if (css) {
    const end = out.toLowerCase().lastIndexOf('</svg>');
    if (end >= 0) out = `${out.slice(0, end)}<style>${css}</style>${out.slice(end)}`;
  }
  return out;
}

/** CSS that hides PCB layers, using the data-pcb-layer attribute circuit-to-svg writes on every shape. */
export function hideLayersCss(layers: readonly string[]): string {
  return layers.map(l => `[data-pcb-layer="${l}"]{display:none}`).join('');
}

const TEMPLATE_TITLES: Record<string, string> = { 'focus-timer': 'Focus timer', 'light-lamp': 'Light-sensing lamp', 'temp-monitor': 'Temperature monitor' };

/** Heading for the studio: "Focus timer carrier board", or plain "Carrier board" until the job is known. */
export function jobTitle(job: BoardJob | null, designTitle?: string): { name: string; rest: string } {
  if (job?.input?.kind === 'source') return { name: 'Carrier board', rest: ' from edited source' };
  const template = job?.input?.template;
  const name = designTitle ?? (template ? TEMPLATE_TITLES[template] : undefined);
  return name ? { name, rest: ' carrier board' } : { name: 'Carrier board', rest: '' };
}

/** Stage notes grouped by text, so a cache hit's five identical notes read as one line. */
export function groupedNotes(cells: readonly TimingCell[]): { names: string[]; state: CellState; note: string }[] {
  const groups = new Map<string, { names: string[]; state: CellState; note: string }>();
  for (const cell of cells) {
    if (!cell.note) continue;
    const key = `${cell.state}|${cell.note}`;
    const group = groups.get(key);
    if (group) group.names.push(cell.name);
    else groups.set(key, { names: [cell.name], state: cell.state, note: cell.note });
  }
  return [...groups.values()];
}
