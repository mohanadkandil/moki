/** Minimal GLB container helpers. Geometry buffers, embedded images and unknown extensions stay intact. */
export function readGlb(bytes: Uint8Array): { gltf: any; bin: Uint8Array } {
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<28||d.getUint32(0,true)!==0x46546c67||d.getUint32(4,true)!==2||d.getUint32(8,true)!==bytes.length)throw new Error('Invalid GLB container');
  const length=d.getUint32(12,true), binAt=20+length;
  return {gltf:JSON.parse(new TextDecoder().decode(bytes.subarray(20,binAt))),bin:bytes.subarray(binAt+8,binAt+8+d.getUint32(binAt,true))};
}
export function writeGlb(gltf: any, binary: Uint8Array): Uint8Array {
  const binLength=Math.ceil(binary.length/4)*4; gltf.buffers=[{byteLength:binLength}];
  const raw=new TextEncoder().encode(JSON.stringify(gltf));const jsonLength=Math.ceil(raw.length/4)*4;
  const bytes=new Uint8Array(28+jsonLength+binLength),d=new DataView(bytes.buffer);
  d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,bytes.length,true);
  d.setUint32(12,jsonLength,true);d.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(raw,20);
  d.setUint32(20+jsonLength,binLength,true);d.setUint32(24+jsonLength,0x004e4942,true);bytes.set(binary,28+jsonLength);return bytes;
}
