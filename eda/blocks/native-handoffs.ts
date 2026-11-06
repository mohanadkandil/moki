/** Native phase handoffs wholly inside existing registered SMT lands.
 * This selects a free native exit only. It creates no copper outside the land
 * and does not connect the other endpoint or establish routed acceptance. */
import { checkHoleTraceClearance, checkEachPcbTraceNonOverlapping } from '@tscircuit/checks';
import type { PlanGraph } from '../../src/blocks/graph.js';
import { catalogPart } from '../../src/blocks/library.js';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import { nativePlacementIssues } from '../../src/blocks/native-placement.js';
import type { NativeFanoutProposal } from './fanout.js';

const LENGTH = .2, EPS = 1e-7;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const one = <T>(items: T[], label: string): T => {
  if (items.length !== 1) throw Error(`Native pad handoff requires exactly one ${label}`);
  return items[0]!;
};
const turn = (p: {x:number;y:number}, q: number) => {
  switch ((q % 4 + 4) % 4) {
    case 1: return {x:-p.y,y:p.x};
    case 2: return {x:-p.x,y:-p.y};
    case 3: return {x:p.y,y:-p.x};
    default: return {...p};
  }
};
/** Conservative void bounds only: no electrical/net labels can restore drilled
 * copper. Noncircular drills are enclosed by a disc, so an unsupported or nearby
 * slot may reject a usable candidate but can never fabricate positive copper. */
