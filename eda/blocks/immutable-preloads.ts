/** Public native preloads used only as an immutable clock reference. No copper
 * is inferred, rewritten, or trusted after native mutation. */
import {nativeReplayInputSha256 as hash} from './native-replay.js';

const plain=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const text=(v:any):v is string=>typeof v==='string'&&v.length>0;
const finite=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v);
function keys(value:any,allowed:string[],where:string){
  if(!plain(value)||Object.keys(value).some(k=>value[k]!==undefined&&!allowed.includes(k)))throw Error('Immutable preload unsupported '+where+' record');
}
function names(value:any,where:string):string[]{
  if(!Array.isArray(value)||!value.length||Array.from(value).some(v=>!text(v)))throw Error('Immutable preload invalid '+where);
  return value;
}
function validateTrace(t:any,layerCount:number){
  hash(t); // Exact canonical JSON rejects nonfinite/non-JSON metadata too.
  keys(t,['type','pcb_trace_id','connection_name','connectsTo','route','source_trace_id','subcircuit_id','__rootConnectionNames','__netConnectionName'],'trace');
  if(t.type!=='pcb_trace'||!text(t.pcb_trace_id)||!text(t.connection_name))throw Error('Immutable preload missing trace identity');
  names(t.connectsTo,'connectsTo');
  for(const k of ['source_trace_id','subcircuit_id','__netConnectionName'])if(t[k]!==undefined&&!text(t[k]))throw Error('Immutable preload invalid '+k);
  if(t.__rootConnectionNames!==undefined)names(t.__rootConnectionNames,'root aliases');
  if(!Array.isArray(t.route)||t.route.length<2)throw Error('Immutable preload missing route');
  const layers=['top',...Array.from({length:Math.max(0,layerCount-2)},(_,i)=>'inner'+(i+1)),'bottom'];
  for(const p of t.route){
    if(!plain(p)||!finite(p.x)||!finite(p.y))throw Error('Immutable preload invalid route coordinates');
    if(p.route_type==='wire'){
      keys(p,['route_type','x','y','width','layer','start_pcb_port_id','end_pcb_port_id'],'wire');
      if(!finite(p.width)||p.width<=0||!layers.includes(p.layer))throw Error('Immutable preload invalid wire width/layer');
      for(const k of ['start_pcb_port_id','end_pcb_port_id'])if(p[k]!==undefined&&!text(p[k]))throw Error('Immutable preload invalid endpoint marker');
    }else if(p.route_type==='via'){
      keys(p,['route_type','x','y','from_layer','to_layer','via_diameter','via_hole_diameter'],'via');
      if(!layers.includes(p.from_layer)||!layers.includes(p.to_layer)||p.from_layer===p.to_layer||!finite(p.via_diameter)||!finite(p.via_hole_diameter)||p.via_hole_diameter<=0||p.via_diameter<=p.via_hole_diameter)throw Error('Immutable preload invalid via');
    }else throw Error('Immutable preload unsupported route kind');
  }
}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item);Object.freeze(v);}return v;}
export interface ImmutablePreloadAudit {
  schema:'moki.immutable-native-clock-preloads/1'; fixedTraceIds:string[];
  fixedConnectionNames:string[]; fixedTraceSha256:Record<string,string>;
  inputBeforeSha256:string; inputWithPreloadsSha256:string;
  allPreloadedTraceCount:number; clockPreloadedTraceCount:5;
}
export interface ImmutablePreloadExpected {
  readonly traces:readonly any[]; readonly fixedTraceIds:readonly string[];
  readonly traceHashes:Readonly<Record<string,string>>; readonly audit:ImmutablePreloadAudit;
}

