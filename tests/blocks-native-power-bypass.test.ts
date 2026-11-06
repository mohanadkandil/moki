import test from 'node:test';
import assert from 'node:assert/strict';
const nativeUrl = new URL('../eda/node_modules/@tscircuit/capacity-autorouter/dist/index.js',import.meta.url).href;
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(nativeUrl);

test('pinned public empty-selection width stage preserves conforming signal and power copper verbatim',()=>{
 const trace=(id:string,width:number,y:number)=>({pcb_trace_id:id,connection_name:id,route:[{route_type:'wire' as const,x:-1,y,layer:'top',width},{route_type:'wire' as const,x:1,y,layer:'top',width}]});
 const input:any={layerCount:2,bounds:{minX:-5,maxX:5,minY:-5,maxY:5},minTraceWidth:.15,obstacles:[],connections:[{name:'signal',pointsToConnect:[{x:-1,y:0,layer:'top'},{x:1,y:0,layer:'top'}]},{name:'power',nominalTraceWidth:.3,pointsToConnect:[{x:-1,y:2,layer:'top'},{x:1,y:2,layer:'top'}]}],traces:[trace('signal',.15,0),trace('power',.3,2)]};
 const before=structuredClone(input),pipeline=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null,powerTraceExpansion:{onlyConnectionNames:[]}});
 const definition=pipeline.pipelineDef.find((s:any)=>s.solverName==='powerTraceExpansionSolver')!;
 assert.ok(definition,'pinned native width stage remains publicly available');
 const Stage=definition.solverClass as any,stage=new Stage(input,{onlyConnectionNames:[]});
 assert.equal(stage.solved,true);assert.equal(stage.stats.bypassed,true);assert.equal(stage.stats.selectedTraceCount,0);
 assert.deepEqual(stage.getOutput(),input.traces);assert.deepEqual(input,before);
});
