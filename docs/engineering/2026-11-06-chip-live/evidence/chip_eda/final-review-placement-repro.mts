// Pure review reproduction using captured actual footprint envelopes; not native routing.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { planGraph } from '../../../../../src/blocks/graph.js';
import { placePlanSections } from '../../../../../eda/blocks/auto-placement.js';
import { evaluateRequirements } from '../../../../../src/blocks/verify.js';
const f=JSON.parse(readFileSync(new URL('./auto-placement-fixture.json',import.meta.url),'utf8'));
delete f.plan.board;
for(const b of f.plan.blocks)delete b.at;
f.plan.requirements=[{id:'size',plain:'Fits20by20mm',metric:'board_size_mm',op:'within',value:[20,20],source:'maker'}];
const graph=planGraph(f.plan,f.blocks),envelopes=new Map(graph.parts.map(p=>[p.part,f.envelopes[p.ref]]));
assert.throws(()=>placePlanSections(f.plan,graph,new Map(),{envelopes}),/confirmed size limits/);
f.plan.requirements[0].value=[52,60];
const r=placePlanSections(f.plan,graph,new Map(),{envelopes});
const verification=evaluateRequirements(f.plan.requirements,{interfaces:[],signals:{},netVolts:{},boardMm:[r.plan.board!.widthMm,r.plan.board!.heightMm]});
assert.equal(verification.ok,true);
assert.equal(verification.results![0]!.status,'pass');
assert.deepEqual(f.plan.requirements,r.plan.requirements);
console.log(JSON.stringify({tooSmallWithin:'rejected before routing',fittingWithin:r.plan.board,verification},null,2));
