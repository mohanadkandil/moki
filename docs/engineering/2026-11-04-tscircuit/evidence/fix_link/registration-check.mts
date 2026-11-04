import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {parse} from 'dotenv';
import {Auth} from '/home/sogo/projects/sogo-apps/src/auth.ts';
const state=(unit:string,property:string)=>execFileSync('systemctl',['--user','show',unit,'--property='+property,'--value'],{encoding:'utf8'}).trim();
const before={rigrove:state('rigrove.service','ActiveState'),rigrovePid:state('rigrove.service','MainPID'),moki:state('moki.service','ActiveState')};
assert.equal(before.rigrove,'active');assert.equal(before.moki,'inactive');
execFileSync('systemctl',['--user','restart','sogo-apps.service']);
const env=parse(await readFile('/home/sogo/.config/sogo-apps/auth.env','utf8'));
const auth=new Auth(env.SOGO_VAULT_PASSWORD_HASH,env.SOGO_VAULT_SESSION_SECRET),session=auth.session();
let response:Response|undefined;
for(let attempt=0;attempt<20;attempt++){try{response=await fetch('http://127.0.0.1:8793/api/apps',{headers:{Cookie:'sogo_apps_session='+session}});break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
assert(response);assert.equal(response.status,200);
const registry=await response.json();
assert.equal(registry.apps.find((app:any)=>app.id==='rigrove').state,'running');assert.equal(registry.apps.find((app:any)=>app.id==='moki').state,'stopped');
assert.equal(state('rigrove.service','MainPID'),before.rigrovePid);assert.equal(state('moki.service','MainPID'),'0');
const receipt=JSON.parse(await readFile('/home/sogo/.local/share/sogo-apps/preview.json','utf8'));
const external=[];
for(const path of ['/app/moki','/app/moki/studio','/app/moki/api/board/jobs','/app/moki/assets/missing.js']){
 const r=await fetch(receipt.url+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});external.push({path,status:r.status,location:r.headers.get('location')});assert.equal(r.status,path.includes('/api/')||path.includes('/assets/')?401:303);await r.body?.cancel();
}
const result={checkedAt:new Date().toISOString(),scope:'Actual Apps controller registration and public unauthenticated boundary; no Moki start, no live app switch',url:receipt.url+'/app/moki',before,after:{rigrove:state('rigrove.service','ActiveState'),rigrovePid:state('rigrove.service','MainPID'),moki:state('moki.service','ActiveState'),mokiPid:state('moki.service','MainPID'),mokiEnablement:state('moki.service','UnitFileState')},registry:registry.apps,external};
await writeFile(new URL('./registration-check.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
