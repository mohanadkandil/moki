// Binary STL read/write and an edge-manifold check. Vertices weld on exact float32 equality only,
// so the check reports what a slicer would load and repairs nothing.
export type Tri = [number, number, number, number, number, number, number, number, number];

export function writeBinaryStl(triangles: Float32Array): Uint8Array {
  const count = triangles.length / 9;
  const out = new ArrayBuffer(84 + 50 * count);
  const view = new DataView(out);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50; const i = t * 9;
    const ax = triangles[i]!; const ay = triangles[i + 1]!; const az = triangles[i + 2]!;
    const ux = triangles[i + 3]! - ax; const uy = triangles[i + 4]! - ay; const uz = triangles[i + 5]! - az;
    const vx = triangles[i + 6]! - ax; const vy = triangles[i + 7]! - ay; const vz = triangles[i + 8]! - az;
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, triangles[i + k]!, true);
  }
  return new Uint8Array(out);
}

export function readBinaryStl(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.byteLength !== 84 + 50 * count) throw new Error('Not a valid binary STL');
  const out = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
  return out;
}

export interface MeshCheck { triangles: number; vertices: number; edges: number; boundaryEdges: number; nonManifoldEdges: number; windingConflictEdges: number; degenerateTriangles: number; eulerCharacteristic: number; signedVolumeMm3: number; watertight: boolean }

export function checkMesh(triangles: Float32Array): MeshCheck {
  const count = triangles.length / 9;
  const ids = new Map<string, number>();
  const id = (i: number) => { const key = `${triangles[i]},${triangles[i + 1]},${triangles[i + 2]}`; let v = ids.get(key); if (v === undefined) { v = ids.size; ids.set(key, v); } return v; };
  const directed = new Map<string, number>(); const undirected = new Map<string, number>();
  let degenerate = 0; let volume = 0;
  for (let t = 0; t < count; t++) {
    const i = t * 9;
    const a = id(i); const b = id(i + 3); const c = id(i + 6);
    if (a === b || b === c || a === c) degenerate++;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const d = `${p}:${q}`; directed.set(d, (directed.get(d) ?? 0) + 1);
      const u = p < q ? `${p}:${q}` : `${q}:${p}`; undirected.set(u, (undirected.get(u) ?? 0) + 1);
    }
    const ax = triangles[i]!; const ay = triangles[i + 1]!; const az = triangles[i + 2]!;
    const bx = triangles[i + 3]!; const by = triangles[i + 4]!; const bz = triangles[i + 5]!;
    const cx = triangles[i + 6]!; const cy = triangles[i + 7]!; const cz = triangles[i + 8]!;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  let boundaryEdges = 0; let nonManifoldEdges = 0; let windingConflictEdges = 0;
  for (const n of undirected.values()) { if (n === 1) boundaryEdges++; else if (n > 2) nonManifoldEdges++; }
  for (const n of directed.values()) if (n > 1) windingConflictEdges++;
  return { triangles: count, vertices: ids.size, edges: undirected.size, boundaryEdges, nonManifoldEdges, windingConflictEdges, degenerateTriangles: degenerate,
    eulerCharacteristic: ids.size - undirected.size + count, signedVolumeMm3: Math.round(volume * 10) / 10,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0 && windingConflictEdges === 0 && degenerate === 0 && volume > 0 };
}
