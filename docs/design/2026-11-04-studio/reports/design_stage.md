# design_stage — Workshop Stageshow delivery

Status: delivered, 4 November 2026. Standalone demos are in [`stageshow/`](../stageshow/README.md). Production preview during handoff: **http://127.0.0.1:5188/**. No publishing or integration into `/studio`, `/lab` or the landing app was performed.

## Delivered

1. **Animated hero**, 1040 × 700 with a separately composed 358 × 800 compact view. A maker types “a focus timer with a knob and a beep”; nine recorded stages advance as pads on a routed copper trace; reused exports say Cached and other values use rounded **actual receipt durations**; the canvas goes Schematic → PCB → 3D; the generated base arrives and the lid closes around the board; **Compiled · 24 s** holds. The opening is labeled Template preview. Replay is initiated visibly and retains hardware while resetting under an opaque cover. Reduced motion and the host's Show still action show the complete result.
2. **Comparison still**, 720 × 490 and 358 × 740 compact. No competitor name appears. The owner-reported 5–6 minute / paid case / paid firmware path is compared with a **~31 s uncached median** headline and **19 s cached** beside it. Precise local focus-timer medians **31.2 s uncached / 19.0 s EDA cached** remain below.

The 24 s hero result is rounded from recorded job `afecdc51-3b01-4683-ba5f-0f1ec4510e0d`: **24.03 s with board and case geometry cached, firmware compilation fresh**. Its cache condition is visible beside the result and in the comparison. Playback is authored and condensed. The comparison headline now uses measured results only. Actual benchmark scope is five artifact-cache-bypassed subprocess runs and three EDA-cache reuse runs; installed OS/toolchain caches remain warm; queue waiting is excluded. The reference path is reported by the owner in the brief, not independently benchmarked here.

All animated progress is authored illustration. There is no LLM and no live board job behind these scenes. Demo smoke captures make zero API calls. CAD previews, approximate module bodies and compiled firmware are not printed, flashed or bench-tested hardware.

## Coordinator correction

The coordinator requested that the comparison lead with the measured result rather than the former goal. It now headlines **~31 s** with **Uncached median · Measured locally** underneath and **19 s cached** beside the headline; all goal wording was removed from the comparison and review-host caption. Precise 31.2 s / 19.0 s medians and benchmark methodology remain visible.

Both production stills were re-filmed and inspected after this correction: wide and 390 each exit **0** with **rehearsal passed**. The existing near-aligned inset candidate remains unchanged and is explained below. Typecheck, build and the production smoke checks pass. The review-host captures, provenance, README and rehearsal notes were refreshed. The independent review recorded below predates this text correction; the replacement stills were checked by the builder.

## Finished Studio alignment and cache provenance

The later design_studio handoff supplied `02-streaming-board-1440.png`, `04-done-in-case-1440.png` and `3d-exploded-1440.png`; all three were inspected. The hero now uses the finished product’s single copper trace, chapter pads and 45-degree jogs between Board, Case and Firmware, rather than the earlier boxed list. The dark tab accent is #f0813f, paper accent #b84c15, and measured values use Geist Mono alongside Instrument Sans.

The matching 24.03 s cached job was fetched read-only and preserved locally. Hero values now come from that job (including Cached labels for reused board exports), replacing the earlier cold receipt values; its 24 s result is explicitly labeled **Board + case geometry cached**. The comparison retains the coordinator’s **~31 s / 19 s cached** hierarchy, adds the cache condition to the 24 s example, and identifies **32–40 s** as observed Studio cold runs, separate from the benchmark median.

## Direction and process

Read the full brief, all four supplied competitor screenshots, fresh product-design/taste, and Stageshow's craft, looks, framing, motion, kit, rehearse, verify and review instructions. Used the requested sequence: medium → look → story → copied/filmed gold examples → screen → choreography → film and inspected contact sheets.

