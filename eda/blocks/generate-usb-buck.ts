/** Data-only USB buck variant. Existing SYS revisions and their receipts remain immutable. */
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogPart, contentHash } from '../../src/blocks/library.js';
import { catalogPartFromReceipt, loadCatalogReceipt, type CatalogReceipt } from '../../src/blocks/catalog.js';
import { checkBlockDraft } from '../../src/blocks/erc.js';
import type { BlockDraft, CatalogPart, Citation, GateResult } from '../../src/blocks/contract.js';

export const USB_BUCK_ID = 'tps63001-usb-5v-3v3';
export const USB_BUCK_PARTS = {
  C28060: ['TPS63001DRCR', 'sha256:c42a3e97120b05844f323a057f8afc81747b2065fec947a36290f7e7f12d7ed9'],
  C20416998: ['LPS4012-222MRC', 'sha256:a723bd279a3338434b63e2a96371df67ebbfb98c3c426c052597508cad91fe2b'],
  C14663: ['CC0603KRX7R9BB104', 'sha256:fde5081a0b45324f436df1a456a1a4dd1608306b862e8a6f4c8187b9d69ac426'],
  C162430: ['GRM21BZ71C106KE15L', 'sha256:fac7c295d74c60b33cd57238b664281effc5d6bb3ffb9770380e74ceb2960ac8'],
} as const;
const reference: Citation = { url: 'https://www.ti.com/lit/ds/symlink/tps63001.pdf', pages: '1, 3–6, 11–13, 16', note: 'TI SLVS520C fixed TPS63001: FB directly to VOUT; 1.2A buck headline at VIN3.6–5.5V supports this derated author allocation of650mA continuous/800mA peak at USB4.75–5.25V only. Not a1.8V boost or all-temperature guarantee. Efficiency85%, output+/-5%, ambient25C and thetaJA60C/W are conservative screening assumptions, not measured performance. Native loops/EP thermal copper, DC-biased effective capacitance and hardware startup/load/temperature require qualification.' };
const complete: Citation = { url: 'https://www.ti.com/lit/an/slva358a/slva358a.pdf', sha256: 'aaffb9d127ce4ed341773d5b64e6500d6870bb4066713f6cc04983ec3a0df681', pages: '6–7', note: 'Complete fixed-output reference: VIN/VINA share input directly, EN high, PS low, FB directly VOUT; no mixed partial filtered-VINA reference. Additional parallel actual10uF capacitors provide nominal20uF input/30uF output. Effective capacitance remains a qualification item.' };
const coil: Citation = { url: 'https://www.coilcraft.com/getmedia/a31b0140-5adf-4f7e-b7bf-5e9d605a87b9/LPS4012.pdf', pages: '1–2', note: 'Exact LPS4012-222MRC2.2uH+/-20%, DCRmax0.100ohm. At25C: Isat2.3A for10% inductance drop; Irms1.2A for20C rise. Temperature-rise currents are reference values. Buck CCM corner screen uses Lmin1.76uH and fmin1.25MHz, not a boost-current inference. Core loss, switching current and thermal behavior remain unmeasured.' };
const cap: Citation = { url: 'https://datasheet.lcsc.com/datasheet/pdf/aafbc71d90a9d89f42f5e94d0f700539.pdf?productCode=C162430', sha256: '591dd237e95ddb3fdd1faf87f2f1dcdc05738c086937e9622fa76a86c7307246', pages: '1', note: 'Manufacturer Murata part sheet, retained via supplier: GRM21BZ71C106KE15L10uF+/-10%,16Vdc,X7R0805. Higher voltage rating replaces old6.3V capacitors in this separate USB variant. Sheet does not supply a DC-bias curve/minimum effective capacitance; nominal20/30uF is not an effective-capacitance guarantee.' };
export interface UsbBuckBundle { schema: 'moki.usb-buck-drafts/1'; drafts: BlockDraft[]; catalog: CatalogPart[]; receipts: CatalogReceipt[]; gates: GateResult[]; notes: string[] }

