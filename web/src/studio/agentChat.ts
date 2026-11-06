// The browser side of the agent chat: is it on, read its event stream, fold events into chat turns.
// With agents off, nothing here changes what the studio does: the rule interpreter reads the brief.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentEvent, AgentRole, AgentStatus, BoardEdits, ChatLine, EffortId, Requirement, RequirementResult, TurnRequest, UsageTotals } from '../../../src/agents/protocol';
import { cleanBrief } from '../../../src/agents/brief-text';
import { contentId, diffDesigns, fingerprint, settingsChanges } from '../../../src/circuit/graph';
import type { CircuitDesign } from '../../../src/circuit/model';
import { currentRevision, type LabSession, type Revision } from '../../../src/circuit/session';
import { boardApi } from '../board/api';
import { atBase } from '../board/base';
import type { BoardJob } from '../board/types';
import { demoEvents, isAgentDemo } from './agentDemo';

export type AgentItem =
  | { kind: 'tool'; role: AgentRole; name: string; ms: number; /** The model call that led to it, on the first tool of that call. */ callMs?: number; ok: boolean; summary: string; tokens: number | null; costUsd: number | null; estimated: boolean }
  | { kind: 'message'; role: AgentRole; text: string }
  | { kind: 'changes'; lines: string[] }
  | { kind: 'decline'; message: string; closest: string | null; closestBrief: string | null }
  | { kind: 'note'; text: string }
  | { kind: 'requirements'; requirements: Requirement[]; notCheckable: string[]; message: string; settled: 'open' | 'confirmed' | 'replaced'; brief?: string; existing?: boolean; mode?: 'chip'; noMcu?: boolean }
  | { kind: 'verify'; ok: boolean; results: (RequirementResult & { plain: string })[] }
  | { kind: 'error'; text: string; /** The stream was cut, not refused. What Try again sends, when the turn itself has no brief. */ interrupted?: { retry: string | null } };

export interface AgentView {
  brief: string | null;
  role: AgentRole;
  model: string | null;
  items: AgentItem[];
  working: boolean;
  usage: UsageTotals | null;
}
export interface AgentTurn { id: string; kind: 'agent'; view: AgentView }
export const isAgentTurn = (turn: unknown): turn is AgentTurn => (turn as { kind?: unknown } | null)?.kind === 'agent';
export const asAgentTurn = (turn: unknown): AgentTurn | null => (isAgentTurn(turn) ? turn : null);
/** One sentence for a turn the connection took away. The turn can't say why it stopped, only that it did. */
export const interruptedText = (hadBuild = false) => (hadBuild ? 'This turn was interrupted before it finished, though a build already queued keeps going.' : 'This turn was interrupted before it finished.');

/**
 * A saved chat comes back without its stream, so a turn that was still working has stopped: the server restarted, or
 * stopped spending when nobody was reading. Confirming checks is what it was doing, so they're open again and Try again
 * confirms them, instead of sending "Looks right" as a new brief.
 */
export function settleAgentTurns<T>(turns: T[]): T[] {
  const settled = [...turns];
  for (let i = 0; i < settled.length; i++) {
    const turn = asAgentTurn(settled[i]);
    if (!turn?.view.working) continue;
    let retry = turn.view.brief;
    for (let j = i - 1; retry === null && j >= 0; j--) retry = asAgentTurn(settled[j])?.view.brief ?? null;
    if (retry !== null && isConfirmation(retry)) {
      for (let j = i - 1; j >= 0; j--) {
        const earlier = asAgentTurn(settled[j]);
        if (!earlier?.view.items.some(item => item.kind === 'requirements' && item.settled === 'confirmed')) continue;
        settled[j] = { ...earlier, view: { ...earlier.view, items: earlier.view.items.map(item => (item.kind === 'requirements' && item.settled === 'confirmed' ? { ...item, settled: 'open' as const } : item)) } } as T;
        break;
      }
    }
    settled[i] = { ...turn, view: { ...turn.view, working: false, items: [...turn.view.items, { kind: 'error', text: interruptedText(), interrupted: { retry } }] } } as T;
  }
  return settled;
}

const OFF: AgentStatus = { enabled: false, provider: null, model: null, capUsd: 2, reason: 'The agent service is not answering.' };
let cachedStatus: Promise<AgentStatus> | null = null;

