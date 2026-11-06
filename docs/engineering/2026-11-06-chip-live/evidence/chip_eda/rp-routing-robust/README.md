# RP2040 clock and power/ground escape robustness

## Actual failures and cause

Live jobs `05e69207-83d3-45b6-a751-b657b2a2e3dc` (65×55mm2layer) and `4e68bf02-2224-41fd-8269-1f2bcd422f95` (65×55mm4layer) **both selected the clock profile**. Their five saved clock traces and lengths are identical. The2layer job has one remote DRV8833 VCP/VBUS0.096mm clearance error; the4layer job additionally routes foreign RP V3V3/VCORE copper and vias into the dense clock/power neighborhood. Its XOUT saved path has a real0.067mm gap to the later pin22V3V3 route, with additional VCORE/V3V3/via/EP failures.

The clock paths are preserved, but this alone does not guarantee later router clearance. Captured implicit router input has0preloaded `traces` and302obstacles, including correctly net-attributed rectangularized segments for the prior clock paths. The clock was not omitted or disabled by board size/layer count. Later native global escape placement failed to retain required clearance from that existing copper. Via-in-pad was already disabled, yet the4layer native output placed a via over the MCU ground EP. Final native checks correctly rejected this geometry.

## Bounded native fix

New `eda/blocks/rp-escape.ts` supplies **14explicit finite power/ground pad-to-via profiles**, using documented native `autoroutingphase` saved `pcbTracePaths` with `autorouter:'fanout'`. It does not search for a route. MCU-local points transform with actual placement translation and cardinal rotation. Existing immutable RP blocks3/4 and `rp-clock.ts` are unchanged.

All routes start at actual canonical native ports on top, use0.15mm wire, and terminate at an explicit **off-pad0.6mm/0.3mm through via from top to bottom**. Four-layer diagnostics give the via its full physical span through top/inner1/inner2/bottom. No clock via or change to clock copper is introduced. Crucial inward exits avoid having pin22cross the XOUT corridor. GND19andGND57 have separate validated off-pad exits, avoiding a via in the center EP or a trapped outward TESTEN escape.

| RP physical pin | Net | Local via center mm |
|---|---|---|
|1|V3V3|−2.1,2.5|
|10|V3V3|−2.1,−0.999871|
|19|GND|−0.999998,−2.1|
|22|V3V3|0.199898,−2.1|
|23|VCORE|1,−2.5|
|33|V3V3|2.1,−0.999871|
|42|V3V3|2.1,2.600071|
|43|V3V3|2.599944,4.55|
|44|V3V3|2.199894,2.1|
|45|VCORE|1.799844,4.55|
|48|V3V3|0.9,2.5|
|49|V3V3|0.199898,2.1|
|50|VCORE|−0.8,2.5|
|57|GND|2.1,0.000127|

Every invocation verifies native placement against graph, native electrical graph against physical importer mappings, canonical native component/source-port/pad/PCB-port identity, then checks the complete actual native obstacles plus **all five saved oscillator paths**. Official checks cover trace/trace, pad/trace, hole/trace, via/trace, via/pad, no-via-in-pad, same/different-net via spacing, board boundary and cutouts. A separate convex-outline containment/edge-distance check prevents traces or via annuli from escaping the native board. Existing native clearances remain authoritative, with floors0.127mm copper spacing and0.2mm trace-to-hole. Via-in-pad remains prohibited even if caller metadata allows it. Unsupported native geometry or a newly obstructed fixed corridor fails explicitly.

The initial finite proposal had two0.1mm via/pad gaps (pin1/pin48vias near top pads); moving only those predefined via centers0.1mm inward made the full pure oracle pass. No DRC value was relaxed and no router was written.

## Root integration API

`createRpEscapePhase(circuit,graph,mapping,clock)` returns exported `RpEscapePhase`:

- `props`: native phase1 `{name,autorouter:'fanout',connections,pcbTracePaths}`. Every path ends in a native `via` object; it does not end at a pad and requires no via-in-pad permission.
- `netNames`: `GND,V3V3,VCORE` for the current immutable profile.
- `audit`: physical ref/pad, selector, named net, literal route and via location, plus diagnostic source trace/port/PCB-port/source-net IDs. Numeric IDs are diagnostic only; source binding must resolve fresh actual native records.
- `sourceTraceWidthOverrides`: per-physical-pin0.15mm widths for these14RPpins. Root must apply these when building the actual source `<trace>` nodes, especially GND19/GND57 which otherwise inherit0.3mm. Other board/motor ground widths remain their original values. These are local low-current MCU escapes, not a new whole-board ground width rule.

Clock remains phase0. If RP and DRV/generic escape sets share GND, root should merge their verified saved paths into **one common native fanout phase after clock**, preserving original source/net connectivity, instead of retagging shared nets into a later phase. Final native source attribution, fabrication DRC, physical copper, clock length/via constraints and the complete board pipeline must still pass. Existing source-repair code for two-wire paths cannot assume these via-ending profiles are two-point stubs; `final_review` owns the new proof-only native-exit source completion helper.

## Measured acceptance and limits

`tests/blocks-rp-escape.test.ts`: **6/6pass (~4.82s)**. Targeted strict TypeScript check passes. The official `autoroutingPhaseProps` schema accepts all14paths. Regression fixtures retain the actual failed4layer source/placement/clock/router inputs, with SHA256 manifest `capture.json`. Tests derive a pre-routing geometry view by removing final traces/vias/pours/error records; this is not a new routing-disabled render or native route receipt.

Covered:

- Actual65×55mm4layer placement plus all5saved clock paths admits14legal off-pad escapes, with immutable inputs and unchanged clock lengths: XIN9.894285604544496mm, XOUT2.271724999999998mm, XTAL_OUT5.640193212182105mm, clock0vias.
- Same actual local geometry on2/4layers and enclosing65×55,75×65and90×80mm rectangles.
- Actual native/graph/footprint90° coordinate rotation; clock lengths and local escapes transform correctly.
- Clock/escape-only centered40×55and90°55×40mm tests, including translation of actual source/geometry. These prove local profile fit; they do **not** claim the remaining complete board placement or route fits those envelopes.
- Official checks reproduce the captured4layer0.067mm XOUT failure. New pin22exit heads inward, away from XOUT, and its complete saved geometry clears the clock.
- Foreign pad copper, drilled hole, clock-copper encroachment, off-board geometry and wrong native physical mapping reject.

Assumptions: one actual RP2040 with immutable supported block3/4, actual top-side MCU and all clock parts, cardinal placement, two/four copper layers and convex finite board outline. All current footprints, holes, clocks and foreign geometry are rechecked each run; unsupported layouts fail rather than stretching saved geometry. Profile acceptance does not guarantee the remaining native global router will succeed on arbitrary designs or establish electrical/thermal hardware qualification.

No native autorouting, board render, firmware compile, production change or service restart was performed in this worker. Root owns integration and measured end-to-end routing acceptance. Reproduce the pure profile witness with `node_modules/.bin/tsx docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/probe.ts`.
