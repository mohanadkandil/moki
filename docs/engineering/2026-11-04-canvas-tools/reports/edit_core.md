# edit_core — completed

Maker edits are implemented and verified. Final `npm test`: **223/223 pass**, including the real five-job edit chain. Targeted edit/API/render/firmware tests: **21/21 pass**. Python mechanical tests: **21/21 pass**. Typecheck passes. Independent review has no remaining source blockers. No web files, production build/process, commits or pushes were changed by edit_core.

## Final integration contract

POST `/api/board/jobs`:

```ts
{
  baseJobId: string;
  design?: CircuitDesign; // cannot coexist with source
  source?: string;
  edits?: {
    placements?: Array<{refdes: string; x: number; y: number; rotation: number}>;
    board?: {widthMm: number; heightMm: number; cornerRadiusMm: number};
    usbEdge?: 'left' | 'right' | 'top' | 'bottom';
  };
}
```

- Positions are **`pcb_component.center`**, absolute board-centred mm, +X right/+Y up. Rotation is **absolute degrees counter-clockwise**, normalized into [0,360). It is not a delta or a footprint origin. BZ1's centre `(25,-16.5)` differs from origin `(25,-10)`; a 90° edit at the same centre gives origin `(18.5,-16.5)`.
- **`{baseJobId, edits}` alone works**, recovering the saved design and its firmware semantics. Source-only bases recover their source and keep firmware honestly skipped. `{baseJobId}` alone reruns the existing canonical layout. Canvas UI reruns should use this route; a design-only submission creates a fresh layout.
- Invalid requests return **HTTP 400 `{error: '<plain message>'}` before queue admission**, with no child job directory. Unknown keys, malformed/nonfinite values, unknown/duplicate parts and invalid final layouts fail closed. A source change must first be built before applying layout edits to its geometry.
- POST success remains `{jobId}`. Job JSON echoes **`input.baseJobId`, normalized `input.edits`, `input.layoutSha256`**, with top-level **`editSummary: string[]`**. Existing `drc`, `stages` and `enclosure.json.validation.failures` shapes are unchanged.
- With `{design, baseJobId}`, matching refdes/module pairs retain base poses; new/replaced parts use their fresh-layout positions. They may need accompanying placement edits or resizing. There is no automatic new-part packing. agent_core's reported `BZ1 overlaps SW1` rejection follows this policy.

Herdr was unavailable (`HERDR_ENV` unset). This shared report and conversation carried the contract and verified IDs; no Herdr message was claimed sent.

## Validation and rendering

Structural base validation is separate from final physical policy. A trusted overlapping/out-of-board base can be repaired by the Fixer; the resulting layout receives full validation. Regression cases cover overlap repair and enlarging an undersized board. An unchanged invalid result still fails.

Supported bases are centred, flat, two-layer catalog carriers with four circular 3.2 mm mounting holes. Catalog identity, complete pad count/coordinates, circular drill/outer diameters and through-hole layers must match; unsupported groups, custom outlines and altered pad geometry are rejected. Controller orientation must be cardinal so its selected USB edge can be inferred.

Bounds follow the actual rectangular/rounded outline. Dimensions are **20–300 mm**, radius **0–half the smaller dimension**. Mechanical envelopes include module bodies, sockets, blocks and pad bounds, with **0.2 mm module clearance** and **0.5 mm mounting-hole clearance**. Leaded parts use their body at the pad centroid. Only the modeled USB connector may overhang its locked edge. Resize/edge changes snap the controller and relocate corner holes while preserving peripherals; explicit controller placements must satisfy the lock themselves.

`eda/apply-layout.ts` converts component centres to canonical footprint origins, installs tscircuit **`manualEdits.pcb_placements`**, clears conflicting X/Y props and sets absolute `pcbRotation`. The pinned native placement schema has no rotation field: `manual-edits.json` carries a Moki rotation extension for provenance, while the component prop performs the rotation. **Owner TSX stays unchanged.** Sibling labels follow their parts, including existing native manual-placement selectors. Final rendered CJ is reconstructed and compared with the complete canonical board/part/hole layout before output.

Edited routes use the pinned standard local solver with a **0.25 mm planning margin and the original 0.2 mm fabrication DRC**. This avoids a measured 0.195 mm via/trace gap on the first attempted edit. The native preset resolver drops custom callbacks, so the edited path omits that preset and implements the complete start/on/stop contract. `manual-edits.json.routing` records solver, margins and actual invocation count; the renderer rejects silent callback loss. The solver uses `cacheProvider: null`, matching the native worker's memory default.

