import { readGlb, writeGlb } from './glb';
/** Lossless vertex sharing. JSCAD emits triangle soup; deduplicate only equal complete
 * vertex tuples (position, flat normal and UV), retaining all hard edges and material seams. */
export function compactGlb(input: Uint8Array): Uint8Array {
  const {gltf,bin}=readGlb(input);
  if(gltf.animations?.length||gltf.skins?.length||gltf.meshes?.some((m:any)=>m.primitives.some((p:any)=>p.targets)))return input;
  const originalViews=gltf.bufferViews;
  const views:any[]=[...originalViews],accessors:any[]=[],chunks:Uint8Array[]=[bin];let offset=bin.length;
  const add=(array:Float32Array|Uint16Array|Uint32Array,description:any)=>{
    const padding=(4-offset%4)%4;if(padding){chunks.push(new Uint8Array(padding));offset+=padding;}
    const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    const view=views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target:description.type==='SCALAR'?34963:34962})-1;
    chunks.push(bytes);offset+=bytes.length;
    return accessors.push({...description,bufferView:view,byteOffset:0})-1;
  };
  const dims:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  for(const mesh of gltf.meshes??[])for(const primitive of mesh.primitives) {
    const names=Object.keys(primitive.attributes),attrs=names.map(name=>gltf.accessors[primitive.attributes[name]]);
    if(attrs.some(a=>a.componentType!==5126||a.sparse||!dims[a.type]))return input;
    const buffers=attrs.map(a=>{const v=originalViews[a.bufferView];return new DataView(bin.buffer,bin.byteOffset+(v.byteOffset??0)+(a.byteOffset??0));});
    const values:number[][]=attrs.map(()=>[]),indices:number[]=[],seen=new Map<string,number>();
    const count=attrs[0].count;
    // Share vertices in source order, then preserve the original index order verbatim.
    const mapping:number[]=[];
    for(let i=0;i<count;i++) {
      const tuple=attrs.map((a,k)=>Array.from({length:dims[a.type]!},(_,j)=>buffers[k]!.getFloat32(i*(originalViews[a.bufferView].byteStride??dims[a.type]!*4)+j*4,true)));
      const key=tuple.flat().join(',');let index=seen.get(key);
      if(index===undefined){index=seen.size;seen.set(key,index);tuple.forEach((v,k)=>values[k]!.push(...v));}
      mapping.push(index);
    }
    if(primitive.indices!==undefined){
      const a=gltf.accessors[primitive.indices],v=originalViews[a.bufferView];
      const view=new DataView(bin.buffer,bin.byteOffset+(v.byteOffset??0)+(a.byteOffset??0));
      const bytes=a.componentType===5125?4:a.componentType===5123?2:1;
      for(let i=0;i<a.count;i++){const source=bytes===4?view.getUint32(i*4,true):bytes===2?view.getUint16(i*2,true):view.getUint8(i);indices.push(mapping[source]!);}
    }else indices.push(...mapping);
    names.forEach((name,k)=>{const {bufferView,byteOffset,...meta}=attrs[k];primitive.attributes[name]=add(new Float32Array(values[k]!),{...meta,count:seen.size});});
    const small=seen.size<=65535;
    primitive.indices=add(small?new Uint16Array(indices):new Uint32Array(indices),{componentType:small?5123:5125,count:indices.length,type:'SCALAR'});
  }
  const combined=new Uint8Array(offset);let cursor=0;for(const c of chunks){combined.set(c,cursor);cursor+=c.length;}
  gltf.accessors=accessors;
  // Drop the original triangle-soup views; retain images and all live compacted attributes.
  const used=new Set<number>([...accessors.map(a=>a.bufferView),...(gltf.images??[]).filter((i:any)=>i.bufferView!==undefined).map((i:any)=>i.bufferView)]);
  const remap=new Map<number,number>(),kept:any[]=[],output:Uint8Array[]=[];offset=0;
  for(const old of used){const v=views[old],padding=(4-offset%4)%4;if(padding){output.push(new Uint8Array(padding));offset+=padding;}
    const bytes=combined.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);remap.set(old,kept.length);kept.push({...v,byteOffset:offset});output.push(bytes);offset+=bytes.length;}
  for(const a of accessors)a.bufferView=remap.get(a.bufferView);
  for(const i of gltf.images??[])if(i.bufferView!==undefined)i.bufferView=remap.get(i.bufferView);
  gltf.bufferViews=kept;
  const packed=new Uint8Array(offset);cursor=0;for(const c of output){packed.set(c,cursor);cursor+=c.length;}
  return writeGlb(gltf,packed);
}
