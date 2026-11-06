// What a card says and shows, from a project and its builds. Pure, with no server.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardJob } from '../board/types';
import { arrange, briefText, cardStatus, factsOf, jobsToAsk, lastLine, pictureOf, repeatTags } from './gallery';
import { drawingLayout } from './galleryDrawingLayout';
import type { ProjectSummary } from './projectsApi';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const base: ProjectSummary = { id: 'p1', title: 'Desk humidity display', brief: 'A desk humidity display', effort: 'balanced', createdAt: '2026-11-06T00:33:00.000Z', updatedAt: '2026-11-06T00:36:00.000Z', status: 'built', hasRequirements: true, jobIds: [], lastJobId: null, card: { note: null, costUsd: null, parts: null, controller: null, sheet: null } };
const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({ ...base, ...over });
const done = (over: Partial<BoardJob> = {}): BoardJob => ({ jobId: A, status: 'done', stages: [{ name: 'render', status: 'done', ms: 1 }, { name: 'firmware-compile', status: 'done', ms: 1 }], totalMs: 18_151, drc: { errors: [], warnings: [], checked: true }, board: { widthMm: 90, heightMm: 120, layers: 2, traceCount: 18, viaCount: 7 }, ...over } as BoardJob);

describe('the brief on a card', () => {
  it('strips a paste\'s gutters and hard wraps', () => {
    const brief = 'A reaction-time game: an LED lights up after a random\n  ▎ delay, I press the knob.';
    assert.equal(briefText({ title: 'Reaction-time game', brief }), 'An LED lights up after a random delay, I press the knob.');
  });
  it('says nothing when the brief only repeats the title', () => {
    assert.equal(briefText({ title: 'RP2040 motor controller', brief: 'Design an RP2040 motor controller' }), '');
    assert.equal(briefText({ title: 'Desk humidity display', brief: 'A desk humidity display' }), '');
  });
  it('keeps a brief that says more', () => {
    assert.equal(briefText({ title: 'Focus timer', brief: 'A focus timer with a screen.' }), 'A focus timer with a screen.');
  });
});

describe('repeated titles', () => {
  it('tags only the ones that repeat, each with when it began', () => {
    const tags = repeatTags([project({ id: 'a', title: 'RP2040 motor controller', createdAt: '2026-11-06T00:48:30.000Z' }), project({ id: 'b', title: 'rp2040 motor controller ', createdAt: '2026-11-06T01:30:17.000Z' }), project({ id: 'c' })]);
    assert.equal(tags.size, 2);
    assert.ok(!tags.has('c'));
    assert.notEqual(tags.get('a'), tags.get('b'));
  });
});

describe('status in plain words', () => {
  const says = (over: Partial<ProjectSummary>, jobs = {}) => cardStatus(project(over), jobs).label;
  it('names each state, and never the old wording', () => {
    assert.equal(says({ status: 'built' }), 'Built');
    assert.equal(says({ status: 'new' }), 'Draft');
    assert.equal(says({ status: 'failed' }), "Didn't build");
    assert.equal(says({ status: 'stopped' }), 'Stopped');
    assert.equal(says({ status: 'waiting' }), 'Needs your answer');
  });
  it('calls a refusal what it is, even though the project never moved on from new', () => {
    assert.equal(says({ status: 'new', card: { ...base.card!, note: { kind: 'decline', text: 'No RP2040 here.' } } }), "Didn't build");
  });
  it('tells a dropped turn from an open question', () => {
    assert.equal(says({ status: 'waiting', card: { ...base.card!, note: { kind: 'stopped', text: 'This turn stopped when the page closed.' } } }), 'Stopped');
    assert.equal(says({ status: 'waiting', card: { ...base.card!, note: { kind: 'ask', text: 'Does that sound right?' } } }), 'Needs your answer');
  });
  it('asks the build how it ended when the project still says building', () => {
    const over = { status: 'building' as const, jobIds: [A], hasRequirements: false };
    assert.equal(says(over, { [A]: done() }), 'Built');
    assert.equal(says({ ...over, hasRequirements: true }, { [A]: done() }), 'Built');
    assert.equal(cardStatus(project({ ...over, hasRequirements: true }), { [A]: done() }).unchecked, true);
    assert.equal(says(over, { [A]: done({ status: 'failed', error: 'no' }) }), "Didn't build");
    assert.equal(says(over, { [A]: done({ status: 'running' }) }), 'Building');
  });
});

