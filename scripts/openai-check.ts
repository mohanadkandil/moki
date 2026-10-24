import { mkdir, writeFile } from 'node:fs/promises';
import { OpenAIProvider, Runner } from '@openai/agents';
import { createMokiTeam } from '../src/agents/team.js';
import { createOpenAIClient } from '../src/runtime/providers.js';

// Explicit live check: no desktop tools, engineering artifacts, or manufacturing actions.
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), ok: false };
let stage = 'configuration';

try {
  const client = createOpenAIClient().withOptions({ timeout: 30_000, maxRetries: 0 });
  const model = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
  report.model = model;

  stage = 'responses';
  console.log('Checking a small Responses API request…');
  const response = await client.responses.create({
    model,
    input: 'Reply with exactly MOKI_OK.',
    max_output_tokens: 64,
    reasoning: { effort: 'low' },
    store: false,
  });
  if (response.status !== 'completed' || response.output_text.trim() !== 'MOKI_OK') {
    throw new Error('Unexpected smoke-check response');
  }
  report.responses = { ok: true, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens };

  stage = 'agent-delegation';
  console.log('Checking Moki → validator → Moki delegation with missing evidence…');
  const { manager, specialists } = createMokiTeam();
  manager.tools = manager.tools.filter(tool => 'name' in tool && tool.name === 'consult_validator');
  manager.instructions += ' This is an integration check. Consult the validator exactly once about the missing artifacts, then report its status in one sentence. Do not call any other tool.';
  specialists.validator.instructions += ' For this integration check, no artifacts or checker evidence exist. Reply briefly with BLOCKED and the missing evidence. Do not claim checks ran.';

  let validatorCompleted = false;
  let sharedContextReceived = false;
  specialists.validator.on('agent_end', (context, output) => {
    validatorCompleted = /\bblocked\b/i.test(output);
    sharedContextReceived = context.context.productId === 'integration-check' && context.context.revision === 1;
  });
  const runner = new Runner({
    modelProvider: new OpenAIProvider({ openAIClient: client, useResponses: true }),
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    modelSettings: { maxTokens: 384, timeoutMs: 30_000, reasoning: { effort: 'low' }, store: false, parallelToolCalls: false },
  });
  const result = await runner.run(manager,
    'For product integration-check revision 1, no CAD files, PCB files, hashes, or checker results have been supplied. Ask the validator whether the design can pass, then report the outcome.',
    { context: { productId: 'integration-check', revision: 1 }, maxTurns: 3, signal: AbortSignal.timeout(60_000) },
  );
  const delegationPassed = validatorCompleted && sharedContextReceived && /\bblocked\b/i.test(result.finalOutput || '');
  report.delegation = {
    ok: delegationPassed,
    validatorCompleted,
    sharedContextReceived,
    outcome: delegationPassed ? 'blocked_missing_evidence' : 'unexpected',
    inputTokens: result.runContext.usage.inputTokens,
    outputTokens: result.runContext.usage.outputTokens,
  };
  if (!delegationPassed) throw new Error('Delegation check did not satisfy the expected outcome');
  report.ok = true;
} catch (error) {
  // API errors may embed request headers or key fragments. Never log raw errors/messages.
  const failure = error as { status?: unknown; code?: unknown };
  const knownCodes = ['invalid_api_key', 'insufficient_quota', 'model_not_found', 'rate_limit_exceeded'];
  report.failure = {
    stage,
    status: typeof failure.status === 'number' ? failure.status : undefined,
    code: typeof failure.code === 'string' && knownCodes.includes(failure.code) ? failure.code : 'check_failed',
  };
  process.exitCode = 1;
}

await mkdir('var/checks', { recursive: true });
await writeFile('var/checks/openai.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
