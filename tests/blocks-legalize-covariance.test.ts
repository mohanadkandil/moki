import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legalizePlanGraph} from '../eda/blocks/legalize.js';
import {planGraph} from '../src/blocks/graph.js';
const root=new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/',import.meta.url);
const read=(name:string)=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
const packing=read('packing-fixture.json'),captures=read('legalize-covariance-fixture.json');
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const norm=(a:number)=>(a%360+360)%360;
function setup(row:any){const plan=structuredClone(row.plan);for(const p of plan.blocks)p.at=structuredClone(row.anchors.find((a:any)=>a.inst===p.inst).at);const graph=planGraph(plan,structuredClone(packing.blocks)),envelopes=new Map(graph.parts.map(p=>[p.part,packing.envelopes[p.ref]]));return{plan,graph,envelopes};}
function local(p:any,anchor:any){const a=-(anchor.rotation??0)*Math.PI/180,x=p.at.x-anchor.x,y=p.at.y-anchor.y;return{x:x*Math.cos(a)-y*Math.sin(a),y:x*Math.sin(a)+y*Math.cos(a),rotation:norm((p.at.rotation??0)-(anchor.rotation??0))};}
test('actual13a6 zero-degree result stays exact and f144 rotated44-part result restores passing section-local component geometry',()=>{
 const baseline=captures.rows[0];
 for(const row of captures.rows){const f=setup(row),before=structuredClone({plan:f.plan,graph:f.graph}),r=legalizePlanGraph(f.plan,f.graph,new Map(),{envelopes:f.envelopes});assert.equal(r.graph.parts.length,44);assert.deepEqual({plan:f.plan,graph:f.graph},before);assert.deepEqual(r.graph.nets,f.graph.nets);
  for(const p of r.graph.parts){const expected=baseline.legalized.find((q:any)=>q.ref===p.ref),actualAnchor=row.anchors.find((a:any)=>a.inst===p.inst).at,baseAnchor=baseline.anchors.find((a:any)=>a.inst===p.inst).at,a=local(p,actualAnchor),b=local(expected,baseAnchor);close(a.x,b.x);close(a.y,b.y);close(a.rotation,b.rotation);assert.equal(p.part,f.graph.parts.find(q=>q.ref===p.ref)!.part);}
  for(const inst of f.plan.blocks){const p=r.graph.parts.find(p=>p.inst===inst.inst&&p.localRef===p.block.parts[0]!.ref)!,old=f.graph.parts.find(q=>q.ref===p.ref)!;assert.deepEqual(p.at,old.at);}
 }
});
test('all actual44-part poses commute with whole-plan cardinal rotation while every explicit anchor and board constraint remain fixed',()=>{
 const row=captures.rows[0],base=setup(row),answer=legalizePlanGraph(base.plan,base.graph,new Map(),{envelopes:base.envelopes});
 for(const quarter of[1,2,3]){const f=setup(row),angle=quarter*Math.PI/2;for(const i of f.plan.blocks){const{x,y}=i.at;i.at={x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle),rotation:norm((i.at.rotation??0)+quarter*90)};}if(quarter%2)[f.plan.board.widthMm,f.plan.board.heightMm]=[f.plan.board.heightMm,f.plan.board.widthMm];const graph=planGraph(f.plan,packing.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,packing.envelopes[p.ref]])),before=structuredClone(f.plan),r=legalizePlanGraph(f.plan,graph,new Map(),{envelopes});assert.deepEqual(f.plan,before);
  for(const p of r.graph.parts){const b=answer.graph.parts.find(q=>q.ref===p.ref)!;close(p.at.x,b.at.x*Math.cos(angle)-b.at.y*Math.sin(angle));close(p.at.y,b.at.x*Math.sin(angle)+b.at.y*Math.cos(angle));close(norm(p.at.rotation??0),norm((b.at.rotation??0)+quarter*90));}
 }
});
