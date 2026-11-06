// Independent, synthetic policy mutants. Run from repository root:
// node --import tsx docs/engineering/2026-11-05-chip-level/evidence/chip_eda/copper-review-next.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { checkCopperNetlist } = await import(pathToFileURL(resolve('eda/blocks/copper-netlist.ts')).href);
const graph = { parts: ['A','B','C'].map(ref => ({ ref, part: { pins: { p: {pad:'1',role:ref === 'C' ? 'nc' : 'ground'} } } })), nets: [{name:'GND',pins:['A','B'].map(ref => ({ref,logical:'p',pad:'1'}))}] };
const mapping = Object.fromEntries(['A','B','C'].map(ref => [ref, {'1':'pin1'}]));
function fixture() {
  const circuit = [{type:'pcb_board',num_layers:2},{type:'pcb_copper_pour',pcb_copper_pour_id:'bottom',layer:'bottom',shape:'brep',brep_shape:{outer_ring:{vertices:[{x:-1,y:1},{x:5,y:1},{x:5,y:3},{x:-1,y:3}]},inner_rings:[]}}];
  for (const [ref,x] of [['A',0],['B',4],['C',8]]) circuit.push(
    {type:'source_component',name:ref,source_component_id:ref},
    {type:'source_port',source_component_id:ref,source_port_id:ref, name:'pin1',pin_number:1,port_hints:['pin1']},
    {type:'pcb_component',source_component_id:ref,pcb_component_id:ref},
    {type:'pcb_port',pcb_component_id:ref,pcb_port_id:ref,source_port_id:ref},
    {type:'pcb_smtpad',pcb_smtpad_id:ref,pcb_component_id:ref,pcb_port_id:ref,port_hints:['pin1'],shape:'rect',x,y:0,width:1,height:1,layer:'top'});
  for (const x of [0,4]) circuit.push(
    {type:'pcb_trace',pcb_trace_id:'t'+x,route:[{route_type:'wire',x,y:0,width:.3,layer:'top'},{route_type:'wire',x,y:2,width:.3,layer:'top'}]},
    {type:'pcb_via',pcb_via_id:'v'+x,x,y:2,outer_diameter:.6,hole_diameter:.3,layers:['top','bottom']});
  return circuit;
}
const results=[];
function check(name, mutate, expected, rule) {
  const circuit=fixture(); mutate(circuit);
  const result=checkCopperNetlist(graph,circuit,mapping,{policy:'physical-network'});
  assert.equal(result.ok,expected,JSON.stringify(result.issues));
  if(rule)assert.ok(result.issues.some(i=>i.rule===rule),JSON.stringify(result.issues));
  results.push({name,ok:result.ok,rules:result.issues.map(i=>i.rule)});
}
check('positive actual top-trace/barrel/bottom-pour',()=>{},true);
check('disconnected repeated physical pad piece',c=>{c.push({...c.find(p=>p.pcb_smtpad_id==='A'),pcb_smtpad_id:'A-repeat',x:12});},false,'ground-open');
check('foreign drill cuts a required barrel',c=>c.push({type:'pcb_hole',pcb_hole_id:'cut',x:0,y:2,hole_diameter:.5}),false,'annulus-drilled-away');
check('isolated NC shorts through actual bottom pour',c=>Object.assign(c.find(p=>p.pcb_smtpad_id==='C'),{x:2,y:2,layer:'bottom'}),false,'ground-short');
check('common logical connectivity metadata cannot bridge a missing via',c=>{c.splice(c.findIndex(p=>p.pcb_via_id==='v0'),1);c.forEach(p=>p.subcircuit_connectivity_map_key='GND');},false,'ground-open');
console.log(JSON.stringify({scope:'independent synthetic physical-network policy mutants',results},null,2));
