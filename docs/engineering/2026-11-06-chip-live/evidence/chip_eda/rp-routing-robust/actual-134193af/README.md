# Native four-layer via serialization proof

Captured from job `134193af-e7d3-4376-8a28-1979f18628bd`, after its native global router solved and before copper pours. `capture.json` records original artifact hashes. These are retained actual outputs, not a new render or route.

`source_net_20_mst1_0` contains two actual full-span 0.6/0.3 mm barrels. Its wire traversal is top→inner1 at `(-7.265152014479209,11.786908470895844)`, while the serialized via annotation and actual barrel retain inner1→top; the second via has the opposite reversal. The source helper now proves exact coincident incoming/outgoing wire contacts, both physical layers in the actual barrel stack, positive annular copper on both sides, canonical source ownership and unchanged geometry. It does not rewrite the annotation or barrel.

The new source regression retains every actual electrical/pad/phase/barrel record and the exact affected MST, omitting unrelated ordinary MSTs only for focused testing. Clearing this MST's source IDs exercises attribution. Geometry and input immutability are asserted. Drilled-away annuli, incomplete layer spans, foreign source keys, 0.001 mm displaced contacts and copper wholly inside the drill all reject.

A separate derived native serialization test proves that a join may depart an already-proved saved full-span barrel on another physical layer, without an additional serialized via. It requires the exact barrel center and positive contiguous annular wire copper. Wrong layer, shifted center, drill-only copper, missing span, foreign key and under-floor width reject.

The board minimum-width floor remains unchanged. The complete raw board is **not accepted** by this focused proof: `source-proof.ts` still stops at the actual VCORE join `source_net_7_mst1_0`, whose first widths are approximately 0.106–0.150 mm against the captured/board 0.150 mm floor. The coordinator is testing the native width-expansion stage. `width-probe.json` returning no official thickness errors is insufficient: that installed checker skips one-port-to-net source traces. No width, route, source identity or diagnostics in the retained raw board were changed here.

Targeted source regression suite: 18 tests pass. Strict targeted TypeScript output is retained in `typecheck.log`. This is source attribution evidence, not whole-board routing, copper-pour or fabrication acceptance.
