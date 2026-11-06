# Actual native owner guard coverage and fixed-clock reference

Pure retained-input investigation. Complete pinned native converter/helper source was loaded from source map SHA256 `512aa13e0cf7fcb8106877d2d15732f41668fb7301683ab6109950ecd364590c`. The previously reviewed owner predicate is the sole in-memory converter counterfactual. No SDK edit, router construction, routing or whole-board physical oracle was run. `.mts` and `.json` contain exact inputs/hashes and per-root trace-owner rows.

## Both-reference-array marker guard

For71e5d163's actual117 simplified native traces and unchanged original SRJ, all27 source owners have nonempty string port-reference and net-reference arrays:117/117 traces covered, no empty arrays.

For coupled d7bdf1b1's117 traces,25/27 owners and115/117 traces qualify. IN1/source_net_2 and IN2/source_net_3 have no physical port references because both native terminals are saved fanout exits. Their net references are nonempty, but they remain legacy under the tested guard. No blind broadening of structural source trust is justified by the minimal-profile result.

## Clock copper missing from converted reference

Both captured inputs have0preloaded traces and exclude clock connection roots source_net_5(XIN), source_net_6(XOUT), source_net_17(XTAL_OUT).111generic clock obstacles carry those exact canonical aliases but no Circuit JSON metadata. Calling the complete native `createPcbPadElements` on each such obstacle returns0elements, because no actual SMT/PTH ID or physically bound current-task PCB port identifies it. The full converted117trace reference therefore contains0clock PCB traces and0clock source owners. Real imported clock endpoint lands remain separate pad primitives; this does not restore intervening wire copper.

For71e5 all5clock-phase literal routes match actual Core PCB trace wire sequences exactly, allowing reversal only. A pure preload counterfactual adds precisely those5actual paths and their source/physical alias sets, then uses the converter's official simplified-trace input path. All5 survive with exact coordinates,widths,layers and IDs. This establishes representation, not routing success. The d7 `circuit.json` capture has no PCB traces, so no actual-Core preload claim is made for that case; its generic-obstacle omission result remains separately measured.

## Native9 preload mutability

Pinned public declarations expose `getUpdatedPreloadedTraces()` and `getMutatedPreloadedTraces()`. Source contains changed preloaded sections, high-density fixed-route replacements, mutation masks, joint DRC repair and replacement reconciliation. `getOutputSimpleRouteJson` combines native fixed/preloaded state and routed output; `getOutputSimplifiedPcbTraces` includes replacement records. Thus a preload is integrated fixed copper for native geometry, but is not a contractual immutable object.

Relevant primary source-map paths:

- `lib/utils/convertToCircuitJson.ts`: `createPcbPadElements` skips unidentifiable generic obstacles; simplified trace conversion retains literal routes.
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator.ts`: merges `inputSrj.traces` with candidates before conversion.
- `lib/utils/combinePreloadedAndRoutedTraces.ts`: explicit `__replaces_pcb_trace_id` removes original preloads.
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts`: preload mutation/replacement lifecycle and public getters.

A future experiment must verify all5clock preloads remain exact and reject replacements/mutations before excluding unchanged preload records from new Core output. Merely filtering IDs would conceal a changed geometry assumption. Source/clock10mm/0via/native DRC/all-net physical gates must remain unchanged. No production change is made by this research.
