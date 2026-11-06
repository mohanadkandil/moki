import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placePlanSections } from '../eda/blocks/auto-placement.js';
import { legalizePlanGraph } from '../eda/blocks/legalize.js';
import { planGraph } from '../src/blocks/graph.js';
import type { BoardPlan, BlockDef } from '../src/blocks/contract.js';
const path=new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/auto-placement-fixture.json',import.meta.url);
function fixture(board?:{widthMm:number;heightMm:number;cornerRadiusMm?:number}){
 const f=JSON.parse(readFileSync(path,'utf8')) as {plan:BoardPlan;blocks:BlockDef[];envelopes:Record<string,any>};
 for(const b of f.plan.blocks)delete b.at;
 if(board)f.plan.board=board;else delete f.plan.board;
 const graph=planGraph(f.plan,f.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,f.envelopes[p.ref]]));
 return {...f,graph,envelopes};
}
function sameElectrical(a:BoardPlan,b:BoardPlan){
 const strip=(p:BoardPlan)=>{const q=structuredClone(p);delete q.board;for(const i of q.blocks)delete i.at;return q;};
 assert.deepEqual(strip(a),strip(b));
}
function noReservedOverlaps(placements:ReturnType<typeof placePlanSections>['placements']){
 for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
  if(placements[i]!.explicit&&placements[j]!.explicit)continue;
  const a=placements[i]!.reserved,b=placements[j]!.reserved;
  assert.ok(a.maxX+1.5<=b.minX+1e-7||b.maxX+1.5<=a.minX+1e-7||a.maxY+1.5<=b.minY+1e-7||b.maxY+1.5<=a.minY+1e-7,`${placements[i]!.inst} overlaps ${placements[j]!.inst}`);
 }
}
test('actual six-block30-part device packs missing anchors inside explicit70x80 and80x90 before legalization',()=>{
 for(const board of [{widthMm:70,heightMm:80,cornerRadiusMm:0},{widthMm:80,heightMm:90,cornerRadiusMm:3}]){
  const f=fixture(board),before=structuredClone(f.plan),graphBefore=JSON.stringify(f.graph);
  const r=placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes});
  assert.equal(r.boardAuto,false);assert.deepEqual(r.plan.board,board);assert.equal(r.placements.length,6);assert.equal(r.graph.parts.length,30);
  assert.deepEqual(f.plan,before);assert.equal(JSON.stringify(f.graph),graphBefore);sameElectrical(r.plan,before);noReservedOverlaps(r.placements);
  assert.deepEqual(r.graph.nets,f.graph.nets);assert.deepEqual(r.graph.parts.map(p=>p.ref),f.graph.parts.map(p=>p.ref));
  for(let i=0;i<f.graph.parts.length;i++)assert.equal(r.graph.parts[i]!.part,f.graph.parts[i]!.part);
  const antenna=r.placements.find(p=>p.inst==='mcu')!;assert.equal(antenna.edge,'top');assert.equal(antenna.at.rotation,0);assert.ok(Math.abs(antenna.reserved.maxY-board.heightMm/2)<1e-7);
  const legalized=legalizePlanGraph(r.plan,r.graph,new Map(),{envelopes:f.envelopes});assert.equal(legalized.graph.parts.length,30);
 }
});
test('absent board produces a compact rounded board with unchanged input and deterministic anchors',()=>{
 const f=fixture(),before=structuredClone(f.plan),r=placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes});
 assert.equal(r.boardAuto,true);assert.ok(r.plan.board!.widthMm*r.plan.board!.heightMm<70*80);assert.equal(r.plan.board!.cornerRadiusMm,2);
 assert.deepEqual(f.plan,before);sameElectrical(r.plan,before);noReservedOverlaps(r.placements);
 assert.deepEqual(placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes}),r);
 assert.doesNotThrow(()=>legalizePlanGraph(r.plan,r.graph,new Map(),{envelopes:f.envelopes}));
});
test('explicit maker anchors and board radius remain exact while only missing anchors are packed',()=>{
 const f=fixture({widthMm:70,heightMm:80,cornerRadiusMm:0});
 f.plan.blocks[0]!.at={x:-2,y:20.75};f.plan.blocks[1]!.at={x:-12,y:-28.15};
 f.graph=planGraph(f.plan,f.blocks);const before=structuredClone(f.plan);
 const r=placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes});
 assert.deepEqual(r.plan.blocks[0]!.at,before.blocks[0]!.at);assert.deepEqual(r.plan.blocks[1]!.at,before.blocks[1]!.at);assert.deepEqual(r.plan.board,before.board);
 assert.ok(r.placements.slice(0,2).every(p=>p.explicit));assert.ok(r.placements.slice(2).every(p=>!p.explicit));sameElectrical(r.plan,before);noReservedOverlaps(r.placements);
});
test('an impossible explicit board reports actual envelope sizes and never silently grows',()=>{
 const f=fixture({widthMm:20,heightMm:20,cornerRadiusMm:0}),before=structuredClone(f.plan);
 assert.throws(()=>placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes}),/20×20mm explicit board.*mcu [\d.]+×[\d.]+mm/);
 assert.deepEqual(f.plan,before);
});
test('confirmed board size limits constrain automatic packing without modifying requirements',()=>{
 const f=fixture();f.plan.requirements=[{id:'size',plain:'Fits52by60mm',metric:'board_size_mm',op:'<=',value:[52,60],source:'maker'}];
 const r=placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes});assert.ok(r.plan.board!.widthMm<=52&&r.plan.board!.heightMm<=60);assert.deepEqual(r.plan.requirements,f.plan.requirements);
 f.plan.requirements[0]!.op='within';f.plan.requirements[0]!.value=[20,20];const before=structuredClone(f.plan);
 assert.throws(()=>placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes}),/confirmed size limits/);assert.deepEqual(f.plan,before);
});
test('declared empty antenna space is reserved independently of physical footprints',()=>{
 const f=fixture({widthMm:70,heightMm:80,cornerRadiusMm:0});
 const mcu=f.blocks.find(b=>b.id==='esp32-s3-core')!,k=mcu.constraints.find(c=>c.kind==='keepout')!;if(k.kind!=='keepout')throw Error('expectedactualkeepout');
 k.width=100;f.graph=planGraph(f.plan,f.blocks);
 assert.throws(()=>placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes}),/reserved section envelopes.*mcu 100/);
});

