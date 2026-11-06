import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { checkCopperNetlist } from '../eda/blocks/copper-netlist.js';
import type { PlanGraph } from '../src/blocks/graph.js';

// SYNTHETIC geometry fixtures: no catalog identity, native render or hardware proof.
function pour(id:string,x1:number,y1:number,x2:number,y2:number,layer='top') {
  return {type:'pcb_copper_pour',pcb_copper_pour_id:id,shape:'brep',layer,brep_shape:{outer_ring:{vertices:[{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}]},inner_rings:[]}};
}
function fixture() {
  const graph={parts:['A','B','C'].map(ref=>({ref,part:{pins:{p:{pad:'1',role:ref==='C'?'nc':'ground'}}}})),nets:[{name:'synthetic-ground',pins:['A','B'].map(ref=>({ref,logical:'p',pad:'1'}))}]} as unknown as PlanGraph;
  const mapping=Object.fromEntries(['A','B','C'].map(ref=>[ref,{'1':'pin1'}]));
  const circuit:any[]=[{type:'pcb_board',num_layers:2},pour('plane',-1,-1,5,1)];
  for(const [ref,x] of [['A',0],['B',4],['C',8]] as const)circuit.push(
    {type:'source_component',name:ref,source_component_id:ref},
    {type:'source_port',source_component_id:ref,source_port_id:`${ref}:source`,name:'pin1',pin_number:1,port_hints:['pin1']},
    {type:'pcb_component',source_component_id:ref,pcb_component_id:ref},
    {type:'pcb_port',pcb_component_id:ref,pcb_port_id:`${ref}:port`,source_port_id:`${ref}:source`},
    {type:'pcb_smtpad',pcb_smtpad_id:`${ref}:pad`,pcb_component_id:ref,pcb_port_id:`${ref}:port`,port_hints:['pin1'],shape:'rect',x,y:0,width:1,height:1,layer:'top'});
  return {graph,circuit,mapping};
}
const run=(f:ReturnType<typeof fixture>)=>checkCopperNetlist(f.graph,f.circuit,f.mapping);
const rules=(r:ReturnType<typeof run>)=>r.issues.map(i=>i.rule);

