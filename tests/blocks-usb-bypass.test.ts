import test from 'node:test';
import assert from 'node:assert/strict';
import {getBlock,materializeDraft} from '../src/blocks/library.js';
import {withUsbBypass} from '../eda/blocks/generate-usb-bypass.js';
import type {BlockDraft} from '../src/blocks/contract.js';
const draft=(b:any):BlockDraft=>{const{contentHash,status,provenance,...fields}=structuredClone(b);return {...fields,provenance:{author:provenance.author,authorId:provenance.authorId}};};
test('USB sink revision2 adds manufacturer100nF VBUS bypass with unchanged external ports',()=>{
 const old=getBlock('usb-c-sink',1)!,b=getBlock('usb-c-sink',2)!;
 assert.equal(b.contentHash,withUsbBypass(old).contentHash);assert.notEqual(old.contentHash,b.contentHash);assert.deepEqual(old.ports,b.ports);assert.equal(old.parts.length+1,b.parts.length);assert.equal(b.status,'unreviewed');
 const cap=b.parts.find(p=>p.ref==='C_BUS')!;assert.equal(cap.value,'100nF');assert.equal(cap.lcsc,'C14663');
 assert.ok(b.nets.find(n=>n.name==='VBUS')!.pins.includes('C_BUS.1'));assert.ok(b.nets.find(n=>n.name==='GND')!.pins.includes('C_BUS.2'));
 for(const mutate of [(d:BlockDraft)=>{d.nets.find(n=>n.name==='VBUS')!.pins=d.nets.find(n=>n.name==='VBUS')!.pins.filter(p=>p!=='C_BUS.1');},(d:BlockDraft)=>{d.parts.find(p=>p.ref==='C_BUS')!.value='10nF';},(d:BlockDraft)=>{d.parts.find(p=>p.ref==='C_BUS')!.at.x=100;}]){const d=draft(b);mutate(d);assert.throws(()=>materializeDraft(d),/decoupling/);}
});