EDA cache identity includes source, the full canonical layout and tool/source hashes. Manual-edit artifacts are restored too. The mechanical handoff uses new CJ and regenerated metadata, so case apertures, dimensions, corner profile and USB wall follow edits. Radius-zero case corners now preserve the declared 0.3 mm fit offset. Render/CAD workers retain a bounded **240 s** limit; explicit shorter test limits still work. Shared-host saturation caused earlier unchanged-baseline timeouts, recorded in retained test attempts.

Firmware cache identity includes actual generated source/configuration, generator files, host/compiler identity, effective PlatformIO installation paths and resolved package manifests. Only successful exit-zero compilation is reused. Pin/behavior/compiler-install changes miss; failed compiles never cache; bypass works. Layout-only reuse reports verified compilation reuse and makes no physical-flash claim.

## Verified dev jobs and visual evidence

Available through **127.0.0.1:5173**:

| Job | ID |
| --- | --- |
| Before | `800e9456-853d-413c-a396-ac1cef9dd6e9` |
| U2 moved 4 mm right | `dd00c65f-ab6f-40d4-8345-723ea806c07e` |

These completed service jobs were copied unchanged from the isolated acceptance queue into the dev job folder. GET requests verified their status and enclosure artifacts. Source snapshots for this pair are retained separately under `evidence/edit_core/dev-before/` and `dev-moved/`.

U2 centre moves **(15.85,27.9) → (19.85,27.9)**; the display window X moves **15.85 → 19.85 mm**, its Y stays 16.9 mm, and the regenerated lid hash changes. Native DRC errors and case-fit failures are empty; physical copper connectivity/clearance passes. Source TSX is identical and firmware verification is reused.

**All four PNGs were inspected:** [PCB before](../evidence/edit_core/before-pcb.png), [PCB after](../evidence/edit_core/moved-pcb.png), [case before](../evidence/edit_core/before-case.png), [case after](../evidence/edit_core/moved-case.png). [Paired comparison](../evidence/edit_core/comparison.html). The evidence view makes the lid opaque to expose the window shift; it changes no product/job material. UI tool-state screenshots remain canvas_ui's section.

## Final measured acceptance

The final full-suite native chain passed in **96.3 s**: baseline, U2 move, identical edit, BZ1 90° rotation, then **120 × 120 mm / radius 7 mm / USB left**. All five had zero native DRC errors, exact physical copper connectivity, passing copper clearance and no calculated case-fit failures. Repeat EDA/GLB reuse and layout-only verified firmware reuse pass. The resized case reports board radius 7 mm and USB face `x_neg`. Parent jobs/source remain unchanged.

Final chain IDs and isolated root: [integration-jobs.json](../evidence/edit_core/integration-jobs.json). Output folders `before/`, `moved/`, `repeated/`, `rotated/`, `resized-left/` include actual circuit, manual edits, firmware report, enclosure report and **copper.log**. The smallest listed routed/pour gaps are 0.242 mm for moved/rotated outputs and 0.244 mm after resizing; the fixed TO-92 pad-to-pad gap is 0.220 mm. Source-only recovery and invalid/no-admission cases are separately API-tested.

| Check | Result / evidence |
| --- | --- |
| Final full `npm test` | **223/223**, 215.8 s; [log](../evidence/edit_core/full-test-final.log) |
| Targeted edit/API/render/firmware | **21/21**; [log](../evidence/edit_core/targeted.log) |
| Python build123d geometry | **21/21**; [log](../evidence/edit_core/mechanical-tests.log) |
| `npm run typecheck` | Pass; [log](../evidence/edit_core/typecheck.log) |
| Independent review | [edit_core-review.md](edit_core-review.md): all findings addressed |
| Editable pipeline diagram | [source](../diagrams/edit-pipeline.mmd), [inspected PNG](../diagrams/edit-pipeline.png) |

An earlier broad run was 213/214; its sole new integration failure exposed the overly strict planning-margin-as-DRC setting. The corrected final broad run passes. Reviewer findings on firmware installation identity, complete final geometry validation, manual-label anchors and router protocol were fixed and checked. Geometry worker and reviewer completed their assigned work; no persistent background execution is implied.

Module dimensions and fit remain catalog estimates. No physical print, test fit, fabrication or hardware flash is claimed. Coordinator retains ownership of PROJECT.md/.sogo/project.json and production deployment. E7 P2-1/P2-2 completion remains appended to the realism real_models report.
