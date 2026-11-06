import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as math from '../eda/node_modules/@tscircuit/math-utils/dist/index.js';
import * as connectivity from '../eda/node_modules/circuit-json-to-connectivity-map/dist/index.js';
import { checkEachPcbTraceNonOverlapping } from '../eda/node_modules/@tscircuit/checks/dist/index.js';
import { OWNER_GUARD_ORIGINAL, OWNER_GUARD_REPLACEMENT, OWNER_GUARD_MARKER_ORIGINAL, OWNER_GUARD_MARKER_REPLACEMENT, OWNER_GUARD_MARKER_HELPER, OWNER_GUARD_UPSTREAM_SHA256, OWNER_GUARD_SDK_VERSION, NATIVE_CLEARANCE_PATCHES, nativeClearanceHelperSource, patchNativeOwnerGuardBundle, prepareNativeOwnerGuardModule, loadNativeOwnerGuard } from '../eda/blocks/native-owner-guard.js';

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const sdk = new URL('../eda/node_modules/@tscircuit/capacity-autorouter/dist/index.js', import.meta.url);
const source = readFileSync(sdk, 'utf8'), mapBytes = readFileSync(new URL('./index.js.map', sdk)), sourceMap = JSON.parse(mapBytes.toString('utf8'));
const fixture = JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/native-owner-guard-fixture.json', import.meta.url), 'utf8'));
assert.equal(sha(mapBytes), '512aa13e0cf7fcb8106877d2d15732f41668fb7301683ab6109950ecd364590c');
const primary = (key: string): string => {
  const i = sourceMap.sources.indexOf(key); assert.ok(i >= 0, key); return sourceMap.sourcesContent[i];
};
function compile(key: string, dependencies: Record<string, any>, override?: string) {
  const js = ts.transpileModule(override ?? primary(key), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'exports', 'module', js)((name: string) => { assert.ok(name in dependencies, 'Unexpected primary import ' + name); return dependencies[name]; }, module.exports, module);
  return module.exports;
}
// Complete native converter and all its original helper bodies. The only
// counterfactual is the same source predicate represented by the pinned bundle
// literal. Real native math/connectivity/DRC libraries, no router instantiated.
const layers = compile('../lib/utils/connection-point-utils.ts', {}), z = compile('../lib/utils/mapLayerNameToZ.ts', {}), mapz = compile('../lib/utils/mapZToLayerName.ts', {}), repairz = compile('../node_modules/high-density-repair03/lib/utils/mapZToLayerName.ts', {});
const vias = compile('../node_modules/high-density-repair03/lib/utils/getViaLayers.ts', { './mapZToLayerName': repairz });
const conn = compile('../lib/utils/getConnectivityMapFromSimpleRouteJson.ts', { './connection-point-utils': layers, 'circuit-json-to-connectivity-map': connectivity, './mapLayerNameToZ': z });
const dims = compile('../lib/utils/getViaDimensions.ts', {}), imported = compile('../lib/utils/getSrjWithImportedPadPortIds.ts', { 'lib/types/srj-types': layers });
const converterKey = '../lib/utils/convertToCircuitJson.ts', originalConverter = primary(converterKey), parsed = ts.createSourceFile('convert.ts', originalConverter, ts.ScriptTarget.Latest, true);
let predicate: ts.ParenthesizedExpression | undefined;
function find(node: ts.Node) {
  if (ts.isParenthesizedExpression(node) && node.getText(parsed).replace(/\s/g, '') === '(connectedPortIds.length===0||obstacle.netIsAssignable||obstacle.connectedTo.some((id)=>connectionReferences.has(id)))') {
    assert.equal(predicate, undefined, 'one exact primary predicate'); predicate = node;
  }
  ts.forEachChild(node, find);
}
find(parsed); assert.ok(predicate);
const guardedConverter = originalConverter.slice(0, predicate.getStart(parsed)) + '(obstacle.connectedTo.some((id) => connectionReferences.has(id)) || ((connectedPortIds.length === 0 || obstacle.netIsAssignable) && obstacle.connectedTo.length === 0))' + originalConverter.slice(predicate.end);
const dependencies = { '@tscircuit/math-utils': math, 'high-density-repair03/lib': vias, 'lib/types/srj-types': layers, 'lib/utils/getConnectivityMapFromSimpleRouteJson': conn, 'lib/utils/getViaDimensions': dims, 'lib/utils/mapZToLayerName': mapz, './getSrjWithImportedPadPortIds': imported };
const converters = [compile(converterKey, dependencies), compile(converterKey, dependencies, guardedConverter)];
function scenario(bound: boolean, assignable: boolean, contact: 'foreign' | 'own' | 'unowned', mst?: '__rootConnectionNames' | '__netConnectionName') {
  const input = structuredClone(fixture.input), ground = input.obstacles[0], signal = input.obstacles[1], connection = input.connections.find((c: any) => c.name === 'source_net_13');
  ground.netIsAssignable = assignable;
  if (contact === 'unowned') ground.connectedTo = [];
  if (!bound) for (const p of connection.pointsToConnect) delete p.pcb_port_id;
  if (mst) {
    connection.name = 'source_net_13_mst0';
    connection[mst] = mst === '__rootConnectionNames' ? ['source_net_13'] : 'source_net_13';
    if (!bound) connection.pointsToConnect.forEach((p: any, i: number) => { p.pointId = `saved_phase_control_${i}_exit`; });
  }
  const terminal = connection.pointsToConnect.at(-1), end = contact === 'own' ? signal.center : { x: ground.center.x + .3, y: ground.center.y + .2 };
  const start = contact === 'own' ? connection.pointsToConnect[0] : terminal;
  const route = { type: 'pcb_trace', pcb_trace_id: 'DERIVED_ENDPOINT_CONTACT_CONTROL', connection_name: connection.name, connectsTo: connection.pointsToConnect.map((p: any) => p.pointId ?? p.pcb_port_id), route: [{ route_type: 'wire', x: start.x, y: start.y, width: .15, layer: 'top' }, { route_type: 'wire', x: end.x, y: end.y, width: .15, layer: 'top' }] };
  const before = structuredClone({ input, route });
  const outputs = converters.map(c => c.convertToCircuitJson(input, [route], { originalSrj: input, includeOriginalConnections: true }));
  assert.deepEqual({ input, route }, before);
  const owners = outputs.map(cj => {
    const trace = cj.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === route.pcb_trace_id);
    assert.ok(trace); const owner = cj.find((e: any) => e.type === 'source_trace' && e.source_trace_id === trace.source_trace_id); assert.ok(owner); return owner;
  });
  return { input, route, outputs, owners };
}