export function fetchAgentStatus(): Promise<AgentStatus> {
  if (isAgentDemo()) return Promise.resolve({ enabled: true, provider: 'replay', model: 'gpt-6.1-sol', capUsd: 2, reason: null, efforts: [
    { id: 'fast', label: 'Fast', use: 'Simple boards and quick changes', model: 'gpt-6.1-sol', reasoning: 'low', capUsd: 0.5, avgCostUsd: null, builds: 0 },
    { id: 'balanced', label: 'Balanced', use: 'Most boards', model: 'gpt-6.1-sol', reasoning: 'medium', capUsd: 2, avgCostUsd: 0.03, builds: 4 },
    { id: 'deep', label: 'Deep', use: 'Tricky circuits, more thinking', model: 'gpt-6.1-sol', reasoning: 'high', capUsd: 2, avgCostUsd: null, builds: 0 },
  ] });
  // Mock boards have no server behind them. Unknown paths answer with the app's HTML, so check the type.
  if (boardApi().isMock) return Promise.resolve(OFF);
  // A failed look isn't remembered: "off" for the rest of this page would send a brief to the rules by mistake.
  const asked = fetch(atBase('/api/agent/status'), { cache: 'no-store' })
    .then(async res => (res.ok && (res.headers.get('content-type') ?? '').includes('json') ? await res.json() as AgentStatus : Promise.reject(new Error('No agent service'))));
  cachedStatus ??= asked.catch(() => { cachedStatus = null; return OFF; });
  return cachedStatus;
}

export function useAgentStatus(): AgentStatus | null {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  useEffect(() => {
    let live = true;
    void fetchAgentStatus().then(value => { if (live) setStatus(value); });
    return () => { live = false; };
  }, []);
  return status;
}

const EFFORT_KEY = 'moki.agent.effort';
const EFFORTS: readonly EffortId[] = ['fast', 'balanced', 'deep'];
let effort: EffortId = 'balanced';
try { const saved = globalThis.localStorage?.getItem(EFFORT_KEY) as EffortId | null; if (saved && EFFORTS.includes(saved)) effort = saved; } catch { /* Blocked storage only costs the remembered choice. */ }
const effortListeners = new Set<() => void>();

export function setEffort(next: EffortId) {
  effort = next;
  try { globalThis.localStorage?.setItem(EFFORT_KEY, next); } catch { /* As above. */ }
  for (const listen of effortListeners) listen();
}
export const currentEffort = () => effort;
export function useEffort(): [EffortId, (next: EffortId) => void] {
  const value = useSyncExternalStore(listen => { effortListeners.add(listen); return () => effortListeners.delete(listen); }, currentEffort, currentEffort);
  return [value, setEffort];
}

export function agentLine(status: AgentStatus | null): string {
  if (!status) return 'Read by rules, not an AI model';
  if (!status.enabled) return 'Agent: off. Read by rules, not an AI model';
  return `Agent: ${status.model}, up to $${status.capUsd.toFixed(0)} a build`;
}

