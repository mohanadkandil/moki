import test from 'node:test';
import assert from 'node:assert/strict';
import {getBlock,materializeDraft} from '../src/blocks/library.js';
import {nativeRevision} from '../eda/blocks/generate-native-revisions.js';
import type {BlockDraft} from '../src/blocks/contract.js';
const draft=(b:any):BlockDraft=>{const{contentHash,status,provenance,...fields}=structuredClone(b);return {...fields,provenance:{author:provenance.author,authorId:provenance.authorId}};};
test('native-corrected revisions retain immutable old records and electrical nets',()=>{
 for(const id of ['rp2040-minimal','dc-motor-drv8833']){
 const old=getBlock(id,1)!,b=getBlock(id,2)!;assert.equal(b.contentHash,nativeRevision(old).contentHash);assert.notEqual(old.contentHash,b.contentHash);assert.deepEqual(old.nets,b.nets);assert.deepEqual(old.ports,b.ports);assert.equal(b.status,'unreviewed');
 for(const part of old.parts){const now=b.parts.find(p=>p.ref===part.ref)!;assert.deepEqual(now.pins,part.pins);assert.deepEqual(now.at,part.at);assert.equal(now.catalogReceipt,part.catalogReceipt);}
 }
 assert.equal(getBlock('rp2040-minimal',1)!.parts.find(p=>p.ref==='X1')!.crystal,undefined);
 assert.equal(getBlock('rp2040-minimal',2)!.parts.find(p=>p.ref==='X1')!.crystal!.loadCapacitancePf,10);
 const motor=getBlock('dc-motor-drv8833',2)!;assert.equal(motor.parts[0]!.omitImportedVias,true);assert.ok(motor.parts[0]!.correction);
 const bad=draft(motor);delete bad.parts[0]!.correction;assert.throws(()=>materializeDraft(bad),/audited correction/);
 const badCrystal=draft(getBlock('rp2040-minimal',2)!);badCrystal.parts.find(p=>p.ref==='X1')!.crystal!.loadCapacitancePf=0;assert.throws(()=>materializeDraft(badCrystal),/positive manufacturer/);
});
