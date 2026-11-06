// A still of a built project for the gallery, drawn from the job's own GLB so the card shows that board and no other.
// The server has no GPU and no browser, and the gallery shouldn't load three.js for every card, so this is a small
// software renderer: a z-buffer, a shadow map and the studio's stage, written out as a PNG with nothing to install.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 800;
/** Drawn at twice the size and averaged down, so edges and silkscreen stay clean. */
const SUPERSAMPLE = 2;
/** The studio's lens, from a little higher than its ¾ view, so a case's walls don't hide the board inside. */
const FOV = 24;
const HERO: Vec3 = normalize([-0.42, 0.8, -0.6]);
const FILL = 0.84;
/** --stage-back and the floor in web/src/studio/stageScene.ts. */
const BACKDROP = srgbColor('#1d1b19');
const FLOOR = srgbColor('#3f3d3a');
const PLA = srgbColor('#d9d4c7');
/** Key and fill from the studio's stage: high to one side, and low from the camera's side so fronts don't go black. */
const KEY_DIR = normalize([1.8, 3, -0.2]);
const KEY = scale(srgbColor('#fff6ea'), 2.7);
const FILL_DIR = normalize([-1.4, 0.8, -1.6]);
const FILL_LIGHT = scale(srgbColor('#fff4e6'), 0.5);

type Vec3 = [number, number, number];
type Mat4 = number[];

function normalize(v: Vec3): Vec3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function scale(v: Vec3, k: number): Vec3 { return [v[0] * k, v[1] * k, v[2] * k]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function toLinear(c: number) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function toSrgb(c: number) { return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; }
function srgbColor(hex: string): Vec3 { const n = parseInt(hex.slice(1), 16); return [toLinear((n >> 16 & 255) / 255), toLinear((n >> 8 & 255) / 255), toLinear((n & 255) / 255)]; }
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function aces(x: number) {
  // three.js's ACESFilmicToneMapping, per channel, close enough for a still that sits next to the live view.
  const v = x / 0.6;
  return clamp01((v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081));
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r]! * b[c * 4]! + a[r + 4]! * b[c * 4 + 1]! + a[r + 8]! * b[c * 4 + 2]! + a[r + 12]! * b[c * 4 + 3]!;
  return out;
}
function compose(t: number[], q: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q as [number, number, number, number];
  const [sx, sy, sz] = s as [number, number, number];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

// ---------------------------------------------------------------- PNG

function decodePng(data: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG');
  let offset = 8, width = 0, height = 0, depth = 0, colorType = 0, palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset < data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); depth = body[8]!; colorType = body[9]!;
      if (body[12] !== 0) throw new Error('Interlaced PNG');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
  if (depth !== 8 && !(colorType === 3 && depth <= 8) && !(colorType === 0 && depth <= 8)) throw new Error('Unsupported PNG depth');
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width * channels * depth / 8);
  const bpp = Math.max(1, channels * depth >> 3);
  const row = new Uint8Array(rowBytes), prior = new Uint8Array(rowBytes);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0, at = 0; y < height; y++) {
    const filter = raw[at++]!;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? row[i - bpp]! : 0, up = prior[i]!, corner = i >= bpp ? prior[i - bpp]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      row[i] = (raw[at++]! + predicted) & 255;
    }
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 3;
      if (colorType === 2 || colorType === 6) { rgb[out] = row[x * channels]!; rgb[out + 1] = row[x * channels + 1]!; rgb[out + 2] = row[x * channels + 2]!; continue; }
      let v: number;
      if (depth === 8) v = row[x * channels]!;
      else { const bit = x * depth; v = (row[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1); }
      if (colorType === 3) { rgb[out] = palette![v * 3]!; rgb[out + 1] = palette![v * 3 + 1]!; rgb[out + 2] = palette![v * 3 + 2]!; continue; }
      const grey = depth === 8 ? v : Math.round(v * 255 / ((1 << depth) - 1));
      rgb[out] = rgb[out + 1] = rgb[out + 2] = grey;
    }
    prior.set(row);
  }
  return { width, height, rgb };
}

const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(data: Uint8Array) { let c = -1; for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]!) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, body: Uint8Array) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  // Sub or Up, whichever is flatter. The stage is a slow gradient, and both shrink it far better than none.
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    let subCost = 0, upCost = 0;
    for (let i = 0; i < stride; i++) {
      const v = rgb[y * stride + i]!;
      subCost += Math.abs(((v - (i >= 3 ? rgb[y * stride + i - 3]! : 0)) << 24) >> 24);
      upCost += Math.abs(((v - (y ? rgb[(y - 1) * stride + i]! : 0)) << 24) >> 24);
    }
    const up = upCost < subCost;
    raw[start] = up ? 2 : 1;
    for (let i = 0; i < stride; i++) {
      const v = rgb[y * stride + i]!;
      raw[start + 1 + i] = (v - (up ? (y ? rgb[(y - 1) * stride + i]! : 0) : i >= 3 ? rgb[y * stride + i - 3]! : 0)) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())]);
}

