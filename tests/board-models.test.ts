import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
test('detailed catalog models preserve fit envelopes and PBR materials',()=>{
 const run=spawnSync(process.env.MOKI_BUN??resolve(homedir(),'.bun/bin/bun'),['test','models/catalog-models.test.ts'],{cwd:resolve('eda'),encoding:'utf8',timeout:90000});
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