The current `/studio` became available during the turn. I captured and inspected [`studio-direction-1440.png`](../evidence/design_stage/studio-direction-1440.png), then mapped Instrument Sans plus Geist Mono for measured values, warm paper, charcoal canvas and **#b84c15 / #f0813f** copper on paper / dark into the demos. “Workshop” remains a neutral working wordmark. The calm conversation supports real engineering output; mobile puts hardware first rather than shrinking the desktop split.

Golds copied from `/home/sogo/.claude/skills/stageshow/examples/hero-demo` and `static-card`; kit and scripts copied with LICENSE and NOTICE. Gold captures: [`gold-hero.png`](../evidence/design_stage/gold-hero.png), [`gold-comparison.png`](../evidence/design_stage/gold-comparison.png). Existing reference screenshots were not redistributed as public demo assets.

## Real assets and provenance

- Generated schematic and PCB SVGs, plus source PNG evidence: focus-timer job `c844b276-0323-41d7-b29a-c549cdd7f4c6` / engineering `eng_core` evidence.
- Real `assembly.glb`, retrieved read-only from that job. Original base/lid geometry and modules are used. Presentation changes hide duplicate placeholder bodies, make the inspection lid opaque and animate visibility/pose; no geometry is invented.
- Engineering enclosure PNGs support the replay cover and WebGL fallback.
- Instrument Sans and Geist Mono copied from the current Studio’s self-hosted font assets.
- Cached hero timing receipt saved read-only as [`cached-24s-receipt.json`](../stageshow/data/cached-24s-receipt.json); stages, total, cache notes and compiler proof preserved. The render assets remain the engineering baseline for the same 90 × 100 mm, 11-trace / 7-via focus timer.
- Per-stage receipt, benchmark scope, token mapping and asset SHA-256 hashes: [`data-provenance.json`](../stageshow/data-provenance.json).

## Verification and evidence

| Check | Result |
| --- | --- |
| Standalone `npm run typecheck` | Pass; [`typecheck.log`](../evidence/design_stage/typecheck.log) |
| Standalone `npm run build` | Pass; [`build.log`](../evidence/design_stage/build.log); Three.js produces Vite's >500 kB chunk advisory |
| Production smoke, 1440 / 390 | No overflow, exceptions or API calls; Replay, Show still, reduced-motion toggles and resize pass; [`smoke.json`](../evidence/design_stage/smoke.json) |
| Fixed-clock wide / compact | **1,319 frames each; 21.97 s; 16.67 ms maximum interval; zero gaps; zero recorder errors** |
| Wide hero final poster and `--states --gate` | `rehearsal passed`; live timing coverage inconclusive under host load |
| Comparison still, wide / compact | `rehearsal passed`; remaining near-aligned inset candidate explained |
| Compact hero | One Draft gutter gate flag remains, explained below; no material visual finding after review |
| Review-host layout at 390 | 12 controls / 8 padded containers; `no-issues-detected`; [`host-layout-390.json`](../evidence/design_stage/host-layout-390.json) |
| CSS namespaces | No overlapping namespaces; [`class-clash.log`](../evidence/design_stage/class-clash.log) |
| Independent visual review | `/root/stage_review`: **no remaining material visual findings**, final wide seam explicitly rechecked; [`independent-review.md`](../evidence/design_stage/independent-review.md) |

I inspected the contact sheets and individual opening, PCB, bare board, exploded case, closed case, compiled, replay and next-opening frames. The original desktop footer collision, excessive mobile chat area, clipped exploded lid, ambiguous starting schematic and weak replay frame were corrected. The replay press and cover explain the reset; initial scene/cursor state is restored before the next loop.

Useful finished frames:

- Hero: [`wide poster`](../evidence/design_stage/hero-poster-wide.png), [`390 poster`](../evidence/design_stage/hero-poster-mobile.png).
- Comparison: [`wide still`](../evidence/design_stage/comparison-wide.png), [`390 still`](../evidence/design_stage/comparison-mobile.png).
- Fixed contact sheets: [`wide`](../evidence/design_stage/fixed-wide-contact.png), [`compact`](../evidence/design_stage/fixed-mobile-contact.png); coverage/candidates in matching JSON files.
- Live film: [`wide loop`](../evidence/design_stage/hero-loop-wide.png), [`compact loop`](../evidence/design_stage/hero-loop-mobile.png), [`wide states`](../evidence/design_stage/hero-states-wide.png). Matching logs preserve actual flags and incomplete live timing coverage.
- Review host: [`1440`](../evidence/design_stage/host-1440.png), [`390`](../evidence/design_stage/host-390.png).

