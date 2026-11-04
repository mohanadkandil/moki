import { Minus, Plus, Scan, SquareDashed } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const MAT = '#2e7657';
const MAT_MINOR = '#3a8363';
const MAT_MAJOR = '#4a9474';
/** Millimetres. tscircuit's GLB and the enclosure STLs are both in mm. */
const TILE_MM = 50;

function matTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = MAT;
  g.fillRect(0, 0, size, size);
  const step = size / (TILE_MM / 10);
  g.strokeStyle = MAT_MINOR;
  g.lineWidth = 2;
  for (let i = 1; i < 5; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
  }
  g.strokeStyle = MAT_MAJOR;
  g.lineWidth = 4;
  g.strokeRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean) as THREE.MeshStandardMaterial[];
    for (const m of materials) { m.map?.dispose(); m.dispose(); }
  });
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  key: THREE.DirectionalLight;
  draw(): void;
  size: THREE.Vector3;
  view(kind: 'angle' | 'top'): void;
}

export type ModelFormat = 'glb' | 'stl';

/**
 * A model resting on the lab's cutting mat. The mat's printed 10 mm squares give real scale, so its
 * grid is information, not decoration. Draws only when something changes.
 */
export default function ModelView({ url, format, label, hiddenNodes }: { url: string; format: ModelFormat; label: string; hiddenNodes?: readonly string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [noGl, setNoGl] = useState(false);
  const hidden = hiddenNodes?.join('|') ?? '';

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    } catch {
      setNoGl(true);
      return;
    }
    let disposed = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(MAT);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', label);
    renderer.domElement.tabIndex = 0;
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    room.dispose(); pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.32;
    scene.add(new THREE.HemisphereLight('#ffffff', '#55705f', 0.75));
    const key = new THREE.DirectionalLight('#fff9e9', 1.7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.3;
    scene.add(key, key.target);

    // One-sided: from underneath the mat disappears, so the board's bottom copper can be inspected.
    const texture = matTexture();
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const span = 4000;
    texture.repeat.set(span / TILE_MM, span / TILE_MM);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, envMapIntensity: 0.2 }));
    mat.rotation.x = -Math.PI / 2;
    mat.receiveShadow = true;
    scene.add(mat);

    const root = new THREE.Group();
    scene.add(root);

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.enableDamping = !still;
    controls.dampingFactor = 0.1;
    controls.zoomSpeed = 0.7;
    controls.listenToKeyEvents(renderer.domElement);

    let frame = 0;
    const tick = () => {
      frame = 0;
      if (disposed) return;
      const moving = controls.update();
      renderer.render(scene, camera);
      if (moving) draw();
    };
    const draw = () => { if (!frame && !disposed) frame = requestAnimationFrame(tick); };
    controls.addEventListener('change', draw);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const size = new THREE.Vector3(80, 10, 70);
    const view = (kind: 'angle' | 'top') => {
      const s = stage.current?.size ?? size;
      const radius = Math.max(Math.hypot(s.x, s.y, s.z) / 2, 1);
      // tscircuit's GLB puts PCB +Y at +Z and PCB +X at -X, so this camera reads the silkscreen upright.
      const dir = kind === 'top' ? new THREE.Vector3(0, 1, -0.001) : new THREE.Vector3(-0.24, 1, -0.8);
      dir.normalize();
      controls.target.set(0, s.y / 2, 0);
      // Fit the box actually on screen, not its bounding sphere: a flat board in a sphere looks tiny,
      // and any fixed margin crops a tall enclosure. Perspective makes this non-linear, so iterate.
      const corners = [-1, 1].flatMap(x => [0, 1].flatMap(y => [-1, 1].map(z => new THREE.Vector3((x * s.x) / 2, y * s.y, (z * s.z) / 2))));
      let distance = radius * 4;
      camera.near = Math.max(radius / 100, 0.5);
      camera.far = radius * 60;
      camera.updateProjectionMatrix();
      for (let i = 0; i < 6; i++) {
        camera.position.copy(controls.target).addScaledVector(dir, distance);
        camera.lookAt(controls.target);
        camera.updateMatrixWorld();
        const reach = Math.max(...corners.map(c => { const p = c.clone().project(camera); return Math.max(Math.abs(p.x), Math.abs(p.y)); }));
        distance *= reach / 0.92;
      }
      camera.position.copy(controls.target).addScaledVector(dir, distance);
      controls.minDistance = radius * 0.25;
      controls.maxDistance = distance * 4;
      controls.update();
      draw();
    };

    stage.current = { renderer, scene, camera, controls, root, key, draw, size, view };

    return () => {
      disposed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      controls.dispose();
      disposeObject(root);
      disposeObject(mat);
      texture.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      stage.current = null;
    };
    // The aria label is refreshed by the effect below; the stage lives as long as the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.renderer.domElement.setAttribute('aria-label', label);
  }, [label]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let live = true;
    setStatus('loading');
    setMessage('');
    const load = format === 'glb'
      ? new GLTFLoader().loadAsync(url).then(g => g.scene as THREE.Object3D)
      : new STLLoader().loadAsync(url).then(geometry => {
        // A printable part is Z-up in the board's frame. This is the same turn tscircuit's GLB applies
        // (X to -X, Y to +Z, Z to +Y), so the wall that faces front on the board faces front here too.
        geometry.applyMatrix4(new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
        geometry.computeVertexNormals();
        return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#d5d3c8', roughness: 0.7, metalness: 0 })) as THREE.Object3D;
      });
    load.then(object => {
      if (!live) { disposeObject(object); return; }
      disposeObject(s.root);
      s.root.clear();
      object.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      // Centre on the mat and rest on it, without assuming where the source's origin was.
      const holder = new THREE.Group();
      holder.add(object);
      holder.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(holder);
      const center = box.getCenter(new THREE.Vector3());
      holder.position.set(-center.x, -box.min.y + 0.05, -center.z);
      s.root.add(holder);
      box.getSize(s.size);
      const reach = Math.max(s.size.x, s.size.z, s.size.y) * 1.4;
      s.key.position.set(-reach * 0.5, reach * 1.6, -reach * 0.8);
      s.key.target.position.set(0, 0, 0);
      Object.assign(s.key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: reach * 5 });
      s.key.shadow.camera.updateProjectionMatrix();
      s.view('angle');
      setStatus('ready');

    }).catch((err: unknown) => {
      if (live) { setStatus('error'); setMessage(err instanceof Error ? err.message : String(err)); }
    });
    return () => { live = false; };
  }, [url, format]);

  // Named nodes in the assembly (the lid, the base) can be switched off without reloading.
  useEffect(() => {
    const s = stage.current;
    if (!s || status !== 'ready') return;
    const names = new Set(hidden ? hidden.split('|') : []);
    s.root.traverse(o => { if (o.name) o.visible = !names.has(o.name); });
    s.draw();
  }, [hidden, status]);

  if (noGl) {
    return <div className="bs-state"><p><strong>This browser can’t open the 3D view.</strong></p><p className="lab-quiet">WebGL isn’t available. The model file is in Files.</p></div>;
  }

  function dolly(factor: number) {
    const s = stage.current;
    if (!s) return;
    const offset = s.camera.position.clone().sub(s.controls.target).multiplyScalar(factor);
    s.camera.position.copy(s.controls.target).add(offset);
    s.controls.update();
    s.draw();
  }

  return (
    <div className="bs-model" ref={host} data-status={status}>
      {status === 'loading' && <p className="bs-model-note" role="status">Loading the model…</p>}
      {status === 'error' && <p className="bs-model-note is-error" role="alert">The model didn’t load: {message}</p>}
      <div className="lab-zoom" role="toolbar" aria-label="3D view">
        <button type="button" onClick={() => dolly(1.2)} aria-label="Zoom out"><Minus size={16} /></button>
        <button type="button" onClick={() => dolly(0.82)} aria-label="Zoom in"><Plus size={16} /></button>
        <button type="button" onClick={() => stage.current?.view('top')} aria-label="View from above"><SquareDashed size={16} /></button>
        <button type="button" onClick={() => stage.current?.view('angle')} aria-label="Reset view"><Scan size={16} /></button>
      </div>
    </div>
  );
}