test('pinned bundle changes one source predicate and both runtime marker functions, rejecting changed SDK', () => {
  assert.equal(sha(source), OWNER_GUARD_UPSTREAM_SHA256);
  const patched = patchNativeOwnerGuardBundle(source, OWNER_GUARD_SDK_VERSION);
  assert.equal(patched, source.replace(OWNER_GUARD_ORIGINAL, OWNER_GUARD_REPLACEMENT).split(OWNER_GUARD_MARKER_ORIGINAL).join(OWNER_GUARD_MARKER_REPLACEMENT)+'\n'+OWNER_GUARD_MARKER_HELPER+'\n');
  assert.equal(patched.split(OWNER_GUARD_REPLACEMENT).length - 1, 1);
  assert.equal(patched.includes(OWNER_GUARD_ORIGINAL), false);
  assert.throws(() => patchNativeOwnerGuardBundle(source, '0.0.1038'), /version/);
  assert.throws(() => patchNativeOwnerGuardBundle(source + '\n', OWNER_GUARD_SDK_VERSION), /SHA/);
});

test('complete native converter blocks foreign ownership for zero/one physical ports and either assignability flag', () => {
  for (const bound of [false, true]) for (const assignable of [false, true]) {
    const { owners, outputs, route } = scenario(bound, assignable, 'foreign');
    assert.equal(owners[0].connected_source_net_ids.includes('source_net_4'), !bound || assignable);
    assert.equal(owners[1].connected_source_net_ids.includes('source_net_4'), false);
    // Isolate the source predicate with the native public pre-annotation map.
    // The checker's own endpoint inference is a separate known limitation.
    const checked = outputs.map(cj => {
      const copy = structuredClone(cj), connMap = connectivity.getFullConnectivityMapFromCircuitJson(copy);
      return checkEachPcbTraceNonOverlapping(copy, { connMap });
    });
    assert.ok(checked[1]!.some((e: any) => e.pcb_trace_id === route.pcb_trace_id), 'declared native source map preserves the foreign-pad contact');
    if (!bound || assignable) assert.equal(checked[0]!.length, 0, 'original source inference hid that physical contact');
  }
});

