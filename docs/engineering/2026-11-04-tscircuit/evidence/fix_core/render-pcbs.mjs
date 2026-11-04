import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
const root = resolve('docs/engineering/2026-11-04-tscircuit/evidence/fix_core');
const chrome = resolve(homedir(), '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell');
for (const template of ['focus-timer', 'light-lamp', 'temp-monitor']) {
  const svg = readFileSync(resolve(root, template, 'pcb.svg')).toString('base64');
  const html = resolve(root, template, 'pcb.html');
  writeFileSync(html, `<html><body style="margin:0;background:#151b22;color:white;font:20px sans-serif"><div style="padding:14px">${template}: generated PCB, top view</div><img style="display:block;margin:auto;width:1040px;height:1270px;object-fit:contain" src="data:image/svg+xml;base64,${svg}"></body></html>`);
  execFileSync(chrome, ['--no-sandbox', '--hide-scrollbars', '--window-size=1100,1340', '--virtual-time-budget=1000', `--screenshot=${resolve(root, template, 'pcb.png')}`, `file://${html}`], {env:{...process.env,LD_LIBRARY_PATH:resolve(homedir(),'.local/share/sogo-diagrams/lib')},stdio:'pipe',timeout:20000});
  console.log(template);
}
