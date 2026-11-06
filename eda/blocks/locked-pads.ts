/** Component terminal copper has a declared source owner, including GND.
 * Disable native's assignable-pad inference only after proving that owner.
 * No copper, aliases, layer, route or fabrication constraint is changed. */
import type { PlanGraph } from '../../src/blocks/graph.js';
import { catalogPart } from '../../src/blocks/library.js';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';

export interface LockedPadAudit { ref:string; pad:string; padId:string; net:string; portId:string; sourcePortId:string; sourceNetId:string }
const one=<T>(items:T[],label:string):T=>{if(items.length!==1)throw Error('Pad ownership requires exactly one '+label);return items[0]!;};
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
export function lockKnownPadOwnership(input:any,actualCircuit:any[],graph:PlanGraph,mapping:Record<string,Record<string,string>>) {
  if(!input||typeof input!=='object'||!Array.isArray(input.obstacles)||!Array.isArray(actualCircuit)||!Array.isArray(graph?.parts)||!Array.isArray(graph?.nets)||!mapping)throw Error('Pad ownership requires actual native input/circuit/source graph/import map');
  const claimed=(o:any)=>o?.circuitJsonMetadata&&['pcb_smtpad_id','pcb_plated_hole_id','pcb_port_id'].some(k=>o.circuitJsonMetadata[k]!==undefined);
  if(input.obstacles.some((o:any)=>claimed(o)&&o.netIsAssignable!==undefined&&typeof o.netIsAssignable!=='boolean'))throw Error('Pad ownership assignment flag is malformed');
  const candidates=input.obstacles.filter((o:any)=>o?.netIsAssignable===true&&claimed(o));
  if(!candidates.length)return{input,audit:[]as LockedPadAudit[]};
  const issues=nativeNetlistIssues(graph,actualCircuit,mapping);
  if(issues.length)throw Error('Pad ownership source graph differs: '+issues.map(i=>i.message).join('; '));
  const sourceNets=new Map(graph.nets.map(net=>[net.name,one(actualCircuit.filter(e=>e.type==='source_net'&&e.name===net.name),'actual source net '+net.name)]));
  type Owner={ref:string;pad:string;logical:string;net?:PlanGraph['nets'][number];source:any;canonical:any;ports:any[];part:PlanGraph['parts'][number]};
  const bySourcePort=new Map<string,Owner>(),aliases=new Map<string,string>();
  const alias=(id:unknown,net:string)=>{if(!text(id))return;const old=aliases.get(id);if(old!==undefined&&old!==net)throw Error('Pad ownership has conflicting source/physical aliases: '+id);aliases.set(id,net);};
  for(const net of graph.nets){const source=sourceNets.get(net.name)!;alias(source.source_net_id,'net:'+net.name);alias(source.subcircuit_connectivity_map_key,'net:'+net.name);}
  for(const part of graph.parts){
    const source=one(actualCircuit.filter(e=>e.type==='source_component'&&e.name===part.ref),'source component '+part.ref);
    const names=Object.values(part.part.pins).map(pin=>{const n=mapping[part.ref]?.[pin.pad];if(!text(n))throw Error('Pad ownership import map is missing');return n;});
    const optional=new Set((part.part.omitPads??[]).map(p=>mapping[part.ref]?.[p]).filter(text));
    const resolved=nativeComponentPorts(actualCircuit,source,[...names,...optional],optional);
    for(const[logical,pin]of Object.entries(part.part.pins)){
      const net=oneOrNone(graph.nets.filter(n=>n.pins.some(p=>p.ref===part.ref&&p.logical===logical&&p.pad===pin.pad)),'graph physical net');
      const ports=resolved.byNative.get(mapping[part.ref]![pin.pad]!)!;
      const owner:Owner={ref:part.ref,pad:pin.pad,logical,net,source,canonical:ports[0],ports,part};
      for(const port of ports){if(bySourcePort.has(port.source_port_id))throw Error('Pad ownership aliases distinct physical pins');bySourcePort.set(port.source_port_id,owner);alias(port.source_port_id,net?'net:'+net.name:'isolated:'+part.ref+'.'+pin.pad);}
    }
  }
  // Known references are checked independently of obstacle-provided net names.
  for(const port of actualCircuit.filter(e=>e.type==='pcb_port')){const owner=bySourcePort.get(port.source_port_id);if(owner)alias(port.pcb_port_id,owner.net?'net:'+owner.net.name:'isolated:'+owner.ref+'.'+owner.pad);}
  for(const pad of actualCircuit.filter(e=>['pcb_smtpad','pcb_plated_hole'].includes(e.type))){const port=actualCircuit.find(e=>e.type==='pcb_port'&&e.pcb_port_id===pad.pcb_port_id),owner=port&&bySourcePort.get(port.source_port_id);if(owner)alias(pad[pad.type+'_id'],owner.net?'net:'+owner.net.name:'isolated:'+owner.ref+'.'+owner.pad);}
  for(const trace of actualCircuit.filter(e=>e.type==='source_trace')){
    const nets=new Set<string>([...(trace.connected_source_port_ids??[]),...(trace.connected_source_net_ids??[])].map(id=>aliases.get(id)).filter(text));
    if(nets.size>1)throw Error('Pad ownership source trace conflicts with declared nets');
    if(nets.size===1)alias(trace.source_trace_id,[...nets][0]!);
  }
  // Native virtual-exit references also remain owned by their declared net.
  for(const connection of input.connections??[]){const refs=[connection.name,connection.__netConnectionName,...connection.__rootConnectionNames??[]],nets=new Set<string>(refs.map(id=>aliases.get(id)).filter(text));if(nets.size>1)throw Error('Pad ownership routing connection has conflicting owners');if(nets.size===1)for(const p of connection.pointsToConnect??[]){alias(p.pointId,[...nets][0]!);alias(p.pcb_port_id,[...nets][0]!);}}
  const audit:LockedPadAudit[]=[],locked=new Map<any,any>();
  for(const obstacle of candidates){
    const meta=obstacle.circuitJsonMetadata,ids=['pcb_smtpad_id','pcb_plated_hole_id'].filter(k=>meta[k]!==undefined);
    if(ids.length!==1||!text(meta[ids[0]!])||!text(meta.pcb_port_id)||meta.pcb_via_id!==undefined||obstacle.isNonPlatedHole||obstacle.isCopperPour)throw Error('Pad ownership physical metadata is missing/ambiguous');
    const id=meta[ids[0]!],type=ids[0]==='pcb_smtpad_id'?'pcb_smtpad':'pcb_plated_hole';
    const pad=one(actualCircuit.filter(e=>e.type===type&&e[ids[0]!]===id),'actual physical pad '+id);
    const port=one(actualCircuit.filter(e=>e.type==='pcb_port'&&e.pcb_port_id===meta.pcb_port_id),'actual physical PCB port');
    if(pad.pcb_port_id!==port.pcb_port_id||pad.pcb_component_id!==port.pcb_component_id||obstacle.componentId!==pad.pcb_component_id)throw Error('Pad ownership pad/port/component metadata differs');
    const component=one(actualCircuit.filter(e=>e.type==='pcb_component'&&e.pcb_component_id===pad.pcb_component_id),'actual PCB component');
    const owner=bySourcePort.get(port.source_port_id);
    if(!owner?.net||component.source_component_id!==owner.source.source_component_id||!owner.ports.some(p=>p.source_port_id===port.source_port_id)||!pad.port_hints?.includes(mapping[owner.ref]![owner.pad]!))throw Error('Pad ownership has no canonical physical source/import owner');
    const catalog=catalogPart(owner.part.part.lcsc,owner.part.part.catalogReceipt);
    if(catalog.mpn!==owner.part.part.mpn||owner.source.manufacturer_part_number!==owner.part.part.mpn||!owner.source.supplier_part_numbers?.jlcpcb?.includes(owner.part.part.lcsc)||!catalog.pins.some(p=>p.pad===owner.pad))throw Error('Pad ownership registered supplier/source identity differs');
    const sourceNet=sourceNets.get(owner.net.name)!,canonical=owner.canonical;
    const sourceTrace=one(actualCircuit.filter(e=>e.type==='source_trace'&&e.connected_source_port_ids?.length===1&&e.connected_source_port_ids[0]===canonical.source_port_id&&e.connected_source_net_ids?.length===1&&e.connected_source_net_ids[0]===sourceNet.source_net_id),'canonical physical one-port/net source trace');
    if(!text(canonical.subcircuit_connectivity_map_key)||[sourceNet,sourceTrace].some(e=>e.subcircuit_connectivity_map_key!==canonical.subcircuit_connectivity_map_key)||[port,component,sourceNet,sourceTrace].some(e=>e.subcircuit_id!==canonical.subcircuit_id)||(owner.source.subcircuit_id!==undefined&&owner.source.subcircuit_id!==canonical.subcircuit_id))throw Error('Pad ownership actual source net/key/subcircuit differs');
    if(!Array.isArray(obstacle.connectedTo)||obstacle.connectedTo.some((id:any)=>!text(id))||![id,port.pcb_port_id,sourceNet.source_net_id].every(id=>obstacle.connectedTo.includes(id))||obstacle.connectedTo.some((id:string)=>aliases.has(id)&&aliases.get(id)!=='net:'+owner.net!.name))throw Error('Pad ownership obstacle aliases conflict with canonical net');
    locked.set(obstacle,{...obstacle,netIsAssignable:false});audit.push({ref:owner.ref,pad:owner.pad,padId:id,net:owner.net.name,portId:port.pcb_port_id,sourcePortId:port.source_port_id,sourceNetId:sourceNet.source_net_id});
  }
  return{input:{...input,obstacles:input.obstacles.map((o:any)=>locked.get(o)??o)},audit};
}
function oneOrNone<T>(items:T[],label:string):T|undefined {if(items.length>1)throw Error('Pad ownership has ambiguous '+label);return items[0];}
