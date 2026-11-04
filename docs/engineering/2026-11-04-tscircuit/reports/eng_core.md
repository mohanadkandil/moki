# eng_core — pipeline/API acceptance report

Software acceptance collected on 4 November 2026. All 3 templates have routed 2-layer carrier boards with **0 reported DRC errors**, native enclosure files and genuinely compiled firmware. **24 benchmark jobs / 384 artifact entries** passed integrity and content checks. No hardware operation, fabrication, print or flash is claimed.

## What works

- `src/board/codegen.ts`: pure deterministic CircuitDesign → editable default-exported TSX. Canonical ordering, collision-free net names, quoted text safely encoded, literal catalog physical pin coordinates, all 9 module mappings, auto-sized board, four M3 holes, edge USB placement and role/content silkscreen.
- Board GLB and enclosure share `eda/enclosure/module-preview.ts`: socket/spacer/body/shaft geometry agrees. Actual focus job shaft and opening both measure **(13.2, −25.3) mm**, checked within 0.001 mm. These remain illustrative estimated models.
- Isolated exact-pinned Bun toolchain generates circuit JSON, schematic/PCB SVGs, populated GLB, Gerber+Excellon ZIP, BOM with component values/footprint identity, PnP and measured receipts. Responsive SVG viewBox added. Exit 0 = no reported DRC errors, 2 = DRC errors with artifacts, 1 = failure.
- Queued job API with UUID/artifact allowlists, traversal/symlink refusal, bounded binary-safe UTF-8 request parsing, same-origin browser writes, hashed no-store downloads and process-group kill at the 120 s render limit. Failed/restarted jobs remain explicit. `drc.checked` distinguishes an unrun check from a completed check. Existing Vite diff preserved; board plugin precedes workshop's catch-all API.
- Cache identity includes source SHA256, exact EDA versions, lock hash and renderer hash. Cache reuse records actual copy time and explicitly skipped reused stages. Worker-start version snapshots prevent attributing results to a tool install completed during execution.
- Enclosure wrapper invoked once: handoff → Python build123d → assembly, with STEP download and native/fallback identity retained. Mechanical cache is reported separately. Trusted firmware worker calls eng_fw's generator/compiler; source-only edits explicitly skip firmware rather than inheriting a pin map.

## Measured performance

Final `evidence/bench.json` generated 2026-11-04T12:07:05.664Z. Machine: **8 × Neoverse-N1, Linux ARM64, 15.2 GiB RAM**. Five cold and three cached jobs per template. Cold runs bypass EDA reuse and use a fresh job-private mechanical cache; installed OS/package/toolchain caches remain warm. Cached runs reuse EDA and may reuse mechanical output; **firmware is freshly compiled in all 24 jobs**. Total excludes queue waiting. p95 uses nearest rank, so with these sample counts it is the observed maximum.

| Template | Cold p50 / p95, seconds | Cached p50 / p95, seconds |
|---|---:|---:|
| focus-timer | 31.24 / 32.22 | 19.04 / 19.13 |
| light-lamp | 25.80 / 27.41 | 12.47 / 13.68 |
| temp-monitor | 31.69 / 34.02 | 19.11 / 19.55 |

Per-stage p50/p95 and raw receipts are in the benchmark JSON. Cold focus/temp jobs slightly exceed the nominal “about 30 s” target; no fixed sub-30-second guarantee is claimed. Most remaining time is firmware compilation and native Python model startup. Cached totals still include real firmware compilation.

Final routed counts: focus **11 traces / 7 vias**, lamp **7 / 0**, temperature **9 / 5**. All 24 enclosures use build123d without fallback. Every base/lid has zero boundary and non-manifold edges; every STEP reopens as two valid solids. Final meshes: base 11,024 triangles; lids 5,742 / 3,656 / 5,486 for focus/lamp/temp.

Key versions: Bun 1.4.4; tscircuit 0.0.3075; core 0.0.2266; circuit-to-svg 0.0.455; circuit-json-to-gltf 0.0.164; Gerber/BOM/PnP converters 0.0.122 / 0.0.28 / 0.0.21; build123d 0.13.0; PlatformIO 6.1.19; official espressif32 6.10.0 with Arduino 2.0.17 and Xtensa 8.4.0. Full direct/transitive tool identity is retained in receipts and the lockfile.

