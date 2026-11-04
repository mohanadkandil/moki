# Reviewed source coverage

The scope is the current working tree plus retained review/fix/realism evidence, over commit 8f08c3b. Untracked feature files prevent a trustworthy exact first-review Git diff. This is not a claim that every unrelated repository file was read.

Complete source reads (some delivered in separate adjacent chunks):

- `server/board-api.ts`, `src/board/process.ts`, `vite.config.ts`.
- `/home/sogo/projects/sogo-apps/src/{moki,auth,app,runtime,types}.ts`; versioned `integration/moki.service`.
- `src/board/{codegen,bom,catalog-footprints,preview-model}.ts`; `eda/{render,versions}.ts` and EDA package version manifest.
- `eda/models/{catalog-models,catalog-models.test,render-board,compact-glb}.ts`.
- `eda/enclosure/{handoff,module-mech,module-preview,assembly}.ts`; `eda/enclosure.ts`.
- `tests/{board-connectivity.py,board-routing.test.ts,board-models.test.ts,board-security.test.ts,board.test.ts,firmware-display.test.ts,enclosure.test.ts}`.
- `src/firmware/index.ts`.
- `web/src/board/{logic,base,api}.ts` (API read covers fetch/poll/settlement and artifact-hook behavior).
- `web/src/studio/{facts,parts,stageScene}.ts`, `{Canvas,Studio,CodeTab,FirmwareTab,ModelPane,DrawingPane,PcbPane,CaseTab}.tsx` (ModelPane remaining camera/lift utilities were dependency reads; not every final helper was independently reproduced).
- Root package scripts and first-review/fix-round/realism briefs/reports, including fix_ui at its design-report path.

Focused/excerpt reads and rendered evidence:

- `mech/enclosure.py`: rounded-outline recognizer, cavity/shell/lid use and report consumers; other mechanical behavior checked via retained report and fresh targeted geometry test.
- `mech/tests/test_enclosure.py`: rounded-outline fixture/probes, test setup and coverage inventory.
- `eda/enclosure/enclosure.test.ts`: outline-handoff test and fit/opening dependencies.
- `/home/sogo/projects/sogo-apps/tests/run.ts`: Moki auth/proxy/allowlist/lifecycle/readiness cases and retained controlled receipts; no new HTTP fixture server run.
- `src/firmware/programs.ts`: display helper and generated timer/lamp/temperature behavior, with particular attention to changed strings and redraw/polling; retained firmware regression logs.
- `src/circuit/templates.ts`, `web/src/circuit/CircuitLab.tsx`: assigned OLED warning and stale-copy corrections.
- `web/src/studio/studio.test.ts`: facts/claims and new output-label test coverage; whole UI/board-web suite executed.
- UI CSS/Chat/Rail/state behavior primarily assessed from retained screenshots, reports and call sites, not an exhaustive CSS/style audit.
- PROJECT.md and .sogo/project.json read for current handoff and separation of production/dev roots; no changes made.
- Final jobs referenced by real_models measurements: circuit/design/metadata, receipts, handoffs, enclosure reports, board and assembly GLBs, ZIP hashes/contents. Raw final GLB position data was inspected and exact KiCad ZIPs replotted.

## Applicable checklist disposition

- Runtime/errors: timeout settlement and terminal publication examined; false Code success identified.
- Interfaces/compatibility: rounded handoff, assembly metadata, mask names, artifact/cache lists and KiCad syntax examined.
- Performance/resources: compact GLBs measured; production cache-eviction defect identified; SwiftShader no-hitch evidence is insufficient.
- Injection/XSS: generated TSX quoting and artifact output paths examined; SVG rendered as images. Arbitrary owner TSX remains an explicitly permitted execution boundary, without a sandbox.
- Authentication/authorization: API capability and gateway session gate, route/method allowlists and one-owner shared jobs examined. No second-user isolation is claimed.
- CSRF/session: original mutation Origin and gateway cookie/HMAC checks examined; no live session acquired.
- Races/lifecycle: locks, stale takeover, close/abort, terminal refresh and existing regressions examined; no live restart performed.
- Cryptography: fixed-size SHA-256 timingSafeEqual capability comparison and gateway session signatures inspected; no secret values read.
- Information disclosure: traversal/symlink guards and preview source/workshop exclusions freshly checked; owner-code filesystem reach is deliberate and disclosed.
- Business logic: history rerun can use a different revision; source badge can invent success. Other DRC/compile/timing claims traced to JSON fields.
- Physical/fabrication acceptance: prior KY-040 measurement and fab-upload prerequisites remain open; no fresh manufacturing assertion.
