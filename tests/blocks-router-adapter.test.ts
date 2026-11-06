import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {verifyRefinedClockPreloads} from '../eda/blocks/refined-clock-preloads.js';
import {verifyImmutablePreloads,prepareImmutablePreloads} from '../eda/blocks/immutable-preloads.js';
import {rotateNativeRoutingFrame} from '../eda/blocks/routing-frame.js';
import {withChipRoutingPlanningMargin} from '../src/blocks/router-planning.js';

// Exact production wrapper against fake solvers only. Never import/instantiate
// the native SOLVERS package: these are adapter protocol, not routing tests.
const source=readFileSync(new URL('../eda/blocks/router.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const make=(Solver:any,restoreNativeWidths:any=async()=>{throw Error('Unexpected width refinement');},Solver7:any=Solver)=>{
 const compiledModule={exports:{} as Record<string,any>};
 const controlledRequire=(name:string)=>{
  if(name==='tscircuit')return{SOLVERS:{AutoroutingPipelineSolver9_PreloadedTraceGraph:Solver,AutoroutingPipelineSolver7_MultiGraph:Solver7}};
  if(name==='./immutable-preloads.js')return{verifyImmutablePreloads};
  if(name==='./refined-clock-preloads.js')return{verifyRefinedClockPreloads};
  if(name==='./routing-frame.js')return{rotateNativeRoutingFrame};
  if(name==='./native-width.js')return{restoreNativeWidths};
  if(name==='../../src/blocks/router-planning.js')return{withChipRoutingPlanningMargin};
  throw Error('Unexpected adapter dependency: '+name);
 };
 new Function('require','exports','module',js)(controlledRequire,compiledModule.exports,compiledModule);
 return compiledModule.exports.chipAutorouter;
};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const input=()=>({connections:[],traces:[],obstacles:[]});

test('run shares a pending promise and resolves once; event start and synchronous output stay compatible',async()=>{
 let steps=0,completed=0;const output={connections:[],traces:[{proof:'fake output'}]},original=input(),before=structuredClone(original);
 class Solved {
  solved=false;failed=false;
  constructor(planned:any,options:any){assert.equal(options.cacheProvider,null);assert.equal(planned.minTraceToPadEdgeClearance,.15);}
  step(){steps++;this.solved=true;}
  getOutputSimplifiedPcbTraces(){return output.traces;}
  getOutputSimpleRouteJson(){return output;}
 }
 const adapter=await make(Solved)(original);adapter.on('complete',(event:any)=>{completed++;assert.deepEqual(event.traces,output.traces);});
 adapter.start();const a=adapter.run(),b=adapter.run();assert.equal(a,b);await Promise.all([a,b]);await adapter.run();adapter.start();await tick();
 assert.equal(steps,1);assert.equal(completed,1);assert.equal(adapter.getOutputSimpleRouteJson(),output);assert.equal(typeof adapter.getOutputSimpleRouteJson().then,'undefined');assert.deepEqual(original,before);
});
test('failed run preserves original solver error even when the diagnostic writer throws',async()=>{
 const original=new Error('INDEPENDENT native solver failure'),pointPairs={connections:[{name:'actual-fake-pair'}]};let failures=0,capture:any;
 class Failed {
  solved=false;failed=false;srjWithPointPairs=pointPairs;currentPipelineStepIndex=13;timeSpentOnPhase={route:1};
  step(){throw original;}
  visualize(){return{lines:[]};}
  getOutputSimpleRouteJson(){return{};}
 }
 const adapter=await make(Failed)(input(),{onFailure:async(evidence:any)=>{capture=evidence;throw Error('diagnostic write failed');}});
 adapter.on('error',(event:any)=>{failures++;assert.equal(event.error,original);});
 await assert.rejects(adapter.run(),(error:any)=>error===original);assert.equal(failures,1);assert.equal(capture.pointPairs,pointPairs);assert.equal(capture.phaseIndex,13);assert.match(capture.error,/native solver failure/);
});
test('native failed flag rejects with its actual reason and emits one error event',async()=>{
 let errors=0;
 class FailedFlag {solved=false;failed=false;error='actual failed state';step(){this.failed=true;}visualize(){return{}}getOutputSimpleRouteJson(){return{}}}
 const adapter=await make(FailedFlag)(input());adapter.on('error',()=>errors++);await assert.rejects(adapter.run(),/actual failed state/);assert.equal(errors,1);
});
test('stop rejects pending run while a native step awaits, and suppresses late completion',async()=>{
 const entered=deferred(),release=deferred();let events=0;
 class Waiting {
  solved=false;failed=false;
  async stepAsync(){entered.resolve();await release.promise;this.solved=true;}
  getOutputSimplifiedPcbTraces(){return[];}
  getOutputSimpleRouteJson(){return{};}
 }
 const adapter=await make(Waiting)(input());adapter.on('complete',()=>events++);adapter.on('error',()=>events++);const pending=adapter.run();await entered.promise;adapter.stop();await assert.rejects(pending,/was stopped/);release.resolve();await tick();assert.equal(events,0);await assert.rejects(adapter.run(),/was stopped/);
});
test('stop during failure diagnostics rejects run and suppresses the late original error event',async()=>{
 const entered=deferred(),release=deferred();let errors=0;
 class Failed {solved=false;failed=false;step(){throw Error('original native failure');}visualize(){return{}}getOutputSimpleRouteJson(){return{}}}
 const adapter=await make(Failed)(input(),{onFailure:async()=>{entered.resolve();await release.promise;}});adapter.on('error',()=>errors++);
 const pending=adapter.run();await entered.promise;adapter.stop();await assert.rejects(pending,/was stopped/);release.resolve();await tick();assert.equal(errors,0);
});

test('width refinement completes before run resolves and its actual output is materialized',async()=>{
 const entered=deferred(),release=deferred();const refined={pcb_trace_id:'refined',route:[]};let events=0;
 class Solved{solved=false;failed=false;step(){this.solved=true}getOutputSimpleRouteJson(){return{traces:[{pcb_trace_id:'original'}]}}}
 const restore=async(_solver:any,_input:any,traces:any[],rules:any,stopped:()=>boolean)=>{assert.equal(traces[0].pcb_trace_id,'original');assert.equal(rules.traceToPad,.127);entered.resolve();await release.promise;assert.equal(stopped(),false);return{traces:[refined],audit:['native-stage']}};
 const adapter=await make(Solved,restore)(input(),{widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127}});adapter.on('complete',()=>events++);
 const pending=adapter.run();await entered.promise;let resolved=false;pending.then(()=>resolved=true);const second=adapter.run();assert.equal(pending,second);await tick();assert.equal(resolved,false);release.resolve();await pending;
 assert.equal(events,1);assert.deepEqual(adapter.getOutputSimpleRouteJson().traces,[refined]);
});


