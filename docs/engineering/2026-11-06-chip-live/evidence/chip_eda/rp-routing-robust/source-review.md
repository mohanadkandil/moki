# Native-exit attribution review and focused corrections

Scope: complete new `eda/blocks/repair-native-exits.ts` and `tests/blocks-repair-native-exits.test.ts`, including root's existing-source-without-capture guard. Context inspected: actual native saved-path serializer and physical-via materializer, canonical source/pin alias validation, copper-pour connectivity lookup, and root's pre-pour DB updates/diagnostic regeneration. This is a local shared-worktree review, not a review of every unrelated dirty file.

Original reviewed source SHA256 `272958ec957a9d35a2a4b16eaaf825707dcf615c52953e8a9429426b9f339007`; original13tests passed. Two compatibility findings were confirmed. Root then explicitly assigned the narrow fixes to this reviewer; consequently, the final fixes require teammate re-review and are not presented as independently approved by their author.

## P2-1: exact source coordinates reject legal rotated profiles — fixed

`port.x===start.x` and the equivalent marker check rejected a valid90° actual RP placement translated by(1.23,−1.23). Native port U1.1x was1.379928999999999mm; finite-profile roundtrip x was1.3799289999999993mm, a2.220446049250313e−16mm difference. All profile/native geometry checks passed, but source attribution threw `Native exit lacks exact actual physical pad/port start`. Equivalent270°/180° cases reproduced. These are explicitly derived transformations of retained actual native geometry, not new routed boards.

Fix: a finite **1e−7mm port-binding tolerance only**. Audited literal prefix geometry, route widths/layers, via coordinates/dimensions and fabrication DRC remain exact/unchanged. Canonical physical component/pin/port/pad/net proofs and all marker identity checks still apply. The new actual-RP90° regression includes real sub-ulp coordinate differences, present native start markers and14prefixes. It proves geometry immutability;0.001mm moved-port and moved-literal-route negatives still reject.

## P2-2: native same-net deduplicated barrels reject valid joins — fixed narrowly

Installed core's `pcbViasSharePhysicalHole` deduplicates same-key/same-subcircuit/same-coordinate/same-diameter/full-stack physical holes. `_updatePcbTraceRenderFromPcbTraces` retains the first barrel owner and its route-direction fields. A saved top→bottom exit reused by a same-net MST bottom→inner1join therefore has one existing **prefix-owned** full-through barrel, not another MST-owned barrel. Requiring a literal per-MST owner/direction rejected that supported native materialization.

The independent `source-review-shared-via.ts` reproducer derives this exact serialization policy from the retained actual two-resistor native fixture. Before the fix it rejected with `requires exactly one physical barrel`. No native router was run. The installed native materializer copies from/to direction literally for new barrels and uses the complete physical stack when blind/buried vias are disabled; ordinary new barrels therefore keep strict owner/direction proof.

Fix: a join may reuse **only an already-proved saved-prefix barrel** at exact coordinates with0.6mmouter/0.3mmdrill, full physical layer span, same subcircuit and canonical source key. Its original owner/direction remain untouched; no via is added or moved. Owned-barrel accounting still rejects extra/unverified records. Shared-barrel contact requires positive wire copper on the actual away layer after entering that exact proved barrel; copper wholly inside the drilled void still fails. Both join orientations pass. Wrong key, drill, span, owner and shifted-coordinate mutants reject. Arbitrary coordinate-matching foreign barrels are never inferred.

## Review result and measured evidence

The final helper updates only missing PCB trace source IDs/source net IDs and proved missing via connectivity keys. It clones input; source records, routes, vias' geometry and existing diagnostics remain unchanged. Unknown blank traces stay unrepaired and root fails them. Existing nonblank foreign source claims reject before the missing-capture early return. Captured variable widths remain within the board minimum and captured nominal bound. No diagnostic filtering or fabrication clearance relaxation was introduced.

All15targeted tests pass (~1.8s), and targeted strict TypeScript passes. Independent after-fix probes show all five tested transformed RP cases repair14prefixes, and the saved-hole reuse case repairs its one same-net join. Logs/probes: `source-review-tests.tap`, `source-review-typecheck.log`, `source-review-probe.{ts,json}`, `source-review-shared-via.{ts,json}`. Baseline observations and final hashes are in `source-review.json`.

Security scope: this helper introduces no network, shell, persistence, authentication or cross-user endpoint. Its inputs are compiler/native records and code-owned phase evidence. Source claims still pass the complete canonical electrical graph proof; missing/ambiguous proof fails. Runtime cost stays bounded by the existing job geometry; no unbounded search/router or new asynchronous work was introduced.

Remaining limits: no native route/compile was run during review. The source helper recognizes the documented finite saved-prefix shapes and full-through0.6/0.3mm barrels, not every possible native topology. It does not establish physical geometry or whole-board routing acceptance; root must retain native placement/source/DRC/copper gates. The current root replay's separate QSPI static-reachability failure is not resolved or waived by source attribution. Frozen RP clock/escape profiles were not modified during these fixes.

Final helper SHA256 `bc13e2f9d7f1bcda4cba36f9ac2ba3b285c32e71ce70ad2cb21577dc303cec06`; final test SHA256 `2c9945547cd03721ab1bcb688eb3accf3b07685e4680cf51ee339461822e0bb3`.

Subsequent root-authorized contained-handoff marker correction supersedes the final source hash above: current source is `47013c9aaa9978d26f5e71b62c586f72fe9a1b18fab01c2262af82d2ad8b94b7`, with16source-helper tests passing. See `signal-review.md` for the actual native offset-marker regression, independent actual-pad/capsule proof and gndworker's no-blocker re-review receipt (22combined tests/strict TypeScript). Geometry and fabrication DRC remain unchanged.