## Verification and reproduction

```
(cd eda && /home/sogo/.bun/bin/bun install --frozen-lockfile)
npm run dev
# POST {design:CircuitDesign} to /api/board/jobs; poll returned jobId.
npm test
npm run typecheck
npm run test:board
npm run board:bench
python3 docs/engineering/2026-11-04-tscircuit/evidence/eng_core/verify-bench.py
/home/sogo/.bun/bin/bun test eda/enclosure/enclosure.test.ts -t 'shared module geometry'
# Raw EDA CLI:
/home/sogo/.bun/bin/bun eda/render.ts --job var/board-jobs/<uuid>
```

- Final `npm test`: **61/61 passed in 45.57 s**, including real focus job/API/queue/cache/downloads, rendered net membership, all catalog pin mappings, deterministic codegen, quoted TSX/net collisions, split UTF-8 upload, genuine out-of-board DRC with artifacts, timeout, traversal/cross-origin refusal and edited-source failure recovery. Includes the UI logic tests requested by eng_ui.
- Root/web typecheck: **passed**, final command exit 0.
- Shared model geometry tests: **3/3 passed**. Real Vite plugin registration smoke: HTTP 200 job list from an ephemeral loopback server, then server closed.
- `evidence/eng_core/bench-artifacts.json`: **24 jobs / 384 artifact entries passed**, hashes/bytes, GLB headers, ZIP CRCs, Gerber drill files, firmware project contents, compiled receipts, BOM values, routing, native CAD/STL validation and actual cold mechanical cache misses.
- `artifact-check.json` records a complete current focus job, including shared shaft alignment. Its job is `c844b276-0323-41d7-b29a-c549cdd7f4c6` under `var/board-jobs/`.
- `focus-schematic.png` and `focus-pcb.png` inspected directly: readable separated schematic symbols, non-overlapping module outlines, routed copper on two layers, vias and four corner holes. Their embedded SVGs are byte-identical to the final job's SVGs. Review HTML, source, JSON, BOM and PnP snapshots are retained beside them.

## Known limits and retained failures

All footprints preserve the catalog's explicitly approximate physical coordinates. None has an independently measured fit; **every module is flagged**. Leaded-part silkscreen outlines still follow the wiring sketch rather than the actual body. Generic-chip pin/courtyard/sheet warnings are retained. Zero reported software DRC errors are not an electrical simulation, independent manufacturing review or proof of physical operation. The ESP32-S3/GC9A01 variant remains next, outside this scope.

Edited TSX is bounded by a subprocess and timeout, **not an OS permissions sandbox**; it can access the local account's files/network. This remains a trusted local developer prototype. No paid model calls, purchases, publication, git commits/pushes/stash/reset or contact with people occurred.

An earlier firmware compile timed out under severe shared-host load (>50 load average, exhausted swap); its genuine receipt is retained as `host-pressure-firmware-build.json`. An earlier full test missed the cache while dependencies changed mid-run; retained as `npm-test-during-install.log`. Final serial benchmark and tests passed. `bench-before-shared-model.json` is an earlier batch preserved for provenance; use **evidence/bench.json** for final measurements. No ADR written.

Coordinator owns independent engineering review, diagrams and PROJECT.md/.sogo/project.json updates. That review is not claimed by the implementer. No subagents were spawned by eng_core. Herdr was unavailable in this process; coordination used authorized request files. No persistent worker or server was started by eng_core.

## Files changed by eng_core

- `src/board/{model,catalog-footprints,preview-model,codegen,firmware-worker}.ts`
- `server/board-api.ts`
- `eda/{render,versions}.ts`, `eda/{package.json,bun.lock,README.md}` (eng_mech also added its two exact direct dependencies)
- `tests/board.test.ts`, `scripts/board-bench.ts`
- `package.json`: scripts only; `vite.config.ts`: board plugin import/registration only
- `requests/eng_core-to-*`, `evidence/eng_core/**`, `evidence/bench.json`, this report

Existing unrelated dirty work preserved. `eda/enclosure.ts`, `eda/enclosure/**`, mech/** and firmware implementation files belong to teammates and were not edited by eng_core.
