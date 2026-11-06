// One model interface for every agent. Adapters are loaded lazily, so a test run or an off switch
// never imports an SDK, and replay never touches the network.
import type { AgentRole, AgentStatus, UsageTotals , EffortId, EffortOption } from './protocol.js';

export const JOB_CAP_USD = 2;
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';

export interface ToolDef { name: string; description: string; schema: Record<string, unknown> }
export type ContentBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
export interface ToolResult { toolUseId: string; content: string; isError?: boolean }
export type ModelMessage =
  | { role: 'user'; text?: string; toolResults?: ToolResult[] }
  /** providerData is what the adapter must send back untouched (thinking blocks, reasoning items). */
  | { role: 'assistant'; content: ContentBlock[]; providerData?: unknown };
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
export interface TokenCounts { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
export interface ModelRequest { system: string; messages: ModelMessage[]; tools: ToolDef[]; maxTokens: number; signal?: AbortSignal }
export interface ModelResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenCounts;
  /** The model that actually answered. A fallback can differ from the one requested. */
  model: string;
  /** Every billed attempt, when a call made more than one. Takes the place of `usage` when costing. */
  billed?: Array<{ model: string; usage: TokenCounts }>;
  providerData?: unknown;
  /** True when the counts are a character estimate rather than a provider's own usage. */
  estimated?: boolean;
  /** Replay only: the recorded duration, so a fixture reports the time its real call took. */
  recordedMs?: number;
}
export interface ModelProvider {
  readonly name: 'anthropic' | 'openai' | 'replay';
  readonly model: string;
  /** Multiplier on the pre-call worst case. Server-side fallbacks can bill a second model in one call. */
  readonly reserveFactor: number;
  call(request: ModelRequest): Promise<ModelResponse>;
}

// ---------------------------------------------------------------- Prices

export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number; known: boolean }
const listed = (input: number, output: number, cacheRead = input * 0.1): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25, known: true });
/** USD per million tokens, first-party list prices as of the Claude API skill's 2026-10-06 table. */
const PRICES: Record<string, Price> = {
  'claude-fable-5-1': listed(10, 50, 0.25),
  'claude-opus-5-5': listed(4, 20, 0.2),
  'claude-sonnet-5-5': listed(2, 10, 0.2),
  'claude-haiku-5-5': listed(0.1, 0.5),
  // OpenAI's listed price, as in docs/engineering/2026-11-04-agents/reports/agent_core.md. Without this line the live link priced it as unknown, at $15 and $75, and a chip-level turn hit its $2 cap after about 20 cents.
  'gpt-6.1-sol': listed(2, 10, 0.2),
};
/** Deliberately high, so an unpriced model reaches the hard cap early rather than late. */
const ASSUMED: Price = { input: 15, output: 75, cacheRead: 15, cacheWrite: 18.75, known: false };

/** MOKI_AGENT_PRICE="input,output" (USD per million tokens) prices a model this table doesn't list. */
export function priceOf(model: string, env: NodeJS.ProcessEnv = process.env): Price {
  const override = env.MOKI_AGENT_PRICE?.split(',').map(Number);
  if (override?.length === 2 && override.every(n => Number.isFinite(n) && n >= 0)) return { ...listed(override[0]!, override[1]!), known: true };
  return PRICES[model] ?? ASSUMED;
}

export function costOf(usage: TokenCounts, price: Price): number {
  return (usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.cacheRead + usage.cacheWriteTokens * price.cacheWrite) / 1_000_000;
}

// ---------------------------------------------------------------- Metering

export class AgentStop extends Error {
  constructor(readonly reason: 'budget' | 'refusal' | 'max-tokens' | 'call-limit' | 'aborted' | 'provider', message: string) { super(message); }
}

export interface CallRecord extends TokenCounts { role: AgentRole; provider: string; model: string; costUsd: number; ms: number; estimated: boolean }

const MIN_USEFUL_OUTPUT = 512;
const charsOf = (request: ModelRequest) => request.system.length + JSON.stringify(request.messages).length + JSON.stringify(request.tools).length;

/** A hard ceiling per job. A call that could cross it is shrunk or refused before it is sent, not billed and regretted. */
export class JobBudget {
  readonly calls: CallRecord[] = [];
  spentUsd = 0;
  estimated = false;
  pipelineMs = 0;
  constructor(readonly capUsd: number = JOB_CAP_USD, private readonly env: NodeJS.ProcessEnv = process.env, private readonly onCall?: (record: CallRecord) => void) {}

