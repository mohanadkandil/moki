import { MessageSquare, PanelsTopLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TemplateId } from '../../../src/circuit/model';
import { currentRevision, EMPTY_SESSION, submitBrief, type LabSession } from '../../../src/circuit/session';
import { boardApi, useBoardRun } from '../board/api';
import { atBase } from '../board/base';
import { jobToDisplay } from '../board/logic';
import type { BoardJob } from '../board/types';
import { storedZip } from './archive';
import { ActivityPill, CanvasBody, DownloadMenu, HistoryMenu, ProofPill, RerunButton, StatusStrip, TABS, type CanvasSelection, type ModelView, type TabId } from './Canvas';
import { Composer, NewButton, Thread, type RecentJob } from './Chat';
import { adoptAgentDesign, agentLeftBuilding, historyOf, settleAgentTurns, useStudioAgent } from './agentChat';
import type { Draft } from './CodeTab';
import { capitalize, cleanNote, cleanRejection, designForRerun, loadSaved, planBrief, readingOf, save, templateName, WORDMARK, type Turn } from './conversation';
import { editOrigin, type BoardEdits } from './editing';
import { activity, inFlight, tabStatus } from './facts';
import { canvasWait } from './canvasWait';
import type { SheetOp } from './schematic/ops';
import type { SchematicContext } from './schematic/SchematicPane';
import type { AgentEvent } from '../../../src/agents/protocol';
import type { CircuitDesign } from '../../../src/circuit/model';
import { createSaver, missingRuns, projectsApi, type ProjectRecord, type SaveResult } from '../landing/projectsApi';
import { navigate } from '../landing/routes';
import './studio.css';
import '../landing/landing.css';

let nextId = 0;
const uid = () => `t${Date.now().toString(36)}-${nextId++}`;

function readParams() {
  const q = new URLSearchParams(window.location.search);
  const tab = q.get('tab');
  return { jobId: q.get('job'), tab: TABS.some(t => t.id === tab) ? (tab as TabId) : null, view: q.get('view') };
}

function writeParams(values: Record<string, string | null>) {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) { if (v === null) q.delete(k); else q.set(k, v); }
  const search = q.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
}

const toRecent = (job: BoardJob & { createdAt?: string }): RecentJob => ({ jobId: job.jobId, status: job.status, template: job.input?.template, totalMs: job.totalMs, kind: job.input?.kind, createdAt: job.createdAt });

async function fetchRecent(): Promise<RecentJob[]> {
  const res = await fetch(atBase('/api/board/jobs'), { cache: 'no-store' });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('No board service');
  return ((await res.json()) as (BoardJob & { createdAt?: string })[]).map(toRecent);
}

/** The name in the top bar. Press it to rename the project. */
function ProjectTitle({ title, onRename }: { title: string; onRename: (next: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  if (!editing) return <button type="button" className="st-title-button" title={error ?? 'Rename this project'} aria-label={`Project: ${title}. Rename`} onClick={() => { done.current = false; setValue(title); setError(null); setEditing(true); }}>{title}</button>;
  const finish = async (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    setEditing(false);
    if (keep && next && next !== title) setError(await onRename(next));
  };
  return (
    <input
      className="st-title-input"
      aria-label="Project name"
      autoFocus
      maxLength={80}
      value={value}
      onFocus={e => e.currentTarget.select()}
      onChange={e => setValue(e.target.value)}
      onBlur={() => void finish(true)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void finish(true); } if (e.key === 'Escape') { e.preventDefault(); void finish(false); } }}
    />
  );
}

