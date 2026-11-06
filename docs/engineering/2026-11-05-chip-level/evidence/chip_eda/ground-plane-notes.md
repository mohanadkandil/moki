# Native ground-plane input correction

This is a routing-input adapter around the installed public `tscircuit.SOLVERS.FanoutSolver`, not a routing algorithm or copper acceptance gate. Root owns whole-board integration in `build.ts`.

The retained failed native input came from job `164dced4-c6f5-4d77-a3ec-42383e1bc51e`:61 single-port GND-to-bottom-plane connections. Its native fanout solver routed57/61. The four failures included MCU repeated EP lands, charger EP, TPS ground pin9 and amplifier ground pin3.

The adapter requires an exact source-graph check through `nativeNetlistIssues` and the existing `nativeComponentPorts` internal-connection proof. Only routing obstacles for verified repeated pieces of the same physical pad gain their canonical GND connection/source/PCB-port routing tokens. Every obstacle coordinate, layer, width, height, original token, connection, bus, rule and board outline remains unchanged. It validates actual source traces, GND source-net identity and exact top-layer terminal coordinates. Foreign or contradictory aliases fail before routing.

The solver gets its supported `allowSameNetMerges:true` option so actual same-net branches may share copper. Outward plane-bus directions use actual pad long-axis orientation and native component center; this corrects TPS pin9's former down direction to right. Vias remain through-stack. **Via-in-pad remains disabled**, and no fabrication clearance or wire width is reduced.

One bounded native replay measured **2.788s,61/61 solved**,61 emitted fanout traces and0 remaining plane connections. `ground-plane-replay.json` records the result and ownership/direction audit. This is **not** accepted PCB output: root must still run the full source/placement/native DRC and the independent actual-copper `physical-network` gate after final pours. Repeated EP pieces are only logically related here; the copper gate must prove every actual piece physically joins the ground network.

Four focused tests pass, including ten separate destructive identity/input mutations. They check actual captured data, unchanged geometry/rules/graph, native direction policy, alias-record disagreements and foreign physical/source identities. Targeted strict TypeScript with `noUncheckedIndexedAccess` passes. The actual fixture is retained in `ground-plane-fixture.json`, independent of mutable job folders. The helper dynamically loads native SOLVERS only when routing, keeping pure tests free of a native solver execution.
