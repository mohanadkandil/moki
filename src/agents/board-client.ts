// The agents' only way to build: the same job API the studio uses. Going over HTTP keeps one owner
// of the job root and one queue, and means an agent can't do anything a maker's browser couldn't.
import type { DesignOp } from './edits.js';
import type { BoardPlan } from '../blocks/contract.js';
import type { CircuitDesign } from '../circuit/model.js';
import type { AgentJob } from './facts.js';
import type { BoardEdits } from './protocol.js';

export type JobInput = ({ design: CircuitDesign } | { source: string } | { plan: BoardPlan }) & { baseJobId?: string; edits?: BoardEdits; /** The server checks these make this plan, then records them. */ ops?: DesignOp[] };

export class BoardServiceError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export interface BoardClient {
  create(input: JobInput, signal?: AbortSignal): Promise<{ jobId: string }>;
  get(jobId: string, signal?: AbortSignal): Promise<AgentJob>;
  /** A JSON artifact of a job, or null when there is none. */
  artifact(job: AgentJob, name: string, signal?: AbortSignal): Promise<unknown>;
}

export function httpBoardClient(options: { baseUrl: () => string; token?: string | undefined; fetch?: typeof fetch }): BoardClient {
  const call = options.fetch ?? fetch;
  const headers = options.token ? { 'x-moki-capability': options.token } : undefined;
  const url = (path: string) => `${options.baseUrl().replace(/\/$/, '')}${path}`;
  async function read<T>(response: Response): Promise<T> {
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new BoardServiceError(`The board service answered HTTP ${response.status} without JSON.`, response.status);
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new BoardServiceError(body.error ?? `The board service answered HTTP ${response.status}.`, response.status);
    return body;
  }
  return {
    async create(input, signal) {
      return read(await call(url('/api/board/jobs'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input), ...(signal ? { signal } : {}) }));
    },
    async get(jobId, signal) {
      return read(await call(url(`/api/board/jobs/${encodeURIComponent(jobId)}`), { cache: 'no-store', ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) }));
    },
    async artifact(job, name, signal) {
      const artifact = job.artifacts?.[name];
      if (!artifact) return null;
      const response = await call(url(artifact.url), { cache: 'no-store', ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) });
      return response.ok ? response.json() : null;
    },
  };
}

export async function waitForJob(client: BoardClient, jobId: string, options: { signal?: AbortSignal; pollMs?: number; timeoutMs?: number } = {}): Promise<AgentJob> {
  const pollMs = options.pollMs ?? 1000;
  const deadline = Date.now() + (options.timeoutMs ?? 8 * 60_000);
  let failures = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      const job = await client.get(jobId, options.signal);
      failures = 0;
      if (job.status === 'done' || job.status === 'failed') return job;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof BoardServiceError && error.status === 404) throw error;
      if (++failures > 10) throw error;
    }
    if (Date.now() > deadline) throw new BoardServiceError(`Job ${jobId} did not finish in time.`, 504);
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(done, pollMs);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); fail(options.signal!.reason); }, { once: true });
    });
  }
}
