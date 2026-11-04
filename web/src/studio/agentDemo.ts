// `?mock=board&agent=demo`: the agent's cards with no server and no model, for design review. The studio's
// mock banner stays up, and every number here is marked estimated. Nothing here runs in a normal session.
import type { AgentEvent } from '../../../src/agents/protocol';
import { interpretBrief } from '../../../src/circuit/interpret';
import { buildDesign } from '../../../src/circuit/templates';
import { boardApi } from '../board/api';

export const isAgentDemo = (): boolean => {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  return q.get('mock') === 'board' && q.get('agent') === 'demo';
};

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((done, fail) => {
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); fail(new Error('stopped')); }, { once: true });
});

const COST = 0.0042;
const usage = (calls: number, pipelineMs: number) => ({ calls, inputTokens: 4120 * calls, outputTokens: 610 * calls, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: COST * calls, capUsd: 2, agentMs: 2100 * calls, pipelineMs, estimated: true });
const tool = (name: string, ms: number, summary: string, ok = true): AgentEvent => ({ type: 'tool', role: 'designer', name, ms, ok, summary, tokens: 4730, costUsd: COST, sharedWith: 0, estimated: true });

export async function* demoEvents(message: string, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  yield { type: 'start', turnId: 'demo', role: 'designer', provider: 'replay', model: 'replay', capUsd: 2 };
  await wait(500, signal);
  yield tool('list_catalog', 2, 'Read the catalog');
  if (/moisture|soil|plant/i.test(message)) {
    await wait(500, signal);
    yield { type: 'decline', message: 'The catalog has no soil moisture probe, so this can’t read how wet the soil is yet.', closest: 'The closest is a temperature monitor with a BME280, which reads air humidity but can’t alarm on it yet.', closestBrief: 'A temperature monitor with a BME280 and a screen' };
    yield { type: 'done', outcome: 'declined', usage: usage(2, 0) };
    return;
  }
  await wait(500, signal);
  yield tool('get_module', 1, 'DS18B20 temperature sensor (TO-92)');
  await wait(500, signal);
  yield tool('propose_design', 6, 'Rejected: The light-lamp firmware doesn’t drive piezo-passive-12mm (BZ1)', false);
  await wait(500, signal);
  yield tool('propose_design', 5, 'Freezer alarm: 4 parts, 4 nets');
  const read = interpretBrief('A temperature monitor with a probe that alerts above 28 °C and a buzzer');
  if (!read.ok) throw new Error('Demo brief no longer reads');
  const design = { ...buildDesign(read.interpretation), title: 'Freezer alarm' };
  yield { type: 'message', role: 'designer', text: 'A freezer alarm: a probe, and a beep above −10 °C.' };
  yield { type: 'design', design, brief: message, changes: [] };
  const { jobId } = await boardApi().create({ design });
  yield { type: 'job', jobId, attempt: 1, baseJobId: null, label: 'Freezer alarm' };
  await wait(2500, signal);
  yield { type: 'job-result', jobId, attempt: 1, status: 'done', ok: true, drcErrors: 0, compile: 'compiled', caseOk: true, pipelineMs: 33700, problems: [] };
  yield { type: 'message', role: 'designer', text: 'Built: 0 DRC errors, firmware compiled, case generated. Nothing has been printed, flashed or run on hardware; these are software checks only.' };
  yield { type: 'done', outcome: 'built', usage: usage(4, 33700) };
}
