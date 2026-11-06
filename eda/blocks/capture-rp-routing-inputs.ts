import {readFile,writeFile} from 'node:fs/promises';
import {resolvePlanBlocks,catalogPart} from '../../src/blocks/library';
import {planGraph} from '../../src/blocks/graph';
import {ensurePart} from './imported';
import {footprintEnvelope,legalizePlanGraph} from './legalize';
import {placePlanSections} from './auto-placement';
const root='var/board-jobs-app/1f1e315c-44e7-4fc4-af58-8dce62a7adad',out='docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust';
const plan=JSON.parse(await readFile(root+'/plan.json','utf8')),blocks=resolvePlanBlocks(plan),graph=planGraph(plan,blocks),imports=new Map(),boxes:any={};
for(const p of graph.parts){if(!imports.has(p.part))imports.set(p.part,await ensurePart(p.part,catalogPart(p.part.lcsc,p.part.catalogReceipt)));boxes[p.ref]=footprintEnvelope(p.part,imports.get(p.part));}
await writeFile(out+'/packing-fixture.json',JSON.stringify({sourceJobId:root.split('/').at(-1),plan,blocks,envelopes:boxes},null,2)+'\n');
try{const placed=placePlanSections(plan,graph,imports),legal=legalizePlanGraph(placed.plan,placed.graph,imports);await writeFile(out+'/packing-check.json',JSON.stringify({board:placed.plan.board,reservePaddingMm:placed.reservePaddingMm,placements:placed.placements,changes:legal.changes,parts:legal.graph.parts.map(p=>({ref:p.ref,inst:p.inst,localRef:p.localRef,at:p.at}))},null,2)+'\n');console.log(JSON.stringify({board:placed.plan.board,reservePaddingMm:placed.reservePaddingMm,placements:placed.placements.map(p=>({inst:p.inst,at:p.at})),changes:legal.changes}));}catch(error){console.log(String(error));process.exitCode=2;}
