# Three.js product previews

Research and implementation: 2026-10-24.

The frontend uses plain Three.js r186. `ProductScene` loads a supplied GLB with
`GLTFLoader`; without a GLB it constructs the timer, synth, or lamp from rounded
solids and material regions. Those reconstructions are visual concepts, not CAD
artifacts or verified dimensions. The source GLB node transforms are preserved;
parent groups normalize its placement and scale for display only.

Published skills read and applied:

- [CloudAI-X threejs-fundamentals](https://github.com/CloudAI-X/threejs-skills/blob/main/skills/threejs-fundamentals/SKILL.md): renderer setup, capped pixel ratio, camera bounds, responsive rendering and GPU cleanup.
- [CloudAI-X threejs-loaders](https://github.com/CloudAI-X/threejs-skills/blob/main/skills/threejs-loaders/SKILL.md): GLTFLoader, generated RoomEnvironment lighting, model bounds and disposal.

The user's [img2threejs reference](https://github.com/img2threejs/img2threejs)
describes a staged image-to-procedural-code reconstruction workflow. Its README
was inspected. The applicable principles here are component decomposition,
identity-defining geometry (dials, seams, screws, display, keys, stem, shade), and
separate material regions. Moki does not run its full forge/review pipeline or
claim a completed image-to-3D conversion. No upstream script was executed.

Interaction and lifecycle:

- Workspace scenes support orbit, wheel zoom, external zoom/reset controls, and
  focused-canvas arrow keys, +/- zoom, R/0 reset.
- Gallery cards keep their photos and dynamically import the viewer only on
  visible hover or keyboard focus. Leaving the card unmounts its renderer.
- The photo remains available if WebGL or model loading fails.
- ResizeObserver fits the scene; offscreen and hidden-tab rendering is skipped.
- Unmount aborts loader requests, removes observers/listeners, and disposes
  controls, textures, materials, geometries, environment, shadows and renderer.
- Reduced-motion preferences disable gallery autorotation and pointer tilt.

Verification: `npx tsc -p tsconfig.web.json --noEmit` passed. The main agent owns
the live browser inspection and end-to-end integration checks.
