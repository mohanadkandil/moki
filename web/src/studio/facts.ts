// Everything the chat and status strip say about a build comes from here, and only from the job and
// its receipts. A value the pipeline didn't report drops its line; nothing is filled in or guessed.
import type { TabId } from './Canvas';
import { firstErrorLine } from '../../../src/board/failure';
import { compileState, drcRan, formatBytes, timingCells, unattributedMs, type CellState } from '../board/logic';
import type { BoardJob, DrcEntry } from '../board/types';

export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
export const obj = (v: unknown): Json => (isObject(v) ? v : {});
export const objects = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);
export const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface Facts { enclosure?: Json; firmware?: Json }

export const inFlight = (job: BoardJob | null | undefined) => job?.status === 'queued' || job?.status === 'running';

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export const boxMm = (v: unknown): string | null => {
  const { x, y, z } = obj(v);
  const [a, b, c] = [num(x), num(y), num(z)];
  return a === null || b === null || c === null ? null : `${+a.toFixed(1)} × ${+b.toFixed(1)} × ${+c.toFixed(1)} mm`;
};

export const CHAPTERS = [
  { id: 'board', label: 'Board', stages: ['codegen', 'render', 'route', 'svg', 'gltf', 'fab'] },
  { id: 'case', label: 'Case', stages: ['enclosure'] },
  { id: 'firmware', label: 'Firmware', stages: ['firmware', 'firmware-compile'] },
] as const;

const LABELS: Record<string, string> = {
  codegen: 'Write board source',
  render: 'Render the circuit',
  route: 'Route traces',
  svg: 'Draw schematic and PCB',
  gltf: 'Build the 3D model',
  fab: 'Export fabrication files',
  enclosure: 'Model the case',
  firmware: 'Write firmware',
  'firmware-compile': 'Compile firmware',
};

/** The tab that shows what each build step made. Clicking a step goes there, and a failed step marks it. */
export const STAGE_TAB: Record<string, TabId> = {
  codegen: 'code', render: 'schematic', route: 'pcb', svg: 'schematic', gltf: '3d', fab: 'pcb',
  enclosure: 'case', firmware: 'firmware', 'firmware-compile': 'firmware',
};
export const CHAPTER_TAB: Record<string, TabId> = { board: 'pcb', case: 'case', firmware: 'firmware' };

export type Detail = readonly [string, string];
export interface StageRow {
  name: string;
  label: string;
  state: CellState;
  /** Measured time, or the reason there isn't one. */
  time: string | null;
  ms: number | null;
  /** The one thing worth reading without opening the row. */
  fact: string | null;
  note?: string;
  details: Detail[];
}

const size = (job: BoardJob, name: string): string | null => {
  const a = job.artifacts?.[name];
  return a ? formatBytes(a.bytes) : null;
};
const file = (job: BoardJob, name: string): Detail | null => {
  const s = size(job, name);
  return s ? [name, s] : null;
};
const version = (job: BoardJob, key: string, label: string): Detail | null => {
  const v = job.toolVersions?.[key];
  return v ? [label, v] : null;
};
const clean = (rows: (Detail | null | false | undefined)[]): Detail[] => rows.filter((r): r is Detail => Boolean(r));
const usage = (v: unknown): string | null => {
  const { usedBytes, percent } = obj(v);
  const used = num(usedBytes);
  const pct = num(percent);
  return used === null ? null : `${formatBytes(used)}${pct !== null ? ` (${pct}%)` : ''}`;
};

