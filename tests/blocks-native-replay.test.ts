import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadNativeReplay,nativeReplayInputSha256,NATIVE_REPLAY_ARTIFACTS} from '../eda/blocks/native-replay.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const json=(path:string,v:unknown)=>writeFile(path,JSON.stringify(v));
async function fixture(t:test.TestContext){
 const root=await mkdtemp(join(tmpdir(),'moki-native-replay-')),sourceJobDir=join(root,'source-job'),currentJobDir=join(root,'fresh-job'),outputPath=join(root,'native-output.json'),manifestPath=join(root,'manifest.json');
 t.after(()=>rm(root,{recursive:true,force:true}));await Promise.all([mkdir(sourceJobDir),mkdir(currentJobDir)]);
 const planned:any={layerCount:4,minTraceWidth:.15,bounds:{minX:-10,maxX:10,minY:-10,maxY:10},obstacles:[],connections:[{name:'source_net_0',nominalTraceWidth:.3,width:.3,pointsToConnect:[{x:0,y:0,layer:'top',pointId:'saved_phase_null_2_0_exit'},{x:2,y:0,layer:'bottom',pointId:'pcb_port_2'}]}],traces:[]};
 const traces:any[]=[{type:'pcb_trace',pcb_trace_id:'source_net_0_mst0_0',connection_name:'source_net_0',connectsTo:['saved_phase_null_2_0_exit','pcb_port_2'],source_trace_id:'',subcircuit_id:'native-source',nativeMetadata:{keep:['exact','order']},route:[{route_type:'wire',x:0,y:0,layer:'top',width:.15},{route_type:'wire',x:2,y:0,layer:'top',width:.4},{route_type:'via',x:2,y:0,from_layer:'top',to_layer:'bottom',via_diameter:.6,via_hole_diameter:.3},{route_type:'wire',x:2,y:0,layer:'bottom',width:.15}]}];
 await Promise.all(NATIVE_REPLAY_ARTIFACTS.flatMap(name=>[sourceJobDir,currentJobDir].map(dir=>json(join(dir,name),{schema:'derived-test-fixture',name,nested:{b:2,a:1},array:[1,2]}))));
 await json(join(sourceJobDir,'router-input.json'),planned);
 await json(join(sourceJobDir,'pre-pour-circuit.json'),[{type:'pcb_trace',pcb_trace_id:'source_net_0_mst0_0',route:traces[0].route}]);
 await json(join(sourceJobDir,'job.json'),{status:'failed',error:'Derived source-attribution failure after native output capture'});
 const manifest={sourceJobDir,outputPath,inputSha256:nativeReplayInputSha256(planned),outputSha256:sha(JSON.stringify(traces))};
 await json(outputPath,traces);await json(manifestPath,manifest);
 return{root,sourceJobDir,currentJobDir,outputPath,manifestPath,manifest,planned,traces};
}
async function replaceOutput(f:Awaited<ReturnType<typeof fixture>>,traces:any){await json(f.outputPath,traces);f.manifest.outputSha256=sha(JSON.stringify(traces));await json(f.manifestPath,f.manifest);}
const run=(f:Awaited<ReturnType<typeof fixture>>,input=f.planned)=>loadNativeReplay(f.manifestPath,f.currentJobDir,input);
test('canonical fingerprint ignores object key order and optional undefined fields while retaining exact numbers and array order',()=>{
 assert.equal(nativeReplayInputSha256({b:2,a:{d:4,c:3},optional:undefined}),nativeReplayInputSha256({a:{c:3,d:4},b:2}));
 assert.notEqual(nativeReplayInputSha256([1,2]),nativeReplayInputSha256([2,1]));assert.notEqual(nativeReplayInputSha256({x:1}),nativeReplayInputSha256({x:1+1e-15}));assert.throws(()=>nativeReplayInputSha256({x:NaN}),/nonfinite/);
});
test('matching native records survive verbatim; receipt claims reuse only and requires every fresh gate',async t=>{
 const f=await fixture(t),before=structuredClone(f.planned),out=await run(f);
 assert.equal(JSON.stringify(out.traces),await readFile(f.outputPath,'utf8'));assert.deepEqual(f.planned,before);assert.equal(out.receipt.freshRouting,false);assert.equal(out.receipt.nativeOutputReuse,true);assert.equal(out.receipt.freshGatesMandatory,true);assert.equal(out.receipt.sourceJobId,'source-job');assert.equal(out.receipt.traceCount,1);assert.equal(out.receipt.minimumWireWidthMm,.15);assert.equal(out.receipt.outputSha256,f.manifest.outputSha256);
 const reordered={...f.planned,bounds:{maxY:10,maxX:10,minY:-10,minX:-10},unused:undefined};assert.deepEqual((await run(f,reordered)).traces,f.traces);
});
test('current input, source input and declared hashes must match exactly',async t=>{
 const f=await fixture(t),changed=structuredClone(f.planned);changed.bounds.maxX+=1e-12;await assert.rejects(run(f,changed),/SRJ/);
 await json(join(f.sourceJobDir,'router-input.json'),changed);await assert.rejects(run(f),/SRJ/);await json(join(f.sourceJobDir,'router-input.json'),f.planned);
 f.manifest.inputSha256='0'.repeat(64);await json(f.manifestPath,f.manifest);await assert.rejects(run(f),/SRJ/);
});
test('plan, source graph, imports, placements, clock and native prefix changes each block replay',async t=>{
 for(const name of NATIVE_REPLAY_ARTIFACTS){const f=await fixture(t);await json(join(f.currentJobDir,name),{schema:'changed-actual-input'});await assert.rejects(run(f),new RegExp('artifact mismatch: '+name.replaceAll('.','\\.')));}
});
test('output byte hash prevents unnoticed mutation even when record shapes remain valid',async t=>{
 const f=await fixture(t);await writeFile(f.outputPath,JSON.stringify(f.traces,null,2));await assert.rejects(run(f),/output hash/);
});
test('missing native capture, a fatal native capture and a nonfailed source job are not proof of this replay source',async t=>{
 const f=await fixture(t);await unlink(join(f.sourceJobDir,'pre-pour-circuit.json'));await assert.rejects(run(f));
 await json(join(f.sourceJobDir,'pre-pour-circuit.json'),[{type:'pcb_trace'},{type:'pcb_autorouting_error'}]);await assert.rejects(run(f),/completed pre-pour/);
 await json(join(f.sourceJobDir,'pre-pour-circuit.json'),[{type:'pcb_trace'}]);await json(join(f.sourceJobDir,'job.json'),{status:'done'});await assert.rejects(run(f),/failed post-routing/);
});
test('stage0 below-floor copper, unsupported routes, foreign names, duplicate and saved-prefix IDs all reject',async t=>{
 const mutations=[
  (a:any[])=>{a[0].route[0].width=.106066;},(a:any[])=>{a[0].route[0].width=.15-2e-9;},
  (a:any[])=>{a[0].route[0].width='0.15';},(a:any[])=>{a[0].route[0].x=null;},
  (a:any[])=>{a[0].route[0].layer='unknown';},(a:any[])=>{a[0].route[0].route_type='jumper';},
  (a:any[])=>{a[0].route=[];},(a:any[])=>{a[0].connection_name='foreign';},
  (a:any[])=>{a[0].pcb_trace_id='saved_phase_null_2_0';},(a:any[])=>{a.push(structuredClone(a[0]));},
  (a:any[])=>{a[0].route[2].via_diameter=.59;},(a:any[])=>{a[0].route[2].via_hole_diameter=.6;},
  (a:any[])=>{a[0].route[2].from_layer='buried';},(a:any[])=>{a[0].route[2].layers=['unknown'];},
 ];
 const f=await fixture(t);
 for(const mutate of mutations){const a=structuredClone(f.traces);mutate(a);await replaceOutput(f,a);await assert.rejects(run(f),/Native replay/);}
 for(const a of [[],{},null]){await replaceOutput(f,a);await assert.rejects(run(f),/trace array/);}
});
test('minimum-width numeric tolerance never rounds or edits candidate copper, and motor expansion has no artificial nominal maximum',async t=>{
 const f=await fixture(t),a=structuredClone(f.traces);a[0].route[0].width=.15-.5e-9;a[0].route[1].width=.9;await replaceOutput(f,a);const out=await run(f);assert.equal(out.traces[0].route[0].width,a[0].route[0].width);assert.equal(out.traces[0].route[1].width,.9);
});
test('two-layer capture cannot replay a route onto an inner layer',async t=>{
 const f=await fixture(t);f.planned.layerCount=2;await json(join(f.sourceJobDir,'router-input.json'),f.planned);f.manifest.inputSha256=nativeReplayInputSha256(f.planned);await json(f.manifestPath,f.manifest);assert.equal((await run(f)).traces.length,1);const a=structuredClone(f.traces);a[0].route[0].layer='inner1';await replaceOutput(f,a);await assert.rejects(run(f),/wire layer/);
});

