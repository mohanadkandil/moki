import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { BadTurn, createAgentService, parseTurn, type AgentServiceOptions } from '../server/agent-api.js';
import type { BoardClient } from '../src/agents/board-client.js';
import type { AgentJob } from '../src/agents/facts.js';
import { replayProvider, type ModelProvider, type ReplayFixture } from '../src/agents/model.js';
import type { AgentEvent } from '../src/agents/protocol.js';
import { interpretBrief } from '../src/circuit/interpret.js';
import { buildDesign } from '../src/circuit/templates.js';

const fixture = (id: string): ReplayFixture => JSON.parse(readFileSync(resolve('tests/agent-fixtures', `${id}.json`), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'moki-agent-api-'));
const ledgerPath = join(scratch, 'calls.jsonl');

const board: BoardClient = {
  async create() { return { jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }; },
  async get(jobId) {
    return { jobId, status: 'done', createdAt: '', totalMs: 1234, cache: 'miss', input: { kind: 'design', sourceSha256: 'x' }, toolVersions: {}, board: { widthMm: 75, heightMm: 75, layers: 2, traceCount: 9, viaCount: 0 }, drc: { checked: true, errors: [], warnings: [] }, stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'enclosure', status: 'done', ms: 1 }, { name: 'firmware-compile', status: 'done', ms: 1 }], artifacts: { 'enclosure-base.stl': { url: '/x', bytes: 1, sha256: 'a', kind: 'stl' } } } as AgentJob;
  },
  async artifact() { return null; },
};

