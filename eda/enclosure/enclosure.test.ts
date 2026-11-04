// Run: cd eda && bun test enclosure/
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CATALOG, MODULE } from '../../src/circuit/catalog.ts';
import { writeGlb as packGlbForTest } from '../models/glb.ts';
import { buildAssemblyGlb, lidToAssembled } from './assembly.ts';
import { buildBaseline } from './baseline.ts';
import { buildMechHandoff, fitPose } from './handoff.ts';
import { moduleBlocksCentered, modulePreviewPlan } from './module-preview.ts';
import { checkMesh, readBinaryStl, writeBinaryStl } from './stl.ts';

interface Placed { id: string; module: string; x: number; y: number; rotationDeg?: number }

/** A small circuit.json in the shape tscircuit writes, with plated holes at the catalog pins of each rotated part. */
function circuitJson(placed: Placed[], opts: { holes?: Array<{ x: number; y: number; d?: number; shape?: string }>; width?: number; height?: number; mpn?: boolean } = {}) {
  const elements: any[] = [{ type: 'pcb_board', center: { x: 0, y: 0 }, width: opts.width ?? 90, height: opts.height ?? 100, thickness: 1.6, num_layers: 2 }];
  (opts.holes ?? [[-41, -46], [-41, 46], [41, -46], [41, 46]].map(([x, y]) => ({ x: x!, y: y! }))).forEach((h, i) => elements.push({ type: 'pcb_hole', pcb_hole_id: `h${i}`, hole_shape: h.shape ?? 'circle', hole_diameter: h.d ?? 3.2, x: h.x, y: h.y }));
  placed.forEach((p, i) => {
    const def = CATALOG.get(p.module);
    elements.push({ type: 'source_component', source_component_id: `s${i}`, name: p.id, ...(opts.mpn === false ? {} : { manufacturer_part_number: `${def?.name ?? p.module} (header)` }) });
    elements.push({ type: 'pcb_component', pcb_component_id: `c${i}`, source_component_id: `s${i}`, center: { x: p.x, y: p.y }, rotation: p.rotationDeg ?? 0 });
    const theta = ((p.rotationDeg ?? 0) * Math.PI) / 180;
    (def?.pins ?? [{ physical: { x: 0, y: 0 } }, { physical: { x: 2.54, y: 0 } }] as any[]).forEach((pin: any, n: number) => {
      const lx = pin.physical.x - (def?.size.w ?? 0) / 2; const ly = (def?.size.h ?? 0) / 2 - pin.physical.y;
      elements.push({ type: 'pcb_plated_hole', pcb_component_id: `c${i}`, port_hints: [`unnamed${n}`, `pin${n + 1}`], x: p.x + Math.cos(theta) * lx - Math.sin(theta) * ly, y: p.y + Math.sin(theta) * lx + Math.cos(theta) * ly });
    });
  });
  return JSON.stringify(elements);
}

const FOCUS: Placed[] = [
  { id: 'U1', module: MODULE.esp32, x: -22.05, y: -22.8 },
  { id: 'U2', module: MODULE.oled, x: 20, y: 27.1 },
  { id: 'SW1', module: MODULE.encoder, x: 20, y: -25.3 },
];

function cube(size = 10): Float32Array {
  const p = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0], [0, 0, size], [size, 0, size], [size, size, size], [0, size, size]];
  const quads = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return new Float32Array(quads.flatMap(([a, b, c, d]) => [...p[a!]!, ...p[b!]!, ...p[c!]!, ...p[a!]!, ...p[c!]!, ...p[d!]!]));
}

/** A real minimal GLB: one triangle in a BIN chunk, like board.glb's layout. */
function tinyGlb(): Uint8Array {
  const bin = new Uint8Array(new Float32Array([0, 0.8, 0, 1, 0.8, 0, 0, 0.8, 1]).buffer);
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Box0', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0.8, 0], max: [1, 0.8, 1] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  if (json.length % 4) { const pad = new Uint8Array(json.length + 4 - (json.length % 4)).fill(0x20); pad.set(json); json = pad; }
  const out = new Uint8Array(12 + 8 + json.length + 8 + bin.length); const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  view.setUint32(20 + json.length, bin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
  return out;
}

function parseGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  const binLength = view.getUint32(20 + length, true);
  return { gltf, bin: bytes.subarray(28 + length, 28 + length + binLength), declared: view.getUint32(8, true) };
}

