import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RunActivity from '../web/src/RunActivity.js';
import type { LiveRun } from '../src/contracts/run.js';

test('a completed KiCad run renders measured hole objects as a count', () => {
  const run: LiveRun = {
    id: 'saved-run', brief: 'Focus timer', status: 'completed', createdAt: '2026-10-24T13:47:22Z',
    stages: [], events: [], artifacts: [], report: { ok: true,
      release: { outcome: 'blocked', reason: 'No schematic, circuit or component-envelope validation' },
      electrical: { width: 65, height: 69, holes: [
        {x:7,y:7,diameter:2.2}, {x:58,y:7,diameter:2.2},
        {x:58,y:62,diameter:2.2}, {x:7,y:62,diameter:2.2},
      ] },
    },
  };
  const html = renderToStaticMarkup(createElement(RunActivity, {run}));
  assert.match(html, /Holes <b>4<\/b>/);
  assert.match(html, /65.*69.*mm/);
  assert.match(html, /No schematic or routed circuit has been generated/);
  assert.match(html, /Engineering incomplete/);
});

test('legacy reports containing a numeric hole count still render', () => {
  const run: LiveRun = {id:'legacy', brief:'Study', status:'completed', createdAt:'2026-10-24T13:47:22Z',
    stages:[],events:[],artifacts:[],report:{ok:true,electrical:{width:60,height:40,holes:4}}};
  assert.match(renderToStaticMarkup(createElement(RunActivity,{run})), /Holes <b>4<\/b>/);
});
