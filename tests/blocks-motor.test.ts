import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createMotorBundle, createMotorDraft, checkMotorReference, MOTOR_DATASHEET, type MotorDraftBundle } from '../eda/blocks/generate-motor.js';
import { catalogPartFromReceipt } from '../src/blocks/catalog.js';
import { checkBlockDraft, checkPlan, pinMap } from '../src/blocks/erc.js';
import { contentHash } from '../src/blocks/library.js';
import type { BlockDef, BlockDraft, BoardPlan, GateResult } from '../src/blocks/contract.js';

const read=<T>(path:string):T=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const retained=read<MotorDraftBundle>('../src/blocks/data/motor-drafts.json');
const draft=()=>createMotorDraft(structuredClone(retained.catalog));
const catalog=()=>new Map(retained.catalog.map(c=>[c.lcsc,structuredClone(c)]));
const errors=(gates:GateResult[])=>gates.flatMap(g=>g.issues.filter(i=>i.severity==='error'));
const materialize=(d:BlockDraft):BlockDef=>({...d,contentHash:contentHash(d),status:'unreviewed',provenance:{...d.provenance,reviews:[]}});

// SYNTHETIC planning fixture only. It is not an imported RP2040, a supplier part,
// or a real external power source. Actual motor parts always use retained receipts.
function controller():BlockDef {
  const cite={url:'https://example.invalid/SYNTHETIC-controller',pages:'1'},receipt=`sha256:${'a'.repeat(64)}`;
  return materialize({schema:'moki.block/1',id:'synthetic-rp2040-capability-fixture',version:1,title:'SYNTHETIC RP2040-style controller',summary:'Abstract capability/budget fixture; not physical hardware',class:'synthetic',provenance:{author:'agent',authorId:'SYNTHETIC'},
    parts:[{ref:'U1',lcsc:'SYNTHETIC:MCU',mpn:'SYNTHETIC:MCU',catalogReceipt:receipt,pinout:'verified',datasheet:cite,at:{x:0,y:0},pins:{A:{pad:'1',role:'output',volts:{min:0,max:3.3}},B:{pad:'2',role:'output',volts:{min:0,max:3.3}}}},{ref:'J1',lcsc:'SYNTHETIC:SUPPLY',mpn:'SYNTHETIC:SUPPLY',catalogReceipt:receipt,pinout:'verified',datasheet:cite,at:{x:0,y:0},pins:{V:{pad:'1',role:'passive'},G:{pad:'2',role:'ground'}}}],
    nets:[{name:'A',pins:['U1.A']},{name:'B',pins:['U1.B']},{name:'VBUS',pins:['J1.V']},{name:'GND',pins:['J1.G']}],params:[],ports:[{id:'MOTOR_IN1',label:'SYNTHETIC PWM14',kind:'gpio',terminal:'net:A',volts:{min:0,max:3.3}},{id:'MOTOR_IN2',label:'SYNTHETIC PWM15',kind:'gpio',terminal:'net:B',volts:{min:0,max:3.3}},{id:'VBUS',label:'SYNTHETIC known5V',kind:'power-out',terminal:'net:VBUS',volts:{min:4.75,max:5.25}},{id:'GND',label:'Ground',kind:'ground',terminal:'net:GND'}],
    power:{sources:[{port:'VBUS',volts:5,maxMa:1500,continuousMa:1500,mode:'external'}],sinks:[]},constraints:[],mcu:{family:'SYNTHETIC-RP2040',pio:{platform:'raspberrypi',board:'SYNTHETIC',framework:'arduino'},flashKb:2048,ramKb:264,pins:[{id:'U1.A',gpio:14,caps:['input','output','pwm']},{id:'U1.B',gpio:15,caps:['input','output','pwm']}]},firmware:{libs:[],includes:['Arduino.h'],usage:'SYNTHETIC capability fixture only'}});
}
function setup(rp=controller()) {
  const blocks=[rp,materialize(draft())];
  const plan:BoardPlan={schema:'moki.plan/1',title:'Motor control electrical integration',layers:2,blocks:blocks.map((b,i)=>({inst:i?'motor':'rp',block:b.id,version:b.version,params:{}})),links:[{from:'rp.VBUS',to:'motor.VM'},{from:'rp.GND',to:'motor.GND'},{from:'rp.MOTOR_IN1',to:'motor.IN1'},{from:'rp.MOTOR_IN2',to:'motor.IN2'}]};return {blocks,plan};
}

