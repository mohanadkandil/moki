// The agent loop: ask the model, run the tools it asked for, repeat. The harness owns every limit.
import { AgentStop, type JobBudget, type ModelMessage, type ModelProvider, type ToolDef, redact } from './model.js';
import type { AgentEvent, AgentRole } from './protocol.js';

export type Emit = (event: AgentEvent) => void;
export interface ToolOutcome<T> { result: unknown; isError?: boolean; summary?: string; /** Ends the loop with this value. */ finish?: T }
export interface AgentTool<T> { def: ToolDef; run(input: Record<string, unknown>): ToolOutcome<T> | Promise<ToolOutcome<T>> }

export interface AgentRun<T> {
  role: AgentRole;
  system: string;
  prompt: string;
  tools: AgentTool<T>[];
  provider: ModelProvider;
  budget: JobBudget;
  emit: Emit;
  signal?: AbortSignal;
  maxCalls?: number;
  maxTokens?: number;
  /** Called after each tool, for anyone following along. */
  onTool?(name: string, input: Record<string, unknown>, outcome: { isError?: boolean }): void;
}

const MAX_RESULT_CHARS = 24_000;
const asInput = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Runs until a tool finishes the turn or the model stops. Returns the finish value and any closing text. */
export async function runAgent<T>(run: AgentRun<T>): Promise<{ finish?: T; text: string }> {
  const { provider, budget, emit, role, signal } = run;
  const defs = run.tools.map(t => t.def);
  const byName = new Map(run.tools.map(t => [t.def.name, t]));
  const messages: ModelMessage[] = [{ role: 'user', text: run.prompt }];
  const maxCalls = run.maxCalls ?? 8;
  for (let index = 1; ; index++) {
    if (signal?.aborted) throw new AgentStop('aborted', 'The chat closed.');
    if (index > maxCalls) throw new AgentStop('call-limit', `The ${role} used its ${maxCalls} model calls without finishing.`);
    const request = { system: run.system, messages, tools: defs, maxTokens: run.maxTokens ?? 16_000, ...(signal ? { signal } : {}) };
    request.maxTokens = budget.preflight(request, provider);
    const started = performance.now();
    let response;
    try { response = await provider.call(request); }
    catch (error) {
      if (signal?.aborted) throw new AgentStop('aborted', 'The chat closed.');
      throw new AgentStop('provider', redact(error instanceof Error ? error.message : String(error)));
    }
    const ms = response.recordedMs ?? Math.round(performance.now() - started);
    const record = budget.charge(role, provider.name, response, ms);
    emit({ type: 'call', role, index, ms, inputTokens: record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens, outputTokens: record.outputTokens, costUsd: record.costUsd, estimated: record.estimated });
    if (response.stopReason === 'refusal') throw new AgentStop('refusal', 'The model declined this request.');
    // A cut-off tool call has unusable arguments, so nothing in this response runs.
    if (response.stopReason === 'max_tokens') throw new AgentStop('max-tokens', `The ${role} ran out of output room.`);
    const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    const calls = response.content.filter(b => b.type === 'tool_use');
    if (!calls.length) {
      // A blank answer would otherwise look like a turn that finished with nothing to say.
      if (!text || response.stopReason === 'other') throw new AgentStop('provider', `The ${role} got no usable answer from the model.`);
      return { text };
    }
    messages.push({ role: 'assistant', content: response.content, ...(response.providerData !== undefined ? { providerData: response.providerData } : {}) });
    const tokens = record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens;
    const toolResults = [];
    let finished: { value: T } | undefined;
    for (const call of calls) {
      const tool = byName.get(call.name);
      const at = performance.now();
      let outcome: ToolOutcome<T>;
      try { outcome = tool ? await tool.run(asInput(call.input)) : { result: `No tool named ${call.name}.`, isError: true }; }
      catch (error) { outcome = { result: redact(error instanceof Error ? error.message : String(error)), isError: true }; }
      const content = (typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result)).slice(0, MAX_RESULT_CHARS);
      toolResults.push({ toolUseId: call.id, content, ...(outcome.isError ? { isError: true } : {}) });
      emit({ type: 'tool', role, name: call.name, ms: Math.round(performance.now() - at), ok: !outcome.isError, summary: outcome.summary ?? (outcome.isError ? content.slice(0, 200) : ''), tokens, costUsd: record.costUsd, sharedWith: calls.length - 1, estimated: record.estimated });
      run.onTool?.(call.name, asInput(call.input), outcome);
      if (outcome.finish !== undefined && !finished) finished = { value: outcome.finish };
    }
    if (finished) return { finish: finished.value, text };
    messages.push({ role: 'user', toolResults });
  }
}
