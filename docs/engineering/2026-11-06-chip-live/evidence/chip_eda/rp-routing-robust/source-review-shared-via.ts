/** Independent exact-core-policy derivation: no native routing or source edits. */
import{readFileSync,writeFileSync}from'node:fs';import{repairNativeExits}from'../../../../../../eda/blocks/repair-native-exits.js';
const input=JSON.parse(readFileSync(new URL('../native-exit-serialization.json',import.meta.url),'utf8')),circuit=input.circuit as any[];
const mapping={R1:{'1':'pin1','2':'pin2'},R2:{'1':'pin1','2':'pin2'}},graph:any={parts:['R1','R2'].map(ref=>({ref,inst:ref,localRef:ref,part:{pins:{'1':{pad:'1',role:'passive'},'2':{pad:'2',role:'passive'}}}})),nets:[{name:'SUPPLY',pins:['R1','R2'].map(ref=>({ref,pad:'1',logical:'1'}))}]};
const phase={props:{phaseIndex:1,pcbTracePaths:input.paths},audit:input.paths.map((p:any,i:number)=>({ref:`R${i+1}`,pad:'1',netName:'SUPPLY',route:structuredClone(p.route)}))},prefixes=circuit.filter(e=>e.type==='pcb_trace'),ends=prefixes.map(p=>p.route.at(-1)),net=circuit.find(e=>e.type==='source_net'&&e.name==='SUPPLY'),source=circuit.find(e=>e.type==='source_trace');
const wire=(p:any,layer:string)=>({route_type:'wire',x:p.x,y:p.y,width:.15,layer}),via=(p:any,from:string,to:string)=>({route_type:'via',x:p.x,y:p.y,from_layer:from,to_layer:to,via_diameter:.6,via_hole_diameter:.3});
const join={type:'pcb_trace',pcb_trace_id:net.source_net_id+'_mst0_0',connection_name:net.source_net_id,subcircuit_id:source.subcircuit_id,connectsTo:prefixes.map(p=>p.pcb_trace_id+'_exit'),route:[wire(ends[0],'bottom'),via(ends[0],'bottom','inner1'),wire(ends[0],'inner1'),wire(ends[1],'inner1'),via(ends[1],'inner1','bottom'),wire(ends[1],'bottom')]};
circuit.push(join);
// Core materializer keeps the two already-present saved-prefix barrels: same
// subcircuit/key, exactxy, sameouter/drill/fullstack physically share a hole.
let result:any;try{const r=repairNativeExits(circuit,graph,mapping,[phase],{nativeRoutingInputs:input.captures.map((i:any)=>({solver:'AutoroutingPipelineSolver9_PreloadedTraceGraph',input:{input:i}}))});result={repaired:r.audit};}catch(error){result={rejected:String(error)};}
writeFileSync(new URL('source-review-shared-via.json',import.meta.url),JSON.stringify({kind:'derived valid physical-hole reuse matching installednative materializer dedup policy; no native routing',join,barrels:circuit.filter(e=>e.type==='pcb_via'),result},null,2)+'\n');console.log(JSON.stringify(result));
