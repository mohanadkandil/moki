// Recheck actual captured native copper after the native width stage; diagnostic only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import{resolve}from'node:path';
import{repairNativeExits}from'./repair-native-exits';import{runAllPlacementChecks,runAllRoutingChecks}from'@tscircuit/checks';
const source=resolve(process.argv[2]!),candidate=resolve(process.argv[3]!),out=resolve(process.argv[4]!);await mkdir(out,{recursive:true});
const json=async(n:string)=>JSON.parse(await readFile(resolve(source,n),'utf8'));
const original=await json('pre-pour-circuit.json'),next=JSON.parse(await readFile(candidate,'utf8'));
const byId=new Map(next.map((t:any)=>[t.pcb_trace_id,t]));
const circuit=original.map((e:any)=>e.type==='pcb_trace'&&byId.has(e.pcb_trace_id)?byId.get(e.pcb_trace_id):e);
const graph=await json('plan-graph.json'),mapping=Object.fromEntries((await json('import-map.json')).parts.map((p:any)=>[p.ref,p.pins]));
const repaired=repairNativeExits(circuit,graph,mapping,await json('native-exit-phase.json'),{nativeRoutingInputs:[{solver:'AutoroutingPipelineSolver9_PreloadedTraceGraph',input:{input:await json('router-input.json')}}]});
await writeFile(resolve(out,'repaired-circuit.json'),JSON.stringify(repaired.circuit));
const issues=[...await runAllPlacementChecks(structuredClone(repaired.circuit)),...await runAllRoutingChecks(structuredClone(repaired.circuit))];
const errors=issues.filter((i:any)=>i.type.endsWith('_error'));
await writeFile(resolve(out,'checks.json'),JSON.stringify({repaired:repaired.audit,viaAudit:repaired.viaAudit,unrepaired:repaired.unrepairedTraceIds,errors,allIssues:issues},null,2));
console.log(JSON.stringify({repairs:repaired.audit.length,unrepaired:repaired.unrepairedTraceIds,errors:errors.length,first:errors.slice(0,10)}));
