# Finite inward application escapes

Added the explicit internal option `createRpEscapePhase(circuit, graph, mapping, clock, {applicationVias:true})`. Default behavior remains the original 14 power/ground paths; explicit false returns the same default result. The new mode emits only connected physical17/18, using their actual canonical GPIO14/15 ports with bidirectional roles and real one-port-to-net compiler source records. No immutable block data changed.

| Physical pad | Actual local start | Fixed local bend | Fixed local via |
|---|---|---|---|
|17 / GPIO14|(-1.800098,-3.425063)|(-1.800098,-2.9)|(-2.5,-2.5)|
|18 / GPIO15|(-1.400048,-3.425063)|(-1.400048,-2.9)|(-1.8,-2.1)|

Starts are read from actual compiled physical ports; the table describes the known retained footprint. Every point transforms with the actual cardinal MCU placement. Each path is top0.15mm copper into a0.6/0.3mm top→bottom full-span off-pad via. The two barrels are0.8062mm apart; GPIO18 and TESTEN19 barrels are0.8000mm apart. The existing native pad/trace/via/drill/board checks evaluate all16paths together with the saved clock copper, including the unchanged0.127mm fabrication clearance,0.2mm drill-to-trace requirement and hard no-via-in-pad check. There is no path search, angle/coordinate rounding or per-net exemption.

When an application path exists, scope is `finite-rp2040-power-ground-application-native-escapes`, that audit entry has `kind:'application-gpio'`, and `netNames` includes its actual graph net. One or both unconnected pins are omitted; zero connected optional pins returns the default scope. The root merges these native saved paths into its joint phase and passes `excludedNetNames = driver.netNames ∪ rpEscape.netNames` to the remaining signal helper.

The signal helper still requires every one of the14distinct physical base prefixes. It additionally permits only known17/18 entries with application audit kind/scope, actual bidirectional pin/source/physical-port ownership and exact graph net membership; unsupported extras, missing base pads or duplicate physical pads reject. Existing default signal behavior remains intact.

Measured pure checks: all four cardinal orientations on both2/4layers pass16power/application plus10remaining signal paths on the retained actual65×55fixture. The retained actual55×40two-layer board at MCU(1.75,-2.5,90°) also passes16+10. Tests cover15/14connected-only behavior, unknown aliases/roles/optional ownership, foreign clock copper and a same-net SMD pad at the proposed via; the latter still fails no-via-in-pad. All17combined default/application/signal regressions pass (10.89s); strict targeted NodeNext TypeScript passes. No native router/render/compile was run by this worker; full-board native routing and final physical/fabrication gates remain required.

Frozen source hashes: rp-escape `0f799b508bf956bee218149f32e406c0d520490a8ba8215a0a4b3a277d2882ff`; rp-signal `9fce16daa5677241082cee0c41036f620c062e284520b96ecf4b69492a2be65c`. New tests: `01391d2a9eaa0e7c6e5ee2f7f6f464f8c851add4f891b87419671ad8c7f78c66`. Logs: `application-via-tests.tap`, `application-via-typecheck.log`. Independent review requested from final_review.
