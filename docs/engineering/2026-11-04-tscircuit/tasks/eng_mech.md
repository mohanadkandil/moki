# eng_mech: printable enclosure and 3D assembly from the board

Read first: ../BRIEF.md. Then:
- eda/node_modules/@tscircuit/create-fdm-enclosure/dist/index.d.ts (the API: solver pipeline, faces, apertures)
- eda/node_modules/circuit-json-to-gltf/dist/index.d.ts
- src/circuit/catalog.ts (module sizes)
- evidence/coordinator-spike-board.tsx

## Allowed write paths
- eda/enclosure.ts
- eda/enclosure/**
- tests/enclosure*.test.ts (if Node-testable; Bun-side tests can go in eda/enclosure/*.test.ts and run with `bun test`)
- docs/engineering/2026-11-04-tscircuit/{evidence/eng_mech,reports/eng_mech.md}

For new packages, write requests/eng_mech-to-eng_core.md. You may `bun add` into eda/ **only** exact-pinned packages, and you must state that in your report. eng_core owns the file, so tell them.

## Deliver
`bun eda/enclosure.ts --job <dir>` reads `<dir>/circuit.json`. Until eng_core's render exists, generate one yourself from evidence/coordinator-spike-board.tsx and test against it. It writes:
- **enclosure-base.stl and enclosure-lid.stl**, printable FDM:
  - 2.0 mm walls, a 0.3 mm fit clearance and standoffs at the board's M3 mounting holes (read the holes from circuit.json);
  - board height clears the tallest module stack. Module height = header socket (8.5 mm) + module thickness + components. Estimate it per catalog module and document the numbers;
  - **apertures**: the devkit USB connector on the wall it faces; a display window in the lid over the OLED's active area; a shaft hole over the encoder; vent slots;
  - a lid that snaps on or uses M3 screws.
- **assembly.glb**: the board GLB with the enclosure. Base solid, lid translucent or exploded, so the 3D tab shows the object.
- **enclosure.json**: dimensions, wall, clearances, each aperture (face, position, size, the part it serves), print orientation, estimated volume and filament grams (PLA 1.24 g/cm³), and a list of assumptions.
- Per-stage ms, in the same receipt format as BRIEF: `{name, status, ms, note}`. Print it to stdout as the last line of JSON, or write it to enclosure.json under `timing`.

## Acceptance
- For a focus-timer board, the STLs are manifold/watertight. Check this programmatically, e.g. edge-manifold counts. Report the count.
- Render PNGs (three.js page or another headless renderer) of the base, the lid and the assembly into evidence/eng_mech/, and inspect them yourself: can you see the USB/display/encoder openings in the right places?
- Report the timings, assumptions and known gaps in reports/eng_mech.md. Be explicit that no physical print has happened.

## Update from the coordinator (4 Nov, mid-task): the enclosure moves to build123d
- **tscircuit owns the electronics.** That covers the schematic, the PCB, board.glb and the board facts in circuit.json: outline, holes, component positions and connector locations.
- **build123d owns the body.** The plan already chose it (02-architecture). We need real B-rep: fillets, snap fits, bosses, embossed text, a **STEP export** for real CAD, and `is_valid` checks. create-fdm-enclosure (v0.0.7) produces JSCAD mesh boxes only.
- **Keep your create-fdm-enclosure work** as a fast baseline/fallback stage named `enclosure-baseline`.
- **Handoff:** `eda/enclosure.ts`, or a small `eda/mech-handoff.ts`, writes `mech-handoff.json` from circuit.json. It holds:
  - the board outline and thickness;
  - the M3 holes;
  - per-part bbox and stack height;
  - each aperture (face, centre, size, the part it serves, e.g. USB, display active area, encoder shaft).
- **New allowed paths:**
  - `mech/**`: Python, e.g. `mech/enclosure.py --job <dir>`, which reads mech-handoff.json and writes enclosure-base.stl, enclosure-lid.stl, enclosure.step and enclosure.json;
  - `tests/mech*` or `mech/tests/**`.
- **Venv:** /home/sogo/.local/share/moki-tools/build123d-venv. python3-venv's ensurepip is missing here, so use `python3 -m venv --without-pip` and then get-pip.py. build123d 0.13.0 with cadquery-ocp-novtk 8.0.1.1.0 is verified on this arm64 box: 3.9 s import, 0.12 s for a shell with a cutout. Pin these exact versions in mech/requirements.txt.
- **assembly.glb:** the board GLB plus the build123d enclosure, e.g. export glTF from build123d or convert the STL. Lid translucent or exploded.
- **Timings:** report import time and model time separately. A warm worker can amortize the import.
- **Acceptance (unchanged, plus):**
  - `part.is_valid` is True for base and lid, and the STLs are watertight;
  - enclosure.step opens;
  - rendered PNGs show the openings in the right places.