test('explicit public Pipeline7 selection and default/explicit Pipeline9 retain the same adapter protocol',async()=>{
 const constructed:string[]=[],captured:string[]=[];
 class Nine{solved=false;failed=false;constructor(planned:any,opts:any){constructed.push('nine');assert.equal(planned.minTraceToPadEdgeClearance,.15);assert.equal(opts.cacheProvider,null);}step(){this.solved=true;}getOutputSimpleRouteJson(){return{traces:[{engine:'nine'}]};}}
 class Seven extends Nine{constructor(planned:any,opts:any){super(planned,opts);constructed.pop();constructed.push('seven');}getOutputSimpleRouteJson(){return{traces:[{engine:'seven'}]};}}
 for(const engine of [undefined,'pipeline9','pipeline7']){
  const expected=engine==='pipeline7'?'seven':'nine',adapter=await make(Nine,undefined,Seven)(input(),{engine,onNativeSolved:async(output:any)=>{captured.push(output.traces[0].engine);}});
  const pending=adapter.run();assert.equal(adapter.run(),pending);await pending;
  assert.equal(constructed.at(-1),expected);assert.equal(captured.at(-1),expected);assert.equal(adapter.getOutputSimpleRouteJson().traces[0].engine,expected);
 }
 assert.deepEqual(constructed,['nine','nine','seven']);
});

