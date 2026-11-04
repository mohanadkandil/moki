// Browser side of the evidence renderer (see render-evidence.ts). Reads window.__VIEW and draws one PNG-sized frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

declare global { interface Window { __VIEW: any; __DONE?: boolean } }
const view = window.__VIEW;
const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0'; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1f0ec);
scene.add(new THREE.HemisphereLight(0xffffff, 0xa8a8a0, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(0.6, 1.2, 0.8).multiplyScalar(300); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-0.8, 0.4, -0.6).multiplyScalar(300); scene.add(fill);
const under = new THREE.DirectionalLight(0xffffff, 0.9); under.position.set(0.3, -1, 0.3).multiplyScalar(300); scene.add(under);

const root = new THREE.Group(); scene.add(root);
if (view.kind === 'stl') {
  const geometry = new STLLoader().parse(bytes(view.data));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcfcbc0, roughness: 0.8, flatShading: true }));
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0x2c2c2a })));
  // STL is Z up; the page uses Y up.
  mesh.rotation.x = -Math.PI / 2;
  root.add(mesh);
} else {
  const gltf = await new GLTFLoader().parseAsync(bytes(view.data), '');
  gltf.scene.traverse((o: any) => {
    if (o.isMesh && (view.hide ?? []).some((h: string) => o.name.startsWith(h) || o.parent?.name?.startsWith(h))) o.visible = false;
    if (o.isMesh && o.material?.name === 'enclosure-lid') {
      if (view.lidAlpha !== undefined) o.material.opacity = view.lidAlpha;
      if (view.lidAlpha === 1) { o.material.transparent = false; o.material.depthWrite = true; }
      o.renderOrder = 2;
    }
  });
  (view.hide ?? []).forEach((h: string) => gltf.scene.traverse((o: any) => { if (o.name?.startsWith(h)) o.visible = false; }));
  root.add(gltf.scene);
}
root.updateMatrixWorld(true);
const box = new THREE.Box3();
root.traverse((o: any) => { if (o.isMesh && o.visible && o.parent?.visible !== false) box.expandByObject(o); });
const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
const radius = size.length() / 2;
const aspect = innerWidth / innerHeight;
const fit = radius * (view.zoom ?? 1.05);
const camera = new THREE.OrthographicCamera(-fit * aspect, fit * aspect, fit, -fit, 0.1, radius * 12);
const dir = new THREE.Vector3(...(view.dir as [number, number, number])).normalize();
camera.position.copy(center).addScaledVector(dir, radius * 5);
camera.up.set(...((view.up ?? [0, 1, 0]) as [number, number, number]));
camera.lookAt(center);
if (view.clipBelow !== undefined) { renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), view.clipBelow)]; }
renderer.render(scene, camera);
window.__DONE = true;