export function prepareImmutablePreloads(input:any,actualFixedTraces:any[]):{input:any;expected:ImmutablePreloadExpected;audit:ImmutablePreloadAudit}{
  const inputBeforeSha256=hash(input);
  if(!plain(input)||!Array.isArray(input.connections)||!Number.isInteger(input.layerCount)||![2,4].includes(input.layerCount)||!Array.isArray(actualFixedTraces)||actualFixedTraces.length!==5)throw Error('Immutable preload expected five clock traces on a supported input');
  if(input.traces!==undefined&&!Array.isArray(input.traces))throw Error('Immutable preload invalid input traces');
  const counts=new Map<string,number>();
  // The caller proves these are its profile's clock traces. Compiler-generated
  // net IDs vary with instance and part order; this boundary checks structure,
  // completeness and inactive ownership without guessing electrical semantics.
  for(const t of actualFixedTraces){validateTrace(t,input.layerCount);if(!text(t.source_trace_id)||!text(t.subcircuit_id))throw Error('Immutable preload clock is missing actual source identity');counts.set(t.connection_name,(counts.get(t.connection_name)??0)+1);}
  if(counts.size!==3||[...counts.values()].sort().join(',')!=='1,2,2')throw Error('Immutable preload incomplete clock ownership');
  const traces=structuredClone([...(input.traces??[]),...actualFixedTraces]),ids=new Set<string>(),traceHashes:Record<string,string>=Object.create(null);
  for(const t of traces){validateTrace(t,input.layerCount);if(ids.has(t.pcb_trace_id))throw Error('Immutable preload duplicate trace ID');ids.add(t.pcb_trace_id);traceHashes[t.pcb_trace_id]=hash(t);}
  const owners=new Set(traces.flatMap(t=>[t.connection_name,t.source_trace_id,t.__netConnectionName,...(t.__rootConnectionNames??[])].filter(text)));
  for(const c of input.connections){
    if(!plain(c)||!text(c.name))throw Error('Immutable preload invalid active connection');
    if(c.__rootConnectionNames!==undefined)names(c.__rootConnectionNames,'active root aliases');
    if(c.__netConnectionName!==undefined&&!text(c.__netConnectionName))throw Error('Immutable preload invalid active net alias');
    if([c.name,c.__netConnectionName,...(c.__rootConnectionNames??[])].some(n=>owners.has(n)))throw Error('Immutable preload owner is an active routed connection');
  }
  const prepared=structuredClone(input);prepared.traces=traces;
  const fixedTraceIds=actualFixedTraces.map(t=>t.pcb_trace_id);
  const audit:ImmutablePreloadAudit={schema:'moki.immutable-native-clock-preloads/1',fixedTraceIds:[...fixedTraceIds],fixedConnectionNames:[...counts.keys()],fixedTraceSha256:Object.fromEntries(fixedTraceIds.map(id=>[id,traceHashes[id]!])),inputBeforeSha256,inputWithPreloadsSha256:hash(prepared),allPreloadedTraceCount:traces.length,clockPreloadedTraceCount:5};
  const expected=freeze({traces:structuredClone(traces),fixedTraceIds:[...fixedTraceIds],traceHashes:{...traceHashes},audit:structuredClone(audit)});
  return{input:prepared,expected,audit};
}

export function verifyImmutablePreloads(solver:any,output:any,expected:ImmutablePreloadExpected):{outputWithFixedTracesRemoved:any;audit:ImmutablePreloadAudit&{updatedTraceCount:number;mutatedTraceCount:0;removedReturnedFixedTraceIds:string[];fixedTracesUnchanged:true}}{
  if(typeof solver?.getUpdatedPreloadedTraces!=='function'||typeof solver?.getMutatedPreloadedTraces!=='function')throw Error('Immutable preload native public getters unavailable');
  const updated=solver.getUpdatedPreloadedTraces(),mutated=solver.getMutatedPreloadedTraces();
  if(!Array.isArray(updated)||!Array.isArray(mutated)||mutated.length)throw Error('Immutable preload native mutation or malformed getter result');
  const seen=new Set<string>();
  for(const t of updated){if(!text(t?.pcb_trace_id)||seen.has(t.pcb_trace_id)||!Object.hasOwn(expected.traceHashes,t.pcb_trace_id)||hash(t)!==expected.traceHashes[t.pcb_trace_id])throw Error('Immutable preload updated trace changed, unknown or duplicated');seen.add(t.pcb_trace_id);}
  if(seen.size!==expected.traces.length)throw Error('Immutable preload native getter omitted fixed copper');
  const array=Array.isArray(output),traces=array?output:output?.traces;
  if(!Array.isArray(traces))throw Error('Immutable preload native output has no traces');
  hash(output);
  const fixed=new Set(expected.fixedTraceIds),outputIds=new Set<string>(),removed:string[]=[],kept:any[]=[];
  for(const t of traces){
    if(!plain(t)||!text(t.pcb_trace_id)||outputIds.has(t.pcb_trace_id))throw Error('Immutable preload native output has duplicate/malformed trace identity');
    outputIds.add(t.pcb_trace_id);
    if(t.__replaces_pcb_trace_id!==undefined&&!text(t.__replaces_pcb_trace_id))throw Error('Immutable preload native output has malformed replacement identity');
    if(t.__replaces_pcb_trace_id!==undefined&&Object.hasOwn(expected.traceHashes,t.__replaces_pcb_trace_id))throw Error('Immutable preload native output replaces fixed copper');
    if(Object.hasOwn(expected.traceHashes,t.pcb_trace_id)&&hash(t)!==expected.traceHashes[t.pcb_trace_id])throw Error('Immutable preload returned fixed copper changed');
    if(fixed.has(t.pcb_trace_id)){
      removed.push(t.pcb_trace_id);
    }else kept.push(t);
  }
  return{outputWithFixedTracesRemoved:structuredClone(array?kept:{...output,traces:kept}),audit:{...structuredClone(expected.audit),updatedTraceCount:updated.length,mutatedTraceCount:0,removedReturnedFixedTraceIds:removed,fixedTracesUnchanged:true}};
}
