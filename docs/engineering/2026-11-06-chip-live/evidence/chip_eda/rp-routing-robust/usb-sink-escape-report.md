# USB sink exits for the joint RP routing phase

Native four-layer job `dad50cbf-26e5-4564-bef1-8161737012aa` failed on **VBUS / source_net_18_mst4**, USBLC6 pin 5 **(-8.25, 13.399096)** → C17 pin 1 **(-6.950024, 16.25)**. Earlier separately routed USB copper crossed the protection chip's outward VBUS corridor. The coordinator captured that actual reservation in `usb-vbus-reservation.png` / `.svg` and the native error in the job's `router-error.json`. Jointly reserving power, MCU and USB exits is the next native routing strategy; it is not yet a completed-board pass.

`eda/blocks/usb-sink-escape.ts` exports:

```ts
createUsbSinkEscapeProposals(circuit, graph, mapping, prefixes = [])
// -> { proposals, audit, netNames }
```

The optional prefix list accepts the existing clock, RP power/signal and DRV audit records via `{ selector | from, netName | net, route }`. Each prefix resolves to its actual physical source/PCB endpoint and named net before native geometry checks. The actual fixture includes **38** existing paths: five clock, fourteen RP power/ground, ten RP signals and nine DRV exits.

The helper is restricted to **rp2040-minimal revisions 3/4**, with RP2040/C2040 and same-instance USBLC6-2SC6/C7519 plus the block's actual USB sink constraint. It checks both independent 5.1 kΩ CC resistor references, their actual connector CC contacts, and opposite-pad ground membership. Other MCU families do not receive this strategy.

Actual accepted local exits:

| Component | Pads | Width | Straight outward length |
|---|---|---|---|
| U4 / C7519 | 1, 3, 4, 6 | 0.15 mm | 1.0360035 mm |
| U4 / C7519 | 2 GND, 5 VBUS | 0.30 mm | 1.0360035 mm |
| R7, R8 / C23186 | 1, on their CC nets | 0.15 mm | 0.9032377 mm |

U4's six actual **0.532003 × 1.072007 mm** pads occupy local rows **y = ±1.149096 mm**. Its VBUS endpoint becomes **(-8.25, 14.4350995)**, beyond the previously reserved crossbar position. R7/R8 are rotated 90° in this capture: pad 1 lies below the body center, so each exit points downward, away from its body. Lengths are the actual land's half-span along the pad normal plus 0.5 mm. Source widths are preserved exactly; no vias, neck-downs, electrical changes or rule changes are introduced.

The public native fanout binder validates source/physical selectors and constant-width routes. Native clearance checks then include real foreign/NC pads, prefix copper and physical prefix vias, drills, keepouts, cutouts and board outline. Source-proven foreign geometry projections prevent accidental contact at a free exit from being accepted through an inferred connection or copied net label. Final native routing, source attribution, physical copper connectivity and fabrication DRC remain mandatory.

**Five focused tests pass** (5.62 s), including every cardinal placement on two/four layers, all 38 prefixes, exact 0.30/0.15 mm widths, corrupt aliases/pad order/shape, power width reduction, CC endpoint mismatch, foreign copper at a free exit, malformed prefix geometry and drilled-away via annuli. Isolated strict TypeScript with `noUncheckedIndexedAccess` passes. Exact constraints and helper/fixture hashes are recorded in `usb-sink-escape-proposals.json`; fixture provenance is in `usb-sink-escape-fixture.json`.

No native routing, render, firmware compile or service start was performed by this worker. The original failed job and its artifacts were not modified.