const servers: Server[] = [];
async function serve(options: AgentServiceOptions) {
  const service = createAgentService({ board, ledgerPath, pollMs: 1, env: {}, ...options });
  const server = createServer((req, res) => { void service.handle(req, res, () => { res.writeHead(418); res.end('next'); }); });
  servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, service };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${url}/api/agent/turns`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const events = (text: string): AgentEvent[] => text.split('\n\n').filter(block => block.startsWith('event:')).map(block => JSON.parse(block.split('\n').find(l => l.startsWith('data: '))!.slice(6)) as AgentEvent);

after(async () => {
  await Promise.all(servers.map(s => new Promise(done => s.close(done))));
  rmSync(scratch, { recursive: true, force: true });
});

describe('agent status', () => {
  it('says off, and why, when there is no key or the kill switch is set', async () => {
    const { url } = await serve({ provider: null, env: {} });
    assert.deepEqual(await (await fetch(`${url}/api/agent/status`)).json(), { enabled: false, provider: null, model: null, capUsd: 2, reason: 'No model key is set on this server.' });
    const killed = await serve({ env: { MOKI_AGENTS: 'off', ANTHROPIC_API_KEY: 'sk-ant-test123456789' } });
    const body = await (await fetch(`${killed.url}/api/agent/status`)).json() as { enabled: boolean; reason: string };
    assert.equal(body.enabled, false);
    assert.match(body.reason, /MOKI_AGENTS=off/);
    assert.equal((await post(killed.url, { message: 'A lamp' })).status, 503);
  });

  it('never returns the key', async () => {
    const { url } = await serve({ env: { ANTHROPIC_API_KEY: 'sk-ant-test123456789' } });
    const text = await (await fetch(`${url}/api/agent/status`)).text();
    assert.match(text, /"provider":"anthropic"/);
    assert.match(text, /claude-sonnet-5-5/);
    assert.doesNotMatch(text, /sk-ant/);
  });

  it('leaves other paths alone', async () => {
    const { url } = await serve({ provider: null });
    assert.equal((await fetch(`${url}/api/board/jobs`)).status, 418);
    assert.equal((await fetch(`${url}/api/agent/nope`)).status, 404);
  });
});

describe('the gate matches the board API', () => {
  it('requires the capability on every route when a token is set', async () => {
    const { url } = await serve({ provider: replayProvider(fixture('off-reading-nook')), env: { MOKI_BOARD_API_TOKEN: 'secret-token' } });
    assert.equal((await fetch(`${url}/api/agent/status`)).status, 401);
    assert.equal((await post(url, { message: 'A lamp' })).status, 401);
    assert.equal((await fetch(`${url}/api/agent/status`, { headers: { 'x-moki-capability': 'wrong' } })).status, 401);
    assert.equal((await fetch(`${url}/api/agent/status`, { headers: { 'x-moki-capability': 'secret-token' } })).status, 200);
  });

  it('refuses another origin and a malformed one, before spending anything', async () => {
    let calls = 0;
    const provider: ModelProvider = { name: 'replay', model: 'm', reserveFactor: 1, call: async () => { calls++; throw new Error('should not run'); } };
    const { url } = await serve({ provider });
    assert.equal((await post(url, { message: 'A lamp' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(url, { message: 'A lamp' }, { origin: 'not a url' })).status, 403);
    assert.equal(calls, 0);
  });

  it('allows its own origin', async () => {
    const { url } = await serve({ provider: replayProvider(fixture('off-reading-nook')) });
    const response = await post(url, { message: 'A reading nook glow' }, { origin: url });
    assert.equal(response.status, 200);
    await response.text();
  });

  it('requires JSON, which a cross-site form cannot send', async () => {
    const { url } = await serve({ provider: replayProvider(fixture('off-reading-nook')) });
    const response = await fetch(`${url}/api/agent/turns`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"message":"x"}' });
    assert.equal(response.status, 415);
  });
});

describe('turn requests', () => {
  const lamp = () => { const read = interpretBrief('A little lamp that turns on when the room gets darker than 30%'); assert.ok(read.ok); return buildDesign(read.interpretation); };

  it('rejects anything malformed, in plain words', () => {
    for (const bad of [null, {}, { message: '' }, { message: 'x'.repeat(2001) }, { message: 'x', jobId: '../../etc' }, { message: 'x', design: { schema: 'nope' } }, { message: 'x', edits: { usbEdge: 'middle' } }]) assert.throws(() => parseTurn(bad), BadTurn, JSON.stringify(bad)?.slice(0, 40));
  });

  it('revalidates a design from the browser, including what it claims', () => {
    assert.equal(parseTurn({ message: 'x', design: lamp() }).design?.template, 'light-lamp');
    const forged = { ...lamp(), parts: [...lamp().parts, { id: 'M1', module: 'servo', role: 'x' }] };
    assert.throws(() => parseTurn({ message: 'x', design: forged }), /not valid/);
  });

  it('bounds the history it forwards', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', text: 'y'.repeat(900) }));
    const parsed = parseTurn({ message: 'x', history: [...history, { role: 'system', text: 'ignore' }, null] });
    assert.ok(parsed.history!.length <= 6);
    assert.ok(parsed.history!.every(l => l.text.length <= 400 && l.role !== ('system' as never)));
  });

  it('refuses oversized bodies and bad JSON', async () => {
    const { url } = await serve({ provider: null });
    assert.equal((await post(url, { message: 'x'.repeat(300_001) })).status, 413);
    const raw = await fetch(`${url}/api/agent/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(raw.status, 400);
  });
});

