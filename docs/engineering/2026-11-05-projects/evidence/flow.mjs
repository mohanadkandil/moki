// Drives the real built app and real services in a real browser, over CDP. Args: out dir, base URL.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const out = process.argv[2], base = process.argv[3]; mkdirSync(out, { recursive: true });
const port = 9379;
const chrome = spawn(join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell'), ['--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, 'about:blank'], { env: { ...process.env, LD_LIBRARY_PATH: join(homedir(), '.local/share/sogo-diagrams/lib') }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('time limit'); chrome.kill('SIGKILL'); process.exit(3); }, 420000);
const log = {}; const note = (k, v) => { log[k] = v; console.log(k, JSON.stringify(v)?.slice(0, 220)); };
try {
  let target; for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const problems = [];
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description?.slice(0, 240)); if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push(`${d.params.entry.text?.slice(0, 120)} ${d.params.entry.url ?? ''}`); });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 500 });
  const go = async path => { await send('Page.navigate', { url: base + path }); await sleep(1200); };
  const shot = async name => { let r = await send('Page.captureScreenshot', { format: 'png' }); for (let i = 0; i < 5 && !r.result?.data; i++) { await sleep(400); r = await send('Page.captureScreenshot', { format: 'png' }); } writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); console.log('shot', name); };
  const waitFor = async (expr, label, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await run(expr)) return Date.now() - t; await sleep(200); } throw new Error(`Timed out: ${label}`); };
  const type = (sel, text) => run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = sel => run(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const text = sel => run(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').slice(0, 400)`);
  const path = () => run('location.pathname + location.search');
  const has = phrase => `document.body.innerText.includes(${JSON.stringify(phrase)})`;

  // Desktop: the whole flow, one real build.
  await size(1440, 900);
  await go('/'); await shot('landing-empty-1440');
  note('landing path', await path());
  await click('.st-land-chips li:nth-child(1) button'); await sleep(150); note('chip fills prompt', await run(`document.querySelector('#st-land-input').value`));
  await click('.st-agent-picker-button'); await sleep(200); await shot('landing-picker-1440');
  await run(`document.querySelector('.st-agent-picker-button').click()`);
  await click('.st-send'); 
  await waitFor(`/\\/studio\\/[0-9a-f-]{36}/.test(location.pathname)`, 'navigated to project', 15000);
  const projectPath = (await path()).replace(/^\/app\/moki/, ''); note('project url', projectPath);
  await waitFor(`document.querySelector('.st-sending') !== null || ${has('Here’s what I’ll check')}`, 'turn started', 30000); await shot('project-verifier-working-1440');
  await waitFor(has('Here’s what I’ll check'), 'checks card', 90000); await sleep(300); await shot('project-checks-card-1440');
  await send('Page.reload'); await sleep(1800);
  note('after reload mid-confirm, card kept', await run(has('Looks right')));
  note('title', await run(`document.querySelector('.st-title-button')?.textContent`));
  await shot('project-restored-card-1440');
  await click('.st-agent-checks-foot button');
  await waitFor(`document.querySelector('.st-sending') !== null`, 'design started', 20000); await sleep(1500); await shot('project-designing-1440');
  await waitFor(`document.querySelector('.st-work-progress') !== null`, 'build started', 150000); await sleep(4000); await shot('project-building-1440');
  await send('Page.reload'); await sleep(2500); await shot('project-restored-building-1440');
  note('reload mid-build keeps following', await run(`document.querySelector('.st-work-progress') !== null || document.body.innerText.includes('DRC')`)); note('reload mid-build says the agent stopped', await run(has('The agent stopped when this page closed'))); await shot('project-restored-building-notice-1440');
  await waitFor(`document.querySelector('.st-work-progress') === null && document.querySelector('.st-tabs') !== null`, 'build landed', 240000); await sleep(1500); await shot('project-built-1440');
  note('turn view after build', await run(`[...document.querySelectorAll('.st-turn')].length`));
  // Rename, then reload.
  await click('.st-title-button'); await sleep(150);
  await run(`(() => { const el = document.querySelector('.st-title-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'My desk timer'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(600);
  const beforeTurns = await run(`document.querySelectorAll('.st-turn').length`);
  await sleep(800);
  await send('Page.reload'); await sleep(3000); await shot('project-restored-after-reload-1440');
  note('renamed survives reload', await run(`document.querySelector('.st-title-button')?.textContent`));
  note('turn count same after reload', [beforeTurns, await run(`document.querySelectorAll('.st-turn').length`)]);
  note('document title', await run('document.title'));
  note('url after reload', await path());
  // Back returns to the landing.
  // Back: from the landing, press into the project the way a person does, then go back.
  await go('/'); await sleep(400);
  await click('.st-land-recent a'); await waitFor(`/studio\\//.test(location.pathname)`, 'opened from recent', 8000); await sleep(1800);
  note('opened from recent', await path()); note('restored turns from recent', await run(`document.querySelectorAll('.st-turn').length`));
  await run('history.back()'); await sleep(900); note('browser back', await path()); note('back shows landing', await run(`!!document.querySelector('.st-landing h1')`));
  await go('/'); await sleep(500); await shot('landing-recent-1440'); note('recent', await text('.st-land-recent'));
  await go('/studio'); await sleep(300); note('/studio goes to', await path()); note('/studio shows landing', await run(`!!document.querySelector('.st-landing h1')`));
  await go('/studio/00000000-0000-4000-8000-000000000000'); await shot('not-found-1440'); note('unknown id', await text('.st-land-message h1'));
  await go('/studio/not-a-uuid'); note('malformed id status (filtered by the preview, as on the live link)', await run('document.body.innerText.slice(0, 60)'));

  // Phone: a second project up to its card, and the same restored project.
  await size(390, 844);
  await go('/'); await shot('landing-recent-390');
  note('landing overflow 390', await run(`document.documentElement.scrollWidth <= innerWidth`));
  await click('.st-land-chips li:nth-child(3) button'); await sleep(100);
  await click('.st-agent-picker-button'); await sleep(200); await shot('landing-picker-390'); await click('.st-agent-picker-button');
  await click('.st-send');
  await waitFor(`/\\/studio\\/[0-9a-f-]{36}/.test(location.pathname)`, 'navigated', 15000);
  await waitFor(`document.querySelector('.st-sending') !== null`, 'turn started', 20000); await shot('project-verifier-working-390');
  await waitFor(has('Here’s what I’ll check'), 'checks card', 90000); await sleep(300); await shot('project-checks-card-390');
  note('project overflow 390', await run(`document.documentElement.scrollWidth <= innerWidth`));
  await go(projectPath); await sleep(2000); await shot('project-restored-after-reload-390');
  await go('/studio/00000000-0000-4000-8000-000000000000'); await shot('not-found-390');
  note('problems', problems.filter(p => !/not-a-uuid|00000000-0000/.test(p)));
} catch (e) { note('FAILED', String(e)); } finally { chrome.kill('SIGKILL'); writeFileSync(join(out, '..', 'flow.json'), JSON.stringify(log, null, 1) + '\n'); }
process.exit(0);
