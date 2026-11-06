// Where the app is, and what a reopened project restores. Pure, with no server.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSaver, missingRuns, settledStatus, timeAgo, type ProjectState } from './projectsApi';
import { isProjectId, parseRoute } from './routes';

describe('routes', () => {
  const id = '66666666-6666-4666-8666-666666666666';
  it('finds the landing, a project and the rest, on either mount point', () => {
    for (const base of ['/', '/app/moki/']) {
      const at = (path: string) => (base === '/' ? path : base.slice(0, -1) + path);
      assert.deepEqual(parseRoute(at('/'), '', base), { kind: 'landing' });
      assert.deepEqual(parseRoute(at(`/studio/${id}`), '', base), { kind: 'project', projectId: id });
      assert.deepEqual(parseRoute(at('/studio'), '', base), { kind: 'landing' });
      assert.deepEqual(parseRoute(at('/studio/'), '', base), { kind: 'landing' });
      assert.deepEqual(parseRoute(at('/lab'), '', base), { kind: 'lab' });
    }
    assert.deepEqual(parseRoute('/app/moki', '', '/app/moki/'), { kind: 'landing' });
  });
  it('keeps mock pages and shared build links working, without a project', () => {
    assert.deepEqual(parseRoute('/studio', '?mock=board', '/'), { kind: 'studio' });
    assert.deepEqual(parseRoute('/studio', `?job=${id}`, '/'), { kind: 'studio' });
  });
  it('leaves /workshop alone', () => {
    assert.deepEqual(parseRoute('/workshop', '', '/'), { kind: 'workshop' });
    assert.deepEqual(parseRoute(`/workshop/${id}`, '', '/'), { kind: 'workshop' });
  });
  it('sends a malformed id to the same not-found page', () => {
    assert.deepEqual(parseRoute('/studio/nope', '', '/'), { kind: 'project', projectId: 'nope' });
    assert.equal(isProjectId('nope'), false);
  });
});

describe('restoring a project', () => {
  const job = (jobId: string) => ({ jobId, status: 'done' });
  it('adds builds the saved chat missed, and only those', () => {
    const turns = [{ id: 'a', kind: 'run', label: null, job: job('saved') }] as never[];
    const runs = missingRuns(turns, [{ jobId: 'saved', label: null, at: '' }, { jobId: 'later', label: 'Fix 1', at: '' }]);
    assert.equal(runs.length, 1);
    assert.equal((runs[0] as { jobId?: string }).jobId, 'later');
    assert.equal(runs[0]!.label, 'Fix 1');
  });
  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    assert.equal(timeAgo('2026-11-05T11:59:30Z', now), 'Just now');
    assert.equal(timeAgo('2026-11-05T11:30:00Z', now), '30 min ago');
    assert.equal(timeAgo('2026-11-05T09:00:00Z', now), '3 h ago');
    assert.equal(timeAgo('2026-11-03T12:00:00Z', now), '2 d ago');
    assert.equal(timeAgo('nonsense', now), '');
  });
});

describe('a list of projects', () => {
  it('asks how a build really ended, since the tab may have closed', () => {
    const ok = { status: 'done', stages: [{ name: 'render', status: 'done', ms: 0 }], drc: { checked: true, errors: [], warnings: [] } } as never;
    assert.equal(settledStatus('building', ok), 'built');
    assert.equal(settledStatus('building', ok, true), 'unverified');
    assert.equal(settledStatus('building', { ...(ok as object), drc: { checked: true, errors: [{ type: 'x', message: 'y' }], warnings: [] } } as never), 'failed');
    assert.equal(settledStatus('building', { ...(ok as object), stages: [{ name: 'render', status: 'done', ms: 0 }, { name: 'firmware-compile', status: 'failed', ms: 0 }] } as never), 'failed');
    assert.equal(settledStatus('building', { status: 'failed' } as never), 'failed');
    assert.equal(settledStatus('building', { status: 'running' } as never), 'building');
    assert.equal(settledStatus('building', null), 'building');
    assert.equal(settledStatus('unverified', ok), 'unverified');
  });
});

describe('saving a project', () => {
  const state = (text: string) => ({ turns: [{ id: 't', kind: 'brief', text }], session: { revisions: [], rejected: null }, canvasJobId: null }) as unknown as ProjectState;
  it('sends the revision it last saw, and moves on with the answer', async () => {
    const bodies: { baseRev: number }[] = [];
    const send = (async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json({ stateRev: bodies.length + 4 }); }) as unknown as typeof fetch;
    const results: string[] = [];
    const saver = createSaver('p', 4, r => results.push(r), 0, send);
    saver.queue(state('a'), { now: true });
    await new Promise(r => setTimeout(r, 5));
    saver.queue(state('b'), { now: true });
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(bodies.map(b => b.baseRev), [4, 5]);
    assert.deepEqual(results, ['saved', 'saved']);
  });
  it('stops for good when another tab saved first', async () => {
    let calls = 0;
    const send = (async () => { calls++; return new Response('{}', { status: 409 }); }) as unknown as typeof fetch;
    const results: string[] = [];
    const saver = createSaver('p', 0, r => results.push(r), 0, send);
    saver.queue(state('a'), { now: true });
    await new Promise(r => setTimeout(r, 5));
    saver.queue(state('b'), { now: true });
    saver.leave();
    await new Promise(r => setTimeout(r, 5));
    assert.equal(calls, 1);
    assert.deepEqual(results, ['conflict']);
  });
  it('says so when a save can\'t reach the server, and tries again with the next change', async () => {
    let calls = 0;
    const send = (async () => { calls++; if (calls === 1) throw new Error('offline'); return Response.json({ stateRev: 1 }); }) as unknown as typeof fetch;
    const results: string[] = [];
    const saver = createSaver('p', 0, r => results.push(r), 0, send);
    saver.queue(state('a'), { now: true });
    await new Promise(r => setTimeout(r, 5));
    saver.queue(state('b'), { now: true });
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(results, ['retrying', 'saved']);
  });
  it('keeps trying by itself while the server restarts, and saves the newest state when it is back', async () => {
    const bodies: { state: { turns: { text: string }[] } }[] = [];
    let down = 3;
    const send = (async (_url: string, init: RequestInit) => {
      if (down-- > 0) { if (down === 1) return new Response('bad gateway', { status: 502 }); throw new Error('connection refused'); }
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ stateRev: 9 });
    }) as unknown as typeof fetch;
    const results: string[] = [];
    const saver = createSaver('p', 8, r => results.push(r), 0, send, 1);
    saver.queue(state('a'), { now: true });
    await new Promise(r => setTimeout(r, 2));
    saver.queue(state('newer'));
    await new Promise(r => setTimeout(r, 60));
    assert.deepEqual(results, ['retrying', 'retrying', 'retrying', 'saved']);
    assert.deepEqual(bodies.map(b => b.state.turns[0]!.text), ['newer']);
  });
  it('does not retry a refusal, which would only be refused again', async () => {
    let calls = 0;
    const send = (async () => { calls++; return new Response('{}', { status: 400 }); }) as unknown as typeof fetch;
    const results: string[] = [];
    const saver = createSaver('p', 0, r => results.push(r), 0, send, 1);
    saver.queue(state('a'), { now: true });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls, 1);
    assert.deepEqual(results, ['failed']);
  });
});
