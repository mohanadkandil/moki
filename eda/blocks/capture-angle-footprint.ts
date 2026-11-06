// Capture the actual receipt-bound importer output behind the owner's live failure.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolvePlanBlocks,catalogPart} from '../../src/blocks/library';
import {planGraph} from '../../src/blocks/graph';
import {ensurePart} from './imported';
const base='var/board-jobs-app/c78fa2da-cfdc-487b-9b2f-9bf2b5044a6c';
const plan=JSON.parse(await readFile(base+'/plan.json','utf8'));
const graph=planGraph(plan,resolvePlanBlocks(plan));
const placed=graph.parts.find(p=>p.part.lcsc==='C4944967')!;
const imported=await ensurePart(placed.part,catalogPart(placed.part.lcsc,placed.part.catalogReceipt));
const footprint=imported.component({name:placed.ref,pcbX:0,pcbY:0,pcbRotation:0}).props.footprint;
const plain=(x:any):any=>Array.isArray(x)?x.map(plain):x&&typeof x==='object'?x.props&&x.type?{type:x.type,props:plain(x.props)}:Object.fromEntries(Object.entries(x).filter(([k])=>!['_owner','_store','ref','key','$$typeof'].includes(k)).map(([k,v])=>[k,plain(v)])):x;
const capture={sourceJobId:'c78fa2da-cfdc-487b-9b2f-9bf2b5044a6c',ref:placed.ref,inst:placed.inst,localRef:placed.localRef,part:placed.part,catalog:catalogPart(placed.part.lcsc,placed.part.catalogReceipt),pins:Object.fromEntries(imported.pins),footprint:plain(footprint)};
await writeFile('tests/agent-fixtures/live-rp2040-angle-footprint.json',JSON.stringify(capture,null,2)+'\n');
console.log(JSON.stringify({ref:placed.ref,inst:placed.inst,lcsc:placed.part.lcsc,mpn:placed.part.mpn,receipt:placed.part.catalogReceipt,fixtureSha256:createHash('sha256').update(JSON.stringify(capture)).digest('hex')}));
