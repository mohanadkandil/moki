import { Grid3x3, Scan, SquareDashed } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { liftShare, maskFace, MASKS, partLabel, partOfNode, readMaskMaterials, type MaskId, type MaskMaterials } from './parts';
import { Rail, RailButton, RailGap, usePaneKeys } from './Rail';
import { BACKDROP, buildFloor, buildGrid, ContactShadow, fitBox, HERO, maskMaterial, plaMaterial } from './stageScene';

export type Explode = 'assembled' | 'exploded';
export type LidMode = 'solid' | 'ghost' | 'hidden';

export interface ModelProps {
  url: string;
  format: 'glb' | 'stl';
  label: string;
  /** Node names to hide, from the assembly's scene graph. */
  hidden?: readonly string[];
  /** Hides every module and socket, whatever the template put on the board. */
  hideParts?: boolean;
  lid?: LidMode;
  explode?: Explode;
  /** Enclosure-frame position (x, y, z in mm) to mark, from enclosure.json. */
  marker?: readonly [number, number, number] | null;
  /** The part selected anywhere on the canvas, by its refdes. */
  selected?: string | null;
  onSelect?: (ref: string | null) => void;
  /** The choice of view, shown first in the dock. */
  views?: ReactNode;
  tools?: ReactNode;
}

const PLA = '#d9d4c7';
const COPPER = new THREE.Color('#f0813f');
/** Share of the canvas the object fills in the hero shot. */
const FILL = 0.7;
const FOV = 24;
const GRID_OPACITY = 0.16;

interface Part {
  ref: string;
  moduleId: string | null;
  nodes: THREE.Object3D[];
  materials: THREE.MeshStandardMaterial[];
  box: THREE.Box3;
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  floor: THREE.Mesh;
  grid: THREE.Mesh;
  gridShare: { now: number; goal: number; frame: number };
  key: THREE.SpotLight;
  fill: THREE.DirectionalLight;
  marker: THREE.Mesh;
  draw(): void;
  span: number;
  box: THREE.Box3;
  lifts: Map<THREE.Object3D, number>;
  liftNow: number;
  liftGoal: number;
  animation: number;
  parts: Part[];
  hovered: Part | null;
  selected: string | null;
  contacts: ContactShadow[];
  boardContact: ContactShadow | null;
  /** The user has turned the model, so a resize mustn't reset their view. */
  moved: boolean;
  gltf: GLTF | null;
  /** Mask variants already loaded for this GLB, in the board's own lacquer. */
  maskCache: Map<MaskId, Promise<{ top: THREE.MeshPhysicalMaterial; bottom: THREE.MeshPhysicalMaterial }>>;
}

function dispose(root: THREE.Object3D) {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean) as THREE.MeshStandardMaterial[]) { m.map?.dispose(); m.dispose(); }
  });
}

const rawName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name;

/**
 * The built model on a lit stage: a warm floor under a soft key, a shadow where it touches, and the grid only while you turn it.
 * It draws only when something changes. Assembly nodes keep their names, so the lid and the exploded view need no reload.
 */
