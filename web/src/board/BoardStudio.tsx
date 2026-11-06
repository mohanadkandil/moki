import { ArrowLeft, CircleAlert, CircleCheck, CircleDashed, CircleX, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { firstErrorLine } from '../../../src/board/failure';
import type { CircuitDesign } from '../../../src/circuit/model';
import { boardApi, useBoardRun } from './api';
import { compileState, drcRan, jobToDisplay, jobTitle } from './logic';
import { CodePanel, EnclosurePanel, FilesPanel, FirmwarePanel, ModelPanel, PcbPanel, SchematicPanel, type CodeDraft } from './panels';
import TimingStrip from './TimingStrip';
import { TAB_IDS, type BoardJob, type TabId } from './types';

export interface BoardRequest {
  /** Increases with each press of Build board, so the same design can be built again. */
  nonce: number;
  design?: CircuitDesign;
  /** Open an existing job, from a ?board= link. */
  jobId?: string;
}

const TAB_LABEL: Record<TabId, string> = { schematic: 'Schematic', pcb: 'PCB', '3d': '3D', enclosure: 'Enclosure', firmware: 'Firmware', code: 'Code', files: 'Files' };

function readTab(): TabId {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return (TAB_IDS as readonly string[]).includes(tab ?? '') ? (tab as TabId) : 'schematic';
}

function writeUrl(values: Record<string, string | null>) {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) { if (v === null) q.delete(k); else q.set(k, v); }
  const search = q.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
}

type Tone = 'ok' | 'warn' | 'error' | 'open' | 'busy';

function Rung({ tone, label, detail }: { tone: Tone; label: string; detail: string }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? CircleAlert : tone === 'error' ? CircleX : tone === 'busy' ? LoaderCircle : CircleDashed;
  return (
    <li className={`bs-rung is-${tone}`}>
      <Icon size={15} className={tone === 'busy' ? 'bs-spin' : undefined} aria-hidden="true" />
      <span className="bs-rung-text"><strong>{label}</strong><span>{detail}</span></span>
    </li>
  );
}