  /** The largest max_tokens this call may use, after reserving for its input. */
  preflight(request: ModelRequest, provider: Pick<ModelProvider, 'model' | 'reserveFactor'>): number {
    const price = priceOf(provider.model, this.env);
    const reserve = Math.max(provider.reserveFactor, 1);
    // 2.5 characters a token overstates even dense JSON, so the estimate errs towards stopping early.
    const inputCost = (charsOf(request) / 2.5) * price.input / 1_000_000 * reserve;
    const left = this.capUsd - this.spentUsd - inputCost;
    const affordable = Math.floor(left / (price.output * reserve) * 1_000_000);
    if (affordable < MIN_USEFUL_OUTPUT) throw new AgentStop('budget', `Stopped at the $${this.capUsd.toFixed(2)} limit for one job after spending $${this.spentUsd.toFixed(4)}.`);
    return Math.min(request.maxTokens, affordable);
  }

  charge(role: AgentRole, provider: string, response: ModelResponse, ms: number): CallRecord {
    const attempts = response.billed?.length ? response.billed : [{ model: response.model, usage: response.usage }];
    const costUsd = attempts.reduce((sum, a) => sum + costOf(a.usage, priceOf(a.model, this.env)), 0);
    const total = (key: keyof TokenCounts) => attempts.reduce((sum, a) => sum + a.usage[key], 0);
    const allKnown = attempts.every(a => priceOf(a.model, this.env).known);
    const record: CallRecord = { role, provider, model: response.model, inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), cacheReadTokens: total('cacheReadTokens'), cacheWriteTokens: total('cacheWriteTokens'), costUsd, ms, estimated: Boolean(response.estimated) || !allKnown };
    this.calls.push(record);
    this.spentUsd += costUsd;
    if (record.estimated) this.estimated = true;
    this.onCall?.(record);
    return record;
  }

  totals(): UsageTotals {
    const sum = (key: keyof TokenCounts) => this.calls.reduce((total, call) => total + call[key], 0);
    return { calls: this.calls.length, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheWriteTokens: sum('cacheWriteTokens'), costUsd: this.spentUsd, capUsd: this.capUsd, agentMs: this.calls.reduce((total, call) => total + call.ms, 0), pipelineMs: this.pipelineMs, estimated: this.estimated };
  }
}

const KEY_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})\b/g;
/** Provider errors reach logs and the chat. A key must never be able to follow them there. */
export const redact = (text: string) => text.replace(KEY_SHAPES, '[redacted]').slice(0, 600);

// ---------------------------------------------------------------- Anthropic

function anthropicMessages(messages: ModelMessage[]): unknown[] {
  return messages.map(message => {
    if (message.role === 'assistant') return { role: 'assistant', content: message.providerData ?? message.content };
    const results = (message.toolResults ?? []).map(r => ({ type: 'tool_result', tool_use_id: r.toolUseId, content: r.content, ...(r.isError ? { is_error: true } : {}) }));
    return { role: 'user', content: [...results, ...(message.text ? [{ type: 'text', text: message.text }] : [])] };
  });
}

interface AnthropicUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; model?: string; type?: string }
const anthropicCounts = (u: AnthropicUsage): TokenCounts => ({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 });

/** A declined attempt is billed even though a fallback answered, so each entry is costed at its own model. */
export function anthropicBilling(iterations: readonly AnthropicUsage[] | null | undefined, requested: string): Array<{ model: string; usage: TokenCounts }> {
  return (iterations ?? []).filter(i => typeof i.input_tokens === 'number').map(i => ({ model: i.model ?? requested, usage: anthropicCounts(i) }));
}

export function anthropicProvider(model: string, reasoning: EffortOption['reasoning'] = 'medium'): ModelProvider {
  let client: Promise<import('@anthropic-ai/sdk').default> | undefined;
  return {
    name: 'anthropic', model, reserveFactor: 3,
    async call(request) {
      client ??= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => new Anthropic({ timeout: 240_000, maxRetries: 0 }));
      const sdk = await client;
      // Non-streaming on purpose: the chat receives text only after the claim guard has read it, so
      // token deltas would have no reader. Tool arguments stay server-validated for the same reason.
      // Forced tool_choice is a 400 on this model family, so `auto` plus the prompt steers tool use.
      const response = await sdk.beta.messages.create({
        model,
        max_tokens: request.maxTokens,
        cache_control: { type: 'ephemeral' },
        system: request.system,
        messages: anthropicMessages(request.messages) as never,
        tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.schema as never })),
        output_config: { effort: reasoning },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal: request.signal });
      const content: ContentBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'tool_use') content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
      }
      const stop = response.stop_reason;
      return {
        content,
        stopReason: stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' || stop === 'refusal' ? stop : 'other',
        model: response.model,
        providerData: response.content,
        usage: anthropicCounts(response.usage),
        billed: anthropicBilling(response.usage.iterations as readonly AnthropicUsage[] | null | undefined, model),
      };
    },
  };
}

