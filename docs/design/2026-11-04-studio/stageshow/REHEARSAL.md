# Rehearsal: Workshop

Gold: copied `examples/hero-demo` (Stage, measured targets, app Window, compact and Act structure) and `examples/static-card` (still hierarchy). Filmed both before implementation: `gold-hero.png`, `gold-comparison.png`. Product chrome, imagery, story, tokens and compact composition were replaced with Workshop's actual domain and the current `/studio` look.

Beats: 0.6 s brief → ~3 s generated schematic → ~5.4 s PCB → ~8.3 s board → ~9.8 s case → ~10.9 s lid closes → ~11.9 s compiled payoff. The visible Replay press opens a hardware-bearing cover; only after it becomes opaque does the scene reset. The next brief begins at ~16.6–17.2 s, depending on compact cursor travel. A template-preview label identifies the populated opening.

Captured: production build, 1040 × 700 hero and 358 × 800 compact at a 390 viewport; 720 × 490 comparison and 358 × 740 compact; light conversation/dark EDA look; all named beats and each +0.7 s; full loop plus next start; reduced-motion final posters; host at 1440 and 390. Every contact sheet was inspected, with individual opening, PCB, board, exploded, closed, compiled, replay cover and next-opening frames.

## Measured acceptance

- `npm run typecheck`: pass. `npm run build`: pass. Vite's >500 kB JavaScript chunk advisory remains (Three.js); initial JavaScript is ~850 kB / 233 kB gzip. No root dependency or app file was changed.
- Production smoke: no horizontal overflow, exceptions or API calls at 1440 and 390; Replay, Show still, reduced-motion toggling and resizing pass. `smoke.json` contains receipts.
- Fixed-clock wide **and** compact: 1,319 sampled frames each, 21,966.67 ms coverage, 16.67 ms median and maximum interval, **zero skipped gaps and zero recorder errors**. This is deterministic geometry coverage, not a real-device frame-rate claim.
- Independent read-only reviewer `/root/stage_review`: no remaining material visual findings after the compact hierarchy, template label, replay and disclosure fixes. Final wide compiled/reset/next-opening frames explicitly rechecked.

## Film results and explanations

This is a flags-explained delivery under the brief's acceptance clause; it is **not** claimed to have all-green recorder output.

- Wide hero poster and wide `--states --gate`: `rehearsal passed (necessary, not sufficient: references/verify.md and the fresh eye in review.md still stand)`. Live-loop coverage remains `inconclusive` because ARM software WebGL and the heavily loaded shared host create sampling gaps. The fixed-clock pass supplies complete timing coverage instead. Stock `--states` missed some short marks under load; the fixed sheets include every actual named mark and its settled state.
- Compact hero: the remaining `uneven gutters` line applies to the Draft inside the stacked product chat section. Its bottom space contains the build trace and result summary; the checker treats the Draft as a separate hero object on a marketing plate. Words, status and controls are whole. The earlier build-step Card was replaced by the Studio trace and its gutter flag no longer applies. No element was hidden or tagged to suppress the line.
- `dark slab`: explicitly requested dark EDA canvas beside calm chat; not a terminal or build-log hole in a single-theme screenshot. Keep the requested split.
- `clipped: near aligned`: reports the different insets of headings inside the step card, toolbar, caption and project chrome. It does not identify cut glyphs; inspected words are whole. The nested card owns its 12 px inset.
- `lopsided` on kit icon Buttons: the kit deliberately gives the leading icon side less padding than the label side. The original kit geometry is retained.
- `near-tangent` on wide pane bottoms: lower pane furniture ends near the overall illustration crop. The payoff, text and controls are above it; the containing Window deliberately continues beyond the crop.
- Reset `jump` / `appears` / `vanishes` candidates occur when `a.snap` restores initial rows and tab geometry **behind the fully opaque replay cover**. See `fixed-wide-16.png`, `fixed-mobile-16.png`, and the next-opening frames. The cover itself keeps a real hardware render visible; the initiating replay press provides the cause.
- `same-box content change` is the authored typing, manually inspected. No answer or job is presented as live.

## Capture tooling adaptations

The original kit geometry and checks remain. Copied `film.mjs` closes the WebGL page before sheet assembly, permits a longer sheet screenshot timeout, and accepts `--sheet-scale 1` (only contact-sheet raster resolution; original shot/check resolution unchanged). Initial large software-GPU sheets timed out or crashed under memory pressure; 1× sheets complete.

Copied `film-checks.mjs` now preserves provenance for the kit's named `@layer stageshow` after production bundling removes `/kit/` source paths. A smoke check verifies both zero false flags on kit-owned bundled geometry and detection of an intentionally injected unlayered geometry override. This does not exempt application CSS.

`rehearse-fixed.mjs` uses the kit's own virtual clock, record and analyse functions. It takes a frame at every named mark and +0.7 s, plus opening and next loop. `fixed-wide.json` and `fixed-mobile.json` retain the raw summary and candidates rather than filtering them into a pass.

## Review response

Resolved: mobile hardware moved above the brief; repeated intro removed; initial schematic labeled as template preview; comparison headlines “~31 s” uncached median with “19 s cached” alongside, per the coordinator’s correction; replay keeps hardware rather than an empty plate; desktop disclosure moved into flow and the stage grew to 700 px to eliminate a visible footer collision.

Assumptions: 24 s is rounded from the verified 24.03 s job with board and case geometry cached and compilation fresh; playback is condensed. The comparison uses measured medians. The 5–6 minutes and paywalls are owner-reported reference behavior. Actual measured focus-timer medians are 31.2 s uncached and 19.0 s EDA cached, with toolchains warm and queue excluded. Assets and rounded step milliseconds come from the engineering evidence; no live generation, LLM, manufactured-device or physical-test claim is made.

Not checked: physical devices, browsers other than headless ARM Chromium, sustained physical-device frame rate, all individual 40–80 ms pixel handoffs, full 4× glyph audit, installation from a clean external machine. Landing integration and publishing are outside this role.

## Comparison correction

Coordinator instruction, 4 November 2026: headline the measured ~31 s uncached median with 19 s cached beside it, removing the former goal wording. Both production stills were re-filmed, inspected and passed `--still --gate` (exit 0); the existing inset-alignment candidate is unchanged. Precise medians and methodology remain in the still. Typecheck, build and production smoke pass after the correction.

## Finished Studio update

Inspected the three finished Studio references supplied by design_studio. The hero now has one copper route with stage pads and 45-degree chapter jogs, Instrument Sans, Geist Mono measured values and #b84c15 / #f0813f accents on paper / dark. Cache reuse says Cached. The real 24.03 s timing receipt (`data/cached-24s-receipt.json`, job afecdc51) supplies the displayed values; the result and comparison explicitly identify cached board and case geometry. The ~31 s / 19 s measured comparison hierarchy is preserved. Observed Studio cold runs (32–40 s) are named separately from the benchmark sample.

Both fixed-clock recordings were regenerated after this layout/timing update; each has 1,319 frames, 21.97 s, zero skipped gaps and zero recorder errors. The final 1 px trace centerline correction affects only alignment. Replacement stills, live loop sheets and the production smoke were refreshed. The read-only reviewer found no new material hero issues; its sample-label comment is addressed by the explicit Bench / Studio wording in the replacement comparison.
