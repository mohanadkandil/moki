// The photo stage around a model: a lit floor that melts into the backdrop, the mm grid, baked contact shadows and framing.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

/** The backdrop the floor fades into. --stage-back in studio.css is the same colour, so nothing flashes while the GL context starts. */
export const BACKDROP = '#1d1b19';
const FLOOR = '#3f3d3a';

export function buildFloor(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const fade = g.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
  fade.addColorStop(0, '#fff');
  fade.addColorStop(0.45, '#8a8a8a');
  fade.addColorStop(1, '#000');
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.9, metalness: 0, envMapIntensity: 0.3, alphaMap: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, dithering: true }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = -3;
  return floor;
}

/** A 10 mm and 50 mm grid drawn in the fragment shader: antialiased at any distance, and it fades out with the floor. */
export function buildGrid(): THREE.Mesh {
  const grid = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { opacity: { value: 0 }, reach: { value: 200 } },
      vertexShader: 'varying vec3 w; void main() { vec4 p = modelMatrix * vec4(position, 1.0); w = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }',
      fragmentShader: `
        uniform float opacity; uniform float reach; varying vec3 w;
        float line(float step) { vec2 q = w.xz / step; vec2 c = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(c.x, c.y), 1.0); }
        void main() {
          float fade = 1.0 - smoothstep(reach * 0.25, reach, length(w.xz));
          float a = max(line(10.0) * 0.5, line(50.0)) * fade * opacity;
          if (a < 0.002) discard;
          gl_FragColor = vec4(0.93, 0.89, 0.82, a);
        }`,
    }),
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.02;
  grid.renderOrder = -1;
  return grid;
}

const CONTACT_MATERIAL = new THREE.ShaderMaterial({
  side: THREE.DoubleSide, blending: THREE.NoBlending,
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  // An orthographic camera writes linear depth, so this is height above the plane as a share of the range.
  fragmentShader: 'void main() { float h = 1.0 - gl_FragCoord.z; gl_FragColor = vec4(0.0, 0.0, 0.0, h * h); }',
});

/** A soft shadow on a plane, baked by looking up at what's above it. It costs one small render per model, not one per frame. */
export class ContactShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly sharp: THREE.WebGLRenderTarget;
  private readonly soft: THREE.WebGLRenderTarget;

  constructor(resolution: number, darkness: number, order: number) {
    this.sharp = new THREE.WebGLRenderTarget(resolution, resolution, { depthBuffer: true });
    this.soft = new THREE.WebGLRenderTarget(resolution, resolution, { depthBuffer: false });
    const geometry = new THREE.PlaneGeometry(1, 1);
    // The bake camera's up is +z, so the texture's v runs along +z. A plane laid flat runs its v along -z.
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.sharp.texture, color: '#000', transparent: true, depthWrite: false, opacity: darkness, toneMapped: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = order;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /** `rect` is in world space. Only what `scene` shows at bake time, between `y` and `y + range`, leaves a shadow. */
  bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, rect: { minX: number; maxX: number; minZ: number; maxZ: number }, y: number, range: number, blurMm: number) {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const camera = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0, range);
    camera.position.set((rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2);
    camera.rotation.x = Math.PI / 2;
    camera.updateMatrixWorld();

    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const autoShadow = renderer.shadowMap.autoUpdate;
    const environment = scene.environment;
    renderer.shadowMap.autoUpdate = false;
    scene.environment = null;
    scene.overrideMaterial = CONTACT_MATERIAL;
    renderer.setClearColor('#000', 0);
    renderer.setRenderTarget(this.sharp);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    scene.environment = environment;

    // Blur there and back, twice, so the texture the mesh shows ends up in `sharp`.
    const h = new THREE.ShaderMaterial({ ...HorizontalBlurShader, uniforms: THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms), depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const v = new THREE.ShaderMaterial({ ...VerticalBlurShader, uniforms: THREE.UniformsUtils.clone(VerticalBlurShader.uniforms), depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const quad = new FullScreenQuad(h);
    for (const scale of [1, 0.5]) {
      h.uniforms.h!.value = (blurMm * scale) / w;
      h.uniforms.tDiffuse!.value = this.sharp.texture;
      quad.material = h;
      renderer.setRenderTarget(this.soft);
      renderer.clear();
      quad.render(renderer);
      v.uniforms.v!.value = (blurMm * scale) / d;
      v.uniforms.tDiffuse!.value = this.soft.texture;
      quad.material = v;
      renderer.setRenderTarget(this.sharp);
      renderer.clear();
      quad.render(renderer);
    }
    quad.dispose(); h.dispose(); v.dispose();
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, clearAlpha);
    renderer.shadowMap.autoUpdate = autoShadow;
    renderer.shadowMap.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.sharp.dispose();
    this.soft.dispose();
  }
}

/** Printed PLA: matte, with the slight sheen of an extruded surface. */
export function plaMaterial(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, metalness: 0, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color('#fff4e2'), specularIntensity: 0.55 });
}

/** The solder mask's lacquer: a clear coat over the texture tscircuit baked, so the key light slides across the board when it turns. */
export function maskMaterial(from: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const mask = new THREE.MeshPhysicalMaterial({ map: from.map, color: from.color, side: from.side, roughness: 0.62, metalness: 0, normalMap: from.normalMap, specularIntensity: 0.5, envMapIntensity: 0.5, clearcoat: 0.22, clearcoatRoughness: 0.38 });
  mask.name = from.name;
  // Remember which face this paints: variants loaded later carry names like moki-mask-black-top, or none we know.
  const face = /top/i.test(from.name) ? 'TopMaterial_' : /bottom/i.test(from.name) ? 'BottomMaterial_' : null;
  if (face) mask.userData.maskFace = face;
  return mask;
}

/** The view direction for the ¾ hero shot. From the board's front edge, so its silkscreen reads the right way up. */
export const HERO = new THREE.Vector3(-0.5, 0.66, -0.78).normalize();

/**
 * Where the camera goes so `box` fills `fill` of the canvas along whichever side is tighter, and sits centred on what you see.
 * It projects the box's corners rather than wrapping it in a sphere, which is why a flat board doesn't end up small.
 */
export function fitBox(box: THREE.Box3, direction: THREE.Vector3, fov: number, aspect: number, fill: number) {
  const dir = direction.clone().normalize();
  const worldUp = Math.abs(dir.y) > 0.999 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * aspect;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const target = box.getCenter(new THREE.Vector3());
  const span = box.getSize(new THREE.Vector3()).length() || 1;
  const measure = (distance: number) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const r = new THREE.Vector3();
    for (const corner of corners) {
      r.copy(corner).sub(target);
      const depth = distance - r.dot(dir);
      const x = r.dot(right) / (depth * tanH);
      const y = r.dot(up) / (depth * tanV);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY };
  };
  let distance = span;
  for (let pass = 0; pass < 4; pass++) {
    let near = span * 0.51, far = span * 60;
    for (let i = 0; i < 26; i++) {
      distance = (near + far) / 2;
      const m = measure(distance);
      if (Math.max((m.maxX - m.minX) / 2, (m.maxY - m.minY) / 2) > fill) near = distance; else far = distance;
    }
    const m = measure(distance);
    target.addScaledVector(right, ((m.minX + m.maxX) / 2) * distance * tanH).addScaledVector(up, ((m.minY + m.maxY) / 2) * distance * tanV);
  }
  return { target, distance };
}