function stageFact(name: string, job: BoardJob, facts: Facts): { fact: string | null; details: Detail[] } {
  const board = job.board && job.board.widthMm > 0 ? job.board : null;
  const errors = job.drc?.errors.length ?? 0;
  const warnings = job.drc?.warnings.length ?? 0;
  switch (name) {
    case 'codegen':
      return {
        fact: job.input?.kind === 'source' ? 'TSX source' : size(job, 'board.tsx'),
        details: clean([file(job, 'board.tsx'), job.input?.designContentId ? ['design id', job.input.designContentId] : null, job.input?.sourceSha256 ? ['source sha256', job.input.sourceSha256.slice(0, 16)] : null]),
      };
    case 'render':
      return {
        fact: drcRan(job) ? `DRC ${errors} error${errors === 1 ? '' : 's'}` : null,
        details: clean([version(job, 'tscircuit', 'tscircuit'), version(job, '@tscircuit/core', 'core'), drcRan(job) ? ['DRC errors', String(errors)] : null, drcRan(job) ? ['DRC warnings', String(warnings)] : null]),
      };
    case 'route':
      return {
        fact: board ? `${board.traceCount} traces · ${board.viaCount} vias` : null,
        details: clean([board ? ['board', `${board.widthMm} × ${board.heightMm} mm, ${board.layers} layers`] : null, version(job, '@tscircuit/capacity-autorouter', 'autorouter')]),
      };
    case 'svg':
      return { fact: size(job, 'pcb.svg') ? '2 drawings' : null, details: clean([file(job, 'schematic.svg'), file(job, 'pcb.svg'), version(job, 'circuit-to-svg', 'SVG export')]) };
    case 'gltf':
      return { fact: size(job, 'board.glb'), details: clean([file(job, 'board.glb'), version(job, 'circuit-json-to-gltf', '3D export')]) };
    case 'fab':
      return { fact: size(job, 'gerbers.zip') ? 'Gerbers, BOM, placement' : null, details: clean([file(job, 'gerbers.zip'), file(job, 'bom.csv'), file(job, 'pnp.csv'), version(job, 'circuit-json-to-gerber', 'Gerber export')]) };
    case 'enclosure': {
      const e = facts.enclosure;
      const outer = e ? boxMm(obj(e.dimensions).outerMm) : null;
      const engine = e ? obj(e.engine) : {};
      const openings = e ? objects(e.apertures).length : 0;
      return {
        fact: outer,
        details: clean([
          str(engine.name) ? ['engine', `${str(engine.name)} ${str(engine.version) ?? ''}`.trim()] : null,
          engine.fallback === true ? ['fallback', 'Simpler mesh box: build123d failed'] : null,
          openings ? ['openings', String(openings)] : null,
          file(job, 'enclosure-base.stl'), file(job, 'enclosure-lid.stl'), file(job, 'enclosure.step'), file(job, 'assembly.glb'),
        ]),
      };
    }
    case 'firmware':
      return { fact: size(job, 'firmware.zip') ? 'PlatformIO project' : null, details: clean([file(job, 'firmware.zip')]) };
    case 'firmware-compile': {
      const f = facts.firmware;
      const flash = f ? usage(f.flash) : null;
      return {
        fact: flash ? `${flash} flash` : null,
        details: f ? clean([
          str(f.board) ? ['board', str(f.board)!] : null,
          flash ? ['flash', flash] : null,
          usage(f.ram) ? ['RAM', usage(f.ram)!] : null,
          str(f.platform) ? ['platform', str(f.platform)!] : null,
          num(f.exitCode) !== null ? ['exit code', String(f.exitCode)] : null,
          version(job, 'firmware:platformio', 'PlatformIO'),
        ]) : [],
      };
    }
    default:
      return { fact: null, details: [] };
  }
}

/**
 * Time the total holds beyond its stages, so the rows add up to the headline. Too small to matter stays
 * out. Only for a finished job: a worker that crashed reports no stages, so its time would land here.
 */
export function otherTime(job: BoardJob): string | null {
  if (job.status !== 'done') return null;
  const rest = unattributedMs(job);
  return rest !== null && rest >= 50 ? formatDuration(rest) : null;
}

/** The board and the case have separate caches, and either can hit without the other. */
export function cacheLabels(job: BoardJob): string[] {
  const enclosure = job.stages?.find(s => s.name === 'enclosure');
  return [
    job.cache && `board cache ${job.cache}`,
    enclosure?.status === 'done' && `case cache ${/cache hit/i.test(enclosure.note ?? '') ? 'hit' : 'miss'}`,
  ].filter((l): l is string => Boolean(l));
}

/** One row per stage, in pipeline order. A stage skipped with its parent isn't listed a second time. */
export function stageRows(job: BoardJob, facts: Facts): StageRow[] {
  const cells = timingCells(job);
  const firmwareSkipped = job.stages?.some(s => s.name === 'firmware' && s.status !== 'done');
  return cells
    .filter(c => !(c.name === 'firmware-compile' && c.state === 'not-reported' && firmwareSkipped))
    .map(c => {
      const { fact, details } = c.state === 'done' || c.state === 'reused' ? stageFact(c.name, job, facts) : { fact: null, details: [] };
      const time = c.state === 'reused' ? 'cached' : c.state === 'skipped' ? 'skipped' : c.state === 'failed' || c.state === 'done' ? (c.ms === null ? null : formatDuration(c.ms)) : null;
      return { name: c.name, label: LABELS[c.name] ?? c.name, state: c.state, ms: c.ms, time, fact, note: c.note, details };
    });
}