/** Splits a server-sent event stream. Whatever isn't a complete event yet comes back as `rest`. */
export function parseSse(buffer: string): { events: AgentEvent[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: AgentEvent[] = [];
  for (const block of blocks) {
    const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
    if (!data) continue;
    try { events.push(JSON.parse(data) as AgentEvent); } catch { /* A broken event is dropped; `done` decides how the turn ends. */ }
  }
  return { events, rest };
}

/** Folds one event into the open chat turn. Pure, so the chat's record can be tested without a server. */
export function foldEvent(view: AgentView, event: AgentEvent, shared: { left: number; callMs?: number }): AgentView {
  const add = (item: AgentItem): AgentView => ({ ...view, items: [...view.items, item] });
  switch (event.type) {
    case 'start': return { ...view, role: event.role, model: event.model };
    case 'role': return { ...view, role: event.role };
    case 'call': shared.callMs = event.ms; return view;
    case 'message': return add({ kind: 'message', role: event.role, text: event.text });
    case 'tool': {
      // One model call can ask for several tools. Its tokens are shown once, on the first.
      const first = shared.left === 0;
      shared.left = first ? event.sharedWith : shared.left - 1;
      // The call's time goes on the first tool after it, whatever the token split above did.
      const callMs = shared.callMs;
      shared.callMs = undefined;
      return add({ kind: 'tool', role: event.role, name: event.name, ms: event.ms, ...(callMs !== undefined ? { callMs } : {}), ok: event.ok, summary: event.summary, tokens: first ? event.tokens : null, costUsd: first ? event.costUsd : null, estimated: event.estimated });
    }
    case 'design': return event.changes.length ? add({ kind: 'changes', lines: event.changes }) : view;
    case 'edit': return event.changes.length ? add({ kind: 'changes', lines: event.changes }) : view;
    case 'requirements': return add({ kind: 'requirements', requirements: event.requirements, notCheckable: event.notCheckable, message: event.message, settled: 'open', brief: event.brief, existing: event.existing, ...(event.mode ? { mode: event.mode } : {}), ...(event.noMcu ? { noMcu: true } : {}) });
    // The gate runs again as facts arrive, so one card keeps the latest answer.
    case 'verify': return { ...view, items: [...view.items.filter(i => i.kind !== 'verify'), { kind: 'verify', ok: event.ok, results: event.results }] };
    case 'decline': return add({ kind: 'decline', message: event.message, closest: event.closest, closestBrief: event.closestBrief });
    case 'fallback': return { ...view, brief: null, items: [{ kind: 'note', text: `${event.reason} Reading this by rules instead.` }] };
    // The first error is what happened. Anything after it is only that same failure again.
    case 'error': return view.items.some(item => item.kind === 'error') ? view : add({ kind: 'error', text: event.message });
    case 'done': return { ...view, working: false, usage: event.usage };
    default: return view;
  }
}

/** What a chat turn sends for context: the words only, newest last. */
export function historyOf(turns: readonly unknown[]): ChatLine[] {
  const lines: ChatLine[] = [];
  for (const turn of turns) {
    const t = turn as { kind?: string; text?: string; view?: AgentView };
    if (t.kind === 'brief' && t.text) lines.push({ role: 'user', text: t.text });
    if (isAgentTurn(turn)) {
      if (turn.view.brief) lines.push({ role: 'user', text: turn.view.brief });
      for (const item of turn.view.items) if (item.kind === 'message') lines.push({ role: 'agent', text: item.text });
    }
  }
  return lines.slice(-6);
}

/** Records an agent's design as a revision, so the canvas, re-run and diffs treat it like any other. */
export function adoptAgentDesign(session: LabSession, brief: string, design: CircuitDesign): LabSession {
  const previous = currentRevision(session);
  const id = contentId(design);
  if (previous?.contentId === id) return session;
  const revision: Revision = {
    number: (previous?.number ?? 0) + 1, brief, design, fingerprint: fingerprint(design), contentId: id,
    // An agent read this brief, so the rule interpreter recognized nothing in it.
    interpretation: { template: design.template, chosenBy: 'brief', options: { buzzer: false, display: false, sensor: 'ds18b20', pins: {} }, recognized: [], notes: [] },
    changes: previous ? [...(previous.fingerprint === fingerprint(design) ? [] : diffDesigns(previous.design, design)), ...(previous.design.template === design.template ? settingsChanges(previous.design, design) : [])] : [],
  };
  return { revisions: [...session.revisions, revision], rejected: null };
}

export interface StudioAgentOptions {
  context(): Omit<TurnRequest, 'message'>;
  /** Adds the turn, or replaces the one with the same id. */
  upsert(turn: AgentTurn): void;
  /** Starts following a job in a new run turn. Returns that turn's id. */
  onJob(jobId: string, label: string): string;
  onJobSettled(runTurnId: string, job: BoardJob): void;
  onDesign(design: CircuitDesign, brief: string): void;
  onFallback(text: string): void;
  /** The chat this page opened with. */
  initialTurns?: readonly unknown[];
  /** The design so far, while an agent works. Null when the turn ends. */
  onPartial?(event: Extract<AgentEvent, { type: 'plan.partial' }> | null): void;
}

type ToolItem = Extract<AgentItem, { kind: 'tool' }>;

/** What each tool is doing, for the one line a person watches. Several in a row are counted. */
const DOING: Record<string, (n: number) => string> = {
  list_catalog: () => 'reading the catalog', get_module: n => (n > 1 ? `reading ${n} modules` : 'reading a module'), validate_design: () => 'checking the design', propose_design: () => 'laying out the design',
  decline: () => 'writing back', get_design: () => 'reading the design', read_job: () => 'reading the build', propose_edit: () => 'making the change', start_new: () => 'handing over', propose_fix: () => 'making a fix', give_up: () => 'writing back',
  list_metrics: () => 'working out what to check', submit_requirements: () => 'writing the checks', get_pin_map: () => 'reading the pin map', compile_app: n => (n > 1 ? `compiling, try ${n}` : 'compiling the firmware'),
  change_firmware: () => 'handing to firmware', change_requirements: () => 'changing the checks', list_blocks: () => 'reading the circuit blocks', get_block: n => (n > 1 ? `reading ${n} blocks` : 'reading a block'),
  search_parts: n => (n > 1 ? `searching ${n} times for parts` : 'searching for parts'), get_part: n => (n > 1 ? `reading ${n} parts` : 'reading a part'), read_datasheet: n => (n > 1 ? `reading ${n} datasheet pages` : 'reading a datasheet'),
  check_plan: () => 'checking the plan', propose_plan: () => 'laying out the sections', get_plan: () => 'reading the plan', submit_review: () => 'reporting the review', read_failure: () => 'reading what failed',
};
/** The tool that means this agent got where it was going, and how to say so. */
const FINISHED: Partial<Record<AgentRole, { tools: readonly string[]; verb: string }>> = {
  designer: { tools: ['propose_design', 'propose_plan'], verb: 'Designed' }, editor: { tools: ['propose_edit', 'change_firmware', 'change_requirements'], verb: 'Changed' },
  fixer: { tools: ['propose_fix'], verb: 'Fixed' }, firmware: { tools: ['compile_app'], verb: 'Wrote the firmware' }, reviewer: { tools: ['submit_review'], verb: 'Reviewed' }, verifier: { tools: ['submit_requirements'], verb: 'Worked out the checks' },
};
/** Reads that a model can ask for again and again. Answered from memory, they aren't something that happened. */
const READS = new Set(['list_catalog', 'get_module', 'get_design', 'read_job', 'list_metrics', 'get_pin_map', 'list_blocks', 'get_block', 'search_parts', 'get_part', 'read_datasheet', 'draft_example', 'get_plan', 'read_failure']);
const FROM_MEMORY_MS = 20;

export interface ToolStep { name: string; ok: boolean; count: number; ms: number; tokens: number | null; costUsd: number | null; estimated: boolean; summaries: string[] }

const mergeSteps = (steps: readonly ToolStep[]): ToolStep[] => {
  const merged: ToolStep[] = [];
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  for (const step of steps) {
    const at = merged.findIndex(seen => seen.name === step.name && seen.ok === step.ok);
    const same = merged[at];
    if (same) merged[at] = { ...same, count: same.count + step.count, ms: same.ms + step.ms, tokens: add(same.tokens, step.tokens), costUsd: add(same.costUsd, step.costUsd), estimated: same.estimated || step.estimated, summaries: [...same.summaries, ...step.summaries] };
    else merged.push(step);
  }
  return merged;
};

/**
 * What an activity row shows when it's opened: one row per tool, in the order they first ran. A read that only ever came
 * from memory isn't a row at all, and a failure always shows. Its tokens and cost move to a row, so the rows add up to the bill.
 */
export function toolSteps(tools: readonly ToolItem[]): { steps: ToolStep[]; fromMemory: number } {
  const runs = mergeSteps(tools.map(t => ({ name: t.name, ok: t.ok, count: 1, ms: t.ms + (t.callMs ?? 0), tokens: t.tokens, costUsd: t.costUsd, estimated: t.estimated, summaries: t.summary ? [t.summary] : [] })));
  const kept: ToolStep[] = [];
  let fromMemory = 0, tokens: number | null = null, costUsd: number | null = null;
  for (const run of runs) {
    if (!run.ok || !READS.has(run.name) || run.ms >= FROM_MEMORY_MS) {
      kept.push(run);
      continue;
    }
    fromMemory += run.count;
    if (run.tokens !== null) tokens = (tokens ?? 0) + run.tokens;
    if (run.costUsd !== null) costUsd = (costUsd ?? 0) + run.costUsd;
    const last = kept.at(-1);
    if (last) { kept[kept.length - 1] = { ...last, tokens: tokens === null ? last.tokens : (last.tokens ?? 0) + tokens, costUsd: costUsd === null ? last.costUsd : (last.costUsd ?? 0) + costUsd }; tokens = null; costUsd = null; }
  }
  const steps = kept;
  if ((tokens !== null || costUsd !== null) && steps[0]) steps[0] = { ...steps[0], tokens: (steps[0].tokens ?? 0) + (tokens ?? 0), costUsd: (steps[0].costUsd ?? 0) + (costUsd ?? 0) };
  return { steps, fromMemory };
}

/** Block authors work for the Designer, so their steps are the Designer's activity. */
const activityRole = (role: AgentRole): AgentRole => (role === 'author' ? 'designer' : role);

export type ActivityBlock = { tools: ToolItem[]; role: AgentRole } | { item: AgentItem };

/** The chat for a turn: one activity row per agent's stretch of work, with what it said in between. */
export function activityBlocks(items: readonly AgentItem[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = [];
  let failed = false;
  for (const item of items) {
    const last = blocks.at(-1);
    // One failure is what the maker needs. Anything after it is the same turn stopping.
    if (item.kind === 'error') { if (!failed) blocks.push({ item }); failed = true; }
    else if (item.kind !== 'tool') blocks.push({ item });
    else if (last && 'tools' in last && last.role === activityRole(item.role)) last.tools.push(item);
    else blocks.push({ tools: [item], role: activityRole(item.role) });
  }
  return blocks;
}

const seconds = (ms: number) => (ms < 1000 ? 'under a second' : ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

export function activityLine(tools: readonly ToolItem[]): string {
  const last = tools.at(-1);
  if (!last) return 'Working…';
  let run = 0;
  for (let i = tools.length - 1; i >= 0 && tools[i]!.name === last.name; i--) run++;
  return `Working · ${(DOING[last.name] ?? (() => 'working'))(run)}…`;
}

export function finishedLine(role: AgentRole, tools: readonly ToolItem[]): string {
  const ms = tools.reduce((sum, t) => sum + t.ms + (t.callMs ?? 0), 0);
  const last = tools.at(-1);
  const finished = FINISHED[role];
  const verb = last?.ok && finished?.tools.includes(last.name) ? finished.verb : 'Worked';
  return `${verb} ${verb === 'Worked' ? 'for' : 'in'} ${seconds(ms)} · ${tools.length} step${tools.length === 1 ? '' : 's'}`;
}

/** What the card's button sends, and what typing a plain yes means while checks are waiting. */
export const CONFIRM_TEXT = 'Looks right, start the design';
/** Words from code or a network layer aren't for a maker. Anything a person wrote for them passes through. */
const NOT_FOR_MAKERS = /needs the requirements|is not valid|is required|answered HTTP|Failed to fetch|NetworkError|Load failed|Invalid JSON|Send (?:a JSON|application)|Same-origin|capability required|endpoint not found|too large|limited to \d/;
export const plainError = (text: string) => (NOT_FOR_MAKERS.test(text) ? 'That didn’t go through, and nothing was built.' : text);
export const isConfirmation = (text: string) => /^(?:ok(?:ay)?|yes|yep|yeah|sure|confirm(?:ed)?|go(?: ahead)?|build it|start|sounds good|looks (?:good|right)(?:, start the design)?)[.! ]*$/i.test(text.trim());

/** The request for a turn while checks wait on a card. Pure, so it can be tested. */
export function pendingRequest(message: string, pending: { brief: string; requirements: Requirement[]; existing: boolean; mode?: 'chip'; noMcu?: boolean }, context: Omit<TurnRequest, 'message'>): TurnRequest {
  // Checks for a new device must not be read as a change to the one on screen.
  const { design, jobId, edits, ...rest } = context;
  const base = { ...(pending.existing ? context : rest), ...(pending.mode ? { mode: pending.mode } : {}), ...(pending.noMcu ? { noMcu: true } : {}) };
  // A card with no checks has nothing to change: a new message is a new request.
  if (!pending.requirements.length && !isConfirmation(message)) return { ...base, message };
  return isConfirmation(message)
    ? { ...base, message: pending.brief, brief: pending.brief, requirements: pending.requirements, requirementsConfirmed: true }
    : { ...base, message, brief: pending.brief, requirements: pending.requirements };
}

/**
 * True when a saved chat ends with a build still running and an agent turn that never finished. The server stops an
 * agent once nobody is reading, so nothing will fix that build if it fails or give it its final requirement check.
 */
export function agentLeftBuilding(turns: readonly unknown[]): boolean {
  const last = turns.at(-1) as { kind?: string; job?: { status?: string } | null } | undefined;
  if (last?.kind !== 'run' || (last.job?.status !== 'queued' && last.job?.status !== 'running')) return false;
  for (let i = turns.length - 2; i >= 0; i--) {
    const turn = asAgentTurn(turns[i]);
    if (turn) return turn.view.usage === null;
  }
  return false;
}

/** Checks still waiting on a card when a saved chat opens, so "Looks right" works after a reload. */
export function pendingFromTurns(turns: readonly unknown[]): { brief: string; requirements: Requirement[]; existing: boolean; mode?: 'chip'; noMcu?: boolean; turn: AgentTurn } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = asAgentTurn(turns[i]);
    if (!turn) continue;
    const card = turn.view.items.find((item): item is Extract<AgentItem, { kind: 'requirements' }> => item.kind === 'requirements' && item.settled === 'open');
    if (card?.brief) return { brief: card.brief, requirements: card.requirements, existing: Boolean(card.existing), ...(card.mode ? { mode: card.mode } : {}), ...(card.noMcu ? { noMcu: true } : {}), turn };
    // A turn that only failed answered nothing, and one that was cut off never finished answering, so the question before it is still open.
    if (!turn.view.items.some(item => item.kind === 'error' && item.interrupted) && turn.view.items.some(item => item.kind !== 'error')) return null;
  }
  return null;
}

let nextId = 0;
const newId = () => `a${Date.now().toString(36)}-${nextId++}`;
const blank = (brief: string | null, model: string | null, role: AgentRole): AgentView => ({ brief, role, model, items: [], working: true, usage: null });

async function* liveEvents(request: TurnRequest, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const res = await fetch(atBase('/api/agent/turns'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, effort: currentEffort() }), signal });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    const reason = body?.error ?? `The agent service answered HTTP ${res.status}.`;
    // No model is available: exactly the situation the rule interpreter is there for.
    yield res.status === 503 ? { type: 'fallback', reason } : { type: 'error', message: reason };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const parsed = parseSse(rest + value);
    rest = parsed.rest;
    yield* parsed.events;
  }
}

