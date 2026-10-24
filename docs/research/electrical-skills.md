# Electrical, PCB, and firmware agent tooling for Moki

Researched 2026-10-24. Scope: actual skill instructions and source code, KiCad 9 compatibility, Linux Daytona workers with 2 vCPU / 4 GiB RAM, and an evidence-producing electrical → mechanical handoff. This was read-only research: no candidate skills were installed, no downloaded code was executed, no credentials were read, and no engineering benchmark was run. Searches covered `kicad`, `pcb`, `electronics`, `schematic`, `circuit`, `ngspice`, and `firmware` after checking the [skills.sh leaderboard](https://skills.sh/).

## Recommendation

Use **KiStack instructions for design**, **KiCad itself for ERC/DRC/netlist/export**, and **kicad-happy for independent structured analysis**. The first adoption should be only the inspect + ERC/DRC + geometry subset, not every supplier, manufacturing and simulation capability in these repositories. Keep one writer per design and have a separate validator inspect the saved files. Let the electrical worker use code and the installed KiCad interfaces for repeatable changes; use its desktop for visual inspection and unsupported interactive operations. Pure screenshot clicking is not required for every component or export.

For this hackathon, start with an existing, licensed KiCad 9 reference circuit or a very small board rather than assuming an arbitrary prompt will yield a validated routed PCB. Make the first task moving a connector and updating its enclosure aperture. This is a recommendation derived from the scope and version constraints below, not a measured speed claim.

There is no installed KiCad/PCB/electrical/SPICE/firmware skill directory under the two local skill roots inspected. The existing mechanical `cad` and `step-parts` skills do not implement electrical design or ERC/DRC.

## Shortlist and observed adoption

Counts were read on 2026-10-24 from `npx --yes skills find …` and GitHub's API, not inferred from marketing. Install numbers are rounded as displayed and describe skills.sh's count, not proven engineering quality. Stars belong to the whole repository. Pushed dates can include non-code changes.

| Candidate | Kind / use | Displayed installs | GitHub stars | Last pushed UTC | Fit |
|---|---|---:|---:|---|---|
| [aklofas/kicad-happy](https://github.com/aklofas/kicad-happy) | Skills + Python analyzers: independent review, BOM, SPICE | `kicad` 1K; `jlcpcb` 760; `bom` 688; `pcbway` 478 | 1,494 | 2026-10-23 | Best electrical validation add-on inspected |
| [American-Embedded/kistack](https://github.com/American-Embedded/kistack) | Human-written design/layout/export skills; small helper | schematic 372; PCB 369; layout 163; export 330 | 410 | 2026-09-24 | Best design instruction set inspected; adapt commands to KiCad 9 |
| [o2scale/electronics-agent-kit](https://github.com/o2scale/electronics-agent-kit) | KiCad CLI/file-format and PlatformIO references | file-format 228; CLI 188; PlatformIO 286 | 13 | 2026-02-03 | Useful reference, not a verified automation engine; CLI docs target 8.x |
| [diodeinc/pcb](https://github.com/diodeinc/pcb) | Zener language/compiler/toolchain plus skills | `spice-sim` 1.3K; `zener-language` 1.7K | 466 | 2026-10-24 | Promising later; current README requires KiCad 10.x |
| [tscircuit/skill](https://github.com/tscircuit/skill) | Skill for TypeScript/React circuit tooling | 1.1K | 30 | 2026-10-17 | Attractive web-native alternative; not a drop-in KiCad worker skill |
| [ProductOfAmerica/mcp-server-kicad](https://github.com/ProductOfAmerica/mcp-server-kicad) | MCP runtime + Claude-specific workflow skills | Not surfaced in the searches inspected | 15 | 2026-10-23 | Do not adopt as Moki's default: now maintenance-only |
| [AvatarSD/KiSkill](https://github.com/AvatarSD/KiSkill) | Skills + actual schematic/PCB helper engine | Not surfaced in the searches inspected | 6 | 2026-10-18 | Experimental; generator emits KiCad 10 schematics |
| [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills/tree/main/skills/embedded-systems) | General embedded implementation guidance | embedded-systems 6.7K | 12,034 | 2026-10-21 | Useful firmware reference; not a simulator or PCB generator |
| [adamlipecz/esp32-firmware-engineer-skill](https://github.com/adamlipecz/esp32-firmware-engineer-skill) | ESP-IDF-specific instructions and templates | 1.3K | 12 | 2026-02-24 | Variant-specific alternative; small/less-established source |

Metadata provenance: [kicad-happy API](https://api.github.com/repos/aklofas/kicad-happy), [KiStack API](https://api.github.com/repos/American-Embedded/kistack), [electronics-agent-kit API](https://api.github.com/repos/o2scale/electronics-agent-kit), [Diode API](https://api.github.com/repos/diodeinc/pcb), [tscircuit skill API](https://api.github.com/repos/tscircuit/skill), [MCP API](https://api.github.com/repos/ProductOfAmerica/mcp-server-kicad), [KiSkill API](https://api.github.com/repos/AvatarSD/KiSkill), [Jeffallan API](https://api.github.com/repos/Jeffallan/claude-skills), [ESP32 skill API](https://api.github.com/repos/adamlipecz/esp32-firmware-engineer-skill). Skill counts can be revisited at [kicad-happy](https://skills.sh/aklofas/kicad-happy/kicad), [KiStack](https://skills.sh/american-embedded/kistack/kicad-schematic), [Diode](https://skills.sh/diodeinc/pcb/spice-sim), [tscircuit](https://skills.sh/tscircuit/skill/tscircuit), and [embedded-systems](https://skills.sh/jeffallan/claude-skills/embedded-systems).

## What the inspected candidates actually do

### KiStack: useful design discipline, not an automatic board factory

The schematic skill calls for datasheet-backed connections, both rendered images and exported netlists, and preserving pin number/name mappings when modifying symbols. The PCB/layout skills emphasize accessible connectors, placement, return paths, and one canonical board with one writer. They do not supply a complete schematic generator or automatic router. The layout skill prefers KiCad IPC/kiPy when available and generally avoids autorouting. These are valuable agent instructions, not new KiCad capabilities. [Schematic skill](https://github.com/American-Embedded/kistack/blob/8494dbde095669df081950cbb6b24d08a21e25b0/skills/schematic/SKILL.md), [PCB skill](https://github.com/American-Embedded/kistack/blob/8494dbde095669df081950cbb6b24d08a21e25b0/skills/pcb/SKILL.md), [layout skill](https://github.com/American-Embedded/kistack/blob/8494dbde095669df081950cbb6b24d08a21e25b0/skills/layout/SKILL.md).

The export skill demonstrates a reproducible shell/Python export recipe, but includes `--refill-zones`, which is absent from KiCad 9's documented DRC command, and optional `--variant` flags that should not be copied into our pinned environment without checking its help. Its position converter validates input CSV headers but maps every side other than `top`/`front` to bottom; Moki should reject unknown side values rather than silently trust them. It does not validate a supplier's component rotation conventions. [Export skill](https://github.com/American-Embedded/kistack/blob/8494dbde095669df081950cbb6b24d08a21e25b0/skills/export/SKILL.md), [actual converter](https://github.com/American-Embedded/kistack/blob/8494dbde095669df081950cbb6b24d08a21e25b0/skills/export/scripts/convert_position.py).

### kicad-happy: strongest validator candidate

The actual PCB analyzer parses saved S-expressions and emits board outline, footprint/pad/net geometry, routing and rule information. It extracts `Edge.Cuts` lines/arcs/circles/rectangles/polygons/curves and computes bounding geometry; footprint extraction includes local-to-board transformations, courtyard geometry, pad drills and model paths. This can seed Moki's electrical → mechanical adapter. The schematic analyzer has real parsers and detectors, not only prose. Both import many sibling modules, so copying a single script is insufficient. [PCB analyzer source](https://github.com/aklofas/kicad-happy/blob/2fd9aa0fe2d620f36627d9221e8b1393987ae38e/skills/kicad/scripts/analyze_pcb.py), [schematic analyzer source](https://github.com/aklofas/kicad-happy/blob/2fd9aa0fe2d620f36627d9221e8b1393987ae38e/skills/kicad/scripts/analyze_schematic.py).

Its `models_3d` list is not a measurement of actual component height or connector aperture. Pad `height` means a 2D pad dimension. We still need actual STEP bodies/datasheet dimensions for enclosure collisions, connector insertion direction and cable clearance. Shape bounds alone are insufficient for rounded outlines, cutouts or holes.

The SPICE package generates targeted subcircuit testbenches from analysis output. Its backend invokes ngspice using an argument array with a timeout; result evaluators distinguish pass/warn/fail/skip. Useful for a divider, RC filter or LED driver; it does not emulate arbitrary MCU firmware or guarantee all real component behavior. Pin mapping and model provenance remain essential. Keep `skip` visible as unverified. [SPICE skill](https://github.com/aklofas/kicad-happy/blob/2fd9aa0fe2d620f36627d9221e8b1393987ae38e/skills/spice/SKILL.md), [backend](https://github.com/aklofas/kicad-happy/blob/2fd9aa0fe2d620f36627d9221e8b1393987ae38e/skills/spice/scripts/spice_simulator.py), [evaluators](https://github.com/aklofas/kicad-happy/blob/2fd9aa0fe2d620f36627d9221e8b1393987ae38e/skills/spice/scripts/spice_results.py).

### MCP server: particularly important negative finding

The current README says the project entered maintenance mode in October 2026. It reports a narrow, author-run comparison: six single edits repeated three times, plain coding agent 18/18 correct versus plugin 3/18. In a separate 20-edit session both succeeded, with the plugin using about 1.8 times the context. The test material is unpublished because the source design lacked a license. The README recommends using a coding agent with KiCad and CLI checks instead. This is not our independent benchmark or a universal result, but it directly contradicts recommending its old restrictive skill as the safest default. That skill forbids direct KiCad-file edits and CLI fallback. [Current README and evaluation explanation](https://github.com/ProductOfAmerica/mcp-server-kicad/blob/f972bfb2d340eeb6b7e5d8a95881e88059d5a494/README.md), [using-kicad skill](https://github.com/ProductOfAmerica/mcp-server-kicad/blob/f972bfb2d340eeb6b7e5d8a95881e88059d5a494/skills/using-kicad/SKILL.md).

The routing integration does contain useful real code: pinned/hash-checked Freerouting download, headless routing, analytics disabling, and timeouts. Its first route may download a roughly 65 MB JAR and needs Java 25. The code is worth studying separately, not a reason to install the entire policy layer. [Routing source](https://github.com/ProductOfAmerica/mcp-server-kicad/blob/f972bfb2d340eeb6b7e5d8a95881e88059d5a494/mcp_server_kicad/_freerouting.py).

### KiSkill, Diode, and tscircuit: alternatives with explicit boundaries

**KiSkill** has a real S-expression/geometry engine with symbol placement, wires, junctions and tests. However `empty_sheet()` hardcodes schematic version `20260306` and generator `10.0`, and its instructions assume KiCad 10 Flatpak paths. It is not compatible with our KiCad 9 environment by assumption. Its geometry verification is useful to study; adopting it requires adapting and testing the format layer. [Generator source](https://github.com/AvatarSD/KiSkill/blob/b27ce9e0f7bee10ef6dd606baabcbaf0c3c1eecc/kicad_lib/build.py), [operations source](https://github.com/AvatarSD/KiSkill/blob/b27ce9e0f7bee10ef6dd606baabcbaf0c3c1eecc/kicad_lib/ops.py), [schematic skill](https://github.com/AvatarSD/KiSkill/blob/b27ce9e0f7bee10ef6dd606baabcbaf0c3c1eecc/skills/kicad-schematic/SKILL.md).

**Diode PCB** is a compiler/toolchain, not simply an agent skill. Current README requires KiCad 10.x for layout and export. Its SPICE skill explicitly warns that `pcb sim` can report success despite failed measurements or missing plots; return code alone must never become our validation badge. Every populated component needs an appropriate model, encrypted models are unsupported, and the default five-second simulation timeout can be restrictive. [README](https://github.com/diodeinc/pcb/blob/5f85dcae53a460d1db5e9437ab5e200cc36dd656/README.md), [SPICE skill](https://github.com/diodeinc/pcb/blob/5f85dcae53a460d1db5e9437ab5e200cc36dd656/skills/spice-sim/SKILL.md), [simulation implementation](https://github.com/diodeinc/pcb/blob/5f85dcae53a460d1db5e9437ab5e200cc36dd656/crates/pcbc/src/sim.rs).

**tscircuit** offers TSX circuits and structured Circuit JSON, with source/netlist/placement checks, autorouting stages, copper shorts checks, and 3D-related elements. It fits a React product better than a desktop-only workflow, but would be a distinct circuit-authoring stack. Test import/export fidelity and routing before choosing it, rather than promising native KiCad round-tripping. Its current skill requires explicit netlist, placement and post-route shorts checks; development-stage DRC suppression language must not weaken Moki's release gate. [Skill](https://github.com/tscircuit/skill/blob/ccfd1afbefa0d1fb0f995795e805030ee5e96de1/SKILL.md), [core project](https://github.com/tscircuit/tscircuit).

## KiCad 9: what is actually available

KiCad CLI is a deterministic validator/exporter, not an API for placing symbols, assigning footprints or routing. KiCad's SWIG `pcbnew` binding can load/edit/save boards headlessly in the pinned version, but is PCB-only, unstable between majors and deprecated from version 9; the plan is removal in version 11. IPC is the forward-looking interface and requires a running KiCad instance; confirm the actual KiCad 9 operation set before designing a wrapper around newer examples. [Official binding documentation](https://dev-docs.kicad.org/en/apis-and-binding/pcbnew/), [official IPC architecture](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/).

For new schematics, use a compatible known-good template and structured edits with real library definitions; verify UUIDs, instance paths and pin geometry by re-opening/exporting in KiCad. Never build pin maps from a model's memory. For footprints, establish symbol-pin-number → footprint-pad-number correspondence from the actual files and datasheet; a matching footprint name alone is insufficient.

Commands below are grounded in the [KiCad 9 CLI manual](https://docs.kicad.org/9.0/en/cli/cli.html). They are recipes to run on a fixture, not commands executed during this research. Check the worker's exact `--help` output before freezing a wrapper because online major-version docs can evolve. Keep schematic, board and project together for parity checks.

```bash
mkdir -p build/reports build/schematic build/fab
kicad-cli version
kicad-cli sch erc --help
kicad-cli pcb drc --help

kicad-cli sch erc --format json --severity-all --exit-code-violations \
  --output build/reports/erc.json design.kicad_sch
kicad-cli pcb drc --format json --severity-all --schematic-parity \
  --exit-code-violations --output build/reports/drc.json design.kicad_pcb
kicad-cli sch export netlist --format kicadxml \
  --output build/netlist.xml design.kicad_sch
kicad-cli sch export svg --output build/schematic/ design.kicad_sch
kicad-cli pcb export svg --layers F.Cu,B.Cu,Edge.Cuts,F.SilkS \
  --output build/board.svg design.kicad_pcb
kicad-cli pcb export step --board-only \
  --output build/board-only.step design.kicad_pcb
kicad-cli pcb export step --subst-models \
  --output build/assembly.step design.kicad_pcb
kicad-cli pcb export gerbers \
  --layers F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts \
  --output build/fab/ design.kicad_pcb
kicad-cli pcb export drill --format excellon --excellon-units mm \
  --output build/fab/ design.kicad_pcb
```

KiCad 9 documents violation exit status **5**, not 2 as the older electronics-agent-kit skill states. Capture each result independently so a failing ERC/DRC cannot prevent collecting the other report. Do not append unsupported `--refill-zones`; zone filling must be handled with a compatible editor/API operation before validation. Report ignored/excluded findings separately. A clean ERC/DRC does not establish component values, electrical performance or enclosure fit.

Moki currently omits the huge system 3D-model package. `--subst-models` only substitutes existing corresponding files; it cannot invent missing models. Board-only STEP still supports basic outline/thickness fit. To claim component collision clearance, vendor just the required verified component STEP files or explicitly measured conservative volumes, including model source and missing-model status.

If a reviewed checkout of kicad-happy is later installed at `/opt/moki/kicad-happy`, its documented entrypoints are:

```bash
python3 /opt/moki/kicad-happy/skills/kicad/scripts/analyze_schematic.py \
  design.kicad_sch --analysis-dir build/analysis/
python3 /opt/moki/kicad-happy/skills/kicad/scripts/analyze_pcb.py \
  design.kicad_pcb --full --output build/pcb-analysis.json
python3 /opt/moki/kicad-happy/skills/spice/scripts/simulate_subcircuits.py \
  --analysis-dir build/analysis/ --timeout 10
```

These require the sibling modules/full skill directories; simulation additionally needs a simulator such as `ngspice`. No missing simulator should be converted into a successful simulation.

## Electrical → mechanical contract

Do not make the mechanical agent discover dimensions from screenshots or conversation history. After a successful saved-board mutation, publish an immutable artifact plus a revision event. Suggested fields:

- Product/revision IDs, parent revision, source board SHA-256, extractor version, KiCad version and export file hashes.
- Units `mm`; full coordinate-frame definition and explicit transform to mechanical coordinates, including Y-axis direction and PCB top/bottom Z surfaces.
- Exact closed outer outline and inner cutouts, thickness, mounting-hole centers/diameters or slot profiles, plated/non-plated flags and keepout volumes.
- Connector reference, footprint, board-space translation/rotation, body envelope, insertion direction, required aperture and cable/plug clearance, with provenance.
- Component envelopes above/below board, missing model/height flags, verified versus inferred geometry, and STEP artifact paths.
- ERC/DRC/parity reports with input hashes, exclusions, new violations and verification status.

This schema is a Moki design recommendation; none of the inspected skills supplies it end-to-end. kicad-happy can provide useful low-level extraction; a Moki adapter must normalize it and compare against KiCad exports. Do not equate a bounding box with the full board profile or treat all holes as mounting holes.

The mechanical validator checks assembly collisions and aperture fit against this revision. Moving a connector invalidates enclosure, fit results, product imagery and launch assets even if PCB width/height did not change. Firmware need only invalidate if the pin/net/function contract changes. The orchestrator owns those dependency decisions.

## Routing and simulation choices

For a tiny hackathon board, good placement and a few deliberate tracks are more predictable than introducing another toolchain. KiCad CLI has no built-in automatic-router command. Freerouting is a real Java routing engine that consumes DSN and emits SES; DSN export / SES import need compatible `pcbnew` or editor tooling. It does not select components, fix a bad schematic or guarantee signal integrity. [Freerouting project](https://github.com/freerouting/freerouting), [official CLI](https://github.com/freerouting/freerouting/blob/master/docs/command_line_arguments.md).

An optional later command, after a pinned JAR and DSN/SES bridge are validated, is:

```bash
java -Xmx1536m -jar /opt/moki/freerouting.jar \
  --gui.enabled=false -da -de design.dsn -do routed.ses -mp 5 -mt 1
```

On our 4 GiB desktop, cap heap and threads; keep routing asynchronous with a wall-clock deadline and preserve unrouted-net counts. Do not assume an exhaustive routing pass finishes within a live demo. The heap/thread choices are proposed resource limits, not measured requirements. The public routing API sends design data to another service and is not needed for this local-first trial.

For firmware, start with host tests for the timer/state machine and compile the exact MCU target using a pinned PlatformIO or ESP-IDF toolchain. The widely installed [embedded-systems skill](https://github.com/Jeffallan/claude-skills/blob/02b05028ba6c93f7aed45314b15c0dd5abead9d6/skills/embedded-systems/SKILL.md) is implementation guidance; it cannot provide the oscilloscope/logic-analyzer evidence its workflow requests when no hardware exists. Its illustrative register/ISR snippets must be adapted to the actual chip; `volatile` is not a general concurrency solution.

For a visual firmware demo, Wokwi is an actual simulator service with `diagram.json`, firmware binaries and automation scenarios; it is not an electrical DRC engine and does not derive a simulation automatically from our PCB. Wokwi CLI requires its own token, and its supported components bound what we can simulate. Keep this separate from an ngspice analog testbench. [Wokwi CLI installation](https://docs.wokwi.com/wokwi-ci/cli-installation), [CLI usage](https://docs.wokwi.com/wokwi-ci/cli-usage), [automation scenarios](https://docs.wokwi.com/wokwi-ci/automation-scenarios).

## Adoption and review boundary

No installs were performed. If adopted, the Skills CLI exposes these install forms:

```bash
npx skills add aklofas/kicad-happy@kicad
npx skills add aklofas/kicad-happy@spice
npx skills add american-embedded/kistack@kicad-schematic
npx skills add american-embedded/kistack@kicad-pcb
npx skills add american-embedded/kistack@kicad-layout
npx skills add american-embedded/kistack@kicad-export
npx skills add jeffallan/claude-skills@embedded-systems
```

Before executing their helpers, pin the inspected revision and review all invoked sibling files. A skill install is instructions, not evidence that its suggested binaries or APIs work. The external skills' arbitrary approval gates and tool restrictions should not silently replace Moki's authorized workflow. Avoid putting service keys in the desktop worker's environment unless the task actually needs them; use a dedicated project workspace for file writes. Candidate scripts can fetch supplier data or models, so document network dependencies and model provenance rather than calling the entire bundle offline.

## One benchmark to run next: connector move and mechanical handoff

Use a licensed, committed KiCad 9 fixture with a small already-routed board, two mounting holes and a connector. Produce three fresh workspaces per path: **A, GUI-only screenshot/click agent**, and **B, structured board modification plus KiCad CLI validation with GUI review**. Same model/settings/task: move the connector 5 mm, preserve pin/net connectivity and board dimensions, reroute affected tracks if needed, export geometry and STEP, and flag the previous enclosure as stale.

Measure cold sandbox wake/app-start separately from warm execution. Record wall-clock time, model calls, screenshot transfers, tool errors/retries, report generation time, validation result and token usage. Preserve every input/output hash. Stop each trial at a declared 5-minute budget and count incomplete output as incomplete; do not record a timeout as success.

Success requires exact requested connector position within declared tolerance, unchanged expected netlist, unchanged outline/holes, no new ERC/DRC/parity failures, an actual updated STEP/contract, and the mechanical reader receiving the new revision. Run a deliberately stale contract through the validator and require rejection. Missing component models should yield limited verification, not a full-fit success badge.

This single task answers both immediate questions: whether current computer use is fast enough and whether electrical/mechanical agents can coordinate correctly. Neither speed nor autonomous end-to-end engineering has been established by API connectivity or desktop-launch checks.