test('unchanged external root checker retains its endpoint-inference limitation', () => {
  for (const bound of [false, true]) {
    const { outputs, owners, route } = scenario(bound, false, 'foreign');
    assert.equal(owners[1].connected_source_net_ids.includes('source_net_4'), false);
    const trace = outputs[1].find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === route.pcb_trace_id);
    assert.equal(trace.route.at(-1).end_pcb_port_id, undefined);
    assert.deepEqual(checkEachPcbTraceNonOverlapping(outputs[1]), []);
    assert.equal(trace.route.at(-1).end_pcb_port_id, 'pcb_port_56', 'default native checker adds a foreign marker before connectivity');
  }
});

test('private utility registry chunk is immutable and a corrupt cached copy fails closed', async () => {
  const temp=await mkdtemp(resolve(tmpdir(),'moki-owner-utility-integrity-'));
  try {
    const prepared=await prepareNativeOwnerGuardModule(temp), utility=prepared.audit.utilityIsolation;
    const chunk=resolve(utility.directory,'chunk-FCNBEO2E.js');
    await writeFile(chunk,(await readFile(chunk,'utf8'))+'\n// DERIVED CORRUPTION');
    await assert.rejects(prepareNativeOwnerGuardModule(temp),/cached module/);
    assert.equal(sha(await readFile(new URL('../eda/node_modules/@tscircuit/solver-utils/dist/chunk-FCNBEO2E.js',import.meta.url))),'af1bc555661669f65a26d5973e1faf7de9688004843f4b3270c522c1f09f2de7');
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('complete native converter preserves explicit own-owner and unowned controls without any Cu change', () => {
  for (const bound of [false, true]) for (const assignable of [false, true]) for (const contact of ['own', 'unowned'] as const) {
    const { outputs } = scenario(bound, assignable, contact);
    assert.deepEqual(outputs[1], outputs[0]);
  }
});

test('canonical native MST root references preserve own aliases and never authorize foreign endpoints', () => {
  for (const field of ['__rootConnectionNames', '__netConnectionName'] as const) for (const bound of [false, true]) {
    const own = scenario(bound, false, 'own', field);
    assert.deepEqual(own.outputs[1], own.outputs[0]);
    assert.ok(own.owners[1].connected_source_net_ids.includes('source_net_13'));
    const foreign = scenario(bound, true, 'foreign', field);
    assert.equal(foreign.owners[1].connected_source_net_ids.includes('source_net_4'), false);
    assert.ok(foreign.owners[0].connected_source_net_ids.includes('source_net_4'));
  }
});

test('private copy relocates only pinned imports, verifies cache bytes and leaves installed SDK unchanged', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'moki-owner-guard-'));
  try {
    const prepared = await prepareNativeOwnerGuardModule(temp), again = await prepareNativeOwnerGuardModule(temp);
    assert.deepEqual(again, prepared);
    const bytes = await readFile(new URL(prepared.moduleUrl), 'utf8');
    assert.equal(sha(bytes), prepared.audit.loadedModuleSha256);
    assert.equal(prepared.audit.predicateReplacementCount, 1);
    assert.deepEqual(prepared.audit.dependencyRelocations.map(d => [d.specifier, d.replacements]), [['./chunk-G3PMV62Z.js', 1], ['@tscircuit/solver-utils', 92], ['object-hash', 3]]);
    let restored = bytes;
    for (const d of prepared.audit.dependencyRelocations) restored = restored.split('from' + JSON.stringify(d.url)).join('from' + JSON.stringify(d.specifier));
    assert.equal(restored, patchNativeOwnerGuardBundle(source, OWNER_GUARD_SDK_VERSION));
    const loaded = await loadNativeOwnerGuard(temp);
    assert.equal(typeof loaded.Pipeline9, 'function');
    assert.deepEqual(Object.keys(loaded).sort(), ['Pipeline9', 'audit']);
    assert.equal(prepared.audit.markerReplacementCount, 2);
    assert.equal(prepared.audit.markerHelperInjectionCount, 1);
    const isolated = prepared.audit.utilityIsolation;
    assert.equal(isolated.version, '0.0.23');
    assert.equal(isolated.files.length, 2);
    assert.equal(isolated.files[1]!.sourceSha256, isolated.files[1]!.copiedSha256, 'registry chunk unchanged');
    await writeFile(fileURLToPath(prepared.moduleUrl), bytes + '\n// DERIVED cache corruption');
    await assert.rejects(prepareNativeOwnerGuardModule(temp), /cached module/);
    await assert.rejects(prepareNativeOwnerGuardModule(fileURLToPath(new URL('.', sdk))), /installed dependencies/);
    assert.equal(sha(await readFile(sdk)), OWNER_GUARD_UPSTREAM_SHA256);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('original tscircuit SDK and private Pipeline9 coexist in one process without registry override', async () => {
  const original = await import(new URL('../eda/node_modules/tscircuit/dist/index.js',import.meta.url).href);
  const sdkOriginal = await import(sdk.href);
  assert.equal(typeof original.Circuit, 'function');
  const temp = await mkdtemp(resolve(tmpdir(),'moki-owner-coexist-'));
  try {
    const {Pipeline9} = await loadNativeOwnerGuard(temp);
    const input = {layerCount:2,minTraceWidth:.15,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},obstacles:[],connections:[],traces:[]};
    const guarded = new Pipeline9(structuredClone(input),{cacheProvider:null});
    const unmodified = new sdkOriginal.AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input),{cacheProvider:null});
    assert.equal(guarded.iterations,0); assert.equal(unmodified.iterations,0);
    assert.notEqual(Pipeline9,sdkOriginal.AutoroutingPipelineSolver9_PreloadedTraceGraph);
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('both exact bundled marker bodies suppress only unique declared-owner autofill and preserve all records', async () => {
  // Extract the exact active bundled arrows, not assumed-equivalent primary
  // source-map copies. The complete copied SDK supplies all native closures.
  const parsed = ts.createSourceFile('sdk.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const arrows:string[]=[];
  function visit(n:ts.Node){if(ts.isArrowFunction(n)&&n.getText(parsed).startsWith(OWNER_GUARD_MARKER_ORIGINAL))arrows.push(n.getText(parsed));ts.forEachChild(n,visit);}
  visit(parsed); assert.equal(arrows.length,2); assert.ok(arrows[0]!.includes('YC(')); assert.ok(arrows[1]!.includes('layers.includes'));
  const temp = await mkdtemp(resolve(tmpdir(),'moki-owner-bodies-'));
  try {
    const prepared = await prepareNativeOwnerGuardModule(temp), bytes = await readFile(new URL(prepared.moduleUrl),'utf8');
    const instrumented = bytes + '\nexport const __baselineOld='+arrows[0]+';\nexport const __baselineNative='+arrows[1]+';\nexport const __guardedOld='+arrows[0]!.replace(OWNER_GUARD_MARKER_ORIGINAL,OWNER_GUARD_MARKER_REPLACEMENT)+';\nexport {aR as __guardedNative,iP as __nativeOverlap};\n';
    const url=new URL('./runtime-test.mjs',prepared.moduleUrl);await writeFile(url,instrumented);
    const runtime=await import(url.href);
    const strip=(cj:any[])=>cj.map(e=>e.type==='pcb_trace'?{...e,route:e.route.map((p:any)=>{const q={...p};delete q.start_pcb_port_id;delete q.end_pcb_port_id;return q;})}:e);
    for(const [base,guard]of [[runtime.__baselineOld,runtime.__guardedOld],[runtime.__baselineNative,runtime.__guardedNative]]) {
      for(const bound of [false,true]) {
        const {outputs,route}=scenario(bound,false,'foreign'),before=structuredClone(outputs[1]);
        const baseline=structuredClone(before),guarded=structuredClone(before);base(baseline);guard(guarded);
        assert.equal(baseline.find((e:any)=>e.pcb_trace_id===route.pcb_trace_id).route.at(-1).end_pcb_port_id,'pcb_port_56');
        assert.deepEqual(guarded,before,'declared owners retain literal markers and every record');
        assert.deepEqual(strip(baseline),strip(before));
      }
      const own=scenario(true,false,'own').outputs[1],ownBefore=structuredClone(own);guard(own);assert.deepEqual(own,ownBefore);
      const baseCase=scenario(false,false,'foreign').outputs[1];
      const tr=(cj:any[])=>cj.find((e:any)=>e.type==='pcb_trace'&&e.pcb_trace_id==='DERIVED_ENDPOINT_CONTACT_CONTROL');
      const owner=(cj:any[])=>cj.find((e:any)=>e.type==='source_trace'&&e.source_trace_id===tr(cj).source_trace_id);
      for(const mutate of [
        (cj:any[])=>{tr(cj).source_trace_id='legacy-unknown';},
        (cj:any[])=>{owner(cj).connected_source_port_ids=[];},
        (cj:any[])=>{owner(cj).connected_source_net_ids=[];},
        (cj:any[])=>{owner(cj).connected_source_port_ids=[''];},
        (cj:any[])=>{cj.push(structuredClone(owner(cj)));},
        (cj:any[])=>{const duplicate={...owner(cj),connected_source_net_ids:undefined};cj.push(duplicate);},
      ]){const a=structuredClone(baseCase);mutate(a);const b=structuredClone(a);base(a);guard(b);assert.deepEqual(b,a,'ambiguous or legacy source retains native behavior');}
      const marked=structuredClone(baseCase);tr(marked).route.at(-1).end_pcb_port_id='pcb_port_56';const markedBefore=structuredClone(marked);guard(marked);assert.deepEqual(marked,markedBefore,'existing foreign marker retained, not repaired');
      const free=structuredClone(baseCase);tr(free).route.at(-1).x=50;tr(free).route.at(-1).y=50;
      free.push({...structuredClone(tr(free)),pcb_trace_id:'SAME_SOURCE_FREE_T',route:[{route_type:'wire',x:49,y:50,width:.15,layer:'top'},{route_type:'wire',x:51,y:50,width:.15,layer:'top'}]});
      const freeBefore=structuredClone(free);guard(free);assert.deepEqual(free,freeBefore,'same-source free-space T-junction has no forced port');
      assert.deepEqual(runtime.__nativeOverlap(free),[],'same-source free copper remains legitimate');
    }
    // The actual old native checker now sees the foreign contact rather than
    // inferring a GND end marker before it constructs its connectivity map.
    for(const bound of [false,true]){
      const cj=scenario(bound,false,'foreign').outputs[1];const issues=runtime.__nativeOverlap(cj);
      assert.ok(issues.length>0);assert.equal(cj.find((e:any)=>e.pcb_trace_id==='DERIVED_ENDPOINT_CONTACT_CONTROL').route.at(-1).end_pcb_port_id,undefined);
    }
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('optional clearance propagation changes exact pinned sites while default v2 stays byte-identical',()=>{
  const baseline=patchNativeOwnerGuardBundle(source,OWNER_GUARD_SDK_VERSION);
  assert.equal(patchNativeOwnerGuardBundle(source,OWNER_GUARD_SDK_VERSION,{clearanceFloorMm:undefined}),baseline);
  let expected=baseline;
  for(const p of NATIVE_CLEARANCE_PATCHES){assert.equal(expected.split(p.original).length-1,p.count,p.id);expected=expected.split(p.original).join(p.replacement);}
  const guarded=patchNativeOwnerGuardBundle(source,OWNER_GUARD_SDK_VERSION,{clearanceFloorMm:.127});
  assert.equal(guarded,expected+'\n'+nativeClearanceHelperSource(.127)+'\n');
  assert.equal(NATIVE_CLEARANCE_PATCHES.reduce((n,p)=>n+p.count,0),16);
  assert.equal(guarded.split(OWNER_GUARD_REPLACEMENT).length-1,1);
  assert.equal(guarded.split(OWNER_GUARD_MARKER_REPLACEMENT).length-1,2);
  for(const options of [null,[],{unknown:true},{clearanceFloorMm:.126999},{clearanceFloorMm:NaN},{clearanceFloorMm:Infinity},{clearanceFloorMm:'0.15'}])assert.throws(()=>patchNativeOwnerGuardBundle(source,OWNER_GUARD_SDK_VERSION,options as any),/options|floor/);
});

test('mutable force uses actual planning rule while immutable global reference keeps fabrication rule and explicit targets',()=>{
  const helpers=new Function(nativeClearanceHelperSource(.127)+';return {force:__mokiNativeTraceClearance,fab:__mokiNativeFabricationTraceClearance,reference:__mokiNativeReferenceTraceClearance}')();
  const srj={minTraceToPadEdgeClearance:.15,minPadEdgeToPadEdgeClearance:.127};
  assert.equal(helpers.force(srj),.15);assert.equal(helpers.fab(srj),.127);
  assert.equal(helpers.reference(srj),.132000001);
  assert.equal(helpers.reference(srj,.15),.155000001,'generic explicit .15 reference is preserved, never guessed to be planning');
  assert.equal(helpers.force(srj,.2),.2);assert.equal(helpers.reference(srj,.2),.2+.005000001);
  assert.equal(helpers.fab({...srj,minPadEdgeToPadEdgeClearance:.2}),.2);
  assert.equal(helpers.reference(srj,helpers.fab(srj)),helpers.reference(srj),'named indexed entry passes uncompensated fabrication base');
  const gap=.126999999;
  assert.ok(gap+.005<helpers.reference(srj),'native typed epsilon cannot hide a sub-fabrication gap');
  assert.ok(.13+.005>=helpers.reference(srj),'legal immutable fixed copper between .127 and planning .15 remains legal');
  for(const bad of [NaN,Infinity,-.1,'0.15',null])for(const field of ['minTraceToPadEdgeClearance','minPadEdgeToPadEdgeClearance']){
    assert.throws(()=>helpers.force({...srj,[field]:bad}),/Invalid guarded/);
    assert.throws(()=>helpers.reference({...srj,[field]:bad}),/Invalid guarded/);
  }
  for(const bad of [NaN,Infinity,-1,'0.2',null])assert.throws(()=>helpers.reference(srj,bad),/Invalid guarded/);
});

test('actual native via0/GND pair exactly exhausts original .1+.015 force target but receives .15 planning target',()=>{
  const raw=JSON.parse(readFileSync(new URL('../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/native-clearance-pair-fixture.json',import.meta.url),'utf8'));
  const a=raw.traces.find((t:any)=>t.pcb_trace_id==='source_net_29_0'),b=raw.traces.find((t:any)=>t.pcb_trace_id==='source_net_4_mst6_0');
  const via=a.route.find((p:any)=>p.route_type==='via'&&Math.abs(p.x-18.300116859012746)<1e-9&&Math.abs(p.y-7.6977220114091836)<1e-9);assert.ok(via);
  const start={x:17.149993,y:7.625092},end={x:17.935040507193087,y:7.370889856714992};
  assert.ok(b.route.some((p:any)=>p.route_type==='wire'&&p.x===start.x&&p.y===start.y&&p.width===.15));
  assert.ok(b.route.some((p:any)=>p.route_type==='wire'&&p.x===end.x&&p.y===end.y&&p.width===.15));
  const distance=Math.hypot(via.x-end.x,via.y-end.y),gap=distance-via.via_diameter/2-.15/2;
  assert.ok(Math.abs(gap-.115)<1e-12);
  // Evaluate the exact unchanged/patched bundled force expressions, without
  // executing movement, pathfinding or replacing any native geometry helper.
  const original='t.radius+n.radius+(hP.traceClearance??.1)+Sb-u';
  assert.equal(source.split(original).length-1,1);
  const changed=NATIVE_CLEARANCE_PATCHES.find(p=>p.id==='repair-via-segment-target')!.replacement.slice(2);
  const compute=(expression:string)=>new Function('t','n','o','u','hP','Sb',nativeClearanceHelperSource(.127)+';return '+expression)({radius:via.via_diameter/2},{radius:.075},{minTraceToPadEdgeClearance:.15,minPadEdgeToPadEdgeClearance:.127},distance,{traceClearance:.1},.015);
  assert.ok(Math.abs(compute(original))<1e-12,'existing force stops at exact .115 edge gap');
  assert.ok(Math.abs(compute(changed)-.05)<1e-12,'native target has .05mm remaining deficit under actual planning rule');
});

test('clearance variant audit and isolated registry differ while both public constructors coexist without solve',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'moki-owner-clearance-'));
  try{
    const base=await loadNativeOwnerGuard(temp),guarded=await loadNativeOwnerGuard(temp,{clearanceFloorMm:.127});
    assert.equal(base.audit.clearanceGuard,undefined);assert.equal(guarded.audit.clearanceGuard!.replacementCount,16);
    assert.notEqual(base.audit.moduleUrl,guarded.audit.moduleUrl);assert.notEqual(base.audit.utilityIsolation.directory,guarded.audit.utilityIsolation.directory);
    assert.equal(guarded.audit.clearanceGuard!.floorMm,.127);
    assert.equal(guarded.audit.clearanceGuard!.mutableForceUsesPlanningReserve,true);
    const srj={layerCount:2,minTraceWidth:.15,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},obstacles:[],connections:[],traces:[]};
    assert.equal(new base.Pipeline9(structuredClone(srj),{cacheProvider:null}).iterations,0);
    assert.equal(new guarded.Pipeline9(structuredClone(srj),{cacheProvider:null}).iterations,0);
    assert.equal(sha(await readFile(sdk)),OWNER_GUARD_UPSTREAM_SHA256);
  }finally{await rm(temp,{recursive:true,force:true});}
});