export interface SourceStatus { label: string; tone: 'ok' | 'error' | 'warn' | 'busy' | 'quiet'; hint: string }
/** What can be said about a job's own unedited source. The server saves source before rendering it, so having it proves nothing. `following` means this build is still being polled. */
export function sourceStatus(job: BoardJob, following: boolean): SourceStatus {
  const stage = job.stages?.find(s => s.name === 'render');
  if (stage?.status === 'failed' || /^EDA render failed/.test(job.error ?? '')) return { label: 'Render failed', tone: 'error', hint: 'This source didn’t render. The error is in the chat.' };
  if (job.artifacts?.['circuit.json']) return { label: 'Rendered', tone: 'ok', hint: 'The source tscircuit rendered. Edit it, then render.' };
  if (job.status === 'failed') return { label: 'Not rendered', tone: 'warn', hint: 'The build stopped before this source rendered.' };
  if (inFlight(job)) return following ? { label: 'Rendering', tone: 'busy', hint: 'The build is rendering this source.' } : { label: 'Source saved', tone: 'quiet', hint: 'Saved with the build. There’s no render result yet.' };
  return { label: 'Not rendered', tone: 'warn', hint: 'This build has no rendered circuit.' };
}

/** The tabs whose stage failed. A worker that dies reports nothing, so its stage is the first one with no report. */
function failedTabs(job: BoardJob): Set<TabId> {
  const cells = timingCells(job);
  const failed = cells.filter(c => c.state === 'failed');
  const stopped = failed.length || job.status !== 'failed' ? failed : cells.filter(c => c.state === 'not-reported').slice(0, 1);
  return new Set(stopped.map(c => STAGE_TAB[c.name]).filter((t): t is TabId => Boolean(t)));
}

export type TabStatus = 'waiting' | 'failed' | null;
/** Tabs say nothing unless it matters: an output still coming, or the stage that failed. `live` means the build is still being followed. */
export function tabStatus(job: BoardJob | null, tab: { id: TabId; needs: string }, live: boolean): TabStatus {
  if (!job) return null;
  if (failedTabs(job).has(tab.id)) return 'failed';
  return live && !job.artifacts?.[tab.needs] ? 'waiting' : null;
}

const DRC_SCOPE = 'The design rule check covers placement and routing. It doesn’t check that the circuit works, or that your modules match.';

export type ProofTone = 'ok' | 'warn' | 'error' | 'busy' | 'open';
export interface ProofItem { key: string; label: string; tone: ProofTone; title: string }

/** The four claims, kept apart so none of them reads as implying the next. */
export function proofItems(job: BoardJob | null): ProofItem[] {
  const busy = !job || inFlight(job);
  const generated = Boolean(job?.artifacts?.['circuit.json']);
  const ran = job ? drcRan(job) : false;
  const errors = job?.drc?.errors.length ?? 0;
  const warnings = job?.drc?.warnings.length ?? 0;
  const compile = job ? compileState(job) : ({ kind: 'pending' } as const);
  return [
    { key: 'generated', label: generated ? 'Generated' : busy ? 'Generating' : 'Not generated', tone: generated ? 'ok' : busy ? 'busy' : 'error', title: generated ? 'tscircuit produced a circuit and board from this source.' : 'No circuit output yet.' },
    !ran
      ? { key: 'drc', label: busy ? 'DRC' : 'DRC did not run', tone: busy ? 'busy' : 'warn', title: busy ? 'Design rule check is pending.' : 'The design rule check did not run on this build.' }
      : errors
        ? { key: 'drc', label: `DRC ${errors} error${errors === 1 ? '' : 's'}`, tone: 'error', title: `${errors} errors, ${warnings} warnings from the tscircuit checks.` }
        : { key: 'drc', label: warnings ? 'DRC 0 errors' : 'DRC clean', tone: 'ok', title: `${warnings ? `0 errors and ${warnings} warnings from the tscircuit checks. The warnings are listed in the chat.` : 'No errors or warnings from the tscircuit checks.'} ${DRC_SCOPE}` },
    compile.kind === 'none'
      ? { key: 'compile', label: 'No firmware', tone: 'ok', title: 'This board has no code, so there is nothing to compile or flash.' }
      : compile.kind === 'compiled'
      ? { key: 'compile', label: 'Compiled', tone: 'ok', title: compile.note ?? 'The firmware compiled. It has not been flashed.' }
      : compile.kind === 'failed'
        ? { key: 'compile', label: 'Compile failed', tone: 'error', title: compile.reason }
        : compile.kind === 'pending'
          ? { key: 'compile', label: 'Compile', tone: 'busy', title: 'Firmware compile is pending.' }
          : { key: 'compile', label: 'Not compiled', tone: 'warn', title: compile.reason },
    { key: 'printed', label: 'Not printed', tone: 'open', title: 'Nothing has been fabricated, printed, flashed or powered.' },
  ];
}

