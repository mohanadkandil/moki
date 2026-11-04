// usage: node shoot.mjs <outDir> <prefix> <url> [--build] [--tabs a,b] [--w 1440 --h 900]
import { createRequire } from 'node:module';
const require = createRequire('/home/sogo/.local/share/sogo-diagrams/');
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const [out, prefix, url] = args;
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const W = +opt('w', 1440), H = +opt('h', 900);
const tabs = opt('tabs', 'schematic,pcb,3d,enclosure,firmware,code,files').split(',');
process.env.LD_LIBRARY_PATH = '/home/sogo/.local/share/sogo-diagrams/lib';
const browser = await puppeteer.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell', headless: 'shell', args: ['--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: W, height: H, deviceScaleFactor: 1, isMobile: W < 500, hasTouch: W < 500 } });
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('requestfailed', r => logs.push('reqfail: ' + r.url().slice(0,120) + ' ' + r.failure()?.errorText));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (args.includes('--build')) {
  await page.waitForSelector('.lab-build', { timeout: 30000 });
  if (args.includes('--before')) await page.screenshot({ path: `${out}/${prefix}-lab.png` });
  const t0 = Date.now();
  await page.click('.lab-build');
  await page.waitForSelector('.bs-strip', { timeout: 30000 });
  await sleep(+opt('during', 1500));
  await page.screenshot({ path: `${out}/${prefix}-running.png`, fullPage: W < 500 });
  await page.waitForFunction(() => /Total/.test(document.querySelector('.bs-total')?.textContent ?? ''), { timeout: 150000 });
  console.log('build wall ms', Date.now() - t0, await page.evaluate(() => document.querySelector('.bs-total')?.textContent));
} else {
  await page.waitForSelector('#bs-panel', { timeout: 30000 });
  await page.waitForFunction(() => /Total|n\/a/.test(document.querySelector('.bs-total')?.textContent ?? ''), { timeout: 60000 }).catch(() => {});
}
for (const tab of tabs) {
  if (tab === 'none') continue;
  if (!(await page.$(`#bs-tab-${tab}`))) { console.log('page lost', page.url(), logs.join('\n'), (await page.evaluate(() => document.body.innerText)).slice(0, 600)); await page.screenshot({ path: `${out}/${prefix}-lost.png` }); await browser.close(); process.exit(1); }
  await page.click(`#bs-tab-${tab}`);
  await sleep(900);
  if (tab === '3d' || tab === 'enclosure') {
    const t3 = Date.now();
    await page.waitForFunction(() => { const m = document.querySelector('.bs-model'); return !m || m.dataset.status !== 'loading'; }, { timeout: 120000 }).catch(() => logs.push('3d still loading after 120 s'));
    console.log(tab, 'model settled ms', Date.now() - t3);
    await sleep(2500);
  }
  await page.screenshot({ path: `${out}/${prefix}-${tab}.png`, fullPage: W < 500 });
  if (tab === '3d' && await page.$('.bs-switch input:not([disabled])')) {
    await page.click('.bs-switch');
    await sleep(600);
    await page.waitForFunction(() => document.querySelector('.bs-model')?.dataset.status !== 'loading', { timeout: 120000 }).catch(() => logs.push('assembly still loading'));
    await sleep(2500);
    await page.screenshot({ path: `${out}/${prefix}-3d-enclosure.png`, fullPage: W < 500 });
    const lid = (await page.$$('.bs-switch'))[1];
    if (lid) { await lid.click(); await sleep(1500); await page.screenshot({ path: `${out}/${prefix}-3d-no-lid.png`, fullPage: W < 500 }); await lid.click(); await sleep(300); }
  }
  if (tab === 'enclosure' && await page.$('.bs-seg button:nth-child(2):not([disabled])')) {
    await page.click('.bs-seg button:nth-child(2)');
    await sleep(600);
    await page.waitForFunction(() => document.querySelector('.bs-model')?.dataset.status !== 'loading', { timeout: 120000 }).catch(() => logs.push('lid still loading'));
    await sleep(2000);
    await page.screenshot({ path: `${out}/${prefix}-enclosure-lid.png`, fullPage: W < 500 });
  }
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) logs.push(`overflow-x ${tab}: ${over}px`);
}
console.log('url', page.url());
console.log(logs.join('\n') || 'no console errors');
await browser.close();
