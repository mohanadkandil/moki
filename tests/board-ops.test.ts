// The schematic edit API, through a real board service. Workers are stubbed, so nothing is routed or compiled here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createBoardService } from '../server/board-api.js';
import { checkOps, libraryListing } from '../server/board-ops.js';
import { sheetGraph } from '../src/agents/chip-library.js';
import type { BoardPlan } from '../src/blocks/contract.js';
import { planGraph } from '../src/blocks/graph.js';
import { checkPlan, listBlocks, resolvePlanBlocks } from '../src/blocks/library.js';
import { recordSchematicReview, schematicHash } from '../src/blocks/review.js';
import { generateBoardSource } from '../src/board/codegen.js';
import { contentId } from '../src/circuit/graph.js';
import { EXAMPLE_BRIEFS, interpretBrief } from '../src/circuit/interpret.js';
import { buildDesign } from '../src/circuit/templates.js';
import type { CircuitDesign } from '../src/circuit/model.js';

const fixture = resolve('docs/engineering/2026-11-04-realism/review/evidence/copper/temp-monitor');
const spike = async () => JSON.parse(await readFile('src/blocks/data/spike-plan.json', 'utf8')) as BoardPlan;
const SHT40 = 'sht40-ad1b-3v3';
const wireSensor = [
  { op: 'add_block', inst: 'air', block: SHT40 },
  { op: 'link', from: 'esp32-s3-core.GND', to: 'air.GND' },
  { op: 'link', from: 'esp32-s3-core.V3V3', to: 'air.V3V3' },
  { op: 'link', from: 'esp32-s3-core.I2C', to: 'air.I2C' },
];