describe('mesh check', () => {
  test('a closed cube is watertight, with Euler characteristic 2 and the right volume', () => {
    const check = checkMesh(cube());
    expect(check).toMatchObject({ triangles: 12, vertices: 8, edges: 18, boundaryEdges: 0, nonManifoldEdges: 0, windingConflictEdges: 0, eulerCharacteristic: 2, watertight: true });
    expect(check.signedVolumeMm3).toBeCloseTo(1000, 1);
  });
  test('a missing triangle is reported as open edges', () => {
    const check = checkMesh(cube().slice(0, 11 * 9));
    expect(check.boundaryEdges).toBe(3);
    expect(check.watertight).toBe(false);
  });
  test('one flipped triangle is reported as a winding conflict', () => {
    const mesh = cube();
    for (let k = 0; k < 3; k++) { const a = mesh[k + 3]!; mesh[k + 3] = mesh[k + 6]!; mesh[k + 6] = a; }
    const check = checkMesh(mesh);
    expect(check.windingConflictEdges).toBeGreaterThan(0);
    expect(check.watertight).toBe(false);
  });
  test('an inside-out cube is not watertight, because its volume is negative', () => {
    const mesh = cube();
    for (let t = 0; t < mesh.length; t += 9) for (let k = 0; k < 3; k++) { const a = mesh[t + k + 3]!; mesh[t + k + 3] = mesh[t + k + 6]!; mesh[t + k + 6] = a; }
    expect(checkMesh(mesh).watertight).toBe(false);
  });
  test('binary STL round-trips exactly, and a truncated file is refused', () => {
    const bytes = writeBinaryStl(cube());
    expect(Array.from(readBinaryStl(bytes))).toEqual(Array.from(cube()));
    expect(() => readBinaryStl(bytes.slice(0, bytes.length - 3))).toThrow('Not a valid binary STL');
  });
});

describe('fitPose', () => {
  test.each([0, 90, 180, 270, 37])('recovers a rotation of %d degrees with no residual', deg => {
    const local = [{ x: -5, y: 2 }, { x: 5, y: 2 }, { x: 5, y: -8 }];
    const t = (deg * Math.PI) / 180;
    const measured = local.map(p => ({ x: Math.cos(t) * p.x - Math.sin(t) * p.y + 3, y: Math.sin(t) * p.x + Math.cos(t) * p.y - 7 }));
    const pose = fitPose(local, measured);
    expect(pose.rotationDeg).toBeCloseTo(deg, 2);
    expect(pose.tx).toBeCloseTo(3, 6);
    expect(pose.ty).toBeCloseTo(-7, 6);
    expect(pose.maxResidualMm).toBeLessThan(0.001);
  });
  test('a mirrored part cannot be fitted without residual', () => {
    const local = [{ x: -5, y: 2 }, { x: 5, y: 2 }, { x: 5, y: -8 }];
    expect(fitPose(local, local.map(p => ({ x: -p.x, y: p.y }))).maxResidualMm).toBeGreaterThan(1);
  });
});

