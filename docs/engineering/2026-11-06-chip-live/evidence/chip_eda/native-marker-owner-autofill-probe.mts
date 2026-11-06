import test from 'node:test';
import {symlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as math from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/math-utils/dist/index.js';
import * as connectivity from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/circuit-json-to-connectivity-map/dist/index.js';
import { checkEachPcbTraceNonOverlapping } from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/checks/dist/index.js';
import { OWNER_GUARD_ORIGINAL, OWNER_GUARD_REPLACEMENT, OWNER_GUARD_UPSTREAM_SHA256, OWNER_GUARD_SDK_VERSION, patchNativeOwnerGuardBundle, prepareNativeOwnerGuardModule, loadNativeOwnerGuard } from '/home/sogo/design-skill-research/repos/moki/eda/blocks/native-owner-guard.js';

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const sdk = new URL('/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/capacity-autorouter/dist/index.js', import.meta.url);
const source = readFileSync(sdk, 'utf8'), mapBytes = readFileSync(new URL('./index.js.map', sdk)), sourceMap = JSON.parse(mapBytes.toString('utf8'));
const fixture = JSON.parse(readFileSync(new URL('/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/native-owner-guard-fixture.json', import.meta.url), 'utf8'));
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



// Counterfactual copy only. Never modify installed SDK/checks bundles.
const checksPath='/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/checks/dist/index.js';
const checksSource=readFileSync(checksPath,'utf8');
const begin=checksSource.indexOf('// lib/add-start-and-end-port-ids-if-missing.ts'),end=checksSource.indexOf('// lib/check-each-pcb-port-connected-to-pcb-trace.ts',begin);
assert.ok(begin>=0&&end>begin);const originalBody=checksSource.slice(begin,end);
const loop='  for (const trace of pcbTraces) {';assert.equal(originalBody.split(loop).length,2);
const guard=`  for (const trace of pcbTraces) {
    const declared = soup.filter((item) => item.type === "source_trace" && item.source_trace_id === trace.source_trace_id);
    if (typeof trace.source_trace_id === "string" && trace.source_trace_id && declared.length === 1 &&
      [declared[0].connected_source_port_ids, declared[0].connected_source_net_ids].every((refs) =>
        Array.isArray(refs) && refs.length > 0 && refs.every((id) => typeof id === "string" && id.length > 0))) continue;`;
const counterfactual=checksSource.slice(0,begin)+originalBody.replace(loop,guard)+checksSource.slice(end);
const directory=await mkdtemp(resolve(tmpdir(),'moki-marker-owner-probe-'));
const results:any[]=[];
try{
 await symlink('/home/sogo/design-skill-research/repos/moki/eda/node_modules',resolve(directory,'node_modules'),'dir');
 await writeFile(resolve(directory,'checks-counterfactual.mjs'),counterfactual);
 const guardedCheck=(await import(pathToFileURL(resolve(directory,'checks-counterfactual.mjs')).href)).checkEachPcbTraceNonOverlapping;
 const check=(name:string,cj:any[],assertion:'bad'|'good'|'legacy')=>{
  const input=structuredClone(cj),traces=input.filter(e=>e.type==='pcb_trace'),before=structuredClone(traces),original=structuredClone(input);
  const baseline=checkEachPcbTraceNonOverlapping(original),issues=guardedCheck(input);
  if(assertion==='bad'){assert.ok(issues.length>0,name);assert.ok(issues.some((e:any)=>e.message.includes('overlap')||e.message.includes('close')),name);assert.equal(traces[0].route.at(-1).end_pcb_port_id,undefined);}
  if(assertion==='good'){assert.equal(issues.length,0,name);for(let i=0;i<traces.length;i++)assert.deepEqual(traces[i].route,before[i].route);}
  if(assertion==='legacy'){assert.deepEqual(issues,baseline,name);assert.ok(traces[0].route.at(-1).end_pcb_port_id,name);}
  for(let i=0;i<traces.length;i++){const physical=(trace:any)=>({...trace,route:trace.route.map((p:any)=>{const q={...p};delete q.start_pcb_port_id;delete q.end_pcb_port_id;return q;})});assert.deepEqual(physical(traces[i]),physical(before[i]),name+' copper/source invariant');}
  results.push({name,baselineIssues:baseline.map((e:any)=>e.message),guardedIssues:issues.map((e:any)=>e.message),markersBefore:before.map(t=>t.route.map((p:any)=>({start:p.start_pcb_port_id,end:p.end_pcb_port_id}))),markersAfter:traces.map(t=>t.route.map((p:any)=>({start:p.start_pcb_port_id,end:p.end_pcb_port_id})))});
 };
 for(const bound of[false,true])check('foreign-endpoint-'+(bound?'bound':'unbound'),scenario(bound,false,'foreign').outputs[1],'bad');
 const own=scenario(true,false,'own').outputs[1];
 // Keep legitimate pre-existing marker unchanged; suppress only autofill.
 const ownTrace=own.find((e:any)=>e.type==='pcb_trace');ownTrace.route[0].start_pcb_port_id='pcb_port_52';
 check('legitimate-own-pad',own,'good');
 const junction=structuredClone(own),t=junction.find((e:any)=>e.type==='pcb_trace'),a=t.route.at(-1);
 t.route=[{...a,x:a.x,y:a.y},{...a,x:a.x+4,y:a.y}];
 junction.push({...t,pcb_trace_id:'SAME_NET_FREE_CU_BRANCH',route:[{route_type:'wire',x:a.x+3,y:a.y,width:.15,layer:'top'},{route_type:'wire',x:a.x+3,y:a.y+2,width:.15,layer:'top'}]});
 check('same-net-free-copper-T-junction',junction,'good');
 const markedForeign=scenario(true,false,'foreign').outputs[1];markedForeign.find((e:any)=>e.type==='pcb_trace').route.at(-1).end_pcb_port_id='pcb_port_56';check('preexisting-foreign-marker-preserved-limitation',markedForeign,'good');
 const legacy=scenario(true,false,'foreign').outputs[1];delete legacy.find((e:any)=>e.type==='pcb_trace').source_trace_id;check('unknown-legacy-control',legacy,'legacy');
 const missingRefs=scenario(true,false,'foreign').outputs[1];missingRefs.find((e:any)=>e.type==='source_trace'&&e.source_trace_id==='source_net_13').connected_source_port_ids=[];check('empty-owner-refs-control',missingRefs,'legacy');
 const evidence={scope:'Pure complete pinned native checker counterfactual; only source-declared trace autofill skip in isolated temporary module, installed SDK unchanged',checksSha256:sha(checksSource),counterfactualSha256:sha(counterfactual),counterfactualGuard:guard,sourceRecordCaveat:'Native converter diagnostics contain source_trace alias references but no source_port/source_net table records; this is a unique structurally declared owner guard, not compiler-canonical source validation.',results};
 writeFileSync('/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/native-marker-owner-autofill-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(results.map(r=>({name:r.name,before:r.baselineIssues.length,after:r.guardedIssues.length}))));
}finally{await rm(directory,{recursive:true,force:true});}
