// A real model through the real chip-level agents and real blocks, stopping where the job API would start,
// because chip_eda's { plan } adapter isn't ready. Logs every call's cost. Args: evidence dir, brief.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R='/home/sogo/design-skill-research/repos/moki';
const {createProvider,redact}=await import(`${R}/src/agents/model.ts`);
const {runTurn}=await import(`${R}/src/agents/turn.ts`);
const {realChipLibrary}=await import(`${R}/src/agents/chip-library.ts`);
const {REQUIREMENT_METRICS,evaluateRequirements}=await import(`${R}/src/blocks/verify.ts`);
const out=process.argv[2]!, brief=process.argv[3]!, cap=Number(process.argv[4]??2); mkdirSync(out,{recursive:true});
const provider=createProvider(process.env,'balanced'); if(!provider) throw new Error('No model key');
const chip=realChipLibrary(); if(process.argv[5]==='no-spice') delete (chip as any).runSpiceChecks; const verify={metrics:REQUIREMENT_METRICS,evaluate:evaluateRequirements};
const log=join(R,'docs/engineering/2026-11-05-chip-level/evidence/chip_agents/agent-bench-calls.jsonl');
let submitted:any=null;
class Stop extends Error{}
const board:any={create:async(input:any)=>{submitted=input;throw new Stop('Stopped here on purpose: the { plan } job input is not ready.');},get:async()=>{throw new Stop('n/a');},artifact:async()=>null};
const events:any[]=[]; const started=performance.now();
const onCall=(r:any)=>{appendFileSync(log,`${JSON.stringify({at:new Date().toISOString(),case:'chip-dry',...r})}\n`);console.log(`  call ${r.role}: ${r.inputTokens}+${r.cacheReadTokens} in, ${r.outputTokens} out, $${r.costUsd.toFixed(4)}, ${Math.round(r.ms)} ms`);};
const first=await runTurn({message:brief,mode:'chip'},{provider,board,chip,verify,capUsd:cap,emit:(e:any)=>events.push(e),onCall});
console.log('first turn',first);
const card=events.find(e=>e.type==='requirements');
let second:any=null;
if(card){ second=await runTurn({message:card.brief,brief:card.brief,mode:'chip',requirements:card.requirements,requirementsConfirmed:true},{provider,board,chip,verify,capUsd:cap,emit:(e:any)=>events.push(e),onCall}); console.log('second turn',second); }
const usage=events.filter(e=>e.type==='done').map(e=>e.usage);
const sum=(k:string)=>usage.reduce((n,u)=>n+u[k],0);
const summary={brief,label:`measured, live model, real blocks and datasheets; no job ran${process.argv[5]==='no-spice'?'; SPICE was skipped on purpose, because of the R1 value failure in the first run':''}`,outcomes:[first,second],wallMs:Math.round(performance.now()-started),calls:sum('calls'),inputTokens:sum('inputTokens')+sum('cacheReadTokens'),outputTokens:sum('outputTokens'),costUsd:Number(sum('costUsd').toFixed(5)),agentMs:sum('agentMs'),perRole:Object.fromEntries(['verifier','designer','reviewer','fixer','firmware'].map(role=>{const c=events.filter(e=>e.type==='call'&&e.role===role);return[role,{calls:c.length,costUsd:Number(c.reduce((n,x)=>n+x.costUsd,0).toFixed(5)),ms:c.reduce((n,x)=>n+x.ms,0)}];})),requirements:card?.requirements??null,notCheckable:card?.notCheckable??null,verify:events.filter(e=>e.type==='verify').at(-1)??null,tools:events.filter(e=>e.type==='tool').map(e=>({role:e.role,name:e.name,ok:e.ok,ms:e.ms,summary:redact(e.summary)})),messages:events.flatMap(e=>e.type==='message'?[{role:e.role,text:redact(e.text)}]:e.type==='error'?[{role:'error',text:redact(e.message)}]:e.type==='decline'?[{role:'decline',text:redact(e.message+' '+(e.closest??''))}]:[]),plan:submitted?.plan?{...submitted.plan,app:submitted.plan.app?{lines:submitted.plan.app.source.split('\n').length}:undefined}:null};
writeFileSync(join(out,'chip-dry.json'),JSON.stringify(summary,null,1)+'\n');
if(submitted?.plan?.app) writeFileSync(join(out,'chip-dry.cpp'),submitted.plan.app.source);
console.log(JSON.stringify({outcomes:summary.outcomes,calls:summary.calls,costUsd:summary.costUsd,wallMs:summary.wallMs,perRole:summary.perRole}));
process.exit(0);
