// Private offline native reroute in an exact input frame. No models, source
// generation, geometry edits or fabrication/gate receipts are reused.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chipAutorouter} from './router.js';
import {nativeReplayInputSha256} from './native-replay.js';
import {toolVersions} from '../versions.js';
const source=resolve(process.argv[2]!),out=resolve(process.argv[3]!),quarter=Number(process.argv[4]);
if(!Number.isInteger(quarter)||quarter<0||quarter>3)throw Error('Expected cardinal quarter0–3');
await mkdir(out,{recursive:true});
const save=(name:string,value:any)=>writeFile(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const input=JSON.parse(await readFile(resolve(source,'router-input.json'),'utf8'));
const versions=await toolVersions(),at=performance.now();
await save('source.json',{source,inputSha256:nativeReplayInputSha256(input),quarter,modelCalls:0,toolVersions:versions,acceptance:false,freshNativeRouting:true});
let adapter:Awaited<ReturnType<typeof chipAutorouter>>|undefined;
try {
 adapter=await chipAutorouter(input,{engine:'pipeline9',frameQuarterTurns:quarter as 0|1|2|3,minimumWidthsOnly:true,widthRules:{traceToPad:.127,traceToTrace:.127,viaToPad:.127},onFrame:e=>save('actual-frame-input.json',e),onFailure:e=>save('native-error.json',e),onNativeSolved:e=>save('native-before-width.json',e),onWidths:e=>save('width-audit.json',e)});
 await adapter.run();const output=adapter.getOutputSimpleRouteJson();
 const raw=JSON.stringify(output.traces);await writeFile(resolve(out,'native-traces.json'),raw);
 await save('result.json',{status:'native-completed',ms:performance.now()-at,traceCount:output.traces.length,inputSha256:nativeReplayInputSha256(input),outputSha256:createHash('sha256').update(raw).digest('hex'),wholeBoardGatesRun:false,accepted:false});
 console.log(JSON.stringify({status:'native-completed',ms:performance.now()-at,traces:output.traces.length}));
} catch(error){await save('result.json',{status:'failed',ms:performance.now()-at,error:String(error),accepted:false});console.error(error);process.exitCode=2;}finally{adapter?.stop();}
