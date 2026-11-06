// The browser's side of the project API, and the saver that keeps a project's chat on the server.
import { assessJob, type AgentJob } from '../../../src/agents/facts';
import type { EffortId } from '../../../src/agents/protocol';
import type { LabSession } from '../../../src/circuit/session';
import { atBase } from '../board/base';
import type { Turn } from '../studio/conversation';

export type ProjectStatus = 'new' | 'waiting' | 'building' | 'built' | 'unverified' | 'failed' | 'stopped';
export interface ProjectCard {
  note: { kind: 'ask' | 'decline' | 'stopped'; text: string } | null;
  costUsd: number | null;
  parts: number | null;
  controller: string | null;
  sheet: { title: string; parts: unknown[]; nets: unknown[] } | null;
}
export interface ProjectSummary { id: string; title: string; brief: string; effort: EffortId; createdAt: string; updatedAt: string; status: ProjectStatus; lastJobId?: string | null; hasRequirements?: boolean; jobIds?: string[]; card?: ProjectCard }
export interface ProjectState { turns: Turn[]; session: LabSession; canvasJobId: string | null }
export interface ProjectRecord extends Omit<ProjectSummary, 'lastJobId' | 'hasRequirements'> { state: ProjectState | null; stateRev: number; jobs: { jobId: string; label: string | null; at: string }[] }

// The dev server's older /workshop shares these paths, and this header tells them apart. The gateway drops it.
const HEADERS = { 'x-moki-projects': '1' };
const JSON_HEADERS = { ...HEADERS, 'content-type': 'application/json' };

async function answer<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok || body === null) throw new ProjectError(body?.error ?? `The project service answered HTTP ${res.status}.`, res.status);
  return body;
}
export class ProjectError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export const projectsApi = {
  create: async (brief: string, effort: EffortId) => answer<{ projectId: string }>(await fetch(atBase('/api/projects'), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ brief, effort }) })),
  recent: async (signal?: AbortSignal) => (await answer<{ projects: ProjectSummary[] }>(await fetch(atBase('/api/projects'), { headers: HEADERS, cache: 'no-store', ...(signal ? { signal } : {}) }))).projects,
  get: async (id: string, signal?: AbortSignal) => answer<ProjectRecord>(await fetch(atBase(`/api/projects/${encodeURIComponent(id)}`), { headers: HEADERS, cache: 'no-store', ...(signal ? { signal } : {}) })),
  rename: async (id: string, title: string) => answer<{ title: string }>(await fetch(atBase(`/api/projects/${encodeURIComponent(id)}`), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title }) })),
};

export type SaveResult = 'saved' | 'retrying' | 'failed' | 'conflict';
const MAX_RETRY_MS = 30_000;

/**
 * Saves the latest state after a short pause, one save at a time, so the newest always lands last. A server that's away
 * (restarting, or the network) comes back, so that save keeps trying by itself. A refusal won't change by asking again.
 */
export function createSaver(id: string, startRev: number, onResult: (result: SaveResult) => void, delayMs = 400, send_: typeof fetch = (...args) => fetch(...args), retryMs = 2000) {
  const url = atBase(`/api/projects/${encodeURIComponent(id)}`);
  let pending: ProjectState | null = null;
  let rev = startRev;
  /** Another tab or device saved first. Writing now would throw its work away. */
  let stale = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let wait = retryMs;
  const send = async () => {
    if (sending || pending === null || stale) return;
    const sent = pending;
    const body = JSON.stringify({ state: sent, baseRev: rev });
    pending = null;
    sending = true;
    let away = false;
    try {
      const res = await send_(url, { method: 'PATCH', headers: JSON_HEADERS, body });
      if (res.status === 409) { stale = true; onResult('conflict'); }
      else if (res.ok) { rev = ((await res.json()) as { stateRev: number }).stateRev; wait = retryMs; onResult('saved'); }
      else if (res.status >= 500) away = true;
      else onResult('failed');
    } catch { away = true; }
    sending = false;
    if (away) {
      onResult('retrying');
      // Anything newer is what should land. Either way, nothing is lost while the server is gone.
      pending ??= sent;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, wait);
      wait = Math.min(wait * 2, MAX_RETRY_MS);
      return;
    }
    if (pending !== null) void send();
  };
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; } void send(); };
  return {
    queue(state: ProjectState, options: { now?: boolean } = {}) {
      pending = state;
      if (timer) clearTimeout(timer);
      if (options.now) { timer = null; void send(); } else timer = setTimeout(flush, delayMs);
    },
    flush,
    /** The page is going away. The browser only finishes small requests after that, so this is best effort. */
    leave() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending === null || stale) return;
      const body = JSON.stringify({ state: pending, baseRev: rev });
      if (body.length > 60_000 || sending) { void send(); return; }
      pending = null;
      void send_(url, { method: 'PATCH', headers: JSON_HEADERS, body, keepalive: true }).catch(() => {});
    },
  };
}

/** Builds the server knows about that the saved chat doesn't: the tab closed before it could save them. */
export function missingRuns(turns: readonly Turn[], jobs: ProjectRecord['jobs']): Extract<Turn, { kind: 'run' }>[] {
  const known = new Set(turns.flatMap(t => (t.kind === 'run' && t.job ? [t.job.jobId] : [])));
  return jobs.filter(j => !known.has(j.jobId)).map(j => ({ id: `job-${j.jobId}`, kind: 'run', label: j.label, job: null, startedAt: null, waitedMs: null, jobId: j.jobId } as Extract<Turn, { kind: 'run' }>));
}

/** A project can say "building" long after its tab closed, so a list asks how the build really ended. */
export function settledStatus(status: ProjectStatus, job: Partial<AgentJob> | null, hasRequirements = false): ProjectStatus {
  if (status !== 'building' || !job || job.status === 'queued' || job.status === 'running') return status;
  if (!assessJob(job as AgentJob).ok) return 'failed';
  return hasRequirements ? 'unverified' : 'built';
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86_400 * 14) return `${Math.floor(seconds / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
