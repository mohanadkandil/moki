# Invention platform: orchestration, validation and Decisions

Architecture proposal, 24 October 2026. Nothing has been provisioned or implemented by creating these diagrams.

The editable Excalidraw board contains three views, arranged left to right: the complete product flow, one computer-use worker's execution loop, and the electrical-to-mechanical geometry contract. The accompanying HTML viewer has a tab for each view.

## Is Decisions necessary?

No. Use Responses for planning, generating the product specification, code, tool arguments and desktop actions. Keep deterministic dependency handling and engineering gates in application code.

Decisions is useful when a question has a bounded answer: route an edit into mechanical/firmware/appearance/cross-domain; classify a screenshot as working/blocked/needs-review; flag a possible mismatch between the CAD render and a marketing image. These are proposed uses that need labeled examples before thresholds can be trusted. Decisions does not design the part, invent tool-call arguments or establish mechanical correctness.

Current official documentation says the dedicated `/v1/decisions` endpoint supports `gpt-6-luna`, and returns predicate probabilities, fixed-set choices or rubric scores. Its uncached input rate is $0.10 per million tokens and output tokens are not charged; cache and regional/long-context rules still apply. This is optional optimization after the main pipeline works. [Official Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

For computer use, OpenAI distinguishes Responses generating actions/arguments from Decisions selecting among actions whose complete arguments are already known by the application. [Computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use).

## How the PCB dimensions reach the mechanical agent

1. The orchestrator creates an agreed envelope: overall limits, units, coordinate frame, board support, connector access and behavior requirements. Electrical and mechanical workers can propose changes; only the orchestrator commits shared revisions.
2. The electrical worker saves a real board artifact. An extraction tool measures its outline, thickness, hole centers/diameters, connector positions and modeled component envelopes. Source geometry and model completeness are checked. Missing component heights remain unknown and block any dependent clearance claim.
3. The tool publishes a geometry manifest referencing the board artifact's hash and its STEP model. Its contents come from saved artifacts, not the electrical agent's prose. Every output records the exact input versions it used.
4. The orchestrator publishes an event such as `pcb.geometry.updated`, with manifest URI/hash and revision. The event is a notification; the manifest and immutable artifacts are the authority.
5. The mechanical worker reads that exact revision, imports the board geometry and generates the enclosure. It records `consumed_board_revision` and the hash.
6. Cross-domain checks load both real outputs: enclosure and PCB geometry. They test modeled interference/clearance, mounting alignment and connector keepouts. Source-versus-export dimensions are checked as well.
7. If PCB v3 becomes v4, dependent enclosure, validation results, renders and launch assets become stale. The orchestrator reruns affected jobs. A release gate prevents mixing a v4 board with a v3 enclosure or old validation result.

Example only, not measurements from a real board:

```json
{
  "kind": "pcb.geometry",
  "illustrative": true,
  "board_revision": 3,
  "artifact_id": "pcb-v3",
  "artifact_sha256": "<hash computed from saved board artifact>",
  "units": "mm",
  "frame": "PCB lower-left outline origin; z=0 at bottom board face",
  "outline_bounds": {"width": 48, "height": 32},
  "board_thickness": 1.6,
  "mount_holes": [
    {"x": 3, "y": 3, "diameter": 2.5},
    {"x": 45, "y": 3, "diameter": 2.5},
    {"x": 3, "y": 29, "diameter": 2.5},
    {"x": 45, "y": 29, "diameter": 2.5}
  ],
  "component_geometry_complete": false,
  "required_unresolved_fields": ["connector keepout volumes", "component heights"],
  "source_files": ["board.kicad_pcb", "board.step"]
}
```

Bounding dimensions alone are insufficient: nonrectangular outlines, components, mounting holes, connector mating volumes and coordinate transforms matter. The example deliberately marks missing geometry as incomplete.

## What validator agents validate

- Electrical: parse generated artifacts, run schematic ERC and PCB DRC/parity checks, inspect power/part assumptions. A passing rule check is not proof the circuit physically works.
- Mechanical: valid solids, requested dimensions, wall/clearance constraints and assembly fit against the actual PCB/component models. Printing tolerances, strength and ergonomics require later validation.
- Firmware: compile the actual source, run fixed simulated scenarios, compare pins/protocols against the published electrical contract.
- Cross-domain: matching revisions, units/frames, mounts, enclosure openings, part identities and hashes. No stale validation results are accepted after dependent geometry changes.
- Showcase/marketing: check supported features and visible product identity against the current engineering revision; flag unsupported claims. A visual model's judgment is advisory, not physical evidence.

Each validator returns a machine-readable result: checker/version, input artifact hashes, test ID, pass/fail/blocked, evidence artifact and unresolved issues. The agent explains failures and proposes repairs; executable checks and acceptance rules determine the defined gate. Keep acceptance tests independent from the generating worker and require explicit test-change review.

The orchestrator receives both verdict and evidence. It schedules repair, stops a blocked job, or publishes a coherent revision. Relevant workers can run concurrently within agreed contracts; only one GUI-controlling worker acts on each isolated desktop at a time.

## Practical implementation order

Start with a typed manifest, immutable artifacts and explicit job states. Use simple dependency scheduling, not a new agent messaging network. Add desktop controls and tool scripts for two engineering roles, then validators, then the BFL showcase and launch page. Decisions can be added later for repeated classification. [Daytona controls](https://www.daytona.io/docs/en/computer-use/).

Windows desktop access, model access, simulator support and application rendering must be checked before committing the live demo to a provider. No physical build, manufacturing readiness or safety certification is established by these diagrams.
