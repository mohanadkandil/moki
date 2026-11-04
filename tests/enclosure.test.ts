import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// The enclosure code runs under Bun in eda/, so npm test drives its Bun suite from here.
// The longer geometry suite is mech/tests (see docs/engineering/2026-11-04-tscircuit/reports/eng_mech.md).
const bun = process.env.MOKI_BUN ?? resolve(homedir(), '.bun/bin/bun');

test('the Bun enclosure suite passes', { skip: existsSync(bun) ? false : `Bun not found at ${bun}` }, () => {
  const run = spawnSync(bun, ['test', 'enclosure/'], { cwd: resolve(import.meta.dirname, '../eda'), encoding: 'utf8', timeout: 240_000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr + run.stdout, /\b0 fail\b/);
});
