import test from 'node:test';
import assert from 'node:assert/strict';
import {relocateSensorConnectionPoints} from '../eda/blocks/sensor-exits.js';
// Synthetic phase slices exercise the known sensor geometry, not catalog/PCB acceptance.
const graph:any={parts:[{ref:'U_SENSOR',part:{lcsc:'C2909890'},at:{x:10,y:20,rotation:0}}]};
const phase=(points:any[])=>({connections:points.map((p,i)=>({name:`phase${i}`,pointsToConnect:[{...p,layer:'top',pcb_port_id:`p${i}`}]})),obstacles:[{width:2,height:2}]});
test('explicit routing phases may contain zero, one, two or all four sensor pins',()=>{
 const pins=[{x:9.322582,y:20.40005},{x:9.322582,y:19.59995},{x:10.677418,y:19.59995},{x:10.677418,y:20.40005}];
 for(const count of [0,1,2,4]){const input=phase(pins.slice(0,count)),before=structuredClone(input),r=relocateSensorConnectionPoints(input,graph);assert.equal(r.moves.length,count);assert.deepEqual(input,before);assert.deepEqual(r.input.obstacles,input.obstacles);for(const c of r.input.connections)assert.ok([8.8,11.2].some(x=>Math.abs(c.pointsToConnect[0]!.x-x)<1e-8));}
 const foreign=phase([{x:0,y:0}]);assert.deepEqual(relocateSensorConnectionPoints(foreign,graph).input,foreign);
});
test('cardinal section rotations transform only applicable sensor endpoints',()=>{
 const g=structuredClone(graph);g.parts[0].at.rotation=90;
 const r=relocateSensorConnectionPoints(phase([{x:9.59995,y:19.322582}]),g);assert.equal(r.moves.length,1);assert.ok(Math.abs(r.input.connections[0].pointsToConnect[0].y-18.8)<1e-8);
 assert.throws(()=>relocateSensorConnectionPoints(phase([{x:NaN,y:0}]),g),/invalid/);
});