async function completedFixture(t:test.TestContext,withCachedLayers=false){
 const f=await fixture(t);await unlink(join(f.sourceJobDir,'pre-pour-circuit.json'));
 f.planned.obstacles=[{type:'rect',center:{x:5,y:5},width:1,height:2,layers:['top','inner2'],connectedTo:[]}];
 await json(join(f.sourceJobDir,'router-input.json'),f.planned);f.manifest.inputSha256=nativeReplayInputSha256(f.planned);await json(f.manifestPath,f.manifest);
 const raw=structuredClone({...f.planned,traces:f.traces});raw.traces[0].route[0].width=.148;
 if(withCachedLayers){raw.obstacles[0].zLayers=[0,2];raw.obstacles[0].__zLayers=[0,2];}
 const error='Error: Native width expansion leaves 0.148mm below required 0.15mm';
 await json(join(f.sourceJobDir,'native-before-width.json'),raw);
 await json(join(f.sourceJobDir,'router-error.json'),{error,phaseIndex:25,phaseTimesMs:{powerTraceExpansionSolver:0.01}});
 await json(join(f.sourceJobDir,'native-async-errors.json'),{ok:false,errors:[error]});
 await json(join(f.sourceJobDir,'job.json'),{status:'failed',error:'drc: '+error.slice('Error: '.length)+'; Native fallback left ports unconnected'});
 return{...f,raw};
}
test('completed native SRJ fallback reuses only a width-valid candidate and explicitly distinguishes its capture kind',async t=>{
 for(const cached of[false,true]){
  const f=await completedFixture(t,cached),before=structuredClone(f.raw),result=await run(f);
  assert.equal(result.receipt.sourceCaptureKind,'completed-native-srj');assert.equal(result.receipt.minimumWireWidthMm,.15);
  assert.equal(result.receipt.sourceCaptureSha256,sha(JSON.stringify(before)));assert.deepEqual(result.traces,f.traces);
  assert.equal(result.receipt.freshGatesMandatory,true);assert.equal(result.receipt.freshRouting,false);
  assert.deepEqual(JSON.parse(await readFile(join(f.sourceJobDir,'native-before-width.json'),'utf8')),before);
 }
 const normal=await fixture(t);assert.equal((await run(normal)).receipt.sourceCaptureKind,'pre-pour-circuit');
});
test('completed SRJ fallback requires failed job and matching sole outer width error after the final native phase',async t=>{
 const mutations=[
  ['router-error.json',(v:any)=>{v.phaseIndex=24;}],['router-error.json',(v:any)=>{v.phaseIndex='25';}],
  ['router-error.json',(v:any)=>{v.phase='highDensityRouteSolver';}],['router-error.json',(v:any)=>{v.error='Error: Native routing failed';}],
  ['router-error.json',(v:any)=>{v.error='Error: Native width expansion leaves 0.151mm below required 0.15mm';}],
  ['router-error.json',(v:any)=>{v.error='Error: Native width expansion leaves 0.148mm below required 0.14mm';}],
  ['router-error.json',(v:any)=>{delete v.phaseTimesMs.powerTraceExpansionSolver;}],['router-error.json',(v:any)=>{v.phaseTimesMs.powerTraceExpansionSolver=-1;}],
  ['native-async-errors.json',(v:any)=>{v.ok=true;}],['native-async-errors.json',(v:any)=>{v.errors.push('Error: OTHER native failure');}],
  ['native-async-errors.json',(v:any)=>{v.errors=['Error: Other width error'];}],
  ['job.json',(v:any)=>{v.status='done';}],['job.json',(v:any)=>{v.error='unrelated failure';}],
 ]as const;
 for(const[name,mutate]of mutations){const f=await completedFixture(t),value=JSON.parse(await readFile(join(f.sourceJobDir,name),'utf8'));mutate(value);await json(join(f.sourceJobDir,name),value);await assert.rejects(run(f),/Native replay/,name);}
 const missing=await completedFixture(t);await unlink(join(missing.sourceJobDir,'job.json'));await assert.rejects(run(missing),/ENOENT/);
});
test('completed SRJ must retain exact captured input and known finite native records; malformed present pre-pour never falls back',async t=>{
 const mutations=[
  (v:any)=>{v.bounds.maxX+=1e-12;},(v:any)=>{v.connections[0].pointsToConnect[0].x+=1e-12;},
  (v:any)=>{v.layerCount=2;},(v:any)=>{v.obstacles[0].center.x+=1e-12;},
  (v:any)=>{v.obstacles[0].zLayers=[0,3];},(v:any)=>{v.obstacles[0].__zLayers=[0];},
  (v:any)=>{v.traces=[];},(v:any)=>{v.traces[0].route[0].width=0;},
  (v:any)=>{v.traces[0].route[0].layer='unknown';},(v:any)=>{v.traces[0].route[2].via_hole_diameter=.4;},
  (v:any)=>{v.traces[0].connection_name='foreign';},(v:any)=>{v.traces[0].pcb_trace_id='saved_phase_null_2_0';},
 ];
 for(const mutate of mutations){const f=await completedFixture(t,true),value=structuredClone(f.raw);mutate(value);await json(join(f.sourceJobDir,'native-before-width.json'),value);await assert.rejects(run(f),/Native replay/);}
 for(const capture of [{malformed:true},[{type:'pcb_trace'},{type:'pcb_autorouting_error'}]]){const f=await completedFixture(t);await json(join(f.sourceJobDir,'pre-pour-circuit.json'),capture);await assert.rejects(run(f),/completed pre-pour/);}
 const invalidJson=await completedFixture(t);await writeFile(join(invalidJson.sourceJobDir,'pre-pour-circuit.json'),'{bad');await assert.rejects(run(invalidJson),/invalid JSON: pre-pour/);
});
test('completed source may explain thin raw output but replay still rejects thin candidates or changed native trace coverage',async t=>{
 const f=await completedFixture(t),thin=structuredClone(f.traces);thin[0].route[0].width=.148;await replaceOutput(f,thin);await assert.rejects(run(f),/fabrication minimum/);
 for(const mutate of[(a:any[])=>{a[0].pcb_trace_id='invented_mst0';},(a:any[])=>{a.push({...a[0],pcb_trace_id:'extra_mst0'});}]){const f=await completedFixture(t),candidate=structuredClone(f.traces);mutate(candidate);await replaceOutput(f,candidate);await assert.rejects(run(f),/identity\/coverage/);}
});
