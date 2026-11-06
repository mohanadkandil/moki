import{readFileSync}from'node:fs';
import{createRpClockPhase}from'../../../../../eda/blocks/rp-clock.js';
const root=new URL('./rp-motor/',import.meta.url),read=(name:string)=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
const circuit=read('clock-fixture-circuit.json'),graph=read('clock-fixture-graph.json'),map=read('clock-fixture-map.json');
const source=circuit.find((e:any)=>e.type==='source_component'&&e.name==='C15');
const pin=circuit.find((e:any)=>e.type==='source_port'&&e.source_component_id===source.source_component_id&&e.pin_number===1);
const port=circuit.find((e:any)=>e.type==='pcb_port'&&e.source_port_id===pin.source_port_id);
const pad=circuit.find((e:any)=>e.type==='pcb_smtpad'&&e.pcb_port_id===port.pcb_port_id);
pad.shape='pill';port.x=pad.x+pad.width/2-.01;port.y=pad.y+pad.height/2-.01;
const r=pad.height/2,halfStraight=(pad.width-pad.height)/2;
const offCopperDistance=Math.hypot(port.x-pad.x-halfStraight,port.y-pad.y)-r;
let error='';try{createRpClockPhase(circuit,graph,map);}catch(e){error=String(e);}
if(!/physical land/.test(error))throw Error('Independent off-copper pill mutant did not fail its physical contact guard: '+error);
console.log(JSON.stringify({mutant:'Pill endpoint port is in bounding-box corner but outside actual capsule copper',offCopperDistanceMm:offCopperDistance,traceRadiusMm:.15/2,rejected:true,error},null,2));
