import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{lockKnownPadOwnership}from'../eda/blocks/locked-pads.js';
const raw=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/locked-pads-fixture.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(raw),run=(f:any)=>lockKnownPadOwnership(f.input,f.circuit,f.graph,f.mapping),target=(f:any)=>f.input.obstacles.find((o:any)=>o.netIsAssignable===true&&o.circuitJsonMetadata?.pcb_smtpad_id);
test('all45actual knownGNDcomponent pads are locked with no changes to geometry,aliases,source or routing data',()=>{
 const f=fixture(),before=structuredClone(f),r=run(f);assert.equal(r.audit.length,45);assert.ok(r.audit.every(a=>a.net==='GND'));
 assert.deepEqual(f,before);assert.equal(r.input.connections,f.input.connections);assert.equal(r.input.traces,f.input.traces);
 for(let i=0;i<f.input.obstacles.length;i++){const a=f.input.obstacles[i],b=r.input.obstacles[i];if(a.netIsAssignable===true){assert.equal(b.netIsAssignable,false);assert.deepEqual({...b,netIsAssignable:true},a);assert.equal(b.connectedTo,a.connectedTo);assert.equal(b.circuitJsonMetadata,a.circuitJsonMetadata);}else assert.equal(b,a);}
 assert.ok(f.circuit.some((e:any)=>e.type==='pcb_trace'),'existingclock/globalCu is allowed,not erased');
});
test('nonphysical assignables and unflagged knownphysical pads retain their exact records',()=>{
 const f=fixture();f.input.obstacles.push({type:'rect',obstacleId:'native-unowned-plane',layers:['bottom'],center:{x:100,y:100},width:1,height:1,connectedTo:[],netIsAssignable:true});
 const r=run(f);assert.equal(r.audit.length,45);assert.equal(r.input.obstacles.at(-1),f.input.obstacles.at(-1));assert.equal(r.input.obstacles.at(-1).netIsAssignable,true);
 for(const o of f.input.obstacles)if(o.circuitJsonMetadata)o.netIsAssignable=false;const noop=run(f);assert.equal(noop.audit.length,0);assert.equal(noop.input,f.input);
});
test('forged pad,port,component,ambiguous metadata and missing owner aliases reject',()=>{
 for(const mutate of[
  (f:any,o:any)=>{o.circuitJsonMetadata.pcb_smtpad_id='missing-pad';},
  (f:any,o:any)=>{o.circuitJsonMetadata.pcb_port_id='missing-port';},
  (f:any,o:any)=>{o.circuitJsonMetadata.pcb_port_id='pcb_port_52';},
  (f:any,o:any)=>{o.componentId='foreign-component';},
  (f:any,o:any)=>{o.isCopperPour=true;},
  (f:any,o:any)=>{o.netIsAssignable='true';},
  (f:any,o:any)=>{o.circuitJsonMetadata.pcb_plated_hole_id='contradictory';},
  (f:any,o:any)=>{delete o.circuitJsonMetadata.pcb_port_id;},
  (f:any,o:any)=>{o.connectedTo=o.connectedTo.filter((id:string)=>id!=='source_net_4');},
  (f:any,o:any)=>{o.connectedTo.push('source_net_13');},
  (f:any,o:any)=>{o.connectedTo.push('pcb_port_52');},
 ]){const f=fixture();mutate(f,target(f));assert.throws(()=>run(f),/Pad ownership/);}
});
test('actual catalog,source,import,graph and subcircuit identity must prove the same physical net',()=>{
 for(const mutate of[
  (f:any)=>{f.mapping.U1['57']='pin53';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='source_component'&&e.name==='U1').manufacturer_part_number='unknown';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='source_net'&&e.name==='GND').name='MISLABELED';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='source_net'&&e.name==='GND').subcircuit_connectivity_map_key='foreign';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='pcb_port'&&e.pcb_port_id==='pcb_port_56').source_port_id='source_port_52';},
  (f:any)=>{f.graph.nets.find((n:any)=>n.name==='GND').pins.splice(0,1);},
 ]){const f=fixture();mutate(f);assert.throws(()=>run(f),/Pad ownership/);}
});
test('missing or duplicate actual pad and physical-port identities reject without partial input mutations',()=>{
 for(const kind of['missing-pad','duplicate-pad','duplicate-port']){const f=fixture(),o=target(f),pad=f.circuit.find((e:any)=>e.type==='pcb_smtpad'&&e.pcb_smtpad_id===o.circuitJsonMetadata.pcb_smtpad_id);if(kind==='missing-pad')f.circuit.splice(f.circuit.indexOf(pad),1);else if(kind==='duplicate-pad')f.circuit.push(structuredClone(pad));else f.circuit.push(structuredClone(f.circuit.find((e:any)=>e.type==='pcb_port'&&e.pcb_port_id===pad.pcb_port_id)));const before=structuredClone(f);assert.throws(()=>run(f),/Pad ownership/);assert.deepEqual(f,before);}
});

test('source net names cannot impersonate isolated-terminal ownership tokens',()=>{
 const f=fixture(),net=f.graph.nets.find((n:any)=>n.name==='GND');net.name='isolated:U1.3';f.circuit.find((e:any)=>e.type==='source_net'&&e.name==='GND').name=net.name;
 const source=f.circuit.find((e:any)=>e.type==='source_component'&&e.name==='U1'),pin=f.circuit.find((e:any)=>e.type==='source_port'&&e.source_component_id===source.source_component_id&&e.pin_number===3),port=f.circuit.find((e:any)=>e.type==='pcb_port'&&e.source_port_id===pin.source_port_id);
 assert.ok(!f.graph.nets.some((n:any)=>n.pins.some((p:any)=>p.ref==='U1'&&p.pad==='3')));target(f).connectedTo.push(port.pcb_port_id);assert.throws(()=>run(f),/aliases conflict/);
});
