# Live RP2040 degree-unit failure

Original production job: `c78fa2da-cfdc-487b-9b2f-9bf2b5044a6c` in `var/board-jobs-app`. Placement rejected the actual importer output `pcbRotation="180deg"` because the footprint walker used its length parser for rotations.

Actual part: `button.SW1`, rendered as **SW3**, **E-Switch TL6340AF160Q / C4944967**, receipt `sha256:5cac0bf1c7ae18b6773c71e6fc1d2d0b52c276a0a869fce015d2e9c472db8b77`. Both mechanical plated holes carry that rotation. The regression fixture is the full captured footprint tree from the verified, pinned importer; it was not reconstructed by hand. `capture-angle-footprint.ts` records its provenance.

`legalize.ts` now has a separate finite degree parser for imported `pcbRotation`, `ccwRotation` and `ccw_rotation`, including nested transforms. Numbers and strings with `deg` are accepted. Bare numeric strings, lengths, radians, malformed/non-finite values and explicit null reject. The existing length parser is unchanged and still rejects `deg` in widths, heights and coordinates. The public plan's numeric pose contract is unchanged.

Three new regressions use the actual footprint, test every alias/non-square rotated bounds and nested transforms, and retain strict length rejection. All18 focused tests pass; see `targeted.tap` and `regression-result.json`.

The replay copies the **exact original plan**, checks deep equality against the live job input, reuses its existing valid schematic-review receipt and submits directly to the real job service. No model agent, HTTP server, new review receipt or plan rewrite is involved. `source.json` pins the original plan SHA and confirms zero model calls; `job-id.json`, `job.json` and `replay.log` record the native result.

Reproduce:

```sh
bun eda/blocks/replay-job-evidence.ts var/board-jobs-app/c78fa2da-cfdc-487b-9b2f-9bf2b5044a6c docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-live-angle 600000
```

Production was not rebuilt or restarted. Deployment remains coordinator-owned.

The first exact-plan replay `a91a2ffa-4488-4700-8d49-87210a798c77` passed placement/clock preparation but hit the unchanged240-second service worker timeout during native routing. Its record is retained as `job-standard-timeout.json`. The second replay uses an explicit offline-only600-second limit; this does not change production configuration.

Final exact-plan replay **3eb2b76f-dfdf-425f-9a84-b32e0f325378** is **done**, all eight gates passing: ERC, power, SPICE applicability, existing review, native DRC, actual block-pad check, Verifier and sandbox compile. Board40×60mm, two layers,122traces/107vias; native DRC has0errors. Application source in generated `firmware/src/main.cpp` is byte-for-byte the original1469-character source. Pico/Arduino-mbed compile passes. Total388.769s, including362.633s native routing and2.257s sandbox compile. Root/web typechecks pass;18 focused tests pass. `result.json` records all identities and measurements.

**Deployment constraint:** this successful offline replay needed the explicitly supplied600-second worker limit. The current production-code default is240seconds, and the first replay demonstrably timed out at that default. Parser fix alone therefore leaves a live timeout risk for this exact plan. The coordinator can supply a600000ms chip-worker deadline through the existing service timeout option or its chip-job worker call; no production timeout/configuration or lifecycle was changed here. Native source/connector-access and one routing-style warning remain warnings, not hardware/manufacturing qualification.
