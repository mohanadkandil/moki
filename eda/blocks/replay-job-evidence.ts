// Offline exact-plan replay through the real job service. Never calls an agent/model.
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createBoardService} from '../../server/board-api.js';
import {checkSchematicReview,schematicHash} from '../../src/blocks/review.js';
const source=resolve(process.argv[2]!),evidence=resolve(process.argv[3]!);
const timeoutMs=Number(process.argv[4]??240000);
if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw new Error('Offline replay timeout must be1000–600000ms');
await mkdir(evidence,{recursive:true});
const raw=await readFile(resolve(source,'plan.json'),'utf8'),plan=JSON.parse(raw);
const base=JSON.parse(await readFile(resolve(source,'job.json'),'utf8'));
assert.equal(base.input.kind,'plan');assert.deepEqual(plan,base.input.plan);
const review=checkSchematicReview(plan);if(!review.ok)throw new Error('Existing live schematic review receipt is unavailable; refusing to manufacture one');
await writeFile(resolve(evidence,'plan.json'),raw);
await writeFile(resolve(evidence,'source.json'),JSON.stringify({baseJobId:base.jobId,source,sourcePlanSha256:createHash('sha256').update(raw).digest('hex'),schematicHash:schematicHash(plan),exactOriginalPlan:true,modelCalls:0,timeoutMs},null,2)+'\n');
// A private offline worker override. Public job submissions cannot set this flag.
const nativePadEscape=process.argv.includes('--rp-native-pad-escape');
const lockPadNets=process.argv.includes('--lock-native-pad-nets');
const nativeOwnerGuard=process.argv.includes('--native-owner-guard');
const nativeClearanceFloor=process.argv.includes('--native-clearance-floor');
const nativeClockPreloads=process.argv.includes('--native-clock-preloads');
const nativeClockRefinement=process.argv.includes('--native-clock-refinement');
const nativeGroundEscapes=process.argv.includes('--native-ground-escapes');
const nativeFullExpansion=process.argv.includes('--native-full-expansion');
const nativeLegacySections=process.argv.includes('--native-legacy-sections');
const nativeClockOnly=process.argv.includes('--native-clock-only');
const nativeFrame=process.argv.filter(a=>a.startsWith('--native-frame='));
if(nativeFrame.length>1||nativeFrame.some(a=>!/^--native-frame=[0-3]$/.test(a)))throw Error('Invalid private native frame');
const nativeReplayManifest=process.argv[5]&&!process.argv[5].startsWith('--')?resolve(process.argv[5]):undefined;
let replayBun:string|undefined;
if(nativeReplayManifest||nativePadEscape||nativeFrame.length||lockPadNets||nativeOwnerGuard||nativeClearanceFloor||nativeClockPreloads||nativeClockRefinement||nativeGroundEscapes||nativeFullExpansion||nativeLegacySections||nativeClockOnly){
 replayBun=resolve(evidence,'bun-with-native-replay.sh');
 const quote=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 const actualBun=resolve(process.env.MOKI_BUN??resolve(homedir(),'.bun/bin/bun'));
 const build=resolve('eda/blocks/build.ts');
 await writeFile(replayBun,`#!/bin/sh
case "$1" in
${quote(build)}) exec ${quote(actualBun)} "$@" ${nativeReplayManifest ? '--native-replay '+quote(nativeReplayManifest) : ''} ${nativePadEscape ? '--rp-native-pad-escape' : ''} ${nativeFrame.map(quote).join(' ')} ${lockPadNets ? '--lock-native-pad-nets' : ''} ${nativeOwnerGuard ? '--native-owner-guard' : ''} ${nativeClearanceFloor ? '--native-clearance-floor' : ''} ${nativeClockPreloads ? '--native-clock-preloads' : ''} ${nativeClockRefinement ? '--native-clock-refinement' : ''} ${nativeGroundEscapes ? '--native-ground-escapes' : ''} ${nativeFullExpansion ? '--native-full-expansion' : ''} ${nativeLegacySections ? '--native-legacy-sections' : ''} ${nativeClockOnly ? '--native-clock-only' : ''} ;;
*) exec ${quote(actualBun)} "$@" ;;
esac
`);
 await chmod(replayBun,0o700);
 await writeFile(resolve(evidence,'native-replay-manifest-path.json'),JSON.stringify({manifest:nativeReplayManifest,nativePadEscape,nativeFrame,lockPadNets,nativeOwnerGuard,nativeClearanceFloor,nativeClockPreloads,nativeClockRefinement,nativeGroundEscapes,nativeFullExpansion,nativeLegacySections,nativeClockOnly,privateOfflineOverride:true})+'\n');
}
const service=createBoardService({...(replayBun?{bun:replayBun}:{}),jobsRoot:resolve('var/board-jobs-test-chip'),allowSource:false,timeoutMs});
try{
 const job=await service.submit({plan});assert.equal(job.input.kind,'plan');
 if(job.input.kind!=='plan')throw new Error('Expected chip plan replay');assert.deepEqual(job.input.plan,plan);
 await writeFile(resolve(evidence,'job-id.json'),JSON.stringify({jobId:job.jobId,jobRoot:service.jobsRoot},null,2)+'\n');
 console.log('JOB',job.jobId);await service.idle();const done=await service.load(job.jobId);
 await writeFile(resolve(evidence,'job.json'),JSON.stringify(done,null,2)+'\n');
 console.log(JSON.stringify({jobId:job.jobId,status:done?.status,error:done?.error,totalMs:done?.totalMs,board:done?.board,gates:done?.gates?.map(g=>({gate:g.gate,ok:g.ok}))}));
 if(done?.status!=='done')process.exitCode=2;
}finally{await service.close();}
