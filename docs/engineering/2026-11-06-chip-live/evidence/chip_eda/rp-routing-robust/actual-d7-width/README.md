# Actual d7 native width-stage diagnosis

Source `d7bdf1b1-c49a-49db-94fd-a9c4236dc3c4` completed native routing but correctly failed the absolute0.15mm wire floor before Core materialization. All retained candidates here are diagnostics and remain rejected.

The public native Pipeline9 PowerTraceExpansionSolver was replayed over the actual117records with every conforming trace fixed. Original planning recovered the minimum from0.106066 to0.125mm; fabrication-limit replay recovered to0.1480572238900163mm and left only V3V3 `source_net_0_mst14_0` below floor. Explicit `powerTraceToPadClearance:0.127`, narrowly unlocking the actual foreign blocker, and a stronger0.3mm native V3V3 target each failed to reach0.15mm. All outputs are literal native results, with fingerprints and options in `audit.json`.

The native collision index identifies QSPI_SD0 `source_net_13_0`'s0.6mm via at(-4.6454574,4.3353429) as the blocker. It already overlaps the attested U1.pin1 V3V3 saved0.6mm via at(-4.75,3.9): center distance0.4477193mm, outer copper edge gap-0.1522807mm. The existing thin-wire-to-via edge gap is0.0736907mm, below the unchanged0.127mm requirement. This is existing invalid native copper, not merely width rounding. Native inflation cannot push via-kind blockers; cleanup moved a different remote barrel.

No point, width, electrical net, fabrication limit or production helper was hand edited. No pre-pour capture was fabricated. A separate public whole-source13 reroute is prepared in `../actual-d7-local-prepare`; its current result must be read there and must pass fresh full gates before acceptance.
