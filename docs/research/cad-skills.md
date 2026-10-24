# Mechanical CAD skills and tooling for Moki

Research date: 2026-10-24. Scope: FreeCAD 1.0 and build123d 0.13.0 in Moki's EU Daytona Linux desktop, 2 vCPU / 4 GiB RAM; real STEP geometry, browser GLB previews, mechanical/electrical handoffs, and validators. This is a source review, not a runtime benchmark. No skill or MCP server was installed, no downloaded repository code was executed, and no credentials were accessed.

## Recommendation

Use **code-native build123d generation with the installed `cad` workflow**, saved STEP inspection, and snapshots as Moki's first mechanical execution path. Use **FreeCAD to open and review the result**, with computer use reserved for inspection and operations lacking an API. This recommendation is an engineering inference: a script can create many features and return measurements in one tool invocation; a visual click loop requires repeated observation/action round trips. We have **not measured** the speed or success rate of either route in Moki, and opening FreeCAD successfully does not establish autonomous CAD performance.

The strongest skills are already installed locally: `cad`, `cad-viewer`, `step-parts`, `dxf`, and `gcode`, all from [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad). Add narrowly selected validation practices from K-Dense's `lab-hardware-cad`; do not load its lab standards or every fabrication skill into every agent. Keep one versioned adapter between agent tools and CAD runtime.

## Search and quality evidence

