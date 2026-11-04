# eng_core: the tscircuit pipeline, job API and benchmark

Read first: ../BRIEF.md (the contract). Then:
- /home/sogo/sogo/skills/project-build/SKILL.md (verification rules)
- src/circuit/{model,catalog,templates,graph,export}.ts
- server/workshop-api.ts (the plugin pattern)
- vite.config.ts
- evidence/coordinator-spike-board.tsx (a working tscircuit example)

## Allowed write paths
- eda/** (except eda/enclosure.ts, which eng_mech owns. You own eda/package.json and bun.lock; eng_mech may ask you for deps via requests/)
- src/board/**
- server/board-api.ts
- vite.config.ts: **only** to register the board plugin. Keep the existing diff intact.
- tests/board*.test.ts
- scripts/board-*.ts
- package.json: scripts entries only
- tsconfig.json: only if needed to exclude eda/
- docs/engineering/2026-11-04-tscircuit/{evidence/eng_core,reports/eng_core.md}

## Deliver
1. **`src/board/catalog-footprints.ts`.** Map each catalog module to a tscircuit component: footprint, pinLabels and pin order matching the catalog physical pins, plus a 3D model if one is available. Female header sockets for plug-in modules. Leaded parts (resistor, LDR, LED, piezo) as through-hole footprints or 2-pin sockets. Test the mapping: every catalog pin exists exactly once.
2. **`src/board/codegen.ts`.** A pure, deterministic function from CircuitDesign to TSX source:
   - The board outline is auto-sized from the parts, with mounting holes (M3) at the corners. The enclosure needs them.
   - Placement is sensible: the MCU on one side, the display near the top edge, the encoder near the front, the USB end of the devkit at a board edge so it can reach the enclosure wall.
   - Nets come from the design graph; net names come from design nets.
   - Silkscreen shows the part role and "moki" plus the content id.
   - Same design in, byte-identical source out (test it).
3. **`eda/render.ts`.** A Bun CLI: reads `<job>/board.tsx`, renders with `renderUntilSettled` and writes everything in the BRIEF.
   - Fab files: gerbers.zip, bom.csv and pnp.csv. Use tscircuit's own converters, e.g. `circuit-json-to-gerber`, `circuit-json-to-bom-csv`, `circuit-json-to-pnp-csv`. Check what exists and pin it.
   - receipt.json: per-stage ms using performance.now, DRC errors and warnings from circuit.json `*_error`/`*_warning` elements, board stats and exact tool versions from node_modules.
   - Exit codes: 0 means ok, 2 means DRC errors but artifacts written, 1 means crash.
   - Executing the TSX: write it to the job dir and import it dynamically. The file must default-export a component, or call `circuit.add`. Pick one convention and make codegen emit it.
4. **`server/board-api.ts`.** The job API exactly as in BRIEF:
   - queue, 120 s timeout, process-group kill;
   - cache by sha256(board.tsx + versions);
   - job dirs under var/board-jobs (var/ is gitignored);
   - job id and artifact name allowlist; no path traversal;
   - after render, run the enclosure stage (`bun eda/enclosure.ts --job dir`, owned by eng_mech; skip gracefully if it's missing) and the firmware stage (`src/firmware/index.ts` export `generateFirmware(design, jobDir)`, owned by eng_fw; skip gracefully if it's missing);
   - source jobs (edited TSX) have no design, so firmware is skipped with a note.
5. **`scripts/board-bench.ts`** (`npm run board:bench`). For each of the 3 templates: 5 cold runs (cache bypassed) and 3 cached runs. Writes evidence/bench.json with p50/p95 per stage, the machine (nproc, arch, RAM) and versions.
6. **Tests:**
   - codegen determinism;
   - footprint mapping;
   - an API test that renders a real focus-timer board end to end and asserts zero DRC errors plus all artifacts present (mark it slow if needed, but it must run in `npm test`, or name a separate `npm run test:board`);
   - path traversal is refused.

## Acceptance
- All 3 templates render with **0 DRC errors** and a routed PCB.
- `npm test` and `npm run typecheck` pass.
- bench.json exists with real numbers.
- Render PNGs of the focus-timer schematic and PCB into evidence/eng_core/, and inspect them yourself: is it readable, do the parts overlap, is it routed?
- Report in reports/eng_core.md.
