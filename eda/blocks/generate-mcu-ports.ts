/** Append application-port revisions without regenerating or replacing older seed records. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {materializeDraft} from '../../src/blocks/library.js';
import type {BlockDef,BlockDraft} from '../../src/blocks/contract.js';
export function withS3ApplicationPorts(base:BlockDef):BlockDef {
  if(base.id!=='esp32-s3-core'||base.version!==1||!base.mcu)throw new Error('Expected immutable S3 core revision1');
  const {contentHash:_hash,status:_status,provenance,...fields}=structuredClone(base);
  const draft:BlockDraft={...fields,version:2,provenance:{author:provenance.author,...(provenance.authorId?{authorId:provenance.authorId}:{})}};
  const leased=new Set(draft.ports.flatMap(p=>p.bus?Object.values(p.bus.signals):p.terminal?[p.terminal]:[]).flatMap(t=>t.startsWith('net:')?draft.nets.find(n=>n.name===t.slice(4))?.pins??[]:[t]));
  for(const p of draft.mcu!.pins){
    if(typeof p.gpio!=='number'||p.reserved||p.fixedFunction||leased.has(p.id))continue;
    draft.ports.push({id:`IO${p.gpio}`,label:`GPIO${p.gpio}${p.caps.includes('adc')?' / ADC':''}${p.caps.includes('pwm')?' / PWM':''}`,kind:p.caps.includes('adc')?'analog':'gpio',terminal:p.id,volts:{min:0,max:3.6}});
  }
  draft.firmware!.usage+=' Application IO ports preserve their physical digital input/output/PWM capabilities; analog identifies ADC capability, not a DAC. GPIO8/9 remain assigned to I2C. ADC range/attenuation and source impedance require application configuration.';
  return materializeDraft(draft);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const path=resolve('src/blocks/data/seed.json'),defs:BlockDef[]=JSON.parse(readFileSync(path,'utf8'));
 const next=withS3ApplicationPorts(defs.find(b=>b.id==='esp32-s3-core'&&b.version===1)!);
 const exists=defs.find(b=>b.id===next.id&&b.version===next.version);
 if(exists&&exists.contentHash!==next.contentHash)throw new Error('Immutable revision already differs');
 if(!exists){defs.push(next);writeFileSync(path,JSON.stringify(defs,null,2)+'\n');}
 console.log(`${next.id}@${next.version} ${next.contentHash}`);
}
