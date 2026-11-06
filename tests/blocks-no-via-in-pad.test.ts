import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{withSmtViaExclusionColumns}from'../eda/blocks/no-via-in-pad.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/router-input.json',import.meta.url),'utf8'));
test('actual SMT geometry becomes foreign non-pad-layer columns while electrical and original geometry stay immutable',()=>{
 const x=fixture(),before=JSON.stringify(x),r=withSmtViaExclusionColumns(x);assert.equal(JSON.stringify(x),before);assert.ok(r.audit.length>100);assert.equal(r.input.connections,x.connections);assert.equal(r.input.traces,x.traces);
 for(const a of r.audit){const source=x.obstacles.find((o:any)=>o.circuitJsonMetadata?.pcb_smtpad_id===a.padId),p=r.input.obstacles.find((o:any)=>o.obstacleId===a.obstacleId);assert.deepEqual(p.center,source.center);assert.equal(p.width,source.width);assert.equal(p.height,source.height);assert.deepEqual(p.connectedTo,[]);assert.equal(p.componentId,undefined);assert.equal(p.circuitJsonMetadata,undefined);assert.ok(!p.layers.includes(a.sourceLayer));assert.deepEqual(p.layers,['top','inner1','inner2','bottom'].filter(l=>l!==a.sourceLayer));}
});
test('same-net via landing is forbidden on every possible transition, while the SMT wire layer stays usable',()=>{
 for(const count of[2,4]){const x={layerCount:count,obstacles:[{type:'rect',center:{x:1,y:2},width:2,height:1,layers:['top'],connectedTo:['GND'],componentId:'u1',circuitJsonMetadata:{pcb_smtpad_id:'ep'}}]},r=withSmtViaExclusionColumns(x),p=r.input.obstacles[1];const ls=count===4?['top','inner1','inner2','bottom']:['top','bottom'];for(const from of ls)for(const to of ls)if(from!==to)assert.ok(p.layers.includes(from)||p.layers.includes(to));assert.deepEqual(r.input.obstacles[0],x.obstacles[0]);assert.ok(!p.layers.includes('top'));}
});
test('bottom SMT, through-hole exclusion and malformed geometry remain explicit',()=>{
 const r=withSmtViaExclusionColumns({layerCount:2,obstacles:[{type:'rect',center:{x:0,y:0},width:1,height:2,layers:['bottom'],connectedTo:['n'],circuitJsonMetadata:{pcb_smtpad_id:'bottom'}},{type:'rect',center:{x:5,y:5},width:1,height:1,layers:['top','bottom'],connectedTo:['n'],circuitJsonMetadata:{pcb_plated_hole_id:'hole'}}]});assert.deepEqual(r.audit[0].reservedLayers,['top']);assert.equal(r.audit.length,1);
 for(const bad of[NaN,0,-1])assert.throws(()=>withSmtViaExclusionColumns({layerCount:2,obstacles:[{type:'rect',center:{x:0,y:0},width:bad,height:1,layers:['top'],circuitJsonMetadata:{pcb_smtpad_id:'bad'}}]}));
});
