# Native post-route style analysis

Read-only source review, no solver/render/compile run. Input is actual accepted native job `193f6a73-452d-4124-9785-0a14940322b0` (118traces/81vias). It contains six `long_segment_at_odd_angle` native warnings: QSPI_SD3, QSPI_SS, QSPI_SD1, QSPI_SD2, QSPI_SD0 and motor IN2. The measured coalesced segments are6.89–10.85mm, more than the default5mm threshold, with8.03–20.43degrees deviation from a multiple of45degrees. The warnings coalesce many route points, so merely subdividing their straight segments would not repair them.

## Supported bounded candidate

The installed package README explicitly documents `AutoroutingPipelineSolver11_Simplification` for post-route cleanup of existing SRJ traces. Its public options support:

```ts
new AutoroutingPipelineSolver11_Simplification(srj, {
  iterations: 2,
  enableVertexShortcuts: false,
  enableCrossingViaReduction: false,
})
```

This is an existing native solver, not a new route finder. The constructor/runner can use the existing asynchronous solver adapter. It must receive the complete existing copper as `srj.traces`, actual obstacles/outline and the original DRC fields. Preserve the complete source/PCB trace associations and rerun all native source, pad, placement, routing, crystal10mm/0via and copper checks against the actual resulting geometry. Run the unchanged default official PCB-style/shorts checks before accepting a fabrication artifact. No result has been measured for this candidate.

Why disable shortcuts: `MultiSimplifiedPathSolver` instantiates `SingleSimplifiedPathSolver5_Deg45` first. With `enableVertexShortcuts:true`, it then invokes `VertexShortcutPathSolver`, which may replace the45degree result with arbitrary-angle shortcuts. Pipeline11 defaults that optional pass to true. Disabling it retains the native45degree stage output, while turning off crossing-via reduction limits unrelated layer changes.

This is **not a strict45degree guarantee**. The installed Deg45 solver explicitly preserves the original route tail if it cannot find a collision-free45degree replacement (source-map original lines705–734). Pipeline9's main simplification configuration already omits vertex shortcuts (defaults false), so the current warnings are not proved to be caused by that optional pass. Native45degree fallback under crowded geometry is a plausible source; source review alone cannot establish which branch produced each existing segment.

Pipeline11 preserves route endpoints and mixed-width traces. Its own final validator compares counts of internal routing-error categories against the baseline; it is not the final native checker, and its via-clearance parameter is hardcoded0.1mm. The application's stricter rules and physical copper oracle must still run. No public option to select immutable trace IDs was found; constant-width clock traces can also be changed and must retain their native length/via checks.

## Native phase integration details

Core supports `autoroutingphase` with `reroute:true, autorouter:'simplify'`. A **phase-level** `algorithmFn` can select the public Pipeline11 constructor with the options above: phase callbacks override the inherited/preset callback. Putting `algorithmFn` inside `{preset:'simplify', ...}` is ineffective in this pinned core because preset resolution discards that field.

A numbered postprocessing phase is not automatically after implicit remaining routing. `compareRoutingPhasePlans` sorts an unnumbered/null phase last. To add a real postprocessing phase, clock sources could remain phase0, ordinary sources need an explicit phase1, and the reroute/simplify phase can then be phase2. Otherwise phase99 would simplify the earlier clock copper before ordinary QSPI/motor routing runs. A standalone prebuilt-SRJ candidate is the cheaper bounded experiment before a full API rebuild.

## Pinned primary source evidence

Installed `@tscircuit/capacity-autorouter@0.0.1037`:

- README section “Simplifying Existing Traces”.
- `dist/index.d.ts` lines7206–7241: public Pipeline11 options/API.
- `dist/index.js.map` original source `MultiSimplifiedPathSolver.ts` (source index1112): Deg45 selection and optional vertex shortcut pass.
- Source index1109 `SingleSimplifiedPathSolver5_Deg45.ts`, lines705–734: original-tail fallback.
- Source index1600 `TraceSimplificationStageSolver.ts`: endpoint preservation, actual-width awareness and default shortcut enablement.
- Source index1601 `ValidateTraceSimplificationSolver.ts`: baseline/output error-category comparison and0.1mm internal via-clearance setting.
- Source index1570 `AutoroutingPipelineSolver9_PreloadedTraceGraph.ts`: main simplification omits shortcut enablement; mutated preloaded sections explicitly enable it.
- `@tscircuit/core/dist/index.js` lines156427,158795,158999 and159348: phase ordering, callback override, preserved-input simplify semantics and actual solver invocation.

Installed capacity solver JS SHA256: `9424629cc1f77f18fba24335effb5e5fc40da9a15e25aa97213b6c34af47f6fa`.
Source-map SHA256: `512aa13e0cf7fcb8106877d2d15732f41668fb7301683ab6109950ecd364590c`.
