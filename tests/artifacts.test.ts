import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsValidation, staleDependents, type ArtifactRef } from '../src/contracts/artifacts.js';

const ref = (id: string, revision = 1, hash = 'a'): ArtifactRef => ({ id, revision, sha256: hash.repeat(64), uri: `artifacts/${id}` });

test('a PCB change invalidates enclosure, render and launch while leaving independent firmware alone', () => {
  const board = ref('board'), enclosure = ref('case'), render = ref('render');
  const artifacts = [
    { ...board, inputs: [] }, { ...enclosure, inputs: [board] },
    { ...render, inputs: [enclosure] }, { ...ref('launch'), inputs: [render] },
    { ...ref('firmware'), inputs: [ref('pins')] },
  ];
  assert.deepEqual(staleDependents(artifacts, ['board']).sort(), ['case', 'launch', 'render']);
});

test('a previously passing fit check cannot release a changed board or enclosure', () => {
  const board = ref('board'), enclosure = ref('case');
  const validation = { outcome: 'pass' as const, checker: 'fit-v1', inputs: [board, enclosure], evidence: ['fit-report.json'] };
  assert.equal(acceptsValidation(validation, [board, enclosure]), true);
  assert.equal(acceptsValidation(validation, [ref('board', 2, 'b'), enclosure]), false);
  assert.equal(acceptsValidation(validation, [board, ref('case', 1, 'c')]), false);
  assert.equal(acceptsValidation({ ...validation, evidence: [] }, [board, enclosure]), false);
  assert.equal(acceptsValidation({ ...validation, outcome: 'blocked' }, [board, enclosure]), false);
  assert.equal(acceptsValidation({ ...validation, inputs: [] }, []), false);
});
