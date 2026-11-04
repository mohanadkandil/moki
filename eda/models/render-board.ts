import { convertCircuitJsonTo3D, convertSceneToGLTF, renderBoardTextures } from 'circuit-json-to-gltf';
import { MODULE_MECH } from '../enclosure/module-mech';
import { detailedModulePieces } from './catalog-models';
import { compactGlb } from './compact-glb';
import { readGlb, writeGlb } from './glb';

export const MASKS = {
  green: { background: '#14492f', copper: '#1a5a3a' },
  black: { background: '#202426', copper: '#25292a' },
  blue: { background: '#123b68', copper: '#23558a' },
  white: { background: '#e0e2d8', copper: '#c4cbbf' },
} as const;
/** PBR board texture variants are embedded. The stage swaps the full top/bottom material,
 * not a tint, which preserves white silk and gold pads when changing solder mask colour. */
export async function renderDetailedBoard(cj: any[], metadata?: { parts: { id: string; module: string; value?: string }[] }): Promise<Uint8Array> {
  const roles = new Map<string, { name: string; ref: string; moduleId: string; role: string }>();
  const renderCj = cj.flatMap(e => {
    if(e.type !== 'cad_component') return [e];
    const source = cj.find(s => s.type === 'source_component' && s.source_component_id === e.source_component_id);
    const part = metadata?.parts.find(p => p.id === source?.name);
    if(!part) return [e];
    const pieces = detailedModulePieces(part.module, part.value);
    return ['module','socket'].flatMap(role => {
      const shapes=pieces.filter(p=>p.role===role).map(p=>p.plan);
      if(!shapes.length)return [];
      const id=`${e.cad_component_id}:${role}`;
      const name=`${part.id}:${role==='socket'?'socket':part.module}`;
      roles.set(id,{name,ref:part.id,moduleId:part.module,role});
      // Native size and explicit origin: the unchanged catalog geometry sets its own envelope.
      return [{...e,cad_component_id:id,size:undefined,model_jscad:shapes}];
    });
  });
  const scene = await convertCircuitJsonTo3D(renderCj, {
    renderBoardTextures: true, textureResolution: 768, pcbColor: MASKS.green.background,
    copperColor: '#d6b96d', silkscreenColor: '#f1f1e5', solderMaskWithCopperColor: MASKS.green.copper,
    boardSideColor: '#4d5234', boardDrillQuality: 'fast',
  });
  for(const b of scene.boxes) {
    const identity=roles.get(b.componentMetadata?.cad_component_id ?? '');
    if(identity)b.label=identity.name;
  }
  const data=await convertSceneToGLTF(scene,{binary:true,embedImages:true,forceIndices:true});
  const {gltf,bin}=readGlb(new Uint8Array(data as ArrayBuffer));
  for(const n of gltf.nodes??[]) {
    const identity=roles.get(n.extras?.tscircuit?.cad_component_id);
    if(identity)n.extras={...n.extras,moki:{role:identity.role,part:identity.ref,module:identity.moduleId,seatHeightMm:identity.role==='socket'?0:Math.max(0,MODULE_MECH[identity.moduleId]!.socketMm-1.4),estimated:true}};
  }
  // Find the board material(s) by their textured top/bottom primitives. Other CAD materials stay as authored.
  const boardNode=(gltf.nodes??[]).find((n:any)=>!n.extras?.tscircuit && n.mesh !== undefined);
  const boardMesh=boardNode?gltf.meshes[boardNode.mesh]:gltf.meshes.find((m:any)=>m.primitives?.some((p:any)=>gltf.materials[p.material]?.name?.includes('top')));
  const materialMap: Record<string, number[]> = {};
  const chunks: Uint8Array[]=[bin]; let offset=bin.length;
  for(const [name,palette] of Object.entries(MASKS)) {
    if(name==='green') {
      const top=gltf.materials.findIndex((m:any)=>m.name?.startsWith('TopMaterial_'));
      const bottom=gltf.materials.findIndex((m:any)=>m.name?.startsWith('BottomMaterial_'));
      for(const i of [top,bottom]) { gltf.materials[i].pbrMetallicRoughness.metallicFactor=.16; gltf.materials[i].pbrMetallicRoughness.roughnessFactor=.44; }
      materialMap[name]=[top,bottom]; continue;
    }
    const textures=await renderBoardTextures(cj,{resolution:768,backgroundColor:palette.background,copperColor:'#d6b96d',silkscreenColor:name==='white'?'#364039':'#f1f1e5',solderMaskWithCopperColor:palette.copper});
    const indices:number[]=[];
    // Store variant images/materials in a standard GLB extension-free extras contract.
    for(const [face,dataUrl] of Object.entries(textures)) {
      const encoded=dataUrl.slice(dataUrl.indexOf(',')+1); const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
      const pad=(4-offset%4)%4;if(pad){chunks.push(new Uint8Array(pad));offset+=pad;}
      const view=gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length})-1;
      chunks.push(bytes);offset+=bytes.length;
      const img=gltf.images.push({bufferView:view,mimeType:'image/png',name:`mask-${name}-${face}`})-1;
      const tex=gltf.textures.push({source:img})-1;
      indices.push(gltf.materials.push({name:`moki-mask-${name}-${face}`,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],baseColorTexture:{index:tex},metallicFactor:.16,roughnessFactor:.44},doubleSided:false})-1);
    }
    materialMap[name]=indices;
  }
  // Names are sufficient for three's GLTFParser.getDependency('material', index).
  gltf.asset.extras={...(gltf.asset.extras??{}),moki:{modelVersion:2,maskMaterials:materialMap,maskFaces:['top','bottom'],defaultMask:'green'}};
  if(boardMesh) for(const p of boardMesh.primitives) {
    const m=gltf.materials[p.material];
    if(m?.name?.toLowerCase().includes('top'))p.material=materialMap.green![0];
    if(m?.name?.toLowerCase().includes('bottom'))p.material=materialMap.green![1];
  }
  const total=new Uint8Array(offset);let cursor=0;for(const c of chunks){total.set(c,cursor);cursor+=c.length;}
  return compactGlb(writeGlb(gltf,total));
}
