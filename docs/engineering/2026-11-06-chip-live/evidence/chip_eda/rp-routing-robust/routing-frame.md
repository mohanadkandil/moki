# Exact native routing frame experiment

`rotateNativeRoutingFrame(input, quarterTurns)` returns `{input,inverseTraces,audit}`. Coordinates rotate around the origin through exact sign/swap cases; there is no interpolation, rounding, width/layer/source mutation or route selection. This is a private experiment for the coordinator, not a route-success claim.

Frozen helper SHA256: `223194ea19366021490945764e0444a09b852b24f0ccd86e2d6da37c4c584966`. The validated schema supports two/four-layer bounded native SRJs, optional outline, known rectangular/oval obstacles, single/multi-layer terminals including terminal vias, and plain wire/via trace output. Unknown keys/structured constraints, noncardinal obstacles, unsupported route geometry and invalid numeric data fail closed. Each obstacle with an explicit angle retains intrinsic dimensions and rotates its angle. An angle-absent axis-aligned obstacle swaps dimensions on odd quarter turns. Physical layers, widths, source identities, markers and rules remain untouched. Zero-quarter calls validate and return the original reference.

Measured pure tests: 6/6 pass in1.00s; strict targeted NodeNext TypeScript passes. The retained actual fixture is jobd7bdf1b1's723obstacles/144terminals and117 raw native traces. All cardinal rotations roundtrip that complete data without input mutation. Separate tests exercise explicit90-degree intrinsic rectangles, angle-absent rectangles/ovals, bounds/outline, four-layer full-span vias, source/layer/width/marker preservation and fail-closed mutations. No native routing/render was run by this worker.

The suspected ignored-obstacle-angle cause was not confirmed. Primary installed capacity-autorouter source-map paths show:

- `lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver.ts` (used by pipeline7) calls `addApproximatingRectsToSrj`.
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver.ts` also calls it.
- `lib/utils/addApproximatingRectsToSrj.ts` calls `removeAxisAlignedRotation`, which removes cardinal angle and swaps width/height for90/270.
- The bundled power-trace-expander `SpatialObstacleIndex.ts` inverse-rotates geometry queries by the obstacle angle.

A direct public `getSmtPadPolygon` comparison of actual rotated-pill `pcb_smtpad_57` agrees with those world dimensions: intrinsic0.6299962×2.2500082 at90degrees has physical bbox2.2500082×0.6299962mm. The captured native obstacle uses the same intrinsic dimensions and angle. See `routing-frame-pad-proof.json`. Thus converting all explicit-angle dimensions to world dimensions while retaining angle would double-rotate the representation; this helper does not do that.

Acceptance still requires inverse output materialization followed by unchanged native/source/minimum-width/all-net-physical-copper gates. A solver's finite-axis heuristics may behave differently in the transformed frame, but none of these pure tests establishes whole-board feasibility or routing quality.

The first live JS call exposed optional `buses:undefined`/`differentialPairs:undefined` fields omitted by JSON capture. The corrected validator treats undefined known/unknown optional fields as JSON-absent, including nested metadata and absent angle semantics. Defined unsupported constraints still fail with the exact offending field name. The additional actual-data JS regression verifies identical JSON physical representation across all quarters, no input mutation, and rejection when those fields acquire defined values.