export default function ModelPane({ url, format, label, hidden, hideParts = false, lid = 'solid', explode = 'assembled', marker, selected = null, onSelect, views, tools }: ModelProps) {
  const host = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'no-gl'>('loading');
  const [message, setMessage] = useState('');
  const [grid, setGrid] = useState(false);
  const gridPinned = useRef(grid);
  gridPinned.current = grid;
  const [hover, setHover] = useState<{ ref: string; name: string | null } | null>(null);
  const hiddenKey = `${hideParts ? `${HIDE_PARTS}|` : ''}${hidden?.join('|') ?? ''}`;
  const [masks, setMasks] = useState<MaskMaterials | null>(null);
  const [mask, setMask] = useState<MaskId>('green');
  const [maskOpen, setMaskOpen] = useState(false);
  const maskRef = useRef(mask);
  maskRef.current = mask;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { setStatus('no-gl'); return; }
    let disposed = false;
    const coarse = matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    renderer.setClearColor(BACKDROP);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // The lights don't move, so the shadow map only redraws when the model does. Orbiting never pays for it.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
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
    scene.environmentIntensity = 0.36;
    const key = new THREE.SpotLight('#fff6ea', 2.7, 0, 0.5, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.25;
    key.shadow.radius = 6;
    key.shadow.intensity = 0.88;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight('#fff4e6', 0.5);
    scene.add(fill, fill.target);
    const floor = buildFloor();
    scene.add(floor);
    const gridMesh = buildGrid();
    gridMesh.visible = false;
    scene.add(gridMesh);

    const root = new THREE.Group();
    scene.add(root);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), new THREE.MeshBasicMaterial({ color: '#f0813f', depthTest: false, transparent: true }));
    dot.renderOrder = 10;
    dot.visible = false;
    scene.add(dot);

    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 8000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.enableDamping = !still;
    controls.dampingFactor = 0.1;
    controls.zoomSpeed = 0.7;
    controls.listenToKeyEvents(renderer.domElement);

    let frame = 0;
    // A GPU that can't keep up while you orbit gets fewer pixels, once. A sharp picture isn't worth a stuttering one.
    let slow = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = 0;
      if (disposed) return;
      const moving = controls.update();
      renderer.render(scene, camera);
      if (moving && last && renderer.getPixelRatio() > 1) {
        slow = now - last > 40 ? slow + 1 : Math.max(0, slow - 1);
        if (slow > 12) { renderer.setPixelRatio(1); renderer.setSize(el.clientWidth, el.clientHeight); slow = 0; }
      }
      last = moving ? now : 0;
      placeTag(stage.current, tag.current);
      if (moving) draw();
    };
    const draw = () => { if (!frame && !disposed) frame = requestAnimationFrame(tick); };
    controls.addEventListener('change', draw);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      // A sheet can lie over the stage's right side. Centre the shot in what's left, so the object isn't framed under the paper.
      const covered = parseFloat(getComputedStyle(el).getPropertyValue('--stage-covered')) || 0;
      camera.aspect = Math.max(w - covered, 1) / h;
      if (covered) camera.setViewOffset(w - covered, h, 0, 0, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      const s = stage.current;
      if (s && !s.moved && !s.box.isEmpty()) frameView(s, s.liftGoal === 1, HERO);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const s: Stage = {
      renderer, scene, camera, controls, root, floor, grid: gridMesh, gridShare: { now: 0, goal: 0, frame: 0 }, key, fill, marker: dot, draw,
      span: 100, box: new THREE.Box3(), lifts: new Map(), liftNow: 0, liftGoal: 0, animation: 0, parts: [], hovered: null, selected: null, contacts: [], boardContact: null, moved: false, gltf: null, maskCache: new Map(),
    };
    stage.current = s;

    // The grid is only there while you turn the model, unless it's pinned on from the rail.
    let gridTimer = 0;
    const onStart = () => { s.moved = true; window.clearTimeout(gridTimer); fadeGrid(s, 1); setPicked(s, null); };
    const onEnd = () => { gridTimer = window.setTimeout(() => { if (!gridPinned.current) fadeGrid(s, 0); }, 500); };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);

    // Hover is one ray against each part's box, once a frame at most. Dense models cost no more than sparse ones.
    const ndc = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    let dragging = false;
    let pick = 0;
    const pickAt = (x: number, y: number): Part | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return nearestPart(s, ray.ray);
    };
    const setPicked = (st: Stage, part: Part | null) => {
      if (st.hovered === part) return;
      st.hovered = part;
      paintParts(st);
      setHover(part ? partLabel(part.ref, part.moduleId) : null);
      st.draw();
    };
    const onMove = (e: PointerEvent) => {
      if (dragging || e.pointerType === 'touch' || pick) return;
      const { clientX, clientY } = e;
      pick = requestAnimationFrame(() => { pick = 0; setPicked(s, pickAt(clientX, clientY)); });
    };
    const onLeave = () => { setPicked(s, null); };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { dragging = true; downAt = { x: e.clientX, y: e.clientY }; };
    // A tap is a touch screen's hover: the part stays labelled until you tap away or turn the model.
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
        const picked = pickAt(e.clientX, e.clientY);
        if (e.pointerType === 'touch') setPicked(s, picked);
        select.current?.(picked?.ref ?? null);
      }
      downAt = null;
    };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pick);
      cancelAnimationFrame(s.animation);
      cancelAnimationFrame(s.gridShare.frame);
      window.clearTimeout(gridTimer);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      observer.disconnect();
      controls.dispose();
      for (const contact of s.contacts) contact.dispose();
      forgetMasks(s);
      dispose(scene);
      (floor.material as THREE.MeshStandardMaterial).alphaMap?.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
    };
    // The renderer lives as long as the pane. The model below swaps inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let live = true;
    setStatus('loading');
    const place = (object: THREE.Object3D) => {
      if (!live) { dispose(object); return; }
      for (const contact of s.contacts) contact.dispose();
      s.contacts = [];
      s.boardContact = null;
      forgetMasks(s);
      s.hovered = null;
      setHover(null);
      dispose(s.root);
      s.root.clear();
      s.lifts.clear();
      s.liftNow = 0;
      s.moved = false;
      s.root.add(object);
      dress(object, s.renderer);
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      // Rest it on the floor, centred.
      const c = box.getCenter(new THREE.Vector3());
      object.position.set(-c.x, -box.min.y, -c.z);
      object.updateWorldMatrix(true, true);
      s.box.setFromObject(object);
      const size = s.box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 1);
      s.span = span;
      light(s, span);
      s.parts = collectParts(object);
      s.grid.visible = grid;
      s.gridShare.now = s.gridShare.goal = grid ? 1 : 0;
      (s.grid.material as THREE.ShaderMaterial).uniforms.opacity!.value = grid ? GRID_OPACITY : 0;
      (s.grid.material as THREE.ShaderMaterial).uniforms.reach!.value = span * 2.2;
      s.camera.near = span * 0.03;
      s.camera.far = span * 60;
      s.camera.updateProjectionMatrix();
      s.controls.minDistance = span * 0.45;
      s.controls.maxDistance = span * 10;
      bakeContacts(s, object);
      setStatus('ready');
      applyNodes(s, hiddenKey, lid);
      setLift(s, explode, true);
      frameView(s, explode === 'exploded', HERO);
      setMarker(s, marker ?? null);
      s.renderer.shadowMap.needsUpdate = true;
      // Compile the grid's shader now, so the first orbit doesn't stall on it.
      const gridShown = s.grid.visible;
      s.grid.visible = true;
      s.renderer.compile(s.scene, s.camera);
      s.grid.visible = gridShown;
      s.draw();
    };
    const fail = (err: unknown) => { if (live) { setMessage(err instanceof Error ? err.message : String(err)); setStatus('error'); } };
    if (format === 'glb') new GLTFLoader().load(url, gltf => {
      if (!live) { dispose(gltf.scene); return; }
      place(gltf.scene);
      s.gltf = gltf;
      const found = readMaskMaterials(gltf.parser.json.asset);
      setMasks(found);
      if (found && maskRef.current !== 'green') void applyMask(s, found, maskRef.current);
    }, undefined, fail);
    else new STLLoader().load(url, geometry => {
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, plaMaterial(PLA));
      mesh.rotation.x = -Math.PI / 2;
      const group = new THREE.Group();
      group.add(mesh);
      place(group);
      setMasks(null);
    }, undefined, fail);
    return () => { live = false; };
    // Only a new file reloads. Toggles below apply to the loaded scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, format]);

  useEffect(() => { const s = stage.current; if (s && status === 'ready') { applyNodes(s, hiddenKey, lid); s.renderer.shadowMap.needsUpdate = true; s.draw(); } }, [hiddenKey, lid, status]);
  useEffect(() => { const s = stage.current; if (s && status === 'ready') setLift(s, explode, false); }, [explode, status]);
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    fadeGrid(s, grid ? 1 : 0);
  }, [grid]);
  useEffect(() => {
    const s = stage.current;
    if (s && masks && status === 'ready') void applyMask(s, masks, mask);
  }, [mask, masks, status]);
  useEffect(() => { const s = stage.current; if (s && status === 'ready') { setMarker(s, marker ?? null); s.draw(); } }, [marker, status]);

  const fit = () => { const s = stage.current; if (s) { frameView(s, explode === 'exploded', HERO); s.moved = false; s.draw(); } };
  const top = () => {
    const s = stage.current;
    if (!s) return;
    // The board's front edge at the bottom of the screen, so the silkscreen reads as it does on the bench.
    frameView(s, false, new THREE.Vector3(0, 1, -0.001));
    s.moved = true;
    s.draw();
  };

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.selected = selected;
    paintParts(s);
    s.draw();
  }, [selected, status, hiddenKey]);
  usePaneKeys({ f: fit, g: () => setGrid(g => !g) });

  return (
    <div className="st-model" ref={host}>
      {status === 'loading' && <div className="st-pane-state is-over" role="status"><p>Loading the model</p></div>}
      {status === 'error' && <div className="st-pane-state is-over" role="alert"><p><strong>The model didn’t load.</strong></p><p>{message}</p></div>}
      {status === 'no-gl' && <div className="st-pane-state is-over"><p>This browser can’t show 3D. The files are in Download.</p></div>}
      <div className="st-part-tag" ref={tag} hidden={!hover} role="status">
        {hover && <span className="st-part-tag-text"><strong>{hover.ref}</strong>{hover.name && <> · {hover.name}</>}</span>}
      </div>
      <Rail label="3D tools" leading={views}>
        <RailButton label="Fit" keys="F" onClick={fit}><Scan size={16} /></RailButton>
        <RailButton label="Top view" onClick={top}><SquareDashed size={16} /></RailButton>
        <RailButton label="Grid, 10 mm squares" keys="G" pressed={grid} onClick={() => setGrid(g => !g)}><Grid3x3 size={16} /></RailButton>
        {tools}
        {masks && !hideParts && (
          <>
            <div className="st-mask">
              <RailButton label={`Solder mask: ${MASKS.find(m => m.id === mask)?.label.toLowerCase()}`} pressed={maskOpen} onClick={() => setMaskOpen(o => !o)}>
                <span className="st-mask-dot" style={{ background: MASKS.find(m => m.id === mask)?.swatch }} />
              </RailButton>
              {maskOpen && (
                <div className="st-mask-menu" role="radiogroup" aria-label="Solder mask colour">
                  {MASKS.filter(m => masks[m.id]).map(m => (
                    <button key={m.id} type="button" role="radio" aria-checked={mask === m.id} aria-label={m.label} title={m.label} onClick={() => { setMask(m.id); setMaskOpen(false); }}>
                      <span className="st-mask-dot" style={{ background: m.swatch }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Rail>
    </div>
  );
}

const HIDE_PARTS = '@parts';

/** Swaps the board's top and bottom faces to a colour the GLB carries. The variants load on first use, so the green board costs nothing extra. */
async function applyMask(s: Stage, masks: MaskMaterials, id: MaskId) {
  const gltf = s.gltf;
  const pair = masks[id];
  if (!gltf || !pair) return;
  let pending = s.maskCache.get(id);
  if (!pending) {
    const anisotropy = s.renderer.capabilities.getMaxAnisotropy();
    const load = async (index: number) => {
      const source = await gltf.parser.getDependency('material', index) as THREE.MeshStandardMaterial;
      if (source.map) { source.map.anisotropy = anisotropy; source.map.needsUpdate = true; }
      return maskMaterial(source);
    };
    pending = Promise.all([load(pair[0]), load(pair[1])]).then(([top, bottom]) => ({ top, bottom }));
    s.maskCache.set(id, pending);
  }
  const variant = await pending;
  if (s.gltf !== gltf) return;
  s.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const face = maskFace(faceName(mesh.material));
    if (face) mesh.material = variant[face];
  });
  s.draw();
}

/** A mask material keeps the name of the face it first painted, because variants arrive with the names of their own. */
const faceName = (m: THREE.Material): string => (m.userData.maskFace as string | undefined) ?? m.name;

function forgetMasks(s: Stage) {
  s.gltf = null;
  for (const pending of s.maskCache.values()) void pending.then(({ top, bottom }) => { top.dispose(); bottom.dispose(); }, () => undefined);
  s.maskCache.clear();
}

/** Gives what the GLB left plain its real surface: lacquer on the mask, PLA on the case, sharp silkscreen at a low angle. */
function dress(object: THREE.Object3D, renderer: THREE.WebGLRenderer) {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const pla = new Map<string, THREE.MeshPhysicalMaterial>();
  const visit = (o: THREE.Object3D, owner: string | null) => {
    const name = rawName(o);
    const scope = name === 'Box0' || name.startsWith('enclosure-') ? name : owner;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const swap = (m: THREE.Material): THREE.Material => {
        const standard = m as THREE.MeshStandardMaterial;
        if (standard.map) { standard.map.anisotropy = anisotropy; standard.map.needsUpdate = true; }
        if (scope?.startsWith('enclosure-')) {
          let material = pla.get(scope);
          if (!material) { material = plaMaterial(PLA); material.name = scope; pla.set(scope, material); }
          return material;
        }
        if (scope === 'Box0' && standard.isMeshStandardMaterial && standard.map) return maskMaterial(standard);
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    }
    for (const child of o.children) visit(child, scope);
  };
  visit(object, null);
}

/** Groups the nodes by refdes, and gives each part its own materials so one can light up without its neighbours. */
function collectParts(object: THREE.Object3D): Part[] {
  const parts = new Map<string, Part>();
  const visit = (o: THREE.Object3D) => {
    const found = partOfNode(rawName(o), o.userData);
    if (!found) { for (const child of o.children) visit(child); return; }
    let part = parts.get(found.ref);
    if (!part) { part = { ref: found.ref, moduleId: null, nodes: [], materials: [], box: new THREE.Box3() }; parts.set(found.ref, part); }
    part.moduleId ??= found.moduleId;
    part.nodes.push(o);
  };
  visit(object);
  for (const part of parts.values()) {
    const own = new Map<THREE.Material, THREE.Material>();
    for (const node of part.nodes) node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = (m: THREE.Material) => {
        let copy = own.get(m);
        if (!copy) { copy = m.clone(); own.set(m, copy); if ((copy as THREE.MeshStandardMaterial).isMeshStandardMaterial) part!.materials.push(copy as THREE.MeshStandardMaterial); }
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    measurePart(part);
  }
  return [...parts.values()];
}

function measurePart(part: Part) {
  part.box.makeEmpty();
  for (const node of part.nodes) part.box.expandByObject(node);
}

function nearestPart(s: Stage, ray: THREE.Ray): Part | null {
  const hit = new THREE.Vector3();
  let best: Part | null = null;
  let nearest = Infinity;
  for (const part of s.parts) {
    if (!part.nodes.some(n => n.visible) || !ray.intersectBox(part.box, hit)) continue;
    const distance = hit.distanceToSquared(ray.origin);
    if (distance < nearest) { nearest = distance; best = part; }
  }
  if (!best) return null;
  // A closed lid hides what's under it, so there's nothing to name.
  let blocked = false;
  s.root.traverse(o => {
    if (blocked || rawName(o) !== 'enclosure-lid' || !o.visible) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).transparent) return;
    const box = new THREE.Box3().setFromObject(o);
    if (ray.intersectBox(box, hit) && hit.distanceToSquared(ray.origin) <= nearest) blocked = true;
  });
  return blocked ? null : best;
}

/** A hovered part is faintly copper. A selected one, and every node with its refdes, plainly is. */
function paintParts(s: Stage) {
  for (const part of s.parts) {
    const glow = part.ref === s.selected ? 0.22 : part === s.hovered ? 0.03 : 0;
    for (const material of part.materials) {
      material.emissive.copy(glow ? COPPER : BLACK);
      material.emissiveIntensity = glow || 1;
      if (material.emissiveMap) material.emissiveMap = null;
    }
  }
}
const BLACK = new THREE.Color('#000');

const TAG_POINT = new THREE.Vector3();

/** Keeps the label above its part as the model turns. It's moved directly, so orbiting doesn't re-render React. */
function placeTag(s: Stage | null, el: HTMLElement | null) {
  if (!s || !el || !s.hovered) return;
  // Above the part's highest corner on screen, so the label never covers what it names.
  const box = s.hovered.box;
  let minX = Infinity, maxX = -Infinity, top = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    TAG_POINT.set(x, y, z).project(s.camera);
    minX = Math.min(minX, TAG_POINT.x); maxX = Math.max(maxX, TAG_POINT.x); top = Math.max(top, TAG_POINT.y);
  }
  const { clientWidth: w, clientHeight: h } = s.renderer.domElement;
  const half = el.offsetWidth / 2;
  const x = Math.min(Math.max(((minX + maxX) / 2 * 0.5 + 0.5) * w, half + 8), w - half - 8);
  const y = Math.max((-top * 0.5 + 0.5) * h, el.offsetHeight + 14);
  el.style.transform = `translate(${Math.round(x - half)}px, ${Math.round(y - el.offsetHeight - 12)}px)`;
}

function light(s: Stage, span: number) {
  const distance = span * 3;
  // High on the hero camera's left, 45 degrees off the board's mirror angle. Shadows fall to the right, where you can see them,
  // and the highlight stays off the mask, which would otherwise wash out to grey.
  s.key.position.set(span * 1.8, distance, -span * 0.2);
  s.key.target.position.set(0, 0, 0);
  s.key.angle = Math.atan((span * 1.7) / distance);
  s.key.shadow.camera.near = span * 0.6;
  s.key.shadow.camera.far = span * 8;
  s.key.shadow.camera.updateProjectionMatrix();
  // A low fill from the camera's side, so the fronts of the parts don't go black.
  s.fill.position.set(-span * 1.4, span * 0.8, -span * 1.6);
  s.floor.scale.setScalar(span * 5);
  s.grid.scale.setScalar(span * 3);
}

function fadeGrid(s: Stage, goal: number) {
  const share = s.gridShare;
  share.goal = goal;
  cancelAnimationFrame(share.frame);
  const uniforms = (s.grid.material as THREE.ShaderMaterial).uniforms;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = () => {
    share.now = reduced ? goal : share.now + (goal - share.now) * 0.22;
    if (Math.abs(goal - share.now) < 0.01) share.now = goal;
    uniforms.opacity!.value = share.now * GRID_OPACITY;
    s.grid.visible = share.now > 0;
    s.draw();
    if (share.now !== goal) share.frame = requestAnimationFrame(step);
  };
  step();
}

function bakeContacts(s: Stage, object: THREE.Object3D) {
  const size = s.box.getSize(new THREE.Vector3());
  const margin = Math.max(size.x, size.z) * 0.22;
  const hide: THREE.Object3D[] = [s.floor, s.grid, s.marker];
  const wasVisible = hide.map(o => o.visible);
  for (const o of hide) o.visible = false;

  // On the floor: where the whole object meets the bench.
  const ground = new ContactShadow(512, 0.72, -2);
  s.contacts.push(ground);
  const rect = { minX: s.box.min.x - margin, maxX: s.box.max.x + margin, minZ: s.box.min.z - margin, maxZ: s.box.max.z + margin };
  ground.bake(s.renderer, s.scene, rect, 0.001, Math.max(size.y * 0.5, 12), Math.max(size.x, size.z) * 0.012);
  ground.mesh.scale.set(rect.maxX - rect.minX, rect.maxZ - rect.minZ, 1);
  ground.mesh.position.set((rect.minX + rect.maxX) / 2, 0.01, (rect.minZ + rect.maxZ) / 2);
  s.scene.add(ground.mesh);

  // On the board: where each part sits on the mask. This does the job of ambient occlusion for one small render.
  let board: THREE.Object3D | null = null;
  object.traverse(o => { if (!board && rawName(o) === 'Box0') board = o; });
  if (board) {
    const boardNode = board as THREE.Object3D;
    const box = new THREE.Box3().setFromObject(boardNode);
    const covers: THREE.Object3D[] = [boardNode];
    object.traverse(o => { if (rawName(o).startsWith('enclosure-')) covers.push(o); });
    const seen = covers.map(o => o.visible);
    for (const c of covers) c.visible = false;
    const contact = new ContactShadow(1024, 0.8, -0.5);
    s.contacts.push(contact);
    const boardRect = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
    contact.bake(s.renderer, s.scene, boardRect, box.max.y, 9, 0.9);
    covers.forEach((c, i) => { c.visible = seen[i]!; });
    // A child of the board, so it rises with the board in the exploded view.
    boardNode.add(contact.mesh);
    const center = boardNode.worldToLocal(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.03, (box.min.z + box.max.z) / 2));
    contact.mesh.position.copy(center);
    contact.mesh.scale.set(box.max.x - box.min.x, box.max.z - box.min.z, 1);
    s.boardContact = contact;
  }
  hide.forEach((o, i) => { o.visible = wasVisible[i]!; });
}

function stackBox(s: Stage, exploded: boolean): THREE.Box3 {
  if (!exploded || !s.lifts.size) return s.box;
  const box = s.box.clone();
  const height = s.box.max.y - s.box.min.y;
  // At rest, each lifted node's box is where it would be with no lift. Add the lift still to come.
  for (const [node] of s.lifts) {
    const share = liftShare(rawName(node));
    const local = new THREE.Box3().setFromObject(node);
    box.union(local.translate(new THREE.Vector3(0, (1 - s.liftNow) * height * share, 0)));
  }
  return box;
}

function viewGoal(s: Stage, exploded: boolean, direction: THREE.Vector3) {
  return fitBox(stackBox(s, exploded), direction, s.camera.fov, s.camera.aspect, FILL);
}

function frameView(s: Stage, wide: boolean, direction: THREE.Vector3) {
  const { target, distance } = viewGoal(s, wide, direction);
  s.controls.target.copy(target);
  s.camera.position.copy(target).addScaledVector(direction.clone().normalize(), distance);
  s.controls.update();
}

function applyNodes(s: Stage, hiddenKey: string, lid: LidMode) {
  const names = new Set(hiddenKey ? hiddenKey.split('|') : []);
  const hideParts = names.has(HIDE_PARTS);
  s.root.traverse(o => {
    const name = rawName(o);
    if (!name) return;
    if (partOfNode(name, o.userData)) { o.visible = !hideParts && !names.has(name); return; }
    if (o.name) o.visible = !names.has(name);
    if (name === 'enclosure-lid') {
      o.visible = !names.has(name) && lid !== 'hidden';
      o.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.transparent = lid === 'ghost';
        material.opacity = lid === 'ghost' ? 0.26 : 1;
        material.depthWrite = lid !== 'ghost';
        material.needsUpdate = true;
        mesh.castShadow = lid !== 'ghost';
      });
    }
  });
}

