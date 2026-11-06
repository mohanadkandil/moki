// The gallery's picture of a build: drawn from the job's own model, served under one fixed name, and only for a finished build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { homedir } from 'node:os';
import { BOARD_ARTIFACT_NAMES, BOARD_THUMBNAIL, createBoardService } from '../server/board-api.js';
import { projectCard, type ProjectState } from '../server/project-api.js';
import { encodePng, readGlb, renderMeshes } from '../server/thumbnail.js';

/** A box 40 × 4 × 30 mm in `color`, named `name`. */
function glb(nodes: { name: string; color: [number, number, number, number]; y?: number }[]) {
  const corners = [[-20, 0, -15], [20, 0, -15], [20, 0, 15], [-20, 0, 15], [-20, 4, -15], [20, 4, -15], [20, 4, 15], [-20, 4, 15]];
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const positions = new Float32Array(corners.flat());
  const indices = new Uint16Array(faces);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const pad = (b: Buffer, fill: number) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const json = pad(Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes: nodes.map((n, i) => ({ name: n.name, mesh: i, translation: [0, n.y ?? 0, 0] })),
    meshes: nodes.map((_, i) => ({ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: i }] })),
    materials: nodes.map(n => ({ pbrMetallicRoughness: { baseColorFactor: n.color, metallicFactor: 0, roughnessFactor: 0.8 } })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    buffers: [{ byteLength: bin.length }],
  })), 0x20);
  const data = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + data.length, 8);
  const chunk = (body: Buffer, type: number) => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, body]); };
  return Buffer.concat([head, chunk(json, 0x4e4f534a), chunk(data, 0x004e4942)]);
}
const RED: [number, number, number, number] = [0.9, 0.05, 0.05, 1];

const pixel = (rgb: Uint8Array, width: number, x: number, y: number) => [...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)] as [number, number, number];

test('draws the model it was given, on the graphite stage', () => {
  const rgb = renderMeshes(readGlb(glb([{ name: 'Box0', color: RED }]), () => false), 160, 100);
  const [r, g, b] = pixel(rgb, 160, 80, 50);
  assert.ok(r > g * 2 && r > b * 2, `the middle of the frame is the red box, got ${r},${g},${b}`);
  const corner = pixel(rgb, 160, 1, 1);
  assert.ok(Math.abs(corner[0] - 0x1d) <= 2 && Math.abs(corner[1] - 0x1b) <= 2 && Math.abs(corner[2] - 0x19) <= 2, `the corner melts into the stage, got ${corner}`);
});

test('leaves out the lid, so the card shows what is inside the case', () => {
  const model = glb([{ name: 'enclosure-base', color: RED }, { name: 'enclosure-lid', color: RED, y: 40 }]);
  assert.equal(readGlb(model, name => name === 'enclosure-lid').length, 1);
  assert.equal(readGlb(model, () => false).length, 2);
});

test('refuses a file that is not a model', () => {
  assert.throws(() => readGlb(Buffer.from('this is not a model at all, sorry'), () => false), /Not a GLB/);
  assert.throws(() => renderMeshes([]), /Nothing to draw/);
});

test('writes a PNG that any decoder can read back', () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
  const png = encodePng(2, 2, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 2);
  const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
  assert.equal(raw.length, 2 * (1 + 6));
});

