# Coupled RP2040 USB and power escape option

The actual failed65×55Pipeline7 diagnostic identified internal `USB_DP` (`source_net_10`) as never routed after34pathing attempts: U1.pin47's saved top-only exit at(-15.250002,1.600063) to R6.1(-7,2.496636). Gndworker inspected its tiny top-only terminal capacity region and nearby foreign VREGVOUT45barrel. The optional profile below gives both USB nets actual full-span off-pad exits, with adjacent power vias moved as one finite, validated layout. This is not proof that the full native router will complete every board.

API: `createRpEscapePhase(circuit, graph, mapping, clock, {applicationVias:true, usbVias:true})`. Default14and application-only16paths remain unchanged. USB coupling activates only if a physical USB pin is connected and only connected USB pins receive paths. With both GPIO and USB pairs connected, the result has18escapes; the remaining signal helper emits8stubs when given the union of driver and escape net exclusions.

| Physical pad | Fixed local top waypoints after its actual compiled port | Terminal0.6/0.3mm via |
|---|---|---|
|42 / IOVDD|(4.55,2.600071)|(4.55,2.600071)|
|44 / VREG_VIN|(2.199894,2.95), (2.65,2.5), (2.65,1.3), (2.1,1.3)|(2.1,1.3)|
|45 / VREG_VOUT|(1.799844,2.1)|(1.799844,2.1)|
|46 / USB_DM|(1.4,4.1), (1.8,4.6)|(1.8,4.6)|
|47 / USB_DP|(1,4.6), (0.8,4.6)|(0.8,4.6)|

All top traces remain0.15mm. Local points use actual cardinal MCU placement; starts come from exact canonical source/physical port bindings. USB sources must be actual bidirectional USB_DM/USB_DP pins46/47. The two USB barrels are1mm apart. The old45barrel near(1.799844,4.55) would collide with the new46barrel, which is why the power relocation and USB exits are inseparable. Moving45inward also puts it too close to old42/44barrels, so those power exits are part of the same validated change.

The same native trace/pad/via/hole/spacing/board/cutout checks evaluate all18paths and the saved clock simultaneously, with unchanged0.127mm fabrication clearance,0.2mm trace-to-drill requirement and no-via-in-pad enforcement. No path search, clearance exception, coordinate rounding or geometry waiver was added. Scope is `finite-rp2040-coupled-usb-power-native-escapes`; USB audit entries have `kind:'usb-signal'` and actual USB net names are included. The remaining signal validator permits only known17/18and46/47optional prefixes with their correct kinds, scope, actual bidirectional pin/source/port identities and graph net membership, while still requiring all14distinct base power pads.

Measured author checks: all2/4layer×four cardinal cases pass18escapes plus8remaining signals on the retained actual65×55fixture; the actual55×40two-layer90° placement also passes. Tests include default14/application16compatibility, one/no connected USB pin behavior, wrong aliases/roles/optional kinds/source identity, same-net SMD copper at a proposed USB via, and the old45/new46collision. All7combined application/coupled regressions pass (18.44s); strict targeted NodeNext TypeScript passes. No native full-board routing/render/compile was run by this worker.

Independent gndworker review found no actionable new-delta issue, independently repeated the8-case matrix and input immutability checks, and rejected wrong USB source/kind and old45collision mutants. See `coupled-rp-and-root-deltas-independent-review.{md,json}` for its exact scope (including the explicit exclusion of reapproval of the original signal baseline that reviewer authored).

Frozen source hashes: rp-escape `f5c06554869d11d8b4116f180f67a6f2fd9d95afc8b63b11c7d6a2c782f5edb6`, rp-signal `1f3d0ce2045a2e3103f0b0d9481f5a93141beaaf00230003d606168398e258f9`; tests `0e2831346a0fb960bf4c3885d7f249d8676d91db6875b3b4548bb8baa635fb85`. Logs: `coupled-usb-tests.tap`, `coupled-usb-typecheck.log`. Whole-board native routing, all-net physical copper/drill continuity, width, DRC and all-layer shorts remain coordinator acceptance gates.
