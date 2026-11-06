/** Catalog-bound DATA ONLY. Native routing, thermal/motor qualification and review are separate. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerPart } from '../../src/blocks/library.js';
import { loadCatalogReceipt, searchParts, type CatalogReceipt } from '../../src/blocks/catalog.js';
import { checkBlockDraft } from '../../src/blocks/erc.js';
import type { BlockDraft, BlockPart, CatalogPart, Citation, GateResult } from '../../src/blocks/contract.js';

export interface MotorDraftBundle {
  schema: 'moki.motor-drafts/1'; drafts: BlockDraft[]; catalog: CatalogPart[];
  receipts: CatalogReceipt[]; gates: Array<{id:string;results:GateResult[]}>; notes:string[];
}
export const MOTOR_PART_IDS=['C50506','C1589','C23630','C162430','C134850','C25819','C34068','C160352'] as const;
export const MOTOR_DATASHEET: Citation={url:'https://www.ti.com/lit/ds/symlink/drv8833.pdf',sha256:'3e400e333f08f1b93ec99a2d52a6af2a864e88462cc892282208548d9e9f0de4',pages:'3–7, 9–16',note:'TI SLVSAR1E. HTSSOP PWP pin numbering; one bridge used, second bridge inputs and BISEN grounded, outputs unconnected. PowerPAD must be grounded. VCP10nF X7R>=16V toVM, VINT2.2uF>=6.3V toGND, VM>=10uF ceramic. Actual motor, supply transients and heatsinking require qualification.'};
const identity:Record<string,string>={C50506:'DRV8833PWPR',C1589:'CL10B103KB8NNNC',C23630:'CL10A225KO8NNNC',C162430:'GRM21BZ71C106KE15L',C134850:'OCR470M1CBK-0605',C25819:'0603WAF4702T5E',C34068:'1206W4F510LT5E',C160352:'B2B-PH-SM4-TB(LF)(SN)'};
const driverLabels:Record<string,string>={'1':'nSleep','2':'AOUT1','3':'AISEN','4':'AOUT2','5':'BOUT2','6':'BISEN','7':'BOUT1','8':'nFault','9':'BIN1','10':'BIN2','11':'VCP','12':'VM','13':'GND','14':'VINT','15':'AIN2','16':'AIN1','17':'GND'};
const pin=(pad:string,role:BlockPart['pins'][string]['role'],required=true,volts?:{min:number;max:number}):BlockPart['pins'][string]=>({pad,role,...(required?{required:true}:{}),...(volts?{volts}:{})});
const passive=(pad:string)=>pin(pad,'passive');

export function createMotorDraft(catalog:CatalogPart[]):BlockDraft {
  const map=new Map(catalog.map(c=>[c.lcsc,c]));
  for(const id of MOTOR_PART_IDS){const c=map.get(id);if(!c||c.mpn!==identity[id]||!/^sha256:[a-f0-9]{64}$/.test(c.catalogReceipt)||!/^[a-f0-9]{64}$/.test(c.rawSha256)||!/^[a-f0-9]{64}$/.test(c.footprintSha256))throw new Error(`Pinned actual catalog geometry required: ${id}`);
    const wanted=id==='C50506'?driverLabels:id==='C160352'?{'1':'1','2':'2','3':'3','4':'4'}:{'1':'1','2':'2'};
    if(c.pins.length!==Object.keys(wanted).length||Object.entries(wanted).some(([pad,label])=>c.pins.filter(p=>p.pad===pad&&p.labels.includes(label)).length!==1))throw new Error(`Actual importer physical pins differ: ${id}`);
  }
  const part=(ref:string,id:string,pins:BlockPart['pins'],x:number,y:number,value?:string,why?:Citation):BlockPart=>{const c=map.get(id)!;return {ref,lcsc:id,mpn:c.mpn,catalogReceipt:c.catalogReceipt,pinout:'verified',pins,at:{x,y},datasheet:id==='C50506'?MOTOR_DATASHEET:{url:c.datasheetUrl??MOTOR_DATASHEET.url,note:`Actual catalog-bound ${id}/${c.mpn}; retained immutable importer/supplier receipts identify the component. ${id==='C134850'?'Polarized polymer capacitor: importer symbol plus mark is on physical pad1; verify assembled polarity and manufacturer dimensional fit.':''}`},...(value?{value,valueWhy:why??MOTOR_DATASHEET}:{})};};
  const two=(ref:string,id:string,value:string,x:number,y:number,why:Citation=MOTOR_DATASHEET)=>part(ref,id,{'1':passive('1'),'2':passive('2')},x,y,value,why);
  const reference=(pages:string,note:string):Citation=>({...MOTOR_DATASHEET,pages,note});
  return {
    schema:'moki.block/1',id:'dc-motor-drv8833',version:1,title:'DRV8833 single brushed DC motor, qualified5V USB supply',class:'motor_driver',
    summary:'TI DRV8833PWPR HTSSOP16+EP, bridgeA to2-pin JST PH motor connector. 0.51ohm sense resistor gives~392mA nominal chopping at25C; 205mAtyp/505mApeak is a declared supply reservation, not a hard limit or unknown-motor stall guarantee. Unreviewed; no motor, thermal, regeneration or native layout proof.',
    provenance:{author:'agent',authorId:'chip_eda'},
    parts:[
      part('U1','C50506',{NSLEEP:pin('1','input',true,{min:0,max:5.75}),AOUT1:pin('2','output',true,{min:0,max:5.25}),AISEN:pin('3','input',true,{min:0,max:.5}),AOUT2:pin('4','output',true,{min:0,max:5.25}),BOUT2:pin('5','output',false),BISEN:pin('6','ground'),BOUT1:pin('7','output',false),NFAULT:pin('8','open-drain',false),BIN1:pin('9','input'),BIN2:pin('10','input'),VCP:pin('11','bidirectional'),VM:pin('12','power-in',true,{min:4.75,max:5.25}),GND:pin('13','ground'),VINT:pin('14','passive'),AIN2:pin('15','input',true,{min:0,max:3.6}),AIN1:pin('16','input',true,{min:0,max:3.6}),EP:pin('17','ground')},0,0),
      two('C1','C1589','10nF',4.5,0,reference('3, 15','VCP toVM, actual50V X7R10nF. This is a charge-pump capacitor, not a VCP-toGND bypass.')),
      two('C2','C23630','2.2uF',4.5,-2,reference('3, 15','VINT internal-bias bypass only: actual16V2.2uF X5R. VINT is not an external rated rail; its graph pin is a passive bypass terminal, not an invented power source. Effective capacitance remains to be verified.')),
      two('C3','C162430','10uF',4.5,2),two('C4','C162430','10uF',4.5,4),
      part('C5','C134850',{POS:passive('1'),NEG:passive('2')},9,0,'47uF',reference('14','Author-selected47uF16V polarized polymer bulk in addition to2x10uF16V X7R ceramic. Catalog lists1.65A@100kHz ripple; manufacturer PDF unavailable in this capture. Bulk sizing, ESR/ripple, inrush and regenerative braking must be qualified on actual motor/supply. No transient guarantee.')),
      two('R1','C25819','47kOhm',-4.5,2,reference('11','TI recommends20–75kOhm nSLEEP pullup toVM; actual47k1% is fixed enabled. Internal500k pulldown; inputs00 defaultcoast. No software sleep port.')),
      two('R2','C34068','0.51Ohm',-4.5,-2,reference('7, 10, 13','Actual0.51ohm1%250mW1206 sense resistor. VTRIP160–240mV at25C =>310.62–475.34mA nominal-tolerance chopping;392.16mA typical. 3.75us blanking and800ppm/C TCR mean this is not a hard500mA limit. At500mA, resistor dissipation<=0.1288W atnominal25C tolerance, before thermal derating.')),
      part('J1','C160352',{OUT1:passive('1'),OUT2:passive('2'),TAB3:pin('3','nc',false),TAB4:pin('4','nc',false)},-10,0),
    ],
    nets:[
      {name:'VM',pins:['U1.VM','C1.2','C3.1','C4.1','C5.POS','R1.1']},
      {name:'GND',pins:['U1.GND','U1.EP','U1.BISEN','U1.BIN1','U1.BIN2','C2.2','C3.2','C4.2','C5.NEG','R2.2']},
      {name:'VCP_PUMP',pins:['U1.VCP','C1.1']},{name:'VINT_BYPASS',pins:['U1.VINT','C2.1']},
      {name:'SLEEP_ENABLED',pins:['U1.NSLEEP','R1.2']},{name:'CURRENT_SENSE_A',pins:['U1.AISEN','R2.1']},
      {name:'MOTOR_OUT1',pins:['U1.AOUT1','J1.OUT1']},{name:'MOTOR_OUT2',pins:['U1.AOUT2','J1.OUT2']},
      {name:'IN1',pins:['U1.AIN1']},{name:'IN2',pins:['U1.AIN2']},
    ],
    params:[
      {id:'supply',type:'enum',options:['qualified-usb5v-1a5'],default:'qualified-usb5v-1a5',why:'Board-level4.75–5.25V source must guarantee1.5A under totalboardload; not arbitrary USB2 host permission. VM isUSB VBUS, never3.3VLDO. Motor must be explicitly qualified within the205/505mA reserved envelope.'},
      {id:'motorProfile',type:'enum',options:['external-5v-small-motor-unqualified'],default:'external-5v-small-motor-unqualified',why:'No actual external motor is selected. Startup/stallcurrent, windingL/R, duty/braking and regeneration remain unqualified;205mAtyp/505peak authorbudget is not motor measurement or hard current limit.'},
    ],
    ports:[{id:'VM',label:'Qualified5V motor supply',kind:'power-in',terminal:'net:VM',volts:{min:4.75,max:5.25}},{id:'GND',label:'Motor/system shared ground',kind:'ground',terminal:'net:GND'},{id:'IN1',label:'BridgeA PWM/input1',kind:'gpio',terminal:'net:IN1',volts:{min:0,max:3.6}},{id:'IN2',label:'BridgeA PWM/input2',kind:'gpio',terminal:'net:IN2',volts:{min:0,max:3.6}}],
    power:{sources:[],sinks:[{port:'VM',typicalMa:205,peakMa:505}]},
    constraints:[
      {kind:'decoupling',ic:'U1',powerPin:'VM',groundPin:'GND',caps:['C3','C4'],minUf:10,maxDistanceMm:6.1,citation:reference('3, 15','Manufacturer minimum10uF ceramic; author2x10uF16V X7R chosen for nominal margin. 6.1mm origin-distance screen is an author policy, not a manufacturer placement limit. Verify effective DC-biased capacitance, actual pad distances and short high-current loops natively.')},
      {kind:'pullup',pin:'U1.NSLEEP',to:'net:VM',resistor:'R1',ohms:47000,citation:reference('11','Fixed nSLEEP pullup47k within TI20–75k recommendation; always enabled afterwake delay. No MCU5V connection.')},
      ...['GND','EP','BISEN'].map(p=>({kind:'ground' as const,pin:`U1.${p}`,citation:reference('3–4, 10, 15','Ground HTSSOP GND andPowerPAD; unusedbridge BISEN directlyGND. EPthermalcopper/vias andactualcontinuousground require native verification.')})),
      ...['BIN1','BIN2'].map(p=>({kind:'strap' as const,pin:`U1.${p}`,safe:'low' as const,to:'net:GND',citation:reference('9–10','UnusedbridgeB forced00(coast), outputpins unconnected; never parallel independentoutputnets.')})),
    ],
    firmware:{libs:[],includes:['Arduino.h'],usage:'MCU must drive IN1/IN2 using output-capable pins; speedPWM additionally requires actual PWM capability (RP2040 agreed GP14/15). Port schema has no PWM-requirement field, so plan review must check MCU facts. Set both pinsLOW before enabling OUTPUT, wait>=1ms afterVM valid (2ms authorpolicy). 00coast,10forward,01reverse,11brake; fast-decay speedPWM appliesPWM toonepin whileotherLOW. Use targetcore analogWrite/digitalWrite, no extra library. Startspeed0, clampduty, coast before reversing; software is not stall/current/temperature protection. Fixedsleep47k is alwaysenabled, no shutdownGPIO. Never ground either motor terminal or route motor current through3.3VLDO. Qualify motor/supply startup, stall, USBinrush, EMI, regeneration/braking, effectivecaps andthermalbehavior; no hardware-fit/manufacturing claim.'},
  };
}

/** Reference-net checks beyond generic ERC: internal bias/pump pins are not fabricated rail sources. */
export function checkMotorReference(draft:BlockDraft):GateResult {
  const issues:GateResult['issues']=[],error=(rule:string,message:string)=>issues.push({rule,severity:'error',where:draft.id,message});
  const part=(ref:string)=>draft.parts.find(p=>p.ref===ref),has=(...pins:string[])=>draft.nets.some(n=>pins.every(p=>n.pins.includes(p))),unused=(p:string)=>!draft.nets.some(n=>n.pins.includes(p));
  const expected:Record<string,string>={NSLEEP:'1',AOUT1:'2',AISEN:'3',AOUT2:'4',BOUT2:'5',BISEN:'6',BOUT1:'7',NFAULT:'8',BIN1:'9',BIN2:'10',VCP:'11',VM:'12',GND:'13',VINT:'14',AIN2:'15',AIN1:'16',EP:'17'};
  if(part('U1')?.lcsc!=='C50506'||Object.entries(expected).some(([id,pad])=>part('U1')?.pins[id]?.pad!==pad)||part('U1')?.omitPads?.length)error('motor-pinmap','HTSSOP physical pins1–17 including groundedEP must match retained TI/importer mapping');
  for(const [ref,value] of [['C1','10nF'],['C2','2.2uF'],['C3','10uF'],['C4','10uF'],['C5','47uF'],['R1','47kOhm'],['R2','0.51Ohm']])if(part(ref!)?.value!==value)error('motor-value',`${ref} actual selected value must remain ${value}`);
  for(const pins of [['U1.VCP','C1.1'],['U1.VM','C1.2'],['U1.VINT','C2.1'],['U1.GND','C2.2','C5.NEG'],['U1.VM','C5.POS'],['U1.AISEN','R2.1'],['U1.GND','R2.2'],['U1.NSLEEP','R1.2'],['U1.VM','R1.1'],['U1.GND','U1.EP','U1.BISEN','U1.BIN1','U1.BIN2'],['U1.AOUT1','J1.OUT1'],['U1.AOUT2','J1.OUT2']])if(!has(...pins))error('motor-reference-net',`Reference connection missing: ${pins.join(' / ')}`);
  if(has('U1.AISEN','U1.GND')||has('U1.VCP','U1.GND')||has('U1.VINT','U1.VM')||has('U1.AOUT1','U1.AOUT2')||has('U1.AOUT1','U1.GND')||has('U1.AOUT2','U1.GND'))error('motor-reference-short','Pump/bias/sense or H-bridge outputs have a forbidden short');
  if(!['U1.BOUT1','U1.BOUT2','U1.NFAULT','J1.TAB3','J1.TAB4'].every(unused))error('motor-unused-bridge','Unused bridge outputs/fault and mechanicaltabs must remain unconnected in this variant');
  if(draft.power.sources.length||draft.power.sinks.length!==1||draft.power.sinks[0]?.port!=='VM'||draft.power.sinks[0].typicalMa<205||draft.power.sinks[0].peakMa<505)error('motor-budget','No fake source; reserve at least205typ/505peakmA fromVM includingdriveroverhead');
  return {gate:'verify',ok:!issues.some(i=>i.severity==='error'),issues};
}

