import { Box, Check, CircleDashed, CircleX, Download, History, LoaderCircle, RotateCw, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatBytes } from '../board/logic';
import type { BoardJob } from '../board/types';
import { capitalize, templateName } from './conversation';
import { activity, cacheLabels, formatDuration, inFlight, proofChip, proofItems, routingErrors, type ProofTone } from './facts';
import type { RecentJob } from './Chat';
import type { Draft } from './CodeTab';
import type { EditControls } from './BoardCanvas';
import { PaneContext, PaneState } from './PaneState';
import { artifactAction } from './parts';
import { PartCard } from './PartCard';
import { DockChoice, RailButton, usePaneKeys } from './Rail';
import { useBoardModel } from './useBoardModel';
import type { SchematicContext } from './schematic/SchematicPane';
import { CANVAS_WAIT, type CanvasWait } from './canvasWait';
import type { LidMode } from './ModelPane';

const PcbPane = lazy(() => import('./PcbPane'));
const ModelPane = lazy(() => import('./ModelPane'));
const CaseTab = lazy(() => import('./CaseTab'));
const FirmwareTab = lazy(() => import('./FirmwareTab'));
const CodeTab = lazy(() => import('./CodeTab'));
const SchematicPane = lazy(() => import('./schematic/SchematicPane'));

export const TABS = [
  { id: 'schematic', label: 'Schematic', needs: 'schematic.svg' },
  { id: 'pcb', label: 'PCB', needs: 'circuit.json' },
  { id: '3d', label: '3D', needs: 'board.glb' },
  { id: 'case', label: 'Case', needs: 'enclosure.json' },
  { id: 'firmware', label: 'Firmware', needs: 'firmware.zip' },
  { id: 'code', label: 'Code', needs: 'board.tsx' },
] as const;
export type TabId = (typeof TABS)[number]['id'];
export type ModelView = 'board' | 'case' | 'exploded';

/** What the schematic's title block can state from the job itself. */
export function titleBlock(job: BoardJob): readonly (readonly [string, string])[] {
  const name = job.input?.kind === 'source' ? 'Edited board' : capitalize(templateName(job.input?.template) ?? 'Board');
  const made = (job as BoardJob & { createdAt?: string }).createdAt;
  return [
    ['Title', name],
    ...(job.board && job.board.widthMm > 0 ? [['Board', `${job.board.widthMm} × ${job.board.heightMm} mm`] as const] : []),
    ['Build', job.jobId.slice(0, 8)],
    ...(made ? [['Date', new Date(made).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })] as const] : []),
    ['Sheet', '1 of 1'],
  ];
}

function ThreeTab({ job, view, setView, part, onPart }: { job: BoardJob; view: ModelView; setView: (v: ModelView) => void; part: string | null; onPart: (ref: string | null) => void }) {
  const board = job.artifacts?.['board.glb'];
  const assembly = job.artifacts?.['assembly.glb'];
  const [lid, setLid] = useState<LidMode>('solid');
  const inCase = view !== 'board' && Boolean(assembly);
  const showing = inCase ? assembly : board;
  if (!showing) return <PaneState what="the 3D model" waiting={inFlight(job)} absent={inFlight(job) ? 'The model appears when the board stage finishes.' : 'This build has no 3D model.'} />;
  const nextLid: Record<LidMode, LidMode> = { solid: 'ghost', ghost: 'hidden', hidden: 'solid' };
  const lidName: Record<LidMode, string> = { solid: 'Lid: solid', ghost: 'Lid: see-through', hidden: 'Lid: off' };
  const noAssembly = assembly ? undefined : 'No assembly in this build';
  return (
    <Suspense fallback={<PaneState what="the 3D viewer" />}>
      <ModelPane
        url={showing.url}
        format="glb"
        label={inCase ? 'The populated board in its case, as a 3D model' : 'The populated board, as a 3D model'}
        lid={view === 'exploded' ? 'solid' : lid}
        explode={view === 'exploded' ? 'exploded' : 'assembled'}
        selected={part}
        onSelect={onPart}
        views={(
          <DockChoice<ModelView> label="3D view" value={view} onChange={setView} options={[
            { id: 'board', label: 'Board' },
            { id: 'case', label: 'In case', disabled: !assembly, title: noAssembly },
            { id: 'exploded', label: 'Exploded', disabled: !assembly, title: noAssembly },
          ]} />
        )}
        tools={view === 'case' && assembly ? <RailButton label={lidName[lid]} pressed={lid !== 'solid'} onClick={() => setLid(nextLid[lid])}><Box size={16} /></RailButton> : undefined}
      />
    </Suspense>
  );
}