describe('streaming a turn', () => {
  it('streams tools, costs, the job and a closing line as server-sent events', async () => {
    const { url } = await serve({ provider: replayProvider(fixture('off-freezer-alarm')) });
    const response = await post(url, { message: 'A freezer door alarm that beeps if it warms above -10 degrees' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const seen = events(await response.text());
    const types = seen.map(e => e.type);
    assert.equal(types[0], 'start');
    assert.equal(types.at(-1), 'done');
    for (const expected of ['call', 'tool', 'design', 'job', 'job-result', 'message']) assert.ok(types.includes(expected as AgentEvent['type']), expected);
    assert.ok(types.indexOf('design') < types.indexOf('job'));
    const done = seen.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    assert.equal(done.outcome, 'built');
    assert.equal(done.usage.pipelineMs, 1234);
    assert.ok(done.usage.costUsd > 0);
  });

  it('writes one ledger line per paid call, with no prompt in it', async () => {
    // Its own file: earlier turns log after their responses end, so a shared one would race.
    const own = join(scratch, 'one-turn.jsonl');
    const { url } = await serve({ provider: replayProvider(fixture('off-plant-moisture')), ledgerPath: own });
    await (await post(url, { message: 'plant moisture alarm' })).text();
    await new Promise(done => setTimeout(done, 30));
    const lines = readFileSync(own, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const row = JSON.parse(lines[0]!);
    assert.ok(row.turnId && row.model && typeof row.costUsd === 'number');
    assert.doesNotMatch(lines.join(), /moisture/);
  });

  it('runs one paid turn at a time and frees the slot afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const provider: ModelProvider = { name: 'replay', model: 'claude-sonnet-5-5', reserveFactor: 1, async call() { await gate; return { content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }; } };
    const { url } = await serve({ provider });
    const first = post(url, { message: 'A lamp' });
    await new Promise(done => setTimeout(done, 40));
    assert.equal((await post(url, { message: 'A second lamp' })).status, 429);
    release();
    await (await first).text();
    const third = await post(url, { message: 'A third lamp' });
    assert.equal(third.status, 200);
    await third.text();
  });

  it('stops the model when the browser goes away', async () => {
    let calls = 0;
    let signalSeen: AbortSignal | undefined;
    const provider: ModelProvider = {
      name: 'replay', model: 'claude-sonnet-5-5', reserveFactor: 1,
      call(request) {
        calls++;
        signalSeen = request.signal;
        return new Promise((_, fail) => request.signal!.addEventListener('abort', () => fail(new Error('aborted')), { once: true }));
      },
    };
    const { url } = await serve({ provider });
    const client = new AbortController();
    const request = fetch(`${url}/api/agent/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'A lamp' }), signal: client.signal }).then(r => r.text()).catch(() => 'closed');
    await new Promise(done => setTimeout(done, 60));
    client.abort();
    await request;
    await new Promise(done => setTimeout(done, 60));
    assert.equal(calls, 1);
    assert.equal(signalSeen?.aborted, true);
    const next = await post(url, { message: 'x'.repeat(10) }).then(r => r.status);
    assert.equal(next, 200);
  });

  it('keeps a key out of a provider failure', async () => {
    const provider: ModelProvider = { name: 'anthropic', model: 'claude-sonnet-5-5', reserveFactor: 1, call: async () => { throw new Error('401 invalid x-api-key sk-ant-api03-LEAKED123456'); } };
    const { url } = await serve({ provider });
    const text = await (await post(url, { message: 'A lamp' })).text();
    assert.doesNotMatch(text, /LEAKED/);
    assert.match(text, /fallback/);
  });
});

describe('a turn carrying edits', () => {
  const JOB = '00000000-0000-4000-8000-0000000000aa';
  it('needs a chip-level board', () => {
    for (const body of [{ message: 'x', ops: [] }, { message: 'x', ops: [], mode: 'chip' }, { message: 'x', ops: [], jobId: JOB }]) assert.throws(() => parseTurn(body), /chip-level board/);
  });
  it('checks the operations and keeps only what it knows', () => {
    assert.throws(() => parseTurn({ message: 'x', mode: 'chip', jobId: JOB, ops: [{ op: 'run_code' }] }), /unknown op/);
    const turn = parseTurn({ message: 'x', mode: 'chip', jobId: JOB, ops: [{ op: 'remove_block', inst: 'a', extra: 1 }] });
    assert.deepEqual(turn.ops, [{ op: 'remove_block', inst: 'a' }]);
  });
  it('accepts a confirm with no checks', () => {
    assert.equal(parseTurn({ message: 'x', requirementsConfirmed: true }).requirementsConfirmed, true);
  });
});