describe('the picture', () => {
  it('shows the newest build that worked, and says so when that is not the newest', () => {
    const p = project({ jobIds: [A, B] });
    assert.equal(pictureOf(p, {}).kind, 'pending');
    assert.deepEqual(pictureOf(p, { [A]: done() }), { kind: 'photo', jobId: A, job: done(), earlier: false });
    const earlier = pictureOf(p, { [A]: done({ status: 'failed' }), [B]: done({ jobId: B }) });
    assert.ok(earlier.kind === 'photo' && earlier.jobId === B && earlier.earlier);
  });
  it('falls back to the real schematic, and only then to a blank sheet, never another project\'s image', () => {
    const sheet = { title: 'x', parts: [], nets: [] };
    assert.equal(pictureOf(project({ jobIds: [A], card: { ...base.card!, sheet } }), { [A]: done({ status: 'failed' }) }).kind, 'drawing');
    assert.equal(pictureOf(project({ jobIds: [A], card: { ...base.card!, sheet } }), { [A]: done() }, new Set([A])).kind, 'drawing');
    assert.equal(pictureOf(project({ jobIds: [A] }), { [A]: null }).kind, 'blank');
    assert.equal(pictureOf(project(), {}).kind, 'blank');
  });
  it('asks about a build until it has finished, and goes back only as far as one that worked', () => {
    const p = project({ jobIds: [A, B] });
    assert.deepEqual(jobsToAsk(p, {}), [A]);
    assert.deepEqual(jobsToAsk(p, { [A]: done({ status: 'running' }) }), [A, B]);
    assert.deepEqual(jobsToAsk(p, { [A]: done({ status: 'failed' }) }), [B]);
    assert.deepEqual(jobsToAsk(p, { [A]: done() }), []);
  });
});

describe('facts', () => {
  const card = { note: null, costUsd: 0.1114, parts: 7, controller: 'ESP32-DevKitC V4', sheet: null };
  it('come from the build and the chat', () => {
    const facts = factsOf(project({ card }), { kind: 'photo', jobId: A, job: done(), earlier: false });
    assert.deepEqual(facts.map(f => [f.label, f.value]), [['Board', '90 × 120 mm, 2 layers'], ['Parts', '7, on ESP32-DevKitC V4'], ['Firmware', 'Compiled ✓'], ['Build', '18 s'], ['Agent cost', '$0.11']]);
  });
  it('leave out what wasn\'t recorded', () => {
    const job = { jobId: A, status: 'done', stages: [] } as unknown as BoardJob;
    assert.deepEqual(factsOf(project(), { kind: 'photo', jobId: A, job, earlier: false }), []);
    assert.deepEqual(factsOf(project({ card }), { kind: 'blank' }), []);
  });
  it('say so when the brief hasn\'t been checked against this build', () => {
    const picture = { kind: 'photo' as const, jobId: A, job: done(), earlier: false };
    assert.ok(factsOf(project({ card }), picture, true).some(f => f.value === 'Not checked on this build yet'));
    assert.ok(!factsOf(project({ card }), picture).some(f => f.label === 'Your brief'));
  });
  it('don\'t pin the latest design\'s part count on an older build', () => {
    const facts = factsOf(project({ card }), { kind: 'photo', jobId: B, job: done({ jobId: B }), earlier: true });
    assert.ok(!facts.some(f => f.label === 'Parts'));
  });
  it('count blocks on a chip board, and don\'t claim firmware that was never compiled', () => {
    const job = done({ noFirmware: true, input: { kind: 'plan', plan: { blocks: [{}, {}, {}] } } as never });
    const facts = factsOf(project(), { kind: 'photo', jobId: A, job, earlier: false });
    assert.ok(facts.some(f => f.short === '3 blocks'));
    assert.ok(!facts.some(f => f.label === 'Firmware'));
  });
});

describe('the agent\'s last line', () => {
  const said = (text: string) => lastLine(project({ card: { ...base.card!, note: { kind: 'stopped', text } } }));
  it('is one sentence, however much the agent said', () => {
    assert.equal(said('This turn stopped when the page closed. A build already queued keeps going.'), 'This turn stopped when the page closed.');
    assert.equal(said("I'll build a motor controller based on the RP2040. Does that sound right?"), "I'll build a motor controller based on the RP2040.");
  });
  it('stops at a semicolon, which is where a refusal starts explaining itself', () => {
    assert.equal(said("The RP2040 and motor-driver hardware aren't available here; chip-level mode will cover those parts. The closest thing is an ESP32."), "The RP2040 and motor-driver hardware aren't available here.");
  });
  it('is nothing when the agent said nothing', () => {
    assert.equal(lastLine(project()), '');
  });
});

describe('the layout', () => {
  it('leads with the newest project that has a build to look at', () => {
    const none = project({ id: 'none' });
    const built = project({ id: 'built', jobIds: [A] });
    const { lead, rest } = arrange([none, built], { [A]: done() });
    assert.equal(lead?.id, 'built');
    assert.deepEqual(rest.map(p => p.id), ['none']);
  });
  it('has no lead when nothing has been built, and drops one whose picture broke', () => {
    assert.equal(arrange([project()], {}).lead, null);
    assert.equal(arrange([project({ jobIds: [A] })], { [A]: done() }, new Set([A])).lead, null);
  });
});

describe('the drawing on a card', () => {
  const part = (id: string, module: string) => ({ id, module });
  it('lays out from just the parts and nets a summary carries', () => {
    const layout = drawingLayout({ title: 'Desk', parts: [part('U1', 'esp32-devkitc-v4'), part('U2', 'bme280-i2c-4pin')], nets: [{ id: 'gnd', name: 'GND', kind: 'ground', endpoints: [{ part: 'U1', pin: 'GND' }, { part: 'U2', pin: 'GND' }] }] });
    assert.deepEqual(layout?.parts.map(p => p.ref).sort(), ['U1', 'U2']);
  });
  it('gives up quietly on a design it can\'t read', () => {
    assert.equal(drawingLayout({ title: 'Odd', parts: [{}], nets: [{ endpoints: 'nope' }] } as never), null);
  });
});