export function createUsbBuckDraft(catalog: CatalogPart[]): BlockDraft {
  const map = new Map(catalog.map(p => [p.lcsc, p]));
  if (map.size !== catalog.length || catalog.length !== Object.keys(USB_BUCK_PARTS).length) throw new Error('Exactly four unique actual USB-buck part captures required');
  const labels: Record<string, string> = { '1':'VOUT','2':'L2','3':'PGND','4':'L1','5':'VIN','6':'EN','7':'PS/SYNC','8':'VINA','9':'GND','10':'FB','11':'PAD' };
  for (const [id, [mpn, receipt]] of Object.entries(USB_BUCK_PARTS)) {
    const p = map.get(id), wanted = id === 'C28060' ? labels : {'1':'1','2':'2'};
    if (!p || p.mpn !== mpn || p.catalogReceipt !== receipt || !/^[a-f0-9]{64}$/.test(p.rawSha256) || !/^[a-f0-9]{64}$/.test(p.footprintSha256)) throw new Error(`Pinned actual USB-buck catalog required: ${id}`);
    if (p.pins.length !== Object.keys(wanted).length || Object.entries(wanted).some(([pad,label]) => p.pins.filter(p => p.pad === pad && p.labels.includes(label)).length !== 1)) throw new Error(`Actual USB-buck physical pad map differs: ${id}`);
  }
  // Clone the frozen complete reference, never edit or republish its old identity.
  const bundle = JSON.parse(readFileSync(new URL('../../src/blocks/data/power-drafts.json', import.meta.url), 'utf8')) as { drafts: BlockDraft[] };
  const old = bundle.drafts.find(d => d.id === 'tps63001-usb-sys-3v3' && d.version === 1)!;
  if (!old || contentHash(old) !== 'f6737dba04f161f87426c22a99896fbe7b1ad7f7e50818fb51a0b17d4c7e11dc') throw new Error('Immutable original converter reference differs');
  const b = structuredClone(old);
  b.id = USB_BUCK_ID; b.title = 'TPS63001 USB5V to3.3V,650mA continuous allocation';
  b.summary = 'USB4.75–5.25V input only, fixed3.3V output; author allocation650mA continuous/800mA peak at25C and85% assumed efficiency. Actual TPS63001+LPS4012 and16V X7R bulk caps; unreviewed, not a hardware or battery-boost guarantee.';
  for (const p of b.parts) {
    if (/^C[1-5]$/.test(p.ref)) { const c=map.get('C162430')!; p.lcsc=c.lcsc; p.mpn=c.mpn; p.catalogReceipt=c.catalogReceipt; p.datasheet=cap; p.valueWhy=cap; }
    else if (p.ref==='L1') { p.datasheet=coil; p.valueWhy=coil; }
    else if (p.ref==='U1') { p.datasheet=reference; p.pins.VIN!.volts={min:4.75,max:5.25}; p.pins.VINA!.volts={min:4.75,max:5.25}; }
  }
  b.nets.find(n=>n.name==='SYS')!.name='VBUS';
  const input=b.ports.find(p=>p.id==='SYS')!; input.id='VBUS'; input.label='Qualified USB5V input'; input.terminal='net:VBUS'; input.volts={min:4.75,max:5.25};
  b.power.sources[0]!.inputPort='VBUS'; b.power.sources[0]!.thermal={thetaJa:60,maxJunctionC:110,ambientC:25}; b.power.sinks[0]!.port='VBUS';
  for (const c of b.constraints) { c.citation = c.kind==='decoupling' && c.powerPin==='VINA' ? complete : reference; if(c.kind==='strap' && c.to==='net:SYS')c.to='net:VBUS'; }
  b.params.find(p=>p.id==='operatingState')!.options=['qualified-usb-4.75-to-5.25'];
  b.params.find(p=>p.id==='operatingState')!.default='qualified-usb-4.75-to-5.25';
  b.params.find(p=>p.id==='operatingState')!.why=reference.note!;
  b.firmware={libs:[],includes:[],usage:`Always on, EN=VBUS, PS/SYNC=GND; fixed FB=VOUT. ${reference.note} ${complete.note} ${coil.note} ${cap.note}`};
  return b;
}

