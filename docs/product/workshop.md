# Workshop implementation

Verified locally on 24 October 2026.

Every landing submission creates a unique persisted project and opens `/workshop/<project-id>`. The server generates the initial project title and acknowledgment through OpenAI. There are no fabricated engineering chat results. Four BFL inspiration images are generated before engineering; the user selects one and explicitly continues. Saved project IDs isolate repeated briefs.

The current run performs electrical physical planning, writes and reopens a KiCad PCB outline, transfers measured dimensions/hole positions with an artifact hash, generates prompt/image-guided build123d source in Daytona, exports STEP and GLB, and independently reopens the STEP to check solids and dimensions. Actual KiCad and FreeCAD documents are displayed on their desktops. New runs open fresh empty Moki-owned workspaces, preserving previous artifacts and keeping the VMs running.

The Product view offers actual generated CAD, the selected BFL reference and a measured board-outline view. Showcase offers a ten-second BFL film based on the selected image. The film is not CAD-grounded. Checks and files are secondary controls; fresh read-only desktop frames open from electrical/mechanical stages. Warm white, charcoal, Manrope and restrained blue accents carry the landing design into the workspace.

## Electronics gap

The current electrical output is an outline with mounting holes. It has no functional schematic, selected component BOM, net connectivity, placed components, routed circuit or firmware. Geometry checks do not establish electrical correctness or real component fit. Manufacturing release remains blocked, and the UI states that a design study was generated.

The intended functional path is:

1. Requirements, power budget, exact components and datasheets.
2. Schematic, footprints and independent connection review; run ERC.
3. Update PCB from the schematic; place components and route copper.
4. Run DRC and schematic/PCB parity checks; resolve findings.
5. Export populated board geometry and verify enclosure clearances, connectors and mounting positions against the same revision.
6. Generate Gerbers, drills, BOM and placement files after checks. Build and test a physical prototype before claiming operation.

Mechanical exploration can proceed in parallel, but final fit must use actual component and PCB geometry. KiCad's [workflow documentation](https://docs.kicad.org/9.0/en/getting_started_in_kicad/getting_started_in_kicad.html) and [CLI reference](https://docs.kicad.org/9.0/en/cli/cli.html) describe schematic-to-PCB transfer and ERC/DRC tooling. ERC/DRC alone do not prove functionality.

## Persistence and recovery

Local `var/projects`, `var/inspirations` and `var/runs` retain project metadata, direction images, stage events, reports and downloads. Server-side lookup restores the latest run without depending on browser storage. Existing inspiration sets are reused on reopen rather than generating new paid images. Interrupted runs are marked as interrupted after server restart. This is a local file store, not a deployed database.

The landing page polls real project summaries and links back into saved workshops. Artifact downloads are allowlisted per manifest; PCB filenames containing underscores are supported and use attachment headers.

## Reliability verification

A saved run reproduced a whole-root React crash when measured hole objects were rendered as a React child. The UI now renders their count, including legacy numeric reports; SSR regressions cover both. An app error boundary retains a recovery path if a different render fails.

StrictMode also exposed shared Three.js loader cancellation: cleanup from one mount aborted another mount's request. Each ProductScene now owns its fetch and cancellation. Actual GLB rendering, repeated mounts, missing/malformed files, unavailable WebGL and context-loss fallbacks were exercised.

The exact reported workshop, saved artifact bytes, board view, showcase video and downloads were checked against local generated files. An HTTP regression covers the real API route for `board.kicad_pcb`, exact download bytes and missing/unpublished artifacts. No additional paid design runs are required for these regressions.