/** How far this build's claims go. The four rungs are kept apart so none reads as implying another. */
function Ladder({ job }: { job: BoardJob | null }) {
  const busy = !job || job.status === 'queued' || job.status === 'running';
  const ran = job ? drcRan(job) : false;
  const errors = job?.drc?.errors.length ?? 0;
  const warnings = job?.drc?.warnings.length ?? 0;
  const compile = job ? compileState(job) : ({ kind: 'pending' } as const);
  const source = job?.input?.kind === 'source';
  const generated = job?.artifacts?.['circuit.json'] !== undefined;
  return (
    <ul className="bs-ladder" aria-label="What has and hasn’t been checked">
      <Rung
        tone={generated ? 'ok' : busy ? 'busy' : 'error'}
        label="Generated"
        detail={generated ? (source ? 'From your edited TSX' : 'From the design graph') : busy ? 'Working' : 'No output'}
      />
      <Rung
        tone={!ran ? (busy ? 'busy' : 'warn') : errors ? 'error' : warnings ? 'warn' : 'ok'}
        label="Checked by DRC"
        detail={!ran ? (busy ? 'Working' : 'Did not run') : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`}
      />
      <Rung
        tone={compile.kind === 'compiled' || compile.kind === 'none' ? 'ok' : compile.kind === 'pending' ? 'busy' : compile.kind === 'failed' ? 'error' : 'warn'}
        label={compile.kind === 'none' ? 'No firmware' : compile.kind === 'compiled' ? 'Firmware compiled' : compile.kind === 'failed' ? 'Firmware compile failed' : compile.kind === 'pending' ? 'Firmware' : 'Firmware not compiled'}
        detail={compile.kind === 'none' ? 'This board has no code' : compile.kind === 'compiled' ? 'Not flashed' : compile.kind === 'pending' ? 'Working' : source ? 'Edited source has no firmware' : 'See Firmware'}
      />
      <Rung tone="open" label="Not physically tested" detail="Nothing fabricated or powered" />
    </ul>
  );
}

export default function BoardStudio({ request, visible, onClose }: { request: BoardRequest; visible: boolean; onClose: () => void }) {
  const run = useBoardRun();
  const [tab, setTab] = useState<TabId>(readTab);
  const [draft, setDraft] = useState<CodeDraft>({ text: '', base: null, baseJobId: null });
  const [designTitle, setDesignTitle] = useState(request.design?.title);
  const handled = useRef(-1);
  const isMock = boardApi().isMock;

  // Runs once per nonce. StrictMode's second effect pass must not post a second job.
  useEffect(() => {
    if (handled.current === request.nonce) return;
    handled.current = request.nonce;
    if (request.design) { setDesignTitle(request.design.title); run.start({ design: request.design }); }
    else if (request.jobId) run.follow(request.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce]);

  const followed = run.job;
  useEffect(() => {
    if (!visible) return;
    writeUrl(followed ? { board: followed.jobId, tab } : { tab });
  }, [visible, followed?.jobId, tab]);

  const shown = jobToDisplay(followed, run.lastGood);
  // A job with a terminal status is finished, even during the last polls that confirm its file list.
  const finished = followed?.status === 'done' || followed?.status === 'failed';
  const busy = run.phase === 'posting' || (run.phase === 'polling' && !finished);
  const failed = followed?.status === 'failed';
  const showingOlder = shown && followed && shown.jobId !== followed.jobId;
  // A job that never rendered reports a 0 × 0 board. That's a placeholder, not a measurement.
  const board = shown?.board && shown.board.widthMm > 0 ? shown.board : undefined;

  const heading = jobTitle(shown, designTitle);

  function selectTab(next: TabId, focus = false) {
    setTab(next);
    const el = document.getElementById(`bs-tab-${next}`);
    if (focus) el?.focus();
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function onTabKey(e: React.KeyboardEvent, id: TabId) {
    const i = TAB_IDS.indexOf(id);
    let next: TabId | undefined;
    if (e.key === 'ArrowRight') next = TAB_IDS[(i + 1) % TAB_IDS.length];
    else if (e.key === 'ArrowLeft') next = TAB_IDS[(i - 1 + TAB_IDS.length) % TAB_IDS.length];
    else if (e.key === 'Home') next = TAB_IDS[0];
    else if (e.key === 'End') next = TAB_IDS[TAB_IDS.length - 1];
    if (next) { e.preventDefault(); selectTab(next, true); }
  }

  function close() {
    writeUrl({ board: null, tab: null });
    onClose();
  }

  function rerender() {
    if (draft.text !== draft.base) run.start({ source: draft.text, baseJobId: draft.baseJobId ?? undefined });
  }

  return (
    <section className="bs" aria-labelledby="bs-heading" style={visible ? undefined : { display: 'none' }}>
      <header className="bs-head">
        <button type="button" className="lab-text-button bs-back" onClick={close}><ArrowLeft size={15} aria-hidden="true" />Drawing</button>
        <div className="bs-heading">
          <h1 id="bs-heading">{heading.name}<span>{heading.rest}</span></h1>
          <p className="lab-quiet">
            {board ? `${board.widthMm} × ${board.heightMm} mm · ${board.layers} layers · ${board.traceCount} traces · ${board.viaCount} vias` : busy ? 'Modules plug into headers on this board.' : 'No board measurements reported.'}
          </p>
        </div>
        <Ladder job={followed ?? shown} />
      </header>

      {isMock && <p className="bs-mock" role="note">Mock data (<span className="lab-mono">?mock=board</span>). Nothing here was rendered by the pipeline, and these timings aren’t measurements.</p>}

      <TimingStrip job={followed} waiting={busy && !followed} startedAt={run.startedAt} />

      {run.phase === 'lost' && <p className="bs-failed" role="alert"><CircleX size={16} aria-hidden="true" /><span><strong>Lost contact with the board service.</strong> {run.serviceError}</span></p>}
      {failed && (
        <p className="bs-failed" role="alert">
          <CircleX size={16} aria-hidden="true" />
          <span><strong>This build failed.</strong> {followed.error ? firstErrorLine(followed.error) : 'The service gave no reason.'}{showingOlder ? ' Still showing the last build that finished.' : ''}</span>
        </p>
      )}
      {showingOlder && !failed && <p className="lab-banner">Building. Still showing the last build that finished.</p>}

      <div className="bs-main">
        <div className="lab-tabs bs-tabs" role="tablist" aria-label="Board outputs">
          {TAB_IDS.map(id => (
            <button
              key={id} id={`bs-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="bs-panel" tabIndex={tab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={e => onTabKey(e, id)}
            >{TAB_LABEL[id]}</button>
          ))}
        </div>
        <div id="bs-panel" role="tabpanel" aria-labelledby={`bs-tab-${tab}`} className={`bs-panel is-${tab}`}>
          {!shown ? (
            run.phase === 'lost'
              ? <div className="bs-state"><CircleAlert size={20} aria-hidden="true" /><p><strong>Nothing to show.</strong></p><p className="lab-quiet">{request.design ? 'The build never reached the service.' : 'This build isn’t on the service.'} Go back to the drawing and press Build board to try again.</p></div>
              : <div className="bs-state" role="status"><LoaderCircle size={20} className="bs-spin" aria-hidden="true" /><p>{request.design ? 'Sending the design…' : 'Finding this build…'}</p></div>
          ) : tab === 'schematic' ? <SchematicPanel job={shown} />
            : tab === 'pcb' ? <PcbPanel job={shown} />
              : tab === '3d' ? <ModelPanel job={shown} />
                : tab === 'enclosure' ? <EnclosurePanel job={shown} />
                  : tab === 'firmware' ? <FirmwarePanel job={shown} />
                    : tab === 'code' ? <CodePanel job={shown} draft={draft} setDraft={setDraft} busy={busy} onRender={rerender} olderBuild={Boolean(showingOlder)} />
                      : <FilesPanel job={shown} />}
        </div>
      </div>
    </section>
  );
}