/** Electrical topology and allocation invariants, beyond generic component-agnostic ERC. */
export function checkUsbBuckReference(b: BlockDraft): GateResult {
  const issues: GateResult['issues']=[];
  const need=(ok:boolean,message:string)=>{if(!ok)issues.push({rule:'usb-buck-reference',severity:'error',where:b.id,message});};
  const has=(...pins:string[])=>b.nets.some(n=>pins.every(p=>n.pins.includes(p)));
  const part=(ref:string)=>b.parts.find(p=>p.ref===ref);
  need(b.id===USB_BUCK_ID && b.version===1,'Separate immutable USB-input identity required');
  need(b.parts.length===8 && part('U1')?.lcsc==='C28060' && Object.keys(part('U1')?.pins??{}).length===11,'Exact11-pad TPS63001 plus8-part reference required');
  need(has('U1.VIN','U1.VINA','U1.EN','C1.1','C2.1','C6.1') && has('U1.GND','U1.PGND','U1.EP','U1.PS','C1.2','C2.2','C3.2','C4.2','C5.2','C6.2'),'Direct input supply/control and complete ground network required');
  need(has('U1.VOUT','U1.FB','C3.1','C4.1','C5.1') && !has('U1.FB','U1.VIN'),'Fixed-output FB must return to VOUT, never input');
  need(has('U1.L1','L1.1') && has('U1.L2','L1.2') && !has('U1.L1','U1.L2') && !has('U1.L1','U1.VIN') && !has('U1.L2','U1.VOUT'),'Separate switching nodes must join only through the actual inductor');
  need(part('L1')?.lcsc==='C20416998' && part('L1')?.value==='2.2uH','Exact retained2.2uH LPS4012 required');
  need(['C1','C2','C3','C4','C5'].every(r=>part(r)?.lcsc==='C162430' && part(r)?.value==='10uF') && part('C6')?.lcsc==='C14663' && part('C6')?.value==='100nF','Actual16V10uF X7R bulk and50V100nF bypass values required');
  const input=b.ports.find(p=>p.id==='VBUS'),out=b.power.sources[0];
  need(b.ports.length===3 && input?.terminal==='net:VBUS' && input.kind==='power-in' && input.volts?.min===4.75 && input.volts.max===5.25 && ['VIN','VINA'].every(p=>part('U1')?.pins[p]?.volts?.min===4.75 && part('U1')?.pins[p]?.volts?.max===5.25),'Input is qualified USB4.75–5.25V, not SYS or battery');
  need(b.power.sources.length===1 && out?.port==='V3V3' && out.inputPort==='VBUS' && out.volts===3.3 && out.maxMa===800 && out.continuousMa===650 && out.conversion==='switching' && out.mode==='regulated' && out.efficiency===.85 && out.thermal?.thetaJa===60 && out.thermal.ambientC===25 && out.thermal.maxJunctionC===110,'Bounded650continuous/800peak author budget with85% assumed efficiency and25C reference thermal model required');
  return {gate:'verify',ok:!issues.some(i=>i.severity==='error'),issues};
}