export default function Studio({ project }: { project?: ProjectRecord }) {
  const isMock = boardApi().isMock;
  const [saved] = useState(() => (project ? project.state : isMock ? null : loadSaved()));
  const [params] = useState(readParams);
  const [turns, setTurns] = useState<Turn[]>(() => {
    const restored = settleAgentTurns(saved?.turns ?? []);
    if (!project) return restored;
    const notice: Turn[] = agentLeftBuilding(restored) ? [{ id: uid(), kind: 'say', tone: 'unchanged', title: 'The agent stopped when this page closed.', lines: ['This build keeps going, but nothing will fix it if it fails, and any requirements won’t get their final check. Send a message to carry on.'] }] : [];
    return [...restored, ...missingRuns(restored, project.jobs), ...notice];
  });
  const [title, setTitle] = useState(project?.title ?? null);
  const [saveState, setSaveState] = useState<SaveResult>('saved');
  const [session, setSession] = useState<LabSession>(saved?.session ?? EMPTY_SESSION);
  const [selection, setSelection] = useState<CanvasSelection>({ part: null, net: null });
  const [redo, setRedo] = useState<readonly string[]>([]);
  const [reviewingEdit, setReviewingEdit] = useState(false);
  const [partial, setPartial] = useState<Extract<AgentEvent, { type: 'plan.partial' }> | null>(null);
  const [pinned, setPinned] = useState<string | null>(params.jobId ?? saved?.canvasJobId ?? null);
  const [tab, setTabState] = useState<TabId>(params.tab ?? 'schematic');
  const [modelView, setModelViewState] = useState<ModelView>(params.view === 'exploded' || params.view === 'case' ? params.view : 'board');
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<Draft>({ text: '', base: null, jobId: null });
  const [recent, setRecent] = useState<RecentJob[] | null>(null);
  const [zipping, setZipping] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'canvas'>(params.jobId ? 'canvas' : 'chat');
  const run = useBoardRun();
  const activeTurn = useRef<string | null>(null);
  const tabTouched = useRef(Boolean(params.tab));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const booted = useRef(false);

  const patchRun = useCallback((id: string, patch: Partial<Extract<Turn, { kind: 'run' }>>) => {
    setTurns(list => list.map(t => (t.id === id && t.kind === 'run' ? { ...t, ...patch } : t)));
  }, []);

  useEffect(() => {
    const id = activeTurn.current;
    if (!id || !run.job) return;
    const job = run.job;
    setTurns(list => list.map(t => {
      if (t.id !== id || t.kind !== 'run') return t;
      // Job time excludes the queue. If the wait was real, the chat says so rather than hiding it.
      const landed = !inFlight(job) && t.waitedMs == null && t.startedAt != null && job.totalMs;
      return { ...t, job, ...(landed ? { waitedMs: Date.now() - t.startedAt! - job.totalMs! } : {}) };
    }));
  }, [run.job]);
  useEffect(() => {
    const id = activeTurn.current;
    if (id && run.phase === 'lost') patchRun(id, { lost: run.serviceError });
  }, [run.phase, run.serviceError, patchRun]);

  const runTurns = useMemo(() => turns.filter((t): t is Extract<Turn, { kind: 'run' }> => t.kind === 'run'), [turns]);
  const latest = runTurns.at(-1)?.job ?? null;
  const previousDone = useMemo(() => [...runTurns].slice(0, -1).reverse().find(t => t.job?.status === 'done')?.job ?? null, [runTurns]);
  const finished = run.job?.status === 'done' || run.job?.status === 'failed';
  const busy = run.phase === 'posting' || (run.phase === 'polling' && !finished);
  const pinnedJob = pinned ? runTurns.find(t => t.job?.jobId === pinned)?.job ?? null : null;
  const shown = pinnedJob ?? jobToDisplay(latest, previousDone);
  const revision = currentRevision(session);

  useEffect(() => {
    // In a project, ?job= only marks a build the maker picked. Otherwise a reload mid-build would pin the previous one.
    writeParams({ job: project ? pinned : shown?.jobId ?? null, tab: shown ? tab : null });
  }, [shown?.jobId, tab]);

  const saver = useRef(project ? createSaver(project.id, project.stateRev ?? 0, result => setSaveState(result)) : null);
  const hadTurns = useRef(turns.length > 0);
  useEffect(() => {
    if (saver.current) {
      if (!turns.length) return;
      // The first turn saves at once, so a reload straight after submitting can't start the project twice.
      saver.current.queue({ turns, session, canvasJobId: pinned }, { now: !hadTurns.current });
      hadTurns.current = true;
      return;
    }
    if (isMock) return;
    save(turns.length ? { turns, session, canvasJobId: pinned } : null);
  }, [turns, session, pinned, isMock]);
  useEffect(() => {
    const current = saver.current;
    if (!current) return;
    const leave = () => current.leave();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); current.flush(); };
  }, []);
  useEffect(() => { if (title) document.title = `${title} · ${WORDMARK}`; }, [title]);

  useEffect(() => {
    if (!turns.length) fetchRecent().then(setRecent, () => setRecent([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The canvas follows the build as outputs land, until the person picks a tab themselves.
  const artifactNames = Object.keys(latest?.artifacts ?? {}).join('|');
  useEffect(() => {
    if (tabTouched.current || !latest || pinned) return;
    const a = latest.artifacts ?? {};
    // It stays on the schematic: that's what was growing while the agent worked, and the build lands on the same sheet.
    if (a['schematic.svg']) setTabState('schematic');
  }, [artifactNames, latest?.jobId, pinned]);

  const addRun = useCallback((label: string | null, job: BoardJob | null = null) => {
    const id = uid();
    activeTurn.current = id;
    setPinned(null);
    tabTouched.current = false;
    return { id, kind: 'run' as const, label, job, startedAt: Date.now(), waitedMs: null };
  }, []);

  const openJob = useCallback(async (jobId: string) => {
    const existing = turns.find(t => t.kind === 'run' && t.job?.jobId === jobId);
    if (existing) { setPinned(jobId); tabTouched.current = true; return; }
    const turn = addRun('Opened from history');
    setTurns(list => [...list, turn]);
    setPinned(jobId);
    tabTouched.current = true;
    run.follow(jobId);
    setMobileView('canvas');
  }, [turns, addRun, run]);

  // First load: a ?job= link opens that build, and an unfinished saved build is picked up again.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (params.jobId) {
      const known = saved?.turns.some(t => t.kind === 'run' && t.job?.jobId === params.jobId);
      if (!known) void openJob(params.jobId);
    }
    const unfinished = [...(saved?.turns ?? [])].reverse().find(t => t.kind === 'run' && inFlight(t.job)) as Extract<Turn, { kind: 'run' }> | undefined;
    // A saved record can be out of date: the job kept running after the page closed. Only the newest is followed, so ask about the rest.
    const stale = turns.filter((t): t is Extract<Turn, { kind: 'run' }> => t.kind === 'run' && t.id !== unfinished?.id && (inFlight(t.job) || (!t.job && Boolean((t as { jobId?: string }).jobId))));
    for (const turn of stale) {
      const jobId = turn.job?.jobId ?? (turn as { jobId?: string }).jobId!;
      void boardApi().get(jobId).then(job => patchRun(turn.id, { job }), () => patchRun(turn.id, { lost: 'This build’s record couldn’t be read.' }));
    }
    if (unfinished?.job) { activeTurn.current = unfinished.id; run.follow(unfinished.job.jobId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agent = useStudioAgent({
    initialTurns: saved?.turns ?? [],
    context: () => {
      const edits = (shown?.input as { edits?: BoardEdits } | undefined)?.edits;
      return {
        ...(project ? { projectId: project.id } : {}),
        ...(revision ? { design: revision.design, brief: revision.brief } : {}),
        ...(shown ? { jobId: shown.jobId } : {}),
        ...(edits ? { edits } : {}),
        history: historyOf(turns),
      };
    },
    upsert: turn => setTurns(list => (list.some(t => t.id === turn.id) ? list.map(t => (t.id === turn.id ? turn : t)) : [...list, turn])),
    onJob: (jobId, label) => {
      const running = addRun(label);
      setTurns(list => [...list, running]);
      run.follow(jobId);
      return running.id;
    },
    onJobSettled: (id, job) => patchRun(id, { job }),
    onDesign: (design, brief) => setSession(s => adoptAgentDesign(s, brief, design)),
    onPartial: setPartial,
    // Must not go back through submit(), which would send it to the agent again, forever.
    onFallback: text => submitByRules(text),
  });

  // A new project starts its turn here, once we know whether an agent is available. Its saved chat means it already has.
  const started = useRef(!project || Boolean(saved?.turns.length) || turns.length > 0);
  useEffect(() => {
    if (started.current || !agent.status) return;
    started.current = true;
    submit(project!.brief);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.status]);

  function submit(text: string, choice?: TemplateId) {
    if (busy || agent.running) return;
    // A `choice` means the maker pressed a rules template button, so it stays with the rules.
    // Checks waiting on a card belong to the agent, even if its status couldn't be read just now.
    if ((agent.active || agent.hasWaitingChecks()) && !choice) { setInput(''); setRecent(null); void agent.send(text); return; }
    submitByRules(text, choice);
  }

  function submitByRules(text: string, choice?: TemplateId) {
    const plan = choice ? { brief: text, choice } : planBrief(session, text);
    const step = submitBrief(session, plan.brief, plan.choice);
    const fromCode = latest?.input?.kind === 'source';
    const brief: Turn = { id: uid(), kind: 'brief', text: choice ? `Build the ${templateName(choice)}` : text };
    setInput('');
    switch (step.outcome.kind) {
      case 'created': {
        // The rules can't check requirements. They stay on the design, so the project can't read as done without them.
        const kept = revision?.design.requirements;
        const rev = kept?.length ? { ...step.outcome.revision, design: { ...step.outcome.revision.design, requirements: kept } } : step.outcome.revision;
        setSession(kept?.length ? { ...step.session, revisions: step.session.revisions.map(r => (r.number === rev.number ? rev : r)) } : step.session);
        const notes = rev.interpretation.notes.map(cleanNote);
        if (fromCode) notes.push('This rebuilds from the brief, so the TSX edits from the last build aren’t carried over.');
        const followUp = rev.number > 1 && rev.changes.length > 0 && rev.design.template === revision?.design.template;
        const reading: Turn = { id: uid(), kind: 'reading', title: rev.design.title, meanings: readingOf(rev.interpretation), changes: rev.changes.map(c => c.text), notes, followUp };
        const running = addRun(null);
        setTurns(list => [...list, brief, reading, running]);
        run.start({ design: rev.design });
        setRecent(null);
        return;
      }
      case 'unchanged': {
        const notes = step.outcome.revision.interpretation.notes.map(cleanNote);
        setTurns(list => [...list, brief, {
          id: uid(), kind: 'say', tone: 'unchanged',
          title: 'That didn’t change the design, so nothing was rebuilt.',
          lines: [...notes, 'A follow-up adds to your earlier brief. To take a part out, edit the brief and send it again.'],
          canEdit: true, brief: revision?.brief,
        }]);
        return;
      }
      default: {
        setSession({ ...session, rejected: step.session.rejected });
        const { kind, rejection } = step.outcome;
        const { title, lines } = cleanRejection(rejection);
        setTurns(list => [...list, brief, {
          id: uid(), kind: 'say', tone: kind === 'internal-error' ? 'error' : 'refuse', title, lines,
          candidates: rejection.candidates,
          canEdit: true, brief: plan.brief,
        }]);
      }
    }
  }

  function editBrief(text: string) {
    setInput(text);
    // Replacing the whole brief: a fresh session, so it isn't read as a follow-up to itself.
    setSession(EMPTY_SESSION);
    inputRef.current?.focus();
  }

  async function rerun() {
    if (busy || !shown) return;
    // A fresh design or source would lay the board out again and lose the maker's moves. The server recovers an edited job from its id.
    if (editOrigin(shown as never)) {
      const running = addRun('Re-ran the same layout');
      setTurns(list => [...list, running]);
      run.start({ baseJobId: shown.jobId } as never);
      return;
    }
    const design = designForRerun(shown, session);
    if (design) {
      const running = addRun('Re-ran the same design');
      setTurns(list => [...list, running]);
      run.start({ design });
      return;
    }
    const artifact = shown.artifacts?.['board.tsx'];
    if (!artifact) return;
    let source: string;
    try {
      const res = await fetch(artifact.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`board.tsx: HTTP ${res.status}`);
      source = await res.text();
    } catch (err) {
      setTurns(list => [...list, { id: uid(), kind: 'say', tone: 'error', title: 'The re-run didn’t start.', lines: [err instanceof Error ? err.message : String(err)] }]);
      return;
    }
    const running = addRun('Re-ran the same source. Firmware needs the design, so it’s skipped.');
    setTurns(list => [...list, running]);
    run.start({ source, baseJobId: shown.jobId });
  }

  /** Rejections come back as a reason on the canvas, before any job or chat turn exists. */
  async function submitEdits(edits: BoardEdits, lines: readonly string[]): Promise<string | null> {
    if (busy || !shown) return 'A build is running. Rebuild when it lands.';
    try {
      const { jobId } = await boardApi().create({ baseJobId: shown.jobId, edits } as never);
      const running = addRun(`Edited from ${shown.jobId.slice(0, 8)}: ${lines.join(', ')}.`);
      tabTouched.current = true;
      setRedo([]);
      setTurns(list => [...list, running]);
      run.follow(jobId);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  useEffect(() => { if (!agent.running) setReviewingEdit(false); }, [agent.running]);

  /** A schematic edit is a list of operations on a base job. The server applies and validates them, and a refusal comes back here with no job or chat turn. */
  async function submitOps(ops: readonly SheetOp[], lines: readonly string[], next: CircuitDesign | null): Promise<string | null> {
    if (busy || agent.running || !shown) return 'A build is running. Apply when it lands.';
    // A chip edit changes a reviewed plan, so it can't go straight to a build. The agent reviews it, then builds it.
    if (!next) {
      if (!agent.active) return 'Chip edits need the agent to review them, and it isn’t available on this server.';
      setReviewingEdit(true);
      void agent.send('Apply my edit', { mode: 'chip', jobId: shown.jobId, ops: [...ops] });
      return null;
    }
    try {
      const { jobId } = await boardApi().create({ baseJobId: shown.jobId, ops } as never);
      const running = addRun(`Schematic edit: ${lines.join(', ')}.`);
      tabTouched.current = true;
      if (next) setSession(s => adoptAgentDesign(s, revision?.brief ?? next.title, next));
      setTurns(list => [...list, running]);
      run.follow(jobId);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  // Each edit is a job, so going back and forward is moving through jobs.
  const baseOfShown = shown ? editOrigin(shown as never)?.baseJobId ?? null : null;
  const editControls = {
    submit: submitEdits,
    canEdit: !busy && !agent.running && shown?.status === 'done' && !isMock,
    onOpenJob: (id: string) => void openJob(id),
    onUndo: baseOfShown && !busy ? () => { setRedo(r => [...r, shown!.jobId]); void openJob(baseOfShown); } : undefined,
    onRedo: redo.length && !busy ? () => { setRedo(r => r.slice(0, -1)); void openJob(redo.at(-1)!); } : undefined,
  };

  const buildStep = busy ? activity(run.job ?? latest, run.phase === 'posting') : null;
  const schematic: SchematicContext = {
    partial,
    design: revision?.design ?? null,
    who: agent.running ? 'Agent editing' : busy ? 'Building' : null,
    step: partial?.step ?? buildStep ?? (agent.running ? (reviewingEdit ? 'Checking your edit against the datasheets' : 'Designing…') : null),
    empty: canvasWait({ agentRunning: agent.running, building: busy, projectStarting: Boolean(project) && !turns.length, waitingOnMaker: agent.hasWaitingChecks(), hasTurns: turns.length > 0 }),
    submit: submitOps,
    blocked: isMock ? 'Editing needs the board service. This page is showing mock data.'
      : agent.running ? 'The agent is working on this design.'
      : busy || (inFlight(shown) && run.phase !== 'lost') ? 'A build is running. Edit when it lands.'
      : !shown ? 'There’s no build to edit yet.'
      : null,
  };

  function renderDraft() {
    if (busy || draft.base === null || draft.text === draft.base) return;
    const before = draft.base.split('\n');
    const after = draft.text.split('\n');
    const removed = before.filter(l => !after.includes(l)).length;
    const added = after.filter(l => !before.includes(l)).length;
    const jobId = draft.jobId;
    const running = addRun(null);
    tabTouched.current = true;
    setTurns(list => [...list, { id: uid(), kind: 'edit', text: `Edited board.tsx (+${added} −${removed} lines)` }, running]);
    run.start({ source: draft.text, baseJobId: jobId ?? undefined });
  }

  async function downloadAll(job: BoardJob) {
    setZipping(true);
    try {
      const entries = Object.entries(job.artifacts ?? {});
      const files = await Promise.all(entries.map(async ([name, a]) => {
        const res = await fetch(a.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        return { name, data: new Uint8Array(await res.arrayBuffer()) };
      }));
      const bytes = storedZip(files);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${WORDMARK.toLowerCase()}-${job.input?.template ?? 'board'}-${job.jobId.slice(0, 8)}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setTurns(list => [...list, { id: uid(), kind: 'say', tone: 'error', title: 'The download didn’t finish.', lines: [err instanceof Error ? err.message : String(err)] }]);
    } finally { setZipping(false); }
  }

  function reset() {
    if (project) { navigate(atBase('/')); return; }
    agent.stop();
    setSelection({ part: null, net: null });
    setRedo([]);
    activeTurn.current = null;
    setTurns([]); setSession(EMPTY_SESSION); setPinned(null); setInput(''); setDraft({ text: '', base: null, jobId: null });
    tabTouched.current = false; setTabState('schematic'); setModelViewState('board'); setMobileView('chat');
    writeParams({ job: null, tab: null, view: null });
    fetchRecent().then(setRecent, () => setRecent([]));
    inputRef.current?.focus();
  }

  function selectTab(next: TabId, focus = false) {
    tabTouched.current = true;
    setTabState(next);
    if (focus) document.getElementById(`st-tab-${next}`)?.focus();
    document.getElementById(`st-tab-${next}`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  function onTabKey(e: KeyboardEvent, id: TabId) {
    const ids = TABS.map(t => t.id);
    const i = ids.indexOf(id);
    let next: TabId | undefined;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (next) { e.preventDefault(); selectTab(next, true); }
  }

  const projectName = title ?? revision?.design.title ?? (shown?.input?.kind === 'source' ? 'Edited board' : capitalize(templateName(shown?.input?.template) ?? '')) ?? '';
  const templateLabel = shown?.input?.template
    ? `${capitalize(templateName(shown.input.template)!)} template${revision && revision.number > 1 ? `, revision ${revision.number}` : ''}`
    : shown?.input?.kind === 'source' ? 'Edited TSX' : null;
  const startedAt = busy ? run.startedAt : null;
  const followed = run.job && activeTurn.current ? run.job : latest;
  const allRecent = recent ?? [];
  // A project's history is its own builds, not every build on the machine.
  const projectJobs = new Set([...runTurns.flatMap(t => (t.job ? [t.job.jobId] : [])), ...(project?.jobs.map(j => j.jobId) ?? [])]);
  // A lost run stops updating, so it can't go on claiming outputs are on their way.
  const live = inFlight(shown) && run.phase !== 'lost';
  const mobileSwitch = (
    <div className="st-switch" role="group" aria-label="Show">
      <button type="button" aria-pressed={mobileView === 'chat'} onClick={() => setMobileView('chat')}><MessageSquare size={14} aria-hidden="true" />Chat</button>
      <button type="button" aria-pressed={mobileView === 'canvas'} onClick={() => setMobileView('canvas')}><PanelsTopLeft size={14} aria-hidden="true" />Board</button>
    </div>
  );

  return (
    <div className={`st${projectName ? ' has-project' : ''}`} data-view={mobileView} data-tab={tab}>
      <section className="st-chat" aria-label="Chat">
        <header className="st-chat-head">
          <a className="st-wordmark" href={atBase('/')} aria-label={`${WORDMARK} home`}>{WORDMARK}</a>
          {project && title
            ? <div className="st-project st-project-title"><ProjectTitle title={title} onRename={async next => {
              const before = title;
              setTitle(next);
              try { setTitle((await projectsApi.rename(project.id, next)).title); return null; }
              catch (err) { setTitle(before); return err instanceof Error ? err.message : 'The name wasn’t saved.'; }
            }} />{templateLabel && <em>{templateLabel}</em>}</div>
            : projectName && <span className="st-project" title={templateLabel ?? undefined}><span>{projectName}</span>{templateLabel && <em>{templateLabel}</em>}</span>}
          <span className="st-head-grow" />
          {turns.length > 0 && <NewButton onClick={reset} {...(project ? { label: 'New project' } : {})} />}
          {mobileSwitch}
        </header>
        {saveState === 'retrying' && <p className="st-save-note" role="status">Can’t reach the server right now. Your chat is still here, and it saves as soon as the server is back.</p>}
        {saveState === 'failed' && <p className="st-save-note" role="status">This project isn’t saving right now. Your chat is still here, but leaving could lose the latest of it.</p>}
        {saveState === 'conflict' && <p className="st-save-note" role="status">This project changed in another tab, so this one has stopped saving. <a href={window.location.href}>Reload to see the latest.</a></p>}
        {isMock && <p className="st-mock" role="note">Mock data. Nothing here was rendered by the pipeline, and these timings aren’t measurements.</p>}
        <Thread
          // A project's brief is its first message from the start, before the first turn has begun.
          turns={project && !turns.length ? [{ id: 'brief', kind: 'brief', text: project.brief }] : turns}
          busy={busy}
          canvasJobId={shown?.jobId ?? null}
          designTemplate={revision?.design.template ?? null}
          recent={allRecent}
          onBrief={submit}
          onEditBrief={editBrief}
          onShow={id => { setPinned(id); tabTouched.current = true; }}
          onDownload={job => void downloadAll(job)}
          onOpenJob={id => void openJob(id)}
          onViewBoard={() => setMobileView('canvas')}
          onStep={(id, next) => { if (id !== shown?.jobId) setPinned(id); selectTab(next); }}
        />
        <Composer value={input} setValue={setInput} onSubmit={submit} busy={busy || agent.running} {...(!busy && agent.running ? { busyText: 'The agent is working. Send when it’s done.' } : {})} hasDesign={Boolean(revision)} hasBuild={Boolean(shown)} inputRef={inputRef} />
      </section>
      <section className="st-work" aria-label="Canvas">
        {(busy || live) && <div className="st-work-progress" aria-hidden="true" />}
        <header className="st-bar">
          <div className="st-mobile-only st-bar-mobile-head"><span className="st-wordmark is-dark">{projectName || WORDMARK}</span>{mobileSwitch}</div>
          <div className="st-tabs" role="tablist" aria-label="Build outputs">
            {TABS.map(t => {
              const status = tabStatus(shown, t, live);
              return (
                <button key={t.id} id={`st-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="st-canvas" tabIndex={tab === t.id ? 0 : -1} data-status={status ?? undefined} title={status === 'failed' ? 'This stage failed. The error is in the chat.' : undefined} onClick={() => selectTab(t.id)} onKeyDown={e => onTabKey(e, t.id)}>
                  <span className="st-tab-label">{t.label}</span>
                  {status === 'waiting' && <span className="st-sr">, still building</span>}
                  {status === 'failed' && <span className="st-sr">, failed</span>}
                </button>
              );
            })}
          </div>
          <div className="st-bar-right">
            <ProofPill job={shown} />
            <HistoryMenu recent={project && recent ? recent.filter(r => projectJobs.has(r.jobId)) : recent} loadRecent={() => { setRecent(null); fetchRecent().then(setRecent, () => setRecent([])); }} onOpen={id => void openJob(id)} currentId={shown?.jobId ?? null} />
            <RerunButton onClick={() => void rerun()} disabled={busy || !shown} busy={busy} />
            <DownloadMenu job={shown} onAll={job => void downloadAll(job)} working={zipping} />
          </div>
        </header>
        <div id="st-canvas" className={`st-canvas is-${tab}`} role="tabpanel" aria-labelledby={`st-tab-${tab}`}>
          <CanvasBody
            selection={selection}
            setSelection={setSelection}
            edit={editControls}
            schematic={schematic}
            job={shown}
            tab={tab}
            view={modelView}
            setView={setModelViewState}
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onRender={renderDraft}
          />
          {tab !== 'schematic' && <ActivityPill job={busy ? followed : null} posting={run.phase === 'posting'} startedAt={startedAt} />}
        </div>
        {/* The schematic keeps its own foot: cursor, grid, zoom and selection. */}
        {tab !== 'schematic' && <StatusStrip job={busy ? followed : shown} running={{ startedAt }} />}
      </section>
    </div>
  );
}
