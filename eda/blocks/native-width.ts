/** Replay the pinned native pipeline's own width-expansion stage. No custom
 * pathfinding or point/width edits; the native stage owns every copper change.
 * Extra planning reserve may be consumed down to the unchanged fabrication
 * clearances only for residual subminimum tracks. Final native DRC still gates. */
import {performance} from 'node:perf_hooks';
type Trace = {pcb_trace_id:string;connection_name:string;route:any[];[key:string]:any};
export interface WidthFabricationRules { traceToPad: number; traceToTrace: number; viaToPad: number }
export async function restoreNativeWidths(pipeline:any, input:any, traces:Trace[], rules:WidthFabricationRules, shouldStop:()=>boolean=()=>false) {
  const floor=input.minTraceWidth ?? .15,eps=1e-9;
  if(!Number.isFinite(floor)||floor<=0||Object.values(rules).some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid native width/fabrication constraints');
  const definition=pipeline.pipelineDef?.find((p:any)=>p.solverName==='powerTraceExpansionSolver');
  if(!definition)throw Error('Pinned native width stage is unavailable');
  const minimum=(ts:Trace[])=>Math.min(...ts.flatMap(t=>t.route.filter(p=>p.route_type==='wire').map(p=>p.width)));
  const audit:any[]=[];
  if(!Array.isArray(traces)||!traces.length||traces.some(t=>!Array.isArray(t.route)||t.route.some(p=>p.route_type==='wire'&&(!Number.isFinite(p.width)||p.width<=0))))throw Error('Native width expansion received malformed wire widths');
  async function expand(current:Trace[],names:string[],fabrication:boolean){
    if(shouldStop())throw Error('Native width expansion was stopped');
    const planned=fabrication?{...input,defaultObstacleMargin:rules.traceToTrace,minTraceToPadEdgeClearance:rules.traceToPad,minViaEdgeToPadEdgeClearance:rules.viaToPad}:input;
    // Only subminimum traces are mutable. Native refinement may otherwise
    // shove already-valid unrelated copper during its cleanup passes.
    const mutable=current.filter(t=>t.route.some(p=>p.route_type==='wire'&&p.width<floor-eps));
    const mutableIds=new Set(mutable.map(t=>t.pcb_trace_id));
    const fixed=[...current.filter(t=>!mutableIds.has(t.pcb_trace_id)),...(input.traces??[])];
    if(new Set(fixed.map(t=>t.pcb_trace_id)).size!==fixed.length||fixed.some(t=>mutableIds.has(t.pcb_trace_id)))throw Error('Native width repair has conflicting fixed preload identities');
    const stage=new definition.solverClass({...planned,traces:mutable,fixedTraces:fixed},{onlyConnectionNames:names,allowNewVias:false});
    const at=performance.now();
    while(!stage.solved&&!stage.failed){
      if(shouldStop())throw Error('Native width expansion was stopped');
      const until=performance.now()+100;
      while(!stage.solved&&!stage.failed&&!shouldStop()&&performance.now()<until)stage.step();
      if(performance.now()-at>90000)throw Error('Native width expansion exceeded90seconds');
      await new Promise(r=>setTimeout(r,0));
    }
    if(shouldStop())throw Error('Native width expansion was stopped');
    if(stage.failed)throw Error(stage.error??'Native width expansion failed');
    const nativeOutput=stage.getOutput() as Trace[];
    if(nativeOutput.length!==mutable.length||new Set(nativeOutput.map(t=>t.pcb_trace_id)).size!==mutable.length||nativeOutput.some(t=>!mutableIds.has(t.pcb_trace_id)))throw Error('Native width stage changed trace identity/coverage');
    const replacements=new Map(nativeOutput.map(t=>[t.pcb_trace_id,t]));
    const output=current.map(t=>replacements.get(t.pcb_trace_id)??t);
    audit.push({solver:'PowerTraceExpansionSolver',onlyConnectionNames:names,mutableTraceIds:[...mutableIds],fixedTraceIds:fixed.map(t=>t.pcb_trace_id),fabricationPlanning:fabrication,clearances:{traceToPad:planned.minTraceToPadEdgeClearance,traceToTrace:planned.defaultObstacleMargin,viaToPad:planned.minViaEdgeToPadEdgeClearance},allowNewVias:false,ms:performance.now()-at,beforeMin:minimum(current),afterMin:minimum(output),stats:stage.stats});
    return output;
  }
  if(shouldStop())throw Error('Native width expansion was stopped');
  if(new Set(traces.map(t=>t.pcb_trace_id)).size!==traces.length||traces.some(t=>typeof t.pcb_trace_id!=='string'||!t.pcb_trace_id))throw Error('Native width expansion requires unique trace identities');
  const initial=[...new Set(traces.filter(t=>t.route.some(p=>p.route_type==='wire'&&p.width<floor-eps)).map(t=>t.connection_name))];
  if(!initial.length)return{traces,audit};
  let output=await expand(traces,initial,false);
  const under=[...new Set(output.filter(t=>t.route.some(p=>p.route_type==='wire'&&p.width<floor-eps)).map(t=>t.connection_name))];
  if(under.length)output=await expand(output,under,true);
  const min=minimum(output);
  if(!Number.isFinite(min)||min<floor-eps)throw Error(`Native width expansion leaves ${min}mm below required ${floor}mm`);
  return{traces:output,audit};
}
