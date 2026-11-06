# Rotated DRV8833 physical-pad attestation

The 65 × 55 mm native job `bff4e1d1-a311-4532-bca3-a9dcdb30efb6` passed native DRC but failed block inspection with `Missing/degenerate/unsupported physical pad shape U5`. This was an attestor allowlist omission, not missing copper or a routing failure.

Exact captured U5 geometry:

- Source component `source_component_33`, DRV8833PWPR/C50506; native PCB component `pcb_component_33`.
- Footprint origin **(-26.5, 1.25) mm**, rotation **90°**.
- **Sixteen `rotated_pill` perimeter lands**, each width **0.350012 mm**, height **1.2999974 mm**, radius **0.175006 mm**, `ccw_rotation: 90`.
- Pin 11/VCP is `source_port_160` → `pcb_port_160` → `pcb_smtpad_159`, center **(-29.350007, 2.2251060000000003) mm**, `port_hints: ['pin11']`.
- Pin 12/VM is `source_port_161` → `pcb_port_161` → `pcb_smtpad_158`, center **(-29.350007, 1.57512) mm**, `port_hints: ['pin12']`.
- Exposed pad 17 remains a valid square `rect`, **2.7399996 × 2.7399996 mm**, with its actual source/PCB-port association.

The passing 46 × 66 mm job `c6f5f8a6-c55b-4288-9199-8d0548b8da38` places U5 at **(-7.25, -19.5), rotation 0°**; the 40 × 60 mm job `13a6ffa2-7615-489c-bc97-5c081ba86530` uses **(-4.25, -22.5), rotation 0°**. Both have the same sixteen land dimensions, represented natively as plain `pill`. All exact failing-job source/port/pad records and immutable block definitions used by the regression are retained in `native-shape-rotation-fixture.json`.

`src/blocks/test-block.ts` now accepts the supported SMT `rotated_pill` representation with finite `ccw_rotation`. Rotated rectangles likewise require an explicit finite angle; malformed supplied angles fail. Positive finite dimensions and coordinates, supported outer-layer placement, catalog/import hashes, source aliases, physical-pad correspondence, complete coverage/omissions and existing plated-hole annulus/layer checks remain required. No other pad shape is enabled; notably this does not enable `rotated_pill` **plated holes** without a supported annulus representation.

Validation: **14/14** focused and existing block tests pass (`blocks-native-shape-rotation.test.ts` plus `blocks-test-block.test.ts`, 2.18 s). Tests cover every cardinal representation and declared VCP/pin11 alias, rotated rectangles, missing/nonfinite/string angles, degenerate dimensions/coordinates, unsupported shapes/layers, foreign/unmapped copper, corrupt imports/source aliases, missing physical pads, and circular/pill drills that remove the annulus. Isolated strict TypeScript with `noUncheckedIndexedAccess` passes.

Pure reinspection of the **unchanged full captured circuit** now passes all three block inspections: RP2040 **33 parts**, motor **9 parts**, pushbutton **2 parts**. Exact results and input hashes are in `native-shape-rotation-reinspection.json`. The historical failed job was not changed or relabelled. This reinspection is physical-shape evidence, not a new route, firmware build or complete acceptance receipt. No native routing, render, compile or service start was performed.
