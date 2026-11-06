import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNativePadHandoffs} from '../eda/blocks/native-handoffs.js';
import {createNativeFanoutPhase} from '../eda/blocks/fanout.js';
const original=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/native-handoffs-fixture.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(original);
const run=(f:any,names=new Set(['BOOTSEL']))=>createNativePadHandoffs(f.circuit,f.graph,f.mapping,names);
test('actual BOOTSEL handoff stays inside R2pin2 and keeps width/source/other endpoint unchanged',()=>{
 const f=fixture(),before=JSON.stringify(f),r=run(f);assert.equal(JSON.stringify(f),before);assert.equal(r.proposals.length,1);
 const p=r.proposals[0]!,a=r.audit[0]!;assert.equal(p.ref,'R2');assert.equal(p.pad,'2');assert.equal(a.lengthMm,.2);assert.equal(a.widthMm,.15);assert.equal(a.existingCopperOnly,true);
 assert.ok(Math.abs(p.route[1]!.x-p.route[0]!.x-.2)<1e-12);assert.equal(p.route[1]!.y,p.route[0]!.y);
 const bound=createNativeFanoutPhase(f.circuit,r.proposals);assert.equal(bound.props!.pcbTracePaths.length,1);assert.deepEqual(bound.netNames,['BOOTSEL']);
 assert.equal(f.graph.nets.find((n:any)=>n.name==='BOOTSEL').pins.length,2);assert.equal(f.circuit.some((e:any)=>e.type==='pcb_trace'),false);
});
test('actual cardinal component rotations produce contained native normal handoffs',()=>{
 for(const quarter of [1,2,3]){const f=fixture(),part=f.graph.parts.find((p:any)=>p.ref==='R2'),source=f.circuit.find((e:any)=>e.type==='source_component'&&e.name==='R2'),component=f.circuit.find((e:any)=>e.type==='pcb_component'&&e.source_component_id===source.source_component_id),origin=component.footprint_origin;
 const turn=(p:any)=>{const x=p.x-origin.x,y=p.y-origin.y,a=quarter*Math.PI/2;p.x=origin.x+x*Math.cos(a)-y*Math.sin(a);p.y=origin.y+x*Math.sin(a)+y*Math.cos(a);};
 part.at.rotation=(part.at.rotation??0)+quarter*90;component.rotation+=quarter*90;
 for(const p of f.circuit.filter((e:any)=>e.pcb_component_id===component.pcb_component_id)){if(typeof p.x==='number')turn(p);if(p.type==='pcb_smtpad'){p.shape='rotated_rect';p.ccw_rotation=quarter*90;}}
 const r=run(f);assert.equal(r.proposals.length,1);assert.ok(Math.abs(r.audit[0]!.normal.x-Math.cos(quarter*Math.PI/2))<1e-12);assert.ok(Math.abs(r.audit[0]!.normal.y-Math.sin(quarter*Math.PI/2))<1e-12);
 }
});
test('pill, too-small land, missing actual pad and noncardinal rotation fail safely',()=>{
 for(const change of [
  (f:any,p:any)=>{p.shape='pill';},(f:any,p:any)=>{p.width=.5;},
  (f:any,p:any)=>{f.circuit.splice(f.circuit.indexOf(p),1);},
  (f:any,p:any)=>{p.shape='rotated_rect';p.ccw_rotation=45;},
 ]){const f=fixture(),p=f.circuit.find((e:any)=>e.type==='pcb_smtpad'&&e.pcb_port_id==='pcb_port_103');change(f,p);assert.throws(()=>run(f),/eligible|geometry|physical/);}
});
test('wrong supplier/source/physical aliases and widths reject rather than inventing a pad',()=>{
 for(const change of [
  (f:any)=>{f.mapping.R2['2']='pin1';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='source_component'&&e.name==='R2').manufacturer_part_number='foreign';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='source_trace'&&e.display_name==='.R2 > .pin2 to net.BOOTSEL').min_trace_thickness=.14;},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='pcb_port'&&e.pcb_port_id==='pcb_port_103').x+=.01;},
 ]){const f=fixture();change(f);assert.throws(()=>run(f));}
});
test('requested net set is generic; no eligible endpoint fails clearly, empty set emits nothing',()=>{
 const f=fixture();assert.deepEqual(run(f,new Set()),{proposals:[],audit:[],netNames:[]});assert.throws(()=>run(f,new Set(['absent'])),/requested physical net/);
 const net=f.graph.nets.find((n:any)=>n.name==='BOOTSEL');net.name='RENAMED_NET';f.circuit.find((e:any)=>e.type==='source_net'&&e.name==='BOOTSEL').name='RENAMED_NET';assert.deepEqual(run(f,new Set(['RENAMED_NET'])).netNames,['RENAMED_NET']);
});
test('a derived pad-contained prefix alone still reports the remote switch physically unrouted',async()=>{
 const {checkEachPcbPortConnectedToPcbTraces}=await import('../eda/node_modules/@tscircuit/checks/dist/index.js');
 const f=fixture(),r=run(f),a=r.audit[0]!,source=f.circuit.find((e:any)=>e.type==='source_trace'&&e.source_trace_id===a.diagnosticSourceTraceId);
 const circuit=[...f.circuit,{type:'pcb_trace',pcb_trace_id:'DERIVED_INPAD_HANDOFF_ONLY',source_trace_id:a.diagnosticSourceTraceId,source_net_id:a.diagnosticSourceNetId,subcircuit_id:source.subcircuit_id,route:r.proposals[0]!.route.map((p,i)=>({...p,...i===0?{start_pcb_port_id:a.diagnosticPcbPortId}:{}}))}];
 const errors=checkEachPcbPortConnectedToPcbTraces(circuit);
 assert.ok(errors.some(e=>e.message.includes('SW2')&&e.message.includes('BOOTSEL')),'native physical connectivity must still fail for the remote switch');
});