test('minimum-only mode bypasses broad native power widening while retaining the hard width repair',async()=>{
 const seen:any[]=[];let repaired=0;
 class Native {
  solved=false;failed=false;
  constructor(_input:any,options:any){seen.push(options);}
  step(){this.solved=true;}
  getOutputSimpleRouteJson(){return{traces:[{pcb_trace_id:'raw',route:[]}]};}
 }
 const restore=async()=>{repaired++;return{traces:[{pcb_trace_id:'refined'}],audit:[]};};
 for(const minimumWidthsOnly of [undefined,false,true]){
  const adapter=await make(Native,restore)(input(),{minimumWidthsOnly,widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127}});
  await adapter.run();assert.equal(adapter.getOutputSimpleRouteJson().traces[0].pcb_trace_id,'refined');
 }
 assert.deepEqual(seen,[{cacheProvider:null},{cacheProvider:null},{cacheProvider:null,powerTraceExpansion:{onlyConnectionNames:[]}}]);
 assert.equal(repaired,3);
});

test('minimum-only mode requires the hard fabrication width constraints',async()=>{
 await assert.rejects(make(class{})(input(),{minimumWidthsOnly:true}),/require fabrication constraints/);
});

test('private solver frame is inverted before materialization, evidence and hard width refinement',async()=>{
 const physical={layerCount:2,bounds:{minX:-5,maxX:5,minY:-4,maxY:4},minTraceWidth:.15,obstacles:[],connections:[{name:'A',pointsToConnect:[{x:1,y:2,layer:'top'},{x:3,y:2,layer:'top'}]}],traces:[]};
 let frame:any,captured:any,refined=0;
 class Native {
  solved=false;failed=false;
  constructor(input:any){assert.deepEqual(input.connections[0].pointsToConnect.map((p:any)=>[p.x,p.y]),[[2,-1],[2,-3]]);}
  step(){this.solved=true;}
  getOutputSimpleRouteJson(){return{traces:[{type:'pcb_trace',pcb_trace_id:'A_0',connection_name:'A',route:[{route_type:'wire',x:2,y:-1,layer:'top',width:.15},{route_type:'wire',x:2,y:-3,layer:'top',width:.15}]}]};}
 }
 const restore=async(_solver:any,input:any,traces:any[])=>{refined++;assert.deepEqual(input.connections,physical.connections);assert.deepEqual(traces[0].route.map((p:any)=>[p.x,p.y]),[[1,2],[3,2]]);return{traces,audit:[]};};
 const adapter=await make(Native,restore)(physical,{frameQuarterTurns:3,onFrame:async(e:any)=>{frame=e;},onNativeSolved:async(e:any)=>{captured=e;},widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127}});
 await adapter.run();assert.equal(refined,1);assert.deepEqual(captured.connections,physical.connections);assert.deepEqual(adapter.getOutputSimpleRouteJson().traces,captured.traces);assert.deepEqual(frame.nativeInput.connections[0].pointsToConnect.map((p:any)=>[p.x,p.y]),[[2,-1],[2,-3]]);
});

test('private guarded constructor keeps the native protocol and cannot be combined with Pipeline7',async()=>{
 let originals=0,guarded=0;
 class Original {constructor(){originals++;}}
 class Guarded {solved=false;failed=false;constructor(){guarded++;}step(){this.solved=true;}getOutputSimpleRouteJson(){return{traces:[{proof:'guarded-native'}]};}}
 const create=make(Original),adapter=await create(input(),{guardedPipeline9:Guarded});
 await adapter.run();assert.equal(originals,0);assert.equal(guarded,1);assert.equal(adapter.getOutputSimpleRouteJson().traces[0].proof,'guarded-native');
 await assert.rejects(create(input(),{guardedPipeline9:Guarded,engine:'pipeline7'}),/guard requires Pipeline9/);
});