function setLift(s: Stage, explode: Explode, instant: boolean) {
  if (!s.lifts.size) {
    s.root.traverse(o => { const name = rawName(o); if (name && liftShare(name) > 0) s.lifts.set(o, o.position.y); });
  }
  s.liftGoal = explode === 'exploded' && s.lifts.size ? 1 : 0;
  const height = s.box.max.y - s.box.min.y;
  const apply = () => {
    for (const [node, y] of s.lifts) node.position.y = y + s.liftNow * height * liftShare(rawName(node));
    // The parts have left the board, so nothing is left to shade it.
    if (s.boardContact) { s.boardContact.mesh.material.opacity = 0.8 * (1 - s.liftNow); s.boardContact.mesh.visible = s.liftNow < 0.98; }
    s.renderer.shadowMap.needsUpdate = true;
  };
  const settle = () => { s.root.updateWorldMatrix(true, true); for (const part of s.parts) measurePart(part); };
  cancelAnimationFrame(s.animation);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (instant || reduced) {
    s.liftNow = s.liftGoal;
    apply();
    settle();
    if (!instant) { frameView(s, explode === 'exploded', HERO); s.moved = false; }
    s.draw();
    return;
  }
  const from = s.liftNow;
  const started = performance.now();
  const goal = viewGoal(s, explode === 'exploded', HERO);
  const startTarget = s.controls.target.clone();
  const startOffset = s.camera.position.clone().sub(startTarget);
  const startDistance = startOffset.length();
  const hero = HERO.clone();
  const offset = new THREE.Vector3();
  s.moved = false;
  const run = (now: number) => {
    const t = Math.min(1, (now - started) / 620);
    const eased = 1 - (1 - t) ** 3;
    s.liftNow = from + (s.liftGoal - from) * eased;
    apply();
    s.controls.target.lerpVectors(startTarget, goal.target, eased);
    // A view change comes back to the hero angle along with the framing.
    offset.copy(startOffset).normalize().lerp(hero, eased).normalize();
    s.camera.position.copy(s.controls.target).addScaledVector(offset, startDistance + (goal.distance - startDistance) * eased);
    s.controls.update();
    s.draw();
    if (t < 1) s.animation = requestAnimationFrame(run);
    else settle();
  };
  s.animation = requestAnimationFrame(run);
}

function setMarker(s: Stage, position: readonly [number, number, number] | null) {
  s.marker.visible = Boolean(position);
  if (!position) return;
  // enclosure.json uses board-frame X, Y and Z up. The assembly is Y up with X mirrored: (-x, z, y).
  const object = s.root.children[0];
  const offset = object ? object.position : new THREE.Vector3();
  s.marker.position.set(-position[0] + offset.x, position[2] + offset.y, position[1] + offset.z);
}