test('actual live55x40RP plan rotates the MCU section and reduces only optional reserve, preserving board and electrical data',()=>{
 const path=new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/packing-fixture.json',import.meta.url);
 const f=JSON.parse(readFileSync(path,'utf8')) as {plan:BoardPlan;blocks:BlockDef[];envelopes:Record<string,any>};
 const before=structuredClone(f.plan),graph=planGraph(f.plan,f.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,f.envelopes[p.ref]]));
 const result=placePlanSections(f.plan,graph,new Map(),{envelopes});
 assert.deepEqual(result.plan.board,{widthMm:55,heightMm:40});assert.equal(result.boardAuto,false);
 assert.equal(result.placements.find(p=>p.inst==='core')!.at.rotation,90);assert.equal(result.reservePaddingMm,0);
 noReservedOverlaps(result.placements);sameElectrical(result.plan,before);assert.deepEqual(f.plan,before);
 const legal=legalizePlanGraph(result.plan,result.graph,new Map(),{envelopes});
 for(const p of legal.graph.parts){
  const b=envelopes.get(p.part)!,angle=(p.at.rotation??0)*Math.PI/180;
  for(const x of [b.minX,b.maxX])for(const y of [b.minY,b.maxY]){
   assert.ok(Math.abs(p.at.x+x*Math.cos(angle)-y*Math.sin(angle))<=27.5-.15+1e-7,p.ref+' actual footprint x');
   assert.ok(Math.abs(p.at.y+x*Math.sin(angle)+y*Math.cos(angle))<=20-.15+1e-7,p.ref+' actual footprint y');
  }
 }
 assert.deepEqual(legal.graph.nets,graph.nets);
 f.plan.blocks.find(b=>b.inst==='core')!.at={x:0,y:0,rotation:0};
 const fixed=placePlanSections(f.plan,planGraph(f.plan,f.blocks),new Map(),{envelopes});
 assert.deepEqual(fixed.plan.blocks.find(b=>b.inst==='core')!.at,{x:0,y:0,rotation:0});
 assert.deepEqual(fixed.plan.board,{widthMm:55,heightMm:40});
});
test('unanchored MCU long axis follows wider65x55 maker board on two and four layers',()=>{
 const path=new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/packing-fixture.json',import.meta.url);
 for(const layers of [2,4] as const){
  const f=JSON.parse(readFileSync(path,'utf8')) as {plan:BoardPlan;blocks:BlockDef[];envelopes:Record<string,any>};
  f.plan.board={widthMm:65,heightMm:55};f.plan.layers=layers;
  const graph=planGraph(f.plan,f.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,f.envelopes[p.ref]])),before=structuredClone(f.plan);
  const result=placePlanSections(f.plan,graph,new Map(),{envelopes});
  assert.equal(result.placements.find(p=>p.inst==='core')!.at.rotation,90);
  assert.deepEqual(result.plan.board,before.board);sameElectrical(result.plan,before);noReservedOverlaps(result.placements);
  assert.doesNotThrow(()=>legalizePlanGraph(result.plan,result.graph,new Map(),{envelopes}));
  f.plan.blocks.find(b=>b.inst==='core')!.at={x:0,y:0,rotation:0};
  const fixed=placePlanSections(f.plan,planGraph(f.plan,f.blocks),new Map(),{envelopes});
  assert.deepEqual(fixed.plan.blocks.find(b=>b.inst==='core')!.at,{x:0,y:0,rotation:0});
 }
});
test('invalid actual geometry and off-board explicit anchors reject instead of guessing footprints or moving the anchor',()=>{
 const missing=fixture({widthMm:70,heightMm:80});missing.envelopes.delete(missing.graph.parts[0]!.part);
 assert.throws(()=>placePlanSections(missing.plan,missing.graph,new Map(),{envelopes:missing.envelopes}),/missing actual footprint/);
 const invalid=fixture({widthMm:70,heightMm:80});invalid.envelopes.set(invalid.graph.parts[0]!.part,{minX:1,maxX:-1,minY:-1,maxY:1});
 assert.throws(()=>placePlanSections(invalid.plan,invalid.graph,new Map(),{envelopes:invalid.envelopes}),/invalid footprint envelope/);
 const outside=fixture({widthMm:70,heightMm:80});outside.plan.blocks[0]!.at={x:100,y:0};outside.graph=planGraph(outside.plan,outside.blocks);
 assert.throws(()=>placePlanSections(outside.plan,outside.graph,new Map(),{envelopes:outside.envelopes}),/Explicit anchors.*preserved/);assert.equal(outside.plan.blocks[0]!.at!.x,100);
});