test('actual copper connects synthetic ground pads and excludes NC without logical union',()=>{
  const f=fixture(),before=JSON.stringify(f),r=run(f);assert.equal(r.ok,true,JSON.stringify(r.issues));assert.equal(r.scope,'ground-only-actual-copper');assert.equal(r.groundNets[0]!.islands.length,1);assert.equal(JSON.stringify(f),before);
});
test('severed or missing ground pour is an open despite fake connectivity labels',()=>{
  for(const missing of [false,true]) {const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');if(!missing)f.circuit.push(pour('left',-1,-1,1,1),pour('right',3,-1,5,1));f.circuit.forEach(e=>e.subcircuit_connectivity_map_key='FAKE_COMMON_GND');const r=run(f);assert.equal(r.ok,false);assert.ok(rules(r).includes('ground-open'));}
});
test('foreign NC pad touching plane fails physical isolation',()=>{const f=fixture();f.circuit.find(e=>e.pcb_smtpad_id==='C:pad').x=2;const r=run(f);assert.equal(r.ok,false);assert.ok(rules(r).includes('ground-short'));});
test('source trace labels cannot connect disconnected copper',()=>{const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');f.circuit.push(pour('left',-1,-1,1,1),pour('right',3,-1,5,1),{type:'pcb_trace',pcb_trace_id:'fake',source_trace_id:'all_ground',route:[{route_type:'wire',x:6,y:3,width:.3,layer:'top'},{route_type:'wire',x:7,y:3,width:.3,layer:'top'}]});assert.ok(rules(run(f)).includes('ground-open'));});
test('actual trace capsules join separate pours and unknown trace layers fail closed',()=>{const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');f.circuit.push(pour('left',-1,-1,1,1),pour('right',3,-1,5,1),{type:'pcb_trace',pcb_trace_id:'bridge',route:[{route_type:'wire',x:0,y:0,width:.3,layer:'top'},{route_type:'wire',x:4,y:0,width:.3,layer:'top'}]});assert.equal(run(f).ok,true);f.circuit.at(-1).route[1].layer='unknown';assert.equal(run(f).ok,false);});
test('every repeated exposed-pad piece needs actual copper continuity',()=>{const f=fixture();const p=f.circuit.find(e=>e.pcb_smtpad_id==='A:pad');f.circuit.push({...p,pcb_smtpad_id:'A:second-EP',x:12});const r=run(f);assert.ok(rules(r).includes('ground-open'));assert.ok(rules(r).includes('ground-pad-not-on-pour'));});
test('physical PCB port mapping is attested rather than inferred by net names',()=>{const f=fixture();f.circuit.find(e=>e.pcb_smtpad_id==='A:pad').pcb_port_id='C:port';assert.ok(rules(run(f)).includes('copper-geometry-unverified'));});
test('two physical plated barrels connect top islands through bottom copper',()=>{const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');f.circuit.push(pour('left',-1,-1,1,1),pour('right',3,-1,5,1),pour('back',-1,-1,5,1,'bottom'));for(const x of [.4,3.6])f.circuit.push({type:'pcb_via',pcb_via_id:`v${x}`,x,y:0,outer_diameter:.6,hole_diameter:.3,layers:['top','bottom'],from_layer:'top',to_layer:'bottom'});assert.equal(run(f).ok,true,JSON.stringify(run(f).issues));f.circuit.push({type:'pcb_hole',pcb_hole_id:'drilled-away',x:.4,y:0,hole_diameter:1.4});const r=run(f);assert.equal(r.ok,false);assert.ok(rules(r).includes('annulus-drilled-away'));});
test('NPTH drill void removes copper instead of acting as a copper connection',()=>{const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');f.circuit.push(pour('narrow',-1,-.1,5,.1),{type:'pcb_hole',pcb_hole_id:'sever',x:2,y:0,hole_diameter:1});assert.ok(rules(run(f)).includes('ground-open'));});
test('invalid annulus or unsupported pad geometry cannot pass',()=>{for(const bad of ['annulus','shape','layer']){const f=fixture();if(bad==='annulus')f.circuit.push({type:'pcb_via',x:2,y:0,outer_diameter:.3,hole_diameter:.3,layers:['top','bottom']});else f.circuit.find(e=>e.pcb_smtpad_id==='A:pad')[bad==='shape'?'shape':'layer']='unsupported';assert.equal(run(f).ok,false);}});
test('different trace widths cannot fabricate a wide positive-connectivity bridge',()=>{const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');f.circuit.push(pour('left',-1,-.51,1,.51),pour('right',3,-.51,5,.51),{type:'pcb_trace',pcb_trace_id:'variable-width',route:[{route_type:'wire',x:0,y:.7,width:.1,layer:'top'},{route_type:'wire',x:4,y:.7,width:1,layer:'top'}]});assert.ok(rules(run(f)).includes('ground-open'));});
test('pour hole excludes foreign copper rather than filling the void',()=>{const f=fixture();f.circuit.find(e=>e.pcb_smtpad_id==='C:pad').x=2;f.circuit.find(e=>e.type==='pcb_copper_pour').brep_shape.inner_rings=[{vertices:[{x:1.25,y:-.75},{x:2.75,y:-.75},{x:2.75,y:.75},{x:1.25,y:.75}]}];assert.equal(run(f).ok,true,JSON.stringify(run(f).issues));});
test('degenerate pour cannot act as a zero-width ground bridge',()=>{const f=fixture();f.circuit.find(e=>e.type==='pcb_copper_pour').brep_shape.outer_ring.vertices=[{x:0,y:0},{x:2,y:0},{x:4,y:0}];assert.ok(rules(run(f)).includes('copper-geometry-unverified'));});
test('circle, pill, rotated-rectangle and polygon pad copper is physically connected',()=>{for(const shape of [{shape:'circle',diameter:1},{shape:'pill',width:1,height:.8},{shape:'rotated_rect',width:1,height:.4,ccw_rotation:45},{shape:'polygon',points:[{x:-.5,y:-.5},{x:.5,y:-.5},{x:.5,y:.5},{x:-.5,y:.5}]}]){const f=fixture();Object.assign(f.circuit.find(e=>e.pcb_smtpad_id==='A:pad'),shape);assert.equal(run(f).ok,true,JSON.stringify(run(f).issues));}});
test('off-centre plated drill cannot borrow annulus width from the opposite side',()=>{const f=fixture();Object.assign(f.circuit.find(e=>e.pcb_smtpad_id==='A:pad'),{type:'pcb_plated_hole',pcb_plated_hole_id:'offset',shape:'circular_hole_with_rect_pad',rect_pad_width:1.2,rect_pad_height:1.2,hole_diameter:.3,hole_offset_x:.4,layers:['top','bottom']});assert.ok(rules(run(f)).includes('copper-geometry-unverified'));});

function bottomPlaneFixture() {
  const f=fixture();f.circuit=f.circuit.filter(e=>e.type!=='pcb_copper_pour');
  f.circuit.push(pour('bottom-ground',-1,1,5,3,'bottom'));
  for(const x of [0,4])f.circuit.push(
    {type:'pcb_trace',pcb_trace_id:`breakout-${x}`,route:[{route_type:'wire',x,y:0,width:.3,layer:'top'},{route_type:'wire',x,y:2,width:.3,layer:'top'},{route_type:'via',x,y:2,from_layer:'top',to_layer:'bottom',via_diameter:.6,via_hole_diameter:.3},{route_type:'wire',x,y:2,width:.3,layer:'bottom'}]},
    {type:'pcb_via',pcb_via_id:`breakout-via-${x}`,x,y:2,outer_diameter:.6,hole_diameter:.3,layers:['top','bottom'],from_layer:'top',to_layer:'bottom'});
  return f;
}
const physical=(f:ReturnType<typeof fixture>)=>checkCopperNetlist(f.graph,f.circuit,f.mapping,{policy:'physical-network'});
test('physical-network opt-in proves actual pad -> trace -> barrel -> bottom pour',()=>{
  const f=bottomPlaneFixture(),r=physical(f);assert.equal(r.ok,true,JSON.stringify(r.issues));assert.equal(r.policy,'physical-network');assert.ok(r.method.includes('policy=physical-network'));
  const direct=run(f);assert.equal(direct.policy,'top-plane');assert.equal(direct.ok,false);assert.ok(rules(direct).includes('ground-pad-not-on-pour'));
});
test('physical-network rejects a cut breakout trace and a missing actual via',()=>{
  const cut=bottomPlaneFixture();cut.circuit=cut.circuit.filter(e=>e.pcb_trace_id!=='breakout-0');assert.ok(rules(physical(cut)).includes('ground-open'));
  const missing=bottomPlaneFixture();missing.circuit=missing.circuit.filter(e=>e.pcb_via_id!=='breakout-via-0');assert.equal(physical(missing).ok,false);
  // Also remove the embedded route via: a coordinate coincidence across layers
  // must not stand in for a physical plated barrel.
  missing.circuit.find(e=>e.pcb_trace_id==='breakout-0').route=missing.circuit.find(e=>e.pcb_trace_id==='breakout-0').route.slice(0,2);
  assert.ok(rules(physical(missing)).includes('ground-open'));
});
test('physical-network still requires a pour and rejects foreign ground contact',()=>{
  const noPour=bottomPlaneFixture();noPour.circuit=noPour.circuit.filter(e=>e.type!=='pcb_copper_pour');noPour.circuit.push({type:'pcb_trace',pcb_trace_id:'bottom-bridge',route:[{route_type:'wire',x:0,y:2,width:.3,layer:'bottom'},{route_type:'wire',x:4,y:2,width:.3,layer:'bottom'}]});assert.ok(rules(physical(noPour)).includes('ground-network-not-on-pour'));
  const short=bottomPlaneFixture();Object.assign(short.circuit.find(e=>e.pcb_smtpad_id==='C:pad'),{x:2,y:2,layer:'bottom'});assert.ok(rules(physical(short)).includes('ground-short'));
});
test('unsupported policy fails closed instead of selecting a weaker policy',()=>{const f=fixture();assert.equal(checkCopperNetlist(f.graph,f.circuit,f.mapping,{policy:'unknown'} as any).ok,false);});

const actualDirectory='var/board-jobs-test-chip/365a210f-a69f-4526-a8e4-57abf5ad397d/';
test('retained actual native board exposes ground islands independently of source connectivity',{skip:!existsSync(actualDirectory+'circuit.json')},()=>{
  const j=(name:string)=>JSON.parse(readFileSync(actualDirectory+name,'utf8')),map=j('import-map.json');const r=checkCopperNetlist(j('plan-graph.json'),j('circuit.json'),Object.fromEntries(map.parts.map((p:any)=>[p.ref,p.pins])));
  assert.equal(r.ok,false);assert.ok(rules(r).includes('ground-open'),JSON.stringify(r.issues.slice(0,3)));assert.ok(r.groundNets[0]!.islands.length>1);assert.ok(r.counts.physicalPadPieces!>200);
});