function topDrillVoids(circuit:any[],layerCount:2|4) {
  const stack=layerCount===4?['top','inner1','inner2','bottom']:['top','bottom'];
  const positive=(v:unknown)=>{if(!finite(v)||v<=0)throw Error('Native pad handoff drill dimension is invalid');return v;};
  return circuit.filter(e=>['pcb_hole','pcb_plated_hole','pcb_via'].includes(e.type)).flatMap(e=>{
    let reachesTop=true;
    if(e.type!=='pcb_hole'){
      if(!Array.isArray(e.layers)||!e.layers.length||e.layers.some((l:any)=>!stack.includes(l)))throw Error('Native pad handoff drill layer span is invalid');
      const indices=e.layers.map((l:string)=>stack.indexOf(l)),span=stack.slice(Math.min(...indices),Math.max(...indices)+1);
      if((e.from_layer!==undefined||e.to_layer!==undefined)&&(!span.includes(e.from_layer)||!span.includes(e.to_layer)))throw Error('Native pad handoff drill direction conflicts with physical span');
      reachesTop=span.includes('top');
    }
    if(e.hole_shape!==undefined&&typeof e.hole_shape!=='string')throw Error('Native pad handoff unsupported drill shape');
    if(e.type==='pcb_plated_hole'&&!['circle','oval','pill','circular_hole_with_rect_pad','pill_hole_with_rect_pad','rotated_pill_hole_with_rect_pad','hole_with_polygon_pad'].includes(e.shape))throw Error('Native pad handoff unsupported plated drill shape');
    const ox=e.hole_offset_x??0,oy=e.hole_offset_y??0;
    if(![e.x,e.y,ox,oy,e.hole_ccw_rotation??e.ccw_rotation??0].every(finite))throw Error('Native pad handoff drill coordinate/rotation is invalid');
    const kind=e.type==='pcb_via'?'circle':e.hole_shape??(e.hole_diameter!==undefined?'circle':
      ['pill_hole_with_rect_pad','rotated_pill_hole_with_rect_pad'].includes(e.shape)?'pill':e.shape);
    let radius:number;
    if(kind==='circle')radius=positive(e.hole_diameter)/2;
    else if(kind==='square')radius=positive(e.hole_diameter)/Math.SQRT2;
    else if(['pill','rotated_pill','oval','rect'].includes(kind))radius=Math.hypot(positive(e.hole_width),positive(e.hole_height))/2;
    else throw Error('Native pad handoff unsupported drill shape');
    // Some native variants select their diameter/slot fields from the outer
    // primitive rather than hole_shape. Mixed fields may only enlarge the
    // conservative void, never hide the dimensions that native will consume.
    if(e.hole_diameter!==undefined)radius=Math.max(radius,positive(e.hole_diameter)/2);
    if(e.hole_width!==undefined||e.hole_height!==undefined)radius=Math.max(radius,Math.hypot(positive(e.hole_width),positive(e.hole_height))/2);
    // Native primitive variants differ on whether offset fields apply. This
    // enclosing disc covers both the base and any displaced/rotated void.
    const x=e.x,y=e.y;radius+=Math.hypot(ox,oy);if(![x,y,radius].every(finite))throw Error('Native pad handoff drill bound is nonfinite');
    return reachesTop?[{x,y,radius}]:[];
  });
}
const pointSegmentDistance=(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>{
  const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
export interface NativePadHandoffAudit {
  ref: string; pad: string; netName: string; selector: string;
  route: NativeFanoutProposal['route'];
  diagnosticSourceTraceId: string; diagnosticSourcePortId: string;
  diagnosticPcbPortId: string; diagnosticSourceNetId: string;
  landId: string; lengthMm: number; widthMm: number;
  normal: {x:number;y:number};
  existingCopperOnly: true;
}
export function createNativePadHandoffs(
  circuit: any[], graph: PlanGraph, mapping: Record<string,Record<string,string>>,
  netNames: ReadonlySet<string>,
  options: {allowFinePitchPads?:boolean} = {},
) {
  if (!Array.isArray(circuit) || !Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || !mapping || typeof netNames?.has !== 'function' || typeof netNames[Symbol.iterator] !== 'function')
    throw Error('Native pad handoffs require actual circuit, graph, map and requested net set');
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='allowFinePitchPads')||options.allowFinePitchPads!==undefined&&typeof options.allowFinePitchPads!=='boolean')throw Error('Native pad handoff options are invalid');
  const proposals: NativeFanoutProposal[] = [], audit: NativePadHandoffAudit[] = [];
  if (!netNames.size) return {proposals,audit,netNames:[] as string[]};
  if (circuit.some(e => e.type === 'pcb_trace' || e.type === 'pcb_via')) throw Error('Native pad handoffs must be planned before routed copper');
  const sourceIssues = nativeNetlistIssues(graph,circuit,mapping), placement = nativePlacementIssues(graph,circuit);
  if (sourceIssues.length || !placement.ok) throw Error('Native pad handoff source/placement proof failed: ' + [...sourceIssues,...placement.issues].map(e=>e.message).join('; '));
  const board = one(circuit.filter(e=>e.type==='pcb_board'),'native board');
  if (![2,4].includes(board.num_layers)) throw Error('Native pad handoffs require a two/four-layer board');
  const minimum = board.min_trace_width ?? .15;
  if (!finite(minimum) || minimum <= 0) throw Error('Native pad handoff board width rule is invalid');
  const drills=options.allowFinePitchPads?topDrillVoids(circuit,board.num_layers):[];
  for (const name of netNames) {
    const net = one(graph.nets.filter(n=>n.name===name),'requested physical net ' + name);
    const sourceNet = one(circuit.filter(e=>e.type==='source_net'&&e.name===name),'named native source net');
    let selected: NativeFanoutProposal | undefined, proof: NativePadHandoffAudit | undefined;
    // Preserve default registered passive preference even when a fine-pitch
    // endpoint occurs earlier in the net. Fine owners are a private fallback.
    for (const fine of options.allowFinePitchPads ? [false,true] : [false]) {
    for (const endpoint of net.pins) {
      const placed = one(graph.parts.filter(p=>p.ref===endpoint.ref),'graph endpoint owner');
      const part = placed.part, pins = Object.entries(part.pins);
      const knownFine=placed.block.id==='rp2040-minimal'&&[3,4].includes(placed.block.version)&&
        ((part.lcsc==='C2040'&&part.mpn==='RP2040')||(part.lcsc==='C82317'&&part.mpn==='W25Q16JVSSIQ'));
      if(part.switch||part.omitPads?.length)continue;
      if(fine ? !knownFine : pins.length!==2||pins.some(([,p])=>p.role!=='passive'))continue;
      const source = one(circuit.filter(e=>e.type==='source_component'&&e.name===placed.ref),'passive source component');
      if (fine ? source.ftype!=='simple_chip' : !['simple_resistor','simple_capacitor','simple_inductor'].includes(source.ftype)) continue;
      const catalog = catalogPart(part.lcsc,part.catalogReceipt);
      if (catalog.mpn !== part.mpn || catalog.pins.length !== pins.length || catalog.pins.some(p=>!pins.some(([,pin])=>pin.pad===p.pad))) throw Error('Native pad handoff registered physical identity differs');
      if (source.manufacturer_part_number !== part.mpn || !source.supplier_part_numbers?.jlcpcb?.includes(part.lcsc)) throw Error('Native pad handoff supplier/manufacturer identity differs');
      const natives = pins.map(([,pin])=>{const n=mapping[placed.ref]?.[pin.pad];if(!n)throw Error('Native pad handoff physical import map is missing');return n;});
      const native = mapping[placed.ref]![endpoint.pad]!;
      const resolved = nativeComponentPorts(circuit,source,natives);
      const candidates=resolved.byNative.get(native)??[];
      const pin = one(fine?candidates.filter(p=>!/_internal_\d+$/.test(p.name)):candidates,'canonical physical source pin');
      const component = one(circuit.filter(e=>e.type==='pcb_component'&&e.source_component_id===source.source_component_id),'passive PCB component');
      const origin = component.footprint_origin, rotation = component.rotation;
      if (component.layer!=='top' || !finite(origin?.x) || !finite(origin?.y) || !finite(rotation)) continue;
      const q = Math.round(rotation/90); if (Math.abs(rotation-q*90)>EPS) continue;
      const port = one(circuit.filter(e=>e.type==='pcb_port'&&e.source_port_id===pin.source_port_id&&e.pcb_component_id===component.pcb_component_id),'actual passive PCB port');
      const lands = circuit.filter(e=>e.type==='pcb_smtpad'&&e.pcb_port_id===port.pcb_port_id&&e.pcb_component_id===component.pcb_component_id);
      if (lands.length!==1) continue;
      const land = lands[0];
      if (!['rect','rotated_rect'].includes(land.shape) || land.layer!=='top' || !port.layers?.includes('top') || !land.port_hints?.includes(native)) continue;
      if (![land.x,land.y,port.x,port.y,land.width,land.height].every(finite) || land.width<=0 || land.height<=0) throw Error('Native pad handoff land geometry is invalid');
      if (Math.hypot(port.x-land.x,port.y-land.y)>EPS) throw Error('Native pad handoff physical land/port coordinates differ');
      const angle = land.shape==='rotated_rect' ? land.ccw_rotation : land.ccw_rotation??0;
      if (!finite(angle) || Math.abs(angle/90-Math.round(angle/90))>EPS || (land.shape==='rect'&&Math.abs(angle%180)>EPS)) continue;
      if(fine&&[land.corner_radius,land.rect_border_radius].some(r=>r!==undefined&&(!finite(r)||r!==0)))continue;
      const local = turn({x:port.x-origin.x,y:port.y-origin.y},-q);
      let normal: {x:number;y:number};
      if(fine){
        const axis=turn(land.width>=land.height?{x:1,y:0}:{x:0,y:1},Math.round(angle/90));
        const sign=Math.sign((port.x-origin.x)*axis.x+(port.y-origin.y)*axis.y)||1;
        normal={x:axis.x*sign,y:axis.y*sign};
      }else if (Math.abs(local.y)<=EPS && Math.abs(local.x)>EPS) normal=turn({x:Math.sign(local.x),y:0},q);
      else if (Math.abs(local.x)<=EPS && Math.abs(local.y)>EPS) normal=turn({x:0,y:Math.sign(local.y)},q);
      else continue; // Do not guess a normal for an ambiguous body origin.
      const trace = one(circuit.filter(e=>e.type==='source_trace'&&e.connected_source_port_ids?.length===1&&e.connected_source_port_ids[0]===pin.source_port_id&&e.connected_source_net_ids?.length===1&&e.connected_source_net_ids[0]===sourceNet.source_net_id),'actual passive one-port-to-net source trace');
      if (!pin.subcircuit_connectivity_map_key || pin.subcircuit_connectivity_map_key!==trace.subcircuit_connectivity_map_key || sourceNet.subcircuit_connectivity_map_key!==trace.subcircuit_connectivity_map_key || pin.subcircuit_id!==trace.subcircuit_id || port.subcircuit_id!==trace.subcircuit_id || component.subcircuit_id!==trace.subcircuit_id || sourceNet.subcircuit_id!==trace.subcircuit_id) throw Error('Native pad handoff source/net/subcircuit membership differs');
      const width = trace.min_trace_thickness;
      if (!finite(width) || width<minimum) throw Error('Native pad handoff original source width violates board minimum');
      const start = {route_type:'wire' as const,x:port.x,y:port.y,layer:'top' as const,width};
      const end = {...start,x:start.x+normal.x*LENGTH,y:start.y+normal.y*LENGTH};
      const containsCapsule = (p: {x:number;y:number}) => {
        const at = turn({x:p.x-land.x,y:p.y-land.y},-Math.round(angle/90));
        return Math.abs(at.x)+width/2<=land.width/2-EPS && Math.abs(at.y)+width/2<=land.height/2-EPS;
      };
      if (![start,end].every(containsCapsule)) continue;
      if(fine){
        if(drills.some(d=>pointSegmentDistance(d,start,end)<=d.radius+width/2+EPS))continue;
        const checked=[...circuit,{type:'pcb_trace',pcb_trace_id:'native_contained_handoff_candidate',source_trace_id:trace.source_trace_id,subcircuit_id:trace.subcircuit_id,route:[start,end]}]as any;
        // Native clearance deliberately omits overlaps; run both public
        // overlap and near-clearance checks so a drill void cannot be copper.
        if(checkEachPcbTraceNonOverlapping(checked).length||checkHoleTraceClearance(checked).length)continue;
      }
      selected={ref:placed.ref,pad:endpoint.pad,route:[start,end]};
      proof={ref:placed.ref,pad:endpoint.pad,netName:name,selector:`.${placed.ref} > .${native}`,route:selected.route,diagnosticSourceTraceId:trace.source_trace_id,diagnosticSourcePortId:pin.source_port_id,diagnosticPcbPortId:port.pcb_port_id,diagnosticSourceNetId:sourceNet.source_net_id,landId:land.pcb_smtpad_id,lengthMm:LENGTH,widthMm:width,normal,existingCopperOnly:true};
      break;
    }
    if(selected)break;
    }
    if (!selected || !proof) throw Error(`No eligible registered ${options.allowFinePitchPads?'passive or known MCU/flash':'two-pin'} rectangular SMT pad can hold a0.20mm native handoff for net ${name}`);
    proposals.push(selected); audit.push(proof);
  }
  return {proposals,audit,netNames:audit.map(a=>a.netName)};
}
