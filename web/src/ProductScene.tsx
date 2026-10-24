import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createProductConcept, type ProductConcept } from "./product-models";
import "./product-scene.css";

export type ProductSceneProps = {
  concept?: ProductConcept;
  modelUrl?: string;
  zoom?: number;
  resetKey?: number;
  interactive?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
};

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => { texture.dispose(); const image = texture.source.data; if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close(); });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export default function ProductScene({ concept = "timer", modelUrl, zoom = 1, resetKey = 0, interactive = true, onReady, onError }: ProductSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const currentZoom = useRef(zoom);
  currentZoom.current = zoom;
  const api = useRef<{ reset: () => void; zoom: (value: number) => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    const releases: Array<() => void> = [];
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      api.current = null;
      for (const release of releases.reverse()) {
        try { release(); } catch { /* Continue releasing the remaining WebGL resources. */ }
      }
    };
    setStatus("loading"); setError("");
    const fail = (message: string) => {
      if (disposed) return;
      setStatus("error"); setError(message);
      try { callbacks.current.onError?.(message); } catch { /* Keep preview failures scoped. */ }
    };
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" }); }
    catch { fail("The 3D preview needs WebGL. You can still view the concept image."); return; }

    releases.push(() => {
      renderer.setAnimationLoop(null);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    });
    try {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, interactive ? 1.75 : 1.25));
      renderer.setClearColor("#f8f7f3");
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      element.appendChild(renderer.domElement);
      renderer.domElement.setAttribute("aria-label", modelUrl ? "Interactive 3D model" : `Three-dimensional ${concept} concept`);
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.tabIndex = interactive ? 0 : -1;

      const scene = new THREE.Scene();
      releases.push(() => disposeObject(scene));
      const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
      camera.zoom = THREE.MathUtils.clamp(currentZoom.current, 0.5, 2.5);
      const controls = new OrbitControls(camera, renderer.domElement);
      releases.push(() => controls.dispose());
      controls.enabled = interactive;
      controls.enableDamping = true;
      controls.dampingFactor = 0.09;
      controls.enablePan = false;
      controls.minPolarAngle = 0.18;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.autoRotate = !interactive && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      controls.autoRotateSpeed = 1.2;
      controls.zoomSpeed = 0.7;
      if (interactive) controls.listenToKeyEvents(renderer.domElement);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      let environment: THREE.WebGLRenderTarget;
      try { environment = pmrem.fromScene(room, 0.04); }
      finally { room.dispose(); pmrem.dispose(); }
      releases.push(() => environment.dispose());
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.6;
      scene.add(new THREE.HemisphereLight("#fffdf2", "#b5ad9a", 2));
      const key = new THREE.DirectionalLight("#fff9e9", 4.0);
      key.position.set(-3, 7, 5); key.castShadow = true;
      releases.push(() => key.shadow.dispose());
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 20 });
      key.shadow.normalBias = 0.035; key.shadow.bias = -0.0001; key.shadow.radius = 4;
      scene.add(key);
      const fill = new THREE.DirectionalLight("#e8efff", 1.0); fill.position.set(4, 3, -3); scene.add(fill);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.12 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.012; floor.receiveShadow = true; scene.add(floor);
      const modelRoot = new THREE.Group(); scene.add(modelRoot);
      let modelSize = new THREE.Vector3(3, 2, 2);
      let visible = true;
      let shouldDraw = true;
      const render = () => { if (!disposed && visible && !document.hidden) renderer.render(scene, camera); };
      const fit = () => {
        const vertical = modelSize.y + modelSize.z * 0.45;
        const horizontal = modelSize.x + modelSize.z * 0.4;
        const distance = Math.max(vertical / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), horizontal / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)) * 1.28;
        const target = new THREE.Vector3(0, modelSize.y * 0.47, 0);
        controls.target.copy(target);
        camera.position.copy(target).add(new THREE.Vector3(0.8, 0.52, 1).normalize().multiplyScalar(distance));
        controls.minDistance = distance * 0.4; controls.maxDistance = distance * 2.5;
        controls.update(); controls.saveState(); shouldDraw = true; render();
      };
      const resize = () => {
        const width = element.clientWidth, height = element.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height; camera.updateProjectionMatrix(); fit();
      };
      const resizeObserver = new ResizeObserver(() => {
        try { resize(); }
        catch { fail("The 3D preview could not be rendered. You can still view the concept image."); renderer.setAnimationLoop(null); }
      });
      releases.push(() => resizeObserver.disconnect());
      resizeObserver.observe(element);
      const visibilityObserver = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); shouldDraw = true; });
      releases.push(() => visibilityObserver.disconnect());
      visibilityObserver.observe(element);
      controls.addEventListener("change", () => { shouldDraw = true; });
      const onVisibility = () => { shouldDraw = true; };
      document.addEventListener("visibilitychange", onVisibility);
      releases.push(() => document.removeEventListener("visibilitychange", onVisibility));
      const onContextLost = (event: Event) => { event.preventDefault(); fail("The 3D preview was interrupted. Reload the page to try again."); };
      renderer.domElement.addEventListener("webglcontextlost", onContextLost);
      releases.push(() => renderer.domElement.removeEventListener("webglcontextlost", onContextLost));
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "0" || event.key.toLowerCase() === "r") { controls.reset(); event.preventDefault(); }
        if (event.key === "+" || event.key === "=") { camera.zoom = Math.min(2.5, camera.zoom * 1.12); camera.updateProjectionMatrix(); shouldDraw = true; event.preventDefault(); }
        if (event.key === "-") { camera.zoom = Math.max(0.5, camera.zoom / 1.12); camera.updateProjectionMatrix(); shouldDraw = true; event.preventDefault(); }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          const offset = camera.position.clone().sub(controls.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          if (event.key === "ArrowLeft") spherical.theta -= 0.12;
          if (event.key === "ArrowRight") spherical.theta += 0.12;
          if (event.key === "ArrowUp") spherical.phi -= 0.1;
          if (event.key === "ArrowDown") spherical.phi += 0.1;
          spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
          controls.update(); shouldDraw = true; event.preventDefault();
        }
      };
      renderer.domElement.addEventListener("keydown", onKeyDown);
      releases.push(() => renderer.domElement.removeEventListener("keydown", onKeyDown));
      api.current = { reset: () => { camera.zoom = 1; camera.updateProjectionMatrix(); fit(); }, zoom: (value) => { camera.zoom = THREE.MathUtils.clamp(value, 0.5, 2.5); camera.updateProjectionMatrix(); shouldDraw = true; } };
      renderer.setAnimationLoop(() => {
        if (!visible || document.hidden) return;
        try {
          const changed = controls.update();
          if (changed || shouldDraw) { render(); shouldDraw = false; }
        } catch {
          fail("The 3D preview could not be rendered. You can still view the concept image.");
          renderer.setAnimationLoop(null);
        }
      });
      const loadController = new AbortController();
      releases.push(() => loadController.abort());
      const populate = async () => {
        try {
          let model: THREE.Object3D;
          if (modelUrl) {
            // FileLoader coalesces requests globally by URL. Aborting one StrictMode
            // mount can therefore abort the next mount's request. Own the main fetch
            // instead, so each scene has an independent cancellation signal.
            const response = await fetch(modelUrl, { signal: loadController.signal });
            if (!response.ok) throw new Error("Model request failed");
            const data = await response.arrayBuffer();
            if (disposed) return;
            const resourcePath = new URL(".", new URL(modelUrl, window.location.href)).href;
            model = (await new GLTFLoader().parseAsync(data, resourcePath)).scene;
          } else {
            model = createProductConcept(concept);
          }
          if (disposed) { disposeObject(model); return; }
          const box = new THREE.Box3().setFromObject(model);
          if (box.isEmpty()) { disposeObject(model); throw new Error("empty model"); }
          const size = box.getSize(new THREE.Vector3());
          const longest = Math.max(size.x, size.y, size.z);
          if (!Number.isFinite(longest) || longest <= 0) { disposeObject(model); throw new Error("invalid model bounds"); }
          const scale = 3.2 / longest;
          // Normalize in parents, keeping imported GLB node transforms untouched.
          const normalized = new THREE.Group(); normalized.scale.setScalar(scale); normalized.add(model);
          const holder = new THREE.Group(); holder.add(normalized);
          const scaledBox = new THREE.Box3().setFromObject(normalized);
          const center = scaledBox.getCenter(new THREE.Vector3());
          holder.position.set(-center.x, -scaledBox.min.y, -center.z);
          model.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
          modelRoot.add(holder);
          modelSize = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
          resize(); render(); setStatus("ready"); callbacks.current.onReady?.();
        } catch { fail(modelUrl ? "This 3D file could not be loaded. The original file is still available in Files." : "The 3D concept could not be displayed."); }
      };
      void populate();
      return cleanup;
    } catch {
      fail("The 3D preview could not be initialized. You can still view the concept image.");
      cleanup();
      return;
    }
  }, [concept, modelUrl, interactive]);

  useEffect(() => { api.current?.zoom(zoom); }, [zoom]);
  useEffect(() => { api.current?.reset(); }, [resetKey]);

  return <div className={`product-scene ${interactive ? "is-interactive" : "is-preview"}`} data-scene-status={status}>
    <div className="product-scene-host" ref={host} />
    {status === "loading" && <div className="product-scene-status" role="status"><span className="scene-loading-dot" />Loading 3D view</div>}
    {status === "error" && <div className="product-scene-status scene-error" role="status">{error}</div>}
    {status === "ready" && interactive && <span className="product-scene-hint">Drag to rotate · Scroll to zoom</span>}
  </div>;
}
