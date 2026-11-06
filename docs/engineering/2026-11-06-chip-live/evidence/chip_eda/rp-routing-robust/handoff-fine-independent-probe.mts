import{readFileSync}from'node:fs';import assert from'node:assert/strict';import{createNativePadHandoffs}from'/home/sogo/design-skill-research/repos/moki/eda/blocks/native-handoffs.ts';
const base=JSON.parse(readFileSync('/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/native-handoffs-fixture.json','utf8'));
const run=(f:any)=>createNativePadHandoffs(f.circuit,f.graph,f.mapping,new Set(['QSPI_SD0']),{allowFinePitchPads:true});
const baseline=run(base);assert.equal(baseline.proposals.length,1);
const results=[];
for(const name of['same-net-drill','capsule-graze','mixed-dimensions','nonfinite-offset','unknown-shape']){
 const f=structuredClone(base);
 for(const [i,ep]of f.graph.nets.find((n:any)=>n.name==='QSPI_SD0').pins.entries()){
  const source=f.circuit.find((e:any)=>e.type==='source_component'&&e.name===ep.ref),pin=f.circuit.find((e:any)=>e.type==='source_port'&&e.source_component_id===source.source_component_id&&e.port_hints?.includes(f.mapping[ep.ref][ep.pad])),port=f.circuit.find((e:any)=>e.type==='pcb_port'&&e.source_port_id===pin.source_port_id),pad=f.circuit.find((e:any)=>e.type==='pcb_smtpad'&&e.pcb_port_id===port.pcb_port_id);
  const hole:any={type:'pcb_plated_hole',pcb_plated_hole_id:'INDEPENDENT_'+i,pcb_port_id:port.pcb_port_id,pcb_component_id:pad.pcb_component_id,x:pad.x,y:pad.y,shape:'circle',outer_diameter:.8,hole_diameter:.3,layers:['top','bottom']};
  if(name==='capsule-graze'){hole.y+=.15+.075-1e-6;}
  if(name==='mixed-dimensions'){hole.hole_shape='rect';hole.hole_width=.001;hole.hole_height=.001;}
  if(name==='nonfinite-offset')hole.hole_offset_y=NaN;
  if(name==='unknown-shape')hole.shape='future-shape';
  f.circuit.push(hole);
 }
 const before=structuredClone(f);assert.throws(()=>run(f));assert.deepEqual(f,before);results.push({name,rejected:true,inputUnchanged:true});
}
console.log(JSON.stringify({baselineProposals:baseline.proposals.length,results},null,2));
