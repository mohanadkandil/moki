# Native RP2040 saved oscillator phase

Implementation `eda/blocks/rp-clock.ts` supplies five finite top-only paths to tscircuit's documented `autoroutingphase.pcbTracePaths` mechanism, with `autorouter:'auto'`. It preserves every original named source net and pin-to-net declaration. It is a bounded placement profile, not a routing algorithm or general oscillator-placement system. Unsupported local poses fail rather than stretching a path.

`createRpClockPhase(circuit, graph, mapping)` returns `{props, netNames, audit, lengthsByNet, scope}`. Non-RP designs return `props:null`. The caller must first realize all native parts **and all source net/trace declarations** in a routing-disabled `RootCircuit`, then assign the returned three net names and their source traces to phase0 and add `props` as an `autoroutingphase`. The board retains ordinary subsequent routing and full DRC.

The inspected profile is RP2040 block revision4 after actual native legalization, including R1 at local `(1,-5.25,0)` and C15 at `(-5,-8.85,270)`. Paths use actual PCB-port positions and globally allocated references, not assumed reference allocation. Native source graph and component-placement oracles run before path construction. Source/PCB identities, physical pad numbering, pad-to-port association, actual top-layer land contact, and matching graph/net endpoint membership are required.

Pure geometry verification uses the pinned native checks for foreign copper overlap and0.127mm-or-stricter pad/trace/via clearance, drill clearance, board edge margin, cutouts, maximum length and zero vias. Keepouts are projected as foreign geometry for native trace checks because that native keepout checker currently checks pads/vias only. The helper separately verifies that every path vertex is inside the board polygon: the pinned native `checkPcbTracesOutOfBoard` checks proximity to the boundary but does not reject paths entirely outside a distant outline. No source design rule is reduced. Aggregate saved-tree lengths also honor the smallest applicable native limit, bounded by10mm, rather than treating branch lengths independently.

Measured aggregate saved-tree lengths on the derived fixture:

- XIN:9.894285604544498mm
- XOUT:2.2717249999999996mm
- XTAL_OUT:5.640193212182105mm

The fixture is explicitly **derived engineering evidence**: unchanged electrical/source records from actual job `5d729e88-d4d0-4a62-91b0-f912d5986b4b` were combined with the actual revision4 routing-disabled PCB geometry supplied by the coordinator after every source-component and physical source-port identity list was checked for equality. The two revisions change placement hints, not electrical connections. `clock-fixture-{circuit,graph,map}.json` retain this exact input. It is not presented as a newly routed native circuit or whole-board DRC acceptance. The coordinator's actual API retry is responsible for that proof.

`tsx --test tests/blocks-rp-clock.test.ts`:8/8 pass,2.634s. Regressions cover actual geometry, global reference reallocation, world translation, foreign pad contact, drilled holes, foreign vias, top keepouts, a wholly outside outline, off-land ports, physical alias corruption, lost topology, mismatched poses, existing routed copper and stricter native length/width/clearance rules. Strict targeted TypeScript passes. A pure native PCB-style check over these five route geometries reports no issues.

Frozen source SHA256: `2c44de68aff62c6835a288a4b0c14cb0a11b2616656c47a0be6eb887227eb04e`.

Frozen test SHA256: `4f9e9fa59a07b76c840ce6c3a3e637d1c873606ec954152c2a552da86769f4c7`.

No native router/render/compile, production lifecycle change, git mutation or block promotion was performed by this worker. Native full-board routing, final copper continuity, official CLI shorts/style checks, firmware and physical operation remain coordinator gates.