test('actual RP signal ranking faces the65x55 driver right at90degrees and lowers nonpower part-centre HPWL without changing source or board',()=>{
 const path=new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/packing-fixture.json',import.meta.url);
 for(const layers of[2,4]as const){
  const f=JSON.parse(readFileSync(path,'utf8'))as{plan:BoardPlan;blocks:BlockDef[];envelopes:Record<string,any>};f.plan.board={widthMm:65,heightMm:55};f.plan.layers=layers;
  const before=structuredClone(f.plan),graph=planGraph(f.plan,f.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,f.envelopes[p.ref]])),result=placePlanSections(f.plan,graph,new Map(),{envelopes});
  assert.equal(result.packingStrategy,'signal-hpwl');
  assert.deepEqual(result.placements.find(p=>p.inst==='core')!.at,{x:-2.25,y:6,rotation:90});
  assert.deepEqual(result.placements.find(p=>p.inst==='driver')!.at,{x:20,y:6,rotation:90});
  const parts=new Map(result.graph.parts.map(p=>[p.ref,p]));
  const nets=result.graph.nets.filter(n=>new Set(n.pins.map(p=>parts.get(p.ref)!.inst)).size>1&&!n.pins.some(p=>['power-in','power-out','ground'].includes(parts.get(p.ref)!.part.pins[p.logical]!.role)));
  const hpwl=nets.reduce((sum,n)=>{const ps=n.pins.map(p=>parts.get(p.ref)!.at);return sum+Math.max(...ps.map(p=>p.x))-Math.min(...ps.map(p=>p.x))+Math.max(...ps.map(p=>p.y))-Math.min(...ps.map(p=>p.y));},0);
  assert.equal(hpwl,70.75);assert.ok(hpwl<114.75,'Retained original geometry/legacy pack signal HPWL');
  assert.deepEqual(f.plan,before);sameElectrical(result.plan,before);assert.deepEqual(result.plan.board,before.board);noReservedOverlaps(result.placements);
  assert.deepEqual(result.graph.nets,graph.nets);assert.doesNotThrow(()=>legalizePlanGraph(result.plan,result.graph,new Map(),{envelopes}));
 }
});

