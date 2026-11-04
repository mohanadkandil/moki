# design_studio report: `/studio`

The Studio is built and works against the live board API at `127.0.0.1:5173/studio`. A typed brief streams the real pipeline stages, and the outputs land in Schematic, PCB, 3D, Case, Firmware and Code tabs. `/lab` is unchanged.

**Two things need the coordinator's attention:**
- **The ~25 s claim is too low for cold builds.** Measured here, a cold focus-timer build takes 32–40 s, and a cache hit takes about 18–26 s. See Speed below.
- **The "moki" name still appears in the outputs.** It's embossed on the case and appears in the PCB silkscreen and firmware comment. Those belong to eng_mech, eng_core and eng_fw.

## Design direction

**The idea:** you read on a calm bench and look at a dark canvas. A person types into a warm paper panel, and the work appears beside it on a near-black EDA canvas.

**Why two tones and not all dark (the designer's call the brief asked for):**
- heypcb is all black with white pill tabs, so a full-height light and dark split is what keeps this from reading as a clone, even as a thumbnail.
- The chat is reading material and the audience is makers, so it benefits from being light.
- PCB and 3D output needs a dark surround. The schematic stays a light sheet on the dark canvas.

**The memorable element: the run is a routed trace.**
- Each stage is a plated pad on one copper line, and the line takes a 45° jog between the Board, Case and Firmware chapters.
- The line lights up as stages finish, and the running segment marches.
- When the build lands, the trace folds to three pads with their times, so the closing message stays in view.
- It's specific to this subject and uses the one accent colour. It replaces a stack of identical cards. Only the running step is lifted onto a raised card.

**Taken from heypcb and v0:** chat beside canvas, tool cards, floating rail, status strip and the honest "remaining qualifications" list.

**Done differently:**
- Full-height two-tone columns rather than one black shell.
- Underlined tabs on the canvas side rather than white pills.
- A single rail rather than two.
- A quiet Download button.
- "Checked in software" and "Not proven" as two separate lists.

**Decisions, all in `web/src/studio/studio.css`:**

| Area | Decision |
|---|---|
| Brand layer | The first block of `.st` holds fonts, wordmark weight and accent tokens, and `WORDMARK` in `conversation.ts` holds the name. A chosen identity changes those two places. |
| Type | Instrument Sans for UI, Geist Mono only for code, identifiers and file names. Both self-hosted. Upright only. One large type size per view. |
| Colour | Warm paper neutrals, graphite neutrals, and one copper accent. Green, amber and red mean status only. No violet. |
| Layout | 400 px chat, fluid canvas, 52 px bar, 30 px status strip, 312 px inspector on Case and Firmware. |
| Motion | 260 ms rise for new turns, marching dash on the running trace, 620 ms exploded view with the camera following. All of it respects reduced motion. |

Stageshow's craft rules applied: one neutral family per side, status colours kept to status, depth from surface steps on dark, icons from one set (lucide, already in the repo), no sparkles, no invented logo, plain text wordmark.

## What was built

- **Chat:** the brief as a message, a line saying how the rules read it, real stage rows with status, ms and expandable details, a closing summary and a composer.
- **Follow-ups:** these go through the existing rule-based interpreter, read together with the earlier brief. There is no LLM, and the composer says so ("Read by rules, not an AI model").
    - Out of scope: "add a motor" is refused with the interpreter's reason.
    - No effect: "remove the knob" reports "That didn't change the design, so nothing was rebuilt", and no job is created.
    - Ambiguous: "a timer and a lamp" offers both templates as buttons.
- **Top bar:** project and template, six tabs, proof pill, History, Re-run, and Download (all files as a zip built in the browser, or one at a time).
- **Tabs:**
    - Schematic: pan, zoom and grid.
    - PCB: the real tscircuit viewer.
    - 3D: Board, In case and Exploded, with lid solid, see-through or off.
    - Case: dimensions, openings (selecting one marks it on the model), printing details and files.
    - Firmware: `main.cpp`, `pins.h`, `platformio.ini`, flash and RAM meters, and pins.
    - Code: editable `board.tsx`, which re-renders as a real job.
- **Status strip:** mm, DRC, traces routed and unconnected, board size, total job time, cache hit or miss.
- **Session:** survives a reload. `?job=<id>&tab=` links open a specific build.
- **Mobile:** Chat and Board switch, a stacked inspector, and job time first in the status strip.

## tscircuit viewers: what I tried

All tried first in an isolated scratch project with the root's React 19.3.1, Vite 8 and npm 9.2.0, then against our real `circuit.json`.

| Viewer | Result | Used? |
|---|---|---|
| `@tscircuit/pcb-viewer` 1.11.445 | Installs with `--save-exact` and no flags, and renders our real board. Its default WebGPU renderer fails with "No WebGPU adapter available" in headless Chromium, so I force `renderer="canvas"`. | **Yes**, lazy-loaded (1.76 MB chunk). Falls back to `pcb.svg` if it throws. |
| `@tscircuit/schematic-viewer` 2.0.107 | Default install pulls in `tscircuit` as a peer, 330 more packages (897 MB `node_modules` in scratch), and nests React 18.3.1. The page crashes with `Cannot read properties of null (reading 'useMemo')`. With `--legacy-peer-deps` it fails on a chain of missing or drifted peers: `circuit-json-util` export, then `format-si-unit`, `zod`, and `circuit-json-to-connectivity-map`. I stopped there. `resolve.dedupe` in `vite.config.ts` might fix the React crash, but I didn't try it: that file is outside my paths, and it wouldn't remove the install size. | No. Schematic uses the generated SVG with our own pan and zoom. |
| `@tscircuit/3d-viewer` 0.0.640 | `ERESOLVE`: it pins peers to exactly `react` and `react-dom` 19.1.0, and the root has 19.3.1. Not installed. | No. 3D uses our own three.js pane, which In case and Exploded need anyway, since they use `assembly.glb`. |

**New dependency:** `@tscircuit/pcb-viewer` 1.11.445, exact, no `--legacy-peer-deps`. It adds 101 packages. `package-lock.json` gains their entries. The lockfile diff also shows `buffer@5.6.0` moving position, with its version unchanged.

## Acceptance

| Check | Result |
|---|---|
| `npm run typecheck` | Pass (`evidence/design_studio/typecheck.log`) |
| `npm run build` | Pass (`build.log`) |
| Studio tests | 13 of 13 pass (`studio-tests.log`). Run with `npx tsx --test web/src/studio/studio.test.ts`. The `npm test` glob doesn't include this folder, and `package.json` scripts are outside my paths. |
| Related tests | `tests/circuit.test.ts` and `web/src/board/logic.test.ts` pass together with the Studio tests, 47 of 47. I didn't run the full `npm test`. |
| Real end-to-end use | Typed briefs against the live dev server, stages streamed, jobs confirmed through the API. UI totals match `job.totalMs` (`flow-results.json`, `final-checks.json`). No console errors in the browser runs. |
| Templates | Focus timer, night lamp and temperature monitor all built for real. |
| PCB rail | Top and Bottom change the real viewer's layer. Zoom changes its canvas. Fit remounts it. |
| Download | The 16-file zip opens and passes a CRC check. |
| Failure states | Checked on real jobs: 68 DRC errors, a failed firmware stage, a job dead on arrival, and broken TSX (shown as "board.tsx line N" with the full error behind a disclosure). |
| Screenshots | 1440 and 390 of the chat and each tab, inspected by me. Also a 1100 width check. No horizontal overflow at 390 or 1100. Reduced motion and arrow-key tab navigation checked. |
| `/lab` | Still loads its own UI. No edits under `web/src/circuit` or `web/src/board`. Studio imports `api`, `logic`, `zip` and `types` from `web/src/board` read-only. |

`App.tsx` gained only the route and a "Studio" link in the landing nav.

## Speed

These are single runs on this shared arm64 server while other agents were working, so treat them as a range, not a benchmark.

| Build | Measured total |
|---|---|
| Cold (board cache miss), focus timer | 32.2 s, 33.5 s, 39.6 s |
| Cold, eng_core's bench (`docs/engineering/2026-11-04-tscircuit/evidence/bench.json`) | p50 31.2 s, p95 32.2 s |
| Board and case geometry from cache, compile fresh | About 18–26 s |
| Edited TSX, cached, no firmware | 1.1–1.3 s |

**The brief's "about 25 s" and the demo's "24 s" match a cached build, not a cold one.** A first-time brief is closer to 32 s. That's still far ahead of 5–6 minutes, but any public claim should use the cold number or say which it is. I told design_stage.

The job total excludes queue time. When a build waits behind another by more than 2 s, the chat says how long (measured in the browser).

## Gaps and known limits

- **Stages land in batches.** Render, route, svg, gltf and fab arrive together, as do firmware and compile. The chat shows these as one running step ("Render, route and export the board") rather than faking a tick for each. It updates by itself if the server starts streaming. Request 1.
- **The pill says "DRC 0 errors", not the brief's "DRC clean".** Every build reports 19 warnings, so "clean" would overstate it. It switches to "clean" at 0 warnings. Coordinator's call. Request 6.
- **Re-run usually hits the cache,** because the POST route can't bypass it. Request 2.
- **Follow-ups can't override an earlier value.** "Make it 30 minutes" after a brief that says "25 minutes" is refused with the reason, and "Edit the brief" is offered. Request 4.
- **The interpreter's wording is patched at display time.** Its "wiring preview" notes are false here, so `/studio` rewrites them. Request 3.
- **"moki" is visible** on the case, in the silkscreen and in a firmware comment. Requests 5 and 7.
- **PCB viewer limits:**
    - It has no zoom or layer API, so the rail sends it synthetic wheel, mouse and key events. The version is pinned, and I tested this on that version. An upgrade could break it.
    - Layer buttons switch the active layer rather than hiding one. Its layer choice can drift from the rail if someone uses its own toolbar.
    - Its canvas looks soft at 2× device scale.
    - Its toolbar's ruler glyph rendered as an empty box in headless Chromium. That's probably a missing emoji font, not checked on a real browser.
    - Its black and green look is tscircuit's, not restyled.
- **Measure and rats nest** come from that viewer's own toolbar, not the rail. There's no grid toggle on the PCB tab because the viewer hardcodes its grid. Schematic has no measure tool.
- **Opening markers** were checked by eye for USB only. The generator's "front wall" faces away from the default camera, which is correct but may surprise someone.
- **Tested in headless Chromium only,** with mobile emulated. No Safari, Firefox or physical phone. WebGL ran on SwiftShader.
- **Some screenshots predate the last small label and stacking fix.** I recaptured the frames that fix affected. The others are visually the same.
- **No taste entries were written.** The skill makes the coordinator the preference writer. Nothing here is owner-approved yet.

## Files

**Created:** `web/src/studio/`
- `Studio.tsx`, `Chat.tsx`, `Canvas.tsx`, `Rail.tsx`, `PaneState.tsx`
- `DrawingPane.tsx`, `PcbPane.tsx`, `ModelPane.tsx`, `CaseTab.tsx`, `FirmwareTab.tsx`, `CodeTab.tsx`, `CodeView.tsx`
- `facts.ts`, `conversation.ts`, `archive.ts`, `highlight.ts`, `studio.test.ts`, `studio.css`
- `fonts/instrument-sans-latin.woff2`, `fonts/geist-mono.woff2` (copied from `docs/strategy/brand-directions/`)

**Edited:**
- `web/src/App.tsx`: route and link only.
- `package.json`, `package-lock.json`: the viewer dependency only. Other agents' uncommitted changes in these files were left alone.

**Docs:**
- `docs/design/2026-11-04-studio/reports/design_studio.md`
- `docs/design/2026-11-04-studio/requests/design_studio-to-eng_core.md`
- `docs/design/2026-11-04-studio/evidence/design_studio/`

Nothing was committed, pushed or published.

## Where to look first

In `docs/design/2026-11-04-studio/evidence/design_studio/`:
- `02-streaming-board-1440.png`: mid-run, with the trace and running step.
- `04-done-in-case-1440.png`: finished, with the summary and the case.
- `3d-exploded-1440.png`, `3d-lid-see-through-1440.png`, `case-opening-marked-1440.png`
- `05-refused-out-of-scope-1440.png`, `06-no-change-1440.png`, `state-drc-errors-68-1440.png`
- `mobile-streaming-390.png`, `mobile-chat-done-390.png`, `mobile-3d-exploded-390.png`
