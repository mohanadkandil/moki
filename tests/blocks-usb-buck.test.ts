import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsbBuckBundle, createUsbBuckDraft, checkUsbBuckReference, usbBuckEvidence, USB_BUCK_ID, type UsbBuckBundle } from '../eda/blocks/generate-usb-buck.js';
import { catalogPartFromReceipt, loadCatalogReceipt } from '../src/blocks/catalog.js';
import { contentHash, materializeDraft, listBlocks, resolvePlanBlocks } from '../src/blocks/library.js';
import { checkBlockDraft, checkPlan } from '../src/blocks/erc.js';
import type { BlockDef, BlockDraft, BoardPlan, GateResult } from '../src/blocks/contract.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const bundle=read<UsbBuckBundle>('../src/blocks/data/usb-buck-drafts.json');
const draft=()=>createUsbBuckDraft(structuredClone(bundle.catalog));
const errors=(gates:GateResult[])=>gates.flatMap(g=>g.issues.filter(i=>i.severity==='error'));
const rules=(gates:GateResult[])=>errors(gates).map(i=>i.rule);
const materialize=(d:BlockDraft):BlockDef=>({...d,contentHash:contentHash(d),status:'unreviewed',provenance:{...d.provenance,reviews:[]}});
function air(){
  const plan=read<BoardPlan>('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/usb-buck/air-plan.json');
  const blocks=resolvePlanBlocks(plan,[...listBlocks().filter(b=>b.id!==USB_BUCK_ID),materializeDraft(draft())]);
  return {plan,blocks};
}

test('USB-specific bundle deterministically reproduces pinned actual component data and generic gates',()=>{
  assert.deepEqual(createUsbBuckBundle(bundle.catalog,bundle.receipts),bundle);
  assert.equal(bundle.catalog.length,4);assert.equal(bundle.receipts.length,4);
  assert.deepEqual(errors(checkBlockDraft(draft(),new Map(bundle.catalog.map(p=>[p.lcsc,p])))),[]);
  assert.ok(bundle.gates.every(g=>g.ok));
  const b=materializeDraft(draft());assert.equal(b.status,'unreviewed');
  assert.equal(b.contentHash,'b57cf365a9e1166ecbf9fb51eddf68fd6b4c84ae833878387928b690a16103f8');
  assert.equal(b.parts.length,8);assert.equal(b.parts.find(p=>p.ref==='U1')!.pins.EP!.pad,'11');
});

