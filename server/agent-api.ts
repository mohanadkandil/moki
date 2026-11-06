// The agent chat's HTTP surface. Same gate as the board API: the capability token when one is set,
// and same-origin only for anything that can spend money. Keys stay in this process's environment
// and are never echoed; board workers don't inherit them (see src/board/process.ts).
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { httpBoardClient, type BoardClient } from '../src/agents/board-client.js';
import { cleanBrief } from '../src/agents/brief-text.js';
import { MAX_DRAFT_OPS, parseBoardEdits, parseOps } from '../src/agents/edits.js';
import { agentStatus, createProvider, effortOptions, redact, type CallRecord, type ModelProvider } from '../src/agents/model.js';
import type { AgentEvent, AgentStatus, ChatLine, EffortId, Requirement, TurnRequest } from '../src/agents/protocol.js';
import { REQUIREMENT_METRICS } from '../src/agents/requirement-metrics.js';
import { requirementIssues } from '../src/agents/verifier.js';
import { runTurn, type VerifyEngine } from '../src/agents/turn.js';
import { evaluateRequirements } from '../src/blocks/verify.js';
import type { ChipLibrary } from '../src/agents/chip.js';
import { projectStore, type ProjectStore } from './project-api.js';
import { realChipLibrary } from '../src/agents/chip-library.js';
import { validateDesign } from '../src/agents/tools.js';
import type { CircuitDesign } from '../src/circuit/model.js';

const MAX_BODY = 300_000;
const MAX_MESSAGE = 2000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const KEEPALIVE_MS = 15_000;

export class BadTurn extends Error {}

/** Everything in a turn request comes from a browser, so nothing in it is trusted, including a saved design. */
export function parseTurn(value: unknown): TurnRequest {
  if (typeof value !== 'object' || value === null) throw new BadTurn('Send a JSON object.');
  const body = value as Record<string, unknown>;
  if (typeof body.message !== 'string' || !body.message.trim()) throw new BadTurn('message is required.');
  if (body.message.length > MAX_MESSAGE) throw new BadTurn(`message is limited to ${MAX_MESSAGE} characters.`);
  const turn: TurnRequest = { message: cleanBrief(body.message) };
  if (!turn.message) throw new BadTurn('message is required.');
  if (body.design !== undefined) {
    const issues = validateDesign(body.design);
    if (issues.length) throw new BadTurn(`The saved design is not valid: ${issues[0]}`);
    turn.design = body.design as CircuitDesign;
  }
  if (body.projectId !== undefined) {
    if (typeof body.projectId !== 'string' || !UUID.test(body.projectId)) throw new BadTurn('projectId is not valid.');
    turn.projectId = body.projectId;
  }
  if (body.effort !== undefined) {
    if (body.effort !== 'fast' && body.effort !== 'balanced' && body.effort !== 'deep') throw new BadTurn('effort is not valid.');
    turn.effort = body.effort;
  }
  if (body.mode !== undefined) {
    if (body.mode !== 'chip') throw new BadTurn('mode is not valid.');
    turn.mode = 'chip';
    if (body.noMcu === true) turn.noMcu = true;
  }
  if (body.requirements !== undefined) {
    const issues = requirementIssues(body.requirements, REQUIREMENT_METRICS);
    if (issues.length) throw new BadTurn(`The requirements are not valid: ${issues[0]}`);
    turn.requirements = body.requirements as Requirement[];
  }
  if (body.requirementsConfirmed === true) {
    // A confirm with no checks, from an older card or tab, just means go ahead.
    turn.requirementsConfirmed = true;
  }
  if (typeof body.brief === 'string') turn.brief = cleanBrief(body.brief).slice(0, MAX_MESSAGE);
  if (body.jobId !== undefined) {
    if (typeof body.jobId !== 'string' || !UUID.test(body.jobId)) throw new BadTurn('jobId is not valid.');
    turn.jobId = body.jobId;
  }
  if (body.ops !== undefined) {
    if (body.mode !== 'chip' || !turn.jobId) throw new BadTurn('Edits need a chip-level board.');
    const parsed = parseOps(body.ops, MAX_DRAFT_OPS);
    if ('error' in parsed) throw new BadTurn(parsed.error);
    turn.ops = parsed.ops;
  }
  if (body.edits !== undefined) {
    const parsed = parseBoardEdits(body.edits, turn.design);
    if ('error' in parsed) throw new BadTurn(parsed.error);
    turn.edits = parsed.edits;
  }
  if (Array.isArray(body.history)) {
    turn.history = body.history.slice(-6).flatMap((line): ChatLine[] => {
      const l = line as Partial<ChatLine> | null;
      return l && (l.role === 'user' || l.role === 'agent') && typeof l.text === 'string' ? [{ role: l.role, text: l.text.slice(0, 400) }] : [];
    });
  }
  return turn;
}