test('rejected immutable native preload evidence is recorded before failure without publishing copper',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/immutable-preloads-fixture.json',import.meta.url),'utf8'));
 const prepared=prepareImmutablePreloads(fixture.input,fixture.fixedTraces),mutated=structuredClone(fixture.fixedTraces);
 mutated[0].route[1].x+=.001;
 let completed=0,published=0,widths=0,evidence:any;
 class Native {
  solved=false;failed=false;
  step(){this.solved=true;}
  getOutputSimpleRouteJson(){return{traces:mutated};}
  getUpdatedPreloadedTraces(){return mutated;}
  getMutatedPreloadedTraces(){return[mutated[0]];}
 }
 const adapter=await make(Native,async()=>{widths++;return{};})(prepared.input,{immutablePreloads:prepared.expected,
  onImmutablePreloads:async(value:any)=>{evidence=value;},onNativeSolved:async()=>{published++;},widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127}});
 adapter.on('complete',()=>completed++);await assert.rejects(adapter.run(),/Immutable preload/);
 assert.equal(evidence.ok,false);assert.deepEqual(evidence.updatedPreloadedTraces,mutated);assert.deepEqual(evidence.mutatedPreloadedTraces,[mutated[0]]);
 assert.equal(completed,0);assert.equal(published,0);assert.equal(widths,0);
});

test('verified native clock replacements stay fixed through width repair and are forwarded literally with unrelated preloads',async()=>{
 const f=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/immutable-preloads-fixture.json',import.meta.url),'utf8'));
 const unrelated={...structuredClone(f.fixedTraces[0]),pcb_trace_id:'unrelated-preload',connection_name:'unrelated-net',source_trace_id:'unrelated-source',connectsTo:['unrelated-port']};
 const originalInput={...f.input,traces:[unrelated]},prepared=prepareImmutablePreloads(originalInput,f.fixedTraces);
 const updated=structuredClone(prepared.input.traces),changed=updated.find((t:any)=>t.pcb_trace_id===f.fixedTraces[0].pcb_trace_id);
 changed.route[1].x+=.001;changed.__replaces_pcb_trace_id=changed.pcb_trace_id;
 const global={type:'pcb_trace',pcb_trace_id:'new-global',connection_name:'new-net',route:[{route_type:'wire',x:0,y:0,width:.14,layer:'bottom'},{route_type:'wire',x:1,y:0,width:.14,layer:'bottom'}]};
 const refinedGlobal={...global,route:global.route.map((p:any)=>({...p,width:.15}))};
 let accepted:any,widths=0;
 class Native {
  solved=false;failed=false;step(){this.solved=true;}
  getOutputSimpleRouteJson(){return{traces:[...updated,global]};}
  getUpdatedPreloadedTraces(){return updated;}
  getMutatedPreloadedTraces(){return[changed];}
 }
 const restore=async(_solver:any,input:any,traces:any[])=>{
  widths++;assert.deepEqual(traces,[global]);assert.equal(input.traces.length,6);
  assert.deepEqual(input.traces.find((t:any)=>t.pcb_trace_id===changed.pcb_trace_id),changed);
  assert.deepEqual(input.traces.find((t:any)=>t.pcb_trace_id===unrelated.pcb_trace_id),unrelated);
  return{traces:[refinedGlobal],audit:[]};
 };
 const adapter=await make(Native,restore)(prepared.input,{immutablePreloads:prepared.expected,allowClockRefinement:true,
  onAcceptedClockTraces:(traces:any[])=>{accepted=traces;},widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127}});
 await adapter.run();assert.equal(widths,1);assert.equal(accepted.length,5);
 const output=adapter.getOutputSimpleRouteJson().traces;assert.equal(output.length,3);
 assert.deepEqual(output.find((t:any)=>t.pcb_trace_id===changed.pcb_trace_id),changed);
 assert.deepEqual(output.find((t:any)=>t.pcb_trace_id===unrelated.pcb_trace_id),unrelated);
 assert.deepEqual(output.find((t:any)=>t.pcb_trace_id===global.pcb_trace_id),refinedGlobal);
 await assert.rejects(make(Native)(prepared.input,{allowClockRefinement:true}),/requires verified preloads/);
});
