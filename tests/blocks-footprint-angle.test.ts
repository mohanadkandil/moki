import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {footprintEnvelope} from '../eda/blocks/legalize.js';
import type {BlockPart} from '../src/blocks/contract.js';
const capture=JSON.parse(readFileSync(new URL('./agent-fixtures/live-rp2040-angle-footprint.json',import.meta.url),'utf8'));
const actualPart=capture.part as BlockPart;
const measure=(footprint:any)=>footprintEnvelope(actualPart,{component:()=>({props:{footprint}}),pins:new Map(Object.entries(capture.pins) as [string,string][])});
const hole=()=>structuredClone(capture.footprint.props.children.find((n:any)=>n.type==='platedhole'));
const single=(node:any)=>({type:'footprint',props:{children:[node]}});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);

test('live RP2040 SW3 uses the real TL6340AF160Q imported 180deg footprint',()=>{
 assert.equal(capture.sourceJobId,'c78fa2da-cfdc-487b-9b2f-9bf2b5044a6c');assert.equal(capture.ref,'SW3');assert.equal(actualPart.lcsc,'C4944967');
 assert.equal(actualPart.catalogReceipt,'sha256:5cac0bf1c7ae18b6773c71e6fc1d2d0b52c276a0a869fce015d2e9c472db8b77');
 const holes=capture.footprint.props.children.filter((n:any)=>n.type==='platedhole');assert.equal(holes.length,2);assert.ok(holes.every((n:any)=>n.props.pcbRotation==='180deg'));
 const before=JSON.stringify(capture),envelope=measure(capture.footprint);
 near(envelope.minX,-2.6749887999999373);near(envelope.maxX,2.6749887999999373);near(envelope.minY,-2.939999650000118);near(envelope.maxY,1.4374754499999653);
 assert.deepEqual(envelope.layers,['all','top']);assert.equal(JSON.stringify(capture),before);
 const numeric=structuredClone(capture.footprint);for(const node of numeric.props.children)if(node.props?.pcbRotation==='180deg')node.props.pcbRotation=180;
 assert.deepEqual(measure(numeric),envelope);
});

test('every imported rotation spelling accepts only finite numbers or degree-unit strings',()=>{
 for(const field of ['pcbRotation','ccwRotation','ccw_rotation']){
  const n=hole();delete n.props.pcbRotation;n.props[field]='90deg';
  const result=measure(single(n));near(result.maxX-result.minX,1.35001);near(result.maxY-result.minY,1.1999976);
  n.props[field]=90;assert.deepEqual(measure(single(n)),result);
  for(const value of ['-90deg','+90deg','.5deg','1e2deg',0,-90,180]){n.props[field]=value;assert.doesNotThrow(()=>measure(single(n)));}
  for(const value of ['180','180mm','180mil','3.14rad','180deg extra','NaNdeg','Infinitydeg','1e999deg','',null,NaN,Infinity]){n.props[field]=value;assert.throws(()=>measure(single(n)),/unsupported footprint angle/);}
 }
});

test('nested footprint rotations compose in degrees while dimensions keep their strict length parser',()=>{
 const n=hole();n.props.pcbRotation='180deg';
 const nested={type:'footprint',props:{pcbX:'2mm',pcbY:'3mm',pcbRotation:'90deg',children:[n]}};
 const result=measure(single(nested));near((result.minX+result.maxX)/2,2+1.13747545);near((result.minY+result.maxY)/2,3+1.82499);
 near(result.maxX-result.minX,1.35001);near(result.maxY-result.minY,1.1999976);
 for(const field of ['outerWidth','outerHeight','pcbX','pcbY']){const bad=hole();bad.props[field]='180deg';assert.throws(()=>measure(single(bad)),/unsupported footprint dimension/);}
});
