import { useCallback, useEffect, useRef, useState } from 'react';
import { atBase } from './base';
import { createMockApi } from './mock';
import type { Artifact, BoardApi, BoardJob, JobRequest } from './types';

const POLL_MS = 400;
/** About 8 s of failed polls before the studio says it lost the job. */
const POLL_FAILURES_ALLOWED = 20;
/** Extra polls allowed after a terminal status, while the artifact list is still changing. */
const SETTLE_POLLS_ALLOWED = 8;

class ServiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readJson<T>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') ?? '';
  // Without the board plugin, the dev server answers unknown GETs with the app's index.html.
  if (!type.includes('json')) throw new ServiceError(`The board service is not answering (HTTP ${res.status}, ${type || 'no content type'}).`, res.status);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new ServiceError(body.error ?? `The board service answered HTTP ${res.status}.`, res.status);
  return body;
}

const liveApi: BoardApi = {
  isMock: false,
  async create(body) {
    return readJson(await fetch(atBase('/api/board/jobs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  },
  async get(jobId, signal) {
    const job = await readJson<BoardJob>(await fetch(atBase(`/api/board/jobs/${encodeURIComponent(jobId)}`), { signal, cache: 'no-store' }));
    // Every link, viewer and download reads its URL from here, so this is the only place it needs fixing.
    const artifacts = job.artifacts && Object.fromEntries(Object.entries(job.artifacts).map(([name, a]) => [name, { ...a, url: atBase(a.url) }]));
    return artifacts ? { ...job, artifacts } : job;
  },
};

let cachedApi: BoardApi | null = null;
export function boardApi(): BoardApi {
  if (cachedApi) return cachedApi;
  const q = new URLSearchParams(window.location.search);
  cachedApi = q.get('mock') === 'board' ? createMockApi(q.get('scenario') ?? 'clean') : liveApi;
  return cachedApi;
}

export type RunPhase = 'idle' | 'posting' | 'polling' | 'settled' | 'lost';

export interface BoardRun {
  phase: RunPhase;
  /** The job being followed: running, finished or failed. */
  job: BoardJob | null;
  /** The newest finished job. It stays on screen while a new one runs or after one fails. */
  lastGood: BoardJob | null;
  /** A failure talking to the service, as opposed to a job that ran and failed. */
  serviceError: string | null;
  /** Browser clock since the current request started. Used only while the API has no total yet. */
  startedAt: number | null;
  start(body: JobRequest): void;
  follow(jobId: string): void;
}

export function useBoardRun(): BoardRun {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [job, setJob] = useState<BoardJob | null>(null);
  const [lastGood, setLastGood] = useState<BoardJob | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Bumped per request, so a slow answer from an older one can't overwrite a newer one.
  const token = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const disposed = useRef(false);

  const poll = useCallback((jobId: string, mine: number) => {
    const api = boardApi();
    const abort = new AbortController();
    controller.current = abort;
    setPhase('polling');
    let failures = 0;
    let settlePolls = 0;
    let artifactCount = -1;
    const step = async () => {
      if (token.current !== mine || disposed.current) return;
      try {
        const next = await api.get(jobId, abort.signal);
        if (token.current !== mine) return;
        failures = 0;
        setServiceError(null);
        setJob(next);
        if (next.status === 'done' || next.status === 'failed') {
          // The server can report a terminal status while it's still listing the job's final files,
          // so stopping at the first one could hide outputs. Wait for the list to hold still.
          const count = Object.keys(next.artifacts ?? {}).length;
          if (count === artifactCount || settlePolls >= SETTLE_POLLS_ALLOWED) {
            if (next.status === 'done') setLastGood(next);
            setPhase('settled');
            return;
          }
          artifactCount = count;
          settlePolls += 1;
        }
      } catch (err) {
        if (token.current !== mine || abort.signal.aborted) return;
        failures += 1;
        // A missing job stays missing; a dropped connection may come back.
        if (failures > POLL_FAILURES_ALLOWED || (err instanceof ServiceError && err.status === 404)) {
          setServiceError(err instanceof Error ? err.message : String(err));
          setPhase('lost');
          return;
        }
      }
      window.setTimeout(() => void step(), POLL_MS);
    };
    void step();
  }, []);

  const begin = useCallback(() => {
    controller.current?.abort();
    token.current += 1;
    setServiceError(null);
    setStartedAt(Date.now());
    return token.current;
  }, []);

  const start = useCallback((body: JobRequest) => {
    const mine = begin();
    setPhase('posting');
    setJob(null);
    boardApi().create(body).then(
      ({ jobId }) => { if (token.current === mine) poll(jobId, mine); },
      (err: unknown) => {
        if (token.current !== mine) return;
        setServiceError(err instanceof Error ? err.message : String(err));
        setPhase('lost');
      },
    );
  }, [begin, poll]);

  const follow = useCallback((jobId: string) => { poll(jobId, begin()); }, [begin, poll]);

  // Not a token bump: StrictMode runs this cleanup right after the first effects, and a request
  // already sent has to survive that. A real unmount stops the poll loop at its next step.
  useEffect(() => {
    disposed.current = false;
    return () => { disposed.current = true; };
  }, []);

  return { phase, job, lastGood, serviceError, startedAt, start, follow };
}

export type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

/** Fetch and parse an artifact. Refetches when the artifact's URL or hash changes. */
export function useArtifact<T>(artifact: Artifact | undefined, parse: (res: Response) => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const url = artifact?.url;
  const hash = artifact?.sha256;
  useEffect(() => {
    if (!url) return;
    let live = true;
    setLoaded({ state: 'loading' });
    fetch(url, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return parseRef.current(res);
      })
      .then(value => { if (live) setLoaded({ state: 'ready', value }); })
      .catch((err: unknown) => { if (live) setLoaded({ state: 'error', message: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [url, hash]);
  return loaded;
}
