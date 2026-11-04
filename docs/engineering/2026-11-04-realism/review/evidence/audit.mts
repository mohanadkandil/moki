import { readFile, writeFile, mkdir, symlink, utimes, access, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { CATALOG } from '../../../../../src/circuit/catalog.ts';
import { createBoardService, runBoardProcess } from '../../../../../server/board-api.ts';
import { mokiRouteAllowed } from '/home/sogo/projects/sogo-apps/src/moki.ts';
const out=resolve('docs/engineering/2026-11-04-realism/review/evidence');
await writeFile(join(out,'catalog.json'),JSON.stringify(Object.fromEntries(CATALOG)));
const measurements=JSON.parse(await readFile('docs/engineering/2026-11-04-realism/evidence/real_models/measurements.json','utf8'));
const results:any={};
for(const [template,m] of Object.entries(measurements) as any) {
 const from=resolve('var/board-jobs',m.jobId), dir=join(out,'copper',template);await mkdir(dir,{recursive:true});
 for(const name of ['design.json','board-metadata.json','circuit.json'])await writeFile(join(dir,name),await readFile(join(from,name)));
 const original=JSON.parse(await readFile(join(dir,'circuit.json'),'utf8'));
 const run=async(label:string)=>{const r=await runBoardProcess('python3',['tests/board-connectivity.py',dir,join(out,'catalog.json')],process.cwd());await writeFile(join(dir,label+'.log'),r.stdout+r.stderr);return r.code;};
 results[template]={normal:await run('normal')};
 if(template==='temp-monitor') {
  const damaged=structuredClone(original), vias=damaged.filter((e:any)=>e.type==='pcb_via');
  for(const via of vias)via.hole_diameter=via.outer_diameter+1;
  await writeFile(join(dir,'circuit.json'),JSON.stringify(damaged));
  results[template].oversizeDrill={count:vias.length,oracleExit:await run('oversize-drill')};
  await writeFile(join(dir,'oversize-drill-circuit.json'),JSON.stringify(damaged));
  const noTraces=original.filter((e:any)=>e.type!=='pcb_trace');
  await writeFile(join(dir,'circuit.json'),JSON.stringify(noTraces));results[template].removedTraces=await run('removed-traces');
  await writeFile(join(dir,'circuit.json'),JSON.stringify(original));
 }
 const glb=await readFile(join(from,'board.glb'));const g=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
 results[template].bytes={board:glb.length,assembly:(await readFile(join(from,'assembly.glb'))).length};
 results[template].seats=g.nodes.filter((n:any)=>n.extras?.moki).map((n:any)=>({name:n.name,min:Math.min(...g.meshes[n.mesh].primitives.map((p:any)=>g.accessors[p.attributes.POSITION].min[1]))+(n.translation?.[1]??0),seat:.8+n.extras.moki.seatHeightMm}));
}
// Exercise middleware directly: no HTTP servers, no actual secrets, all fixtures inside evidence.
const id='11111111-1111-4111-8111-111111111111', root=join(out,'security-root'), jobsRoot=join(root,'var/board-jobs-app'), dir=join(jobsRoot,id);
await mkdir(dir,{recursive:true});await writeFile(join(dir,'job.json'),JSON.stringify({jobId:id,status:'done',artifacts:{'kicad.zip':{},'pcb.svg':{}},input:{},createdAt:'2026-11-04'}));
await writeFile(join(out,'outside.txt'),'review fixture only');await rm(join(dir,'pcb.svg'),{force:true});await symlink(join(out,'outside.txt'),join(dir,'pcb.svg'));
await writeFile(join(dir,'kicad.zip'),'fixture zip bytes');
const old=join(root,'var/mech-cache','a'.repeat(64));await mkdir(old,{recursive:true});await writeFile(join(old,'marker'),'old fixture');const age=new Date(Date.now()-8*86400000);await utimes(old,age,age);
process.env.MOKI_BOARD_API_TOKEN='review-fixture-token';const service=createBoardService({root,jobsRoot});delete process.env.MOKI_BOARD_API_TOKEN;
async function request(url:string,token?:string,method='GET',origin?:string) {const req:any=Readable.from([]);req.url=url;req.method=method;req.headers={host:'owner.example',...(token?{'x-moki-capability':token}:{}),...(origin?{origin}:{})};const res:any={status:0,headers:{},body:'',writeHead(s:number,h:any){this.status=s;this.headers=h;},end(b:any){this.body=String(b??'');}};await service.handle(req,res,()=>{res.status=404;});return {status:res.status,headers:res.headers,body:res.body};}
results.security={};for(const route of ['/api/board/jobs',`/api/board/jobs/${id}/files/kicad.zip`,'/api/board/unknown'])for(const token of [undefined,'wrong','review-fixture-token'])results.security[route+':'+String(token)]=await request(route,token);
results.security.symlink=await request(`/api/board/jobs/${id}/files/pcb.svg`,'review-fixture-token');
results.security.traversal=await request(`/api/board/jobs/${id}/files/%2e%2e`,'review-fixture-token');
results.security.foreignOrigin=await request('/api/board/jobs','review-fixture-token','POST','https://foreign.example');
results.productionMechCacheSurvivesEviction=await access(old).then(()=>true,()=>false);await service.close();
results.gatewayRoutes=Object.fromEntries(['/studio','/@fs/etc/passwd','/api/runs','/api/board/jobs',`/api/board/jobs/${id}/files/kicad.zip`,'/assets/../src/App.tsx'].map(p=>[p,mokiRouteAllowed('GET',p)]));
process.env.MOKI_REVIEW_PARENT_SENTINEL='fixture-secret';const child=await runBoardProcess(process.execPath,['-e','console.log(process.env.MOKI_REVIEW_PARENT_SENTINEL ?? "absent")'],process.cwd());delete process.env.MOKI_REVIEW_PARENT_SENTINEL;results.envSentinel=child.stdout.trim();
await writeFile(join(out,'audit.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({templates:Object.fromEntries(Object.entries(results).filter(([k])=>k.includes('-')).map(([k,v]:any)=>[k,{normal:v.normal,damage:v.oversizeDrill}])),cacheSurvives:results.productionMechCacheSurvivesEviction,env:results.envSentinel},null,2));
