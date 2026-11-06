// Diagnostic replay of the pinned native pipeline's own final width stage.
// Input is a real completed pre-pour native capture; no model or handwritten routing.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {SOLVERS} from 'tscircuit';
const source=resolve(process.argv[2]!),out=resolve(process.argv[3]!);
await mkdir(out,{recursive:true});
const inputRaw=await readFile(resolve(source,'router-input.json'),'utf8'),raw=await readFile(resolve(source,'pre-pour-circuit.json'),'utf8');
const input=JSON.parse(inputRaw),circuit=JSON.parse(raw);
const previous=process.argv[4] ? JSON.parse(await readFile(resolve(process.argv[4]),'utf8')) : null;
const traces=previous ?? circuit.filter((e:any)=>e.type==='pcb_trace'&&!e.pcb_trace_id.startsWith('saved_phase_'));
if(input.traces?.length||!traces.length)throw Error('Diagnostic requires the actual single joint native phase with no mutable preloads');
const pipeline=new SOLVERS.AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null});
const step=pipeline.pipelineDef.find(p=>p.solverName==='powerTraceExpansionSolver');
if(!step)throw Error('Pinned native width-stage constructor not available');
const Stage=step.solverClass as any;
const fabrication=process.argv[5]==='fabrication';
const selected=fabrication ? [...new Set(traces.filter((t:any)=>t.route.some((p:any)=>p.route_type==='wire'&&p.width<.15-1e-9)).map((t:any)=>t.connection_name))] : input.connections.map((c:any)=>c.name);
const stageInput=fabrication ? {...input,defaultObstacleMargin:.127,minTraceToPadEdgeClearance:.127,minViaEdgeToPadEdgeClearance:.127} : input;
const stage=new Stage({...stageInput,traces,fixedTraces:[]},{onlyConnectionNames:selected,allowNewVias:false});
const started=performance.now();
while(!stage.solved&&!stage.failed){
 const until=performance.now()+100;
 while(!stage.solved&&!stage.failed&&performance.now()<until)stage.step();
 if(performance.now()-started>90000)throw Error('Native width diagnostic exceeded90seconds');
 await new Promise(r=>setTimeout(r,0));
}
if(stage.failed)throw Error(stage.error??'Native width diagnostic failed');
const result=stage.getOutput();
const min=(ts:any[])=>Math.min(...ts.flatMap(t=>t.route.filter((p:any)=>p.route_type==='wire').map((p:any)=>p.width)));
await writeFile(resolve(out,'width-native.json'),JSON.stringify(result));
await writeFile(resolve(out,'width-result.json'),JSON.stringify({source,inputSha256:createHash('sha256').update(inputRaw).digest('hex'),rawSha256:createHash('sha256').update(raw).digest('hex'),solver:'native Pipeline9 PowerTraceExpansionSolver',onlyConnectionNames:selected,fabricationPlanning: fabrication,allowNewVias:false,ms:performance.now()-started,traceCount:result.length,beforeMin:min(traces),afterMin:min(result),stats:stage.stats},null,2)+'\n');
console.log(JSON.stringify({ms:performance.now()-started,traceCount:result.length,beforeMin:min(traces),afterMin:min(result)}));