test('bounded legacy fallback retains actual44x56 feasibility when signal-ranked greedy packing blocks a later section',()=>{
 const f=fixture({widthMm:44,heightMm:56}),before=structuredClone(f.plan);
 const result=placePlanSections(f.plan,f.graph,new Map(),{envelopes:f.envelopes});
 assert.equal(result.packingStrategy,'legacy');assert.equal(result.reservePaddingMm,0);
 assert.deepEqual(result.plan.board,{widthMm:44,heightMm:56});assert.equal(result.placements.length,6);
 noReservedOverlaps(result.placements);assert.deepEqual(f.plan,before);sameElectrical(result.plan,before);
 assert.deepEqual(result.graph.nets,f.graph.nets);assert.doesNotThrow(()=>legalizePlanGraph(result.plan,result.graph,new Map(),{envelopes:f.envelopes}));
});

test('explicit legacy ranking preserves declaration orientation first, uses cardinal fallback only when needed and keeps maker anchors',()=>{
 const path=new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/packing-fixture.json',import.meta.url);
 for(const width of[65,55]){const f=JSON.parse(readFileSync(path,'utf8'))as{plan:BoardPlan;blocks:BlockDef[];envelopes:Record<string,any>};f.plan.board={widthMm:width,heightMm:width===65?55:40};const graph=planGraph(f.plan,f.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,f.envelopes[p.ref]])),before=structuredClone(f.plan);
  const r=placePlanSections(f.plan,graph,new Map(),{envelopes,ranking:'legacy'});assert.equal(r.packingStrategy,'legacy');assert.equal(r.placements.find(p=>p.inst==='core')!.at.rotation,width===65?0:90);assert.deepEqual(f.plan,before);assert.deepEqual(r.plan.board,before.board);sameElectrical(r.plan,before);noReservedOverlaps(r.placements);assert.doesNotThrow(()=>legalizePlanGraph(r.plan,r.graph,new Map(),{envelopes}));
  const automatic=placePlanSections(f.plan,graph,new Map(),{envelopes});assert.deepEqual(placePlanSections(f.plan,graph,new Map(),{envelopes,ranking:'signal-hpwl'}),automatic);
  f.plan.blocks.find(b=>b.inst==='core')!.at={x:0,y:0,rotation:90};const fixed=placePlanSections(f.plan,planGraph(f.plan,f.blocks),new Map(),{envelopes,ranking:'legacy'});assert.deepEqual(fixed.plan.blocks.find(b=>b.inst==='core')!.at,{x:0,y:0,rotation:90});
 }
 const invalid=fixture({widthMm:70,heightMm:80});assert.throws(()=>placePlanSections(invalid.plan,invalid.graph,new Map(),{envelopes:invalid.envelopes,ranking:'unknown' as any}),/ranking/);
});
