import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {verifyImmutablePreloads,prepareImmutablePreloads} from '/home/sogo/design-skill-research/repos/moki/eda/blocks/immutable-preloads.js';
import {rotateNativeRoutingFrame} from '/home/sogo/design-skill-research/repos/moki/eda/blocks/routing-frame.js';
import {withChipRoutingPlanningMargin} from '/home/sogo/design-skill-research/repos/moki/src/blocks/router-planning.js';

// Exact production wrapper against fake solvers only. Never import/instantiate
// the native SOLVERS package: these are adapter protocol, not routing tests.
const source=readFileSync(new URL('/home/sogo/design-skill-research/repos/moki/eda/blocks/router.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const make=(Solver:any,restoreNativeWidths:any=async()=>{throw Error('Unexpected width refinement');},Solver7:any=Solver)=>{
 const compiledModule={exports:{} as Record<string,any>};
 const controlledRequire=(name:string)=>{
  if(name==='tscircuit')return{SOLVERS:{AutoroutingPipelineSolver9_PreloadedTraceGraph:Solver,AutoroutingPipelineSolver7_MultiGraph:Solver7}};
  if(name==='./immutable-preloads.js')return{verifyImmutablePreloads};
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


const evidenceDir='/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/',fixture=JSON.parse(readFileSync(evidenceDir+'rp-routing-robust/immutable-preloads-fixture.json','utf8')),cases=[];
for(const mode of['valid','changed-getter','mutated-list','missing-getter','changed-returned-clock']){
 const prepared=prepareImmutablePreloads(fixture.input,fixture.fixedTraces),events:string[]=[],newTrace={type:'pcb_trace',pcb_trace_id:'DERIVED_NEW_CU',connection_name:'source_net_0',route:[{route_type:'wire',x:1,y:1,layer:'top',width:.15},{route_type:'wire',x:2,y:1,layer:'top',width:.15}],preserveMetadata:{everything:true}};
 class Native{solved=false;failed=false;constructor(input:any){assert.deepEqual(input.traces,fixture.fixedTraces);if(mode==='missing-getter')(this as any).getUpdatedPreloadedTraces=undefined;}step(){this.solved=true;}getUpdatedPreloadedTraces(){const ts=structuredClone(fixture.fixedTraces);if(mode==='changed-getter')ts[0].route[0].x+=1e-9;return ts;}getMutatedPreloadedTraces(){return mode==='mutated-list'?[fixture.fixedTraces[0]]:[];}getOutputSimpleRouteJson(){const ts=structuredClone(fixture.fixedTraces);if(mode==='changed-returned-clock')ts[0].route[0].width=.14;return{traces:[...ts,newTrace],preserveOuterMetadata:{literal:true}};}}
 const restore=async(_solver:any,input:any,traces:any[])=>{events.push('width');assert.deepEqual(input.traces,fixture.fixedTraces);assert.deepEqual(traces,[newTrace]);return{traces,audit:[]};};
 const adapter=await make(Native,restore)(prepared.input,{immutablePreloads:prepared.expected,onImmutablePreloads:async()=>{events.push('preload-audit');},onNativeSolved:async(output:any)=>{events.push('capture');assert.deepEqual(output.traces,[newTrace]);},widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127}});adapter.on('complete',()=>events.push('complete'));
 if(mode==='valid'){await adapter.run();assert.deepEqual(events,['preload-audit','capture','width','complete']);assert.deepEqual(adapter.getOutputSimpleRouteJson().traces,[newTrace]);}else{await assert.rejects(adapter.run(),/Immutable preload/);assert.deepEqual(events,[]);}
 cases.push({mode,events,pass:true});
}
let constructors=0;await assert.rejects(make(class{constructor(){constructors++;}})(fixture.input,{immutablePreloads:prepareImmutablePreloads(fixture.input,fixture.fixedTraces).expected,frameQuarterTurns:1}),/physical routing frame/);assert.equal(constructors,0);
const evidence={scope:'Exact production router transpilation, fake solver protocol and real immutable helper; no native solver or routing.',routerSha256:createHash('sha256').update(source).digest('hex'),cases,frameRejectedBeforeConstructor:true};writeFileSync(evidenceDir+'clock-preload-router-independent-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
