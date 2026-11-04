# real_models — implementation and acceptance

4 November 2026. Scope: real catalog parts, textured board, mask variants, ground fill, rounded outline and KiCad export. The production service and its fixed build were not rebuilt or restarted. No commits, pushes, stashes, resets or publication. `PROJECT.md` and `.sogo/project.json` remain coordinator-owned. real_stage owns the UI in parallel.

## Implemented

Every catalog part now has material-bearing JSCAD detail. The ESP32 has a black board, WROOM shield and antenna meander, USB shell/tongue/contacts, buttons, regulator and bridge/support circuitry. OLED has blue PCB, mounting holes/rings, dark glass and active region, and folded ribbon. Encoder has EC11 case, D-flat/knurled shaft and suggested bushing threads. Piezo has an actual recessed sound port. TO-92 has a flat face and leads; BME280 has a metal sensor lid and vent; LED has translucent amber lens and internal electrodes; LDR has a serpentine face; resistors use value-derived 4-band colours. Female sockets are hollow, with contacts, and male header pins are gold.

The catalog/mechanical dimensions, USB/display/shaft locations and enclosure interaction points remain unchanged. Detail is fitted inside the existing mechanical envelopes, with leaded geometry allowed within its existing body/lead envelope. These are recognition models, not measured manufacturer CAD. Internal circuitry positions and package heights remain estimates. Model tests cover all nine modules and the LED's asymmetric pad endpoints; existing enclosure aperture tests remain authoritative for fit.

The glTF stage evaluates independently authored shapes to preserve PBR materials. Boolean-union output previously erased appearance metadata. Static vertex sharing then removes duplicate complete position/normal/UV tuples without smoothing CAD edges, changing materials or quantizing dimensions. GLB names are `<ref>:<moduleId>` and `<ref>:socket`; node extras provide refdes/module identity. Assembly retains the same detailed meshes and all mask metadata; raised LED/LDR modules retain the existing lift-to-lid behavior. Legacy board inputs still receive fallback block models.

Board textures use the existing circuit-json-to-gltf renderer: mask, routed copper beneath it, pale silkscreen, gold pads/plated rings, and FR4-coloured edges. Four embedded mask variants are available as a **client-side material swap**, not a job-input field. Contract: [MASK-CONTRACT.md](../evidence/real_models/MASK-CONTRACT.md). White mask uses dark silk. This swaps full textures rather than tinting silk and pads.

GND pours are generated on both layers with 0.25 mm clearances, 0.35 mm board-edge inset, thermal reliefs and solder-mask coverage. The independent copper oracle now audits every filled BREP polygon and inner void physically, without trusting its declared net. It still requires exact designed endpoint sets, no shorts/opens or floating copper, and >=0.2 mm copper clearance. It now measures the sampled rounded outline and mounting-hole clearances too. Negative regressions cover trace removal, injected wire shorts and an injected pour bridging unrelated pads.

The board outline has a 3 mm radius, sampled at 7.5° (<0.007 mm chord deviation). Pad and mounting-hole coordinates do not move. The mechanical handoff carries the actual outline; build123d recognizes the rounded rectangle and offsets the cavity and shell through the fit and wall thickness. Unknown outline shapes keep the conservative rectangular envelope. Tests check outline preservation, rounded cavity clearance and all existing openings.

`circuit-json-to-kicad@0.0.267` is exactly pinned in the isolated EDA package. The fab stage emits `kicad.zip` with `.kicad_pcb`, `.kicad_sch`, `.kicad_pro` and README. It is allowed, cached, restored and served as a ZIP through the existing API. KiCad includes the routed carrier, pads, outline and GND zones. The detailed recognition meshes remain in GLB. Renderer/model source hashes invalidate old cached renders.

## References and dimensional limits