// ---------------------------------------------------------------- GLB

interface Surface { color: Vec3; metal: number; rough: number; coat: number; map: { width: number; height: number; rgb: Uint8Array } | null }
interface Mesh { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; indices: Uint32Array; surface: Surface }

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(glb: Uint8Array, hide: (name: string) => boolean): Mesh[] {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB');
  const jsonLength = view.getUint32(12, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as any;
  const binStart = 20 + jsonLength + 8;
  const bin = new DataView(glb.buffer, glb.byteOffset + binStart, glb.byteLength - binStart);

  const read = (index: number): { values: Float64Array; size: number; count: number } => {
    const accessor = gltf.accessors[index];
    const size = COMPONENTS[accessor.type]!;
    const count: number = accessor.count;
    const values = new Float64Array(count * size);
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const bytes = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[accessor.componentType]!;
    const stride = bufferView.byteStride ?? bytes * size;
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) {
      const at = base + i * stride + c * bytes;
      values[i * size + c] = accessor.componentType === 5126 ? bin.getFloat32(at, true)
        : accessor.componentType === 5125 ? bin.getUint32(at, true)
        : accessor.componentType === 5123 ? bin.getUint16(at, true)
        : accessor.componentType === 5122 ? bin.getInt16(at, true)
        : accessor.componentType === 5121 ? bin.getUint8(at)
        : bin.getInt8(at);
    }
    return { values, size, count };
  };
  const images = new Map<number, Surface['map']>();
  const image = (texture: number): Surface['map'] => {
    const source: number = gltf.textures[texture].source;
    if (images.has(source)) return images.get(source)!;
    let decoded: Surface['map'] = null;
    try {
      const view_ = gltf.bufferViews[gltf.images[source].bufferView];
      decoded = decodePng(new Uint8Array(bin.buffer, bin.byteOffset + (view_.byteOffset ?? 0), view_.byteLength));
    } catch { /* A texture we can't read leaves the surface its plain colour. */ }
    images.set(source, decoded);
    return decoded;
  };
  const surfaces = new Map<string, Surface>();
  const surface = (material: number | undefined, owner: string): Surface => {
    const key = `${material}|${owner.startsWith('enclosure-') ? owner : owner === 'Box0' ? 'board' : ''}`;
    const known = surfaces.get(key);
    if (known) return known;
    const m = material === undefined ? null : gltf.materials[material];
    const pbr = m?.pbrMetallicRoughness ?? {};
    const factor = (pbr.baseColorFactor ?? [1, 1, 1, 1]) as number[];
    const map = pbr.baseColorTexture ? image(pbr.baseColorTexture.index) : null;
    // What the studio dresses them in: printed PLA for the case, a clear lacquer over the board's own mask.
    const made: Surface = owner.startsWith('enclosure-')
      ? { color: PLA, metal: 0, rough: 0.62, coat: 0, map: null }
      : owner === 'Box0' && map
        ? { color: [factor[0]!, factor[1]!, factor[2]!], metal: 0, rough: 0.62, coat: 0.22, map }
        : { color: [factor[0]!, factor[1]!, factor[2]!], metal: pbr.metallicFactor ?? 1, rough: pbr.roughnessFactor ?? 1, coat: 0, map };
    surfaces.set(key, made);
    return made;
  };

  const meshes: Mesh[] = [];
  const visit = (index: number, parent: Mat4, owner: string) => {
    const node = gltf.nodes[index];
    const name: string = node.name ?? '';
    if (hide(name)) return;
    const local: Mat4 = node.matrix ?? compose(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
    const world = multiply(parent, local);
    const scope = name === 'Box0' || name.startsWith('enclosure-') ? name : owner;
    for (const primitive of node.mesh === undefined ? [] : gltf.meshes[node.mesh].primitives) {
      const position = read(primitive.attributes.POSITION);
      const positions = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        const x = position.values[i * 3]!, y = position.values[i * 3 + 1]!, z = position.values[i * 3 + 2]!;
        positions[i * 3] = world[0]! * x + world[4]! * y + world[8]! * z + world[12]!;
        positions[i * 3 + 1] = world[1]! * x + world[5]! * y + world[9]! * z + world[13]!;
        positions[i * 3 + 2] = world[2]! * x + world[6]! * y + world[10]! * z + world[14]!;
      }
      const indices = primitive.indices === undefined ? Uint32Array.from({ length: position.count }, (_, i) => i) : Uint32Array.from(read(primitive.indices).values);
      const normals = new Float32Array(position.count * 3);
      if (primitive.attributes.NORMAL !== undefined) {
        const normal = read(primitive.attributes.NORMAL);
        for (let i = 0; i < position.count; i++) {
          const x = normal.values[i * 3]!, y = normal.values[i * 3 + 1]!, z = normal.values[i * 3 + 2]!;
          const n = normalize([world[0]! * x + world[4]! * y + world[8]! * z, world[1]! * x + world[5]! * y + world[9]! * z, world[2]! * x + world[6]! * y + world[10]! * z]);
          normals[i * 3] = n[0]; normals[i * 3 + 1] = n[1]; normals[i * 3 + 2] = n[2];
        }
      } else {
        for (let t = 0; t < indices.length; t += 3) {
          const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
          const n = cross(
            [positions[b * 3]! - positions[a * 3]!, positions[b * 3 + 1]! - positions[a * 3 + 1]!, positions[b * 3 + 2]! - positions[a * 3 + 2]!],
            [positions[c * 3]! - positions[a * 3]!, positions[c * 3 + 1]! - positions[a * 3 + 1]!, positions[c * 3 + 2]! - positions[a * 3 + 2]!],
          );
          for (const v of [a, b, c]) { normals[v * 3] = normals[v * 3]! + n[0]; normals[v * 3 + 1] = normals[v * 3 + 1]! + n[1]; normals[v * 3 + 2] = normals[v * 3 + 2]! + n[2]; }
        }
        for (let i = 0; i < position.count; i++) {
          const n = normalize([normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!]);
          normals[i * 3] = n[0]; normals[i * 3 + 1] = n[1]; normals[i * 3 + 2] = n[2];
        }
      }
      const uv = primitive.attributes.TEXCOORD_0 === undefined ? null : Float32Array.from(read(primitive.attributes.TEXCOORD_0).values);
      meshes.push({ positions, normals, uvs: uv, indices, surface: surface(primitive.material, scope) });
    }
    for (const child of node.children ?? []) visit(child, world, scope);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const roots: number[] = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? gltf.nodes.map((_: unknown, i: number) => i);
  for (const root of roots) visit(root, identity, '');
  return meshes;
}

// ---------------------------------------------------------------- Drawing

/** The room the studio lights its model with: bright above, dim around, dark below. */
function room(x: number, y: number, z: number, out: Float64Array) {
  const up = smoothstep(-0.25, 0.85, y);
  // A soft window high behind the camera's shoulder, which is what gives lacquer and pins a highlight to catch.
  const window = smoothstep(0.72, 0.96, x * -0.62 + y * 0.66 + z * -0.42);
  const k = 0.1 + 0.55 * up + 1.5 * window;
  out[0] = k * 1.02; out[1] = k * 0.98; out[2] = k * 0.92;
}
const ROOM_STRENGTH = 0.62;

function ggx(nh: number, rough: number) { const a = rough * rough, d = nh * nh * (a * a - 1) + 1; return (a * a) / (Math.PI * d * d); }

interface Depth { width: number; height: number; depth: Float32Array; toX: Vec3; toY: Vec3; toZ: Vec3; minX: number; minY: number; perX: number; perY: number }

/** Depth seen along `dir`, nearest wins, for a shadow or a contact shadow. */
function depthMap(meshes: Mesh[], dir: Vec3, size: number, points: Vec3[]): Depth {
  const up: Vec3 = Math.abs(dir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const toX = normalize(cross(up, dir)), toY = normalize(cross(dir, toX)), toZ = dir;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) { const x = dot(p, toX), y = dot(p, toY); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const perX = (size - 1) / (maxX - minX || 1), perY = (size - 1) / (maxY - minY || 1);
  const depth = new Float32Array(size * size).fill(-Infinity);
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t]! * 3, b = mesh.indices[t + 1]! * 3, c = mesh.indices[t + 2]! * 3;
      const ax = (p[a]! * toX[0] + p[a + 1]! * toX[1] + p[a + 2]! * toX[2] - minX) * perX, ay = (p[a]! * toY[0] + p[a + 1]! * toY[1] + p[a + 2]! * toY[2] - minY) * perY, az = p[a]! * toZ[0] + p[a + 1]! * toZ[1] + p[a + 2]! * toZ[2];
      const bx = (p[b]! * toX[0] + p[b + 1]! * toX[1] + p[b + 2]! * toX[2] - minX) * perX, by = (p[b]! * toY[0] + p[b + 1]! * toY[1] + p[b + 2]! * toY[2] - minY) * perY, bz = p[b]! * toZ[0] + p[b + 1]! * toZ[1] + p[b + 2]! * toZ[2];
      const cx = (p[c]! * toX[0] + p[c + 1]! * toX[1] + p[c + 2]! * toX[2] - minX) * perX, cy = (p[c]! * toY[0] + p[c + 1]! * toY[1] + p[c + 2]! * toY[2] - minY) * perY, cz = p[c]! * toZ[0] + p[c + 1]! * toZ[1] + p[c + 2]! * toZ[2];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area === 0) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / area;
        const w2 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area;
        if (w1 < -0.02 || w2 < -0.02 || w1 + w2 > 1.02) continue;
        const z = az + (bz - az) * w1 + (cz - az) * w2;
        if (z > depth[y * size + x]!) depth[y * size + x] = z;
      }
    }
  }
  return { width: size, height: size, depth, toX, toY, toZ, minX, minY, perX, perY };
}