## Remaining flags and limits

This meets the brief's **flags-explained** acceptance path, not an all-green recorder claim. Full account: [`REHEARSAL.md`](../stageshow/REHEARSAL.md).

- The compact hero's `uneven gutters` line applies marketing-object framing to the Draft inside a stacked app chat. Its bottom space contains the trace and result; side insets remain consistent. The former boxed step Card has been replaced with the Studio trace, so that Card flag no longer applies. No words or controls are cut. Independent review found no remaining material visual issue.
- `dark slab` is the explicitly requested dark EDA canvas beside calm chat. Near-alignment lines describe different nested control/card insets, not clipped words. Stock icon Button padding is retained. Low-level reset geometry candidates occur behind the opaque replay cover, not as visible scene jumps.
- Live recorder traces have sampling gaps on this memory-constrained ARM software-GPU host; the fixed-clock pass supplies complete geometry coverage. This does not establish physical-device frame rate. The ordinary states film missed short marks under load; the fixed sheets capture every actual named mark plus its settled state.
- Initial contact-sheet composition timed out/crashed under host memory pressure. Copied `film.mjs` now releases the WebGL page before sheet composition, allows a longer sheet timeout and supports **`--sheet-scale 1`** for the assembled contact sheet. Shot/check resolution is unchanged.
- Copied `film-checks.mjs` recognizes the kit's own named `@layer stageshow` after bundling removes `/kit/` source filenames. The smoke receipt proves an injected unlayered geometry override is still caught. No application rule is exempted. Exact tooling changes: [`tooling-adaptations.diff`](../evidence/design_stage/tooling-adaptations.diff).
- Not verified: physical devices, other browsers, sustained device frame rate, every 40–80 ms pixel handoff, full 4× glyph audit, WebGL-unavailable fallback execution, clean-machine installation or integration into the React 19 app. Landing integration can lazy-load the Three.js hero; local initial JavaScript is ~850 kB / 233 kB gzip, plus 2.2 MB of image/model/font assets.

## Files, ownership and actual state

Writes are confined to the allowed paths:

- `docs/design/2026-11-04-studio/stageshow/**`: standalone package/lock/config; `src/{Hero,Assembly,BuildTrace,Comparison,main,kit}.tsx/ts`, scoped and host CSS, real assets; copied `kit/`, gold examples, scripts, license/notice; `PLAN.md`, `README.md`, `REHEARSAL.md`, provenance and manifest.
- `docs/design/2026-11-04-studio/evidence/design_stage/**`: inspected images, fixed-clock frames/contact sheets, recorder JSON/logs, smoke/build/typecheck receipts and review.
- This report, `docs/design/2026-11-04-studio/reports/design_stage.md`.

Full standalone file list: [`FILE-MANIFEST.txt`](../stageshow/FILE-MANIFEST.txt). Dependencies are isolated and pinned in the standalone [`package.json`](../stageshow/package.json): React/DOM 18.3.1, Three 0.186.0, Lucide 0.468.0, Vite 6.4.5, TypeScript 5.9.3; remaining exact development pins are in the same file/lock. The root package and all app/engineering source paths were left to their owners. PROJECT.md and .sogo/project.json were not edited because this role's write boundary excludes them.

The independent reviewer rechecked the routed-trace hero and found no new material visual issues. Its comparison sample-label comment was addressed by explicitly naming Bench and Studio cold runs; the replacement stills were builder-inspected. The independent reviewer is finished; it is not a persistent background worker. A local production preview was started at 127.0.0.1:5188; this configures no persistent service. The project's existing 127.0.0.1:5173 server was not controlled or restarted. No commits, pushes, stashes, resets, publishing or outreach.
