// assembly.glb retains detailed board models, plus the enclosure. Legacy inputs receive fallback blocks.
// The nodes are enclosure-base, enclosure-lid and modules-<part>, so a viewer can toggle them.
import type { HandoffBlock, HandoffPart } from './handoff.ts';

// The frame of board.glb, read from its texture coordinates: glTF (x, y, z) = (-board x, board z, board y).
// This is a proper rotation, so triangle winding carries over unchanged.
const COLORS: Record<string, { rgba: [number, number, number, number]; metallic: number; roughness: number }> = {
  socket: { rgba: [0.03, 0.03, 0.035, 1], metallic: 0, roughness: 0.7 },
  plastic: { rgba: [0.07, 0.07, 0.08, 1], metallic: 0, roughness: 0.6 },
  'pcb-blue': { rgba: [0.03, 0.12, 0.4, 1], metallic: 0, roughness: 0.6 },
  'pcb-black': { rgba: [0.03, 0.035, 0.04, 1], metallic: 0, roughness: 0.55 },
  'pcb-dark': { rgba: [0.05, 0.08, 0.06, 1], metallic: 0, roughness: 0.6 },
  metal: { rgba: [0.72, 0.73, 0.75, 1], metallic: 0.85, roughness: 0.35 },
  glass: { rgba: [0.01, 0.01, 0.015, 1], metallic: 0, roughness: 0.15 },
  active: { rgba: [0.2, 0.75, 1, 1], metallic: 0, roughness: 0.3 },
  amber: { rgba: [0.95, 0.55, 0.08, 1], metallic: 0, roughness: 0.3 },
  resistor: { rgba: [0.55, 0.42, 0.28, 1], metallic: 0, roughness: 0.6 },
};

type Xyz = [number, number, number];

function boxTriangles(b: HandoffBlock): number[] {
  const c = Math.cos((b.rotationDeg * Math.PI) / 180); const s = Math.sin((b.rotationDeg * Math.PI) / 180);
  const at = (lx: number, ly: number, z: number): Xyz => [b.x + c * lx - s * ly, b.y + s * lx + c * ly, z];
  const w = b.w / 2; const h = b.h / 2;
  const p = [at(-w, -h, b.z0), at(w, -h, b.z0), at(w, h, b.z0), at(-w, h, b.z0), at(-w, -h, b.z1), at(w, -h, b.z1), at(w, h, b.z1), at(-w, h, b.z1)];
  const quads = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return quads.flatMap(([a, e, f, g]) => [...p[a!]!, ...p[e!]!, ...p[f!]!, ...p[a!]!, ...p[f!]!, ...p[g!]!]);
}

function cylinderTriangles(b: HandoffBlock): number[] {
  const out: number[] = []; const n = 28; const r = b.w / 2;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2; const a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = b.x + r * Math.cos(a0); const y0 = b.y + r * Math.sin(a0); const x1 = b.x + r * Math.cos(a1); const y1 = b.y + r * Math.sin(a1);
    out.push(x0, y0, b.z0, x1, y1, b.z0, x1, y1, b.z1, x0, y0, b.z0, x1, y1, b.z1, x0, y0, b.z1);
    out.push(b.x, b.y, b.z1, x0, y0, b.z1, x1, y1, b.z1, b.x, b.y, b.z0, x1, y1, b.z0, x0, y0, b.z0);
  }
  return out;
}

export interface AssemblyInput {
  boardGlb: Uint8Array;
  base: Float32Array; // Assembled pose, enclosure frame: Z = 0 outside the floor.
  lid: Float32Array;
  boardBottomZ: number; boardTopZ: number; seamZ: number; thicknessMm: number;
  parts: HandoffPart[];
}

