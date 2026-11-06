import{readFileSync,writeFileSync}from'node:fs';
import{repairNativeExits}from'../../../../../../../eda/blocks/repair-native-exits.js';
const dir=new URL('./',import.meta.url),read=(n:string)=>JSON.parse(readFileSync(new URL(n,dir),'utf8')),raw=read('pre-pour-circuit.json'),graph=read('plan-graph.json'),mapping=Object.fromEntries(read('import-map.json').parts.map((p:any)=>[p.ref,p.pins])),phases=read('native-exit-phase.json');
const result=repairNativeExits(raw,graph,mapping,phases,{existingJoinGeometry:'defer-to-physical-network-oracle',nativeRoutingInputs:[{solver:'AutoroutingPipelineSolver9_PreloadedTraceGraph',input:{input:read('router-input.json')}}]});
const receipt={sourceMetadataProofOnly:true,mandatoryDownstreamGates:['all-net-actual-copper-and-drills','all-trace-minimum-width','native-DRC-and-copper-shorts'],unchangedCircuit:JSON.stringify(result.circuit)===JSON.stringify(raw),audit:result.audit,viaAudit:result.viaAudit,deferredExistingTraceIds:result.deferredExistingTraceIds,unrepairedTraceIds:result.unrepairedTraceIds};
writeFileSync(new URL('defer-source-proof.json',dir),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
