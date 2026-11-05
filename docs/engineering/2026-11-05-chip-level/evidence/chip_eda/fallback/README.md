# Native fallback footprint evidence

Engineering fixture only: two actual UNI-ROYAL 0603WAF1002T5E / C25804 resistors, one footprinter 0603 and one official KiCad R_0603_1608Metric fallback, connected through actual JST SM04B-SRSS-TB(LF)(SN) / C160404. J1 contacts 2/1 are assigned 3.3 V/GND for this fixture; no owner-device or actual power-source behavior is implied.

Final native RootCircuit render/route: PASS in 941.17 ms, four traces, two vias, zero native DRC errors, zero pad-to-source-pin correspondence issues and zero source-netlist issues. Both fallback footprint arrays reached native rendering. See receipt.json, circuit.json, pad-attestation.json, drc.json, import-map.json, bom.csv and pcb.svg.

The initial attempt failed because the KiCad converter produced four two-point courtyard outline records. Those exact connected source segments are now stitched into their existing closed ring; gaps, branches and crossings fail closed. No courtyard edge, pad coordinate, clearance or DRC check was invented, removed or bypassed. Audit records retain the source fragments, resulting ring, source bytes and SHA-256 geometry identities. Initial unmodified evidence remains in attempt-1/. Focused fallback regression tests: 6/6 PASS.

KiCad source mode is explicitly offline: exact first-party bytes previously captured in tests/blocks-footprint.test.ts, source SHA-256 effcae403a15810b3a1947b8664576270d6781e7cd525e97c47d48be0fdae8ce, from https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod . No fresh upstream/stock claim is made. Native normalized KiCad geometry SHA-256 cd0cb94ad44dbecdedc3cc1bf66c4db26d4448ce9d84c8fa759f6d37f0bf7218; footprinter geometry SHA-256 d78690d9160da514668e4100caa9874309c2ec2bcec7563d3ec3947749f78190.

No imported fallback 3D model, MCU compile, fabricated board, purchased-part terminal/solder-process fit or manufacturing qualification is claimed. Source CAD uses standard land patterns whose fit remains independently unqualified. Native routing and DRC do not establish those properties.
