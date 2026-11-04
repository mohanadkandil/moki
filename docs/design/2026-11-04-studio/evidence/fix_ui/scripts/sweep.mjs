import { launch, ORIGIN, EV } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const JOBS = { clean: 'e9a1c84b-88de-42a2-a052-6381afad27ec', failed: '2f99d52a-46c3-4bca-90b8-0b2b6b58e9bf' };
const b = await launch(); const out = [];
const measure = () => {
  const vis = el => el && getComputedStyle(el).display !== 'none';
  const tabs = document.querySelector('.st-tabs'), bar = document.querySelector('.st-bar');
  const tr = tabs.getBoundingClientRect();
  const clipped = [...tabs.querySelectorAll('button')].filter(t => { const r = t.getBoundingClientRect(); return r.right > tr.right + 0.5 || r.left < tr.left - 0.5; }).map(t => t.textContent);
  const pill = document.querySelector('.st-proof'), menu = document.querySelector('.st-proof-menu');
  return { tabsW: Math.round(tr.width), natural: tabs.scrollWidth, squeezed: tabs.scrollWidth > tabs.clientWidth + 0.5, clipped, barOverflow: bar.scrollWidth > bar.clientWidth + 0.5, right: Math.round(document.querySelector('.st-bar-right').getBoundingClientRect().width), work: Math.round(document.querySelector('.st-work').getBoundingClientRect().width), mode: vis(pill) ? 'pill' : vis(menu) ? 'chip' : 'none', labels: vis(pill) ? [...pill.querySelectorAll('li')].map(l => l.textContent) : [document.querySelector('.st-proof-chip')?.textContent] };
};
for (const [name, id] of Object.entries(JOBS)) {
  const p = await b.newPage({ viewport: { width: 1500, height: 800 } });
  await p.goto(`${ORIGIN}/studio?job=${id}&tab=firmware`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.st-tabs button', { timeout: 30000 }); await p.waitForTimeout(3500);
  for (const w of [1600,1500,1460,1440,1420,1400,1380,1360,1340,1320,1300,1280,1260,1241,1240,1220,1200,1180,1160,1140,1120,1100,1080,1060,1040,1024,1001,1000,980,960,940,920,901,900,860,820,768,480,430,390,360,320]) {
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(60);
    out.push({ job: name, w, ...(await p.evaluate(measure)) });
  }
  await p.close();
}
await b.close();
writeFileSync(EV + '/bar-sweep.json', JSON.stringify(out, null, 1));
for (const r of out) console.log(r.job.padEnd(7), String(r.w).padStart(5), r.mode.padEnd(5), 'work', r.work, 'tabs', r.tabsW, 'nat', r.natural, 'right', r.right, r.squeezed ? 'SQUEEZED' : '', r.barOverflow ? 'BAROVER' : '', r.clipped.join(','), '|', r.labels.join(' / '));
