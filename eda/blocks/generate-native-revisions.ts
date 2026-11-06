/** Audited native import corrections; never replace already published revisions. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getBlock,materializeDraft} from '../../src/blocks/library.js';
import type {BlockDef,BlockDraft} from '../../src/blocks/contract.js';
export function nativeRevision(base:BlockDef):BlockDef {
 const {contentHash:_hash,status:_status,provenance,...fields}=structuredClone(base);
 const d:BlockDraft={...fields,version:2,provenance:{author:provenance.author,...provenance.authorId?{authorId:provenance.authorId}:{}}};
 if(base.id==='rp2040-minimal'&&base.version===1){
  const x=d.parts.find(p=>p.lcsc==='C20625731'&&p.mpn==='ABM8-272-T3');if(!x)throw Error('Expected actual crystal');x.crystal={loadCapacitancePf:10};
 }else if(base.id==='dc-motor-drv8833'&&base.version===1){
  const u=d.parts.find(p=>p.lcsc==='C50506'&&p.mpn==='DRV8833PWPR');if(!u)throw Error('Expected actual driver');
  u.omitImportedVias=true;u.correction={url:'https://www.ti.com/lit/ds/symlink/drv8833.pdf',pages:'14–16',note:'Retain all17 physical pin/PowerPAD lands. Omit four optional importer routing vias whose drilled holes overlap the exposed SMT land and fail native placement. No replacement thermal-via, filled/capped process or thermal qualification is asserted; later native routing/copper/thermal review must qualify the actual board.'};
 }else throw Error('No audited native revision recipe');
 return materializeDraft(d);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
const path='src/blocks/data/seed.json',defs:BlockDef[]=JSON.parse(readFileSync(path,'utf8'));
for(const id of ['rp2040-minimal','dc-motor-drv8833']){
 const b=nativeRevision(getBlock(id,1)!);const old=defs.find(x=>x.id===id&&x.version===2);if(old&&old.contentHash!==b.contentHash)throw Error('Immutable revision conflict');if(!old)defs.push(b);console.log(`${b.id}@${b.version} ${b.contentHash}`);
}
writeFileSync(path,JSON.stringify(defs,null,2)+'\n');

}
