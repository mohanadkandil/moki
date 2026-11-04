# eng_mech report: printable enclosure from the board

**Status: software acceptance met for all three templates. Nothing has been physically printed or test-fitted, and no slicer has been run.** Every fit below is calculated from catalog and seller data, not measured on real parts.

tscircuit owns the electronics. build123d owns the body, as the coordinator directed on 4 November. create-fdm-enclosure stays as the `enclosure-baseline` stage and the fallback.

## What works

`bun eda/enclosure.ts --job <dir>` is the single command. eng_core's API calls it once.

```
circuit.json -> mech-handoff.json -> enclosure-baseline (mesh box) -> mech/enclosure.py (B-rep) -> assembly.glb
```

**It writes:** `mech-handoff.json`, `enclosure-base.stl`, `enclosure-lid.stl`, `enclosure.step`, `enclosure.json`, `assembly.glb`, and `enclosure-baseline-base.stl` / `-lid.stl`.

**Exit codes:** 0 means build123d or the fallback produced a body. 1 means nothing usable. The last stdout line is `{name, status, ms, note, stages}`. A fallback sets `engine.fallback: true`, and its stage note says why.

**The body:**
- Walls, floor and lid are 2.0 mm, with a 0.3 mm fit clearance per side.
- **Lid fastening:** four M3 x 16 mm self-tapping screws go in through the floor, pass the standoffs and the board, and thread into lid pillars. A 2.95 mm lip locates the lid.
- **Openings:**
  - USB, on the wall the connector faces
  - display window with a sloped well down to the glass
  - encoder shaft hole
  - vent slots (8 per side)
  - sound holes, light and LED holes, and sensor air holes, as each template needs
- Wall openings have arched tops, and the lid prints upside down, so no supports are expected. No slicer has confirmed this.
- Parts are located from their real plated holes by a rigid fit against the catalog pins, so rotated parts carry their openings with them. Turning the devkit moves the USB opening to the new wall.

**Module geometry now has one source.** `eda/enclosure/module-mech.ts` holds the mechanical data. eng_core switched `src/board/preview-model.ts` to `modulePreviewPlan`, so board.glb and the enclosure show the same modules. assembly.glb draws each module once.

### Reproduce

```bash
# Venv. It lives outside the repo, and the path did not exist when I started, so I created it with this recipe.
V=~/.local/share/moki-tools/build123d-venv
python3 -m venv --without-pip $V
curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && $V/bin/python /tmp/get-pip.py
$V/bin/python -m pip install -r mech/requirements.txt

# A job
bun eda/enclosure/make-jobs.ts /tmp/jobs
(cd eda && bun render.ts --job /tmp/jobs/focus-timer)
bun eda/enclosure.ts --job /tmp/jobs/focus-timer

# Tests
$V/bin/python -m unittest discover -s mech/tests -v     # 19 tests
(cd eda && bun test enclosure/)                         # 45 tests; npm test runs these through tests/enclosure.test.ts

# Evidence
bun eda/enclosure/render-evidence.ts --job /tmp/jobs/focus-timer --out <dir> --prefix focus-timer
bun eda/enclosure/bench-enclosure.ts --root /tmp/jobs --out <file>
```

## Acceptance evidence

All files are in `evidence/eng_mech/`.

| Check | Focus timer base | Focus timer lid |
|---|---|---|
| `is_valid` | True | True |
| Triangles | 11,024 | 5,742 |
| Open (boundary) edges | 0 | 0 |
| Non-manifold edges | 0 | 0 |
| Winding conflicts | 0 | 0 |
| Euler characteristic | -40 | -20 |

