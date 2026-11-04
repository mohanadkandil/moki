import { test, expect } from 'bun:test';
import { loadJscadPlan } from 'circuit-json-to-gltf';
import { CATALOG, MODULE } from '../../src/circuit/catalog';
import { MODULE_MECH } from '../enclosure/module-mech';
import { moduleBlocksCentered } from '../enclosure/module-preview';
import { detailedModulePieces, resistorBands } from './catalog-models';
import { compactGlb } from './compact-glb';
import { readGlb, writeGlb } from './glb';

for(const def of CATALOG.values()) test(`${def.id}: detailed material-bearing geometry stays inside its fitted envelope`,()=>{
  const pieces=detailedModulePieces(def.id,'4.7 kΩ');
  expect(pieces.length).toBeGreaterThan(2);
  const mesh=loadJscadPlan(pieces.map(p=>p.plan));
  expect(mesh.triangles.length).toBeGreaterThan(30);
  expect(mesh.triangles.every(t=>Boolean(t.material))).toBe(true);
  const blocks=moduleBlocksCentered(def.id),mech=MODULE_MECH[def.id]!;
  const px=def.pins.reduce((a,p)=>a+p.physical.x,0)/def.pins.length-def.size.w/2;
  const py=def.size.h/2-def.pins.reduce((a,p)=>a+p.physical.y,0)/def.pins.length;
  const minX=Math.min(...blocks.map(b=>b.x-b.w/2),...(mech.bodyMm?[px-mech.bodyMm.w/2]:[]));
  const maxX=Math.max(...blocks.map(b=>b.x+b.w/2),...(mech.bodyMm?[px+mech.bodyMm.w/2]:[]));
  const minY=Math.min(...blocks.map(b=>b.y-b.h/2),...(mech.bodyMm?[py-mech.bodyMm.h/2]:[]));
  const maxY=Math.max(...blocks.map(b=>b.y+b.h/2),...(mech.bodyMm?[py+mech.bodyMm.h/2]:[]));
  expect(mesh.boundingBox.min.x).toBeGreaterThanOrEqual(minX-.002);expect(mesh.boundingBox.max.x).toBeLessThanOrEqual(maxX+.002);
  // Loader maps circuit Z to Y and circuit Y to Z.
  expect(mesh.boundingBox.min.z).toBeGreaterThanOrEqual(minY-.002);expect(mesh.boundingBox.max.z).toBeLessThanOrEqual(maxY+.002);
  expect(mesh.boundingBox.min.y).toBeGreaterThanOrEqual(-.002);expect(mesh.boundingBox.max.y).toBeLessThanOrEqual(Math.max(...blocks.map(b=>b.z1))+.002);
});
test('resistor colours reflect 4.7k, 10k and 150 ohms',()=>{
 expect(resistorBands('4.7 kΩ')).toEqual(['#efcf29','#93449a','#c83025','#c6a457']);
 expect(resistorBands('10 kΩ')).toEqual(['#6b3520','#151515','#ed7d20','#c6a457']);
 expect(resistorBands('150 Ω')).toEqual(['#6b3520','#21823d','#6b3520','#c6a457']);
});
test('open socket geometry and module bodies are separate groups',()=>{
 const p=detailedModulePieces(MODULE.esp32);expect(p.some(p=>p.role==='socket'&&p.plan.shape.shape.type==='subtract')).toBe(true);
});
test('GLB container round-trip preserves embedded binary and extras',()=>{
 const b=writeGlb({asset:{version:'2.0',extras:{moki:true}},buffers:[]},new Uint8Array([1,2,3]));
 const r=readGlb(b);expect(r.gltf.asset.extras.moki).toBe(true);expect([...r.bin]).toEqual([1,2,3,0]);
 expect(()=>readGlb(new Uint8Array(40))).toThrow('Invalid GLB');
});

test('LED lead centres land on asymmetric catalog pads',()=>{
 const def=CATALOG.get(MODULE.led)!;const pins=detailedModulePieces(MODULE.led).filter(p=>p.label==='LED lead');
 const centers=pins.map(p=>{const b=loadJscadPlan(p.plan).boundingBox;return {x:(b.min.x+b.max.x)/2,y:(b.min.z+b.max.z)/2};});
 for(const pin of def.pins)expect(centers.some(p=>Math.hypot(p.x-(pin.physical.x-def.size.w/2),p.y-(def.size.h/2-pin.physical.y))<.001)).toBe(true);
});