export function usbBuckEvidence(): GateResult {
  const ripple=Math.max(...[4.75,5.25].flatMap(vi=>[3.135,3.465].map(vo=>vo*(vi-vo)/(vi*1.25e6*2.2e-6*.8))));
  const peak=.8+ripple/2, rms=Math.sqrt(.8**2+ripple**2/12),loss=3.465*.65*(1/.85-1);
  const measurements=[
    {name:'CCM inductor peak plus20% margin',measured:peak*1.2,target:2.3,unit:'A'},
    {name:'CCM inductor RMS versus25C20C-rise reference',measured:rms,target:1.2,unit:'A'},
    {name:'Continuous modeled junction temperature',measured:25+loss*60,target:110,unit:'C'},
    {name:'800mA rail input allocation plus quiescent',measured:800*3.465/(4.75*.85)+.1,target:1500,unit:'mA'},
  ].map(m=>({...m,where:USB_BUCK_ID,tolerance:0,ok:m.measured<=m.target}));
  return {gate:'power',ok:measurements.every(m=>m.ok),measurements,issues:[
    {rule:'usb-buck-author-allocation',severity:'warning',message:`Buck-only screening at4.75–5.25V, Lmin1.76uH, fmin1.25MHz: ripple${ripple.toFixed(6)}A, peak${peak.toFixed(6)}A. TI1.6A switch-limit minimum is tested at3.6V/25C, not a fullUSB/fulltemperature output guarantee;1.2A buck headline supports derating, not guaranteed hardware performance.`},
    {rule:'effective-capacitance-unverified',severity:'warning',message:'Five actual10uF16V X7R capacitors give20uF input/30uF output nominal. Murata part sheet has no DC-bias curve; tolerance/bias/temperature effective capacitance, ESR and local loops require qualification. No guaranteed effective22uF claim.'},
    {rule:'hardware-power-unverified',severity:'warning',message:'650mAcontinuous/800mApeak are declared engineering allocations at25C,85% assumed efficiency, thetaJA60C/W author model (TI reference table46.8C/W). Native DRC, independent schematic review, thermal copper/EP, startup/load-step/EMI and measured efficiency/current/temperature remain separate gates. No battery/1.8V boost guarantee.'},
  ]};
}
export function createUsbBuckBundle(catalog:CatalogPart[],receipts:CatalogReceipt[]=[]):UsbBuckBundle {
  const draft=createUsbBuckDraft(catalog);
  return {schema:'moki.usb-buck-drafts/1',drafts:[draft],catalog:structuredClone(catalog),receipts:structuredClone(receipts),gates:[...checkBlockDraft(draft,new Map(catalog.map(p=>[p.lcsc,p]))),checkUsbBuckReference(draft),usbBuckEvidence()],notes:['Data-only unreviewed candidate; pure ERC/reference/current arithmetic are not native routing or measured hardware acceptance.','Link usb.VBUS -> buck.VBUS, buck.V3V3 -> loads, and shared GND. Qualified USB supply must maintain4.75–5.25V at the board and support aggregate demand.','Existing tps63001-usb-sys-3v3@1 is unchanged; this new variant does not widen any old input domain.','Manufacturer references: TI SLVS520C, complete SLVA358A, Coilcraft LPS4012, retained Murata exact-part sheet. Exact supplier/importer captures and geometry receipts travel with this bundle.']};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const catalog=Object.entries(USB_BUCK_PARTS).map(([id,[,receipt]])=>catalogPart(id,receipt));
  const receipts:CatalogReceipt[]=[];
  for(const c of catalog){const receipt=await loadCatalogReceipt(c.catalogReceipt);const replay=catalogPartFromReceipt(receipt,c.lcsc);if(replay.rawSha256!==c.rawSha256||replay.footprintSha256!==c.footprintSha256||JSON.stringify(replay.pins)!==JSON.stringify(c.pins))throw new Error(`Catalog replay differs: ${c.lcsc}`);receipts.push(receipt);}
  const bundle=createUsbBuckBundle(catalog,receipts);
  if(bundle.gates.some(g=>!g.ok))throw new Error(JSON.stringify(bundle.gates));
  await writeFile(resolve('src/blocks/data/usb-buck-drafts.json'),JSON.stringify(bundle,null,2)+'\n');
  console.log(JSON.stringify({id:USB_BUCK_ID,version:1,contentHash:contentHash(bundle.drafts[0]!),ports:bundle.drafts[0]!.ports,gates:bundle.gates.map(g=>({gate:g.gate,ok:g.ok}))},null,2));
}
