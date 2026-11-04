// Exercises the honest states against the real API: DRC error, failed render, re-render, cache hit, back and forth.
import { createRequire } from 'node:module';
const require = createRequire('/home/sogo/.local/share/sogo-diagrams/');
const puppeteer = require('puppeteer-core');
const [out, base, W_, H_] = process.argv.slice(2);
const W = +(W_ ?? 1440), H = +(H_ ?? 900);
process.env.LD_LIBRARY_PATH = '/home/sogo/.local/share/sogo-diagrams/lib';
const browser = await puppeteer.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell', headless: 'shell', args: ['--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: W, height: H, isMobile: W < 500, hasTouch: W < 500 } });
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (['error'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settled = () => page.waitForFunction(() => /Total|n\/a/.test(document.querySelector('.bs-total')?.textContent ?? '') && !document.querySelector('.bs-cell.is-running'), { timeout: 150000 });
const total = () => page.evaluate(() => document.querySelector('.bs-total')?.textContent);
const results = {};
const fs = await import('node:fs');
const check = (name, ok, detail) => { results[name] = { ok, detail }; console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };

await page.goto(base + '/lab?brief=A%20focus%20timer%20with%20a%20screen%20and%20a%20knob%20that%20beeps', { waitUntil: 'load' });
await page.waitForSelector('.lab-build');
// Cache hit from a repeat design build
await page.click('.lab-build'); await page.waitForSelector('.bs-strip'); await sleep(800); await settled();
const first = await total();
await page.click('#bs-tab-files'); await sleep(300);
const designLinks = await page.$$eval('.bs-file-get', as => as.map(a => a.getAttribute('href').split('/').pop()));
check('design build lists enclosure.step', designLinks.includes('enclosure.step'), JSON.stringify(designLinks));
await page.click('#bs-tab-enclosure'); await sleep(500);
check('Enclosure tab offers STEP download', await page.$$eval('.bs-download', as => as.some(a => a.getAttribute('download') === 'enclosure.step')));
await page.click('#bs-tab-schematic'); await sleep(200);
await page.click('.bs-back'); await page.waitForSelector('.lab-build', { visible: true });
check('back keeps lab state', await page.$eval('#lab-brief', e => e.value.includes('focus timer')));
await page.click('.lab-build'); await sleep(800); await settled();
const second = await total();
check('repeat build reports cache hit', /cache hit/.test(second), `${first} -> ${second}`);
await page.screenshot({ path: `${out}/state-cache-hit-${W}.png`, fullPage: W < 500 });

// Edit to shrink the board: a real DRC failure
await page.click('#bs-tab-code');
await page.waitForFunction(() => document.querySelector('.bs-editor textarea')?.value.includes('<board'), { timeout: 20000 });
const source = await page.$eval('.bs-editor textarea', e => e.value);
async function setSource(text) {
  await page.$eval('.bs-editor textarea', (e, v) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  await sleep(100);
}
await setSource(source.replace(/<board width=\{\d+\} height=\{\d+\}/, '<board width={30} height={30}'));
check('shrink edit applied', (await page.$eval('.bs-editor textarea', e => e.value)).includes('width={30}'));
await page.click('.bs-panel-tools .lab-primary');
await sleep(1200); await settled();
const drcText = await page.evaluate(() => document.querySelector('.bs-ladder')?.textContent);
check('edited source shows DRC errors', /[1-9]\d* errors?/.test(drcText), drcText);
await page.screenshot({ path: `${out}/state-drc-errors-${W}.png`, fullPage: W < 500 });
await page.click('#bs-tab-pcb'); await sleep(900);
await page.screenshot({ path: `${out}/state-drc-errors-pcb-${W}.png`, fullPage: W < 500 });
await page.click('#bs-tab-firmware'); await sleep(600);
const fw = await page.evaluate(() => document.querySelector('#bs-panel')?.textContent);
check('edited source says firmware skipped with reason', /skipped/i.test(fw) && /not compiled/i.test(fw + await page.evaluate(() => document.querySelector('.bs-ladder').textContent)), fw.slice(0, 160));
await page.screenshot({ path: `${out}/state-source-firmware-skipped-${W}.png`, fullPage: W < 500 });

// A broken source: a failed job keeps the editor text and the last good build
await page.click('#bs-tab-code'); await sleep(300);
const broken = 'export default function Board() { return <board width={ }\n';
await setSource(broken);
await page.click('.bs-panel-tools .lab-primary');
await sleep(1200);
await page.waitForFunction(() => document.querySelector('.bs-failed'), { timeout: 150000 });
const failText = await page.$eval('.bs-failed', e => e.textContent);
check('failed job shows the error', /failed/i.test(failText), failText.slice(0, 200));
check('editor keeps broken text', (await page.$eval('.bs-editor textarea', e => e.value)) === broken);
await page.screenshot({ path: `${out}/state-failed-${W}.png`, fullPage: W < 500 });
// After the failure: DRC must not read as clean for a job that never rendered, and the last good build stays.
const ladder = await page.$eval('.bs-ladder', e => e.textContent);
check('failed job does not claim a clean DRC', /Did not run/.test(ladder), ladder);
const banner = await page.$eval('.bs-failed', e => e.textContent);
check('failed job says the last good build is still shown', /Still showing the last build/.test(banner));
// Keyboard: arrows move through the tabs and focus follows.
await page.focus('#bs-tab-code');
await page.keyboard.press('ArrowRight');
check('arrow key moves to the next tab', await page.evaluate(() => document.activeElement?.id === 'bs-tab-files' && document.getElementById('bs-tab-files').getAttribute('aria-selected') === 'true'));
await page.keyboard.press('Home');
check('Home key goes to the first tab', await page.evaluate(() => document.activeElement?.id === 'bs-tab-schematic'));
// Pan and zoom really transform the drawing.
await sleep(500);
const before = await page.$eval('.bs-pane img', e => e.style.transform);
await page.click('.bs-pane .lab-zoom button:nth-child(2)');
await sleep(150);
const after = await page.$eval('.bs-pane img', e => e.style.transform);
check('zoom button changes the drawing transform', before !== after, `${before} -> ${after}`);
// Every download link answers.
await page.click('#bs-tab-files'); await sleep(400);
const links = await page.$$eval('.bs-file-get', as => as.map(a => a.getAttribute('href')));
const codes = await page.evaluate(async hrefs => Promise.all(hrefs.map(async h => { const r = await fetch(h); return [h.split('/').pop(), r.status, (await r.arrayBuffer()).byteLength]; })), links);
check('every listed file downloads', codes.length > 0 && codes.every(c => c[1] === 200 && c[2] > 0), JSON.stringify(codes.map(c => c[0])));
check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
fs.writeFileSync(`${out}/states-${W}.json`, JSON.stringify({ viewport: [W, H], results, console: logs }, null, 2));
console.log('console:', logs.join('\n') || 'none');
await browser.close();
process.exit(Object.values(results).every(r => r.ok) ? 0 : 1);
