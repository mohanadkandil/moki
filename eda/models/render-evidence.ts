// Evidence capture only. No server and no production build; Chromium loads a bundled local HTML file.
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';import { tmpdir,homedir } from 'node:os';
const model=resolve(process.argv[2]!),png=resolve(process.argv[3]!);
const build=await Bun.build({entrypoints:[resolve(import.meta.dir,'evidence-page.ts')],target:'browser',minify:true});if(!build.success)throw new Error(String(build.logs));
const dir=mkdtempSync(join(tmpdir(),'moki-model-evidence-'));
try {const html=join(dir,'view.html');writeFileSync(html,`<!doctype html><body><script>window.__OPAQUE_LID=${process.argv.includes('--opaque-lid')};window.__MODEL=${JSON.stringify(readFileSync(model).toString('base64'))}</script><script type="module">${(await build.outputs[0]!.text()).replace(/<\/script/g,'<\\/script')}</script>`);
 const chrome=join(homedir(),'.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell');
 const driver=await import(process.env.MOKI_PLAYWRIGHT_MODULE ?? '/tmp/robotics-report-preview/node_modules/playwright/index.mjs');
 const browser=await driver.chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],env:{...process.env,LD_LIBRARY_PATH:join(homedir(),'.local/share/sogo-diagrams/lib')}});
 try {
   const page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});
   const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(String(e)));
   await page.goto(`file://${html}`);
   await page.waitForFunction(()=>Boolean((window as any).__DONE),{},{timeout:60000});
   if(errors.length)throw new Error(errors.join('\n'));
   await page.screenshot({path:png});console.log(png);
 } finally {await browser.close();}
} finally {rmSync(dir,{recursive:true,force:true});}