test('portable exact receipt replay preserves actual pad geometry and rejects tampering',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-usb-buck-'));
  try{
    await mkdir(join(dir,'receipts'));
    for(const c of bundle.catalog){
      const r=bundle.receipts.find(r=>r.id===c.catalogReceipt)!;assert.ok(r);
      const path=join(dir,'receipts',r.id.slice(7)+'.json');await writeFile(path,JSON.stringify(r));
      const loaded=await loadCatalogReceipt(r.id,{cacheDir:dir});
      const replay=catalogPartFromReceipt(loaded,c.lcsc);
      assert.equal(replay.mpn,c.mpn);assert.equal(replay.rawSha256,c.rawSha256);assert.equal(replay.footprintSha256,c.footprintSha256);assert.deepEqual(replay.pins,c.pins);
      await writeFile(path,JSON.stringify({...r,rawBody:r.rawBody+' '}));
      await assert.rejects(loadCatalogReceipt(r.id,{cacheDir:dir}),/integrity/);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('retained old SYS identity and input domain remain immutable',()=>{
  const old=read<{drafts:BlockDraft[]}>('../src/blocks/data/power-drafts.json').drafts.find(b=>b.id==='tps63001-usb-sys-3v3')!;
  assert.equal(contentHash(old),'f6737dba04f161f87426c22a99896fbe7b1ad7f7e50818fb51a0b17d4c7e11dc');
  assert.deepEqual(old.ports.find(p=>p.id==='SYS')!.volts,{min:4.2,max:4.5});
  const b=draft();assert.deepEqual(b.ports.map(p=>p.id),['VBUS','V3V3','GND']);
  assert.deepEqual(b.ports[0]!.volts,{min:4.75,max:5.25});
});

test('wrong actual identity, mismatched pins and missing capture fail closed',()=>{
  const wrong=structuredClone(bundle.catalog);wrong[0]!.mpn='TPS63000';assert.throws(()=>createUsbBuckDraft(wrong),/pinned actual/i);
  const pin=structuredClone(bundle.catalog);pin.find(p=>p.lcsc==='C28060')!.pins.find(p=>p.pad==='10')!.labels=['GND'];assert.throws(()=>createUsbBuckDraft(pin),/physical pad map/);
  assert.throws(()=>createUsbBuckDraft(bundle.catalog.slice(1)),/Exactly four/);
});

test('FB, input grounds, switching nodes, actual parts and allocation regressions reject',()=>{
  for(const mutate of [
    (b:BlockDraft)=>{b.nets.find(n=>n.name==='V3V3')!.pins=b.nets.find(n=>n.name==='V3V3')!.pins.filter(p=>p!=='U1.FB');b.nets.find(n=>n.name==='VBUS')!.pins.push('U1.FB');},
    (b:BlockDraft)=>{b.nets.find(n=>n.name==='GND')!.pins=b.nets.find(n=>n.name==='GND')!.pins.filter(p=>p!=='U1.EP');},
    (b:BlockDraft)=>{b.nets.find(n=>n.name==='SW_L1')!.pins.push('U1.L2');},
    (b:BlockDraft)=>{b.parts.find(p=>p.ref==='L1')!.value='1uH';},
    (b:BlockDraft)=>{b.parts.find(p=>p.ref==='C1')!.lcsc='C15850';},
    (b:BlockDraft)=>{b.parts.find(p=>p.ref==='C3')!.value='1nF';},
    (b:BlockDraft)=>{b.ports.find(p=>p.id==='VBUS')!.volts={min:1.8,max:5.5};},
    (b:BlockDraft)=>{b.power.sources[0]!.continuousMa=1200;},
    (b:BlockDraft)=>{b.power.sources[0]!.efficiency=.99;},
    (b:BlockDraft)=>{b.power.sources[0]!.thermal!.ambientC=60;},
  ]){const b=draft();mutate(b);assert.equal(checkUsbBuckReference(b).ok,false);}
});

test('owner S3 air plan directly links USB VBUS, passes ERC/power, old SYS variant fails',()=>{
  const {plan,blocks}=air();assert.deepEqual(errors(checkPlan(plan,blocks)),[]);
  const old=read<{drafts:BlockDraft[]}>('../src/blocks/data/power-drafts.json').drafts.find(b=>b.id==='tps63001-usb-sys-3v3')!;
  plan.blocks.find(b=>b.inst==='ldo')!.block=old.id;
  for(const l of plan.links)for(const k of ['from','to'] as const)if(l[k]==='ldo.VBUS')l[k]='ldo.SYS';
  const replaced=blocks.filter(b=>b.id!==USB_BUCK_ID).concat(materialize(old));
  assert.ok(rules(checkPlan(plan,replaced)).some(r=>['voltage-domain','pin-voltage'].includes(r)));
});

test('continuous650mA and peak800mA are distinct authoritative power bounds',()=>{
  for(const [typicalMa,peakMa,expected] of [[650,800,null],[650.01,800,'continuous-current-budget'],[650,800.01,'peak-current-budget']] as const){
    const {plan,blocks}=air();
    const mcu=blocks.find(b=>b.id==='esp32-s3-core')!;
    for(const b of blocks)if(b.id!==USB_BUCK_ID && b.id!=='usb-c-sink')b.power.sinks=b.power.sinks.map(s=>({...s,typicalMa:0,peakMa:0}));
    mcu.power.sinks=[{port:'V3V3',typicalMa,peakMa}];
    const rs=rules(checkPlan(plan,blocks));if(expected)assert.ok(rs.includes(expected),JSON.stringify(rs));else assert.deepEqual(errors(checkPlan(plan,blocks)),[]);
  }
  const low=air(),usb=low.blocks.find(b=>b.id==='usb-c-sink')!;usb.ports.find(p=>p.id==='VBUS')!.volts={min:2.5,max:2.5};usb.power.sources.find(p=>p.port==='VBUS')!.volts=2.5;
  assert.ok(rules(checkPlan(low.plan,low.blocks)).some(r=>['voltage-domain','pin-voltage'].includes(r)));
});

test('buck-only arithmetic preserves explicit unmeasured DC-bias and hardware qualifications',()=>{
  const g=usbBuckEvidence();assert.equal(g.ok,true);assert.ok(g.measurements!.every(m=>m.ok));
  assert.ok(g.measurements!.find(m=>m.name.startsWith('CCM inductor peak'))!.measured<1.31);
  assert.ok(g.measurements!.find(m=>m.name.includes('junction'))!.measured<49);
  assert.ok(g.issues.some(i=>i.rule==='effective-capacitance-unverified'&&i.severity==='warning'));
  assert.ok(g.issues.some(i=>i.rule==='hardware-power-unverified'&&/No battery/.test(i.message)));
});