export function useStudioAgent(options: StudioAgentOptions) {
  const status = useAgentStatus();
  const [running, setRunning] = useState(false);
  const [pendingFallback, setPendingFallback] = useState<string | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const controller = useRef<AbortController | null>(null);
  const lastExtra = useRef<{ message: string; extra: Partial<TurnRequest> } | null>(null);
  const pending = useRef(pendingFromTurns(options.initialTurns ?? []));

  /** `extra` is for a request that isn't only words, like a person's edits. Try again sends the same thing. */
  const send = useCallback(async (typed: string, extra?: Partial<TurnRequest>) => {
    const message = cleanBrief(typed);
    const again = extra ?? (lastExtra.current?.message === message ? lastExtra.current.extra : undefined);
    lastExtra.current = again ? { message, extra: again } : null;
    const waiting = pending.current;
    // The card keeps its button until the server has taken the answer. A busy server mustn't use it up.
    let accepted = false;
    const accept = () => {
      accepted = true;
      if (!waiting) return;
      const settled = isConfirmation(message) ? 'confirmed' as const : 'replaced' as const;
      latest.current.upsert({ ...waiting.turn, view: { ...waiting.turn.view, items: waiting.turn.view.items.map(i => (i.kind === 'requirements' ? { ...i, settled } : i)) } });
      if (pending.current === waiting) pending.current = null;
    };
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    let turn: AgentTurn = { id: newId(), kind: 'agent', view: blank(message, status?.model ?? null, 'designer') };
    let open = true;
    let finished = false;
    let stopped = false;
    let fallback = false;
    let lastRun: { id: string; jobId: string } | null = null;
    const shared: { left: number; callMs?: number } = { left: 0 };
    const publish = () => latest.current.upsert(turn);
    /** The last turn, or a new one after a build, because only the newest turn offers Try again. */
    const interrupt = (cut: AgentTurn, hadBuild: boolean): AgentTurn => {
      const base = open ? cut : { id: newId(), kind: 'agent' as const, view: blank(null, cut.view.model, cut.view.role) };
      open = true;
      return { ...base, view: { ...base.view, working: false, items: [...base.view.items.filter(item => item.kind !== 'error'), { kind: 'error', text: interruptedText(hadBuild), interrupted: { retry: message } }] } };
    };
    publish();
    try {
      const context = latest.current.context();
      const request: TurnRequest = { ...(waiting ? pendingRequest(message, waiting, context) : { message, ...context }), ...again };
      const stream = isAgentDemo() ? demoEvents(message, abort.signal) : liveEvents(request, abort.signal);
      for await (const event of stream) {
        if (event.type === 'start') accept();
        if (event.type === 'plan.partial') { latest.current.onPartial?.(event); continue; }
        if (event.type === 'done') finished = true;
        if (event.type === 'fallback') fallback = true;
        if (event.type === 'error') stopped = true;
        if (event.type === 'design') latest.current.onDesign(event.design, event.brief);
        if (event.type === 'job') {
          // The build's steps appear below this turn. What the agent says next starts a new turn after them.
          turn = { ...turn, view: { ...turn.view, working: false } };
          publish();
          open = false;
          lastRun = { id: latest.current.onJob(event.jobId, event.label), jobId: event.jobId };
          continue;
        }
        if (event.type === 'job-result' && lastRun) {
          // The studio follows one job at a time. Take the final record before a retry replaces it.
          const { id, jobId } = lastRun;
          void boardApi().get(jobId).then(job => latest.current.onJobSettled(id, job), () => {});
          continue;
        }
        if (!open) {
          if (event.type === 'done' && !event.usage.calls) continue;
          turn = { id: newId(), kind: 'agent', view: blank(null, turn.view.model, turn.view.role) };
          open = true;
        }
        turn = { ...turn, view: foldEvent(turn.view, event, shared) };
        publish();
        if (event.type === 'requirements' && event.requirements.length) pending.current = { brief: event.brief, requirements: event.requirements, existing: event.existing, ...(event.mode ? { mode: event.mode } : {}), ...(event.noMcu ? { noMcu: true } : {}), turn };
      }
      if (pending.current) pending.current = { ...pending.current, turn };
      // The rules read what the maker meant: for a plain yes on a card, that's the brief it was about.
      if (fallback) { setPendingFallback(waiting && isConfirmation(message) ? waiting.brief : message); }
      // The stream ending without an answer is the only lost contact. A handled error has already said what happened.
      else if (!finished && !abort.signal.aborted) {
        if (!stopped) { stopped = true; turn = interrupt(turn, Boolean(lastRun)); }
        turn = { ...turn, view: { ...turn.view, working: false } };
        publish();
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        stopped = true;
        // Once the server has taken the turn, a broken stream means it went away. Before that, nothing has started.
        turn = accepted ? interrupt(turn, Boolean(lastRun)) : { ...turn, view: { ...foldEvent(turn.view, { type: 'error', message: error instanceof Error ? error.message : String(error) }, shared), working: false } };
        publish();
      }
    } finally {
      // Nothing was built, so the question is still open, and Try again can answer it.
      if (stopped && waiting && !lastRun && pending.current === null) { pending.current = waiting; latest.current.upsert(waiting.turn); }
      if (fallback || abort.signal.aborted) { turn = { ...turn, view: { ...turn.view, working: false } }; if (!abort.signal.aborted) publish(); }
      // A newer turn may already be drawing. Only the turn still running clears the canvas.
      if (controller.current === abort) { controller.current = null; latest.current.onPartial?.(null); }
      setRunning(false);
    }
  }, [status?.model]);

  const stop = useCallback(() => controller.current?.abort(), []);
  useEffect(() => () => controller.current?.abort(), []);

  // The studio refuses a brief while busy, so the rules run once this turn has really ended.
  useEffect(() => {
    if (running || pendingFallback === null) return;
    const text = pendingFallback;
    setPendingFallback(null);
    latest.current.onFallback(text);
  }, [running, pendingFallback]);

  return { status, active: Boolean(status?.enabled), running, send, stop, hasWaitingChecks: () => pending.current !== null };
}

export type { BoardEdits };