const qspiNames=(f:any)=>new Set<string>(f.graph.nets.filter((n:any)=>n.name.startsWith('QSPI')).map((n:any)=>n.name));
const fineRun=(f:any,names=qspiNames(f))=>createNativePadHandoffs(f.circuit,f.graph,f.mapping,names,{allowFinePitchPads:true});
test('optional fine fallback covers actual six QSPI nets while default passive selection remains unchanged',()=>{
 const f=fixture(),before=structuredClone(f);assert.throws(()=>run(f,new Set(['QSPI_SD0'])),/eligible/);
 const r=fineRun(f);assert.equal(r.proposals.length,6);assert.equal(r.audit.filter(a=>a.ref==='U1').length,5);
 const ss=r.audit.find(a=>a.netName==='QSPI_SS')!;assert.ok(['R2','R3'].includes(ss.ref),'registered passive always wins over earlier MCU endpoint');
 assert.deepEqual(run(f),createNativePadHandoffs(f.circuit,f.graph,f.mapping,new Set(['BOOTSEL']),{allowFinePitchPads:false}));
 assert.deepEqual(f,before);assert.ok(r.proposals.every(p=>p.route.length===2&&p.route.every(q=>q.route_type==='wire')));
 const bound=createNativeFanoutPhase(f.circuit,r.proposals);assert.equal(bound.props!.pcbTracePaths.length,6);assert.deepEqual(new Set(bound.netNames),qspiNames(f));
});
function rotatedFineFixture(quarter:number,layers:2|4){
 const f=fixture(),a=quarter*Math.PI/2,rotate=(point:any)=>{const x=point.x,y=point.y;point.x=x*Math.cos(a)-y*Math.sin(a);point.y=x*Math.sin(a)+y*Math.cos(a);};
 for(const part of f.graph.parts){rotate(part.at);part.at.rotation=(part.at.rotation??0)+quarter*90;}
 for(const e of f.circuit){
  if(typeof e.type!=='string'||!e.type.startsWith('pcb_'))continue;
  if(typeof e.x==='number'&&typeof e.y==='number')rotate(e);
  if(e.center)rotate(e.center);if(e.footprint_origin)rotate(e.footprint_origin);
  if(e.type==='pcb_component')e.rotation+=quarter*90;
  if(e.type==='pcb_board'){e.num_layers=layers;if(quarter%2)[e.width,e.height]=[e.height,e.width];if(e.outline)for(const p of e.outline)rotate(p);}
  if(e.type==='pcb_smtpad'&&['rect','rotated_rect'].includes(e.shape)){e.shape='rotated_rect';e.ccw_rotation=(e.ccw_rotation??0)+quarter*90;}
  if(e.type==='pcb_plated_hole'){e.layers=layers===4?['top','inner1','inner2','bottom']:['top','bottom'];for(const key of['ccw_rotation','rect_ccw_rotation','hole_ccw_rotation'])if(e[key]!==undefined)e[key]+=quarter*90;}
 }
 return f;
}
test('actual QSPI handoffs remain fully contained across all cardinal world rotations and both physical layer counts',()=>{
 for(const layers of[2,4]as const)for(const quarter of[0,1,2,3]){
  const f=rotatedFineFixture(quarter,layers),before=structuredClone(f),result=fineRun(f);assert.equal(result.proposals.length,6);assert.deepEqual(f,before);
  for(const audit of result.audit){const land=f.circuit.find((p:any)=>p.type==='pcb_smtpad'&&p.pcb_smtpad_id===audit.landId),angle=-(land.ccw_rotation??0)*Math.PI/180;
   assert.ok(Math.abs(Math.hypot(audit.route[1]!.x-audit.route[0]!.x,audit.route[1]!.y-audit.route[0]!.y)-.2)<1e-12);
   for(const p of audit.route){assert.equal(p.route_type,'wire');if(p.route_type!=='wire')continue;const x=p.x-land.x,y=p.y-land.y,u=x*Math.cos(angle)-y*Math.sin(angle),v=x*Math.sin(angle)+y*Math.cos(angle);assert.ok(Math.abs(u)+p.width/2<land.width/2);assert.ok(Math.abs(v)+p.width/2<land.height/2);}
  }
 }
});
function bothFineLands(f:any){return f.graph.nets.find((n:any)=>n.name==='QSPI_SD0').pins.map((endpoint:any)=>{const s=f.circuit.find((e:any)=>e.type==='source_component'&&e.name===endpoint.ref),pin=f.circuit.find((e:any)=>e.type==='source_port'&&e.source_component_id===s.source_component_id&&e.port_hints?.includes(f.mapping[endpoint.ref][endpoint.pad])),port=f.circuit.find((e:any)=>e.type==='pcb_port'&&e.source_port_id===pin.source_port_id);return f.circuit.find((e:any)=>e.type==='pcb_smtpad'&&e.pcb_port_id===port.pcb_port_id);});}
test('fine fallback rejects unsupported land/pose/cap containment, malformed source identity and minimum-width mismatch',()=>{
 for(const mutate of[
  (f:any)=>{for(const p of bothFineLands(f))p.shape='pill';},
  (f:any)=>{for(const p of bothFineLands(f)){p.shape='rotated_rect';p.ccw_rotation=45;}},
  (f:any)=>{for(const p of bothFineLands(f))p.corner_radius=.1;},
  (f:any)=>{for(const p of bothFineLands(f)){p.width=.3;p.height=.3;}},
  (f:any)=>{bothFineLands(f)[0].width=NaN;},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='source_component'&&e.name==='U1').manufacturer_part_number='unknown';},
  (f:any)=>{f.mapping.U1['53']='pin54';},
  (f:any)=>{f.circuit.find((e:any)=>e.type==='pcb_board').min_trace_width=.2;},
  (f:any)=>{for(const r of['U1','U2'])f.graph.parts.find((p:any)=>p.ref===r).block.version=999;},
 ]){const f=fixture();mutate(f);assert.throws(()=>fineRun(f,new Set(['QSPI_SD0'])),/eligible|geometry|source|identity|minimum|alias|physical/);}
 for(const options of[{allowFinePitchPads:'yes'},{allowFinePitchPads:true,unknown:true},null]){const f=fixture();assert.throws(()=>createNativePadHandoffs(f.circuit,f.graph,f.mapping,new Set(['QSPI_SD0']),options as any),/options/);}
});
test('a physical drill void cutting either fine endpoint cannot be certified as existing pad copper',()=>{
 const f=fixture();for(const [i,p]of bothFineLands(f).entries())f.circuit.push({type:'pcb_hole',pcb_hole_id:'foreign-drill-'+i,x:p.x,y:p.y,hole_shape:'circle',hole_diameter:.3});
 assert.throws(()=>fineRun(f,new Set(['QSPI_SD0'])),/eligible|drill|hole/);
});

