import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import ts from'typescript';
const root='/home/sogo/design-skill-research/repos/moki/',dir=root+'docs/engineering/2026-11-06-chip-live/evidence/chip_eda/';const source=readFileSync(root+'eda/blocks/build.ts','utf8');
const begin=source.indexOf('  const errors = cj\n'),end=source.indexOf("  await stage('gltf'",begin);assert.ok(begin>0&&end>begin);const block=source.slice(begin,end);
const js=ts.transpileModule('exports.run=async function(cj,asyncErrors,netlistErrors,checkNativeTraceWidths,nativePlacementIssues,save,graph,stages){'+block+';return{errors,warnings,stages}}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const compiled={exports:{}as any};new Function('exports','module',js)(compiled.exports,compiled);const run=compiled.exports.run;
const records=[];for(const [name,cj,asyncErrors,netlistErrors,width,placement]of[
 ['native-failure',[{type:'pcb_autorouting_error',message:'solver exhausted'}],[],[],[],[]],
 ['native-failure-with-fallback-trace',[{type:'pcb_autorouting_error',message:'solver exhausted'},{type:'pcb_trace',route:[]}],[],[],[],[]],
 ['unknown-runtime-with-fallback-trace',[{type:'source_runtime_error',message:'UNKNOWN core runtime'},{type:'pcb_trace',route:[]}],[],[],[],[]],
 ['async-only-with-fallback-trace',[{type:'pcb_trace',route:[]}],['original solver error'],[],[],[]],
 ['native-real-clearance',[{type:'pcb_trace_error',message:'REAL .052mm clearance'},{type:'pcb_trace',route:[]}],[],[],[],[]],
 ['wrong-source',[{type:'pcb_trace',route:[]}],[],[{type:'source_plan_netlist_mismatch',message:'wrong source'}],[],[]],
 ['subminimum-width',[{type:'pcb_trace',route:[]}],[],[],[{type:'pcb_trace_width_error',message:'thin'}],[]],
 ['physical-placement',[{type:'pcb_trace',route:[]}],[],[],[],[{type:'pcb_component_overlap_error',message:'overlap'}]],
]as any[]){const stages=[{name:'route',status:'done'}];const result=await run(cj,asyncErrors,netlistErrors,()=>width,()=>({ok:!placement.length,issues:placement}),async()=>{}, {},stages);assert.ok(result.errors.length,name);assert.equal(result.errors.some((e:any)=>e.type==='pcb_native_async_error'),!!asyncErrors.length);if(name.startsWith('native-failure')||name.startsWith('async-only'))assert.equal(result.stages[0].status,'failed');records.push({name,errorTypes:result.errors.map((e:any)=>e.type),routeStage:result.stages[0].status});}
const result={scope:'Exact production failure/error collection extracted; tiny synthetic marker inputs and stub independent checks, no native solve',buildSha256:createHash('sha256').update(source).digest('hex'),guardSha256:createHash('sha256').update(block).digest('hex'),cases:records,allRemainAcceptanceBlocking:true};writeFileSync(dir+'failure-gate-independent-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
