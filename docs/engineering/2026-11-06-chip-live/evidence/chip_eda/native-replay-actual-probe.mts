// Actual-file loader validation only. No materialization, solver or gate run.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {loadNativeReplay,nativeReplayInputSha256} from '../../../../../eda/blocks/native-replay.js';
const sourceJobDir=resolve('var/board-jobs-test-chip/134193af-e7d3-4376-8a28-1979f18628bd');
const outputPath=resolve('docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/actual-134-width-fabrication/width-native.json');
const input=JSON.parse(await readFile(join(sourceJobDir,'router-input.json'),'utf8'));
const output=await readFile(outputPath),directory=await mkdtemp(join(tmpdir(),'moki-actual-replay-validation-'));
try{
 const manifestPath=join(directory,'manifest.json');
 await writeFile(manifestPath,JSON.stringify({sourceJobDir,outputPath,inputSha256:nativeReplayInputSha256(input),outputSha256:createHash('sha256').update(output).digest('hex')}));
 // Same directory is intentional for this read-only smoke, not a fresh job.
 const {traces,receipt}=await loadNativeReplay(manifestPath,sourceJobDir,input);
 const report={validationOnly:true,currentDirectoryIsSourceForSmoke:true,traceCount:traces.length,receipt,freshNativeGatesRun:false};
 await writeFile(new URL('./native-replay-actual-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({validationOnly:true,traceCount:traces.length,minimumWireWidthMm:receipt.minimumWireWidthMm,inputSha256:receipt.inputSha256,outputSha256:receipt.outputSha256,freshNativeGatesRun:false}));
}finally{await rm(directory,{recursive:true,force:true});}