// ---------------------------------------------------------------- OpenAI

function openaiInput(messages: ModelMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (Array.isArray(message.providerData)) input.push(...message.providerData);
      else for (const block of message.content) {
        if (block.type === 'text') input.push({ role: 'assistant', content: block.text });
        else input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      }
      continue;
    }
    for (const r of message.toolResults ?? []) input.push({ type: 'function_call_output', call_id: r.toolUseId, output: r.isError ? `ERROR: ${r.content}` : r.content });
    if (message.text) input.push({ role: 'user', content: message.text });
  }
  return input;
}

export function openaiProvider(model: string, reasoning: EffortOption['reasoning'] = 'medium'): ModelProvider {
  let client: Promise<import('openai').default> | undefined;
  return {
    name: 'openai', model, reserveFactor: 1,
    async call(request) {
      client ??= import('openai').then(({ default: OpenAI }) => new OpenAI({ timeout: 240_000, maxRetries: 0 }));
      const sdk = await client;
      const response = await sdk.responses.create({
        model,
        instructions: request.system,
        input: openaiInput(request.messages) as never,
        tools: request.tools.map(tool => ({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.schema, strict: false })),
        max_output_tokens: request.maxTokens,
        store: false,
        include: ['reasoning.encrypted_content'],
        reasoning: { effort: reasoning },
      }, { signal: request.signal });
      if (response.status === 'failed') throw new Error(response.error?.message ?? 'The model service reported a failed response.');
      const content: ContentBlock[] = [];
      let refused = false;
      for (const item of response.output) {
        if (item.type === 'function_call') {
          let input: unknown;
          try { input = JSON.parse(item.arguments); } catch { input = { __invalid: item.arguments.slice(0, 200) }; }
          content.push({ type: 'tool_use', id: item.call_id, name: item.name, input });
        } else if (item.type === 'message') {
          for (const part of item.content) {
            if (part.type === 'output_text') content.push({ type: 'text', text: part.text });
            else if (part.type === 'refusal') refused = true;
          }
        }
      }
      const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
      const incomplete = response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens';
      return {
        content,
        stopReason: refused ? 'refusal' : incomplete ? 'max_tokens' : content.some(b => b.type === 'tool_use') ? 'tool_use' : response.status === 'completed' ? 'end_turn' : 'other',
        model: response.model,
        providerData: response.output,
        usage: { inputTokens: (response.usage?.input_tokens ?? 0) - cached, outputTokens: response.usage?.output_tokens ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 },
      };
    },
  };
}

// ---------------------------------------------------------------- Replay and recording

export interface ReplayCall { content: ContentBlock[]; stopReason: StopReason; usage?: TokenCounts; ms?: number; model?: string }
export interface ReplayFixture {
  id: string;
  brief?: string;
  /** 'authored' fixtures were written by hand with no model. They test the harness, not a model's judgement. */
  provenance: 'recorded' | 'authored';
  note?: string;
  calls: ReplayCall[];
}

/** Serves a fixture's calls in order. It has no network path, and running out is an error, not a guess. */
export function replayProvider(fixture: ReplayFixture, model = DEFAULT_ANTHROPIC_MODEL): ModelProvider & { remaining(): number } {
  let next = 0;
  return {
    name: 'replay', model, reserveFactor: 1,
    remaining: () => fixture.calls.length - next,
    async call(request) {
      request.signal?.throwIfAborted();
      const call = fixture.calls[next++];
      if (!call) throw new Error(`Replay fixture ${fixture.id} has no call ${next}`);
      const outChars = JSON.stringify(call.content).length;
      return {
        content: call.content, stopReason: call.stopReason, model: call.model ?? model,
        usage: call.usage ?? { inputTokens: Math.ceil(charsOf(request) / 4), outputTokens: Math.ceil(outChars / 4), cacheReadTokens: 0, cacheWriteTokens: 0 },
        estimated: !call.usage,
        ...(call.ms !== undefined ? { recordedMs: call.ms } : {}),
      };
    },
  };
}