function boxBlur(values: Float32Array, width: number, height: number, radius: number) {
  const out = new Float32Array(values.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += values[y * width + Math.min(width - 1, Math.max(0, x))]!;
      for (let x = 0; x < width; x++) {
        out[y * width + x] = sum / (radius * 2 + 1);
        sum += values[y * width + Math.min(width - 1, x + radius + 1)]! - values[y * width + Math.max(0, x - radius)]!;
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += out[Math.min(height - 1, Math.max(0, y)) * width + x]!;
      for (let y = 0; y < height; y++) {
        values[y * width + x] = sum / (radius * 2 + 1);
        sum += out[Math.min(height - 1, y + radius + 1) * width + x]! - out[Math.max(0, y - radius) * width + x]!;
      }
    }
  }
}

/** Sixteen points in a disc, spread evenly, for a shadow edge with some give in it. */
const DISC_SIZE = 16;
const DISC = Float64Array.from({ length: DISC_SIZE * 2 }, (_, n) => { const i = n >> 1, r = Math.sqrt((15.5 - i) / DISC_SIZE), a = i * 2.399963; return r * (n & 1 ? Math.sin(a) : Math.cos(a)); });
/** toSrgb is the one call every sample of every pixel makes, so it reads from a table. */
const ENCODE = Float32Array.from({ length: 4096 }, (_, i) => toSrgb(i / 4095));
const encode = (linear: number) => ENCODE[Math.round(linear * 4095)]!;
const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

