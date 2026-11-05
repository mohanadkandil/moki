import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { convertRawEasyEdaToTs, fetchEasyEDAComponent } from 'easyeda';
const id=process.argv[2]; if(!/^C[1-9][0-9]{1,11}$/.test(id??''))throw new Error('Provide a real LCSC number');
const directory=resolve(process.argv[3]??`blocks/parts/${id}`);await mkdir(directory,{recursive:true});
const started=performance.now();const url=`https://jlcsearch.tscircuit.com/api/easyeda_components/${id}`;
const response=await fetch(url);let raw:any;
if(response.ok){const body=await response.text();await writeFile(resolve(directory,'catalog-response.json'),body);const j=JSON.parse(body);raw=j.easyeda_component_details.easyeda_json;}
else {await writeFile(resolve(directory,'cache-error.json'),JSON.stringify({url,status:response.status}));raw=await fetchEasyEDAComponent(id,{includeModelMetadata:true});}
await writeFile(resolve(directory,'raw.json'),JSON.stringify(raw,null,2));
const tsx=await convertRawEasyEdaToTs({rawEasy:raw});await writeFile(resolve(directory,'part.tsx'),tsx);
const sha256=(s:string)=>createHash('sha256').update(s).digest('hex');
const receipt={lcsc:id,url,fetchedAt:new Date().toISOString(),importer:'easyeda@0.0.391',rawSha256:sha256(JSON.stringify(raw)),tsxSha256:sha256(tsx),ms:performance.now()-started};
await writeFile(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
