// Execute the actual wrapper against a fake already-failed solver, not a router.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=readFileSync(new URL('../../../../../eda/blocks/router.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export async function chipAutorouter','async function chipAutorouter');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const factory=new Function('SOLVERS','withChipRoutingPlanningMargin',js+'\nreturn chipAutorouter;');
class Failed {failed=true;solved=false;error='INDEPENDENT original native error';visualize(){return{}}getOutputSimpleRouteJson(){return{}}}
const make=factory({AutoroutingPipelineSolver9_PreloadedTraceGraph:Failed},(input:any)=>input);
let release!:()=>void,started!:()=>void;
const pending=new Promise<void>(resolve=>release=resolve),inCallback=new Promise<void>(resolve=>started=resolve),events:any[]=[];
const wrapper=await make({}, {onFailure:async()=>{started();await pending;}});
wrapper.on('error',(event:any)=>events.push(event));wrapper.start();await inCallback;wrapper.stop();release();await new Promise(resolve=>setTimeout(resolve,10));
console.log(JSON.stringify({lateErrorsAfterStop:events.length,originalMessage:events[0]?.error?.message}));
assert.equal(events.length,0,'wrapper must not emit after stop while diagnostic save was pending');

const failure = new Promise<any>(resolve=>{void (async()=>{const candidate=await make({}, {onFailure:async()=>{throw Error('INDEPENDENT diagnostic write failure');}});candidate.on('error',(event:any)=>resolve(event.error));candidate.start();})();});
assert.equal((await failure).message,'INDEPENDENT original native error');
console.log(JSON.stringify({diagnosticFailurePreservesOriginalNativeError:true}));
