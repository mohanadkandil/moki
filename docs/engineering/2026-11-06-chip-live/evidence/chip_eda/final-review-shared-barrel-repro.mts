// Independent pure alternate representation: no redundant coincident away-layer contacts.
// Official Gerber conversion draws via→wire and wire→via segments on the wire layer.
// Native captured source/pads/barrels/SRJ are unchanged; join below is DERIVED.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {repairNativeExits} from '../../../../../eda/blocks/repair-native-exits.js';
const f=JSON.parse(readFileSync(new URL('./native-exit-serialization.json',import.meta.url),'utf8'));
const circuit=f.circuit, prefixes=circuit.filter((e:any)=>e.type==='pcb_trace');
const graph:any={parts:['R1','R2'].map(ref=>({ref,part:{pins:{'1':{pad:'1',role:'passive'},'2':{pad:'2',role:'passive'}}}})),nets:[{name:'SUPPLY',pins:['R1','R2'].map(ref=>({ref,pad:'1',logical:'1'}))}]};
const mapping={R1:{'1':'pin1','2':'pin2'},R2:{'1':'pin1','2':'pin2'}};
const phase={props:{phaseIndex:1,pcbTracePaths:f.paths},audit:f.paths.map((p:any,i:number)=>({ref:`R${i+1}`,pad:'1',netName:'SUPPLY',route:p.route}))};
const [l,r]=prefixes.map((p:any)=>p.route.at(-1));
const wire=(x:number,y:number,layer:string)=>({route_type:'wire',x,y,layer,width:.15});
const via=(p:any,from_layer:string,to_layer:string)=>({route_type:'via',x:p.x,y:p.y,from_layer,to_layer,via_diameter:.6,via_hole_diameter:.3});
const join={type:'pcb_trace',pcb_trace_id:'source_net_0_mst0_0',connection_name:'source_net_0',subcircuit_id:prefixes[0].subcircuit_id,connectsTo:prefixes.map((p:any)=>p.pcb_trace_id+'_exit'),route:[wire(l.x,l.y,'bottom'),via(l,'bottom','inner1'),wire(l.x+1,l.y,'inner1'),wire(r.x-1,r.y,'inner1'),via(r,'inner1','bottom'),wire(r.x,r.y,'bottom')]};
circuit.unshift(join);
const result=repairNativeExits(circuit,graph,mapping,[phase],{nativeRoutingInputs:f.captures.map((input:any)=>({solver:'AutoroutingPipelineSolver9_PreloadedTraceGraph',input:{input}}))});
assert.equal(result.audit.length,1);
assert.deepEqual(result.circuit.find((e:any)=>e.pcb_trace_id===join.pcb_trace_id).route,join.route);
const wrong=structuredClone(circuit);wrong.find((e:any)=>e.type==='pcb_via').pcb_trace_id='UNPROVEN_OWNER';
assert.throws(()=>repairNativeExits(wrong,graph,mapping,[phase],{nativeRoutingInputs:f.captures.map((input:any)=>({solver:'AutoroutingPipelineSolver9_PreloadedTraceGraph',input:{input}}))}),/barrel/);
console.log(JSON.stringify({alternateViaWireRepresentation:'accepted with unchanged geometry',unprovedBarrelOwner:'rejected',officialGerberSupportsViaWireSegments:true},null,2));
