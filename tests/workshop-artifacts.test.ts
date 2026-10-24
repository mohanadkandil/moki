import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { workshopApi } from '../server/workshop-api.js';

test('saved PCB downloads traverse the real API route with underscores and exact bytes', async () => {
  const previousDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'moki-artifact-route-'));
  const id = 'b59e472f-188c-4d95-997a-695329327f58';
  const board = Buffer.from('(kicad_pcb (version 20241229))\n');
  const relativeUrl = `/api/runs/${id}/artifacts/board.kicad_pcb`;
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    process.chdir(directory);
    const output = join(directory, 'var/runs', id);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'board.kicad_pcb'), board);
    await writeFile(join(output, 'run.json'), JSON.stringify({
      id, brief:'Route regression fixture', status:'completed', createdAt:'2026-10-24T13:00:00Z',
      stages:[], events:[], artifacts:[{ name:'board.kicad_pcb', url:relativeUrl,
        bytes:board.length, sha256:createHash('sha256').update(board).digest('hex') }],
    }));
    server = await createServer({ configFile:false, root:directory, logLevel:'silent',
      plugins:[workshopApi()], server:{host:'127.0.0.1',port:0} });
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + relativeUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="board.kicad_pcb"');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), board);
    const unknown = await fetch(`${base}/api/runs/${id}/artifacts/private.json`);
    assert.equal(unknown.status, 404);
    const missing = await fetch(`${base}/api/runs/${id}/artifacts/product.step`);
    assert.equal(missing.status, 404);
  } finally {
    await server?.close();
    process.chdir(previousDirectory);
    await rm(directory, {recursive:true,force:true});
  }
});
