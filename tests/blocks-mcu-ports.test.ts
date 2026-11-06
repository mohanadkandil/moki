import test from 'node:test';
import assert from 'node:assert/strict';
import {getBlock,listBlocks,checkBlockDraft} from '../src/blocks/library.js';
import type {BlockDraft} from '../src/blocks/contract.js';
const draft = (b: any): BlockDraft => {const {contentHash,status,provenance,...fields}=structuredClone(b);return {...fields,provenance:{author:provenance.author,authorId:provenance.authorId}};};
test('immutable S3 revision2 exposes free application pins without leasing USB, straps or I2C',()=>{
 const old=getBlock('esp32-s3-core',1)!, b=getBlock('esp32-s3-core',2)!;
 assert.equal(old.ports.length,6); assert.equal(listBlocks().find(x=>x.id===b.id)?.version,2);
 assert.notEqual(old.contentHash,b.contentHash); assert.equal(b.status,'unreviewed');
 assert.deepEqual(b.parts,old.parts); assert.deepEqual(b.nets,old.nets);
 for(const gpio of [1,2,4,5,6,7,10,11,12,13,14,15,16,17,18,21,38,39,40,41,42,47,48]){
  const p=b.ports.find(x=>x.id===`IO${gpio}`)!; assert.ok(p);
  const facts=b.mcu!.pins.find(x=>x.gpio===gpio)!;
  assert.equal(p.terminal,facts.id);assert.equal(p.kind,facts.caps.includes('adc')?'analog':'gpio');
  assert.ok(facts.caps.includes('pwm'));assert.ok(!facts.reserved&&!facts.fixedFunction);
 }
 for(const gpio of [0,3,8,9,19,20,26,27,33,34,35,36,37,45,46])assert.ok(!b.ports.find(x=>x.id===`IO${gpio}`));
 assert.ok(checkBlockDraft(draft(b)).every(g=>g.ok));
});
test('physical bidirectional ADC GPIO remains digital capable and rejects a fabricated ADC claim',()=>{
 const b=draft(getBlock('esp32-s3-core',2)!);
 const io=b.ports.find(p=>p.id==='IO4')!; const facts=b.mcu!.pins.find(p=>p.id===io.terminal)!;
 assert.equal(b.parts[0]!.pins['4']!.role,'bidirectional');
 facts.caps=facts.caps.filter(c=>c!=='adc');
 assert.ok(checkBlockDraft(b).some(g=>g.issues.some(i=>i.rule==='mcu-analog')));
});