test('same-net plated drill voids cannot become positive fine-handoff copper despite native ownership exemptions',()=>{
 for(const offset of[0,.2]){
  const f=fixture();for(const[i,p]of bothFineLands(f).entries())f.circuit.push({type:'pcb_plated_hole',pcb_plated_hole_id:'same-net-void-'+i,pcb_port_id:p.pcb_port_id,pcb_component_id:p.pcb_component_id,x:p.x,y:p.y+offset,shape:'circle',outer_diameter:.8,hole_diameter:.3,layers:['top','bottom']});
  assert.throws(()=>fineRun(f,new Set(['QSPI_SD0'])),/eligible|drill/);
 }
});
test('all physical drill kinds and offsets conservatively exclude capsule contacts without reading their net labels',()=>{
 for(const shape of[
  {type:'pcb_hole',hole_shape:'circle',hole_diameter:.3},
  {type:'pcb_plated_hole',shape:'circle',hole_diameter:.3,outer_diameter:.8,layers:['top','bottom']},
  {type:'pcb_plated_hole',shape:'pill',hole_width:.3,hole_height:.6,outer_width:.8,outer_height:1,layers:['top','bottom']},
  {type:'pcb_hole',hole_shape:'rect',hole_width:.3,hole_height:.4},
  {type:'pcb_hole',hole_shape:'square',hole_diameter:.3},
  {type:'pcb_plated_hole',shape:'circle',hole_shape:'rect',hole_diameter:.3,hole_width:.01,hole_height:.01,outer_diameter:.8,layers:['top','bottom']},
  {type:'pcb_plated_hole',shape:'pill',hole_shape:'circle',hole_diameter:.01,hole_width:.3,hole_height:.6,outer_width:.8,outer_height:1,layers:['top','bottom']},
 ]){
  const f=fixture();for(const[i,p]of bothFineLands(f).entries())f.circuit.push({...shape,pcb_hole_id:'void-'+i,pcb_plated_hole_id:'void-'+i,pcb_port_id:p.pcb_port_id,pcb_component_id:p.pcb_component_id,x:p.x+1,y:p.y,hole_offset_x:-1,hole_offset_y:0,subcircuit_connectivity_map_key:'SAME-NET-LABEL-CANNOT-RESTORE-COPPER'});
  assert.throws(()=>fineRun(f,new Set(['QSPI_SD0'])),/eligible|drill/);
 }
 for(const mutation of[
  {hole_shape:'unknown'}, {hole_shape:null,hole_diameter:.3}, {hole_shape:'circle',hole_diameter:0},{hole_shape:'circle',hole_diameter:NaN},
  {hole_shape:'circle',hole_diameter:.3,hole_offset_x:Infinity},
 ]){const f=fixture();f.circuit.push({type:'pcb_hole',pcb_hole_id:'bad',x:100,y:100,...mutation});assert.throws(()=>fineRun(f,new Set(['QSPI_SD0'])),/drill/);}
});
test('existing via drill remains rejected before routing and a distant valid plated drill does not change fine output',()=>{
 const f=fixture(),before=fineRun(f,new Set(['QSPI_SD0']));
 f.circuit.push({type:'pcb_plated_hole',pcb_plated_hole_id:'distant',x:100,y:100,shape:'circle',outer_diameter:.8,hole_diameter:.3,layers:['top','bottom']});
 assert.deepEqual(fineRun(f,new Set(['QSPI_SD0'])),before);
 const p=bothFineLands(f)[0];f.circuit.push({type:'pcb_via',pcb_via_id:'via-void',x:p.x,y:p.y,outer_diameter:.6,hole_diameter:.3,layers:['top','bottom']});
 assert.throws(()=>fineRun(f,new Set(['QSPI_SD0'])),/before routed copper/);
});
