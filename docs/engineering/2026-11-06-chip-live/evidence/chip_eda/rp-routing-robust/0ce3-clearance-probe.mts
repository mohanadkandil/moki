import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as math from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/math-utils/dist/index.js';
import * as connectivity from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/circuit-json-to-connectivity-map/dist/index.js';
import { checkEachPcbTraceNonOverlapping } from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/checks/dist/index.js';
import { OWNER_GUARD_ORIGINAL, OWNER_GUARD_REPLACEMENT, OWNER_GUARD_MARKER_ORIGINAL, OWNER_GUARD_MARKER_REPLACEMENT, OWNER_GUARD_MARKER_HELPER, OWNER_GUARD_UPSTREAM_SHA256, OWNER_GUARD_SDK_VERSION, patchNativeOwnerGuardBundle, prepareNativeOwnerGuardModule, loadNativeOwnerGuard } from '/home/sogo/design-skill-research/repos/moki/eda/blocks/native-owner-guard.js';

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const sdk = new URL('/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/capacity-autorouter/dist/index.js', import.meta.url);
const source = readFileSync(sdk, 'utf8'), mapBytes = readFileSync(new URL('./index.js.map', sdk)), sourceMap = JSON.parse(mapBytes.toString('utf8'));
const fixture = JSON.parse(readFileSync(new URL('./native-owner-guard-fixture.json', import.meta.url), 'utf8'));
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

import {checkViaTraceClearance} from '/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/checks/dist/index.js';
const job='/home/sogo/design-skill-research/repos/moki/var/board-jobs-test-chip/0ce3c0b1-1fc5-4c95-8ad7-0425dad42cc9/';
const events=JSON.parse(readFileSync(job+'native-routing.json','utf8')), event=events.find((e:any)=>e.solver==='AutoroutingPipelineSolver9_PreloadedTraceGraph');
const input=event.input.input,raw=JSON.parse(readFileSync(job+'native-before-width.json','utf8')),final=JSON.parse(readFileSync(job+'circuit.json','utf8'));
const before=sha(JSON.stringify({input,raw}));
const cj=converters[1].convertToCircuitJson(input,raw.traces,{originalSrj:input,includeOriginalConnections:true});
assert.equal(sha(JSON.stringify({input,raw})),before);
const reference=connectivity.getFullConnectivityMapFromCircuitJson(cj),via=cj.find((e:any)=>e.type==='pcb_via'&&Math.hypot(e.x-18.300116859012746,e.y-7.6977220114091836)<1e-9),trace=cj.find((e:any)=>e.type==='pcb_trace'&&e.pcb_trace_id==='source_net_4_mst6_0');
assert.ok(via&&trace);
const owner=(t:any)=>cj.find((e:any)=>e.type==='source_trace'&&e.source_trace_id===t.source_trace_id);
const errors=checkViaTraceClearance(cj,{minClearance:.127});
const matched=errors.find((e:any)=>e.pcb_via_id===via.pcb_via_id&&e.pcb_trace_id===trace.pcb_trace_id);
const result={scope:'pure exact-input native source-guarded converter plus single public via-clearance checker; no router, no wholeboard oracle',inputSha256:sha(JSON.stringify(input)),rawSha256:sha(readFileSync(job+'native-before-width.json')),rules:{defaultObstacleMargin:input.defaultObstacleMargin,minTraceToPadEdgeClearance:input.minTraceToPadEdgeClearance,minViaEdgeToPadEdgeClearance:input.minViaEdgeToPadEdgeClearance},via,traceIdentity:{pcb_trace_id:trace.pcb_trace_id,source_trace_id:trace.source_trace_id},traceSourceOwner:owner(trace),viaSourceOwner:owner(cj.find((e:any)=>e.type==='pcb_trace'&&e.pcb_trace_id===via.pcb_trace_id)),nativeConverterConnectivitySaysConnected:reference.areIdsConnected(trace.pcb_trace_id,via.pcb_via_id),nativeReferenceCheckMatched:matched??null,nativeReferenceCheckErrorCount:errors.length};
writeFileSync(new URL('./0ce3-clearance-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