/** Wraps a live provider and keeps what it said, so a paid run becomes a free regression fixture. */
export function recordingProvider(inner: ModelProvider, id: string, brief?: string): ModelProvider & { fixture(): ReplayFixture } {
  const calls: ReplayCall[] = [];
  return {
    name: inner.name, model: inner.model, reserveFactor: inner.reserveFactor,
    fixture: () => ({ id, provenance: 'recorded', ...(brief ? { brief } : {}), calls }),
    async call(request) {
      const started = performance.now();
      const response = await inner.call(request);
      calls.push({ content: response.content, stopReason: response.stopReason, usage: response.usage, ms: Math.round(performance.now() - started), model: response.model });
      return response;
    },
  };
}

// ---------------------------------------------------------------- Selection

export function agentStatus(env: NodeJS.ProcessEnv = process.env): AgentStatus {
  const capUsd = JOB_CAP_USD;
  if ((env.MOKI_AGENTS ?? '').trim().toLowerCase() === 'off') return { enabled: false, provider: null, model: null, capUsd, reason: 'Switched off with MOKI_AGENTS=off.' };
  // A public link with no token would let anyone who finds it spend the model budget.
  if (env.MOKI_PUBLIC_HOST && !env.MOKI_BOARD_API_TOKEN) return { enabled: false, provider: null, model: null, capUsd, reason: 'This server is public and has no MOKI_BOARD_API_TOKEN, so paid agents stay off.' };
  const wanted = env.MOKI_AGENT_PROVIDER?.trim().toLowerCase();
  const anthropicKey = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const openaiKey = Boolean(env.OPENAI_API_KEY);
  if (wanted && wanted !== 'anthropic' && wanted !== 'openai') return { enabled: false, provider: null, model: null, capUsd, reason: `Unknown MOKI_AGENT_PROVIDER "${wanted.slice(0, 20)}".` };
  if (wanted !== 'openai' && anthropicKey) return { enabled: true, provider: 'anthropic', model: env.MOKI_AGENT_MODEL || DEFAULT_ANTHROPIC_MODEL, capUsd, reason: null };
  if (wanted !== 'anthropic' && openaiKey) return { enabled: true, provider: 'openai', model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL, capUsd, reason: null };
  return { enabled: false, provider: null, model: null, capUsd, reason: 'No model key is set on this server.' };
}

const EFFORT_USES: Record<EffortId, string> = { fast: 'Simple boards and quick changes', balanced: 'Most boards', deep: 'Tricky circuits, more thinking' };
const EFFORT_LABELS: Record<EffortId, string> = { fast: 'Fast', balanced: 'Balanced', deep: 'Deep' };

/**
 * Each effort is a model, a reasoning level and a cap. MOKI_AGENT_EFFORTS overrides any of them as JSON, such as
 * {"fast":{"model":"x","capUsd":0.5}}. No effort can raise a build past the hard cap.
 */
export function effortOptions(env: NodeJS.ProcessEnv = process.env): Omit<EffortOption, 'avgCostUsd' | 'builds'>[] {
  const status = agentStatus(env);
  if (!status.enabled || !status.model) return [];
  let overrides: Partial<Record<EffortId, { model?: unknown; reasoning?: unknown; capUsd?: unknown }>> = {};
  try { overrides = JSON.parse(env.MOKI_AGENT_EFFORTS ?? '{}') as typeof overrides; } catch { /* A broken setting falls back to the defaults. */ }
  const defaults: Record<EffortId, { reasoning: 'low' | 'medium' | 'high'; capUsd: number }> = { fast: { reasoning: 'low', capUsd: 0.5 }, balanced: { reasoning: 'medium', capUsd: JOB_CAP_USD }, deep: { reasoning: 'high', capUsd: JOB_CAP_USD } };
  return (['fast', 'balanced', 'deep'] as const).map(id => {
    const set = overrides[id] ?? {};
    const cap = typeof set.capUsd === 'number' && set.capUsd > 0 ? set.capUsd : defaults[id].capUsd;
    return {
      id, label: EFFORT_LABELS[id], use: EFFORT_USES[id],
      model: typeof set.model === 'string' && set.model ? set.model : status.model!,
      reasoning: set.reasoning === 'low' || set.reasoning === 'medium' || set.reasoning === 'high' ? set.reasoning : defaults[id].reasoning,
      capUsd: Math.min(cap, JOB_CAP_USD),
    };
  });
}

export function createProvider(env: NodeJS.ProcessEnv = process.env, effort: EffortId = 'balanced'): ModelProvider | null {
  const status = agentStatus(env);
  if (!status.enabled || !status.model) return null;
  const chosen = effortOptions(env).find(e => e.id === effort);
  const model = chosen?.model ?? status.model;
  const reasoning = chosen?.reasoning ?? 'medium';
  return status.provider === 'anthropic' ? anthropicProvider(model, reasoning) : openaiProvider(model, reasoning);
}