- **The Euler numbers match the designed holes.** The base has 21 through-holes (4 screws, 1 USB, 16 vents), which gives 2 - 42 = -40. The lid has 11 (window, shaft, 9 sound holes), which gives 2 - 22 = -20.
- **Other templates:** light-lamp and temp-monitor also show 0 open and 0 non-manifold edges (`<template>/enclosure.json`).
- **Independent check:** trimesh 4.5.3, installed outside the runtime venv, reports watertight, consistent winding, a valid volume and one body for all six STLs (`trimesh-independent-check.json`).
- **STEP:** it reopened as 2 valid solids, and its volume matches the model (62.324 cm³ for the focus timer). This happens on every job. The reopen uses OpenCascade, the same kernel that wrote the file. **It has not been opened in another CAD application.**
- **Openings by point probes** (`mech/tests/test_enclosure.py`):
  - The tests check points inside the solids at the USB opening, whole active area, shaft axis, screw path, lip notch and wall thickness.
  - The shaft hole is within 0.01 mm of the shaft axis. The USB opening is centred on the connector in both directions along the wall.
  - The same checks run on a board rotated 90 degrees.
- **Collisions:**
  - Every fixed module block was intersected with the base and the lid for all three templates and the rotated board. There were zero findings.
  - A deliberately oversized block is caught, so the check can fail.
  - Parts raised on their leads (LED and LDR) are excluded, because their height is the builder's choice.
- **Renders, which I inspected:**
  - `focus-timer-assembly-lid-solid.png` and `focus-timer-assembly-closed.png`: the window frames the active area, the shaft passes through its hole, and the sound holes sit over the piezo.
  - `focus-timer-assembly-usb-front.png` and `focus-timer-base-usb-wall.png`: the USB opening is in front of the connector.
  - `focus-timer-lid-underside.png`, `focus-timer-base-inside-top.png` and `focus-timer-base-back-mark.png`: pillars, lip notch, standoffs and engraved mark.
  - `light-lamp-*` and `temp-monitor-*`: the template-specific openings.
  - `focus-timer-assembly-bare-board-top.png`: the silkscreen reads correctly with U1 bottom-left, which confirms the assembly is not mirrored.
- **Determinism:** the same handoff gives byte-identical STLs (tested). The STEP file carries a timestamp, so it is not byte-identical.
- **Test logs:** `mech-unittest.log` (19 pass) and `bun-test.log` (45 pass). `npx tsc --noEmit` passes. **I ran only my own file from the root suite (`tests/enclosure.test.ts`, 1 pass), not the full `npm test`,** to avoid loading the host during eng_core's benchmark.

## Measured timings

`evidence/eng_mech/timings.json` holds 5 cold and 3 cached runs per template, in ms, p50 / p95. Measured on 8-core arm64 with 15.6 GB RAM, **shared with other agents at load average 6 to 8**, so these numbers include that load.

| Stage | Focus timer | Light lamp | Temp monitor |
|---|---|---|---|
| Whole command, cold | 6,509 / 8,872 | 6,700 / 7,797 | 8,695 / 10,288 |
| Whole command, cached | 611 / 712 | 406 / 408 | 604 / 642 |
| Python import | 2,832 / 4,715 | 3,075 / 4,076 | 3,776 / 5,536 |
| B-rep model | 1,019 / 1,233 | 965 / 1,030 | 1,170 / 1,297 |
| Validity check | 119 / 129 | 110 / 112 | 131 / 142 |
| STL export | 136 / 186 | 122 / 136 | 165 / 206 |
| STEP export | 210 / 235 | 200 / 219 | 276 / 359 |
| Mesh check and STEP reopen | 788 / 832 | 695 / 728 | 807 / 897 |
| `enclosure-baseline` (runs on every job) | 374 / 456 | 203 / 207 | 366 / 522 |
| Handoff | 8 / 13 | 9 / 16 | 10 / 37 |
| Assembly GLB | 27 / 36 | 27 / 43 | 35 / 62 |

