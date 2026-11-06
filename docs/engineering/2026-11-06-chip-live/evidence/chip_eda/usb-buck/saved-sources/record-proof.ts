/** Pure official checks against immutable captured native output; no native render. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {repairSavedSources} from '../../../../../../../eda/blocks/repair-saved-sources.js';
import {checkEachPcbTraceNonOverlapping,checkPadTraceClearance,checkViaTraceClearance} from '../../../../../../../eda/node_modules/@tscircuit/checks/dist/index.js';
const root=new URL('./',import.meta.url),read=(name:string)=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
const original=read('circuit.json'),graph=read('plan-graph.json'),mapping=Object.fromEntries(read('import-map.json').parts.map((p:any)=>[p.ref,p.pins])),phase=read('fanout-phase.json'),inputs=read('native-routing.json');
const result=repairSavedSources(original,graph,mapping,phase,{nativeRoutingInputs:inputs});
const check=(c:any[])=>{const x=structuredClone(c);return [...checkEachPcbTraceNonOverlapping(x),...checkPadTraceClearance(x),...checkViaTraceClearance(x)];};
const before=check(original),after=check(result.circuit),hash=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const geometry=(c:any[])=>c.filter(e=>e.type==='pcb_trace').map(e=>({id:e.pcb_trace_id,route:e.route}));
const evidence={kind:'pure-official-check-regression-not-a-new-native-route',actualJob:'53a0adba-0f2f-41d9-ac61-d43805a2e45e',audit:result.audit,unrepairedTraceIds:result.unrepairedTraceIds,before:{count:before.length,errors:before,geometrySha256:hash(geometry(original))},after:{count:after.length,errors:after,geometrySha256:hash(geometry(result.circuit))},originalFailureRecordsPreserved:hash(original.filter((e:any)=>e.error_type))===hash(result.circuit.filter((e:any)=>e.error_type)),nativeSourceRecordsPreserved:hash(original.filter((e:any)=>e.type.startsWith('source_')))===hash(result.circuit.filter((e:any)=>e.type.startsWith('source_'))),changes:result.circuit.flatMap((e:any,i:number)=>JSON.stringify(e)===JSON.stringify(original[i])?[]:[{id:e.pcb_trace_id,before:original[i],after:e}])};
writeFileSync(new URL('proof.json',root),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({before:before.length,after:after.length,repairs:result.audit,geometryUnchanged:evidence.before.geometrySha256===evidence.after.geometrySha256,originalFailureRecordsPreserved:evidence.originalFailureRecordsPreserved}));
