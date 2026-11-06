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




const actualCases=[];
for(const job of['71e5d163-a9c4-47f1-b00b-55896bb5af8d','d7bdf1b1-c49a-49db-94fd-a9c4236dc3c4']){
 const directory='/home/sogo/design-skill-research/repos/moki/var/board-jobs-test-chip/'+job+'/';
 const input=JSON.parse(readFileSync(directory+'router-input.json','utf8')),output=JSON.parse(readFileSync(directory+'native-before-width.json','utf8'));
 const before=structuredClone({input,output});const cj=converters[1].convertToCircuitJson(input,output.traces,{originalSrj:input,includeOriginalConnections:true,minTraceWidth:input.minTraceWidth,minViaDiameter:input.minViaDiameter});assert.deepEqual({input,output},before);
 const owners=cj.filter((e:any)=>e.type==='source_trace'),traces=cj.filter((e:any)=>e.type==='pcb_trace');
 const rows=owners.map((owner:any)=>{const port=owner.connected_source_port_ids,net=owner.connected_source_net_ids;return{id:owner.source_trace_id,ports:Array.isArray(port)?port.length:null,nets:Array.isArray(net)?net.length:null,eligible:[port,net].every(refs=>Array.isArray(refs)&&refs.length>0&&refs.every(id=>typeof id==='string'&&id.length>0)),pcbTraceIds:traces.filter((t:any)=>t.source_trace_id===owner.source_trace_id).map((t:any)=>t.pcb_trace_id)};});
 const aliases=new Map(rows.map((r:any)=>[r.id,r]));const actualTraceRows=traces.map((t:any)=>({id:t.pcb_trace_id,owner:t.source_trace_id,eligible:(aliases.get(t.source_trace_id)as any)?.eligible??false}));
 const actualCj=JSON.parse(readFileSync(directory+'circuit.json','utf8')),clock=JSON.parse(readFileSync(directory+'clock-phase.json','utf8'));
 const clockNetIds=clock.netNames.map((name:string)=>{const e=actualCj.filter((e:any)=>e.type==='source_net'&&e.name===name);assert.equal(e.length,1);return e[0].source_net_id;});
 const clockGeneric=input.obstacles.map((obstacle:any,index:number)=>({obstacle,index})).filter(({obstacle:o}:any)=>o.connectedTo.some((id:string)=>clockNetIds.includes(id))&&!o.circuitJsonMetadata);
 const genericRows=clockGeneric.map(({obstacle,index}:any)=>({index,clockNet:obstacle.connectedTo.find((id:string)=>clockNetIds.includes(id)),center:obstacle.center,width:obstacle.width,height:obstacle.height,convertedElements:converters[1].createPcbPadElements({...input,obstacles:[obstacle]}).length}));
 assert.ok(genericRows.length>0);assert.ok(genericRows.every((r:any)=>r.convertedElements===0));
 const physical=(route:any[])=>route.map(p=>[p.x,p.y,p.route_type,p.layer,p.width]);
 const clockTraces=clock.audit.map((a:any)=>{const matches=actualCj.filter((e:any)=>e.type==='pcb_trace'&&(JSON.stringify(physical(e.route))===JSON.stringify(physical(a.route))||JSON.stringify(physical(e.route))===JSON.stringify(physical([...a.route].reverse()))));if(matches.length===0)return null;assert.equal(matches.length,1);const trace=matches[0],source=actualCj.find((e:any)=>e.type==='source_trace'&&e.source_trace_id===trace.source_trace_id);assert.ok(source.connected_source_net_ids.length===1);const name=source.connected_source_net_ids[0];assert.ok(clockNetIds.includes(name));const aliases=[...new Set(input.obstacles.filter((o:any)=>o.connectedTo.includes(name)&&o.circuitJsonMetadata?.pcb_smtpad_id).flatMap((o:any)=>o.connectedTo))];return{type:'pcb_trace',pcb_trace_id:trace.pcb_trace_id,connection_name:name,connectsTo:aliases,route:structuredClone(trace.route)};}).filter(Boolean);
 if(job==='71e5d163-a9c4-47f1-b00b-55896bb5af8d')assert.equal(clockTraces.length,5);assert.equal(cj.filter((e:any)=>e.type==='pcb_trace'&&clockTraces.some((t:any)=>t.pcb_trace_id===e.pcb_trace_id)).length,0);
 const preloadInput={...input,traces:clockTraces},preloaded=converters[1].convertToCircuitJson(preloadInput,[...clockTraces,...output.traces],{originalSrj:preloadInput,includeOriginalConnections:true});
 const retainedClock=clockTraces.map((trace:any)=>{const converted=preloaded.filter((e:any)=>e.type==='pcb_trace'&&e.pcb_trace_id===trace.pcb_trace_id);assert.equal(converted.length,1);assert.deepEqual(physical(converted[0].route),physical(trace.route));return{id:trace.pcb_trace_id,net:trace.connection_name,routePoints:trace.route.length,exactGeometryRetained:true};});
 const preloadClockOwners=preloaded.filter((e:any)=>e.type==='source_trace'&&clockNetIds.includes(e.source_trace_id)).map((e:any)=>({id:e.source_trace_id,ports:e.connected_source_port_ids.length,nets:e.connected_source_net_ids.length}));
 const clockProof={preloadClockOwners,clockLiteralSource:clockTraces.length===5?'All5audit paths match actual Core pcb_trace physical sequences up to reversal':'No routed Core clock traces present in this captured circuit.json; no preload claim for this case',clockNetIds,inputConnectionsExcludeClock:input.connections.every((c:any)=>!clockNetIds.includes(c.name)),genericObstacleCount:genericRows.length,genericRows,convertedClockTraceCount:0,convertedClockSourceOwners:owners.filter((o:any)=>clockNetIds.includes(o.source_trace_id)).length,preloadCounterfactual:retainedClock};
 const result={clockProof,job,inputSha:sha(JSON.stringify(input)),nativeTraceCount:output.traces.length,inputPreloadedTraces:input.traces?.length??0,sourceOwners:rows.length,ownersEligible:rows.filter((r:any)=>r.eligible).length,portsEmpty:rows.filter((r:any)=>r.ports===0).map((r:any)=>r.id),netRefsEmpty:rows.filter((r:any)=>r.nets===0).map((r:any)=>r.id),pcbTracesCovered:actualTraceRows.filter((r:any)=>r.eligible).length,rows,uncoveredTraces:actualTraceRows.filter((r:any)=>!r.eligible)};
 actualCases.push(result);console.log(JSON.stringify({...result,rows:undefined,clockProof:{...clockProof,genericRows:undefined}}));
 writeFileSync('/tmp/moki-converted-'+job+'.json',JSON.stringify(cj));
}
writeFileSync('/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/native-marker-owner-actual-coverage.json',JSON.stringify({scope:'Complete pinned owner-guarded native converter on captured actual original SRJ and raw simplified native traces; pure no routing',sourceMapSha256:sha(mapBytes),actualCases},null,2)+'\n');