- **Python import is the largest single cost.** A warm worker would remove about 3 to 5 s from each cold job. I did not build one.
- **Engraving text is expensive.** Engraving the full content id took 3.6 s more per job than no text at all, measured in one run under load (5,492 vs 1,848 ms excluding import). The mark is now just "moki", and the id stays on the board silkscreen.
- **Cache.** Outputs are stored in `var/mech-cache/<hash of handoff + mech/enclosure.py + requirements>`. Failed runs and fallbacks are never stored. There is no eviction yet.
- **build123d compared with the baseline, focus timer:**

| | build123d | create-fdm-enclosure 0.0.7 |
|---|---|---|
| Open edges (base / lid) | 0 / 0 | 580 / 442 |
| STEP export | Yes | No |
| Lid fastening | M3 through-bolts into lid pillars | Friction fit only |
| Standoffs | Yes | Added by me (the package has none) |
| Time | 6.5 s whole command | 0.37 s |

The baseline's open edges come from T-junctions left by JSCAD booleans, so a slicer may need to repair those meshes. Its openings do land in the right places (`fallback-*.png`).

**API integration:** eng_core reports the wrapper running natively through the API. I saw my output files in a live API job dir under `var/board-jobs`, but I did not test the API path myself. `bypassCache` jobs in the API set a per-job `MOKI_MECH_CACHE_DIR`, so eng_core's cold bench figures do run the Python step.

## Dimensions and height stack (focus timer)

- **Outer size:** 94.6 x 105.6 x 30.49 mm. Solid volume is 62.3 cm³.
- **Filament:** at most 77.3 g of PLA at 1.24 g/cm³. This assumes 100% infill, so it is an upper bound.
- **Board to wall:** 0.3 mm, except 1.3 mm on the USB side, which leaves room for the connector overhang.

| Part | Socket | Male spacer | PCB | Components | Top above board (mm) |
|---|---|---|---|---|---|
| KY-040 (sets lid height) | 8.5 | 2.54 | 1.6 | 6.6 | 19.24 |
| ESP32-DevKitC V4 | 8.5 | 2.54 | 1.6 | 4.0 | 16.64 |
| SSD1306 OLED | 8.5 | 2.54 | 1.2 | 2.9 | 15.14 |
| Piezo (soldered) | - | - | - | 9.5 | 9.5 |

I added the 2.54 mm male header spacer to the formula in the task, because a soldered header holds the module that far above the socket. The encoder shaft stands 10.75 mm above the lid and the bushing 2.75 mm, enough for a knob and a panel nut.

## Assumptions and known gaps

**Physical checks needed first**
1. **KY-040 mounting is the largest risk.**
   - The design has it parallel to the carrier with the shaft up. This needs straight pins; a right-angle header would not plug into a vertical socket like this. I could not confirm which header sellers fit, so check this first.
   - Its one socket sits 21.4 mm from the shaft, so pressing the knob would lever the board. The design relies on the bushing's panel nut on the lid to carry that force.
2. **Module dimensions not confirmed:**
   - **ESP32-DevKitC V4:** sources conflict on length (54.4, 48.2 and 54 mm appear). The 25.4 mm row spacing and USB position are unconfirmed, and Espressif's drawing could not be read numerically. USB-C clones may differ.
   - **OLED:** the active area (21.744 x 10.864 mm) comes from a datasheet, but its position on the PCB is my estimate, since no drawing was found. The window has a 1.2 mm margin per side. The outline varies by seller.
   - **KY-040:** the 32 x 19 mm PCB has one source. The body, bushing and shaft heights are typical EC11 values and are unconfirmed.
   - **Piezo:** the catalog's 5 mm pin spacing may not match a real part, since many 12 mm parts use 6.5 to 7.6 mm (from memory, not looked up).
3. **Printing not verified:**
   - The clearance (3.4 mm) and pilot (2.6 mm) holes and the lip fit need a test print.
   - The 6 mm screw-head recess bridges over its through-hole on the bed side and may sag.
   - The board has 0.15 mm of vertical play between standoff and pillar, by design, so the lid closes fully.