test('motor bundle reproduces actual catalog identities and pin17 PowerPAD, remains unreviewed',()=>{
  assert.deepEqual(createMotorBundle(retained.catalog,retained.receipts),retained);const d=draft();assert.deepEqual(errors(checkBlockDraft(d,catalog())),[]);assert.equal(checkMotorReference(d).ok,true);
  assert.equal(d.id,'dc-motor-drv8833');assert.equal(d.parts[0]!.lcsc,'C50506');assert.equal(d.parts[0]!.mpn,'DRV8833PWPR');assert.equal(d.parts[0]!.pins.EP!.pad,'17');assert.equal(d.parts[0]!.pins.AIN1!.pad,'16');assert.equal(d.parts[0]!.pins.VM!.pad,'12');assert.ok(!('status' in d));assert.equal(materialize(d).status,'unreviewed');
});
test('bundled raw importer receipts replay every actual part without network',()=>{
  for(const c of retained.catalog){const r=retained.receipts.find(r=>r.id===c.catalogReceipt)!;assert.ok(r);assert.equal(createHash('sha256').update(r.rawBody).digest('hex'),r.response.bodySha256);assert.deepEqual(catalogPartFromReceipt(r,c.lcsc).pins,c.pins);assert.equal(catalogPartFromReceipt(r,c.lcsc).mpn,c.mpn);}
  const pdf=readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/motor/drv8833-ti.pdf',import.meta.url));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.equal(createHash('sha256').update(pdf).digest('hex'),MOTOR_DATASHEET.sha256);
});
test('actual importer pin-map/value substitutions fail before creating another physical block',()=>{
  for(const mutate of [(c:MotorDraftBundle['catalog'])=>{c[0]!.pins.find(p=>p.pad==='12')!.labels=['GND'];},(c:MotorDraftBundle['catalog'])=>{c.find(p=>p.lcsc==='C34068')!.mpn='1206W4F510KT5E';},(c:MotorDraftBundle['catalog'])=>{c[0]!.footprintSha256='';}]){const c=structuredClone(retained.catalog);mutate(c);assert.throws(()=>createMotorDraft(c));}
});
test('charge-pump, internal-bias and current-sense reference mutants fail',()=>{
  for(const mutate of [(d:BlockDraft)=>{d.nets.find(n=>n.name==='VM')!.pins=d.nets.find(n=>n.name==='VM')!.pins.filter(p=>p!=='C1.2');d.nets.find(n=>n.name==='GND')!.pins.push('C1.2');},(d:BlockDraft)=>{d.parts.find(p=>p.ref==='C2')!.value='100nF';},(d:BlockDraft)=>{d.nets.find(n=>n.name==='GND')!.pins.push('U1.AISEN');},(d:BlockDraft)=>{d.parts[0]!.pins.EP!.pad='16';},(d:BlockDraft)=>{d.parts.find(p=>p.ref==='R2')!.value='5.1Ohm';}]){const d=draft();mutate(d);assert.equal(checkMotorReference(d).ok,false);}
});
test('generic ERC rejects lost VM bypass, connected NC tabs and unverified pinout',()=>{
  for(const mutate of [(d:BlockDraft)=>{d.nets.find(n=>n.name==='GND')!.pins=d.nets.find(n=>n.name==='GND')!.pins.filter(p=>!['C3.2','C4.2'].includes(p));},(d:BlockDraft)=>{d.nets.find(n=>n.name==='GND')!.pins.push('J1.TAB3');},(d:BlockDraft)=>{d.parts[0]!.pinout='unverified';}]){const d=draft();mutate(d);assert.ok(errors(checkBlockDraft(d,catalog())).length);}
});
test('qualified supply plus two PWM-capable output pins produces only real linked motor pin macros',()=>{
  const {blocks,plan}=setup();assert.deepEqual(errors(checkPlan(plan,blocks)),[]);const m=pinMap(plan,blocks);assert.deepEqual(m.pins,{PIN_MOTOR_IN1:{gpio:14,port:'motor.IN1'},PIN_MOTOR_IN2:{gpio:15,port:'motor.IN2'}});assert.deepEqual(m.libs,[]);assert.ok(m.includes.includes('Arduino.h'));assert.ok(blocks[0]!.mcu!.pins.every(p=>p.caps.includes('pwm')));
});
test('power, ground and MCU direction mutants fail instead of mapping firmware',()=>{
  for(const mutate of [(s:ReturnType<typeof setup>)=>{s.blocks[1]!.power.sinks[0]!.peakMa=2000;},(s:ReturnType<typeof setup>)=>{s.plan.links=s.plan.links.filter(l=>l.to!=='motor.GND');},(s:ReturnType<typeof setup>)=>{s.blocks[1]!.ports.find(p=>p.id==='VM')!.volts={min:6,max:7};},(s:ReturnType<typeof setup>)=>{s.blocks[0]!.mcu!.pins[0]!.caps=['input'];},(s:ReturnType<typeof setup>)=>{s.blocks[1]!.parts[0]!.pins.AIN1!.role='output';}]){const s=setup();mutate(s);assert.ok(errors(checkPlan(s.plan,s.blocks)).length);assert.throws(()=>pinMap(s.plan,s.blocks));}
});
test('no fake source, lower motor reserve or hard-current-limit promotion enters this variant',()=>{
  const d=draft();assert.deepEqual(d.power.sources,[]);assert.match(d.summary,/not a hard limit/);assert.match(d.firmware!.usage,/stall\/current\/temperature protection/);d.power.sinks[0]!.peakMa=100;assert.equal(checkMotorReference(d).ok,false);
});
const rpPath=new URL('../src/blocks/data/rp2040-drafts.json',import.meta.url);
test('actual authored RP2040 bundle supplies VBUS and GP14/15 motor control',{skip:!existsSync(rpPath)},()=>{
  const rp=read<{drafts:BlockDraft[]}>('../src/blocks/data/rp2040-drafts.json').drafts[0]!;const {blocks,plan}=setup(materialize(rp));assert.deepEqual(errors(checkPlan(plan,blocks)),[]);const map=pinMap(plan,blocks);assert.equal(map.family,'rp2040');assert.equal(map.pins.PIN_MOTOR_IN1!.gpio,14);assert.equal(map.pins.PIN_MOTOR_IN2!.gpio,15);for(const gpio of [14,15])assert.ok(rp.mcu!.pins.find(p=>p.gpio===gpio)?.caps.includes('pwm'));
});
