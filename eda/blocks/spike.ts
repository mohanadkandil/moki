import { createElement as e, cloneElement, Children, isValidElement } from 'react';
import { RootCircuit } from 'tscircuit';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertCircuitJsonToPcbSvg, convertCircuitJsonToSchematicSvg } from 'circuit-to-svg';
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber';
import { convertCircuitJsonTo3D, convertSceneToGLTF } from 'circuit-json-to-gltf';
import { zipSync, strToU8 } from 'fflate';
import { toolVersions } from '../versions';

const output = resolve(process.argv[2] ?? 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/spike');
await mkdir(output,{recursive:true});
const stages: any[]=[]; const save=(name:string,data:string|Uint8Array)=>writeFile(resolve(output,name),data);
async function stage<T>(name:string,run:()=>Promise<T>):Promise<T>{const at=performance.now();try{const result=await run();stages.push({name,status:'done',ms:performance.now()-at});await save('progress.json',JSON.stringify(stages,null,2));return result;}catch(error){stages.push({name,status:'failed',ms:performance.now()-at,error:String(error)});throw error;}}
const parts=[
 ['U1','C2913198',0,18,0],['U2','C51118',-19,20.5,0],['U3','C7519',-12,-22,0],
 ['J1','C165948',-12,-29.3,0],['J2','C160404',20,21,180],
 ['SW1','C720477',-21,9,0],['SW2','C720477',20,8,0],
 ['C1','C15849',-24,20,90],['C2','C15849',-14,26,90],['C3','C45783',-18,28.5,0],['C4','C14663',-11,26,90],['C5','C15849',-11,22.5,90],
 ['R1','C25804',-14,22.5,0],['R2','C25804',14,8,0],['R3','C23186',-18,-22,90],['R4','C23186',-6,-22,90],
 ['R5','C23345',-14,-17,90],['R6','C23345',-10,-17,90],['R7','C25804',14,20,0],['R8','C25804',14,17,0],['R9','C25804',12,3,0],['R10','C25804',8,3,0],
].map(([ref,lcsc,x,y,rotation])=>({ref:String(ref),lcsc:String(lcsc),x:Number(x),y:Number(y),rotation:Number(rotation)}));
const nets:Record<string,string[]>={
 GND:['U1.1','U1.40','U1.41','U2.2','U3.2','J1.1','J1.2','J1.3','J1.4','J1.13','J1.14','J2.1','SW1.2','SW2.2','C1.2','C2.2','C3.2','C4.2','C5.2','R3.2','R4.2','R9.2','R10.2'],
 VBUS:['J1.15','J1.16','U2.1','U2.3','U3.5','C1.1'],
 V3V3:['U2.5','U1.2','J2.2','C2.1','C3.1','C4.1','R1.1','R2.1','R7.1','R8.1'],
 EN:['U1.3','R1.2','C5.1','SW1.1'],BOOT:['U1.27','R2.2','SW2.1'],
 CC1:['J1.6','R3.1'],CC2:['J1.12','R4.1'],
 USB_DP:['J1.8','J1.10','U3.1','U3.6','R5.1'],USB_DM:['J1.7','J1.9','U3.3','U3.4','R6.1'],
 USB_DP_MCU:['R5.2','U1.14'],USB_DM_MCU:['R6.2','U1.13'],
 SDA:['U1.12','J2.3','R7.2'],SCL:['U1.17','J2.4','R8.2'],
 STRAP45:['U1.26','R9.1'],STRAP46:['U1.16','R10.1'],
};
await save('input.json',JSON.stringify({board:{widthMm:60,heightMm:70,layers:2},parts,nets},null,2));
try {
 const nodes:any[]=[];
 await stage('imported-components',async()=>{
  for(const p of parts){const module=await import(resolve(import.meta.dir,'parts',p.lcsc,'part.tsx'));const component=Object.values(module).find(v=>typeof v==='function');if(!component)throw new Error(`No imported component ${p.lcsc}`);
   let element=(component as any)({name:p.ref,pcbX:p.x,pcbY:p.y,pcbRotation:p.rotation});
   if(p.lcsc==='C2913198') {
    // Imported thermal vias have no GND net and only a 0.075 mm annulus.
    // The manufacturer's EP solder/thermal vias are optional; retain all pads.
    const fp=element.props.footprint;
    element=cloneElement(element,{footprint:cloneElement(fp,{children:Children.toArray(fp.props.children).filter((child:any)=>!isValidElement(child)||child.type!=='via')})});
   }
   nodes.push(element);
  }
 });
 await save('import-corrections.json',JSON.stringify([{lcsc:'C2913198',action:'Omit 12 unassigned footprint thermal vias; retain every electrical pad and model',reason:'Importer vias have 0.2499868 mm drill / 0.3999992 mm outer and no GND net; EP solder/thermal vias are optional in manufacturer reference. No source footprint file changed.',citation:'https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf#page=41'}],null,2));
 for(const [name,pins] of Object.entries(nets)){
  nodes.push(e('net',{name}));
  for(const pin of pins){const [ref,pad]=pin.split('.');nodes.push(e('trace',{from:`.${ref} > .pin${pad}`,to:`net.${name}`,thickness:['GND','VBUS','V3V3'].includes(name)?.3:.15}));}
 }
 nodes.push(e('keepout',{name:'RF_ANTENNA',shape:'rect',pcbX:0,pcbY:31.4,width:29,height:7.2,layers:['top','bottom'],excludeRefs:['.U1']}));
 for(const layer of ['top','bottom']) nodes.push(e('copperpour',{name:`GND_${layer}`,layer,connectsTo:'net.GND',clearance:.2,boardEdgeMargin:.3,useThermalReliefs:true,coveredWithSolderMask:true}));
 const circuit=new RootCircuit();
 await stage('render-route',async()=>{
  circuit.add(e('board',{width:60,height:70,layers:2,schAutoLayoutEnabled:true,minTraceWidth:.15,minTraceToPadEdgeClearance:.127,minPadEdgeToPadEdgeClearance:.127,minViaEdgeToPadEdgeClearance:.127,minViaHoleDiameter:.3,minViaPadDiameter:.6,pcbStyle:{viaHoleDiameter:.3,viaPadDiameter:.6},autorouter:{preset:'auto'}},...nodes));
  circuit.render();await circuit.renderUntilSettled();
 });
 const cj:any[]=circuit.getCircuitJson();await save('circuit.json',JSON.stringify(cj,null,2));
 const errors=cj.filter(x=>x.type.endsWith('_error')).map(x=>({type:x.type,message:x.message??x.error_type}));
 await save('drc.json',JSON.stringify({checked:true,errors},null,2));
 await stage('svg',async()=>{await save('pcb.svg',convertCircuitJsonToPcbSvg(cj));await save('schematic.svg',convertCircuitJsonToSchematicSvg(cj));});
 await stage('gerbers-bom-cpl',async()=>{
  const files=convertCircuitJsonToGerberFiles(cj);await save('gerbers.zip',zipSync(Object.fromEntries(Object.entries(files).map(([n,s])=>[n,strToU8(s)]))));
  const csv=(s:unknown)=>`"${String(s??'').replaceAll('"','""')}"`;
  const bom=['Comment,Designator,Footprint,LCSC Part #,Review status'];const cpl=['Designator,Mid X,Mid Y,Layer,Rotation,LCSC Part #,Review status'];
  for(const part of parts){const source=cj.find(x=>x.type==='source_component'&&x.name===part.ref);const pcb=cj.find(x=>x.type==='pcb_component'&&x.source_component_id===source?.source_component_id);if(!pcb)throw new Error(`Missing placement ${part.ref}`);
   const raw=JSON.parse(await readFile(resolve(import.meta.dir,'parts',part.lcsc,'raw.json'),'utf8'));const mpn=raw.dataStr?.head?.c_para?.name??raw.title;
   if((raw.lcsc??raw.szlcsc)?.number!==part.lcsc)throw new Error(`Catalog identity mismatch ${part.ref}`);
   bom.push([mpn,part.ref,raw.packageDetail?.title??'imported',part.lcsc,'unreviewed'].map(csv).join(','));
   cpl.push([part.ref,pcb.footprint_origin?.x??pcb.center.x,pcb.footprint_origin?.y??pcb.center.y,pcb.layer??'top',pcb.rotation,part.lcsc,'unreviewed'].map(csv).join(','));
  }await save('bom.csv',bom.join('\n')+'\n');await save('cpl.csv',cpl.join('\n')+'\n');
 });
 await stage('gltf',async()=>{const scene=await convertCircuitJsonTo3D(cj,{renderBoardTextures:true,textureResolution:768,pcbColor:'#14492f',solderMaskWithCopperColor:'#1a5a3a'});const glb=await convertSceneToGLTF(scene,{binary:true,embedImages:true,forceIndices:true});await save('board.glb',new Uint8Array(glb as ArrayBuffer));});
 const receipt={ok:!errors.length,stages,totalMs:performance.now(),drc:{checked:true,errors},parts:parts.length,traceCount:cj.filter(x=>x.type==='pcb_trace').length,viaCount:cj.filter(x=>x.type==='pcb_via').length,pours:cj.filter(x=>x.type==='pcb_copper_pour').length,keepouts:cj.filter(x=>x.type==='pcb_keepout').length,cadModels:cj.filter(x=>x.type==='cad_component'&&x.model_obj_url).length,versions:await toolVersions(),physicalBuild:false};
 await save('receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=errors.length?2:0;
} catch(error){await save('failure.json',JSON.stringify({error:String(error),stages,totalMs:performance.now()},null,2));console.error(error);process.exitCode=1;}