- [Espressif DevKitC V4 guide](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html): module identity, micro-USB, EN/BOOT, USB bridge and regulator. Outline/pin coordinates remain the existing catalog values; this round does not claim to resolve their existing dimensional uncertainty.
- [Bosch BME280 datasheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf): 2.5 × 2.5 mm metal-lid sensor. Breakout outline remains the catalog's 13 × 11 mm.
- `src/circuit/catalog.ts` and unchanged `eda/enclosure/module-mech.ts`: all remaining outlines, body dimensions, shaft/display/USB interaction points and confidence statements. OLED active area remains 21.744 × 10.864 mm from the previously documented panel data. Hobby-module variants, header orientation and heights require checking against actual purchased parts.
- [tscircuit copperpour documentation](https://docs.tscircuit.com/elements/copperpour): thermal relief and mask coverage API, verified against installed core implementation.

## Independent review

[real_models-review.md](real_models-review.md) records the read-only review. Three issues were found and corrected: outline flattened in handoff, mask metadata overwritten by assembly, and LED Y-offset double inversion. Follow-up reviewed vertex compaction and the stronger polygon oracle. Final verification and artifact measurements follow below.

## Verification status

Final standalone build123d geometry suite: **20/20 passed**, 28.39 seconds, including the new rounded cavity profile and existing USB/display/shaft/screw/collision/watertightness checks (`mech-tests.log`).

Final `npm test`: **97/97 passed**, no skips, 128.46 seconds. This includes all-template routing/copper audits, the new <3 MB/seat/model-presence/area assertions, the 16-test catalog mesh suite and the Bun enclosure suite. `npm run typecheck` passed. Logs: `evidence/real_models/npm-test-final.log`, `typecheck.log`, `models-test.log`. The subsequent evidence capture helper uses an explicit browser completion flag; it does not alter production/model generation code.

The all-template copper oracle now also rejects a filled polygon deliberately bridging unrelated pads. All three generated templates report zero DRC errors; the compact temperature alarm is 75 × 75 mm (34.2% less area than the supplied 90 × 95 baseline).

## Added live temp-monitor acceptance

The owner's live screenshot was inspected. Temperature carrier placement is now 75 × 75 mm, compared with 90 × 95 mm (34.2% less area). The display stays above a sensor/pull-up/piezo row; the controller's USB stays at the case edge. Whole-part placements change, while each part's mechanical/pin frame remains intact. Evidence generation explicitly enables the temperature alarm so the target includes all five parts.

Models now include explicit seat-height metadata. Board-level integration checks assert every placed part has its named model and every model/socket mesh minimum is within 0.5 mm of its expected seat. Through-hole parts and sockets seat on the board; socketed modules include pin tips inserted 1.4 mm into the female socket (7.1 mm above the carrier), so their mesh minimum is measured against that insertion seat, with the visible spacer seated at 8.5 mm. This avoids treating inserted header pins as a floating body. The TO-92 leads run to the carrier and its flat-faced body remains at its existing height; the piezo starts directly on the carrier.

The OLED's support row is visible from the owner's requested side. The earlier `focus-timer-first.png` used the opposite camera and hid the single header behind the panel; it is an intermediate diagnostic, not final evidence. The final paired captures use the same owner-facing three-quarter camera for before and after. A mesh occupancy regression now intersects actual triangles beside **every** header opening and requires uninterrupted support from carrier through socket/spacer to the module PCB. This passes for all socketed catalog parts, in addition to minimum-Z checks.

Native KiCad 9 testing exposed a converter defect: version 0.0.267 emitted `(power global)` (newer KiCad syntax) while declaring a KiCad 9 schematic revision. The fab stage now normalizes that standalone grammar line to KiCad 9's equivalent `(power)`, leaving quoted content alone. KiCad 9 successfully plotted the corrected schematic as well as the PCB. The successful `kicad9-final-check.json` receipt supersedes the retained failing diagnostic.

Baseline note: the supplied live 90 × 95 mm screenshot's saved DS18B20 design has four electrical parts; its unsupported-looking cylinder is the old TO-92 placeholder. The requested final alarm configuration includes five parts, with the piezo explicitly enabled. The before render uses the matching 90 × 95 mm DS18B20 baseline, and the supplied owner screenshot is retained as `temp-monitor-owner-before.png`. The after shows the stricter five-part alarm version on the smaller board. No part was removed to obtain the area reduction.


## Final dev artifacts and native KiCad acceptance

| Template | Board | board.glb | assembly.glb | DRC errors | Enclosure fit failures |
| --- | --- | ---: | ---: | ---: | ---: |
| Focus timer | 90 × 100 mm | 1,726,656 B | 2,927,340 B | 0 | 0 |
| Light lamp | 90 × 105 mm | 1,461,988 B | 2,512,496 B | 0 | 0 |
| Temperature alarm (5 parts) | 75 × 75 mm | 1,535,416 B | 2,883,988 B | 0 | 0 |

Final dev jobs (all terminal `done`):
- Focus: `24fd29e6-28d4-4ff7-abc8-bad1abfa2365`
- Light: `9ec90ad8-0f55-459e-b32e-cc4afb2a1893`
- Temperature: `b59461c0-8c5b-4fcc-a34b-a4e0e9c9c4b2`

Final [measurements](../evidence/real_models/measurements.json), per-job receipts, handoffs, enclosure reports and ZIPs are retained under `evidence/real_models/`. The [native KiCad receipt](../evidence/real_models/kicad9-final-check.json) records **exit 0 plus nonempty SVG output for all six reader checks**: PCB and schematic for each template. It validates the exact ZIP files without post-extraction edits. KiCad 9.0.8 was extracted locally with dependencies; the unpacked layout prints a missing global IPC schema warning, but native PCB/schematic readers and plotters succeed. No GUI-open, KiCad ERC/DRC, fabrication or physical-fit approval is claimed.

All four board mask variants survive into assembly metadata. Complete raw node names and `extras.moki` are ready for real_stage. The existing dev server is still the preview target; production deployment remains the coordinator's separate next step. The independent reviewer has finished; real_stage's UI acceptance is outside this report's ownership.


## Rendered acceptance

[Before/after comparison](../evidence/real_models/comparison.html) contains all three template pairs. All six final PNGs were inspected. The owner-facing three-quarter angle reveals the OLED's single header support; the new temperature render shows its TO-92 body and three leads, a piezo seated on the board, and the compact layout. Before/after use identical rendering settings. `temp-monitor-owner-before.png` preserves the owner's exact live shot as additional baseline evidence. Camera matching is approximate because the original interactive orbit state was not recorded.

The result is materially closer to the reference in part recognition, finish and visible conductors. It remains a sparse module carrier with estimated hobby-module detail, rather than the reference's dense custom chip-level design. Photo-stage lighting, hover and UI screenshots remain real_stage's separate deliverable. The engineering captures isolate the geometry/material improvement and do not claim physical manufacture or fit.

Final palette refinement requested by real_stage: deep-green mask/over-copper values are #14492f / #1a5a3a; black over-copper is #25292a. The solid GND fill makes over-copper the dominant visible colour, so the difference is deliberately subtle. Fresh jobs, final PNGs, native KiCad checks and physical copper audits all pass with these colour-only constants. The full logic suite passed before this final palette-only refinement; typecheck and all-template output verification were rerun afterwards. Production remains untouched.

All real_models deliverables and verification are complete. No real_models worker remains running; the independent reviewer is finished. Coordinator-owned project handoff and production deployment remain for the coordinator.

## E7 P2-1 / P2-2 corrections — 4 November 2026

**P2-1 fixed.** The physical copper oracle requires finite coordinates/diameters, positive drill and copper diameters, and at least **0.15 mm radial annulus** for pads, physical vias and route-only vias. Route records must agree with matching physical vias. A drill cutting another plated annulus fails closed. Copper wholly erased inside a drill is discarded, and circle/trace/pour overlap tests use the annulus's inner boundary. Valid continuous annuli still join the retained copper around their drill voids. The wider fabrication integration assertion now checks the annulus, not only minimum absolute diameters.

`tests/board-copper-oracle.test.ts` exercises intact and route-only transitions; thirty malformed/destructive/undersized/nonfinite cases; contradictory route records; a neighboring drill cut; and erased trace/pour geometry. The reviewer's exact six-via temperature-board mutant now exits **1** instead of certifying it; the three intact retained boards still exit **0**. [physical-audit.json](../evidence/real_models/e7-fixes/physical-audit.json) and the corresponding logs retain the reproduction.

**P2-2 fixed.** Shared maintenance is an explicit `BoardServiceOptions.maintenance` configuration (`mechCacheRoot`, `testRootsParent`). The actual `boardApi()` app factory enables the shared policy for both Vite development and production preview, irrespective of whether jobs live under `board-jobs` or deployed `board-jobs-app`. Isolated service fixtures do not implicitly maintain shared storage. The queue-lock exclusion for active test roots remains. `tests/board-maintenance.test.ts` drives the actual preview plugin factory for both directory layouts, checks startup and subsequent history cleanup, preserves recent entries/locked roots/unrelated directories, and checks opt-in isolation. No running production service/configuration was restarted or modified; the code takes effect when the coordinator next loads it.

Validation:
- Targeted copper/maintenance/security suite: **15/15 pass** ([targeted.log](../evidence/real_models/e7-fixes/targeted.log)).
- `npm run typecheck`: **pass** ([typecheck.log](../evidence/real_models/e7-fixes/typecheck.log)).
- Full `npm test`, run **once**: **108/109 pass** in 206.01 s ([npm-test.log](../evidence/real_models/e7-fixes/npm-test.log)). The board API's EDA worker hit its 120 s timeout before output; no source/graph assertion caused this failure. This was not reported as an all-green full run.
- The single failing real-board API test was rerun alone: **1/1 pass**, 60.02 s total ([api-retry.log](../evidence/real_models/e7-fixes/api-retry.log)). The full suite was not repeated.
- Independent source review found no blocking defect in either correction; its E7 addendum is in `real_models-review.md`.

No `web/` file was edited by this fix, and no production build/restart, commit, push, stash or reset occurred. The coordinator's next approved task is Layer 2 maker edits; its contract/status is tracked separately under `2026-11-04-canvas-tools/reports/edit_core.md`.

### Subsequent Layer 2 closure

The authorized maker-edit task is complete: [edit_core report](../../2026-11-04-canvas-tools/reports/edit_core.md). Its final full suite passes **223/223**, including the E7 copper and shared-maintenance regressions; final typecheck passes. It also verifies native move/rotation/resize/USB edits, physical copper, case regeneration and firmware reuse. The earlier E7-only run/retry receipts above remain unchanged. Production was not rebuilt or restarted.
