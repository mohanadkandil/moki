// Supplement to stock film: 60 fps virtual clock for ARM software-WebGL sampling.
// Reuses Stageshow's own recorder and geometry analyser without changing their rules.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {launch} from './browser.mjs'
import {record,analyse,contentChanges} from './jumps-core.mjs'
import {instrumentationSource,coverage} from './verification.mjs'
import {filmChecksSource} from './film-checks.mjs'
const width=Number(process.argv[2]||1280),out=path.resolve('../evidence/design_stage'),tag=width===390?'mobile':'wide'
const code=ts.transpileModule(fs.readFileSync('kit/clock.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^export /gm,'')
const b=await launch(),p=await b.newPage({viewport:{width,height:1000},deviceScaleFactor:1})
await p.addInitScript({content:code+'; installVirtualClock({fps:60});'})
await p.addInitScript({content:instrumentationSource(record)})
await p.addInitScript({content:filmChecksSource()})
await p.goto((process.env.DEMO_URL||'http://127.0.0.1:5188')+'/?capture=hero',{waitUntil:'networkidle'})
await p.evaluate(async()=>{await window.__stageshow.clock.settle();await window.__stageshow.clock.flushLayout()})
await p.waitForSelector('.ss-stage'); const shots=[],findings=[]
let last='',pending=[],marks=[]
const shot=async(label)=>{const s=p.locator('.ss-stage');const buf=await s.screenshot({timeout:30000});const name=`fixed-${tag}-${String(shots.length).padStart(2,'0')}.png`;fs.writeFileSync(path.join(out,name),buf);shots.push({label,src:'data:image/png;base64,'+buf.toString('base64')});const f=await p.evaluate(()=>window.__ssFilmChecks.checkStage(document.querySelector('.ss-stage')));findings.push({label,findings:f})}
await shot('opening')
for(let frame=1;frame<=1320;frame++){
 const mark=await p.evaluate(async()=>{await window.__stageshow.clock.step(1);return document.querySelector('.ss-stage')?.dataset.mark})
 if(mark&&mark!==last){last=mark;marks.push({mark,frame,seconds:frame/60});pending.push({frame:frame+42,label:mark+' +0.7s'});await shot(mark)}
 while(pending.length&&pending[0].frame<=frame){await shot(pending.shift().label)}
}
await shot('next loop')
const snapshot=await p.evaluate(()=>{window.__ssVerification.stopped=true;return window.__ssVerification})
const result={width,clock:'60 fps Stageshow installVirtualClock',marks,stages:Object.fromEntries(Object.entries(snapshot.stages).map(([key,s])=>[key,{coverage:coverage(s.frames),jumps:analyse(s.frames),manual:contentChanges(s.frames)}])),checks:findings,errors:snapshot.errors}
fs.writeFileSync(path.join(out,`fixed-${tag}.json`),JSON.stringify(result,null,2)+'\n')
await p.close()
const stageW=width===390?358:1040,stageH=width===390?800:700,cols=width===390?4:2
const sheet=await b.newPage({viewport:{width:cols*(stageW+12)+12,height:900},deviceScaleFactor:1})
await sheet.setContent(`<body style="margin:0;background:#e9e9e9;font:12px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${stageW}px);gap:12px;padding:12px">${shots.map(s=>`<figure style="margin:0"><figcaption style="padding:6px">${s.label}</figcaption><img src="${s.src}" width="${stageW}" height="${stageH}"></figure>`).join('')}</div>`)
await sheet.waitForLoadState('load');await sheet.screenshot({path:path.join(out,`fixed-${tag}-contact.png`),fullPage:true,timeout:120000});await b.close()
console.log(JSON.stringify({width,shots:shots.length,stages:result.stages,errors:result.errors},null,2))
