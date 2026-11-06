import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import ts from'typescript';
import * as math from'/home/sogo/design-skill-research/repos/moki/eda/node_modules/@tscircuit/math-utils/dist/index.js';
import * as connectivity from'/home/sogo/design-skill-research/repos/moki/eda/node_modules/circuit-json-to-connectivity-map/dist/index.js';
const root='/home/sogo/design-skill-research/repos/moki/',dir=root+'docs/engineering/2026-11-06-chip-live/evidence/chip_eda/',mapPath=root+'eda/node_modules/@tscircuit/capacity-autorouter/dist/index.js.map',map=JSON.parse(readFileSync(mapPath,'utf8'));
const primary=(key:string)=>{const i=map.sources.indexOf(key);assert.ok(i>=0,key);return map.sourcesContent[i]as string;};
const hashes:Record<string,string>={};
function compile(key:string,dependencies:Record<string,any>){const source=primary(key);hashes[key]=createHash('sha256').update(source).digest('hex');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,compiled={exports:{}as any};new Function('require','exports','module',js)((name:string)=>{assert.ok(name in dependencies,'Unexpected primary-module import '+name);return dependencies[name]},compiled.exports,compiled);return compiled.exports;}
// All conversion helper bodies come UNCHANGED from the pinned native source map;
// only their module loader is supplied. No router or solver is instantiated.
const layers=compile('../lib/utils/connection-point-utils.ts',{}),z=compile('../lib/utils/mapLayerNameToZ.ts',{}),mapz=compile('../lib/utils/mapZToLayerName.ts',{}),repairz=compile('../node_modules/high-density-repair03/lib/utils/mapZToLayerName.ts',{});
const vias=compile('../node_modules/high-density-repair03/lib/utils/getViaLayers.ts',{'./mapZToLayerName':repairz});
const conn=compile('../lib/utils/getConnectivityMapFromSimpleRouteJson.ts',{'./connection-point-utils':layers,'circuit-json-to-connectivity-map':connectivity,'./mapLayerNameToZ':z});
const dims=compile('../lib/utils/getViaDimensions.ts',{}),imported=compile('../lib/utils/getSrjWithImportedPadPortIds.ts',{'lib/types/srj-types':layers});
const converter=compile('../lib/utils/convertToCircuitJson.ts',{'@tscircuit/math-utils':math,'high-density-repair03/lib':vias,'lib/types/srj-types':layers,'lib/utils/getConnectivityMapFromSimpleRouteJson':conn,'lib/utils/getViaDimensions':dims,'lib/utils/mapZToLayerName':mapz,'./getSrjWithImportedPadPortIds':imported});
const input=JSON.parse(readFileSync(root+'var/board-jobs-test-chip/71e5d163-a9c4-47f1-b00b-55896bb5af8d/router-input.json','utf8'));
const ground=structuredClone(input.obstacles.find((o:any)=>o.netIsAssignable&&o.circuitJsonMetadata?.pcb_port_id==='pcb_port_56'));
const signal=structuredClone(input.obstacles.find((o:any)=>o.circuitJsonMetadata?.pcb_port_id==='pcb_port_61'));
assert.ok(ground&&signal);assert.ok(ground.connectedTo.includes('source_net_4'));assert.ok(signal.connectedTo.includes('source_net_13'));
const signalConnection=structuredClone(input.connections.find((c:any)=>c.name==='source_net_13')),groundConnection=structuredClone(input.connections.find((c:any)=>c.name==='source_net_4'));
const terminal=signalConnection.pointsToConnect.find((p:any)=>p.pcb_port_id);assert.ok(terminal);
const inside={x:ground.center.x+.3,y:ground.center.y+.2};
assert.ok(math.pointToBoxDistance(inside,ground)<=0);assert.ok(Math.hypot(inside.x-ground.center.x,inside.y-ground.center.y)>.01);
const route:any={type:'pcb_trace',pcb_trace_id:'DERIVED_FOREIGN_ENDPOINT_INSIDE_KNOWN_GROUND',connection_name:'source_net_13',connectsTo:signalConnection.pointsToConnect.map((p:any)=>p.pointId??p.pcb_port_id),route:[{route_type:'wire',x:terminal.x,y:terminal.y,width:.15,layer:'top'},{route_type:'wire',...inside,width:.15,layer:'top'}]};
const records=[];
for(const bound of[true,false])for(const assignable of[true,false]){
 const g=structuredClone(ground);g.netIsAssignable=assignable;const s=structuredClone(signalConnection);
 if(!bound)for(const p of s.pointsToConnect)delete p.pcb_port_id;
 const srj={...input,obstacles:[g,signal],connections:[groundConnection,s],traces:[]},before=JSON.stringify(srj),cj=converter.convertToCircuitJson(srj,[route],{originalSrj:srj,includeOriginalConnections:true});assert.equal(JSON.stringify(srj),before);
 const trace=cj.find((e:any)=>e.type==='source_trace'&&e.source_trace_id==='source_net_13');assert.ok(trace);const linked=trace.connected_source_net_ids.includes('source_net_4');
 const pad=cj.find((e:any)=>e.type==='pcb_smtpad'&&e.pcb_smtpad_id===ground.circuitJsonMetadata.pcb_smtpad_id);assert.ok(pad);
 records.push({boundConnection:bound,netIsAssignable:assignable,foreignSourceImportsDeclaredGround:linked,groundPadRetainedPortId:pad.pcb_port_id,foreignConnectedSourceNetIds:trace.connected_source_net_ids});
 assert.equal(linked,bound?assignable:true);
}
const result={scope:'Complete pinned native pureconverter+exact pinned helper modules transpiled unchanged with actual math/connectivity libraries; DERIVED bad route using unchanged actual71e5pads/aliases. No router/solver.',nativeSourceMapSha256:createHash('sha256').update(readFileSync(mapPath)).digest('hex'),primarySourceSha256:hashes,actualGroundPortId:ground.circuitJsonMetadata.pcb_port_id,actualSignalPortId:terminal.pcb_port_id,declaredPhysicalPortCounts:signalConnection.pointsToConnect.filter((p:any)=>p.pcb_port_id).length,derivedBadEndpoint:inside,cases:records,conclusion:'Assignable flagcan merge a physicallydeclaredforeignroute endpoint insideexplicitGNDland intoGNDsourcealiases;falseblockswhen≥1physicalportexists. Groundpad ownportmetadata isunchanged,sobranch752notneeded. Unboundroute0physicalportsstillimportsGNDunderbothflags;flagfalsealoneisnotgeneralownershipproof.'};
writeFileSync(dir+'assignable-native-converter-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,primarySourceSha256:undefined}));
