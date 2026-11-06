/** Verify native-owned refinement of the five caller-proven clock preloads.
 * This forwards official replacement records, never reconstructs copper. */
import type {ImmutablePreloadExpected,ImmutablePreloadAudit} from './immutable-preloads.js';
import {nativeReplayInputSha256 as hash} from './native-replay.js';

const plain=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const text=(v:any):v is string=>typeof v==='string'&&v.length>0;
const definedKeys=(v:any)=>Object.keys(v).filter(k=>v[k]!==undefined);
const identity=(t:any)=>Object.fromEntries(Object.entries(t).filter(([k])=>k!=='route'&&k!=='__replaces_pcb_trace_id'));
function ownerRefs(t:any):string[]{
  for(const k of ['pcb_trace_id','connection_name','source_trace_id','__netConnectionName','rootConnectionName','netConnectionName'])if(t[k]!==undefined&&typeof t[k]!=='string')throw Error('Refined clock output has malformed owner identity');
  for(const k of ['__rootConnectionNames','mergedConnectionNames','connectsTo'])if(t[k]!==undefined&&(!Array.isArray(t[k])||Array.from(t[k]).some(v=>!text(v))))throw Error('Refined clock output has malformed root owner aliases or connectsTo');
  // Public connectsTo accepts trace, net and point IDs. The native resolver
  // also unions rootConnectionName/mergedConnectionNames; none may introduce
  // a sixth clock trace under a fresh ID with otherwise unrelated metadata.
  return[t.pcb_trace_id,t.connection_name,t.source_trace_id,t.__netConnectionName,t.rootConnectionName,t.netConnectionName,...(t.__rootConnectionNames??[]),...(t.mergedConnectionNames??[]),...(t.connectsTo??[])].filter(text);
}
function length(t:any):number{
  if(!plain(t)||!Array.isArray(t.route)||t.route.length<2)throw Error('Refined clock requires a finite wire route');
  for(const p of t.route){
    if(!plain(p)||definedKeys(p).some(k=>!['route_type','x','y','width','layer','start_pcb_port_id','end_pcb_port_id'].includes(k))||p.route_type!=='wire'||p.layer!=='top'||p.width!==.15||typeof p.x!=='number'||!Number.isFinite(p.x)||typeof p.y!=='number'||!Number.isFinite(p.y))throw Error('Refined clock requires exactly 0.15mm finite top wires and zero vias');
    for(const k of ['start_pcb_port_id','end_pcb_port_id'])if(p[k]!==undefined&&!text(p[k]))throw Error('Refined clock has malformed source markers');
  }
  let total=0;for(let i=1;i<t.route.length;i++)total+=Math.hypot(t.route[i].x-t.route[i-1].x,t.route[i].y-t.route[i-1].y);
  if(!Number.isFinite(total)||total<=0)throw Error('Refined clock route length is degenerate');
  return total;
}
const markers=(t:any)=>t.route.filter((p:any)=>p.start_pcb_port_id!==undefined||p.end_pcb_port_id!==undefined);

