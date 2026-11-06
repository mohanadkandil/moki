# Official ground-pour island diagnosis

Pure geometry analysis of final partial job `365a210f-a69f-4526-a8e4-57abf5ad397d`, 2026-11-06. Input Circuit JSON SHA-256: `e9a5461d4d069e5a657bc0679430fb66acac3d116117862c8021960fa02fe3e9`.

The fresh official port check still reports 61 GND errors and 50 other errors; these are not established stale diagnostics. The first receipt is `official-postpour-port-check.json`.

To locate the GND split, the installed `@tscircuit/checks@0.0.269` sourcemap's `get-copper-pour-connectivity.ts` and its contact tester were copied to temporary modules. The algorithm was unchanged; an added `diagnostics()` returned its existing conductor roots and port/pour identities. Runtime was approximately 292 ms. Source hash, instrumentation scope and complete metadata are retained in `official-ground-islands.json`. No RootCircuit render or routing engine was run, and no source geometry was edited.

Every native GND pad has contact with some pour. The failure is **separate physical islands**. The main group joins top pour `pcb_copper_pour_0` and bottom pour `pcb_copper_pour_29` through emitted plated copper and contains 60 native ports. The official map contains 72 native GND ports: 61 explicitly connected source ports plus 11 additional native MCU/microphone exposed-pad ports. Those additional ports are in the main physical group; no internal package union was added by this diagnostic.

Twelve declared ground pads remain on eight separate top-only islands:

| Pour | Ports and native centers, mm |
| --- | --- |
| `pcb_copper_pour_11` | U2.N_CE: (−1.500, −4.750) |
| `pcb_copper_pour_12` | U2.EN1: (−0.250, −5.500); U2.EP: (0.000, −4.000) |
| `pcb_copper_pour_15` | C1.pin2: (−3.750, −1.800) |
| `pcb_copper_pour_16` | C6.pin2: (4.000, −2.000); C7.pin2: (4.000, 0.250) |
| `pcb_copper_pour_28` | U4.PGND: (−25.487, 8.000); U4.PAD: (−23.988, 8.000); C15.pin2: (−23.800, 11.500) |
| `pcb_copper_pour_24` | U4.PS: (−22.488, 7.500) |
| `pcb_copper_pour_26` | U4.GND: (−22.488, 8.500) |
| `pcb_copper_pour_21` | C12.pin2: (−20.000, 6.000) |

The official `isPortConnectedToNet()` requires every peer port to share a physical pour root. These eight islands therefore cause all 61 explicitly checked GND ports to report failure, including pads already touching the main plane. The result is not 61 independent missing contacts.

This diagnostic identifies the required repair area; it is not an acceptance waiver or the independent copper oracle. Legitimate routed/stitching copper or revised native routing/pour geometry must connect the islands. The completed candidate still requires a fresh official check, native DRC and independent physical copper continuity verification.