test('lossless GLB sharing retains normals, UV seams, triangle order and embedded images',()=>{
 const arrays=[new Float32Array([0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,-1,0,0]),new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1]),new Float32Array([0,0,1,0,0,1,.5,0,0,1,1,0])];
 let at=0;const views=arrays.map(a=>{const v={buffer:0,byteOffset:at,byteLength:a.byteLength};at+=a.byteLength;return v;});
 const bytes=new Uint8Array(at+4);at=0;for(const a of arrays){bytes.set(new Uint8Array(a.buffer),at);at+=a.byteLength;}
 bytes.set([10,20,30,40],at);views.push({buffer:0,byteOffset:at,byteLength:4});
 const source=writeGlb({asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},mode:4}]}],accessors:arrays.map((a,i)=>({bufferView:i,componentType:5126,count:6,type:i===2?'VEC2':'VEC3'})),bufferViews:views,images:[{bufferView:3,mimeType:'image/png'}]},bytes);
 const out=readGlb(compactGlb(source));const p=out.gltf.meshes[0].primitives[0];
 const pos=out.gltf.accessors[p.attributes.POSITION];expect(pos.count).toBe(5);
 const index=out.gltf.accessors[p.indices],v=out.gltf.bufferViews[index.bufferView];
 const list=new Uint16Array(out.bin.buffer,out.bin.byteOffset+v.byteOffset,index.count);expect([...list]).toEqual([0,1,2,3,2,4]);
 for(const [k,name] of ['POSITION','NORMAL','TEXCOORD_0'].entries()){const a=out.gltf.accessors[p.attributes[name]],v=out.gltf.bufferViews[a.bufferView],dim=k===2?2:3;const data=new Float32Array(out.bin.buffer,out.bin.byteOffset+v.byteOffset,a.count*dim);expect([...list].flatMap(i=>[...data.subarray(i*dim,(i+1)*dim)])).toEqual([...arrays[k]!]);}
 const image=out.gltf.bufferViews[out.gltf.images[0].bufferView];expect([...out.bin.subarray(image.byteOffset,image.byteOffset+image.byteLength)]).toEqual([10,20,30,40]);
});

test('all catalog module meshes begin at the board or inserted socket seat',()=>{
 for(const def of CATALOG.values()) {
  const mech=MODULE_MECH[def.id]!;
  for(const role of ['module','socket']) {
   const plans=detailedModulePieces(def.id).filter(p=>p.role===role).map(p=>p.plan);
   if(!plans.length)continue;
   const min=loadJscadPlan(plans).boundingBox.min.y;
   const seat=role==='socket'?0:Math.max(0,mech.socketMm-1.4);
   expect(min).toBeGreaterThanOrEqual(seat-.001);expect(min-seat).toBeLessThanOrEqual(.5);
  }
 }
});

// Intersect a vertical line with a closed triangle solid, then pair unique crossings.
// This checks actual mesh occupancy, including socket recesses, rather than trusting AABBs.
function verticalIntervals(mesh: ReturnType<typeof loadJscadPlan>, x: number, z: number): [number,number][] {
 const ys:number[]=[];
 for(const t of mesh.triangles) {
  const [a,b,c]=t.vertices;
  const denominator=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
  if(Math.abs(denominator)<1e-9)continue;
  const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/denominator;
  const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/denominator;
  if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)ys.push(u*a.y+v*b.y+(1-u-v)*c.y);
 }
 const unique=ys.sort((a,b)=>a-b).filter((y,i,a)=>i===0||Math.abs(y-a[i-1]!)>1e-5);
 const intervals:[number,number][]=[];for(let i=0;i+1<unique.length;i+=2)intervals.push([unique[i]!,unique[i+1]!]);return intervals;
}
test('every socketed module has a solid visible support path from carrier to module PCB at every header pin',()=>{
 for(const def of CATALOG.values()) {
  const mech=MODULE_MECH[def.id]!;if(!mech.socketMm)continue;
  const meshes=detailedModulePieces(def.id).filter(p=>p.role==='socket'||p.label.startsWith('male spacer')||p.label.endsWith('pcb')).map(p=>loadJscadPlan(p.plan));
  for(const pin of def.pins) {
   // Along the socket wall, beside the socket's real contact opening.
   const x=pin.physical.x-def.size.w/2+.65,z=def.size.h/2-pin.physical.y;
   const intervals=meshes.flatMap(m=>verticalIntervals(m,x,z)).sort((a,b)=>a[0]-b[0]);
   let top=0;
   for(const [lo,hi] of intervals)if(lo<=top+.001)top=Math.max(top,hi);
   expect(top).toBeGreaterThanOrEqual(mech.socketMm+mech.spacerMm+mech.pcbMm-.001);
  }
 }
});
