import { ArrowUp, Check, ChevronRight, CircleAlert, CircleDashed, Download, LoaderCircle, PencilLine, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { EXAMPLE_BRIEFS, MAX_BRIEF_LENGTH, TEMPLATE_NAMES } from '../../../src/circuit/interpret';
import type { TemplateId } from '../../../src/circuit/model';
import { useArtifact } from '../board/api';
import type { BoardJob } from '../board/types';
import { asAgentTurn, useAgentStatus } from './agentChat';
import { AgentPicker } from './agentPicker';
import { AgentTurnCard } from './agentCards';
import { capitalize, templateName, type Turn } from './conversation';
import type { TabId } from './Canvas';
import { CHAPTER_TAB, CHAPTERS, formatDuration, inFlight, obj, otherTime, STAGE_TAB, stageRows, summarize, type Facts, type StageRow, type SummaryLine } from './facts';

const asJson = (res: Response) => res.json() as Promise<unknown>;
const X_ODD = 7;
const X_EVEN = 17;

/** A finished job's receipts, for the numbers its rows and summary quote. */
export function useFacts(job: BoardJob | null): Facts {
  const enclosure = useArtifact(job?.artifacts?.['enclosure.json'], asJson);
  const firmware = useArtifact(job?.artifacts?.['firmware-build.json'], asJson);
  return {
    enclosure: job?.artifacts?.['enclosure.json'] && enclosure.state === 'ready' ? obj(enclosure.value) : undefined,
    firmware: job?.artifacts?.['firmware-build.json'] && firmware.state === 'ready' ? obj(firmware.value) : undefined,
  };
}

function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function StageItem({ row, last, clock, onStep }: { row: StageRow; last: boolean; clock: string | null; onStep: (tab: TabId) => void }) {
  const canOpen = row.details.length > 0 || Boolean(row.note);
  const tab = STAGE_TAB[row.name];
  const [open, setOpen] = useState(row.state === 'failed');
  useEffect(() => { if (row.state === 'failed') setOpen(true); }, [row.state]);
  const running = row.state === 'running';
  const lit = row.state === 'done' || row.state === 'reused';
  const name = <span className="st-stage-name">{row.label}</span>;
  const fact = row.fact && <span className="st-stage-fact">{row.fact}</span>;
  const time = <span className="st-stage-time">{running ? clock : row.state === 'pending' ? '' : row.state === 'not-reported' ? 'not reported' : row.time}</span>;
  return (
    <li className={`st-stage is-${row.state}${lit ? ' is-lit' : ''}${last ? ' is-end' : ''}`}>
      <span className="st-pad" aria-hidden="true" />
      {tab || canOpen ? (
        <button type="button" className="st-stage-row" aria-expanded={canOpen ? open : undefined} onClick={() => { if (canOpen) setOpen(o => !o); if (tab) onStep(tab); }}>
          {name}{fact}{time}{canOpen ? <ChevronRight size={14} className="st-stage-chev" aria-hidden="true" /> : <span className="st-stage-chev" />}
        </button>
      ) : (
        <div className="st-stage-row">{name}{fact}{time}<span className="st-stage-chev" /></div>
      )}
      {running && <span className="st-sr" role="status">{row.label} is running</span>}
      {open && canOpen && (
        <div className="st-stage-detail">
          {row.details.length > 0 && <dl>{row.details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
          {row.note && <p>{row.note.length > 900 ? `${row.note.slice(0, 900)}…` : row.note}</p>}
        </div>
      )}
    </li>
  );
}

const MERGED: Record<string, string> = { board: 'Render, route and export the board', firmware: 'Write and compile firmware' };

/** A chapter's one-line result, for when its rows are folded away. */
function chapterFact(id: string, rows: StageRow[], cached: boolean): string | null {
  const pick = (name: string) => rows.find(r => r.name === name)?.fact ?? null;
  if (rows.some(r => r.state === 'failed')) return 'Failed';
  if (id === 'board') return [pick('route'), cached ? 'cached' : null].filter(Boolean).join(', ') || null;
  if (id === 'case') return pick('enclosure');
  return pick('firmware-compile');
}

function Chapter({ id, label, items, x, from, first, last, jogLit, active, cached, clock, onStep }: { id: string; label: string; items: StageRow[]; x: number; from: number; first: boolean; last: boolean; jogLit: boolean; active: boolean; cached: boolean; clock: string | null; onStep: (tab: TabId) => void }) {
  const failed = items.some(r => r.state === 'failed');
  const [openByHand, setOpenByHand] = useState<boolean | null>(null);
  const open = openByHand ?? (active || failed);
  const total = items.reduce((sum, r) => sum + (r.state === 'done' || r.state === 'failed' ? r.ms ?? 0 : 0), 0);
  const lit = items.every(r => r.state === 'done' || r.state === 'reused');
  // A worker reports all its stages when it exits, so what's left in a running chapter is one step on screen.
  const runningAt = items.findIndex(r => r.state === 'running');
  const rows = runningAt >= 0 && items.length - runningAt > 1
    ? [...items.slice(0, runningAt), { ...items[runningAt]!, label: MERGED[id] ?? items[runningAt]!.label }]
    : items;
  const path = first ? `M${x + 1} 17V${open || !last ? 40 : 17}` : `M${from + 1} 0V5L${x + 1} 15V${!open && last ? 17 : 40}`;
  const summary = open ? null : chapterFact(id, items, cached);
  const inner = (
    <>
      <svg className={`st-jog${jogLit ? ' is-lit' : ''}`} width="26" height="34" viewBox="0 0 26 34" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
      {!open && <span className={`st-pad${lit ? ' is-on' : ''}${failed ? ' is-bad' : ''}`} aria-hidden="true" />}
      <span className="st-chapter-name">{label}</span>
      {summary ? <span className="st-chapter-fact">{summary}</span> : <span />}
      <span className="st-chapter-total">{total > 0 ? formatDuration(total) : ''}</span>
    </>
  );
  return (
    <section className={`st-chapter${open ? '' : ' is-closed'}`} style={{ '--x': `${x}px` } as React.CSSProperties}>
      {active
        ? <header className="st-chapter-head">{inner}<span /></header>
        : <button type="button" className="st-chapter-head" aria-expanded={open} onClick={() => { setOpenByHand(!open); const tab = CHAPTER_TAB[id]; if (tab) onStep(tab); }}>{inner}<ChevronRight size={14} className="st-chapter-chev" aria-hidden="true" /></button>}
      {open && <ol>{rows.map((row, n) => <StageItem key={row.name} row={row} last={last && n === rows.length - 1} clock={clock} onStep={onStep} />)}</ol>}
    </section>
  );
}

/** The run as one routed trace: each stage a pad on it, each chapter a 45° jog to the next. Folds when finished. */
function RunSheet({ job, facts, onStep }: { job: BoardJob; facts: Facts; onStep: (tab: TabId) => void }) {
  const active = inFlight(job);
  const now = useTicker(active);
  const reported = job.stages?.length ?? 0;
  const lastReport = useRef({ count: reported, at: Date.now() });
  if (lastReport.current.count !== reported) lastReport.current = { count: reported, at: Date.now() };
  const clock = active ? `${((now - lastReport.current.at) / 1000).toFixed(1)} s` : null;
  const rows = stageRows(job, facts);
  const other = otherTime(job);
  const byName = new Map(rows.map(r => [r.name, r]));
  let previousDone = true;
  return (
    <div className="st-run" aria-label="Build steps">
      {CHAPTERS.map((chapter, i) => {
        const items = chapter.stages.map(s => byName.get(s)).filter((r): r is StageRow => Boolean(r));
        if (!items.length) return null;
        const jogLit = previousDone;
        previousDone = items.every(r => r.state === 'done' || r.state === 'reused');
        return (
          <Chapter
            key={chapter.id}
            id={chapter.id}
            label={chapter.label}
            items={items}
            x={i % 2 ? X_EVEN : X_ODD}
            from={i % 2 ? X_ODD : X_EVEN}
            first={i === 0}
            last={i === CHAPTERS.length - 1}
            jogLit={jogLit}
            active={active}
            cached={job.cache === 'hit'}
            clock={clock}
            onStep={onStep}
          />
        );
      })}
      {other && (
        <p className="st-run-other">
          <span className="st-chapter-name">Other</span>
          <span className="st-chapter-fact">Starting up, hashing and saving</span>
          <span className="st-chapter-total">{other}</span>
        </p>
      )}
    </div>
  );
}

function SummaryList({ title, lines, icon }: { title: string; lines: SummaryLine[]; icon: ReactNode }) {
  if (!lines.length) return null;
  return (
    <div className="st-summary-list">
      <h4>{title}</h4>
      <ul>
        {lines.map(line => (
          <li key={line.text}>
            <span className={`st-summary-mark${line.bad ? ' is-bad' : ''}`} aria-hidden="true">{line.bad ? <X size={14} /> : icon}</span>
            <div>
              {line.text}
              {line.more && line.more.lines.length > 0 && (
                <details className="st-summary-more">
                  <summary>{line.more.title}</summary>
                  <ul>{line.more.lines.map(t => <li key={t}>{t}</li>)}</ul>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FOLLOW_UPS: Record<TemplateId, string[]> = {
  'focus-timer': ['Make it 45 minutes', 'Use GPIO 18 for the buzzer'],
  'light-lamp': ['Turn on when it gets darker than 20%', 'Use GPIO 18 for the LED'],
  'temp-monitor': ['Use a BME280 sensor', 'Use GPIO 18 for the buzzer'],
};

function RunTurn({ turn, latest, designTemplate, onCanvas, onShow, onDownload, onFollowUp, onViewBoard, onStep, busy }: { turn: Extract<Turn, { kind: 'run' }>; latest: boolean; designTemplate: TemplateId | null; onCanvas: boolean; onShow: () => void; onDownload: (job: BoardJob) => void; onFollowUp: (text: string) => void; onViewBoard: () => void; onStep: (tab: TabId) => void; busy: boolean }) {
  const facts = useFacts(turn.job);
  const job = turn.job;
  const header = turn.label && <p className="st-run-label">{turn.label}</p>;
  if (!job) {
    return (
      <div className="st-turn">
        {header}
        {turn.lost
          ? <div className="st-say is-error"><CircleAlert size={15} aria-hidden="true" /><div><strong>This build never reached the board service.</strong><p>{turn.lost}</p></div></div>
          : <p className="st-sending" role="status"><LoaderCircle size={14} className="st-spin" aria-hidden="true" />Sending the design</p>}
      </div>
    );
  }
  const done = !inFlight(job);
  const summary = done ? summarize(job, facts) : null;
  const template = job.input?.template as TemplateId | undefined;
  const hasOutputs = Boolean(job.artifacts?.['circuit.json']);
  return (
    <div className="st-turn">
      {header}
      {job.status === 'queued' && <p className="st-sending" role="status"><LoaderCircle size={14} className="st-spin" aria-hidden="true" />Waiting for the build before this one to finish</p>}
      <RunSheet job={job} facts={facts} onStep={onStep} />
      {turn.lost && <div className="st-say is-error"><CircleAlert size={15} aria-hidden="true" /><div><strong>Lost contact with the board service.</strong><p>{turn.lost}</p></div></div>}
      {summary && (
        <div className={`st-summary is-${summary.tone}`}>
          <p className="st-summary-head">{summary.headline}</p>
          {summary.sub && <p className="st-summary-sub">{summary.sub}</p>}
          {!hasOutputs && !onCanvas && <p className="st-summary-sub">The canvas still shows the last build that finished.</p>}
          {turn.waitedMs != null && turn.waitedMs > 2000 && <p className="st-summary-sub">It waited {formatDuration(turn.waitedMs)} behind another build first. That wait isn’t in the time above.</p>}
          <SummaryList title="Checked in software" lines={summary.checked} icon={<Check size={14} />} />
          <SummaryList title="Not proven" lines={summary.unproven} icon={<CircleDashed size={14} />} />
          <div className="st-summary-actions">
            {hasOutputs && <button type="button" className="st-paper-button" onClick={() => onDownload(job)}><Download size={14} aria-hidden="true" />Download all files</button>}
            {hasOutputs && <button type="button" className="st-paper-button st-only-mobile" onClick={onViewBoard}>View the board</button>}
            {hasOutputs && !onCanvas && <button type="button" className="st-paper-button" onClick={onShow}>Show on canvas</button>}
          </div>
          {latest && template && template === designTemplate && template in FOLLOW_UPS && !busy && (
            <div className="st-followups" aria-label="Try a change">
              {FOLLOW_UPS[template].map(text => <button key={text} type="button" onClick={() => onFollowUp(text)}>{text}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SayTurn({ turn, onEdit, onChoose }: { turn: Extract<Turn, { kind: 'say' }>; onEdit: (text: string) => void; onChoose: (template: TemplateId) => void }) {
  const Icon = turn.tone === 'unchanged' ? CircleDashed : turn.tone === 'refuse' ? X : CircleAlert;
  return (
    <div className={`st-turn st-say is-${turn.tone}`}>
      <Icon size={15} aria-hidden="true" />
      <div>
        <strong>{turn.title}</strong>
        {turn.lines.map(line => <p key={line}>{line}</p>)}
        {(turn.candidates?.length || turn.canEdit) && (
          <div className="st-say-actions">
            {turn.candidates?.map(id => <button key={id} type="button" className="st-paper-button" onClick={() => onChoose(id)}>Build the {TEMPLATE_NAMES[id]}</button>)}
            {turn.canEdit && turn.brief && <button type="button" className="st-paper-button" onClick={() => onEdit(turn.brief!)}><PencilLine size={14} aria-hidden="true" />Edit the brief</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export interface RecentJob { jobId: string; status: string; template?: string; totalMs?: number; kind?: string; createdAt?: string }

function Welcome({ onBrief, recent, onOpen }: { onBrief: (text: string) => void; recent: RecentJob[]; onOpen: (id: string) => void }) {
  return (
    <div className="st-welcome">
      <p className="st-welcome-title">What are we making?</p>
      <p className="st-welcome-body">Describe a small USB-powered device. You get a routed board, a printable case and compiled firmware, with each step timed as it lands.</p>
      <ul className="st-examples" aria-label="Example briefs">
        {EXAMPLE_BRIEFS.map(example => (
          <li key={example.template}><button type="button" onClick={() => onBrief(example.brief)}><strong>{example.label}</strong><span>{example.brief}</span></button></li>
        ))}
      </ul>
      {recent.length > 0 && (
        <div className="st-recent">
          <h4>Recent builds on this machine</h4>
          <ul>
            {recent.slice(0, 3).map(job => (
              <li key={job.jobId}>
                <button type="button" onClick={() => onOpen(job.jobId)}>
                  <span>{capitalize(templateName(job.template) ?? 'Edited board')}</span>
                  <em>{job.totalMs ? formatDuration(job.totalMs) : job.status}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Composer({ value, setValue, onSubmit, busy, busyText = 'A build is running. Send when it lands.', hasDesign, hasBuild, inputRef }: { value: string; setValue: (v: string) => void; onSubmit: (text: string) => void; busy: boolean; busyText?: string; hasDesign: boolean; hasBuild: boolean; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const agent = useAgentStatus();
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Hidden on a phone's Board view, where it measures 0. Stay on auto until it's shown.
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value, inputRef]);
  const text = value.trim();
  const tooLong = value.length > MAX_BRIEF_LENGTH;
  const can = Boolean(text) && !busy && !tooLong;
  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (can) onSubmit(text);
  }
  return (
    <form className="st-composer" onSubmit={submit}>
      <label className="st-sr" htmlFor="st-input">{hasDesign ? 'Ask for a change' : 'Describe what to build'}</label>
      <textarea
        id="st-input"
        ref={inputRef}
        rows={hasDesign ? 1 : 2}
        value={value}
        placeholder={hasDesign ? 'Ask for a change' : hasBuild ? 'Describe a new build' : 'A focus timer with a knob and a beep'}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <div className="st-composer-foot">
        <AgentPicker status={agent} />
        {(tooLong || busy) && <span className={tooLong ? 'is-over' : undefined}>{tooLong ? `${value.length} of ${MAX_BRIEF_LENGTH} characters` : busyText}</span>}
        <button type="submit" className="st-send" disabled={!can} aria-label={hasDesign ? 'Send the change' : 'Build it'}><ArrowUp size={16} aria-hidden="true" /></button>
      </div>
    </form>
  );
}

export interface ChatProps {
  turns: Turn[];
  busy: boolean;
  canvasJobId: string | null;
  /** The template the session's rules can change. A build opened from history doesn't set one. */
  designTemplate: TemplateId | null;
  recent: RecentJob[];
  onBrief: (text: string, choice?: TemplateId) => void;
  onEditBrief: (text: string) => void;
  onShow: (jobId: string) => void;
  onStep: (jobId: string, tab: TabId) => void;
  onDownload: (job: BoardJob) => void;
  onOpenJob: (id: string) => void;
  onViewBoard: () => void;
}

export function Thread({ turns, busy, canvasJobId, designTemplate, recent, onBrief, onEditBrief, onShow, onStep, onDownload, onOpenJob, onViewBoard }: ChatProps) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const latestRun = [...turns].reverse().find(t => t.kind === 'run')?.id;
  const signature = JSON.stringify(turns.map(t => { const agent = asAgentTurn(t); return agent ? [agent.id, agent.view.items.length, agent.view.working] : (t.kind === 'run' ? [t.id, t.job?.stages?.length, t.job?.status, Object.keys(t.job?.artifacts ?? {}).length] : t.id); }));

  const lastTurnCount = useRef(turns.length);
  if (lastTurnCount.current !== turns.length) { lastTurnCount.current = turns.length; pinned.current = true; }
  // Follow the run while it's going. When it lands, keep the closing message's first line in view.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !pinned.current) return;
    const last = turns.at(-1);
    const landed = last?.kind === 'run' && last.job && !inFlight(last.job);
    const summary = landed ? [...el.querySelectorAll<HTMLElement>('.st-summary')].at(-1) : null;
    el.scrollTop = summary ? el.scrollTop + summary.getBoundingClientRect().top - el.getBoundingClientRect().top - 150 : el.scrollHeight;
  }, [signature]);

  if (!turns.length) return <div className="st-thread" ref={box}><Welcome onBrief={onBrief} recent={recent} onOpen={onOpenJob} /></div>;
  return (
    <div className="st-thread" ref={box} onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {turns.map(turn => {
        const agent = asAgentTurn(turn);
        if (agent) return <AgentTurnCard key={agent.id} turn={agent} canRetry={turn === turns.at(-1)} onBrief={text => onBrief(text)} />;
        switch (turn.kind) {
          case 'brief': return <div key={turn.id} className="st-turn st-brief"><p>{turn.text}</p></div>;
          case 'edit': return <div key={turn.id} className="st-turn st-brief is-edit"><p><PencilLine size={14} aria-hidden="true" />{turn.text}</p></div>;
          case 'reading':
            return (
              <div key={turn.id} className="st-turn st-reading">
                <p className="st-reading-title">{turn.followUp ? 'Changed' : `Reading this as a ${turn.title.toLowerCase()}`}</p>
                <ul>{(turn.followUp ? turn.changes : turn.meanings.filter(m => !m.startsWith('Selects '))).map(m => <li key={m}>{capitalize(m)}</li>)}</ul>
                {turn.notes.map(note => <p key={note} className="st-reading-note">{note}</p>)}
              </div>
            );
          case 'say': return <SayTurn key={turn.id} turn={turn} onEdit={onEditBrief} onChoose={id => onBrief(turn.brief ?? '', id)} />;
          case 'run':
            return <RunTurn key={turn.id} turn={turn} latest={turn.id === latestRun} designTemplate={designTemplate} busy={busy} onCanvas={Boolean(turn.job) && turn.job!.jobId === canvasJobId} onShow={() => turn.job && onShow(turn.job.jobId)} onDownload={onDownload} onFollowUp={text => onBrief(text)} onViewBoard={onViewBoard} onStep={tab => turn.job && onStep(turn.job.jobId, tab)} />;
        }
      })}
    </div>
  );
}

export const NewButton = ({ onClick, label = 'New build' }: { onClick: () => void; label?: string }) => (
  <button type="button" className="st-icon-paper" onClick={onClick} aria-label={label} title={label}><Plus size={16} aria-hidden="true" /></button>
);
