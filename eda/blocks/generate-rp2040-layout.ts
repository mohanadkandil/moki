/** Revised placement hints derived from native RP2040 XIN/XOUT pad positions. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getBlock,materializeDraft} from '../../src/blocks/library.js';
import type {BlockDef,BlockDraft} from '../../src/blocks/contract.js';
export function withRpClockPlacement(base:BlockDef):BlockDef {
 if(base.id!=='rp2040-minimal'||base.version!==2)throw Error('Expected immutable RP2040 revision2');
 const {contentHash:_hash,status:_status,provenance,...fields}=structuredClone(base);
 const d:BlockDraft={...fields,version:3,provenance:{author:provenance.author,...provenance.authorId?{authorId:provenance.authorId}:{}}};
 const poses={X1:{x:-1.5,y:-8},R1:{x:-.3,y:-5.5,rotation:270},C15:{x:-5,y:-8.85,rotation:180},C16:{x:3,y:-7.15,rotation:0},C3:{x:2,y:-5,rotation:0},C10:{x:4.5,y:-4.5,rotation:0}};
 for(const [ref,at]of Object.entries(poses)){const p=d.parts.find(p=>p.ref===ref);if(!p)throw Error('Missing clock-adjacent part '+ref);p.at=at;}
 return materializeDraft(d);
}
export function withRpClockCorridor(base:BlockDef):BlockDef {
 if(base.id!=='rp2040-minimal'||base.version!==3)throw Error('Expected immutable RP2040 revision3');
 const {contentHash:_hash,status:_status,provenance,...fields}=structuredClone(base);
 const d:BlockDraft={...fields,version:4,provenance:{author:provenance.author,...provenance.authorId?{authorId:provenance.authorId}:{}}};
 d.parts.find(p=>p.ref==='R1')!.at={x:1,y:-5.5,rotation:270};
 d.parts.find(p=>p.ref==='C3')!.at={x:5.5,y:0,rotation:90};
 return materializeDraft(d);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const path='src/blocks/data/seed.json',defs:BlockDef[]=JSON.parse(readFileSync(path,'utf8'));
 for(const b of [withRpClockPlacement(getBlock('rp2040-minimal',2)!),withRpClockCorridor(getBlock('rp2040-minimal',3)!)] ){
 const old=defs.find(x=>x.id===b.id&&x.version===b.version);if(old&&old.contentHash!==b.contentHash)throw Error('Immutable revision conflict');if(!old)defs.push(b);writeFileSync(path,JSON.stringify(defs,null,2)+'\n');console.log(`${b.id}@${b.version} ${b.contentHash}`);
 }
}
