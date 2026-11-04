// Offline evidence only; no build, server or production process.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
const root = resolve('docs/engineering/2026-11-04-canvas-tools/evidence/edit_core');
const {chromium} = await import('/tmp/robotics-report-preview/node_modules/playwright/index.mjs');
const browser = await chromium.launch({executablePath: resolve(homedir(),'.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell'),headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:resolve(homedir(),'.local/share/sogo-diagrams/lib')}});
try {
 const page = await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});
 for(const label of ['before','moved']) {
  const svg = await readFile(resolve(root,`dev-${label}`,'pcb.svg'),'utf8');
  await page.setContent(`<style>body{margin:0;background:#fff;display:grid;place-items:center;height:100vh}svg{width:95vw;height:95vh}</style>${svg}`);
  await page.screenshot({path:resolve(root,`${label}-pcb.png`)});
 }
} finally {await browser.close();}
for(const label of ['before','moved']) {
 const run = spawnSync(resolve(homedir(),'.bun/bin/bun'),['eda/models/render-evidence.ts',resolve(root,`dev-${label}`,'assembly.glb'),resolve(root,`${label}-case.png`),'--opaque-lid'],{stdio:'inherit'});
 if(run.status!==0)throw new Error(`Case capture failed: ${label}`);
}