**Not covered by the software**
4. **Collision checks run in tests, not on each job,** because each module block needs two booleans and I kept them out of the 30 s budget. I did not measure their per-job cost. An edited board gets only the lighter warnings (lid pillars touching parts, a display well with no room, a USB connector far from the wall). The rendered job will not report a module hitting the lid.
5. **Nothing thermal was simulated.** The vents are unproven. A DS18B20 inside the box will likely read warm from the ESP32, and the design note says so.
6. **Custom board outlines** use their bounding rectangle.
7. **Boards with no M3 holes** get solid resting posts and a friction-fit lid, with a warning.
8. **Unknown parts** become a 12 mm block with no opening, with a warning.
9. **assembly.glb modules are simplified blocks,** not vendor CAD. Leads are not modelled, so the LED and LDR appear to float under the lid.
10. **The template's board size is large for what it holds.** The box follows eng_core's 90 x 100 mm layout, so a tighter layout would shrink it.

**Scope notes**
- No warm Python worker was built.
- The mech test suite is not part of `npm test`. Only the Bun suite is. The Python suite took 26 s on the final run and 71 s earlier, before the mark was shortened.

## Changes others should know about

- **eda/package.json:** I added exact pins for `@jscad/modeling@2.13.0` and `jscad-planner@0.0.14`, and told eng_core. Both were already installed transitively. The lockfile change landed during an eng_core test run and caused one cache assertion to miss. They have since made that check robust.
- **Font:** `mech/assets/IBMPlexMono-Regular.ttf` (OFL, licence alongside it) is copied from the brand-directions folder only to engrave the mark. This is not a brand decision.
- **Requests sent:** `requests/eng_mech-to-eng_core.md` and `requests/eng_mech-to-eng_ui.md` (GLB node names and enclosure.json fields).

## Files touched

**Created:**
- `eda/enclosure.ts`
- `eda/enclosure/`: `handoff.ts`, `module-mech.ts`, `module-preview.ts`, `baseline.ts`, `assembly.ts`, `stl.ts`, `enclosure.test.ts`, `preview-page.ts`, `render-evidence.ts`, `bench-enclosure.ts`, `make-jobs.ts`
- `mech/`: `enclosure.py`, `requirements.txt`, `assets/`, `tests/test_enclosure.py`, `tests/fixtures/*.mech-handoff.json`
- `tests/enclosure.test.ts`
- `docs/engineering/2026-11-04-tscircuit/evidence/eng_mech/**`, this report, and the two request files

**Edited outside those paths, with permission:** `eda/package.json` and `eda/bun.lock` (the pins above).

**Outside the repo:** the venv at `~/.local/share/moki-tools/build123d-venv`.

## Sources for module dimensions

- [DM-OLED096-624 datasheet](https://cdn.shopify.com/s/files/1/0264/7629/files/DM-OLED096-624panel_Datasheet.pdf) (active area)
- [AZ-Delivery 0.96 inch OLED](https://az-delivery.de/en/products/0-96zolldisplay) (seller thickness and outline)
- [qeda 0.96 inch OLED footprint](https://git.cuvoodoo.info/kingkevin/qeda_library/src/branch/usb-cable-tester/display/display_oled_0.96in.yaml) (measured 27 x 27 mm body)
- [ESP32-DevKitC V4 guide, Espressif](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html) (drawing not readable as numbers)
- [Cirkit Designer ESP32-DevKitC V4](https://docs.cirkitdesigner.com/component/1bf011e9-937a-4465-8bb8-bd711bbcd5ea/esp32-devkitc-v4) (conflicting lengths)
- [KY-040 tutorial, ShillehTek](https://shillehtek.com/blogs/shillehtek-product-manuals/ky-040-rotary-encoder-module-for-arduino-with-demo-code-manual) and [Components101 KY-040](https://components101.com/modules/KY-04-rotary-encoder-pinout-features-datasheet-working-application-alternative) (outline and pins)
