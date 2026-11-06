/** Immutable USBLC6 bypass revision from ST DS4260 Rev7 p11 Fig17. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getBlock,materializeDraft} from '../../src/blocks/library.js';
import type {BlockDef,BlockDraft} from '../../src/blocks/contract.js';
export function withUsbBypass(base:BlockDef):BlockDef {
 if(base.id!=='usb-c-sink'||base.version!==1)throw Error('Expected immutable USB sink revision1');
 const {contentHash:_hash,status:_status,provenance,...fields}=structuredClone(base);
 const d:BlockDraft={...fields,version:2,provenance:{author:provenance.author,...provenance.authorId?{authorId:provenance.authorId}:{}}};
 const reference={url:'https://www.st.com/resource/en/datasheet/usblc6-2.pdf',pages:'11',note:'ST DS4260 Rev7, Figure17 USBLC6-2 PCB layout considerations: C_BUS100nF from pin5 VBUS to pin2/GND. Place beside the protection IC with short connections; the compiler4mm origin-distance limit is an author placement screen, not ESD qualification.'};
 const source=getBlock('esp32-s3-core',1)!.parts.find(p=>p.lcsc==='C14663'&&p.value==='100nF')!;if(!source)throw Error('Missing exact catalog-bound100nF');
 const esd=d.parts.find(p=>p.lcsc==='C7519'&&p.mpn==='USBLC6-2SC6')!;if(!esd)throw Error('Missing exact protection IC');
 const cap={...structuredClone(source),ref:'C_BUS',at:{x:esd.at.x+3.5,y:esd.at.y},datasheet:reference,valueWhy:reference};
 d.parts.push(cap);d.nets.find(n=>n.name==='VBUS')!.pins.push('C_BUS.1');d.nets.find(n=>n.name==='GND')!.pins.push('C_BUS.2');
 esd.pins['5']={...esd.pins['5']!,role:'power-in',required:true,volts:{min:4.75,max:5.25}};
 d.constraints.push({kind:'decoupling',ic:esd.ref,powerPin:'5',groundPin:'2',caps:['C_BUS'],minUf:.1,maxDistanceMm:4,citation:reference});
 return materializeDraft(d);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const path='src/blocks/data/seed.json',defs:BlockDef[]=JSON.parse(readFileSync(path,'utf8')),b=withUsbBypass(getBlock('usb-c-sink',1)!);
 const old=defs.find(x=>x.id===b.id&&x.version===2);if(old&&old.contentHash!==b.contentHash)throw Error('Immutable revision conflict');if(!old)defs.push(b);writeFileSync(path,JSON.stringify(defs,null,2)+'\n');console.log(`${b.id}@${b.version} ${b.contentHash}`);
}
