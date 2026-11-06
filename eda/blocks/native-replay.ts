/** Private offline reuse of captured native routing. This loads no prior gates
 * and changes no route record. The caller must materialize fresh native Cu,
 * pours, source/placement/DRC/physical/fabrication and compile gates. */
import {readFile,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,dirname,resolve} from 'node:path';

export const NATIVE_REPLAY_ARTIFACTS = [
  'plan.json','plan-graph.json','import-map.json','placement.json',
  'clock-phase.json','native-exit-phase.json',
] as const;
// router-input.json is compared separately with the actual current callback SRJ.
const MAX_BYTES = 128*1024*1024;
// The pinned public Pipeline9 has25stages; index25 is reached only after
// its final power-expansion stage completes. Other engines cannot use this fallback.
const COMPLETED_PIPELINE9_PHASE_INDEX = 25;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const digest=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');

/** Canonical JSON preserves array order and exact finite numeric values. Optional
 * undefined object fields are omitted exactly as in native JSON capture files. */
function canonical(value:any,arrayEntry=false):string {
  if(value===undefined){if(arrayEntry)return'null';throw Error('Native replay expected JSON data');}
  if(value===null)return'null';
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Native replay nonfinite JSON number');return JSON.stringify(value);}
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(Array.isArray(value))return'['+Array.from(value,v=>canonical(v,true)).join(',')+']';
  if(!object(value))throw Error('Native replay expected plain JSON data');
  return'{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const nativeReplayInputSha256=(value:unknown):string=>digest(canonical(value));
export interface NativeReplayManifest {
  sourceJobDir:string; outputPath:string; outputSha256:string; inputSha256:string;
}
export interface NativeReplayReceipt {
  schema:'moki.native-output-reuse/1'; freshRouting:false; nativeOutputReuse:true;
  execution:'captured-native-output'; sourceJobId:string; sourceJobDir:string;
  currentJobId:string; manifestSha256:string; inputSha256:string; outputSha256:string;
  sourceCaptureSha256:string; sourceCaptureKind:'pre-pour-circuit'|'completed-native-srj'; artifactSha256:Record<string,string>;
  traceCount:number; minimumWireWidthMm:number; freshGatesMandatory:true;
}
async function read(path:string) {
  if((await stat(path)).size>MAX_BYTES)throw Error('Native replay artifact exceeds size limit: '+basename(path));
  const bytes=await readFile(path);
  if(bytes.length>MAX_BYTES)throw Error('Native replay artifact exceeds size limit: '+basename(path));
  let value:any;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Native replay invalid JSON: '+basename(path));}
  // Reject non-JSON numeric payloads before using any data in a receipt.
  const hash=nativeReplayInputSha256(value);
  return{value,canonicalHash:hash,rawHash:digest(bytes)};
}
export async function loadNativeReplay(manifestPath:string,currentJobDir:string,plannedSRJ:any):Promise<{traces:any[];receipt:NativeReplayReceipt}> {
  const manifestFile=await realpath(resolve(manifestPath));
  const loaded=await read(manifestFile),manifest=loaded.value;
  if(!object(manifest)||Object.keys(manifest).sort().join(',')!==['inputSha256','outputPath','outputSha256','sourceJobDir'].join(',')||!['sourceJobDir','outputPath'].every(k=>typeof manifest[k]==='string'&&manifest[k].length>0)||!['inputSha256','outputSha256'].every(k=>typeof manifest[k]==='string'&&/^[a-f0-9]{64}$/.test(manifest[k])))throw Error('Native replay manifest shape or hash is invalid');
  const sourceJobDir=await realpath(resolve(dirname(manifestFile),manifest.sourceJobDir));
  const targetJobDir=await realpath(resolve(currentJobDir));
  const outputPath=await realpath(resolve(dirname(manifestFile),manifest.outputPath));
  const sourceInput=await read(resolve(sourceJobDir,'router-input.json'));
  const inputSha256=nativeReplayInputSha256(plannedSRJ);
  if(inputSha256!==manifest.inputSha256||sourceInput.canonicalHash!==manifest.inputSha256)throw Error('Native replay planned SRJ differs from exact source input fingerprint');
  const comparisons=await Promise.all(NATIVE_REPLAY_ARTIFACTS.map(async name=>{
    const [source,current]=await Promise.all([read(resolve(sourceJobDir,name)),read(resolve(targetJobDir,name))]);
    if(source.canonicalHash!==current.canonicalHash)throw Error('Native replay artifact mismatch: '+name);
    return[name,source.canonicalHash] as const;
  }));
  const sourceJob=await read(resolve(sourceJobDir,'job.json'));
  if(!object(sourceJob.value)||sourceJob.value.status!=='failed'||typeof sourceJob.value.error!=='string'||!sourceJob.value.error)throw Error('Native replay source must identify the failed post-routing capture job');
  let capture:Awaited<ReturnType<typeof read>>,sourceCaptureKind:NativeReplayReceipt['sourceCaptureKind']='pre-pour-circuit';
  let completedTraces:any[]|undefined;
  try {
    capture=await read(resolve(sourceJobDir,'pre-pour-circuit.json'));
    if(!Array.isArray(capture.value)||!capture.value.some(e=>e?.type==='pcb_trace')||capture.value.some(e=>['pcb_autorouting_error','pcb_native_async_error'].includes(e?.type)))throw Error('Native replay source lacks completed pre-pour native copper capture');
  } catch(error) {
    // A malformed/present capture never falls back. This path exists only for
    // native completion followed by failure of our *outer* hard width repair,
    // before Core was handed any output to materialize or pour.
    if((error as NodeJS.ErrnoException)?.code!=='ENOENT')throw error;
    const [router,asyncErrors]=await Promise.all([read(resolve(sourceJobDir,'router-error.json')),read(resolve(sourceJobDir,'native-async-errors.json'))]);
    const match=typeof router.value?.error==='string'?/^Error: Native width expansion leaves ([0-9.eE+\-]+)mm below required ([0-9.eE+\-]+)mm$/.exec(router.value.error):null;
    const actual=Number(match?.[1]),required=Number(match?.[2]);
    const widthMessage=match?router.value.error.slice('Error: '.length):'';
    if(!match||!finite(actual)||actual<=0||!finite(required)||required!==sourceInput.value.minTraceWidth||actual>=required-1e-9||
      router.value.phaseIndex!==COMPLETED_PIPELINE9_PHASE_INDEX||router.value.phase!==undefined||!object(router.value.phaseTimesMs)||
      !finite(router.value.phaseTimesMs.powerTraceExpansionSolver)||router.value.phaseTimesMs.powerTraceExpansionSolver<0||
      Object.values(router.value.phaseTimesMs).some(t=>!finite(t)||t<0)||
      !(sourceJob.value.error==='drc: '+widthMessage||sourceJob.value.error.startsWith('drc: '+widthMessage+';'))||
      !object(asyncErrors.value)||asyncErrors.value.ok!==false||!Array.isArray(asyncErrors.value.errors)||asyncErrors.value.errors.length!==1||asyncErrors.value.errors[0]!==router.value.error)
      throw Error('Native replay source does not prove completed Pipeline9 followed only by outer width failure');
    capture=await read(resolve(sourceJobDir,'native-before-width.json'));
    if(!object(capture.value)||!Array.isArray(capture.value.traces)||!capture.value.traces.length||!Array.isArray(capture.value.obstacles)||!Array.isArray(sourceInput.value.obstacles)||capture.value.obstacles.length!==sourceInput.value.obstacles.length)
      throw Error('Native replay completed native SRJ is malformed');
    const normalized=structuredClone(capture.value);
    const stack=sourceInput.value.layerCount===4?['top','inner1','inner2','bottom']:['top','bottom'];
    for(let i=0;i<normalized.obstacles.length;i++){
      const obstacle=normalized.obstacles[i],original=sourceInput.value.obstacles[i];
      if(!object(obstacle)||!object(original)||!Array.isArray(obstacle.layers)||obstacle.layers.some((l:any)=>!stack.includes(l)))throw Error('Native replay completed SRJ obstacle layers are malformed');
      // Official preprocessing adds these cache fields only. They are accepted
      // solely as the exact physical-layer indices, never a geometry override.
      for(const key of ['zLayers','__zLayers'])if(!Object.hasOwn(original,key)&&Object.hasOwn(obstacle,key)){
        if(canonical(obstacle[key])!==canonical(obstacle.layers.map((l:string)=>stack.indexOf(l))))throw Error('Native replay completed SRJ has conflicting cached layers');
        delete obstacle[key];
      }
    }
    normalized.traces=sourceInput.value.traces;
    if(nativeReplayInputSha256(normalized)!==sourceInput.canonicalHash)throw Error('Native replay completed SRJ differs from exact native source input');
    validateNativeTraces(capture.value.traces,plannedSRJ,false);
    completedTraces=capture.value.traces;
    sourceCaptureKind='completed-native-srj';
  }
  const output=await read(outputPath);
  if(output.rawHash!==manifest.outputSha256)throw Error('Native replay output hash differs from manifest');
  const traces=output.value;
  const minimumWireWidthMm=validateNativeTraces(traces,plannedSRJ,true);
  if(completedTraces){
    const names=(ts:any[])=>ts.map(t=>[t.pcb_trace_id,t.connection_name]);
    if(canonical(names(traces))!==canonical(names(completedTraces)))throw Error('Native replay candidate differs from completed native trace identity/coverage');
  }
  return{traces,receipt:{schema:'moki.native-output-reuse/1',freshRouting:false,nativeOutputReuse:true,execution:'captured-native-output',sourceJobId:basename(sourceJobDir),sourceJobDir,currentJobId:basename(targetJobDir),manifestSha256:loaded.rawHash,inputSha256,outputSha256:output.rawHash,sourceCaptureSha256:capture.rawHash,sourceCaptureKind,artifactSha256:Object.fromEntries(comparisons),traceCount:traces.length,minimumWireWidthMm,freshGatesMandatory:true}};
}

/** Validate captured actual native records without changing them. A source
 * snapshot may be subminimum; every replay candidate must meet the floor. */
function validateNativeTraces(traces:any,plannedSRJ:any,requireFloor:boolean):number {
  if(!object(plannedSRJ)||![2,4].includes(plannedSRJ.layerCount)||!finite(plannedSRJ.minTraceWidth)||plannedSRJ.minTraceWidth<=0||!Array.isArray(plannedSRJ.connections)||!plannedSRJ.connections.length)throw Error('Native replay requires actual two/four-layer SRJ and positive board minimum');
  const layers=new Set(plannedSRJ.layerCount===4?['top','inner1','inner2','bottom']:['top','bottom']);
  const names=new Set<string>();
  for(const connection of plannedSRJ.connections){if(!object(connection)||typeof connection.name!=='string'||!connection.name)throw Error('Native replay source connection name is invalid');names.add(connection.name);}
  if(!Array.isArray(traces)||!traces.length)throw Error('Native replay output must be a nonempty native trace array');
  const ids=new Set<string>();let minimumWireWidthMm=Infinity;
  for(const trace of traces){
    if(!object(trace)||trace.type!=='pcb_trace'||typeof trace.pcb_trace_id!=='string'||!trace.pcb_trace_id||trace.pcb_trace_id.includes('saved_phase_')||ids.has(trace.pcb_trace_id)||typeof trace.connection_name!=='string'||!names.has(trace.connection_name))throw Error('Native replay trace identity, uniqueness or source connection differs');
    ids.add(trace.pcb_trace_id);
    if(!Array.isArray(trace.route)||trace.route.length<2)throw Error('Native replay trace route is missing');
    let wires=0;
    for(const point of trace.route){
      if(!object(point)||!finite(point.x)||!finite(point.y))throw Error('Native replay route coordinate is nonfinite');
      if(point.route_type==='wire'){
        if(!layers.has(point.layer)||!finite(point.width)||point.width<=0||(requireFloor&&point.width<plannedSRJ.minTraceWidth-1e-9))throw Error('Native replay wire layer or fabrication minimum width is invalid');
        minimumWireWidthMm=Math.min(minimumWireWidthMm,point.width);wires++;
      }else if(point.route_type==='via'){
        if(!layers.has(point.from_layer)||!layers.has(point.to_layer)||point.from_layer===point.to_layer||point.via_diameter!==.6||point.via_hole_diameter!==.3)throw Error('Native replay route via layer/dimensions are invalid');
        if(point.layers!==undefined&&(!Array.isArray(point.layers)||!point.layers.length||point.layers.some((l:any)=>!layers.has(l))))throw Error('Native replay route via has unknown physical layers');
      }else throw Error('Native replay supports only actual wire/via route records');
    }
    if(!wires)throw Error('Native replay trace has no wire copper');
  }
  return minimumWireWidthMm;
}
