import type { BlockDef, BlockPart, BoardPlan, Pose } from '../../src/blocks/contract.js';
import { planGraph, type PlanGraph } from '../../src/blocks/graph.js';
import { footprintEnvelope, type FootprintEnvelope } from './legalize.js';

const GAP = 1.5, WIGGLE = 1, EDGE = .15, EPS = 1e-7;
type Box = FootprintEnvelope;
interface Variant { rotation: number; parts: Box[]; keepouts: Box[]; envelope: Box; reserved: Box; antenna?: Box }
interface Group { inst: string; section: string; explicit?: Pose; variants: Variant[]; order: number; mcu: boolean }
export interface AutoPlacementOptions { envelopes?: Map<BlockPart, FootprintEnvelope>; ranking?: 'signal-hpwl'|'legacy' }
export interface SectionPlacement { inst: string; section: string; explicit: boolean; at: Pose; envelope: Box; reserved: Box; edge?: 'top' }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const corners = (b: Box) => [{x:b.minX,y:b.minY},{x:b.minX,y:b.maxY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY}];
function box(points: Array<{x:number;y:number}>): Box {
  if(!points.length||points.some(p=>!finite(p.x)||!finite(p.y)))throw Error('Automatic placement needs finite actual footprint geometry');
  const b={minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
  if(b.maxX-b.minX<=EPS||b.maxY-b.minY<=EPS)throw Error('Automatic placement needs nondegenerate footprint envelopes');return b;
}
function transform(b: Box, at: Pose): Box {const a=(at.rotation??0)*Math.PI/180;return box(corners(b).map(p=>({x:at.x+p.x*Math.cos(a)-p.y*Math.sin(a),y:at.y+p.x*Math.sin(a)+p.y*Math.cos(a)})));}
const union=(items:Box[])=>box(items.flatMap(corners));
const translate=(b:Box,at:Pose)=>({minX:b.minX+at.x,maxX:b.maxX+at.x,minY:b.minY+at.y,maxY:b.maxY+at.y});
const expanded=(b:Box,padding=WIGGLE)=>({minX:b.minX-padding,maxX:b.maxX+padding,minY:b.minY-padding,maxY:b.maxY+padding});
const width=(b:Box)=>b.maxX-b.minX, height=(b:Box)=>b.maxY-b.minY;
function inside(b:Box,board:NonNullable<BoardPlan['board']>,margin:number){
  const hw=board.widthMm/2-margin,hh=board.heightMm/2-margin,r=Math.max(0,(board.cornerRadiusMm??0)-margin);
  return corners(b).every(p=>Math.abs(p.x)<=hw+EPS&&Math.abs(p.y)<=hh+EPS&&(!r||Math.hypot(Math.max(0,Math.abs(p.x)-(hw-r)),Math.max(0,Math.abs(p.y)-(hh-r)))<=r+EPS));
}
const overlap=(a:Box,b:Box)=>a.minX<b.maxX+GAP-EPS&&a.maxX+GAP>b.minX+EPS&&a.minY<b.maxY+GAP-EPS&&a.maxY+GAP>b.minY+EPS;
const ceil2=(v:number)=>Math.ceil((v-EPS)/2)*2;
function groupFor(plan:BoardPlan,graph:PlanGraph,imports:Map<BlockPart,any>,options:AutoPlacementOptions,inst:BoardPlan['blocks'][number],order:number):Group {
  const parts=graph.parts.filter(p=>p.inst===inst.inst);if(!parts.length)throw Error(`Automatic placement has no parts for ${inst.inst}`);
  const block=parts[0]!.block;
  const localParts=parts.map(p=>{const envelope=options.envelopes?.get(p.part)??(imports.has(p.part)?footprintEnvelope(p.part,imports.get(p.part)):undefined);if(!envelope)throw Error(`Automatic placement missing actual footprint ${p.inst}.${p.localRef}`);if(![envelope.minX,envelope.maxX,envelope.minY,envelope.maxY].every(finite)||envelope.maxX<=envelope.minX||envelope.maxY<=envelope.minY)throw Error(`Automatic placement invalid footprint envelope ${p.inst}.${p.localRef}`);return transform(envelope,p.part.at);});
  const constraints=block.constraints.filter(c=>c.kind==='keepout');
  const keepouts=constraints.map(c=>{if(!finite(c.x)||!finite(c.y)||!finite(c.width)||!finite(c.height)||c.width<=0||c.height<=0)throw Error(`Automatic placement invalid keepout ${inst.inst}`);return {minX:c.x-c.width/2,maxX:c.x+c.width/2,minY:c.y-c.height/2,maxY:c.y+c.height/2};});
  const antennaIndex=block.mcu?constraints.findIndex(c=>/antenna/i.test(c.purpose)):-1;
  let antennaAngle=0;
  if(antennaIndex>=0){const k=keepouts[antennaIndex]!,primary=localParts[0]!,dx=(k.minX+k.maxX-primary.minX-primary.maxX)/2,dy=(k.minY+k.maxY-primary.minY-primary.maxY)/2;antennaAngle=Math.abs(dx)>Math.abs(dy)?dx>=0?90:270:dy>=0?0:180;}
  const rotations=inst.at?[inst.at.rotation??0]:antennaIndex>=0?[antennaAngle]:block.mcu?[0,90,180,270]:block.constraints.some(c=>c.kind==='usb-c-sink')?[0]:[0,90];
  const variants=rotations.map(rotation=>{
    const at={x:0,y:0,rotation},ps=localParts.map(b=>transform(b,at)),ks=keepouts.map(b=>transform(b,at)),envelope=union([...ps,...ks]),reserved=expanded(envelope),antenna=antennaIndex>=0?ks[antennaIndex]:undefined;
    if(antenna&&!inst.at){
      if(Math.max(...ps.map(b=>b.maxY))+EDGE>antenna.maxY+EPS)throw Error(`Automatic antenna section ${inst.inst} has physical parts beyond its declared top keepout`);
      reserved.maxY=antenna.maxY;
    }
    return {rotation,parts:ps,keepouts:ks,envelope,reserved,...antenna?{antenna}:{}};
  });
  return {inst:inst.inst,section:plan.sections?.find(s=>s.insts.includes(inst.inst))?.id??inst.inst,...inst.at?{explicit:{...inst.at}}:{},variants,order,mcu:!!block.mcu};
}
type SignalPart = { ref: string; inst: string; x: number; y: number };
type SignalNet = SignalPart[];
const atWorld = (p: { x: number; y: number }, at: Pose) => {
  const angle = (at.rotation ?? 0) * Math.PI / 180;
  return { x: at.x + p.x * Math.cos(angle) - p.y * Math.sin(angle),
    y: at.y + p.x * Math.sin(angle) + p.y * Math.cos(angle) };
};
function crossSignalNets(graph: PlanGraph): SignalNet[] {
  const parts = new Map(graph.parts.map(p => [p.ref, p]));
  return graph.nets.flatMap(net => {
    const pins = net.pins.map(pin => {
      const part = parts.get(pin.ref), physical = part?.part.pins[pin.logical];
      if (!part || !physical) throw Error('Automatic signal placement needs canonical part/pin references');
      return { part, role: physical.role };
    });
    if (pins.some(p => ['power-in', 'power-out', 'ground'].includes(p.role))) return [];
    const distinct = [...new Map(pins.map(p => [p.part.ref, p.part])).values()];
    if (new Set(distinct.map(p => p.inst)).size < 2) return [];
    return [distinct.map(p => ({ ref: p.ref, inst: p.inst, x: p.part.at.x, y: p.part.at.y }))];
  });
}
function pack(groups:Group[],board:NonNullable<BoardPlan['board']>,signals:SignalNet[],rankSignals:boolean,preferMcuAspect=true):SectionPlacement[]|undefined {
  const placed:SectionPlacement[]=[];
  const fitsBoard=(v:Variant,at:Pose,reserve:boolean)=>v.parts.every(b=>inside(translate(b,at),board,EDGE))&&v.keepouts.every(b=>inside(translate(b,at),board,0))&&(!reserve||inside(translate(v.reserved,at),board,0));
  for(const g of groups.filter(g=>g.explicit)){
    const at=g.explicit!,v=g.variants[0]!;
    // Explicit anchors retain the legalizer's existing secondary-part policy.
    if(!inside(translate(v.parts[0]!,at),board,EDGE)||!v.keepouts.every(b=>inside(translate(b,at),board,0)))return;
    placed.push({inst:g.inst,section:g.section,explicit:true,at:{...at},envelope:translate(v.envelope,at),reserved:translate(v.reserved,at)});
  }
  const missing=groups.filter(g=>!g.explicit).sort((a,b)=>Number(!!b.variants[0]!.antenna)-Number(!!a.variants[0]!.antenna)||a.order-b.order);
  for(const g of missing){
    let chosen:SectionPlacement|undefined, chosenScore=Infinity, chosenAspect=Infinity;
    const byInst = new Map(placed.map(p => [p.inst, p.at]));
    // Only already-placed peers can affect this greedy step. Deduplicated
    // canonical part centres avoid counting a module anchor or pin aliases.
    const links = rankSignals ? signals.flatMap(net => {
      const local = net.filter(p => p.inst === g.inst);
      const target = net.filter(p => p.inst !== g.inst && byInst.has(p.inst))
        .map(p => atWorld(p, byInst.get(p.inst)!));
      return local.length && target.length ? [{local, target}] : [];
    }) : [];
    const aspect = (v:Variant) => Math.abs(Math.log(width(v.envelope)/height(v.envelope)/(board.widthMm/board.heightMm)));
    const variants=g.mcu&&preferMcuAspect?[...g.variants].sort((a,b)=>aspect(a)-aspect(b)):g.variants;
    for(const v of variants){
      const b=v.reserved,xs=[-board.widthMm/2-b.minX,board.widthMm/2-b.maxX,-(b.minX+b.maxX)/2],ys=[board.heightMm/2-b.maxY,-board.heightMm/2-b.minY,-(b.minY+b.maxY)/2];
      if(v.antenna)xs.unshift(-(v.antenna.minX+v.antenna.maxX)/2);
      for(const p of placed){xs.push(p.reserved.maxX+GAP-b.minX,p.reserved.minX-GAP-b.maxX,p.reserved.minX-b.minX,p.reserved.maxX-b.maxX);ys.push(p.reserved.maxY+GAP-b.minY,p.reserved.minY-GAP-b.maxY,p.reserved.minY-b.minY,p.reserved.maxY-b.maxY);}
      for (const link of links) for (const p of link.local) {
        const local = atWorld(p, {x:0,y:0,rotation:v.rotation});
        for (const target of link.target) { xs.push(target.x-local.x); ys.push(target.y-local.y); }
      }
      const unique=(values:number[])=>[...new Set(values.flatMap(n=>[Math.floor(n*4)/4,Math.ceil(n*4)/4]))];
      // Discard only axes that cannot enclose the reserved rectangle; rounded
      // corners and every actual footprint/keepout are still checked below.
      const ux=unique(xs).filter(x=>!rankSignals||(x+b.minX>=-board.widthMm/2-EPS&&x+b.maxX<=board.widthMm/2+EPS));
      const uy=unique(ys).filter(y=>!rankSignals||(y+b.minY>=-board.heightMm/2-EPS&&y+b.maxY<=board.heightMm/2+EPS));
      const candidates=ux.flatMap(x=>(v.antenna?[board.heightMm/2-v.antenna.maxY]:uy).map(y=>({x,y,rotation:v.rotation})));
      candidates.sort((a,c)=>v.antenna?Math.abs(a.x+(v.antenna!.minX+v.antenna!.maxX)/2)-Math.abs(c.x+(v.antenna!.minX+v.antenna!.maxX)/2)||a.x-c.x:c.y-a.y||a.x-c.x);
      for(const at of candidates){
        const reserved=translate(b,at);
        if(!fitsBoard(v,at,true)||placed.some(p=>overlap(reserved,p.reserved)))continue;
        const candidate={inst:g.inst,section:g.section,explicit:false,at,envelope:translate(v.envelope,at),reserved,...v.antenna?{edge:'top' as const}:{}};
        if(!rankSignals){chosen=candidate;break;}
        const cost=links.reduce((sum,link)=>{
          const points=[...link.target,...link.local.map(p=>atWorld(p,at))];
          return sum+Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
        },0),axis=g.mcu?aspect(v):0;
        // MCU aspect preference is unchanged; signal distance ranks all
        // feasible placements within that preference, then legacy order ties.
        if(!chosen||axis<chosenAspect||(axis===chosenAspect&&cost<chosenScore-EPS)){
          chosen=candidate;chosenScore=cost;chosenAspect=axis;
        }
      }
      if(chosen&&!rankSignals)break;
    }
    if(!chosen)return;
    placed.push(chosen);
  }
  return groups.map(g=>placed.find(p=>p.inst===g.inst)!);
}
function packWithFallback(groups:Group[],board:NonNullable<BoardPlan['board']>,signals:SignalNet[],ranking:'signal-hpwl'|'legacy'){
  if(ranking==='legacy'){
    const legacy=pack(groups,board,signals,false,false);
    return legacy?{placements:legacy,strategy:'legacy' as const}:undefined;
  }
  const ranked=pack(groups,board,signals,true);
  if(ranked)return{placements:ranked,strategy:'signal-hpwl' as const};
  const legacy=pack(groups,board,signals,false);
  return legacy?{placements:legacy,strategy:'legacy' as const}:undefined;
}

/** Compiler-owned section anchors. Public input/electrical data are never mutated. */
export function placePlanSections(plan:BoardPlan,graph:PlanGraph,imports:Map<BlockPart,any>,options:AutoPlacementOptions={}) {
  const ranking=options.ranking??'signal-hpwl';
  if(!['signal-hpwl','legacy'].includes(ranking))throw Error('Unsupported automatic placement ranking');
  if(!Array.isArray(plan.blocks)||!plan.blocks.length||plan.blocks.length>128)throw Error('Automatic placement needs1–128 block instances');
  if(plan.board!==undefined&&!plan.board)throw Error('Automatic placement received invalid explicit board dimensions');
  for(const instance of plan.blocks)if(instance.at!==undefined&&(!instance.at||![instance.at.x,instance.at.y,instance.at.rotation??0].every(finite)))throw Error(`Automatic placement received invalid explicit anchor ${instance.inst}`);
  const effective=structuredClone(plan);
  let groups=plan.blocks.map((instance,index)=>groupFor(plan,graph,imports,options,instance,index));
  const signals=crossSignalNets(graph);
  const boardAuto=plan.board===undefined;
  let packingStrategy:'signal-hpwl'|'legacy'='legacy';
  let reservePaddingMm=WIGGLE;
  let board=plan.board?{...plan.board}:undefined,placements:SectionPlacement[]|undefined;
  if(board){
    if(!finite(board.widthMm)||!finite(board.heightMm)||board.widthMm<=0||board.heightMm<=0||!finite(board.cornerRadiusMm??0)||(board.cornerRadiusMm??0)<0||(board.cornerRadiusMm??0)>Math.min(board.widthMm,board.heightMm)/2)throw Error('Automatic placement received invalid explicit board dimensions');
    // Optional legalization room may shrink inside an explicit maker outline;
    // actual courtyards, keepouts, the1.5mm section gap and board rules stay hard.
    for(const padding of [WIGGLE,.5,0]){
      const trial=groups.map(group=>({...group,variants:group.variants.map(variant=>{
        const reserved=expanded(variant.envelope,padding);
        if(variant.antenna&&!group.explicit)reserved.maxY=variant.antenna.maxY;
        return {...variant,reserved};
      })}));
      const packed=packWithFallback(trial,board,signals,ranking);placements=packed?.placements;
      if(packed)packingStrategy=packed.strategy;groups=trial;reservePaddingMm=padding;
      if(placements)break;
    }
  }else{
    let maxW=Infinity,maxH=Infinity;
    for(const r of plan.requirements??[])if(r.metric==='board_size_mm'&&['<=','within'].includes(r.op??'')&&Array.isArray(r.value)&&r.value.length===2&&r.value.every(v=>finite(v)&&v>0)){maxW=Math.min(maxW,r.value[0]!);maxH=Math.min(maxH,r.value[1]!);}
    const fixed=groups.filter(g=>g.explicit).map(g=>translate(g.variants[0]!.reserved,g.explicit!));
    const minW=Math.max(6,...groups.map(g=>Math.min(...g.variants.map(v=>width(v.reserved))))),minH=Math.max(6,...groups.map(g=>Math.min(...g.variants.map(v=>height(v.reserved)))));
    const fixedW=Math.max(0,...fixed.flatMap(b=>[Math.abs(b.minX)*2,Math.abs(b.maxX)*2])),fixedH=Math.max(0,...fixed.flatMap(b=>[Math.abs(b.minY)*2,Math.abs(b.maxY)*2]));
    const area=groups.reduce((n,g)=>n+Math.min(...g.variants.map(v=>width(v.reserved)*height(v.reserved))),0),sumW=groups.reduce((n,g)=>n+width(g.variants[0]!.reserved)+GAP,0)+fixedW+4,sumH=groups.reduce((n,g)=>n+height(g.variants[0]!.reserved)+GAP,0)+fixedH+4;
    const lowerW=ceil2(Math.max(minW,fixedW)),lowerH=ceil2(Math.max(minH,fixedH));
    const widths=[...new Set([...Array.from({length:13},(_,i)=>lowerW+i*2),...[.7,.85,1,1.2,1.5,2,3].map(k=>ceil2(Math.max(lowerW,Math.sqrt(area)*k))),ceil2(Math.max(lowerW,sumW)),...(finite(maxW)?[maxW]:[])])].filter(w=>w>=lowerW-EPS&&w<=maxW+EPS).sort((a,b)=>a-b);
    let bestArea=Infinity,bestAspect=Infinity;
    for(const w of widths){const upperH=Math.min(maxH,ceil2(Math.max(lowerH,sumH)));let tried=0;
      for(let h=lowerH;h<=upperH+EPS&&tried<512;h+=2,tried++){
        if(w*h>bestArea+EPS)break;
        const candidate={widthMm:w,heightMm:h,cornerRadiusMm:2},packed=packWithFallback(groups,candidate,signals,ranking),result=packed?.placements;
        if(result){const aspect=Math.abs(Math.log(w/h));if(w*h<bestArea-EPS||aspect<bestAspect){board=candidate;placements=result;packingStrategy=packed!.strategy;bestArea=w*h;bestAspect=aspect;}break;}
      }
      if(!placements&&finite(maxH)&&maxH>=lowerH&&maxH<=upperH&&!Number.isInteger((maxH-lowerH)/2)){const candidate={widthMm:w,heightMm:maxH,cornerRadiusMm:2},packed=packWithFallback(groups,candidate,signals,ranking),result=packed?.placements;if(result&&w*maxH<bestArea){board=candidate;placements=result;packingStrategy=packed!.strategy;bestArea=w*maxH;bestAspect=Math.abs(Math.log(w/maxH));}}
    }
  }
  if(!board||!placements){const bounds=plan.board?`${plan.board.widthMm}×${plan.board.heightMm}mm explicit board`:'automatic board within confirmed size limits';const largest=groups.map(g=>`${g.inst} ${[...new Set(g.variants.map(v=>`${width(v.reserved).toFixed(2)}×${height(v.reserved).toFixed(2)}mm`))].join(' or ')}`).join(', ');throw Error(`Automatic section packing found no arrangement in ${bounds}; reserved section envelopes: ${largest}. Explicit anchors, keepouts and board limits were preserved.`);}
  effective.board={...board};
  for(const instance of effective.blocks)if(!instance.at)instance.at={...placements.find(p=>p.inst===instance.inst)!.at};
  const definitions:BlockDef[]=[];for(const p of graph.parts)if(!definitions.some(b=>b.id===p.block.id&&b.version===p.block.version))definitions.push(p.block);
  const placedGraph=planGraph(effective,definitions);
  if(placedGraph.parts.length!==graph.parts.length||JSON.stringify(placedGraph.nets)!==JSON.stringify(graph.nets)||placedGraph.parts.some((p,i)=>p.ref!==graph.parts[i]?.ref))throw Error('Automatic placement changed source connectivity or reference allocation');
  return {plan:effective,graph:placedGraph,placements,boardAuto,reservePaddingMm,packingStrategy};
}