/**
 * The proof pill folded into one tappable chip for when there's no room for four labels. A problem is
 * never folded into a count of what passed. "Not printed" isn't in the count: it's always open.
 */
export interface ProofChip { label: string; tone: ProofTone }
export function proofChip(items: ProofItem[]): ProofChip {
  const claims = items.filter(i => i.tone !== 'open');
  const problems = claims.filter(i => i.tone === 'error' || i.tone === 'warn');
  if (problems.length) {
    const tone: ProofTone = problems.some(i => i.tone === 'error') ? 'error' : 'warn';
    return { tone, label: problems.length === 1 ? problems[0]!.label : `${problems.length} problems` };
  }
  const ok = claims.filter(i => i.tone === 'ok').length;
  if (ok < claims.length) return { tone: 'busy', label: ok ? `${ok} of ${claims.length} checks` : 'Checking' };
  return { tone: 'ok', label: `${ok} checks` };
}

/**
 * Routing errors, read from the design rule check's error types. This is not a measurement of the copper.
 * Null when it can't be said: the check didn't run, or it found errors of a type this doesn't recognise.
 */
export function routingErrors(job: BoardJob): number | null {
  if (!drcRan(job)) return null;
  const errors = job.drc?.errors ?? [];
  const known = errors.filter(e => /not_connected|autorouting|missing_trace/.test(e.type)).length;
  return known === 0 && errors.length > 0 ? null : known;
}