export interface CanvasSelection { part: string | null; net: string | null }
const PART_TABS: readonly TabId[] = ['pcb', '3d', 'case'];

/** The card follows a selection across every tab that can show the part. */
function SelectedPart({ job, tab, selection, setSelection }: { job: BoardJob; tab: TabId; selection: CanvasSelection; setSelection: (s: CanvasSelection) => void }) {
  const board = useBoardModel(job.artifacts?.['circuit.json'], Boolean(selection.part));
  if (!selection.part || !PART_TABS.includes(tab) || board.state !== 'ready' || !board.model) return null;
  // The card takes the side of the drawing that the part isn't on, so it never covers what you picked.
  const on = board.model.parts.find(p => p.ref === selection.part);
  const away = tab === 'pcb' && on && on.x < board.model.board.x;
  return (
    <div className={`st-part-slot is-${tab}${away ? ' is-away' : ''}`}>
      <PartCard key={selection.part} model={board.model} part={selection.part} net={selection.net} onClose={() => setSelection({ part: null, net: null })} onNet={tab === 'pcb' ? net => setSelection({ ...selection, net }) : undefined} />
    </div>
  );
}

function CanvasNote({ state, paper }: { state: CanvasWait; paper: boolean }) {
  return (
    <div className={`st-canvas-note${paper ? ' is-paper' : ''}`} role="status">
      {state === 'working' && <span className="st-canvas-dot" aria-hidden="true" />}
      <p>{CANVAS_WAIT[state]}</p>
    </div>
  );
}

export function CanvasBody({ job, tab, view, setView, draft, setDraft, busy, onRender, selection, setSelection, edit, schematic }: { job: BoardJob | null; tab: TabId; view: ModelView; setView: (v: ModelView) => void; draft: Draft; setDraft: (d: Draft) => void; busy: boolean; onRender: () => void; selection: CanvasSelection; setSelection: (s: CanvasSelection) => void; edit: EditControls; schematic: SchematicContext }) {
  const onPart = useCallback((part: string | null) => setSelection({ part, net: null }), [setSelection]);
  usePaneKeys(tab === 'pcb' ? {} : { Escape: () => setSelection({ part: null, net: null }) });
  // The sheet doesn't wait for a build, and a build landing must not remount it: job or no job, this is one place in the tree.
  // The schematic tab is always the sheet: an empty one before anything exists, never a status note (owner, 6 Nov).
  if (tab === 'schematic') {
    return (
      <PaneContext.Provider value={{ art: tab, failed: job?.status === 'failed' }}>
        <Suspense fallback={<div className="st-canvas-note is-paper" aria-hidden="true" />}><SchematicPane job={job} part={selection.part} onPart={onPart} context={schematic} /></Suspense>
      </PaneContext.Provider>
    );
  }
  if (!job) return <CanvasNote state={schematic.empty} paper={false} />;
  return (
    <PaneContext.Provider value={{ art: tab, failed: job.status === 'failed' }}>
    <Suspense fallback={<PaneState what="this view" />}>
      {tab === 'pcb' && <PcbPane job={job} selection={selection} setSelection={setSelection} edit={edit} />}
      {tab === '3d' && <ThreeTab job={job} view={view} setView={setView} part={selection.part} onPart={onPart} />}
      {tab === 'case' && <CaseTab job={job} part={selection.part} onPart={onPart} />}
      {tab === 'firmware' && <FirmwareTab job={job} />}
      {tab === 'code' && <CodeTab key={job.jobId} job={job} draft={draft} setDraft={setDraft} busy={busy} onRender={onRender} />}
    </Suspense>
    <SelectedPart job={job} tab={tab} selection={selection} setSelection={setSelection} />
    </PaneContext.Provider>
  );
}

