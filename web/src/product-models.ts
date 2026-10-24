import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type ProductConcept = "timer" | "synth" | "lamp";

const plastic = (color: THREE.ColorRepresentation) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.43, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5,
});

function part(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function rounded(group: THREE.Group, size: [number, number, number], radius: number, material: THREE.Material, position: [number, number, number]) {
  return part(group, new RoundedBoxGeometry(...size, 4, radius), material, position);
}

function dial(group: THREE.Group, radius: number, depth: number, position: [number, number, number], front = false) {
  const orange = plastic("#ee762e");
  const root = new THREE.Group();
  root.position.set(...position);
  if (front) root.rotation.x = Math.PI / 2;
  group.add(root);
  part(root, new THREE.CylinderGeometry(radius, radius, depth, 64), orange, [0, 0, 0]);
  // Fine physical ribs give the dial its silhouette, rather than a printed texture.
  const ribs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, depth * 0.84, 4), orange, 56);
  const ribTransform = new THREE.Matrix4();
  for (let i = 0; i < 56; i++) {
    const angle = i / 56 * Math.PI * 2;
    ribTransform.makeTranslation(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    ribs.setMatrixAt(i, ribTransform);
  }
  root.add(ribs);
  part(root, new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.018, 64), plastic("#f38842"), [0, depth / 2 + 0.002, 0]);
}

function screw(group: THREE.Group, position: [number, number, number], top = false) {
  const metal = new THREE.MeshStandardMaterial({ color: "#a8a69b", metalness: 0.8, roughness: 0.26 });
  const head = part(group, new THREE.CylinderGeometry(0.046, 0.046, 0.014, 20), metal, position);
  if (!top) head.rotation.x = Math.PI / 2;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.009, 0.005), new THREE.MeshStandardMaterial({ color: "#393a36", roughness: 0.9 }));
  if (top) { slot.rotation.x = -Math.PI / 2; slot.position.set(position[0], position[1] + 0.009, position[2]); }
  else slot.position.set(position[0], position[1], position[2] + 0.009);
  group.add(slot);
}

function displayTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 420;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#b8b7a5"; ctx.fillRect(0, 0, 1024, 420);
  const digits: Record<string, number[]> = { "0": [0, 1, 2, 3, 4, 5], "2": [0, 1, 6, 4, 3], "5": [0, 5, 6, 2, 3] };
  const segments = [[22, 0, 96, 12], [120, 18, 12, 116], [120, 151, 12, 116], [22, 274, 96, 12], [7, 151, 12, 116], [7, 18, 12, 116], [22, 137, 96, 12]];
  let x = 90;
  for (const char of "25:00") {
    if (char === ":") { ctx.fillStyle = "#30342c"; ctx.fillRect(x + 6, 155, 16, 16); ctx.fillRect(x + 6, 244, 16, 16); x += 50; continue; }
    for (let i = 0; i < segments.length; i++) {
      const [sx, sy, w, h] = segments[i]!;
      ctx.fillStyle = digits[char]!.includes(i) ? "#30342c" : "#afb09d";
      ctx.beginPath(); ctx.roundRect(x + sx!, 65 + sy!, w!, h!, 4); ctx.fill();
    }
    x += 190;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function timer() {
  const group = new THREE.Group();
  const yellow = plastic("#efd277");
  rounded(group, [3.35, 1.86, 1.18], 0.22, yellow, [0, 0.97, 0]);
  rounded(group, [3.31, 1.82, 0.035], 0.2, plastic("#c4a959"), [0, 0.97, 0.39]);
  rounded(group, [3.35, 1.86, 0.3], 0.18, yellow, [0, 0.97, 0.49]);
  rounded(group, [1.88, 1.08, 0.035], 0.12, plastic("#8d824e"), [-0.52, 0.99, 0.65]);
  rounded(group, [1.79, 0.98, 0.025], 0.08, plastic("#b8b7a5"), [-0.52, 0.99, 0.674]);
  part(group, new THREE.PlaneGeometry(1.69, 0.88), new THREE.MeshBasicMaterial({ map: displayTexture() }), [-0.52, 0.99, 0.691]);
  // A +Z dial has its top facing the viewer (negative rotation about X).
  const knob = new THREE.Group(); group.add(knob);
  dial(knob, 0.46, 0.22, [1.01, 0.99, 0.77], true);
  knob.children[0]!.rotation.x = -Math.PI / 2;
  for (const x of [-1.46, 1.46]) for (const y of [0.24, 1.69]) screw(group, [x, y, 0.652]);
  rounded(group, [0.32, 0.13, 0.025], 0.045, plastic("#49483e"), [0.8, 0.45, -0.602]);
  rounded(group, [0.23, 0.055, 0.035], 0.02, plastic("#8c8a7d"), [0.8, 0.45, -0.616]);
  const rubber = plastic("#59584b");
  for (const x of [-1.15, 1.15]) for (const z of [-0.3, 0.3]) part(group, new THREE.SphereGeometry(0.12, 16, 12), rubber, [x, 0.07, z]).scale.y = 0.45;
  return group;
}

function synth() {
  const group = new THREE.Group();
  rounded(group, [3.1, 0.72, 2.42], 0.23, plastic("#2251ad"), [0, 0.43, 0]);
  rounded(group, [3.06, 0.035, 2.38], 0.2, plastic("#183c87"), [0, 0.35, 0]);
  rounded(group, [2.74, 0.04, 2.13], 0.18, plastic("#f4e9d0"), [0, 0.802, 0]);
  dial(group, 0.28, 0.27, [-0.65, 0.96, -0.54]);
  dial(group, 0.28, 0.27, [0.43, 0.96, -0.54]);
  const key = plastic("#fcf1d9");
  const keyWell = plastic("#a49371");
  for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
    const x = (column - 1) * 0.81, z = row * 0.6 + 0.11;
    rounded(group, [0.74, 0.025, 0.52], 0.14, keyWell, [x, 0.831, z]);
    rounded(group, [0.71, 0.17, 0.49], 0.13, key, [x, 0.89, z]);
  }
  for (const x of [-1.2, 1.2]) for (const z of [-0.87, 0.87]) screw(group, [x, 0.831, z], true);
  const speaker = part(group, new THREE.CylinderGeometry(0.36, 0.36, 0.035, 48), plastic("#e97839"), [1.557, 0.46, 0.0]);
  speaker.rotation.z = Math.PI / 2;
  const holeMaterial = plastic("#69391e");
  for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) if (y * y + z * z < 11) {
    const hole = part(group, new THREE.CircleGeometry(0.024, 10), holeMaterial, [1.579, 0.46 + y * 0.085, z * 0.085]);
    hole.rotation.y = Math.PI / 2; hole.castShadow = false;
  }
  return group;
}

