import { launch, ORIGIN, EV } from './lib.mjs';
const MISS = '30565a98-aa8b-473f-8142-74a2ab46f4a7', HIT = 'e4579517-8211-4720-82d7-368867ed55ed';
const b = await launch(); const errs = [];
async function shot(name, w, h, path, act, wait = 4500) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, isMobile: w < 500 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(name + ': ' + e.message));
  p.on('response', r => { if (r.status() >= 400) errs.push(name + ': HTTP ' + r.status() + ' ' + r.url()); });
  await p.goto(ORIGIN + path, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.st-tabs button', { timeout: 30000 }); await p.waitForTimeout(wait);
  const r = act ? await act(p) : undefined;
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${EV}/${name}.png` });
  await ctx.close(); return r;
}
await shot('1440-case-miss', 1440, 900, `/studio?job=${MISS}&tab=case`, null, 9000);
await shot('1280-case-miss', 1280, 800, `/studio?job=${MISS}&tab=case`, null, 9000);
await shot('1280-pcb', 1280, 800, `/studio?job=${HIT}&tab=pcb`, null, 7000);
await shot('1280-chip-open', 1280, 800, `/studio?job=${HIT}&tab=firmware`, p => p.click('.st-proof-chip'));
const kb = await shot('1280-chip-keyboard', 1280, 800, `/studio?job=${HIT}&tab=firmware`, async p => { await p.focus('.st-proof-chip'); await p.keyboard.press('Enter'); const opened = await p.isVisible('.st-proof-list'); await p.keyboard.press('Escape'); return { opened, closedOnEsc: !(await p.isVisible('.st-proof-list')) }; });
await shot('390-canvas', 390, 844, `/studio?job=${MISS}&tab=schematic`);
await shot('390-chip-open', 390, 844, `/studio?job=${MISS}&tab=schematic`, p => p.tap('.st-proof-chip'));
const hist = await shot('390-chat', 390, 844, `/studio?job=${MISS}&tab=schematic`, async p => { await p.tap('.st-work .st-switch button:first-child'); await p.waitForTimeout(200); return { placeholder: await p.getAttribute('#st-input', 'placeholder'), followUps: await p.locator('.st-followups').count() }; });
await b.close();
console.log(JSON.stringify({ kb, hist, errs }, null, 1));
