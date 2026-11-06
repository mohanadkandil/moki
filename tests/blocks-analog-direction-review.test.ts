/** Independent review regression: actual immutable S3 facts plus SYNTHETIC loads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPlan, pinMap } from '../src/blocks/erc.js';
import { contentHash } from '../src/blocks/library.js';
import type { BlockDef, BlockDraft, BoardPlan, ElectricalRole } from '../src/blocks/contract.js';
const read=<T>(file:string):T=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
function setup(role:ElectricalRole,kind:'analog'|'gpio',alias=false) {
  const blocks=read<BlockDef[]>('../src/blocks/data/seed.json'),plan=read<BoardPlan>('../src/blocks/data/spike-plan.json');
  const mcu=plan.blocks.find(b=>b.block==='esp32-s3-core')!;mcu.version=2;
  const load:BlockDraft={schema:'moki.block/1',id:'synthetic-direction-load',version:1,title:'SYNTHETIC analog/digital endpoint',summary:'Review capability fixture, not a real device or LCSC part',class:'synthetic',provenance:{author:'agent',authorId:'SYNTHETIC-REVIEW'},
    parts:[{ref:'J1',mpn:'SYNTHETIC:LOAD',lcsc:'SYNTHETIC:LOAD',catalogReceipt:`sha256:${'a'.repeat(64)}`,datasheet:{url:'https://example.invalid/SYNTHETIC',pages:'1'},pinout:'verified',pins:{SIGNAL:{pad:'1',role,required:true,volts:{min:0,max:3.6}}},at:{x:0,y:0}}],nets:[{name:'SIGNAL',pins:['J1.SIGNAL']}],ports:[{id:'SIGNAL',label:'Explicit endpoint requirement',kind,terminal:'net:SIGNAL',volts:{min:0,max:3.6}}],params:[],power:{sources:[],sinks:[]},constraints:[]};
  const add=(draft:BlockDraft,inst:string)=>{blocks.push({...draft,contentHash:contentHash(draft),status:'unreviewed',provenance:{...draft.provenance,reviews:[]}});plan.blocks.push({inst,block:draft.id,version:1,params:{}});plan.sections?.push({id:inst,title:draft.title,purpose:'Independent direction review fixture',insts:[inst],notes:['SYNTHETIC; no hardware claim']});};
  add(load,'reviewload');
  if(alias){const bridge=structuredClone(load);bridge.id='synthetic-direction-alias';bridge.title='SYNTHETIC passive alias';bridge.parts[0]!.pins.SIGNAL!.role='passive';bridge.ports=[{id:'A',label:'Alias A',kind:'gpio',terminal:'net:SIGNAL'},{id:'B',label:'Alias B',kind:'gpio',terminal:'net:SIGNAL'}];add(bridge,'reviewalias');plan.links.push({from:`${mcu.inst}.IO4`,to:'reviewalias.A'},{from:'reviewalias.B',to:'reviewload.SIGNAL'});}
  else plan.links.push({from:`${mcu.inst}.IO4`,to:'reviewload.SIGNAL'});
  return {blocks,plan,mcu:blocks.find(b=>b.id===mcu.block&&b.version===2)!};
}
const errors=(s:ReturnType<typeof setup>)=>checkPlan(s.plan,s.blocks).flatMap(g=>g.issues.filter(i=>i.severity==='error'));
test('actual S3 ADC pad reads an explicit analog source',()=>{const s=setup('output','analog');assert.ok(s.mcu.mcu!.pins.find(p=>p.gpio===4)!.caps.includes('adc'));assert.deepEqual(errors(s),[]);assert.equal(pinMap(s.plan,s.blocks).pins.PIN_REVIEWLOAD_SIGNAL!.gpio,4);});
test('actual S3 ADC pad remains usable as a digital output without a DAC',()=>{const s=setup('input','gpio');assert.ok(!s.mcu.mcu!.pins.find(p=>p.gpio===4)!.caps.includes('dac'));assert.deepEqual(errors(s),[]);assert.equal(pinMap(s.plan,s.blocks).pins.PIN_REVIEWLOAD_SIGNAL!.gpio,4);});
test('actual S3 ADC capability cannot drive an explicit analog-input consumer',()=>{for(const alias of [false,true]){const s=setup('input','analog',alias);assert.ok(errors(s).some(e=>e.rule==='mcu-analog-direction'),JSON.stringify(errors(s)));assert.throws(()=>pinMap(s.plan,s.blocks));}});
test('bidirectional analog endpoint requires both ADC and DAC',()=>{const s=setup('bidirectional','analog');assert.ok(errors(s).some(e=>e.rule==='mcu-analog-direction'),JSON.stringify(errors(s)));});