async function service(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'moki-thumb-')), jobsRoot = join(root, 'jobs');
  const add = async (status: string, model: Buffer | null) => {
    const id = randomUUID(), dir = join(jobsRoot, id);
    await mkdir(dir, { recursive: true });
    if (model) await writeFile(join(dir, 'board.glb'), model);
    await writeFile(join(dir, 'job.json'), JSON.stringify({ jobId: id, status, createdAt: new Date().toISOString(), input: { kind: 'design' }, stages: [], artifacts: {} }));
    return { id, dir };
  };
  const done = await add('done', glb([{ name: 'Box0', color: RED }]));
  const failed = await add('failed', glb([{ name: 'Box0', color: RED }]));
  const bare = await add('done', null);
  const corrupt = await add('done', Buffer.from('not a model'));
  const board = createBoardService({ jobsRoot, bun: process.env.MOKI_BUN ?? resolve(homedir(), '.bun/bin/bun') });
  const server = createServer((req, res) => { void board.handle(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  t.after(async () => { await board.close(); server.closeAllConnections(); await new Promise<void>(closed => server.close(() => closed())); await rm(root, { recursive: true, force: true }); });
  const addr = server.address() as { port: number };
  const get = (id: string, name = BOARD_THUMBNAIL) => fetch(`http://127.0.0.1:${addr.port}/api/board/jobs/${id}/files/${name}`);
  return { done, failed, bare, corrupt, get };
}

test('serves a finished build\'s picture, drawn once, and no other', async t => {
  const s = await service(t);
  const first = await s.get(s.done.id);
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(first.headers.get('content-type'), 'image/png');
  assert.match(first.headers.get('cache-control')!, /immutable/);
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await first.arrayBuffer());
  assert.equal(bytes.readUInt32BE(16), 1280);
  const written = (await stat(join(s.done.dir, BOARD_THUMBNAIL))).mtimeMs;
  assert.equal((await s.get(s.done.id)).status, 200);
  assert.equal((await stat(join(s.done.dir, BOARD_THUMBNAIL))).mtimeMs, written);
  assert.equal((await s.get(s.failed.id)).status, 404);
  assert.equal((await s.get(s.bare.id)).status, 404);
});

test('a model that will not draw is tried once, and leaves the job as it was', async t => {
  const s = await service(t);
  const before = await readFile(join(s.corrupt.dir, 'job.json'), 'utf8');
  assert.equal((await s.get(s.corrupt.id)).status, 404);
  const log = (await stat(join(s.corrupt.dir, 'thumb.log'))).mtimeMs;
  assert.equal((await s.get(s.corrupt.id)).status, 404);
  assert.equal((await stat(join(s.corrupt.dir, 'thumb.log'))).mtimeMs, log);
  assert.equal(await readFile(join(s.corrupt.dir, 'job.json'), 'utf8'), before);
});

test('the picture is not one of the build\'s files, so it stays out of downloads and receipts', () => {
  assert.ok(!(BOARD_ARTIFACT_NAMES as readonly string[]).includes(BOARD_THUMBNAIL));
});

const state = (items: unknown[], extra: Record<string, unknown> = {}): ProjectState => ({ turns: [{ kind: 'agent', view: { items, usage: { costUsd: 0.1 } } }], session: { revisions: [] }, canvasJobId: null, ...extra });

test('a card takes what the chat says happened', () => {
  assert.deepEqual(projectCard(null, 'new'), { note: null, costUsd: null, parts: null, controller: null, sheet: null });
  const ask = { kind: 'requirements', settled: 'open', message: 'Does that sound right?' };
  const lost = { kind: 'error', text: 'Lost contact with the agent. A build already queued keeps going.' };
  assert.deepEqual(projectCard(state([ask, lost]), 'waiting').note, { kind: 'ask', text: 'Does that sound right?' });
  assert.deepEqual(projectCard(state([{ kind: 'decline', message: 'Not here.' }]), 'new').note, { kind: 'decline', text: 'Not here.' });
  const stopped = projectCard(state([{ ...ask, settled: 'confirmed' }, { kind: 'note', text: 'This turn stopped when the page closed. Send it again.' }]), 'waiting');
  assert.deepEqual(stopped.note, { kind: 'stopped', text: 'This turn stopped when the page closed.' });
  assert.equal(stopped.costUsd, 0.1);
});

test('a card sends the drawing only while there is no build to show, and only the parts a drawing needs', () => {
  const design = { title: 'Desk', parts: [{ id: 'U1', module: 'esp32-devkitc-v4' }, { id: 'U2', module: 'ssd1306-oled-128x64-i2c' }], nets: [], app: 'firmware source', notes: ['long'] };
  const saved = state([], { session: { revisions: [{ design }] } });
  const waiting = projectCard(saved, 'waiting');
  assert.deepEqual(waiting.sheet, { title: 'Desk', parts: design.parts, nets: [] });
  assert.equal(waiting.parts, 2);
  assert.equal(waiting.controller, 'ESP32-DevKitC V4');
  assert.equal(projectCard(saved, 'built').sheet, null);
});
