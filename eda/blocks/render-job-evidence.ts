// Offline artifact captures only: no app server, production build or replacement circuit.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg';
const job=resolve(process.argv[2]!),out=resolve(process.argv[3]!);
const circuit=JSON.parse(await readFile(join(job,'circuit.json'),'utf8'));
const record=JSON.parse(await readFile(join(job,'job.json'),'utf8'));
const schematic=await readFile(join(job,'schematic.svg'),'utf8');
const plan=JSON.parse(await readFile(join(job,'plan.json'),'utf8'));
await mkdir(out,{recursive:true});
const chrome=join(homedir(),'.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell');
const driver=await import(process.env.MOKI_PLAYWRIGHT_MODULE ?? '/tmp/robotics-report-preview/node_modules/playwright/index.mjs');
const browser=await driver.chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:join(homedir(),'.local/share/sogo-diagrams/lib')}});
const dir=await mkdtemp(join(tmpdir(),'moki-chip-captures-'));
const title=record.status==='done'?'Native DRC + sandbox compile passed':'Diagnostic: build failed';
const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]!);
const header=(view:string)=>`<header><b>Moki · ${view}</b><span>${title} · job ${record.jobId}</span></header>`;
const note=record.status==='done'?'Actual job artifacts. Additional PCB-style and hardware limits are documented in the engineering report.':`Diagnostic only: ${record.drc?.errors?.length ?? 'see gates.json for'} native errors. This candidate has not passed routing/DRC.`;
const shell=(content:string)=>`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f3f4f1;color:#172a24;font:18px Arial}header{height:90px;padding:22px 30px;display:flex;flex-direction:column;gap:10px}header b{font-size:25px}header span{font-size:15px;color:#48544e}main{padding:0 25px 25px}svg{display:block;width:100%;height:auto;max-height:calc(100vh - 115px)}footer{padding:0 30px;color:#48544e;font-size:14px}</style>${content}`;
const receipt:any={jobId:record.jobId,status:record.status,scope:'Offline screenshots of the actual Moki job artifacts; no app UI/server capture and no reference artifacts substituted',captures:[]};
try{
 for(const [name,viewport,content] of [
  ['schematic',{width:2200,height:1080},header(escape(plan.title)+' · schematic')+`<main>${schematic}</main><footer>${note}</footer>`],
  ...(['top','bottom'] as const).map(layer=>[ `pcb-${layer}`,{width:1400,height:1200},header(`PCB · ${layer} copper`)+`<main>${convertCircuitJsonToPcbSvg(circuit,{width:1300,height:1000,layer,shouldDrawErrors:false,shouldDrawWarnings:false,showPinNumbers:true,showCourtyards:false,showPcbGroups:false,backgroundColor:'#f8faf7',drawPaddingOutsideBoard:true})}</main><footer>${note}</footer>`] as const),
  ...(record.status==='done'?[]:[['drc-failures',{width:1800,height:1100},header('native DRC failures')+`<main><ol style="font-size:18px;line-height:1.5">${(record.drc?.errors??[]).map((item:any)=>`<li style="margin:0 0 17px">${escape(item.message)}</li>`).join('')}</ol></main><footer>Native errors from this exact job. Copper views omit overlapping error annotations so the actual geometry stays readable.</footer>`] as const]),
 ] as const){
  const page=await browser.newPage({viewport});
  const html=join(dir,name+'.html');await writeFile(html,shell(content));await page.goto('file://'+html);await page.screenshot({path:join(out,name+'.png')});await page.close();receipt.captures.push({name,file:name+'.png'});
 }
 const sources=circuit.filter((e:any)=>e.type==='source_component');
 const cad=circuit.filter((e:any)=>e.type==='cad_component');
 receipt.models={sourceParts:sources.length,cadRecords:cad.length,declaredExternalModels:cad.filter((e:any)=>e.model_obj_url||e.model_step_url||e.model_stl_url).length,missingCad:sources.filter((s:any)=>!cad.some((c:any)=>c.source_component_id===s.source_component_id)).map((s:any)=>s.name),note:'Native job GLB uses declared importer models; dimensions, material fidelity and manufacturer STEP equivalence are not independently qualified.'};
 await writeFile(join(out,'capture-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
