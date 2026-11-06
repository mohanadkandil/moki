/** Bounded native cleanup evidence only. Never edits the accepted job. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {getSimpleRouteJsonFromCircuitJson} from '@tscircuit/core';
import {AutoroutingPipelineSolver11_Simplification} from '@tscircuit/capacity-autorouter';
import {checkPcbTraceStyle,runAllPlacementChecks,runAllRoutingChecks,checkViasOffBoard,checkPcbTraceLengths,checkPcbTraceViaCounts} from '@tscircuit/checks';
const job=resolve('var/board-jobs-test-chip/193f6a73-452d-4124-9785-0a14940322b0');
const out=resolve('docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-motor');
const options={iterations:2,enableVertexShortcuts:false,enableCrossingViaReduction:false};
const sha=(b:string)=>createHash('sha256').update(b).digest('hex');
const receipt:any={scope:'bounded native P11 cleanup probe only; accepted job never modified',accepted:false,job,options,startedAt:new Date().toISOString()};
await mkdir(out,{recursive:true});
const save=(n:string,v:any)=>writeFile(resolve(out,n),JSON.stringify(v,null,2)+'\n');
const fatal=(m:string)=>{throw new Error(m);};
try{
 const raw=await readFile(resolve(job,'circuit.json'),'utf8');receipt.originalCircuitSha256=sha(raw);
 const original:any[]=JSON.parse(raw);
 const board=original.find(e=>e.type==='pcb_board');if(!board)fatal('Missing actual PCB board');
 const clean=original.filter(e=>!e.type?.endsWith('_error'));
 const traces=clean.filter(e=>e.type==='pcb_trace');
 receipt.baseline={traces:traces.length,style:checkPcbTraceStyle(clean)};
 const {simpleRouteJson:srj}=getSimpleRouteJsonFromCircuitJson({circuitJson:structuredClone(clean) as any,subcircuit_id:board.subcircuit_id,ignoreExistingTopLevelPcbRouteState:false});
 receipt.converted={traces:srj.traces?.length,connections:srj.connections.length,layerCount:srj.layerCount};
 if(srj.traces?.length!==traces.length)fatal('Public SRJ converter did not preserve every actual PCB trace');
 const ids=new Map(traces.map(t=>[t.pcb_trace_id,t]));
 if(srj.traces!.some(t=>!ids.has(t.pcb_trace_id)))fatal('Public SRJ converter changed PCB trace identities');
 await save('style-input-srj.json',srj);
 const started=performance.now(),solver=new AutoroutingPipelineSolver11_Simplification(srj,options);
 let steps=0;
 while(!solver.solved&&!solver.failed&&performance.now()-started<30_000){
  if(typeof (solver as any).stepAsync==='function')await (solver as any).stepAsync();else solver.step();steps++;
 }
 receipt.solver={ms:performance.now()-started,steps,status:solver.failed?'failed':solver.solved?'solved':'timed-out',error:solver.error};
 if(solver.failed||!solver.solved)fatal('Native P11 did not produce a fully solved cleanup within30s');
 const result=solver.getOutputSimpleRouteJson();await save('style-output-srj.json',result);
 if(result.traces?.length!==traces.length)fatal('Native cleanup changed trace count; unsupported for metadata-preserving route replacement');
 const outputMap=new Map(result.traces!.map(t=>[t.pcb_trace_id,t]));
 if(outputMap.size!==traces.length||traces.some(t=>!outputMap.has(t.pcb_trace_id)))fatal('Native cleanup changed/duplicated trace identities');
 const viaKey=(route:any[])=>JSON.stringify(route.filter(p=>p.route_type==='via').map(p=>({x:p.x,y:p.y,from_layer:p.from_layer,to_layer:p.to_layer,hole_diameter:p.hole_diameter,outer_diameter:p.outer_diameter})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 let changed=0;
 const candidate=structuredClone(clean).map(e=>{
  if(e.type!=='pcb_trace')return e;
  const next=outputMap.get(e.pcb_trace_id)!;
  if(viaKey(next.route)!==viaKey(e.route))fatal('Native cleanup changed via geometry; standalone-via-preserving conversion is unsupported');
  for(const end of [0,-1]){
   const a=e.route.at(end),b=next.route.at(end);
   if(!a||!b||a.route_type!==b.route_type||Math.hypot(a.x-b.x,a.y-b.y)>1e-6||a.layer!==b.layer)fatal('Native cleanup changed physical trace terminal geometry');
  }
  if(JSON.stringify(e.route)!==JSON.stringify(next.route))changed++;
  return {...e,route:structuredClone(next.route)};
 });
 const nonTrace=(cj:any[])=>JSON.stringify(cj.filter(e=>e.type!=='pcb_trace'));
 if(nonTrace(candidate)!==nonTrace(clean))fatal('Non-trace native records changed');
 await save('style-candidate-circuit.json',candidate);
 const checks=[...await runAllPlacementChecks(structuredClone(candidate) as any),...await runAllRoutingChecks(structuredClone(candidate) as any),...checkViasOffBoard(candidate as any)];
 const errors=checks.filter(e=>e.type.endsWith('_error'));
 const style=checkPcbTraceStyle(candidate as any);
 const clockChecks=[...checkPcbTraceLengths(candidate as any),...checkPcbTraceViaCounts(candidate as any)];
 receipt.candidate={changedTraces:changed,style,errors,clockChecks,sourceAndPadsUnchanged:true,viaGeometryUnchanged:true,traceCount:result.traces?.length};
 receipt.accepted=errors.length===0&&clockChecks.length===0&&style.length===0;
 receipt.note=receipt.accepted?'Candidate passes this native probe; official all-layer Gerber shorts and artifact regeneration remain required before integration.':'Candidate is not accepted; original passing job remains unchanged.';
}catch(error){receipt.error=String(error);receipt.accepted=false;}
finally{await save('style-probe.json',receipt);console.log(JSON.stringify({accepted:receipt.accepted,baselineStyle:receipt.baseline?.style?.length,converted:receipt.converted,solver:receipt.solver,candidateStyle:receipt.candidate?.style?.length,candidateErrors:receipt.candidate?.errors?.length,clockErrors:receipt.candidate?.clockChecks?.length,error:receipt.error}));}