function lamp() {
  const group = new THREE.Group();
  const coral = plastic("#df6650");
  part(group, new THREE.CylinderGeometry(0.64, 0.65, 0.33, 64), coral, [-0.35, 0.2, 0]);
  part(group, new THREE.CylinderGeometry(0.61, 0.61, 0.035, 64), plastic("#a54637"), [-0.35, 0.035, 0]);
  const button = part(group, new THREE.CylinderGeometry(0.085, 0.085, 0.018, 32), plastic("#303432"), [-0.09, 0.2, 0.603]);
  button.rotation.x = Math.PI / 2;
  const stem = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.35, 0.36, 0), new THREE.Vector3(-0.38, 1.02, -0.1),
    new THREE.Vector3(-0.63, 1.85, -0.1), new THREE.Vector3(-0.28, 2.43, -0.08),
    new THREE.Vector3(0.35, 2.6, 0),
  ]);
  part(group, new THREE.TubeGeometry(stem, 64, 0.055, 12, false), new THREE.MeshStandardMaterial({ color: "#aeaea5", metalness: 0.94, roughness: 0.27 }), [0, 0, 0]);
  const profile = [[1.04, 0], [1.04, 0.06], [1.0, 0.15], [0.89, 0.28], [0.68, 0.4], [0.42, 0.46], [0.3, 0.47]].map(([x, y]) => new THREE.Vector2(x, y));
  part(group, new THREE.LatheGeometry(profile, 64), coral, [0.42, 2.11, 0]);
  part(group, new THREE.CylinderGeometry(0.3, 0.3, 0.16, 48), coral, [0.42, 2.65, 0]);
  const diffuser = new THREE.MeshStandardMaterial({ color: "#fff0c8", emissive: "#ffda88", emissiveIntensity: 0.25, roughness: 0.8 });
  part(group, new THREE.CylinderGeometry(0.995, 0.995, 0.025, 64), diffuser, [0.42, 2.117, 0]);
  return group;
}

/** Visual concept reconstructions, not source CAD or validated engineering geometry. */
export function createProductConcept(concept: ProductConcept) {
  return concept === "lamp" ? lamp() : concept === "synth" ? synth() : timer();
}