function ProofMark({ tone }: { tone: ProofTone }) {
  const size = 13;
  if (tone === 'ok') return <Check size={size} aria-hidden="true" />;
  if (tone === 'busy') return <LoaderCircle size={size} className="st-spin" aria-hidden="true" />;
  if (tone === 'warn') return <TriangleAlert size={size} aria-hidden="true" />;
  if (tone === 'error') return <CircleX size={size} aria-hidden="true" />;
  return <CircleDashed size={size} aria-hidden="true" />;
}

/** One quiet line in the bar. It opens the same claims, in words, for anyone who wants them. */
export function ProofPill({ job }: { job: BoardJob | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  if (!job) return null;
  const items = proofItems(job);
  const chip = proofChip(items);
  const printed = items.find(i => i.tone === 'open');
  return (
    <div className="st-menu st-proof-menu" ref={ref}>
      <button type="button" className={`st-proof-chip is-${chip.tone}`} aria-expanded={open} aria-haspopup="true" aria-label={`${chip.label}${printed ? `, ${printed.label.toLowerCase()}` : ''}. Show what this build has and hasn’t proven.`} onClick={() => setOpen(o => !o)}>
        <ProofMark tone={chip.tone} /><span className="st-proof-chip-label">{chip.label}</span>{printed && <span className="st-proof-chip-open">{printed.label}</span>}
      </button>
      {open && (
        <div className="st-popover is-right">
          <p className="st-popover-title">What this build has and hasn’t proven</p>
          <ul className="st-proof-list">
            {items.map(item => <li key={item.key} className={`is-${item.tone}`}><ProofMark tone={item.tone} /><div><strong>{item.label}</strong><p>{item.title}</p></div></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

function Menu({ label, icon, text, children, onOpen, disabled, align }: { label: string; icon: ReactNode; text?: string; children: (close: () => void) => ReactNode; onOpen?: () => void; disabled?: boolean; align?: 'right' }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  return (
    <div className="st-menu" ref={ref}>
      <button type="button" className={text ? 'st-bar-button' : 'st-bar-icon'} aria-label={label} title={label} aria-expanded={open} aria-haspopup="true" disabled={disabled} onClick={() => { if (!open) onOpen?.(); setOpen(o => !o); }}>
        {icon}{text && <span>{text}</span>}
      </button>
      {open && <div className={`st-popover${align === 'right' ? ' is-right' : ''}`}>{children(close)}</div>}
    </div>
  );
}

export function HistoryMenu({ recent, loadRecent, onOpen, currentId }: { recent: RecentJob[] | null; loadRecent: () => void; onOpen: (id: string) => void; currentId: string | null }) {
  return (
    <Menu label="History" icon={<History size={16} aria-hidden="true" />} onOpen={loadRecent} align="right">
      {close => (
        <>
          <p className="st-popover-title">Recent builds</p>
          {recent === null && <p className="st-popover-empty">Loading</p>}
          {recent?.length === 0 && <p className="st-popover-empty">No builds yet.</p>}
          <ul className="st-history">
            {recent?.slice(0, 12).map(job => (
              <li key={job.jobId}>
                <button type="button" aria-current={job.jobId === currentId} onClick={() => { onOpen(job.jobId); close(); }}>
                  <span className="st-history-name">{capitalize(templateName(job.template) ?? (job.kind === 'source' ? 'Edited board' : 'Board'))}</span>
                  <span className="st-history-when">{job.createdAt ? new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <span className={`st-history-time${job.status === 'failed' ? ' is-failed' : ''}`}>{job.status === 'failed' ? 'failed' : job.totalMs ? formatDuration(job.totalMs) : job.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Menu>
  );
}

export function DownloadMenu({ job, onAll, working }: { job: BoardJob | null; onAll: (job: BoardJob) => void; working: boolean }) {
  const artifacts = Object.entries(job?.artifacts ?? {}).filter(([name]) => name !== 'receipt.json');
  // Files people act on go above the list, under their action's name. The rest are listed by file name.
  const actions = artifacts.filter(([name]) => artifactAction(name));
  return (
    <Menu label="Download" text="Download" icon={<Download size={15} aria-hidden="true" />} disabled={!job || artifacts.length === 0} align="right">
      {close => (
        <>
          <button type="button" className="st-popover-primary" disabled={working} onClick={() => { if (job) onAll(job); close(); }}>
            <Download size={14} aria-hidden="true" />All {artifacts.length} files as a .zip
          </button>
          {actions.map(([name, a]) => (
            <a key={name} className="st-popover-action" href={a.url} download={name} title={`Downloads ${name}, a project KiCad can open`}><span>{artifactAction(name)}</span><em>{name} · {formatBytes(a.bytes)}</em></a>
          ))}
          <ul className="st-downloads">
            {artifacts.filter(([name]) => !artifactAction(name)).map(([name, a]) => <li key={name}><a href={a.url} download={name}><span>{name}</span><em>{formatBytes(a.bytes)}</em></a></li>)}
          </ul>
        </>
      )}
    </Menu>
  );
}

export function RerunButton({ onClick, disabled, busy }: { onClick: () => void; disabled: boolean; busy: boolean }) {
  return <button type="button" className="st-bar-icon" aria-label="Re-run this build" title="Re-run this build" disabled={disabled} onClick={onClick}><RotateCw size={15} className={busy ? 'st-spin' : undefined} aria-hidden="true" /></button>;
}

/** Units, the check, routing and time: what an EDA tool keeps at the foot of its window. */
export function StatusStrip({ job, running }: { job: BoardJob | null; running: { startedAt: number | null } }) {
  const active = inFlight(job) || (running.startedAt !== null && !job);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [active]);
  const board = job?.board && job.board.widthMm > 0 ? job.board : null;
  const checked = job?.drc && (job.drc.checked ?? false);
  const errors = job?.drc?.errors.length ?? 0;
  const warnings = job?.drc?.warnings.length ?? 0;
  const open = job ? routingErrors(job) : null;
  return (
    <footer className="st-status">
      <Readout label="Units" value="mm" />
      {checked
        ? <Readout label="DRC" value={`${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'}`} tone={errors ? 'error' : warnings ? undefined : 'ok'} />
        : <Readout label="DRC" value="not run" tone="quiet" />}
      {board && <Readout label="Traces" value={`${board.traceCount} routed${open !== null ? ` · ${open} routing error${open === 1 ? '' : 's'}` : ''}`} tone={open ? 'error' : undefined} title="Routing errors come from the design rule check’s error types. They aren’t measured on the copper." />}
      {board && <Readout label="Board" value={`${board.widthMm} × ${board.heightMm} mm · ${board.layers} layers`} />}
      <span className="st-status-grow" />
      {active && running.startedAt !== null && <Readout label="Building" value={`${((now - running.startedAt) / 1000).toFixed(1)} s`} />}
      {!active && job?.totalMs ? <Readout label="Built in" value={formatDuration(job.totalMs)} /> : null}
      {!active && job && cacheLabels(job).map(label => <span key={label} className="st-status-note">{label}</span>)}
    </footer>
  );
}

function Readout({ label, value, tone, title }: { label: string; value: string; tone?: 'ok' | 'error' | 'quiet'; title?: string }) {
  return <span className={`st-readout${tone ? ` is-${tone}` : ''}`} title={title}><em>{label}</em><span>{value}</span></span>;
}

export function ActivityPill({ job, posting, startedAt }: { job: BoardJob | null; posting: boolean; startedAt: number | null }) {
  const text = activity(job, posting);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!text) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [text]);
  if (!text) return null;
  return (
    <div className="st-activity" role="status">
      <LoaderCircle size={14} className="st-spin" aria-hidden="true" />
      <span>{text}</span>
      {startedAt !== null && <em>{((now - startedAt) / 1000).toFixed(1)} s</em>}
    </div>
  );
}