describe('the job API with edits', () => {
  let root: string, jobsRoot: string, url: string, design: CircuitDesign, plan: BoardPlan;
  let designJob: string, planJob: string, sourceJob: string;
  let service: ReturnType<typeof createBoardService>, server: ReturnType<typeof createServer>;
  const previous = process.env.MOKI_SCHEMATIC_REVIEWS_DIR;
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) });
  const jobs = async () => (await readdir(jobsRoot)).filter(name => /^[0-9a-f-]{36}$/.test(name)).length;
  const record = async (id: string) => JSON.parse(await readFile(join(jobsRoot, id, 'job.json'), 'utf8'));

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'moki-ops-')); jobsRoot = join(root, 'jobs');
    process.env.MOKI_SCHEMATIC_REVIEWS_DIR = join(root, 'reviews');
    design = JSON.parse(await readFile(join(fixture, 'design.json'), 'utf8'));
    plan = await spike();
    const write = async (input: Record<string, unknown>, files: Record<string, string>) => {
      const id = randomUUID(), dir = join(jobsRoot, id);
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
      await writeFile(join(dir, 'job.json'), JSON.stringify({ jobId: id, status: 'done', createdAt: new Date().toISOString(), input, cache: 'miss', stages: [], totalMs: 1, drc: { checked: true, errors: [], warnings: [] }, board: { widthMm: 90, heightMm: 75, layers: 2, traceCount: 0, viaCount: 0 }, artifacts: {}, toolVersions: {} }));
      return id;
    };
    const source = generateBoardSource(design);
    designJob = await write({ kind: 'design', designContentId: contentId(design), sourceSha256: 'x' }, {
      'design.json': JSON.stringify(design), 'board.tsx': source,
      'circuit.json': await readFile(join(fixture, 'circuit.json'), 'utf8'), 'board-metadata.json': await readFile(join(fixture, 'board-metadata.json'), 'utf8'),
    });
    planJob = await write({ kind: 'plan', plan, sourceSha256: 'x' }, { 'plan.json': JSON.stringify(plan) });
    sourceJob = await write({ kind: 'source', sourceSha256: 'x' }, { 'board.tsx': source });
    const bun = join(root, 'bun');
    await writeFile(bun, '#!/usr/bin/env node\nif(process.argv.some(x=>x.endsWith("versions.ts"))) console.log("{}"); else process.exitCode=1;\n', { mode: 0o755 });
    service = createBoardService({ jobsRoot, bun });
    server = createServer((req, res) => { void service.handle(req, res, () => { res.writeHead(404); res.end(); }); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const at = server.address() as { port: number };
    url = `http://127.0.0.1:${at.port}`;
  });
  after(async () => {
    await service.idle(); await service.close(); server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    if (previous === undefined) delete process.env.MOKI_SCHEMATIC_REVIEWS_DIR; else process.env.MOKI_SCHEMATIC_REVIEWS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  it('queues one rebuild for a valid batch, and records what it did', async () => {
    const net = design.nets.find(n => n.kind === 'signal')!;
    const ops = [{ op: 'rename_net', net: net.name, name: 'SENSE' }, { op: 'add_note', text: 'Keep the probe lead short.' }];
    const res = await post('/api/board/jobs', { baseJobId: designJob, ops });
    assert.equal(res.status, 202);
    const { jobId } = await res.json() as { jobId: string };
    const job = await record(jobId);
    assert.equal(job.input.baseJobId, designJob);
    assert.deepEqual(job.input.ops, ops);
    assert.ok(job.editSummary.length > 0, 'the summary says what changed');
    const saved = JSON.parse(await readFile(join(jobsRoot, jobId, 'design.json'), 'utf8')) as CircuitDesign;
    assert.equal(saved.nets.find(n => n.id === net.id)!.name, 'SENSE');
    assert.equal(job.input.designContentId, contentId(saved));
  });
  it('lays out afresh a board nobody moved, and keeps a layout someone chose', async () => {
    const op = [{ op: 'add_note', text: 'Laid out afresh.' }];
    const fresh = await record((await (await post('/api/board/jobs', { baseJobId: designJob, ops: op })).json() as { jobId: string }).jobId);
    assert.equal(fresh.input.layoutSha256, undefined);
    assert.equal(fresh.input.baseJobId, designJob, 'still follows from its base');
    const moved = await (await post('/api/board/jobs', { baseJobId: designJob, edits: { placements: [{ refdes: 'U2', x: 19.85, y: 27.9, rotation: 0 }] } })).json() as { jobId: string };
    const kept = await record((await (await post('/api/board/jobs', { baseJobId: moved.jobId, ops: op })).json() as { jobId: string }).jobId);
    assert.ok(kept.input.layoutSha256, 'a moved board keeps its layout');
  });
  it('explains in one sentence why a part the firmware needs can\'t go', () => {
    // Real template designs: at least one has a display its firmware draws on.
    const reasons = EXAMPLE_BRIEFS.flatMap(example => {
      const read = interpretBrief(example.brief);
      if (!read.ok) return [];
      const built = buildDesign(read.interpretation);
      return built.parts.filter(p => /ssd1306/.test(p.module)).map(p => ({ id: p.id, out: checkOps({ kind: 'design', design: built }, [{ op: 'remove_part', id: p.id }]) }));
    });
    const refusals = reasons.filter(r => !r.out.ok);
    assert.ok(refusals.length > 0, 'at least one template needs its display');
    for (const { id, out } of refusals) {
      assert.equal(out.reason, `This device’s firmware uses ${id}. Ask the agent to change the firmware first.`);
    }
  });
  it('reads a board as it stands with no operations, and still won\'t queue nothing', async () => {
    const before = await jobs();
    const chip = await (await post('/api/board/ops/check', { baseJobId: planJob, ops: [] })).json() as { ok: boolean; changes: string[]; warnings: string[]; plan: BoardPlan; graph: { parts: unknown[] }; needsReview?: boolean };
    assert.equal(chip.ok, true);
    assert.deepEqual(chip.changes, []);
    assert.deepEqual(chip.warnings, []);
    assert.deepEqual(chip.plan, plan);
    assert.ok(chip.graph.parts.length > 0);
    assert.equal(chip.needsReview, undefined);
    const carrier = await (await post('/api/board/ops/check', { baseJobId: designJob, ops: [] })).json() as { ok: boolean; design: CircuitDesign };
    assert.equal(carrier.ok, true);
    assert.deepEqual(carrier.design, design);
    assert.equal((await post('/api/board/jobs', { baseJobId: planJob, ops: [] })).status, 400);
    assert.equal(await jobs(), before);
  });
  it('says what each kind of edit changed', () => {
    const resistor = design.parts.find(p => p.module.startsWith('resistor'))!;
    const words = checkOps({ kind: 'design', design }, [{ op: 'set_value', part: resistor.id, value: '22 kΩ' }]);
    assert.equal(words.ok, true, words.reason);
    assert.equal(words.changes.length, 1, JSON.stringify(words.changes));
    assert.match(words.changes[0]!, /22 kΩ/);
  });
  it('refuses an invalid edit in one sentence, and makes no job', async () => {
    const before = await jobs();
    for (const ops of [[{ op: 'remove_part', id: 'nope' }], [{ op: 'run_code', code: 'x' }], [], 'x', [{ op: 'add_block', inst: 'x', block: 'y' }], [{ op: 'add_note', text: 'This board works.' }]]) {
      const res = await post('/api/board/jobs', { baseJobId: designJob, ops });
      assert.equal(res.status, 400, JSON.stringify(ops));
      const { error } = await res.json() as { error: string };
      assert.ok(error && error.length < 200 && !/ops\[/.test(error), error);
    }
    assert.equal(await jobs(), before);
  });
  it('keeps the closed request shape', async () => {
    for (const body of [{ baseJobId: designJob, ops: [], source: 'x' }, { baseJobId: designJob, ops: [], design }, { baseJobId: designJob, ops: [], extra: 1 }, { ops: [{ op: 'remove_note', text: 'x' }] }, { baseJobId: randomUUID(), ops: [{ op: 'remove_note', text: 'x' }] }]) assert.equal((await post('/api/board/jobs', body)).status, 400);
  });
  it('won\'t edit a board written as code', async () => {
    const res = await post('/api/board/jobs', { baseJobId: sourceJob, ops: [{ op: 'add_note', text: 'A note' }] });
    assert.equal(res.status, 400);
    assert.match((await res.json() as { error: string }).error, /written as code/);
  });

  it('checks a carrier edit without making a job', async () => {
    const before = await jobs();
    const good = await (await post('/api/board/ops/check', { baseJobId: designJob, ops: [{ op: 'add_note', text: 'Keep the probe lead short.' }] })).json() as { ok: boolean; design: CircuitDesign; plan?: unknown };
    assert.equal(good.ok, true);
    assert.ok(good.design.notes.some(n => n.text === 'Keep the probe lead short.'));
    assert.equal(good.plan, undefined);
    const bad = await (await post('/api/board/ops/check', { baseJobId: designJob, ops: [{ op: 'add_note', text: 'A note' }, { op: 'remove_part', id: 'nope' }] })).json() as { ok: boolean; reason: string; opIndex: number; design?: unknown };
    assert.equal(bad.ok, false);
    assert.equal(bad.opIndex, 1);
    assert.match(bad.reason, /nope/);
    assert.equal(bad.design, undefined);
    assert.equal(await jobs(), before);
  });
  it('still returns a carrier draft that applied but fails its checks', async () => {
    const out = await (await post('/api/board/ops/check', { baseJobId: designJob, ops: [{ op: 'add_note', text: 'This board works.' }] })).json() as { ok: boolean; reason: string; opIndex?: number; design?: CircuitDesign };
    assert.equal(out.ok, false);
    assert.equal(out.opIndex, undefined);
    assert.ok(out.design);
    assert.match(out.reason, /claim/);
  });
  it('checks a chip edit, with the plan and its drawing', async () => {
    const out = await (await post('/api/board/ops/check', { baseJobId: planJob, ops: wireSensor })).json() as { ok: boolean; needsReview: boolean; plan: BoardPlan; graph: { parts: { inst: string }[] }; warnings: string[] };
    assert.equal(out.ok, true);
    assert.equal(out.needsReview, true);
    assert.ok(out.plan.blocks.some(b => b.inst === 'air'));
    assert.ok(out.graph.parts.some(p => p.inst === 'air'));
    assert.equal(new Set(out.warnings).size, out.warnings.length, 'each warning once');
  });
  it('won\'t queue a chip edit no review has seen, because it could never finish', async () => {
    const before = await jobs();
    const res = await post('/api/board/jobs', { baseJobId: planJob, ops: wireSensor });
    assert.equal(res.status, 400);
    assert.match((await res.json() as { error: string }).error, /second agent/);
    assert.equal(await jobs(), before);
  });
  it('queues a chip edit once a review matches that exact plan', async () => {
    const edited = checkOps({ kind: 'plan', plan }, wireSensor);
    recordSchematicReview(edited.plan!, { by: 'test', findings: [{ section: 'air', status: 'match' }] });
    const res = await post('/api/board/jobs', { baseJobId: planJob, ops: wireSensor });
    assert.equal(res.status, 202);
    const job = await record((await res.json() as { jobId: string }).jobId);
    assert.equal(job.input.kind, 'plan');
    assert.equal(job.input.baseJobId, planJob);
    assert.ok(job.input.plan.blocks.some((b: { inst: string }) => b.inst === 'air'));
    assert.equal(job.input.ops.length, wireSensor.length);
    assert.ok(job.editSummary.some((line: string) => /SHT40/.test(line)));
  });
  it('takes the Editor\'s plan with its ops only if it\'s the circuit they make', async () => {
    const edited = checkOps({ kind: 'plan', plan }, wireSensor).plan!;
    const firmware = await post('/api/board/jobs', { baseJobId: planJob, ops: wireSensor, plan: { ...edited, app: { source: 'void setup() {}\nvoid loop() {}\n' } } });
    assert.equal(firmware.status, 202, 'firmware isn\'t part of the circuit');
    const other = await post('/api/board/jobs', { baseJobId: planJob, ops: wireSensor, plan });
    assert.equal(other.status, 400);
    assert.match((await other.json() as { error: string }).error, /isn’t what these edits make/);
  });

  it('lists the library for each kind of board', async () => {
    const carrier = await (await fetch(`${url}/api/board/library?mode=carrier&q=oled`)).json() as ReturnType<typeof libraryListing>;
    assert.equal(carrier!.blocks.length, 0);
    assert.deepEqual(carrier!.modules.map(m => m.category), ['display']);
    const chip = await (await fetch(`${url}/api/board/library?mode=chip&q=sht40`)).json() as ReturnType<typeof libraryListing>;
    assert.equal(chip!.modules.length, 0);
    const block = chip!.blocks[0]!;
    assert.equal(block.id, SHT40);
    assert.equal(block.status, 'reviewed');
    assert.deepEqual(Object.keys(block.ports[0]!).sort(), ['id', 'kind', 'label']);
    assert.ok(Array.isArray(block.params));
    const both = await (await fetch(`${url}/api/board/library`)).json() as ReturnType<typeof libraryListing>;
    assert.ok(both!.modules.length && both!.blocks.length);
    assert.equal(new Set(both!.blocks.map(b => b.id)).size, both!.blocks.length, 'one revision of each');
    assert.equal((await fetch(`${url}/api/board/library?mode=nope`)).status, 400);
  });
  it('allows only the methods it means to', async () => {
    assert.equal((await fetch(`${url}/api/board/ops/check`)).status, 404);
    assert.equal((await post('/api/board/library', {})).status, 404);
  });
});

describe('chip edits on the real library', () => {
  const on = async (ops: unknown[]) => checkOps({ kind: 'plan', plan: await spike() }, ops);
  const assertPasses = (plan: BoardPlan) => {
    const errors = checkPlan(plan, resolvePlanBlocks(plan)).flatMap(g => g.issues.filter(i => i.severity === 'error'));
    assert.deepEqual(errors, []);
  };

  it('adds a block and links it, and the plan passes its checks', async () => {
    const out = await on(wireSensor);
    assert.equal(out.ok, true, out.reason);
    assertPasses(out.plan!);
  });
  it('uses the latest revision, gives the block a named section, and draws a half-wired draft', async () => {
    const out = await on([wireSensor[0]]);
    assert.equal(out.ok, false);
    assert.equal(out.opIndex, undefined);
    const latest = listBlocks().find(b => b.id === SHT40)!;
    assert.equal(out.plan!.blocks.at(-1)!.version, latest.version);
    assert.equal(out.plan!.sections!.at(-1)!.title, latest.title.slice(0, 80));
    assert.ok(out.graph!.parts.some(p => p.inst === 'air'));
  });
  it('gives a new block a place on a board of fixed size, and clear of what\'s there', async () => {
    const out = await on(wireSensor);
    const board = out.plan!.board!;
    const at = out.plan!.blocks.at(-1)!.at!;
    assert.ok(Math.abs(at.x) <= board.widthMm / 2 && Math.abs(at.y) <= board.heightMm / 2, JSON.stringify(at));
    for (const other of out.plan!.blocks.slice(0, -1)) assert.ok(Math.hypot(at.x - other.at!.x, at.y - other.at!.y) > 5, other.inst);
    const again = await on(wireSensor);
    assert.deepEqual(again.plan!.blocks.at(-1)!.at, at, 'the same every time');
  });
  it('doesn\'t count placement against a review', async () => {
    const plan = (await on(wireSensor)).plan!;
    const moved = { ...plan, blocks: plan.blocks.map(b => (b.inst === 'air' ? { ...b, at: { x: 0, y: 0 } } : b)) };
    assert.equal(schematicHash(plan), schematicHash(moved));
  });
  it('stops at an op that can\'t apply, with no plan to draw', async () => {
    const out = await on([wireSensor[0], { op: 'add_block', inst: 'x', block: 'nope' }]);
    assert.equal(out.opIndex, 1);
    assert.equal(out.plan, undefined);
    assert.match(out.reason!, /no block called nope/);
  });
  it('says which block owns a part, and removes a part that is the whole block', async () => {
    const graph = sheetGraph(planGraph(await spike(), resolvePlanBlocks(await spike())));
    const usb = graph.parts.find(p => p.inst === 'usb-c-sink')!;
    assert.match((await on([{ op: 'remove_part', id: usb.ref }])).reason!, /part of the USB-C sink/);
    assert.match((await on([{ op: 'remove_part', id: 'NOPE' }])).reason!, /no part NOPE/);
  });
  it('refuses a setting the block doesn\'t have', async () => {
    assert.match((await on([{ op: 'set_value', part: 'ldo-ap2112-3v3.nope', value: '1' }])).reason!, /no setting called nope/);
  });
  it('asks for a review even for a note, because a reviewer reads the notes', async () => {
    const out = await on([{ op: 'add_note', text: 'Keep the antenna clear.', section: 'usb-c-sink' }]);
    assert.equal(out.ok, true);
    assert.equal(out.needsReview, true);
    assert.ok(out.warnings.some(w => /second agent/.test(w)));
  });

  describe('renaming a net', () => {
    it('renames a net between blocks, on the drawing and in the plan', async () => {
      const out = await on([{ op: 'rename_net', net: 'V3V3', name: 'RAIL_3V3' }]);
      assert.equal(out.ok, true, out.reason);
      assert.ok(out.graph!.nets.some(n => n.name === 'RAIL_3V3'));
      assert.ok(!out.graph!.nets.some(n => n.name === 'V3V3'));
      assertPasses(out.plan!);
    });
    it('keeps one entry when renamed twice', async () => {
      const out = await on([{ op: 'rename_net', net: 'V3V3', name: 'A_RAIL' }, { op: 'rename_net', net: 'A_RAIL', name: 'B_RAIL' }]);
      assert.equal(out.ok, true, out.reason);
      assert.deepEqual(Object.values(out.plan!.netNames!), ['B_RAIL']);
    });
    it('never changes the wiring', async () => {
      const plan = await spike();
      const pins = (at: BoardPlan) => planGraph(at, resolvePlanBlocks(at)).nets.map(n => n.pins.map(p => `${p.ref}.${p.pad}`).sort().join()).sort();
      assert.deepEqual(pins((await on([{ op: 'rename_net', net: 'V3V3', name: 'RAIL_3V3' }])).plan!), pins(plan));
    });
    it('refuses the ground net, which the pour is built from', async () => {
      const out = await on([{ op: 'rename_net', net: 'GND', name: 'EARTH' }]);
      assert.equal(out.ok, false);
      assert.match(out.reason!, /ground net/);
    });
    it('refuses a net inside a block, a name in use, and a name a selector can\'t hold', async () => {
      assert.match((await on([{ op: 'rename_net', net: 'STRAP46', name: 'X' }])).reason!, /inside a block/);
      assert.match((await on([{ op: 'rename_net', net: 'V3V3', name: 'GND' }])).reason!, /already a net/);
      assert.match((await on([{ op: 'rename_net', net: 'nope', name: 'X' }])).reason!, /no net called/);
      assert.match((await on([{ op: 'rename_net', net: 'V3V3', name: 'a.b' }])).reason!, /can't be a net name/);
    });
    it('reports two names on one net, and one name on two nets, as ERC errors', async () => {
      const plan = await spike();
      const errors = (netNames: Record<string, string>) => checkPlan({ ...plan, netNames }).flatMap(g => g.issues).filter(i => i.rule === 'net-name').map(i => i.message);
      assert.match(errors({ 'esp32-s3-core.V3V3': 'A', 'ldo-ap2112-3v3.V3V3': 'B' })[0]!, /both/);
      assert.match(errors({ 'esp32-s3-core.V3V3': 'A', 'boot-reset-buttons.EN': 'A' })[0]!, /both/);
      assert.match(errors({ 'nope.PORT': 'A' })[0]!, /isn't a port/);
      assert.deepEqual(errors({ 'esp32-s3-core.V3V3': 'A', 'ldo-ap2112-3v3.V3V3': 'A' }), []);
    });
    it('forgets a name when its block goes', async () => {
      const out = await on([{ op: 'rename_net', net: 'BOOT', name: 'BOOT_SW' }, { op: 'remove_block', inst: 'boot-reset-buttons' }]);
      assert.equal(out.plan!.netNames, undefined);
    });
  });
});

describe('the drawing matches the built sheet', () => {
  it('uses pad numbers as ids and the datasheet\'s names as labels', async () => {
    const out = checkOps({ kind: 'plan', plan: JSON.parse(await readFile('src/blocks/data/spike-plan.json', 'utf8')) as BoardPlan }, wireSensor);
    const sensor = out.graph!.parts.find(p => p.inst === 'air' && p.mpn?.startsWith('SHT40'))!;
    assert.deepEqual(sensor.pins.map(p => [p.id, p.label]), [['1', 'SDA'], ['2', 'SCL'], ['3', 'VDD'], ['4', 'VSS']]);
    const ids = new Map(out.graph!.parts.map(p => [p.ref, new Set(p.pins.map(pin => pin.id))]));
    for (const net of out.graph!.nets) for (const pin of net.pins) assert.ok(ids.get(pin.ref)?.has(pin.pin), `${pin.ref}.${pin.pin}`);
  });
});