export interface AgentServiceOptions {
  env?: NodeJS.ProcessEnv;
  /** The requirement engine. Tests that inject a provider opt in, so they keep testing one thing. */
  verify?: VerifyEngine;
  chip?: ChipLibrary;
  /** Where a turn's builds and outcome are added. It knows them even if the browser has gone. */
  projects?: Pick<ProjectStore, 'noteJob' | 'noteOutcome'>;
  /** Tests inject replay and a fake board. Production builds these from the environment. */
  provider?: ModelProvider | null;
  board?: BoardClient;
  boardBaseUrl?: () => string;
  ledgerPath?: string;
  pollMs?: number;
}

export function createAgentService(options: AgentServiceOptions = {}) {
  const env = options.env ?? process.env;
  // One provider per effort, made when first asked for. Tests inject a single provider for all of them.
  const providers = new Map<EffortId, ModelProvider | null>();
  const providerFor = (effort: EffortId = 'balanced'): ModelProvider | null => {
    if (options.provider !== undefined) return options.provider;
    if (!providers.has(effort)) providers.set(effort, createProvider(env, effort));
    return providers.get(effort)!;
  };
  const provider = providerFor();
  // On by default: a brief the module kit can't do goes to chip level. MOKI_CHIP=off keeps a server on carrier boards. Tests opt in.
  const chip = options.chip ?? (options.provider === undefined && env.MOKI_CHIP !== 'off' ? realChipLibrary() : undefined);
  const verify = options.verify ?? (options.provider === undefined ? { metrics: REQUIREMENT_METRICS, evaluate: evaluateRequirements } : undefined);
  const tokenHash = env.MOKI_BOARD_API_TOKEN ? createHash('sha256').update(env.MOKI_BOARD_API_TOKEN).digest() : undefined;
  const ledgerPath = options.ledgerPath ?? resolve(process.cwd(), 'var/agent-calls.jsonl');
  const board = options.board ?? httpBoardClient({ baseUrl: options.boardBaseUrl ?? (() => 'http://127.0.0.1:5173'), token: env.MOKI_BOARD_API_TOKEN });
  let running = 0;
  const open = new Set<AbortController>();

  // What each effort has really cost here, read back from the ledger so it survives a restart.
  const spend = new Map<string, { builds: number; usd: number }>();
  const tally = (effort: string, usd: number) => { const seen = spend.get(effort) ?? { builds: 0, usd: 0 }; spend.set(effort, { builds: seen.builds + 1, usd: seen.usd + usd }); };
  try {
    for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
      if (!line.includes('"kind":"build"')) continue;
      const entry = JSON.parse(line) as { effort?: string; costUsd?: number };
      if (entry.effort && typeof entry.costUsd === 'number') tally(entry.effort, entry.costUsd);
    }
  } catch { /* No ledger yet, or a torn line: the picker just shows fewer builds. */ }
  const efforts = () => effortOptions(env).map(option => {
    const seen = spend.get(option.id);
    return { ...option, avgCostUsd: seen?.builds ? seen.usd / seen.builds : null, builds: seen?.builds ?? 0 };
  });

  const status = (): AgentStatus => provider
    ? { enabled: true, provider: provider.name, model: provider.model, capUsd: agentStatus(env).capUsd, reason: null, efforts: efforts() }
    : agentStatus(env);

  /** Every paid call leaves one line: which model, how many tokens, what it cost. Never the prompt. */
  async function logCall(turnId: string, record: CallRecord) {
    try {
      await mkdir(dirname(ledgerPath), { recursive: true });
      await appendFile(ledgerPath, `${JSON.stringify({ at: new Date().toISOString(), turnId, ...record })}\n`);
    } catch { /* The ledger must not take a chat down. The chat still shows the cost. */ }
  }

  const json = (res: ServerResponse, code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

  async function startTurn(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.origin) {
      let same = false;
      try { same = new URL(req.headers.origin).host === req.headers.host; } catch { /* A malformed Origin is not same-origin. */ }
      if (!same) return json(res, 403, { error: 'Same-origin requests only' });
    }
    if (!(req.headers['content-type'] ?? '').includes('application/json')) return json(res, 415, { error: 'Send application/json' });
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) {
      const data = Buffer.from(chunk); bytes += data.length;
      if (bytes > MAX_BODY) return json(res, 413, { error: 'Request too large' });
      chunks.push(data);
    }
    let turn: TurnRequest;
    try { turn = parseTurn(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (error) { return json(res, 400, { error: error instanceof BadTurn ? error.message : 'Invalid JSON' }); }
    const effort = turn.effort ?? 'balanced';
    const chosen = providerFor(effort);
    if (!chosen) return json(res, 503, { error: status().reason ?? 'Agents are off.' });
    const cap = efforts().find(e => e.id === effort)?.capUsd;
    // One paid turn at a time on this server: the pipeline queue is single-file anyway.
    if (running > 0) return json(res, 429, { error: 'Another agent turn is running. Try again when it lands.' });
    running++;
    const controller = new AbortController();
    open.add(controller);
    // Stop spending as soon as nobody is reading. A job already queued finishes on its own.
    res.once('close', () => controller.abort());
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    const send = (event: AgentEvent) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
    const keepalive = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
    let turnId = 'unknown';
    try {
      await runTurn(turn, {
        provider: chosen, board, signal: controller.signal,
        ...(verify ? { verify } : {}),
        ...(chip ? { chip } : {}),
        ...(cap !== undefined ? { capUsd: cap } : {}),
        emit: event => {
          if (event.type === 'start') turnId = event.turnId;
          if (turn.projectId && options.projects) {
            if (event.type === 'job') void options.projects.noteJob(turn.projectId, event.jobId, event.label).catch(() => {});
            if (event.type === 'done') void options.projects.noteOutcome(turn.projectId, event.outcome).catch(() => {});
          }
          if (event.type === 'done' && ['built', 'built-unverified', 'build-failed'].includes(event.outcome) && event.usage.calls) {
            tally(effort, event.usage.costUsd);
            void appendFile(ledgerPath, `${JSON.stringify({ kind: 'build', at: new Date().toISOString(), turnId, effort, outcome: event.outcome, costUsd: event.usage.costUsd })}\n`).catch(() => {});
          }
          send(event);
        },
        onCall: record => { void logCall(turnId, record); },
        ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
      });
    } catch (error) {
      send({ type: 'error', message: redact(error instanceof Error ? error.message : String(error)) });
    } finally {
      clearInterval(keepalive);
      running--;
      open.delete(controller);
      if (!res.writableEnded) res.end();
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = (req.url ?? '/').split('?')[0]!;
    if (!path.startsWith('/api/agent/')) return next();
    try {
      if (tokenHash) {
        const supplied = req.headers['x-moki-capability'];
        const hash = createHash('sha256').update(typeof supplied === 'string' ? supplied : '').digest();
        if (!timingSafeEqual(tokenHash, hash)) return json(res, 401, { error: 'Agent API capability required' });
      }
      if (path === '/api/agent/status' && req.method === 'GET') return json(res, 200, status());
      if (path === '/api/agent/turns' && req.method === 'POST') return await startTurn(req, res);
      return json(res, 404, { error: 'Agent endpoint not found' });
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: redact(error instanceof Error ? error.message : String(error)) });
      else res.end();
    }
  }

  function close() { for (const controller of open) controller.abort(); }
  return { handle, close, status };
}

export function agentApi(): Plugin {
  // The agents build through the same job API as the browser, on this server's own port and mount.
  const attach = (server: { httpServer: { address(): string | AddressInfo | null; once(event: 'close', listener: () => void): unknown } | null; config: { base: string }; middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown } }) => {
    const service = createAgentService({
      projects: projectStore(),
      boardBaseUrl: () => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : 5173;
        return `http://127.0.0.1:${port}${server.config.base === '/' ? '' : server.config.base.replace(/\/$/, '')}`;
      },
    });
    server.httpServer?.once('close', () => service.close());
    server.middlewares.use((req, res, next) => { void service.handle(req, res, next); });
  };
  return { name: 'moki-agent-api', configureServer: attach as never, configurePreviewServer: attach as never };
}
