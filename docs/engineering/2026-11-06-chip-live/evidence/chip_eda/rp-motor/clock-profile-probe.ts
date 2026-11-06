// Pure profile probe against actual imported native geometry; no routing or render.
import {readFileSync,writeFileSync}from'node:fs';
import {createRpClockPhase}from'../../../../../../eda/blocks/rp-clock.ts';
const root=new URL('./',import.meta.url),read=(n:string)=>JSON.parse(readFileSync(new URL(n,root),'utf8'));
const c=read('clock-fixture-circuit.json'),g=read('clock-fixture-graph.json');
const map=JSON.parse(readFileSync('var/board-jobs-test-chip/5d729e88-d4d0-4a62-91b0-f912d5986b4b/import-map.json','utf8'));
try{const result=createRpClockPhase(c,g,Object.fromEntries(map.parts.map((p:any)=>[p.ref,p.pins])));console.log(JSON.stringify(result.lengthsByNet));writeFileSync(new URL('clock-profile-probe.json',root),JSON.stringify(result,null,2)+'\n');}catch(error){console.error(String(error));process.exitCode=2;}