export function groupedWarnings(entries: readonly DrcEntry[]): { type: string; count: number; example: string }[] {
  const groups = new Map<string, { type: string; count: number; example: string }>();
  for (const e of entries) {
    const g = groups.get(e.type);
    if (g) g.count += 1;
    else groups.set(e.type, { type: e.type, count: 1, example: e.message });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export interface SummaryLine { text: string; bad?: boolean; more?: { title: string; lines: string[] } }
export interface Summary {
  tone: 'ok' | 'warn' | 'error';
  headline: string;
  sub: string | null;
  /** The pipeline's own words, untrimmed, behind a disclosure. */
  checked: SummaryLine[];
  unproven: SummaryLine[];
}

function shellLine(e: Json): string {
  const validation = obj(e.validation);
  const shells = [obj(obj(validation.base).stl).watertight, obj(obj(validation.lid).stl).watertight];
  if (shells.every(s => s === true)) return 'Base and lid are watertight.';
  if (shells.some(s => s === false)) return 'A shell is not watertight.';
  return '';
}

/** A compiler's first error as one line, with the server's paths taken out. The full text stays in the job's files. */
export function readableError(error: string): string {
  const tsx = /error: (.+?) at \S*board\.tsx:(\d+):\d+/.exec(error);
  if (tsx) return `board.tsx line ${tsx[2]}: ${tsx[1]}.`;
  return firstErrorLine(error);
}

/** What the build did and what it didn't prove, ending every finished run in the chat. */
export function summarize(job: BoardJob, facts: Facts): Summary {
  const stage = (name: string) => job.stages?.find(s => s.name === name);
  const generated = Boolean(job.artifacts?.['circuit.json']);
  const caseOk = stage('enclosure')?.status === 'done' && Boolean(job.artifacts?.['enclosure-base.stl']);
  const compile = compileState(job);
  const ran = drcRan(job);
  const errors = job.drc?.errors ?? [];
  const warnings = job.drc?.warnings ?? [];
  const seconds = job.totalMs ? formatDuration(job.totalMs) : null;

  const made = [generated && 'Board', caseOk && 'case', compile.kind === 'compiled' && 'firmware'].filter(Boolean) as string[];
  const joined = made.length > 1 ? `${made.slice(0, -1).join(', ')} and ${made.at(-1)}` : made[0] ?? '';
  const timed = `${joined} in ${seconds ?? 'an unreported time'}.`;

  let tone: Summary['tone'] = 'ok';
  let headline = timed;
  if (job.status === 'failed' || !generated) {
    tone = 'error';
    headline = job.error ? 'This build failed.' : 'This build produced no board.';
  } else if (errors.length) {
    tone = 'error';
    headline = `${timed.slice(0, -1)}, with ${errors.length} DRC error${errors.length === 1 ? '' : 's'}.`;
  } else if (!caseOk || (compile.kind !== 'compiled' && compile.kind !== 'none')) {
    tone = 'warn';
    const gaps = [
      !caseOk && 'The case wasn’t generated.',
      compile.kind === 'failed' && 'The firmware compile failed.',
      compile.kind === 'not-compiled' && 'The firmware wasn’t compiled.',
    ].filter(Boolean);
    headline = [timed, ...gaps].join(' ');
  }

  const enclosureNote = stage('enclosure')?.note ?? '';
  const subParts: string[] = [];
  if (job.status === 'failed' && job.error && readableError(job.error)) subParts.push(readableError(job.error));
  if (job.cache === 'hit') subParts.push(`The board came from the cache${/cache hit/i.test(enclosureNote) ? ' and so did the case geometry' : ''}.`);
  if (job.input?.kind === 'source') subParts.push('Built from TSX source, not a design.');

  const checked: SummaryLine[] = [];
  if (ran) {
    checked.push({
      text: `Design rule check: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      bad: errors.length > 0,
      more: errors.length + warnings.length ? {
        title: errors.length ? 'Errors and warnings' : 'Warnings',
        lines: [...groupedWarnings(errors), ...groupedWarnings(warnings)].map(g => `${g.count} × ${g.example}`),
      } : undefined,
    });
  }
  const board = job.board && job.board.widthMm > 0 ? job.board : null;
  if (board) {
    const open = routingErrors(job) ?? 0;
    checked.push({ text: `Routed ${board.traceCount} traces and ${board.viaCount} vias on a ${board.layers}-layer ${board.widthMm} × ${board.heightMm} mm board${open ? `, with ${open} routing error${open === 1 ? '' : 's'}` : ''}.`, bad: open > 0 });
  }
  const e = facts.enclosure;
  if (caseOk && e) {
    const engine = obj(e.engine);
    const outer = boxMm(obj(e.dimensions).outerMm);
    const shells = shellLine(e);
    checked.push({ text: [`Case modelled${str(engine.name) ? ` in ${str(engine.name)}` : ''}${outer ? `: ${outer}` : ''}.`, shells].filter(Boolean).join(' '), bad: shells.includes('not watertight') });
  }
  if (compile.kind === 'compiled') {
    const f = facts.firmware;
    const flash = f ? usage(f.flash) : null;
    const ram = f ? usage(f.ram) : null;
    checked.push({ text: `Firmware compiled${f && str(f.board) ? ` for ${str(f.board)}` : ''}${flash ? `, ${flash} flash` : ''}${ram ? `, ${ram} RAM` : ''}.` });
  }

  // A build with no board has nothing to qualify. Listing limits there would pad out the failure.
  if (!generated) return { tone, headline, sub: subParts.join(' ') || null, checked, unproven: [] };

  const unproven: SummaryLine[] = [{ text: 'Nothing has been fabricated, printed, flashed or powered.' }];
  if (ran) unproven.push({ text: DRC_SCOPE });
  const parts = e ? objects(obj(e.stack).parts).filter(p => str(p.confidence)) : [];
  if (parts.length) {
    unproven.push({
      text: `Module sizes aren’t confirmed for ${parts.length} part${parts.length === 1 ? '' : 's'}. Measure the real modules before ordering.`,
      more: { title: 'What’s known about each part', lines: parts.map(p => `${str(p.id)}: ${str(p.confidence)}`) },
    });
  }
  if (compile.kind === 'compiled') unproven.push({ text: 'The firmware compiles, but its behaviour hasn’t run on hardware.' });
  if (compile.kind === 'not-compiled' || compile.kind === 'failed') unproven.push({ text: compile.kind === 'failed' ? `Firmware: ${compile.reason}` : `Firmware wasn’t compiled. ${compile.reason}` });
  unproven.push({ text: 'No part prices or stock were checked, and power and heat weren’t simulated.' });

  return { tone, headline, sub: subParts.join(' ') || null, checked, unproven };
}

/** What's happening right now, for the pill over the canvas. */
export function activity(job: BoardJob | null, posting: boolean): string | null {
  if (posting) return 'Sending the design';
  if (!job || !inFlight(job)) return null;
  if (job.status === 'queued') return 'Waiting for the build before this one';
  const running = stageRows(job, {}).find(r => r.state === 'running')?.name;
  if (!running) return 'Starting';
  if ((CHAPTERS[0].stages as readonly string[]).includes(running)) return 'Rendering and routing the board';
  if (running === 'enclosure') return 'Modelling the case';
  return 'Writing and compiling firmware';
}
