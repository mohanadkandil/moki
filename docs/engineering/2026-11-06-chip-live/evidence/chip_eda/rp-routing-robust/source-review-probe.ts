/** Independent read-only pure review probes; derived geometry, no native routing. */
import { readFileSync,writeFileSync } from 'node:fs';
import { repairNativeExits } from '../../../../../../eda/blocks/repair-native-exits.js';
import { createRpClockPhase } from '../../../../../../eda/blocks/rp-clock.js';
import { createRpEscapePhase } from '../../../../../../eda/blocks/rp-escape.js';
const root=new URL('./',import.meta.url),read=(n:string)=>JSON.parse(readFileSync(new URL(n,root),'utf8'));
const results:any[]=[];
for(const [rotation,tx,ty] of [[0,0,0],[90,1.23,-1.23],[90,-13.37,7.19],[270,1.23,-1.23],[180,.000003,-.000007]]){
 const circuit=read('circuit.json').filter((e:any)=>!['pcb_trace','pcb_via','pcb_copper_pour'].includes(e.type)&&!e.error_type),graph=read('plan-graph.json'),mapping=Object.fromEntries(read('import-map.json').parts.map((p:any)=>[p.ref,p.pins]));
 const a=rotation!*Math.PI/180,c=Math.cos(a),s=Math.sin(a),transform=(p:any)=>{const x=p.x,y=p.y;p.x=x*c-y*s+tx!;p.y=x*s+y*c+ty!;};
 for(const p of graph.parts){transform(p.at);p.at.rotation=(p.at.rotation??0)+rotation!;}
 for(const e of circuit){
  if(Number.isFinite(e.x)&&Number.isFinite(e.y))transform(e);
  for(const field of ['center','footprint_origin'])if(e[field])transform(e[field]);
  if(e.type==='pcb_component')e.rotation+=rotation!;
  if(e.type==='pcb_smtpad'&&['rect','pill','oval'].includes(e.shape)&&rotation!%180)[e.width,e.height]=[e.height,e.width];
  if(e.shape?.startsWith('rotated_'))e.ccw_rotation=(e.ccw_rotation??0)+rotation!;
  if(e.type==='pcb_plated_hole'){e.rect_ccw_rotation=(e.rect_ccw_rotation??0)+rotation!;e.hole_ccw_rotation=(e.hole_ccw_rotation??0)+rotation!;}
  for(const field of ['points','outline'])if(Array.isArray(e[field]))for(const p of e[field])transform(p);
  if((e.type==='pcb_board'||e.type==='pcb_keepout')&&rotation!%180)[e.width,e.height]=[e.height,e.width];
 }
 let phase:any;
 try{phase=createRpEscapePhase(circuit,graph,mapping,createRpClockPhase(circuit,graph,mapping));}
 catch(error){results.push({rotation,tx,ty,profileError:String(error)});continue;}
 phase.props.phaseIndex=2;
 const mismatches=[];
 for(const[index,p]of phase.audit.entries()){
  const port=circuit.find((e:any)=>e.type==='pcb_port'&&e.pcb_port_id===p.diagnosticPcbPortId),start=p.route[0];
  if(port.x!==start.x||port.y!==start.y)mismatches.push({pad:p.pad,port:{x:port.x,y:port.y},start:{x:start.x,y:start.y},delta:Math.hypot(port.x-start.x,port.y-start.y)});
  const source=circuit.find((e:any)=>e.type==='source_trace'&&e.source_trace_id===p.diagnosticSourceTraceId),last=p.route.at(-1),wire=(layer:string)=>({route_type:'wire',x:last.x,y:last.y,width:.15,layer}),pcb_trace_id=`saved_phase_null_2_${index}`;
  circuit.push({type:'pcb_trace',pcb_trace_id,connection_name:p.diagnosticSourceNetId,subcircuit_id:source.subcircuit_id,route:[...p.route.slice(0,-1),wire('top'),last,wire('bottom'),wire('bottom')]});
  circuit.push({type:'pcb_via',pcb_via_id:'REVIEW_DERIVED_'+index,pcb_trace_id,x:last.x,y:last.y,outer_diameter:.6,hole_diameter:.3,from_layer:'top',to_layer:'bottom',layers:['top','inner1','inner2','bottom'],subcircuit_id:source.subcircuit_id,subcircuit_connectivity_map_key:source.subcircuit_connectivity_map_key});
 }
 try{const r=repairNativeExits(circuit,graph,mapping,[phase]);results.push({rotation,tx,ty,mismatches,repairs:r.audit.length});}
 catch(error){results.push({rotation,tx,ty,mismatches,sourceError:String(error)});}
}
writeFileSync(new URL('source-review-probe.json',root),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
