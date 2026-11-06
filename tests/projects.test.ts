// Projects: the store, the API and its gate. No network and no model.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createProjectService, createProjectStore, statusOfJob, titleFromBrief, type ProjectRecord } from '../server/project-api.js';
import { createAgentService } from '../server/agent-api.js';
import { replayProvider } from '../src/agents/model.js';
import type { BoardClient } from '../src/agents/board-client.js';
import type { AgentJob } from '../src/agents/facts.js';
import { interpretBrief } from '../src/circuit/interpret.js';
import { buildDesign } from '../src/circuit/templates.js';

const roots: string[] = [];
const servers: Server[] = [];
after(async () => {
  for (const s of servers) { s.closeAllConnections(); s.close(); }
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});
const root = async () => { const dir = await mkdtemp(join(tmpdir(), 'moki-projects-')); roots.push(dir); return dir; };
const serve = async (options: Partial<Parameters<typeof createProjectService>[0]> = {}) => {
  const dir = options.root ?? await root();
  const service = createProjectService({ root: dir, env: {}, ...options });
  const server = createServer((req, res) => void service.handle(req, res, () => { res.writeHead(418); res.end(); }));
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/projects`;
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(url + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  return { dir, url, send, service, port };
};
const make = async (s: Awaited<ReturnType<typeof serve>>, brief = 'A focus timer with a knob') => ((await (await s.send('POST', '', { brief, effort: 'fast' })).json()) as { projectId: string }).projectId;
const session = { revisions: [], rejected: null };
const doneJob = { status: 'done', stages: [{ name: 'render', status: 'done', ms: 0 }], drc: { checked: true, errors: [], warnings: [] } };
const good = doneJob;

describe('titles from a brief', () => {
  for (const [brief, title] of [
    ['A 25 minute focus timer with a small screen and a knob', '25 minute focus timer'],
    ['A temperature monitor that beeps', 'Temperature monitor'],
    ['a reaction-time game', 'Reaction-time game'],
    ['Make me a desk humidity display. It should be small.', 'Desk humidity display'],
    ['I want to build a lamp - nothing fancy', 'Lamp'],
    ['please create an alarm\nwith a second line', 'Alarm'],
    ['Something for my desk that glows', 'Something for my desk'],
    ['Bot with a cat', 'Bot with a cat'],
    ['A very long descriptive name for a board nobody could ever summarise in one short line', 'Very long descriptive name for a board nobody…'],
    ['v1.2 board for 3.3 V sensors', 'V1.2 board for 3.3 V sensors'],
  ] as const) it(`"${brief.slice(0, 30)}"`, () => assert.equal(titleFromBrief(brief), title));
  it('is never empty and never long', () => {
    assert.ok(titleFromBrief('a').length > 0);
    assert.ok(titleFromBrief('x'.repeat(500)).length <= 49);
  });
});

describe('the project API', () => {
  it('creates a project, with its title, brief and effort', async () => {
    const s = await serve();
    const res = await s.send('POST', '', { brief: '  A desk humidity display  ', effort: 'deep' });
    assert.equal(res.status, 201);
    const { projectId } = await res.json() as { projectId: string };
    assert.match(projectId, /^[0-9a-f-]{36}$/);
    const project = await (await s.send('GET', `/${projectId}`)).json() as ProjectRecord;
    assert.equal(project.brief, 'A desk humidity display');
    assert.equal(project.title, 'Desk humidity display');
    assert.equal(project.effort, 'deep');
    assert.equal(project.status, 'new');
    assert.equal(project.state, null);
  });
  it('lists at most 20, newest first, without their chats', async () => {
    const s = await serve();
    let last = '';
    for (let i = 0; i < 22; i++) { last = await make(s, `Project ${i}`); await new Promise(r => setTimeout(r, 2)); }
    const { projects } = await (await s.send('GET', '')).json() as { projects: ProjectRecord[] };
    assert.equal(projects.length, 20);
    assert.equal(projects[0]!.id, last);
    assert.equal('state' in projects[0]!, false);
  });
  it('renames, and refuses a blank or long title', async () => {
    const s = await serve();
    const id = await make(s);
    assert.equal((await s.send('PATCH', `/${id}`, { title: '  My   timer\n' })).status, 200);
    const project = await (await s.send('GET', `/${id}`)).json() as ProjectRecord;
    assert.equal(project.title, 'My timer');
    assert.equal(project.titleEdited, true);
    assert.equal((await s.send('PATCH', `/${id}`, { title: '   ' })).status, 400);
    assert.equal((await s.send('PATCH', `/${id}`, { title: 'x'.repeat(81) })).status, 400);
    assert.equal((await s.send('PATCH', `/${id}`, { title: 7 })).status, 400);
  });
  it('saves a chat, survives a restart, and records builds it sees', async () => {
    const s = await serve();
    const id = await make(s);
    const job = '22222222-2222-4222-8222-222222222222';
    const turns = [{ id: 't', kind: 'run', label: 'First', job: { jobId: job, status: 'running' } }];
    assert.equal((await s.send('PATCH', `/${id}`, { state: { turns, session, canvasJobId: job } })).status, 200);
    await s.service.store.settled();
    const again = createProjectStore(s.dir).get(id)!;
    assert.deepEqual(again.state?.turns, turns);
    assert.equal(again.state?.canvasJobId, job);
    assert.deepEqual(again.jobs.map(j => j.jobId), [job]);
    assert.equal(again.jobs[0]!.label, 'First');
    assert.equal(again.status, 'building');
  });
  it('moves a building project on when a saved chat shows how the build ended', async () => {
    const s = await serve();
    const id = await make(s);
    const save = (job: unknown) => s.send('PATCH', `/${id}`, { state: { turns: [{ id: 't', kind: 'run', label: null, job }], session, canvasJobId: null } });
    const status = async () => ((await (await s.send('GET', `/${id}`)).json()) as ProjectRecord).status;
    const good = { jobId: '22222222-2222-4222-8222-222222222222', ...doneJob };
    await save({ jobId: '22222222-2222-4222-8222-222222222222', status: 'running' });
    assert.equal(await status(), 'building');
    await save(good);
    assert.equal(await status(), 'built');
    await save({ jobId: '33333333-3333-4333-8333-333333333333', status: 'done', stages: [{ name: 'render', status: 'done', ms: 0 }], drc: { checked: true, errors: [{ type: 'x', message: 'y' }], warnings: [] } });
    assert.equal(await status(), 'failed');
  });
  it('lets no save overrule an agent\'s verdict, however late it arrives', async () => {
    const s = await serve();
    const id = await make(s);
    const save = (job: unknown) => s.send('PATCH', `/${id}`, { state: { turns: [{ id: 't', kind: 'run', label: null, job }], session, canvasJobId: null } });
    const status = async () => ((await (await s.send('GET', `/${id}`)).json()) as ProjectRecord).status;
    const job = '22222222-2222-4222-8222-222222222222';
    await s.service.store.noteJob(id, job, null);
    await s.service.store.noteOutcome(id, 'build-failed');
    await save({ jobId: job, status: 'running' });
    assert.equal(await status(), 'failed');
    await save({ jobId: job, ...good });
    assert.equal(await status(), 'failed');
    await s.service.store.noteJob(id, '33333333-3333-4333-8333-333333333333', null);
    await save({ jobId: '33333333-3333-4333-8333-333333333333', status: 'running' });
    assert.equal(await status(), 'building');
  });
  it('judges a build with the agent\'s own test, so a failed compile or case isn\'t built', () => {
    const with_ = (stages: unknown[]) => ({ status: 'done', drc: { checked: true, errors: [], warnings: [] }, stages } as never);
    assert.equal(statusOfJob(with_([{ name: 'render', status: 'done' }, { name: 'firmware-compile', status: 'failed' }]), 'building', false), 'failed');
    assert.equal(statusOfJob(with_([{ name: 'render', status: 'done' }, { name: 'enclosure', status: 'failed' }]), 'building', false), 'failed');
    assert.equal(statusOfJob({ status: 'done', stages: [], drc: { checked: false, errors: [], warnings: [] } } as never, 'building', false), 'failed');
    assert.equal(statusOfJob(with_([{ name: 'render', status: 'done' }]), 'building', false), 'built');
    assert.equal(statusOfJob(with_([{ name: 'render', status: 'done' }]), 'building', true), 'unverified');
  });
  it('stops a stale tab overwriting newer work', async () => {
    const s = await serve();
    const id = await make(s);
    const save = (text: string, baseRev: number) => s.send('PATCH', `/${id}`, { state: { turns: [{ id: 't', kind: 'brief', text }], session, canvasJobId: null }, baseRev });
    const first = await save('tab one', 0);
    assert.equal(((await first.json()) as { stateRev: number }).stateRev, 1);
    assert.equal((await save('stale tab', 0)).status, 409);
    const project = await (await s.send('GET', `/${id}`)).json() as ProjectRecord;
    assert.deepEqual((project.state!.turns[0] as { text: string }).text, 'tab one');
    assert.equal((await save('tab one again', 1)).status, 200);
    assert.equal((await s.send('PATCH', `/${id}`, { state: { turns: [], session, canvasJobId: null }, baseRev: -1 })).status, 400);
  });
  it('won\'t call a build done when the agent never gave its requirements a final check', async () => {
    const s = await serve();
    const id = await make(s);
    const withChecks = { revisions: [{ design: { requirements: [{ id: 'a' }] } }], rejected: null };
    const save = (job: object) => s.send('PATCH', `/${id}`, { state: { turns: [{ id: 't', kind: 'run', label: null, job: { jobId: '22222222-2222-4222-8222-222222222222', ...job } }], session: withChecks, canvasJobId: null } });
    await save({ status: 'running' });
    await save(doneJob);
    assert.equal(((await (await s.send('GET', `/${id}`)).json()) as ProjectRecord).status, 'unverified');
  });
  it('tells a list the newest build', async () => {
    const s = await serve();
    const id = await make(s);
    assert.equal(((await (await s.send('GET', '')).json()) as { projects: { lastJobId: unknown }[] }).projects[0]!.lastJobId, null);
    await s.service.store.noteJob(id, '22222222-2222-4222-8222-222222222222', null);
    assert.equal(((await (await s.send('GET', '')).json()) as { projects: { lastJobId: unknown }[] }).projects[0]!.lastJobId, '22222222-2222-4222-8222-222222222222');
  });
  it('writes saves in order, so the newest always wins', async () => {
    const s = await serve();
    const id = await make(s);
    await Promise.all(Array.from({ length: 12 }, (_, i) => s.send('PATCH', `/${id}`, { state: { turns: [{ id: String(i), kind: 'brief', text: 'x'.repeat(1000) }], session, canvasJobId: null } })));
    await s.service.store.settled();
    const memory = s.service.store.get(id)!;
    assert.deepEqual(createProjectStore(s.dir).get(id)!.state, memory.state);
    assert.deepEqual((await readdir(join(s.dir, id))).filter(f => f.endsWith('.tmp')), []);
  });
  for (const [name, body] of [
    ['no brief', { effort: 'fast' }],
    ['a blank brief', { brief: '   ' }],
    ['too long a brief', { brief: 'x'.repeat(601) }],
    ['a brief that is not text', { brief: 7 }],
    ['an unknown effort', { brief: 'x', effort: 'max' }],
    ['an unknown field', { brief: 'x', id: '../../etc' }],
  ] as const) it(`refuses to create with ${name}`, async () => assert.equal((await (await serve()).send('POST', '', body)).status, 400));
  it('refuses bad saves', async () => {
    const s = await serve();
    const id = await make(s);
    for (const body of [{}, { state: {} }, { state: { turns: 'x', session } }, { state: { turns: [], session: 'x' } }, { state: { turns: [], session, canvasJobId: '../x' } }, { state: { turns: [], session, extra: 1 } }, { status: 'built' }, { jobs: [] }, { brief: 'changed' }]) assert.equal((await s.send('PATCH', `/${id}`, body)).status, 400, JSON.stringify(body));
    assert.equal((await s.send('PATCH', `/${id}`, 'not json')).status, 400);
    assert.equal((await s.send('PATCH', `/${id}`, { state: { turns: ['x'.repeat(2_000_001)], session } })).status, 413);
  });
  it('answers 404 for unknown ids and path tricks, and touches no file', async () => {
    const s = await serve();
    for (const path of ['/33333333-3333-4333-8333-333333333333', '/not-a-uuid', '/..%2f..%2fetc', '/33333333-3333-4333-8333-333333333333/title']) assert.equal((await s.send('GET', path)).status, 404, path);
    assert.equal((await s.send('PATCH', '/33333333-3333-4333-8333-333333333333', { title: 'x' })).status, 404);
    assert.deepEqual(await readdir(s.dir), []);
  });
  it('allows only the methods in the brief', async () => {
    const s = await serve();
    const id = await make(s);
    assert.equal((await s.send('DELETE', `/${id}`)).status, 405);
    assert.equal((await s.send('PUT', `/${id}`, {})).status, 405);
    assert.equal((await s.send('DELETE', '')).status, 405);
    assert.equal((await s.send('PATCH', '', {})).status, 405);
    assert.ok(s.service.store.get(id));
  });
  it('has the same gate as the board and agent APIs', async () => {
    const s = await serve({ env: { MOKI_BOARD_API_TOKEN: 'secret' } });
    assert.equal((await s.send('GET', '')).status, 401);
    assert.equal((await s.send('POST', '', { brief: 'x' }, { 'x-moki-capability': 'wrong' })).status, 401);
    assert.equal((await s.send('GET', '', undefined, { 'x-moki-capability': 'secret' })).status, 200);
    const open = await serve();
    assert.equal((await open.send('POST', '', { brief: 'x' }, { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await open.send('POST', '', { brief: 'x' }, { origin: 'null' })).status, 403);
    assert.equal((await open.send('POST', '', { brief: 'x' }, { 'content-type': 'text/plain' })).status, 415);
    assert.deepEqual(await readdir(open.dir), []);
  });
  it('steps aside for the older workshop on the dev server, and never on the live link', async () => {
    const dev = await serve({ shared: true });
    assert.equal((await dev.send('GET', '')).status, 418);
    assert.equal((await dev.send('POST', '', { brief: 'x' })).status, 418);
    assert.equal((await dev.send('GET', '', undefined, { 'x-moki-projects': '1' })).status, 200);
    assert.equal((await (await serve()).send('GET', '')).status, 200);
  });
  it('ignores a torn file when it starts', async () => {
    const dir = await root();
    await mkdir(join(dir, '44444444-4444-4444-8444-444444444444'));
    await writeFile(join(dir, '44444444-4444-4444-8444-444444444444', 'project.json'), '{"torn');
    await mkdir(join(dir, 'not-a-project'));
    assert.deepEqual(createProjectStore(dir).recent(), []);
  });
  it('writes owner-only files', async () => {
    const s = await serve();
    const id = await make(s);
    assert.ok((await readFile(join(s.dir, id, 'project.json'), 'utf8')).includes(id));
  });
});

describe('agent turns add to their project', () => {
  const read = interpretBrief('A 25 minute focus timer with a small screen and a knob');
  assert.ok(read.ok);
  const timer = buildDesign(read.interpretation);
  it('records the build and outcome on the server, even with nobody reading', async () => {
    const dir = await root();
    const store = createProjectStore(dir);
    const project = await store.create('A timer', 'balanced');
    const job = '55555555-5555-4555-8555-555555555555';
    const board = { create: async () => ({ jobId: job }), get: async () => ({ jobId: job, status: 'done', totalMs: 1, cache: 'miss', createdAt: '', toolVersions: {}, drc: { checked: true, errors: [], warnings: [] }, stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'done', ms: 0 }], artifacts: {}, input: { kind: 'design', sourceSha256: 'x' } }) as unknown as AgentJob, artifact: async () => null } as unknown as BoardClient;
    const provider = replayProvider({ id: 'p', provenance: 'authored', calls: [{ content: [{ type: 'tool_use', id: 'a', name: 'propose_design', input: { design: timer, summary: 'A timer.' } }], stopReason: 'tool_use' }] });
    const service = createAgentService({ env: {}, provider, board, projects: store, ledgerPath: join(dir, 'ledger.jsonl'), pollMs: 1 });
    const server = createServer((req, res) => void service.handle(req, res, () => { res.writeHead(404); res.end(); }));
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/agent/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'A timer', projectId: project.id }) });
    assert.match(await res.text(), /event: done/);
    await store.settled();
    assert.deepEqual(store.get(project.id)!.jobs.map(j => j.jobId), [job]);
    assert.equal(store.get(project.id)!.status, 'built');
  });
});
