// Renders the composer and cards with the real components, over CDP, with no server. Args: out directory.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const port = 9378;
const chrome = spawn(join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell'), ['--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--allow-file-access-from-files', 'about:blank'], { env: { ...process.env, LD_LIBRARY_PATH: join(homedir(), '.local/share/sogo-diagrams/lib') }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('time limit'); chrome.kill('SIGKILL'); process.exit(3); }, 90000);
try {
  let target; for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const problems = [];
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description?.slice(0, 200)); });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  const size = async (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 500 });
  const open = async q => { await send('Page.navigate', { url: `file://${here}/out/index.html?${q}` }); await sleep(900); };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); console.log(name); };
  const click = sel => run(`document.querySelector('${sel}').click()`);
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    await size(w, h);
    await open('mock=board&agent=demo&state=on'); await shot(`composer-${tag}`);
    await click('.st-agent-picker-button'); await sleep(200); await shot(`picker-open-${tag}`);
    console.log(tag, 'overflow', await run(`(() => { const r = document.querySelector('.st-agent-picker-pop').getBoundingClientRect(); return JSON.stringify({ left: r.left, right: r.right, top: r.top, vw: innerWidth, scroll: document.documentElement.scrollWidth }); })()`));
    await click('.st-agent-picker-pop input[type=radio]'); await sleep(150);
    console.log(tag, 'chosen', await run(`document.querySelector('.st-agent-picker-button span').textContent`), 'saved', await run(`localStorage.getItem('moki.agent.effort')`));
    await run(`localStorage.removeItem('moki.agent.effort')`);
    await open('mock=board&state=on'); await shot(`rules-${tag}`);
    await click('.st-agent-picker-button'); await sleep(200); await shot(`rules-open-${tag}`);
    await open('mock=board&agent=demo&state=busy'); await shot(`busy-${tag}`);
    await open('mock=board&agent=demo&state=cards'); await shot(`cards-${tag}`);
    console.log(tag, 'cards scroll', await run(`JSON.stringify({ sw: document.documentElement.scrollWidth, vw: innerWidth, h: document.documentElement.scrollHeight })`));
    await size(w, 1500); await sleep(150); await shot(`cards-full-${tag}`);
  }
  console.log('problems', JSON.stringify(problems));
} finally { chrome.kill('SIGKILL'); }
process.exit(0);
