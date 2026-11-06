import test from 'node:test';
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


const cases=[];
for(const bound of[false,true]){
 const{outputs,route}=scenario(bound,false,'foreign'),cj=outputs[1],sourceOwner=cj.find((e:any)=>e.type==='source_trace'&&e.source_trace_id==='source_net_13'),pcbTrace=cj.find((e:any)=>e.type==='pcb_trace'&&e.pcb_trace_id===route.pcb_trace_id),before=structuredClone(pcbTrace.route);
 assert.equal(sourceOwner.connected_source_net_ids.includes('source_net_4'),false);
 const issues=checkEachPcbTraceNonOverlapping(cj);cases.push({bound,sourceContainsGroundBeforeCheck:false,wireRouteBefore:before,wireRouteAfter:pcbTrace.route,issues:issues.map((e:any)=>e.message)});
}
const evidence={scope:'Independent pure pinned-native converter plus native overlap checker; derived bad route in unchanged actual physical lands, no router.',cases,conclusion:'The owner predicate removes foreign GND source aliases, but the independent overlap checker can infer a foreign endpoint ID before building connectivity and consequently still hide that contact. It does not establish a route or fabrication pass; mandatory all-net physical/source hard gates remain necessary.'};
writeFileSync('/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/native-endpoint-inference-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(cases.map(c=>({bound:c.bound,markersBefore:c.wireRouteBefore.map((p:any)=>p.end_pcb_port_id),markersAfter:c.wireRouteAfter.map((p:any)=>p.end_pcb_port_id),issues:c.issues.length}))));