export interface RefinedClockAudit extends Omit<ImmutablePreloadAudit,'schema'> {
  schema:'moki.native-refined-clock-preloads/1';updatedTraceCount:number;mutatedTraceCount:number;
  changedClockTraceIds:string[];removedReturnedFixedTraceIds:string[];
  acceptedTraceSha256:Record<string,string>;lengthByNetMm:Record<string,number>;
  widthMm:.15;layer:'top';viaCount:0;sourceMetadataChanged:false;endpointsChanged:false;
  changes:Array<{traceId:string;connectionName:string;beforeSha256:string;afterSha256:string;beforeLengthMm:number;afterLengthMm:number;geometryChanged:boolean}>;
}
export function verifyRefinedClockPreloads(solver:any,output:any,expected:ImmutablePreloadExpected):{outputWithFixedTracesRemoved:any;acceptedClockTraces:any[];audit:RefinedClockAudit}{
  if(typeof solver?.getUpdatedPreloadedTraces!=='function'||typeof solver?.getMutatedPreloadedTraces!=='function')throw Error('Refined clock public preload getters unavailable');
  const updated=solver.getUpdatedPreloadedTraces(),mutated=solver.getMutatedPreloadedTraces();
  if(!Array.isArray(updated)||!Array.isArray(mutated)||expected.fixedTraceIds.length!==5||new Set(expected.fixedTraceIds).size!==5)throw Error('Refined clock preload coverage is malformed');
  const fixed=new Set(expected.fixedTraceIds),original=new Map(expected.traces.map(t=>[t.pcb_trace_id,t])),byId=new Map<string,any>(),changed=new Set<string>(),acceptedHashes:Record<string,string>=Object.create(null),lengthByNet:Record<string,number>=Object.create(null),changes:RefinedClockAudit['changes']=[];
  const clockOwners=new Set(expected.traces.filter(t=>fixed.has(t.pcb_trace_id)).flatMap(ownerRefs));
  for(const t of updated){
    hash(t);
    if(!plain(t)||!text(t.pcb_trace_id)||byId.has(t.pcb_trace_id)||!original.has(t.pcb_trace_id))throw Error('Refined clock getter has unknown/duplicate preload identity');
    const id=t.pcb_trace_id,before=original.get(id)!;byId.set(id,t);
    if(!fixed.has(id)){
      if(hash(t)!==expected.traceHashes[id])throw Error('Refined clock unrelated preload changed');
      continue;
    }
    if(hash(identity(t))!==hash(identity(before)))throw Error('Refined clock source/net/subcircuit/alias identity changed');
    const afterLength=length(t),beforeLength=length(before);
    if(hash(t.route[0])!==hash(before.route[0])||hash(t.route.at(-1))!==hash(before.route.at(-1))||hash(markers(t))!==hash(markers(before)))throw Error('Refined clock physical endpoints or source markers changed');
    if(hash(t)!==expected.traceHashes[id]){
      if(t.__replaces_pcb_trace_id!==id)throw Error('Refined clock changed preload has no exact native replacement claim');
      changed.add(id);changes.push({traceId:id,connectionName:t.connection_name,beforeSha256:expected.traceHashes[id]!,afterSha256:hash(t),beforeLengthMm:beforeLength,afterLengthMm:afterLength,geometryChanged:hash(t.route)!==hash(before.route)});
    }
    acceptedHashes[id]=hash(t);lengthByNet[t.connection_name]=(lengthByNet[t.connection_name]??0)+afterLength;
  }
  if(byId.size!==original.size||[...fixed].some(id=>!byId.has(id)))throw Error('Refined clock getter omitted preloaded copper');
  const totals=Object.values(lengthByNet);
  if(totals.length!==3||totals.some(n=>n>10))throw Error('Refined clock total length exceeds 10mm on a clock net');
  const mutatedIds=new Set<string>();
  for(const t of mutated){
    if(!plain(t)||!text(t.pcb_trace_id)||mutatedIds.has(t.pcb_trace_id)||!changed.has(t.pcb_trace_id)||hash(t)!==hash(byId.get(t.pcb_trace_id)))throw Error('Refined clock mutated getter disagrees with changed preloads');
    mutatedIds.add(t.pcb_trace_id);
  }
  if(mutatedIds.size!==changed.size)throw Error('Refined clock changed/mutated getter coverage differs');
  hash(output);const array=Array.isArray(output),traces=array?output:output?.traces;
  if(!Array.isArray(traces))throw Error('Refined clock native output has no traces');
  const outputIds=new Set<string>(),returnedChanged=new Set<string>(),removed:string[]=[],kept:any[]=[];
  for(const t of traces){
    if(!plain(t)||!text(t.pcb_trace_id)||outputIds.has(t.pcb_trace_id))throw Error('Refined clock output has malformed/duplicate identity');
    const id=t.pcb_trace_id;outputIds.add(id);
    if(!fixed.has(id)&&ownerRefs(t).some(owner=>clockOwners.has(owner)))throw Error('Refined clock output contains unexpected additional clock copper');
    if(t.__replaces_pcb_trace_id!==undefined&&!text(t.__replaces_pcb_trace_id))throw Error('Refined clock output has malformed replacement identity');
    if(t.__replaces_pcb_trace_id!==undefined&&original.has(t.__replaces_pcb_trace_id)&&!(changed.has(id)&&t.__replaces_pcb_trace_id===id))throw Error('Refined clock output has foreign/unproved preload replacement');
    if(original.has(id)&&hash(t)!==hash(byId.get(id)))throw Error('Refined clock output differs from native preload getter');
    if(fixed.has(id)&&!changed.has(id)){removed.push(id);continue;}
    if(changed.has(id))returnedChanged.add(id);
    kept.push(t);
  }
  if(returnedChanged.size!==changed.size)throw Error('Refined clock output omitted a native replacement');
  const acceptedClockTraces=updated.filter((t:any)=>fixed.has(t.pcb_trace_id));
  return{outputWithFixedTracesRemoved:structuredClone(array?kept:{...output,traces:kept}),acceptedClockTraces:structuredClone(acceptedClockTraces),audit:{...structuredClone(expected.audit),schema:'moki.native-refined-clock-preloads/1',updatedTraceCount:updated.length,mutatedTraceCount:mutated.length,changedClockTraceIds:[...changed],removedReturnedFixedTraceIds:removed,acceptedTraceSha256:{...acceptedHashes},lengthByNetMm:{...lengthByNet},widthMm:.15,layer:'top',viaCount:0,sourceMetadataChanged:false,endpointsChanged:false,changes}};
}
