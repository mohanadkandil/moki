# RP signal escapes: review, GPIO handoff and source-marker integration

Reviewed complete `eda/blocks/rp-signal-escape.ts` and `tests/blocks-rp-signal-escape.test.ts`, plus phase integration in `build.ts`, DRV selector output, the canonical source binder and official native checks. Original signal-source SHA256 `3adb751fe6363dba0caf19a04f98760a8d3e7b0385206b7c9a0dd5ec8cdfa1b6`; original six tests passed. Review began read-only; root then explicitly assigned the narrow physical17/18 and source-marker fixes to this reviewer. Gndworker owns independent re-review of the final marker changes. No native router or compile was run here.

## Independent review evidence

The helper was already generalized to actual connected perimeter pins1–56, with verified0.2×0.85mm native rectangular land geometry, canonical source/pin/port membership, cardinal pad-normal directions and explicit native clearance checks. Its ten current outputs were fixture usage, not a ten-pin whitelist. A derived electrical connection on the real previously-unused GPIO1/GPIO2 (physical3/4), leaving all part/geometry/catalog records unchanged, produces12signal stubs and no uncovered critical net. See `signal-review-probe.{ts,json}`.

IN1/IN2 exclusions are backed by actual DRV output: U5.16producesIN1 andU5.15producesIN2. Root merges DRV9, RP power14 and RP signals10 into the same native saved fanout phase2; `selectRpCriticalSignalNets` then returns an empty set. Independent official trace/pad/via/drill checks on the complete actual fixture's38fixed paths (including5clock paths) return **zero errors**. No source identity bypass or DRC relaxation was found in that current motor-board flow.

The physical GPIO14/GPIO15 pins17/18 did retain a broader capability restriction: their0.925mm outward normal collided with XIN, and a non-DRV application had no approved other-phase exclusion. Merely skipping a failed path would not establish native phase ownership. Root authorized a shorter native handoff instead.

## Physical17/18 correction

When no other approved phase owns their nets, physical17/18 now emit a **0.20mm,0.15mm-wide two-wire native handoff wholly inside their existing actual pad copper**. It is explicitly tagged `inside-pad-handoff` in the diagnostic audit; it is not claimed as an off-pad escape and grants no via-in-pad permission. An erosion/containment check includes the entire endpoint trace cap. No outside copper, net change or reduced width is introduced.

The normal native saved-fanout binder (`createNativeFanoutPhase`) accepts both handoffs without a bypass. Installed native saved-path source requires distinct wire points and a real starting port; it imposes no off-pad endpoint requirement for an open fanout exit. No native render was used to claim acceptance. The native follow-up remains responsible for finding the actual breakout and all final clearance rules still apply.

Seven signal tests pass (~10.47s), including the actual12-selector set without DRV exclusions, all cardinal placements on2/4layers, source/foreign-geometry mutants and explicit rejection of the old long0.925mm17/18candidates against unchanged clock copper. The existing motor path still respects actual DRV-net exclusions and emits ten RP signal handoffs/stubs.

## Post-DRC marker truth

A pure installed-native check revealed an integration issue: `checkEachPcbTraceNonOverlapping` attaches an own-pad `end_pcb_port_id` when a handoff endpoint lies in a land, even though it is0.20mm away from that port's center. Source proof previously required all marked points to match a port center, so a valid handoff would pass pre-pour proof but fail the final post-DRC recheck.

Root authorized a narrow correction in `repair-native-exits.ts`. A private contained-handoff proof is derived from **the literal two-wire prefix and the same canonical actual SMT rect/rotated_rect**. Both full trace caps must fit in that rectangle, which proves the whole convex capsule fits. No audit flag or `kind` field is trusted. Prefix starts retain their strict canonical center binding; only the exact literal own-pad endpoint may carry an offset end marker.

For an MST between two proved exits, an offset marker is allowed only at an already-proved **literal captured handoff endpoint**, with that same canonical port and full current trace cap inside its actual pad. Captured point IDs/coordinates/layer, source net, width bounds, via/barrel proof and other physical marker checks remain unchanged. Wrong/foreign markers,0.001mm shifted endpoints/captures, oversized trace caps and even synchronized props+audit+serialized route/captured endpoints moved outside the eroded pad all reject. No geometry, source records, existing errors or DRC values are changed.

Source-helper test16 exercises actual official native marker insertion, a saved prefix plus a mixed top→bottom MST joining that handoff to another via exit, rotated rectangular copper and the negatives above. All16source-helper tests pass (~1.84s); strict TypeScript for both helpers passes. `signal-review-handoff.{ts,json}` independently derives the actual26prefix case: source proof passes before and after native-generated RP17/18offset markers. This is derived native serialization, not a new whole-board route receipt.

Final frozen source hashes:

- `rp-signal-escape.ts`: `da8eb6f472016b263bbb87208e945032895b3ebf45cda8ba10f6e69353a9dae9`.
- `repair-native-exits.ts`: `47013c9aaa9978d26f5e71b62c586f72fe9a1b18fab01c2262af82d2ad8b94b7`.

Root owns the full42-prefix-plus-clock native replay and final board acceptance. These pure checks establish the handoff and attribution contracts, not that arbitrary future layouts will route. Frozen RP clock/power escape sources and block revisions were not changed during this narrow work.

Independent re-review receipt: gndworker reviewed frozen source `47013c9aaa9978d26f5e71b62c586f72fe9a1b18fab01c2262af82d2ad8b94b7`, found no blocker, and reported22combined tests plus an independent strict TypeScript pass. Its separate actual BOOTSEL R2.2probe confirms the post-native-check own marker; synchronized outside endpoints with a forged audit flag, oversized caps, coincident same-net other-pad markers, unsupported pill geometry and wrong layers reject. This receipt concerns the marker/source proof and does not replace root's native board gates.