/** Assembled pose from the lid's print pose. Inverse of the flip in mech/enclosure.py. */
export function lidToAssembled(print: Float32Array, totalHeight: number): Float32Array {
  const out = new Float32Array(print.length);
  for (let i = 0; i < print.length; i += 3) { out[i] = print[i]!; out[i + 1] = -print[i + 1]!; out[i + 2] = totalHeight - print[i + 2]!; }
  return out;
}

export function buildAssemblyGlb(input: AssemblyInput): Uint8Array {
  const view = new DataView(input.boardGlb.buffer, input.boardGlb.byteOffset, input.boardGlb.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('board.glb is not a GLB');
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(input.boardGlb.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength + 8;
  const binLength = view.getUint32(20 + jsonLength, true);
  const chunks: Uint8Array[] = [input.boardGlb.subarray(binStart, binStart + binLength)];
  let offset = binLength;
  const pad = () => { const extra = (4 - (offset % 4)) % 4; if (extra) { chunks.push(new Uint8Array(extra)); offset += extra; } };
  pad();
  gltf.materials ??= []; gltf.meshes ??= []; gltf.nodes ??= []; gltf.accessors ??= []; gltf.bufferViews ??= [];
  const scene = gltf.scenes[gltf.scene ?? 0];
  const material = (m: object) => gltf.materials.push(m) - 1;

  const addPrimitive = (positions: Float32Array, materialIndex: number) => {
    // Flat normals: CAD edges should read as edges.
    const normals = new Float32Array(positions.length);
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i]!; const ay = positions[i + 1]!; const az = positions[i + 2]!;
      const ux = positions[i + 3]! - ax; const uy = positions[i + 4]! - ay; const uz = positions[i + 5]! - az;
      const vx = positions[i + 6]! - ax; const vy = positions[i + 7]! - ay; const vz = positions[i + 8]! - az;
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 3; k++) { normals[i + k * 3] = nx; normals[i + k * 3 + 1] = ny; normals[i + k * 3 + 2] = nz; }
    }
    for (let i = 0; i < positions.length; i++) { const a = i % 3; min[a] = Math.min(min[a]!, positions[i]!); max[a] = Math.max(max[a]!, positions[i]!); }
    const push = (array: Float32Array) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      chunks.push(bytes);
      const index = gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target: 34962 }) - 1;
      offset += bytes.byteLength; pad();
      return index;
    };
    const count = positions.length / 3;
    const pos = gltf.accessors.push({ bufferView: push(positions), componentType: 5126, count, type: 'VEC3', min, max }) - 1;
    const nor = gltf.accessors.push({ bufferView: push(normals), componentType: 5126, count, type: 'VEC3' }) - 1;
    return { attributes: { POSITION: pos, NORMAL: nor }, material: materialIndex, mode: 4 };
  };
  const addNode = (name: string, primitives: object[], extras: object) => {
    const mesh = gltf.meshes.push({ name, primitives }) - 1;
    scene.nodes.push(gltf.nodes.push({ name, mesh, extras }) - 1);
  };

  // Enclosure Z to glTF Y: the board's centre plane is y = 0 in board.glb.
  const zShift = -(input.boardBottomZ + input.thicknessMm / 2);
  const toGltf = (src: Float32Array | number[], shift: number) => {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) { out[i] = -src[i]!; out[i + 1] = src[i + 2]! + shift; out[i + 2] = src[i + 1]!; }
    return out;
  };

  const baseMaterial = material({ name: 'enclosure-base', pbrMetallicRoughness: { baseColorFactor: [0.82, 0.8, 0.75, 1], metallicFactor: 0, roughnessFactor: 0.75 } });
  const lidMaterial = material({ name: 'enclosure-lid', pbrMetallicRoughness: { baseColorFactor: [0.86, 0.87, 0.9, 0.26], metallicFactor: 0, roughnessFactor: 0.4 }, alphaMode: 'BLEND' });
  addNode('enclosure-base', [addPrimitive(toGltf(input.base, zShift), baseMaterial)], { moki: { role: 'enclosure', part: 'base' } });
  addNode('enclosure-lid', [addPrimitive(toGltf(input.lid, zShift), lidMaterial)], { moki: { role: 'enclosure', part: 'lid', translucent: true } });

  const blockMaterials = new Map<string, number>();
  const blockMaterial = (color: string) => {
    if (!blockMaterials.has(color)) {
      const c = COLORS[color] ?? COLORS.plastic!;
      blockMaterials.set(color, material({ name: `module-${color}`, pbrMetallicRoughness: { baseColorFactor: c.rgba, metallicFactor: c.metallic, roughnessFactor: c.roughness }, ...(color === 'active' ? { emissiveFactor: [0.1, 0.4, 0.6] } : {}) }));
    }
    return blockMaterials.get(color)!;
  };
  // board.glb may carry its own module models. The enclosure was fitted to the blocks below, so those
  // are what the assembly shows, and each part appears once. The board's models stay in board.glb.
  const placedParts = new Set(input.parts.filter(p => p.blocks.length).map(p => p.id));
  const detailedParts = new Set<string>(scene.nodes.map((index: number) => gltf.nodes[index]).filter((n: any) => n?.extras?.moki?.role === 'module').map((n: any) => n.extras.moki.part));
  scene.nodes = scene.nodes.filter((index: number) => {
    const n = gltf.nodes[index];
    return n?.extras?.moki?.role === 'module' || n?.extras?.moki?.role === 'socket' || !placedParts.has(n?.extras?.tscircuit?.componentName);
  });
  const shiftToBoardTop = input.thicknessMm / 2;
  const ceilingAboveBoard = input.seamZ - input.boardTopZ;
  for (const part of input.parts) {
    if (detailedParts.has(part.id)) {
      if (part.stack.raisedToLid) {
        const lift = ceilingAboveBoard - 0.5 - Math.max(...part.blocks.map(b => b.z1));
        for (const index of scene.nodes) {
          const n = gltf.nodes[index];
          if (n?.extras?.moki?.part === part.id && n.extras.moki.role === 'module') {
            n.translation ??= [0, 0, 0]; n.translation[1] += lift;
          }
        }
      }
      continue;
    }
    const byColor = new Map<string, number[]>();
    const lift = part.stack.raisedToLid ? ceilingAboveBoard - 0.5 - Math.max(...part.blocks.map(b => b.z1)) : 0;
    for (const block of part.blocks) {
      const placed = { ...block, z0: block.z0 + lift, z1: block.z1 + lift };
      if (!byColor.has(block.color)) byColor.set(block.color, []);
      byColor.get(block.color)!.push(...(block.shape === 'box' ? boxTriangles(placed) : cylinderTriangles(placed)));
    }
    if (!byColor.size) continue;
    addNode(`modules-${part.id}`, [...byColor].map(([color, tris]) => addPrimitive(toGltf(tris, shiftToBoardTop), blockMaterial(color))), { moki: { role: 'placeholder-module', part: part.id, module: part.module, note: 'Simplified block model built from estimated dimensions.' } });
  }

  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  gltf.buffers = [{ byteLength: total }];
  gltf.asset.extras = { ...(gltf.asset.extras ?? {}), provenance: 'board.glb from tscircuit, enclosure from mech; legacy inputs receive fallback modules' };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) { const padded = new Uint8Array(json.length + jsonPad).fill(0x20); padded.set(json); json = padded; }
  const glb = new Uint8Array(12 + 8 + json.length + 8 + total);
  const out = new DataView(glb.buffer);
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, glb.length, true);
  out.setUint32(12, json.length, true); out.setUint32(16, 0x4e4f534a, true); glb.set(json, 20);
  let cursor = 20 + json.length;
  out.setUint32(cursor, total, true); out.setUint32(cursor + 4, 0x004e4942, true); cursor += 8;
  for (const c of chunks) { glb.set(c, cursor); cursor += c.byteLength; }
  return glb;
}