export function renderMeshes(meshes: Mesh[], outWidth = THUMB_WIDTH, outHeight = THUMB_HEIGHT): Uint8Array {
  if (!meshes.length) throw new Error('Nothing to draw');
  const W = outWidth * SUPERSAMPLE, H = outHeight * SUPERSAMPLE;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) for (let i = 0; i < mesh.positions.length; i += 3) for (let c = 0; c < 3; c++) {
    const v = mesh.positions[i + c]!;
    if (v < min[c as 0]) min[c as 0] = v;
    if (v > max[c as 0]) max[c as 0] = v;
  }
  const span = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const floorY = min[1];
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const corners: Vec3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);

  // Frame as the studio does: find the distance at which the box's projected corners fill the frame, then re-centre.
  const aspect = W / H, tanV = Math.tan((FOV * Math.PI) / 360), tanH = tanV * aspect;
  const right = normalize(cross([0, 1, 0], HERO)), up = normalize(cross(HERO, right));
  const target: Vec3 = [...center];
  let distance = span;
  const measure = (d: number) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const r: Vec3 = [c[0] - target[0], c[1] - target[1], c[2] - target[2]];
      const depth = d - dot(r, HERO);
      const x = dot(r, right) / (depth * tanH), y = dot(r, up) / (depth * tanV);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1 };
  };
  for (let pass = 0; pass < 4; pass++) {
    let near = span * 0.51, far = span * 60;
    for (let i = 0; i < 26; i++) {
      distance = (near + far) / 2;
      const m = measure(distance);
      if (Math.max((m.x1 - m.x0) / 2, (m.y1 - m.y0) / 2) > FILL) near = distance; else far = distance;
    }
    const m = measure(distance);
    const dx = ((m.x0 + m.x1) / 2) * distance * tanH, dy = ((m.y0 + m.y1) / 2) * distance * tanV;
    for (let i = 0; i < 3; i++) target[i] = target[i]! + right[i]! * dx + up[i]! * dy;
  }
  const eye: Vec3 = [target[0] + HERO[0] * distance, target[1] + HERO[1] * distance, target[2] + HERO[2] * distance];

  // Geometry into a buffer of which triangle covers each pixel, so the lighting below only pays for what shows.
  const depth = new Float32Array(W * H);
  const hitMesh = new Int16Array(W * H).fill(-1);
  const hitTri = new Int32Array(W * H);
  const hitA = new Float32Array(W * H), hitB = new Float32Array(W * H);
  const halfW = W / 2, halfH = H / 2;
  meshes.forEach((mesh, meshIndex) => {
    const p = mesh.positions, count = p.length / 3;
    const sx = new Float32Array(count), sy = new Float32Array(count), iz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const rx = p[i * 3]! - eye[0], ry = p[i * 3 + 1]! - eye[1], rz = p[i * 3 + 2]! - eye[2];
      const z = -(rx * HERO[0] + ry * HERO[1] + rz * HERO[2]);
      const x = rx * right[0] + ry * right[1] + rz * right[2];
      const y = rx * up[0] + ry * up[1] + rz * up[2];
      sx[i] = halfW * (1 + x / (z * tanH)); sy[i] = halfH * (1 - y / (z * tanV)); iz[i] = 1 / z;
    }
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t]!, b = mesh.indices[t + 1]!, c = mesh.indices[t + 2]!;
      const ax = sx[a]!, ay = sy[a]!, bx = sx[b]!, by = sy[b]!, cx = sx[c]!, cy = sy[c]!;
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area === 0) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      const inv = 1 / area, za = iz[a]!, zb = iz[b]!, zc = iz[c]!;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w1 = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) * inv;
        const w2 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) * inv;
        const w0 = 1 - w1 - w2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        const at = y * W + x;
        if (z <= depth[at]!) continue;
        depth[at] = z;
        hitMesh[at] = meshIndex; hitTri[at] = t;
        hitA[at] = (w1 * zb) / z; hitB[at] = (w2 * zc) / z;
      }
    }
  });

  // A shadow map from the key, wide enough to catch what falls on the floor beside the model.
  const reach = (max[1] - floorY) * (Math.hypot(KEY_DIR[0], KEY_DIR[2]) / KEY_DIR[1]);
  const shadowPoints: Vec3[] = [...corners];
  for (const c of corners) shadowPoints.push([c[0] - KEY_DIR[0] / KEY_DIR[1] * reach, floorY, c[2] - KEY_DIR[2] / KEY_DIR[1] * reach]);
  const shadow = depthMap(meshes, KEY_DIR, 2048, shadowPoints);
  const softness = span * 0.0035;
  const lit = (x: number, y: number, z: number, jitter: number, bias: number) => {
    const u = x * shadow.toX[0] + y * shadow.toX[1] + z * shadow.toX[2];
    const v = x * shadow.toY[0] + y * shadow.toY[1] + z * shadow.toY[2];
    const d = x * shadow.toZ[0] + y * shadow.toZ[1] + z * shadow.toZ[2];
    const cos = Math.cos(jitter), sin = Math.sin(jitter);
    let open = 0, taken = 0;
    for (let i = 0; i < DISC_SIZE; i++) {
      const dx = DISC[i * 2]!, dy = DISC[i * 2 + 1]!;
      const sampleX = Math.round((u + (dx * cos - dy * sin) * softness - shadow.minX) * shadow.perX);
      const sampleY = Math.round((v + (dx * sin + dy * cos) * softness - shadow.minY) * shadow.perY);
      if (sampleX < 0 || sampleY < 0 || sampleX >= shadow.width || sampleY >= shadow.height || shadow.depth[sampleY * shadow.width + sampleX]! <= d + bias) open++;
      taken++;
      // The disc starts at its rim. If the rim all agrees, this point is clear of any edge, and most of a picture is.
      if (taken === 5 && (open === 0 || open === 5)) return open ? 1 : 0;
    }
    return open / taken;
  };

  // The soft dark under the model, baked looking straight up from the floor: closer to the floor reads darker.
  const contactSize = 512;
  const margin = span * 0.45;
  const contactRange = Math.max(max[1] - floorY, span * 0.1);
  const under = depthMap(meshes, [0, -1, 0], contactSize, [[min[0] - margin, floorY, min[2] - margin], [max[0] + margin, floorY, max[2] + margin]]);
  const contact = new Float32Array(contactSize * contactSize);
  for (let i = 0; i < contact.length; i++) {
    if (under.depth[i] === -Infinity) continue;
    const height = clamp01((-under.depth[i]! - floorY) / contactRange);
    contact[i] = (1 - height) ** 2;
  }
  boxBlur(contact, contactSize, contactSize, Math.round(contactSize * 0.018));
  const contactAt = (x: number, z: number) => {
    const u = (x * under.toX[0] + z * under.toX[2] - under.minX) * under.perX;
    const v = (x * under.toY[0] + z * under.toY[2] - under.minY) * under.perY;
    if (u < 0 || v < 0 || u >= contactSize - 1 || v >= contactSize - 1) return 0;
    return contact[Math.floor(v) * contactSize + Math.floor(u)]!;
  };

  // Crevices: how much of the surrounding hemisphere the depth buffer says is blocked, sampled in screen space.
  const occlusion = new Float32Array(W * H).fill(1);
  const aoRadius = (span * 0.012) / (distance * tanV) * halfH;
  const aoDirs = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)] as const);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const at = y * W + x;
    if (hitMesh[at] === -1) continue;
    const z = 1 / depth[at]!;
    let blocked = 0;
    for (const [dx, dy] of aoDirs) {
      let worst = 0;
      for (let step = 1; step <= 3; step++) {
        const r = aoRadius * step / 3;
        const nx = Math.round(x + dx * r), ny = Math.round(y + dy * r);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const near = depth[ny * W + nx]!;
        if (!near) continue;
        const rise = (z - 1 / near) / (span * 0.012 * step / 3);
        if (rise > 0 && rise < 2.2) worst = Math.max(worst, Math.min(1, rise));
      }
      blocked += worst;
    }
    const value = 1 - 0.75 * (blocked / aoDirs.length);
    occlusion[at] = value;
    if (x + 1 < W) occlusion[at + 1] = value;
    if (y + 1 < H) { occlusion[at + W] = value; if (x + 1 < W) occlusion[at + W + 1] = value; }
  }

  const color = new Float32Array(W * H * 3);
  const floorRadius = span * 1.05;
  const floorCx = center[0], floorCz = center[2];
  const backdrop = [toSrgb(BACKDROP[0]), toSrgb(BACKDROP[1]), toSrgb(BACKDROP[2])] as const;
  const env = new Float64Array(3), envDiffuse = new Float64Array(3);
  const halfKey = new Float64Array(3);
  const lightUp = (albedo: Vec3, metal: number, rough: number, coat: number, nx: number, ny: number, nz: number, vx: number, vy: number, vz: number, shadowed: number, ao: number, envAmount: number, out: Float64Array) => {
    const dielectric = 1 - metal;
    const nv = Math.max(0.0001, nx * vx + ny * vy + nz * vz);
    const f0 = [0.04 * dielectric + albedo[0] * metal, 0.04 * dielectric + albedo[1] * metal, 0.04 * dielectric + albedo[2] * metal];
    let r = 0, g = 0, b = 0;
    for (let light = 0; light < 2; light++) {
      const l = light ? FILL_DIR : KEY_DIR, c = light ? FILL_LIGHT : KEY, visible = light ? 1 : shadowed;
      const nl = nx * l[0] + ny * l[1] + nz * l[2];
      if (nl <= 0 || visible <= 0) continue;
      halfKey[0] = l[0] + vx; halfKey[1] = l[1] + vy; halfKey[2] = l[2] + vz;
      const hl = Math.hypot(halfKey[0], halfKey[1], halfKey[2]);
      const nh = Math.max(0, (nx * halfKey[0] + ny * halfKey[1] + nz * halfKey[2]) / hl);
      const vh = Math.max(0, (vx * halfKey[0] + vy * halfKey[1] + vz * halfKey[2]) / hl);
      const fresnel = (1 - vh) ** 5;
      const d = ggx(nh, Math.max(0.08, rough));
      // A compact Smith term: this is a still at thumbnail size, not a material preview.
      const specular = d * 0.25 / Math.max(0.1, nl * 0.5 + nv * 0.5) ** 2;
      const lacquer = coat ? coat * ggx(nh, 0.38) * 0.25 * (0.04 + 0.96 * fresnel) : 0;
      r += c[0] * nl * visible * (albedo[0] * dielectric / Math.PI + specular * (f0[0]! + (1 - f0[0]!) * fresnel) + lacquer);
      g += c[1] * nl * visible * (albedo[1] * dielectric / Math.PI + specular * (f0[1]! + (1 - f0[1]!) * fresnel) + lacquer);
      b += c[2] * nl * visible * (albedo[2] * dielectric / Math.PI + specular * (f0[2]! + (1 - f0[2]!) * fresnel) + lacquer);
    }
    room(nx, ny, nz, envDiffuse);
    const dn = 2 * nv;
    room(nx * dn - vx, ny * dn - vy, nz * dn - vz, env);
    const gloss = 1 - rough * 0.8;
    const edge = (1 - nv) ** 5;
    for (let i = 0; i < 3; i++) {
      const diffuse = envDiffuse[i]! * albedo[i as 0 | 1 | 2] * dielectric;
      const reflection = (f0[i]! + (Math.max(gloss, f0[i]!) - f0[i]!) * edge) * (env[i]! * gloss + envDiffuse[i]! * (1 - gloss));
      const total = (diffuse + reflection) * ROOM_STRENGTH * envAmount * ao;
      if (i === 0) r += total; else if (i === 1) g += total; else b += total;
    }
    out[0] = r; out[1] = g; out[2] = b;
  };

  const shade = new Float64Array(3);
  // The floor is matte, so its light hardly changes with the angle you see it from. Two values cover most of the picture.
  const floorLit = new Float64Array(3), floorDark = new Float64Array(3);
  lightUp(FLOOR, 0, 0.9, 0, 0, 1, 0, HERO[0], HERO[1], HERO[2], 1, 1, 0.3, floorLit);
  lightUp(FLOOR, 0, 0.9, 0, 0, 1, 0, HERO[0], HERO[1], HERO[2], 0, 1, 0.3, floorDark);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = y * W + x;
    // The ray through this pixel, for the floor and for the view vector.
    const cx = ((x + 0.5) / halfW - 1) * tanH, cy = (1 - (y + 0.5) / halfH) * tanV;
    const rx = right[0] * cx + up[0] * cy - HERO[0], ry = right[1] * cx + up[1] * cy - HERO[1], rz = right[2] * cx + up[2] * cy - HERO[2];
    const jitter = ((x * 12.9898 + y * 78.233) % 6.2831853 + 6.2831853) % 6.2831853;
    const meshIndex = hitMesh[at]!;
    let shown0: number, shown1: number, shown2: number;
    if (meshIndex === -1) {
      if (ry >= 0) { color[at * 3] = backdrop[0]; color[at * 3 + 1] = backdrop[1]; color[at * 3 + 2] = backdrop[2]; continue; }
      const k = (floorY - eye[1]) / ry;
      const fx = eye[0] + rx * k, fz = eye[2] + rz * k;
      const radius = Math.hypot(fx - floorCx, fz - floorCz) / floorRadius;
      const fade = radius >= 1 ? 0 : radius < 0.3 ? 1 : 1 - smoothstep(0.3, 1, radius);
      if (fade <= 0) { color[at * 3] = backdrop[0]; color[at * 3 + 1] = backdrop[1]; color[at * 3 + 2] = backdrop[2]; continue; }
      const seen = lit(fx, floorY, fz, jitter, span * 0.002);
      const light = (seen * (0.12 + 0.88 * seen)) * (1 - 0.72 * contactAt(fx, fz));
      shown0 = encode(aces(floorDark[0]! + (floorLit[0]! - floorDark[0]!) * light));
      shown1 = encode(aces(floorDark[1]! + (floorLit[1]! - floorDark[1]!) * light));
      shown2 = encode(aces(floorDark[2]! + (floorLit[2]! - floorDark[2]!) * light));
      color[at * 3] = backdrop[0] + (shown0 - backdrop[0]) * fade;
      color[at * 3 + 1] = backdrop[1] + (shown1 - backdrop[1]) * fade;
      color[at * 3 + 2] = backdrop[2] + (shown2 - backdrop[2]) * fade;
      continue;
    }
    const mesh = meshes[meshIndex]!, t = hitTri[at]!;
    const ia = mesh.indices[t]!, ib = mesh.indices[t + 1]!, ic = mesh.indices[t + 2]!;
    const wb = hitA[at]!, wc = hitB[at]!, wa = 1 - wb - wc;
    const n = mesh.normals;
    let nx = n[ia * 3]! * wa + n[ib * 3]! * wb + n[ic * 3]! * wc;
    let ny = n[ia * 3 + 1]! * wa + n[ib * 3 + 1]! * wb + n[ic * 3 + 1]! * wc;
    let nz = n[ia * 3 + 2]! * wa + n[ib * 3 + 2]! * wb + n[ic * 3 + 2]! * wc;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const p = mesh.positions;
    const px = p[ia * 3]! * wa + p[ib * 3]! * wb + p[ic * 3]! * wc;
    const py = p[ia * 3 + 1]! * wa + p[ib * 3 + 1]! * wb + p[ic * 3 + 1]! * wc;
    const pz = p[ia * 3 + 2]! * wa + p[ib * 3 + 2]! * wb + p[ic * 3 + 2]! * wc;
    let vx = eye[0] - px, vy = eye[1] - py, vz = eye[2] - pz;
    const vl = Math.hypot(vx, vy, vz);
    vx /= vl; vy /= vl; vz /= vl;
    // Parts are drawn from both sides, so a face turned away shades as if it faced us.
    if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const s = mesh.surface;
    let albedo = s.color;
    if (s.map && mesh.uvs) {
      const uv = mesh.uvs;
      const u = uv[ia * 2]! * wa + uv[ib * 2]! * wb + uv[ic * 2]! * wc;
      const v = uv[ia * 2 + 1]! * wa + uv[ib * 2 + 1]! * wb + uv[ic * 2 + 1]! * wc;
      const tx = ((u % 1) + 1) % 1 * (s.map.width - 1), ty = ((v % 1) + 1) % 1 * (s.map.height - 1);
      const x0 = Math.floor(tx), y0 = Math.floor(ty), x1 = Math.min(s.map.width - 1, x0 + 1), y1 = Math.min(s.map.height - 1, y0 + 1);
      const fx = tx - x0, fy = ty - y0, m = s.map.rgb, w = s.map.width;
      const texel = (c: number) => {
        const top = m[(y0 * w + x0) * 3 + c]! * (1 - fx) + m[(y0 * w + x1) * 3 + c]! * fx;
        const bottom = m[(y1 * w + x0) * 3 + c]! * (1 - fx) + m[(y1 * w + x1) * 3 + c]! * fx;
        return LINEAR[Math.round(top * (1 - fy) + bottom * fy)]!;
      };
      albedo = [texel(0) * s.color[0], texel(1) * s.color[1], texel(2) * s.color[2]];
    }
    const offset = span * 0.0012;
    const facing = nx * KEY_DIR[0] + ny * KEY_DIR[1] + nz * KEY_DIR[2];
    const seen = facing > 0 ? lit(px + nx * offset, py + ny * offset, pz + nz * offset, jitter, span * 0.001) : 0;
    lightUp(albedo, s.metal, s.rough, s.coat, nx, ny, nz, vx, vy, vz, seen * 0.88 + 0.12 * (facing > 0 ? 1 : 0), occlusion[at]!, 1, shade);
    const ao = 0.35 + 0.65 * occlusion[at]!;
    shown0 = encode(aces(shade[0]! * ao)); shown1 = encode(aces(shade[1]! * ao)); shown2 = encode(aces(shade[2]! * ao));
    color[at * 3] = shown0; color[at * 3 + 1] = shown1; color[at * 3 + 2] = shown2;
  }

  const out = new Uint8Array(outWidth * outHeight * 3);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    // A step of ordered dither, so the slow fade of the stage doesn't band on a dark screen.
    const dither = (BAYER[(y & 7) * 8 + (x & 7)]! / 64 - 0.5) / 255;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) for (let sx = 0; sx < SUPERSAMPLE; sx++) sum += color[((y * SUPERSAMPLE + sy) * W + x * SUPERSAMPLE + sx) * 3 + c]!;
      out[(y * outWidth + x) * 3 + c] = Math.round(clamp01(sum / samples + dither) * 255);
    }
  }
  return out;
}

/** The model a job's card should show: the assembly with its lid off so the board is what you see, or the bare board. */
export const thumbSource = (dir: string) => [resolve(dir, 'assembly.glb'), resolve(dir, 'board.glb')].find(existsSync) ?? null;

export function renderThumbnail(glb: Uint8Array): Buffer {
  const meshes = readGlb(glb, name => name === 'enclosure-lid');
  return encodePng(THUMB_WIDTH, THUMB_HEIGHT, renderMeshes(meshes));
}

/** Written beside the job's other files, all at once, so a request can never read half a picture. */
export function writeThumbnail(dir: string): boolean {
  const source = thumbSource(dir);
  if (!source) return false;
  const temporary = resolve(dir, `thumb.${process.pid}.tmp`);
  writeFileSync(temporary, renderThumbnail(readFileSync(source)));
  renameSync(temporary, resolve(dir, 'thumb.png'));
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? '')) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: thumbnail.ts <job directory>');
  if (!writeThumbnail(dir)) throw new Error('This job has no 3D model to draw.');
}