describe('mech handoff', () => {
  const handoff = buildMechHandoff(circuitJson(FOCUS));
  const byPurpose = (h: typeof handoff, purpose: string) => h.apertures.find(a => a.purpose === purpose)!;

  test('it holds the board facts from circuit.json', () => {
    expect(handoff.schema).toBe('moki.mech-handoff/1');
    expect(handoff.board).toMatchObject({ widthMm: 90, heightMm: 100, thicknessMm: 1.6 });
    expect(handoff.board.holes).toHaveLength(4);
    expect(handoff.source.circuitJsonSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(handoff.warnings).toEqual([]);
  });
  test('the stack heights add up from their parts', () => {
    const u1 = handoff.parts.find(p => p.id === 'U1')!;
    expect(u1.stack.topMm).toBeCloseTo(8.5 + 2.54 + 1.6 + 4, 3);
    expect(u1.fit).toEqual({ method: 'pads', pins: 38, maxResidualMm: 0 });
    expect(handoff.parts.find(p => p.id === 'SW1')!.stack.throughLid!.shaftTopMm).toBeCloseTo(32.64, 2);
  });
  test('USB sits on the wall it faces, past the module outline', () => {
    const usb = byPurpose(handoff, 'usb');
    expect(usb.face).toBe('y_neg');
    expect(usb.center.x).toBeCloseTo(-22.05, 2);
    expect(usb.center.y).toBeCloseTo(-50, 2);
    expect(handoff.parts.find(p => p.id === 'U1')!.bbox.minY).toBeCloseTo(-51, 2);
  });
  test.each([[90, 'x_pos'], [180, 'y_pos'], [270, 'x_neg']] as const)('turning the devkit %d degrees moves USB to %s', (deg, face) => {
    const turned = buildMechHandoff(circuitJson([{ id: 'U1', module: MODULE.esp32, x: 0, y: 0, rotationDeg: deg }], { width: 120, height: 120 }));
    expect(byPurpose(turned, 'usb').face).toBe(face);
    expect(turned.parts[0]!.rotationDeg).toBeCloseTo(deg, 2);
  });
  test('the display window and encoder hole follow a rotated part', () => {
    const turned = buildMechHandoff(circuitJson([{ id: 'U2', module: MODULE.oled, x: 10, y: 20, rotationDeg: 90 }, { id: 'SW1', module: MODULE.encoder, x: -20, y: -10, rotationDeg: 180 }], { width: 120, height: 120 }));
    const window = byPurpose(turned, 'display-active-area');
    // Catalog (w/2, 12.6) on a 27.3 x 27.8 outline is y-up (0, 1.3) from centre. Turned 90 degrees: (-1.3, 0).
    expect(window.center.x).toBeCloseTo(8.7, 2);
    expect(window.center.y).toBeCloseTo(20, 2);
    expect(window.rotationDeg).toBeCloseTo(90, 2);
    expect(window.activeAreaMm).toEqual({ w: 21.744, h: 10.864 });
    const shaft = byPurpose(turned, 'encoder-shaft');
    // Catalog (9.2, 9.5) on 32 x 19 is y-up (-6.8, 0). Turned 180 degrees: (6.8, 0).
    expect(shaft.center.x).toBeCloseTo(-13.2, 2);
    expect(shaft.center.y).toBeCloseTo(-10, 2);
  });
  test('a leaded part centres on its pads, not on the catalog wiring sketch', () => {
    const h = buildMechHandoff(circuitJson([{ id: 'BZ1', module: MODULE.piezo, x: 20, y: -1.3 }]));
    expect(h.parts[0]!.center.y).toBeCloseTo(-7.8, 2);
    expect(byPurpose(h, 'sound').center.y).toBeCloseTo(-7.8, 2);
    expect(h.parts[0]!.bbox).toEqual({ minX: 14, minY: -13.8, maxX: 26, maxY: -1.8 });
  });
  test('the module comes from board metadata when the part number is missing', () => {
    const h = buildMechHandoff(circuitJson(FOCUS, { mpn: false }), { parts: FOCUS.map(p => ({ id: p.id, module: p.module })) });
    expect(h.parts.find(p => p.id === 'U1')!.module).toBe(MODULE.esp32);
    expect(h.warnings).toEqual([]);
  });
  test('an unknown part is kept as a block and warned about', () => {
    const h = buildMechHandoff(circuitJson([{ id: 'X9', module: 'mystery-part', x: 0, y: 0 }]));
    expect(h.parts[0]).toMatchObject({ module: 'unknown', blocks: [] });
    expect(h.warnings.join(' ')).toContain('X9 is not a catalog module');
    expect(h.warnings.join(' ')).toContain('No USB connector');
  });
  test('pads that disagree with the catalog raise a warning', () => {
    const elements = JSON.parse(circuitJson([FOCUS[1]!]));
    elements.find((e: any) => e.type === 'pcb_plated_hole').x += 3;
    expect(buildMechHandoff(JSON.stringify(elements)).warnings.join(' ')).toContain('U2: its pads differ');
  });
  test('non-M3 holes are ignored with a warning, and no holes at all is flagged', () => {
    const h = buildMechHandoff(circuitJson(FOCUS, { holes: [{ x: 0, y: 0, d: 1.2 }] }));
    expect(h.board.holes).toEqual([]);
    expect(h.warnings.join(' ')).toContain('Ignored non-M3');
    expect(h.warnings.join(' ')).toContain('no M3 holes');
  });
  test.each([
    ['not an array', '{"a":1}', 'not an array'],
    ['no board', '[]', 'no pcb_board'],
    ['a huge board', circuitJson([], { width: 9000 }), 'invalid board width'],
    ['a board over the limit', circuitJson([], { width: 500 }), 'out of range'],
    ['malformed JSON', 'nope', ''],
  ])('%s is refused', (_label, text, message) => { expect(() => buildMechHandoff(text)).toThrow(message); });
  test('the same circuit gives the same handoff', () => {
    expect(JSON.stringify(buildMechHandoff(circuitJson(FOCUS)))).toBe(JSON.stringify(handoff));
  });
});

test('mechanical handoff preserves rounded PCB outline coordinates', () => {
  const cj = JSON.parse(circuitJson(FOCUS));
  const board = cj.find((e: any) => e.type === 'pcb_board');
  board.outline = [{x:-42,y:-50},{x:42,y:-50},{x:45,y:-47},{x:45,y:47},{x:42,y:50},{x:-42,y:50},{x:-45,y:47},{x:-45,y:-47}];
  expect(buildMechHandoff(JSON.stringify(cj)).board.outline).toEqual(board.outline);
});

describe('shared module geometry', () => {
  test('the preview model and the handoff agree on where the encoder shaft is', () => {
    const shaft = moduleBlocksCentered(MODULE.encoder).find(b => b.label === 'encoder shaft')!;
    // Catalog (9.2, 9.5) on a 32 x 19 outline is (-6.8, 0) from the outline centre.
    expect(shaft.x).toBeCloseTo(-6.8, 3);
    expect(shaft.y).toBeCloseTo(0, 3);
    const placed = buildMechHandoff(circuitJson([{ id: 'SW1', module: MODULE.encoder, x: 20, y: -25.3 }]));
    const hole = placed.apertures.find(a => a.purpose === 'encoder-shaft')!;
    expect(hole.center.x).toBeCloseTo(20 + shaft.x, 2);
    expect(hole.center.y).toBeCloseTo(-25.3 + shaft.y, 2);
  });
  test('a leaded part centres on its pads in the preview too', () => {
    const body = moduleBlocksCentered(MODULE.piezo)[0]!;
    expect(body.x).toBeCloseTo(0, 3);
    expect(body.y).toBeCloseTo(-6.5, 3);
  });
  test('the preview plan is a tscircuit JSCAD model with no unknown modules accepted', () => {
    const plan = modulePreviewPlan(MODULE.oled);
    expect(plan.modelOriginPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect((plan.jscad as any).type).toBe('union');
    expect((plan.jscad as any).shapes.length).toBeGreaterThan(3);
    expect(() => modulePreviewPlan('mystery')).toThrow('mystery');
  });
});

describe('baseline', () => {
  const handoff = buildMechHandoff(circuitJson(FOCUS));
  test('create-fdm-enclosure gives a box around the envelope, with reported mesh counts', () => {
    const result = buildBaseline(handoff);
    // Envelope x 90, y 100 + 1 USB overhang, plus 0.3 fit and 2 wall per side.
    expect(result.dimensions.x).toBeCloseTo(94.6, 2);
    expect(result.dimensions.y).toBeCloseTo(105.6, 2);
    expect(result.offset.y).toBeCloseTo(-0.5, 2);
    expect(result.baseCheck.triangles).toBeGreaterThan(100);
    expect(result.lidCheck.triangles).toBeGreaterThan(100);
    expect(result.baseCheck.signedVolumeMm3).toBeGreaterThan(1000);
    // The warning must match the measured mesh state.
    const nonManifold = !result.baseCheck.watertight || !result.lidCheck.watertight;
    expect(result.warnings.some(w => w.includes('not edge-manifold'))).toBe(nonManifold);
  });
});

describe('assembly.glb', () => {
  const handoff = buildMechHandoff(circuitJson(FOCUS));
  const board = tinyGlb();
  const glb = buildAssemblyGlb({ boardGlb: board, base: cube(), lid: cube(5), boardBottomZ: 7, boardTopZ: 8.6, seamZ: 28, thicknessMm: 1.6, parts: handoff.parts });
  const { gltf, bin, declared } = parseGlb(glb);
  const names = gltf.scenes[0].nodes.map((i: number) => gltf.nodes[i].name);

  test('it has the board plus named enclosure and module nodes', () => {
    expect(names).toEqual(expect.arrayContaining(['Box0', 'enclosure-base', 'enclosure-lid', 'modules-U1', 'modules-U2', 'modules-SW1']));
    expect(declared).toBe(glb.length);
  });
  test('the board data stays byte-identical at the front of the buffer', () => {
    const original = parseGlb(board).bin;
    expect(Array.from(bin.subarray(0, original.length))).toEqual(Array.from(original));
  });
  test('the lid is translucent and the base is opaque', () => {
    const material = (name: string) => gltf.materials.find((m: any) => m.name === name);
    expect(material('enclosure-lid').alphaMode).toBe('BLEND');
    expect(material('enclosure-lid').pbrMetallicRoughness.baseColorFactor[3]).toBeLessThan(1);
    expect(material('enclosure-base').alphaMode).toBeUndefined();
  });
  test('every buffer view fits and is 4-byte aligned, and accessor bounds use the board frame', () => {
    expect(gltf.buffers[0].byteLength).toBe(bin.length);
    for (const v of gltf.bufferViews) { expect((v.byteOffset ?? 0) % 4).toBe(0); expect((v.byteOffset ?? 0) + v.byteLength).toBeLessThanOrEqual(bin.length); }
    // Enclosure z = 0 maps to glTF y = -(7 + 0.8). Board x maps to -x and board y to z.
    const node = gltf.nodes.find((n: any) => n.name === 'enclosure-base');
    const position = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
    expect(position.min).toEqual([-10, -7.800000190734863, 0]);
    expect(position.max[0]).toBe(0);
    expect(position.max[2]).toBe(10);
  });
  test('a module modelled in board.glb is not drawn twice, and unknown parts keep their model', () => {
    const { gltf: source, bin: sourceBin } = parseGlb(board);
    source.nodes.push({ name: 'U1', mesh: 0, extras: { tscircuit: { componentName: 'U1' } } }, { name: 'X9', mesh: 0, extras: { tscircuit: { componentName: 'X9' } } });
    source.scenes[0].nodes.push(1, 2);
    let json = new TextEncoder().encode(JSON.stringify(source));
    if (json.length % 4) { const padded = new Uint8Array(json.length + 4 - (json.length % 4)).fill(0x20); padded.set(json); json = padded; }
    const withModels = new Uint8Array(28 + json.length + sourceBin.length); const view = new DataView(withModels.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, withModels.length, true);
    view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); withModels.set(json, 20);
    view.setUint32(20 + json.length, sourceBin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); withModels.set(sourceBin, 28 + json.length);
    const merged = parseGlb(buildAssemblyGlb({ boardGlb: withModels, base: cube(), lid: cube(), boardBottomZ: 7, boardTopZ: 8.6, seamZ: 28, thicknessMm: 1.6, parts: handoff.parts })).gltf;
    const shown = merged.scenes[0].nodes.map((i: number) => merged.nodes[i].name);
    expect(shown).not.toContain('U1');
    expect(shown).toContain('modules-U1');
    expect(shown).toContain('X9');
    expect(shown).toContain('Box0');
  });
  test('detailed module nodes and mask material metadata survive assembly', () => {
    const original = parseGlb(board);
    original.gltf.asset.extras = {moki: {modelVersion: 2, maskMaterials: {green:[0,1]}}};
    original.gltf.nodes.push({name:'U1:esp32-devkitc-v4',mesh:0,translation:[0,0,0],extras:{moki:{role:'module',part:'U1',module:'esp32-devkitc-v4'},tscircuit:{componentName:'U1'}}});
    original.gltf.scenes[0].nodes.push(original.gltf.nodes.length-1);
    const packed = packGlbForTest(original.gltf, original.bin);
    const result = parseGlb(buildAssemblyGlb({boardGlb:packed,base:cube(),lid:cube(),boardBottomZ:7,boardTopZ:8.6,seamZ:28,thicknessMm:1.6,parts:handoff.parts})).gltf;
    expect(result.asset.extras.moki.maskMaterials.green).toEqual([0,1]);
    const shown=result.scenes[0].nodes.map((i:number)=>result.nodes[i].name);
    expect(shown).toContain('U1:esp32-devkitc-v4');expect(shown).not.toContain('modules-U1');
  });
  test('a file that is not a GLB is refused', () => {
    expect(() => buildAssemblyGlb({ boardGlb: new Uint8Array(40), base: cube(), lid: cube(), boardBottomZ: 7, boardTopZ: 8.6, seamZ: 28, thicknessMm: 1.6, parts: [] })).toThrow('not a GLB');
  });
  test('lidToAssembled inverts the print flip', () => {
    expect(Array.from(lidToAssembled(new Float32Array([1, 2, 3]), 30))).toEqual([1, -2, 27]);
  });
});

describe('bun eda/enclosure.ts', () => {
  const cli = resolve(import.meta.dir, '../enclosure.ts');
  const makeJob = () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-enclosure-test-'));
    writeFileSync(join(dir, 'circuit.json'), circuitJson(FOCUS));
    writeFileSync(join(dir, 'board.glb'), tinyGlb());
    return dir;
  };
  const run = (dir: string, python?: string) => {
    // Each run gets an empty cache, so these tests always exercise the real path.
    const env: Record<string, string> = { ...process.env as Record<string, string>, MOKI_MECH_CACHE_DIR: join(dir, 'mech-cache') };
    if (python) env.MOKI_BUILD123D_PYTHON = python;
    const proc = Bun.spawnSync([process.execPath, cli, '--job', dir], { env, stdout: 'pipe', stderr: 'pipe', timeout: 110_000 });
    return { code: proc.exitCode, receipt: JSON.parse(proc.stdout.toString().trim().split('\n').pop()!) };
  };

  test('with build123d missing, it falls back to the baseline and says so', () => {
    const dir = makeJob();
    try {
      const { code, receipt } = run(dir, join(dir, 'no-such-python'));
      expect(code).toBe(0);
      expect(receipt.status).toBe('done');
      expect(receipt.note).toContain('fallback');
      expect(receipt.stages.find((s: any) => s.name === 'enclosure').status).toBe('failed');
      expect(receipt.stages.find((s: any) => s.name === 'enclosure-baseline').status).toBe('done');
      const report = JSON.parse(readFileSync(join(dir, 'enclosure.json'), 'utf8'));
      expect(report.engine).toMatchObject({ name: '@tscircuit/create-fdm-enclosure', fallback: true });
      expect(report.engine.fallbackReason).toContain('not found');
      expect(report.physicalPrint).toBe(false);
      for (const name of ['enclosure-base.stl', 'enclosure-lid.stl', 'assembly.glb', 'mech-handoff.json']) expect(existsSync(join(dir, name))).toBe(true);
      expect(existsSync(join(dir, 'enclosure.step'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  test('a crashing build123d also falls back, with the reason', () => {
    const dir = makeJob();
    try {
      const fake = join(dir, 'fake-python');
      writeFileSync(fake, '#!/bin/sh\necho "boom in the kernel" >&2\nexit 3\n');
      chmodSync(fake, 0o755);
      const { code, receipt } = run(dir, fake);
      expect(code).toBe(0);
      expect(receipt.note).toContain('boom in the kernel');
      expect(JSON.parse(readFileSync(join(dir, 'enclosure.json'), 'utf8')).engine.fallback).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  test('a job with no circuit.json fails with exit code 1 and a receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-enclosure-test-'));
    try {
      const { code, receipt } = run(dir, join(dir, 'no-such-python'));
      expect(code).toBe(1);
      expect(receipt.status).toBe('failed');
      expect(receipt.stages[0].name).toBe('mech-handoff');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  test('a mech cache hit reuses the exact outputs and says so', () => {
    const dir = makeJob(); const second = makeJob(); const cache = mkdtempSync(join(tmpdir(), 'moki-mech-cache-'));
    const fake = join(cache, 'fake-python');
    // A stand-in that writes the files a real run writes, and counts its runs.
    writeFileSync(fake, `#!/bin/sh\nJOB="$3"\necho run >> "${cache}/runs"\nprintf 'b' > "$JOB/enclosure-base.stl"\nprintf 'l' > "$JOB/enclosure-lid.stl"\nprintf 's' > "$JOB/enclosure.step"\necho '{"engine":{"name":"build123d","version":"x","fallback":false},"dimensions":{"outerMm":{"z":1},"boardBottomZ":7,"boardTopZ":8.6,"seamZ":20}}' > "$JOB/enclosure.json"\necho '{"name":"enclosure","status":"done","ms":1,"note":"fresh"}'\n`);
    chmodSync(fake, 0o755);
    const go = (job: string) => JSON.parse(Bun.spawnSync([process.execPath, cli, '--job', job], { env: { ...process.env as Record<string, string>, MOKI_BUILD123D_PYTHON: fake, MOKI_MECH_CACHE_DIR: cache }, stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim().split('\n').pop()!);
    try {
      expect(go(dir).note).toContain('fresh');
      const hit = go(second);
      expect(hit.note).toContain('cache hit');
      expect(hit.stages.find((s: any) => s.name === 'enclosure').note).toContain('cache hit');
      expect(readFileSync(join(cache, 'runs'), 'utf8').trim().split('\n')).toHaveLength(1);
      expect(readFileSync(join(second, 'enclosure.step'), 'utf8')).toBe('s');
      const report = JSON.parse(readFileSync(join(second, 'enclosure.json'), 'utf8'));
      expect(report.mechCache).toBe('hit');
      // A changed board must miss.
      writeFileSync(join(second, 'circuit.json'), circuitJson([FOCUS[0]!]));
      expect(go(second).note).toContain('fresh');
      expect(readFileSync(join(cache, 'runs'), 'utf8').trim().split('\n')).toHaveLength(2);
    } finally { for (const d of [dir, second, cache]) rmSync(d, { recursive: true, force: true }); }
  }, 60_000);

  const venv = resolve(homedir(), '.local/share/moki-tools/build123d-venv/bin/python');
  test.skipIf(!existsSync(venv))('with build123d present, it produces the full artifact set, valid and watertight', () => {
    const dir = makeJob();
    try {
      const { code, receipt } = run(dir);
      expect(code).toBe(0);
      expect(receipt.note).toContain('build123d');
      const report = JSON.parse(readFileSync(join(dir, 'enclosure.json'), 'utf8'));
      expect(report.engine).toMatchObject({ name: 'build123d', fallback: false });
      expect(report.validation.base.isValid).toBe(true);
      expect(report.validation.lid.isValid).toBe(true);
      expect(report.validation.failures).toEqual([]);
      // The TypeScript checker must agree with the Python one on the exported files.
      for (const part of ['base', 'lid'] as const) {
        const check = checkMesh(readBinaryStl(new Uint8Array(readFileSync(join(dir, `enclosure-${part}.stl`)))));
        expect(check.watertight).toBe(true);
        expect(check.triangles).toBe(report.validation[part].stl.triangles);
        expect(check.edges).toBe(report.validation[part].stl.edges);
      }
      expect(readFileSync(join(dir, 'enclosure.step'), 'latin1').startsWith('ISO-10303-21')).toBe(true);
      const names = parseGlb(new Uint8Array(readFileSync(join(dir, 'assembly.glb')))).gltf.nodes.map((n: any) => n.name);
      expect(names).toEqual(expect.arrayContaining(['enclosure-base', 'enclosure-lid', 'modules-U1']));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