Checked the [skills.sh leaderboard](https://skills.sh/) before CLI searches. `npx --yes skills find cad`, `freecad`, `build123d`, and `cadquery` were run. Broad `cad` search also returns unrelated marketing results, so relevance was checked against actual `SKILL.md` files. `freecad` returned no skills in that search; that is not evidence that no FreeCAD agent tools exist.

Counts below were observed on 2026-10-24. Install counts come from the Skills CLI and are rounded by that service. Stars and latest default-branch commit dates come directly from GitHub API. Repository stars are ecosystem signals, not evidence that a particular skill is correct.

| Candidate | Skills installs | Repository stars | Latest default-branch commit | Decision |
| --- | ---: | ---: | --- | --- |
| earthtojake/text-to-cad `cad` | 13.9K | 22,854 | 2026-10-20 | Primary, installed workflow |
| Same repository `cad-viewer` / `step-parts` / `dxf` | 9K / 11.1K / 9.1K | same repository | same repository | Use by task |
| K-Dense-AI/scientific-agent-skills `lab-hardware-cad` | 810 | 54,362 | 2026-10-19 | Targeted validator/reference candidate |
| tangency-labs/solidcraft `solidcraft-checking` | 14 | 9,865 | 2026-10-24 | Watchlist; requires another CAD stack |
| flowful-ai/cad-skill `parametric-3d-printing` | 209 | 692 | 2026-07-14 | Secondary reference, not Moki's core |
| neka-nat/freecad-mcp | Not an indexed skill in this search | 3,033 | 2026-10-13 | Optional native FreeCAD bridge |

Primary metadata: [text-to-cad API](https://api.github.com/repos/earthtojake/text-to-cad), [K-Dense API](https://api.github.com/repos/K-Dense-AI/scientific-agent-skills), [SolidCraft API](https://api.github.com/repos/tangency-labs/solidcraft), [Flowful API](https://api.github.com/repos/flowful-ai/cad-skill), [FreeCAD MCP API](https://api.github.com/repos/neka-nat/freecad-mcp). The corresponding [commits endpoints](https://api.github.com/repos/earthtojake/text-to-cad/commits?per_page=1) were checked for each repository. Skills pages: [cad](https://skills.sh/earthtojake/text-to-cad/cad), [lab-hardware-cad](https://skills.sh/k-dense-ai/scientific-agent-skills/lab-hardware-cad), [solidcraft-checking](https://skills.sh/tangency-labs/solidcraft/solidcraft-checking), [parametric-3d-printing](https://skills.sh/flowful-ai/cad-skill/parametric-3d-printing).

Source snapshots reviewed: text-to-cad [`2f793659fb7b`](https://github.com/earthtojake/text-to-cad/commit/2f793659fb7b), K-Dense [`593377bb0487`](https://github.com/K-Dense-AI/scientific-agent-skills/commit/593377bb0487) (the lab skill itself last changed at [`a92663a0214b`](https://github.com/K-Dense-AI/scientific-agent-skills/commit/a92663a0214b)), FreeCAD MCP [`78bf0230a033`](https://github.com/neka-nat/freecad-mcp/commit/78bf0230a033), SolidCraft [`5ca7c2fb95e7`](https://github.com/tangency-labs/solidcraft/commit/5ca7c2fb95e7), and Flowful [`fe4215970d39`](https://github.com/flowful-ai/cad-skill/commit/fe4215970d39). Mutable main-branch links below are for navigation; these commits identify the inspected snapshots.

## 1. Installed text-to-cad suite: best immediate fit

Inspected the actual installed instructions under `/Users/mohannedkandilicloud.com/.agents/skills/`:

- `cad`: named parameters, STEP as primary artifact, `gen_step()` source, geometry facts and positioning, targeted measurement/alignment, and mandatory snapshot review after visible changes. It supports labeled assemblies and source-level mating intent.
- `cad-viewer`: local interactive review of STEP, GLB, meshes and related formats. Its viewer links are review output, not a replacement for deterministic checks.
- `step-parts`: catalog search for real bought-in components, provenance and checksum verification before use. Inspect an imported part's coordinate frame rather than assuming its origin.
- `dxf`: explicit millimeter units, closed cutting contours, layers carrying process intent, and checks against actual drawing entities. Use when a laser-cut panel or gasket is needed.
- `gcode`: real slicer CLI, explicit printer/profile, dry run, then static G-code checks. Defer for this no-hardware demo; no printer profile exists to justify a printer-ready claim.

Source provenance and present package scope: [upstream skills list](https://github.com/earthtojake/text-to-cad#-skills). Installed instructions are the runtime source of truth; these capabilities have been inspected, not exercised in this research task.

### Critical version mismatch

The installed suite uses `scripts/step`, `scripts/inspect`, `gen_step()`, and `cadpy.assembly.AssemblyHelper`. **Current upstream is materially different.** Its `cad` skill pins **cadgen 0.7.26**, uses decorated Python models, Python `read_scene` geometry inspection, and explicitly says there is no inspect CLI. The [v0.7.26 release](https://github.com/earthtojake/text-to-cad/releases/tag/v0.7.26) was published on October 20. Do not paste new upstream commands into the old installed workflow, or update only its Markdown while retaining old launchers. [Current CAD skill](https://github.com/earthtojake/text-to-cad/blob/main/skills/cad/SKILL.md)

Stay with the installed interface for the first benchmark. If upgrading, evaluate the complete release in a separate environment and pin skill, runtime, Python and kernel together. build123d 0.13.0 changed its underlying kernel to OCP 8.0.1; earlier Moki setup already encountered incompatible old/new OCP packages, so avoid modifying the working environment spec casually. [build123d release notes](https://github.com/gumyr/build123d/releases/tag/v0.13.0)

Concrete distinction (reviewed instruction contracts; neither command was run by this research):

```sh
# Installed local skill, run from the project directory; generator exposes gen_step().
python /Users/mohannedkandilicloud.com/.agents/skills/cad/scripts/step models/enclosure.py
python /Users/mohannedkandilicloud.com/.agents/skills/cad/scripts/inspect refs models/enclosure.step --facts --planes --positioning

# Upstream v0.7.26, separate evaluated environment; model uses @step decoration.
uvx --no-config --managed-python --python 3.13 --from cadgen==0.7.26 python src/enclosure.py
# Upstream inspection uses a Python read_scene/read_step script, not scripts/inspect.
```

The absolute paths above identify the current Mac installation. Daytona needs its own pinned copy/dependencies; these paths cannot be passed unchanged to a Linux worker.

Reproducible future install command, **not run here**:

```sh
npx skills add earthtojake/text-to-cad#v0.7.26 --skill cad
```

The upstream README also supports its native Codex plugin and a skills-only installation. Installing a skill into the Mac's coding agent does not automatically expose its tools to Moki's OpenAI Agents SDK workers in Daytona; package the required instructions/files and actual executable tools in that worker environment. This last point is an integration requirement for Moki, not a feature guaranteed by the skill. [Official installation instructions](https://github.com/earthtojake/text-to-cad#other-agents)

## 2. K-Dense lab-hardware-cad: strongest additional validation reference

Read current `SKILL.md` directly rather than the cached older search excerpt: version **1.5**, reviewed October 1, targets **build123d 0.13.0 / Python 3.11–3.14**. It includes geometry gauges for regions that must be clear or contain material, bounds checks, bore inspection, inter-part clearance, snapshots, and source-hash/version/measurement manifests. Particularly useful: its geometry checks measure the solid; its separate standards-interface checks validate declared numbers and must not be presented as proof of geometry. [Current skill](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/lab-hardware-cad/SKILL.md)

Adopt the evidence model for board clearance, connector passage, boss material and lid fit. Its bundled labware/optics standards do not establish dimensions for arbitrary electronics. For Moki's general product workflow, PCB files and component vendor drawings own those dimensions. A clearance threshold must record whether it is per-side or total, plus process/material assumptions. These are Moki-specific applications of the skill, not prebuilt PCB features.

Potential future install, **not run**:

```sh
npx skills add K-Dense-AI/scientific-agent-skills --skill lab-hardware-cad
```

## 3. FreeCAD MCP: useful tool bridge, not a skill or computer-use model

[neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp) supplies a FreeCAD addon plus external MCP server. It can inspect documents/objects, execute Python, and request views. It requires a running FreeCAD addon; server Python is ≥3.12 and separate from FreeCAD's bundled Python. Default addon RPC is localhost:9875, not an HTTP MCP endpoint. Keep the bridge alongside FreeCAD inside the sandbox rather than exposing its RPC port to the internet. [Installation](https://github.com/neka-nat/freecad-mcp/blob/main/docs/installation.md)

Its execution modes are relevant: GUI-thread calls serialize, async geometry must commit document updates on the GUI thread, and headless execution runs a separate `freecadcmd` process. That separation can protect the visible app from kernel crashes. Successful tool execution still does not certify valid geometry. [Execution documentation](https://github.com/neka-nat/freecad-mcp/blob/main/docs/execution.md)

Potential launch after installing the matching addon, **not run**:

```sh
uvx freecad-mcp --only-text-feedback
```

Use explicit `get_view` for review screenshots. Actual compatibility with Moki's FreeCAD 1.0 still needs a box/document/export smoke test; examples covering newer FreeCAD do not prove it. Do not spend hackathon time adding MCP if build123d plus STEP import meets the immediate demo. [Tools and screenshot controls](https://github.com/neka-nat/freecad-mcp/blob/main/docs/tools.md)

## 4. Alternatives reviewed

**SolidCraft** is a separate Rust CAD application with CLI/MCP, editable timeline, assemblies and file export. Its checking skill adds parameter-range walks, sketch constraint checks and STEP comparison against an external build123d/OpenCascade oracle. It also documents cases where a boolean warning can leave incorrect geometry. Interesting for future agent-native CAD, but switching kernels/application formats adds risk to Moki today. Its skill is written against 0.8.0 despite current application evolution; validate compatibility before adopting. [Application](https://github.com/tangency-labs/solidcraft), [actual checking skill](https://github.com/tangency-labs/solidcraft/blob/main/skills/solidcraft-checking/SKILL.md)

```sh
# Evaluation only; not run. Requires the actual SolidCraft runtime too.
npx skills add tangency-labs/solidcraft --skill solidcraft-checking
```

**Flowful's CadQuery skill** includes staged previews, parameterized enclosures and print-oriented helpers. Its core delivery is STL, with STEP optional; its workflow also asks for feedback at several stages. It is less aligned with Moki's unattended STEP-first revision loop, and introducing CadQuery alongside the working build123d kernel is unnecessary now. Treat generic clearances as suggestions requiring process validation. [Actual skill](https://github.com/flowful-ai/cad-skill/blob/main/SKILL.md)

**build123d and CadQuery themselves are libraries, not skills.** Both are actively maintained: GitHub API showed build123d 3,513 stars, CadQuery 5,988, and October 23 commits. Existing build123d is the sensible choice; a new library does not solve orchestration or independent validation. [build123d](https://github.com/gumyr/build123d), [CadQuery](https://github.com/CadQuery/cadquery)

## Reliable mechanical/electrical handoff

Recommended Moki contract, derived from its requirements:

1. Electrical publishes an immutable revision with PCB outline, thickness, mounting holes, connector and component envelopes, keepouts, unit/frame definitions, board-to-product transform, source files and hashes.
2. Mechanical consumes that exact revision, generates the enclosure and saves source + STEP. A named datum identifies a mounting interface; a saved face number alone does not identify it across rebuilds.
3. Validator reopens exported files, checks units, valid positive-volume solids and expected body count, then measures contract-specific holes, passages and clearances. A plausible bounding box does not prove a USB opening exists.
4. Reject interpenetration using overlap volume; measure positive clearance separately. Minimum distance zero can mean contact, containment or overlap, so it cannot by itself distinguish them. Static fit proves only one pose, not an insertion path. [Geometry inspection reference](https://github.com/earthtojake/text-to-cad/blob/main/skills/cad/references/inspection-and-validation.md)
5. Recompute/reselect topology after every rebuild; include source/artifact hashes in each result. build123d selectors support geometry type, orientation, position and sorting rather than arbitrary list indexes. [Stable 0.13.0 selector docs](https://build123d.readthedocs.io/en/stable/topology_selection.html)
6. Snapshot iso/top/connector section; inspect the images. Export GLB from the same geometry for the web app, with explicit scale and up-axis conversion. Keep STEP for exact geometry and GLB for visual display. [Import/export docs](https://build123d.readthedocs.io/en/stable/import_export.html)

Use labeled assembly hierarchy, local coordinates and explicit transforms to make placement reproducible. Joints express design intent; a static STEP export is not a robot physics simulation or retained constraint solver. [Assembly documentation](https://build123d.readthedocs.io/en/stable/assemblies.html)

No audited option turns a vision model's opinion into electrical correctness, structural certification or manufacturing approval. Current upstream `dfm` is explicitly guided process review; `dfam-check` measures mesh printability facts with documented missing/partial checks. They are later process-specific additions, not a universal green check. [DFM skill](https://github.com/earthtojake/text-to-cad/blob/main/skills/dfm/SKILL.md), [DfAM skill](https://github.com/earthtojake/text-to-cad/blob/main/skills/dfam-check/SKILL.md)

## One bounded benchmark to run next

**Unrun protocol: “move the USB connector 8 mm.”** Use a synthetic 50 × 35 × 1.6 mm PCB with four declared mounting holes and a deliberately specified connector envelope. These are benchmark fixtures, not assumed dimensions of a real component.

For an initial measured-generation smoke test before the comparison, generate only a simple base with four standoffs and one rectangular connector passage, export/reopen STEP, and test a connector-sized solid gauge against the enclosure. Capture Python startup/import, construction, export, reimport/check, and snapshot times separately with a monotonic clock. Run once cold and three times warm, cap the whole test at 3 minutes, and retain the raw timings and actual geometry checks. That is a CAD runtime baseline, not a measurement of model thinking time or autonomous computer use.

- Same clean 2 vCPU / 4 GiB Daytona image, same model, same spec and validator for all trials. Preinstall dependencies; measure cold sandbox startup separately from warm work.
- Compare three runs of A: build123d source + CLI, and three of B: screenshot/action computer use in FreeCAD. Cap each run at 8 minutes and two repair attempts. Do not introduce MCP as a third variable in this first test.
- Each run generates a base and lid, then receives an updated connector X coordinate. Require a fresh STEP, GLB, snapshots and measured JSON report for both revisions.
- Independent acceptance: expected body count, validity/positive volume, exact requested board and hole positions, connector passage gauge clear, minimum specified PCB-to-case clearance, no unexpected overlap, unchanged mounting-hole pattern, matching input hashes, and stale prior-case/showcase rejection.
- Record wall time, model-call time/count, desktop actions, retries, export/validation time, API usage/cost if available, peak RAM and correctness. Report every failure; with three runs, publish individual results and median, not a credible p95 estimate.

Only this experiment can answer how slow Moki's computer use is in practice. A useful outcome is a measured decision about which operations deserve computer use, plus a real validated revision-update demo.
