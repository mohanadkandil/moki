# Native saved-exit source proof

The installed native engine infers source IDs when materializing routes. A global join ordered before its saved prefixes can lack an attribution source; the existing actual SHT capture demonstrates this. Saved RP terminal vias require a different literal-path proof than the old two-wire-only SHT helper.

`repair-native-exits.ts` is a separate helper. It clones native records, proves complete compiler path audit against the original electrical graph and canonical physical ports, matches native terminal-via contact serialization, and checks actual .6/.3 plated barrels and complete board-layer spans. Saved-exit joins require two proved same-net prefixes and a unique captured native SRJ connection with exact exit coordinates/IDs/layers. Layer-changing joins require actual owned native vias. Width may vary between the board minimum and captured nominal; contact tests use actual endpoint/segment width and positive annular copper rather than drilled voids. Missing source IDs and missing proved barrel keys may be completed; conflicts and unknown traces fail closed. No route geometry or diagnostic is removed.

Twelve focused tests pass in1.267s and targeted strict TypeScript passes. The saved serialization fixture is actual small native output using an explicit precomputed pass-through callback,with no pathfinder. Join mutations are marked derived,including inner-layer and variable-width paths. The original actual native SHT blank join is also tested with its real captured input.

The caller must update native DB trace source IDs and returned `viaAudit` connectivity keys synchronously before pouring,then retain all final native source/placement/physical/DRC gates. This code author cannot independently approve this helper; the parent is reviewing it. No new whole-board native routing acceptance is claimed.

The frozen source hash is `602286ddbf8625f2665d90b596429ac36cf567e2f4c6dac07862ea92d5c34ad2`. Additional regressions cover all14actual RP prefixes including EP aliases,2/4layer physical spans,and absent/conflicting versus genuine same-net endpoint markers. Parent review is required for this authored helper.