export function createMotorBundle(catalog:CatalogPart[],receipts:CatalogReceipt[]=[]):MotorDraftBundle {
  const draft=createMotorDraft(catalog),results=[...checkBlockDraft(draft,new Map(catalog.map(p=>[p.lcsc,p]))),checkMotorReference(draft)];
  return {schema:'moki.motor-drafts/1',drafts:[draft],catalog,receipts,gates:[{id:draft.id,results}],notes:[
    'Unreviewed data-only block; passing ERC/reference checks is not nativeDRC, routing, firmwarecompile, independentreview, motorqualification or manufacturingproof.',
    'KnownUSB5V1.5A source is a boardcontract; do not infer500mA motor permission from an arbitraryUSBhost. RP2040 VBUS feedsVM directly; sharedGND required. No motorload on3.3VLDO.',
    'Currentchop nominal392.16mA;25C VTRIP/resistortolerance interval310.62–475.34mA. 3.75usblanking, resistorTCR andmotorinductance prevent any hard500mA peakclaim. Actualmotor notselected; startup/stall/regeneration/current/thermal remain unqualified.',
    'VINT is a passive internal-bias bypass terminal andVCP bidirectional charge-pump terminal, not external ratedsources. Dedicatedreference checker enforces2.2uF VINT-GND and10nF VCP-VM; genericERC cannot encode these internalbias behaviors.',
    'Catalog values/polarity are pinned;Lelon primaryPDF download unavailable, retainedfailedHTML explicitlylabelled. Polymercap ESR/ripple anddimensionalfit, allMLCCeffectivecaps andUSBtransients need independentqualification.',
    'Imported library source attribution: JLCEDA/EasyEDA Official Library, https://lceda.cn/ andhttps://easyeda.com . Raw responses retain theirsource/license fields. No imported3D claim.',
  ]};
}
export async function generateMotor():Promise<MotorDraftBundle>{
  const discoveries=await Promise.all(['DRV8833PWPR','CL10B103KB8NNNC','CL10A225KO8NNNC','0805 10uF 16V X7R','47uF 16V polymer','47k 0603','1206W4F510LT5E','B2B-PH-SM4-TB(LF)(SN)'].map(query=>searchParts(query,{maxResults:8})));
  for(let i=0;i<MOTOR_PART_IDS.length;i++)if(!discoveries[i]!.some(p=>p.lcsc===MOTOR_PART_IDS[i]))throw new Error(`Actual search no longer confirms ${MOTOR_PART_IDS[i]}`);
  const catalog:CatalogPart[]=[];for(const id of MOTOR_PART_IDS)catalog.push(await registerPart(id));
  const ids=new Set([...catalog.flatMap(c=>[c.catalogReceipt,...(c.datasheetReceipt?[c.datasheetReceipt]:[])]),...discoveries.flatMap(rows=>rows.map(p=>p.catalogReceipt))]);
  return createMotorBundle(catalog,await Promise.all([...ids].map(id=>loadCatalogReceipt(id))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const bundle=await generateMotor();await writeFile(resolve('src/blocks/data/motor-drafts.json'),JSON.stringify(bundle,null,2)+'\n');console.log(JSON.stringify({id:bundle.drafts[0]!.id,parts:bundle.catalog.length,gates:bundle.gates},null,2));if(bundle.gates.some(g=>g.results.some(r=>!r.ok)))process.exitCode=1;}
