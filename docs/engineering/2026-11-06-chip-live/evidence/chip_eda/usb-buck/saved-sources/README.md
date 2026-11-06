# Proof-bound native saved-source completion

Actual failed air job `53a0adba-0f2f-41d9-ac61-d43805a2e45e` is captured verbatim here (`capture.json` records original paths, sizes and SHA256 values). These are original failed native results, not passing manufacturing evidence. This worker ran pure official checks only; no new native routing or firmware compile.

The reported error's empty `source_trace_id` was initially misleading. Every actual `saved_phase_null_1_*` prefix already had the correct native compiler source trace. Exactly one ordinary MST join, **`source_net_1_mst7_0`**, had no source-trace attribution. It joins `saved_phase_null_1_0_exit` (U2.1) and `saved_phase_null_1_8_exit` (U2.10), both V3V3. Missing metadata made the native connectivity map treat this joined same-net copper as foreign. Adding only prefix source-net metadata did not fix it; blindly attributing all native routes was rejected as too broad.

`repairSavedSources(circuit,graph,mapping,phase,{nativeRoutingInputs:routingAudit})` now returns a **clone** with `audit` and `unrepairedTraceIds`. It never changes a route, point, width, layer, via, source record or existing error record.

The bounded proof validates:

- The whole canonical native source graph and actual importer physical mapping, using `nativeNetlistIssues` and `nativeComponentPorts`.
- Unique trace IDs and exact two-point saved-prefix matches to compiler fanout/footprint path audits, including phase/path index, selector, start/end/width, graph physical pin/net, actual source component/canonical source port/PCB component/land/PCB port, start binding, named source net and same-subcircuit compiler one-port-to-net source trace.
- Blank saved-prefix metadata can be completed from that proof. Conflicting existing source identity rejects. Unknown blank prefixes reject. Other unknown blank routes remain unmodified and reported as unrepaired, so callers can fail.
- The separately approved join completion is limited to a blank native `source_net_N_mstN_N` route whose **two distinct connectsTo endpoints are verified saved exits on that same physical graph/source net**. The trusted captured `AutoroutingPipelineSolver9_PreloadedTraceGraph` input must uniquely confirm both exact point IDs, coordinates, layer and width. Each native route endpoint must physically contact its audited saved-prefix wire envelope. Only the current constant-width/same-layer all-wire join profile is supported; unsupported or ambiguous data rejects.
- The assigned `source_trace_id` is the actual compiler one-port-to-net source of one proved attached prefix; `source_net_id` is its actual source net. No foreign or invented connection tokens are added.

Default behavior without native-routing input proof completes no join. Callers must treat nonempty `unrepairedTraceIds` as unfinished, regenerate **all** official placement/routing DRC and retain engine/source failures. Passing this helper is not a DRC waiver or proof that the router's geometry is valid.

## Measured regression

`proof.json` contains exact before/after official trace/pad/via errors and the sole record metadata diff. **14 errors → 10**: four false same-net V3V3 overlap/spacing findings disappear. Real **0.052, 0.051, 0.071 and0.107 mm** clearance failures remain, and the count of via/trace failures stays unchanged. Trace geometry hashes match, all original error records remain untouched, and all source records remain identical. The board is still a failed board.

`tests/blocks-repair-saved-sources.test.ts`: **5/5 pass**; targeted strict TypeScript check passes. Tests cover the actual14→10 regression, synthetic loss of14saved-prefix sources, geometry/source/error immutability, idempotence, default no-proof/unrepaired behavior, shifted prefix/width/phase/physical pad/native IDs, ambiguous compiler source, conflicting existing source metadata, wrong join net/endpoints/native capture and missing/duplicated/shifted capture proof.

Reproduce:

```
node_modules/.bin/tsx --test tests/blocks-repair-saved-sources.test.ts
node_modules/.bin/tsx docs/engineering/2026-11-06-chip-live/evidence/chip_eda/usb-buck/saved-sources/record-proof.ts
```

## Pre-pour database integration regression

The source metadata must be repaired **before** the original copper-pour generation. The installed public native `RootCircuitEventName` includes `renderable:renderLifecycle:${RenderPhase}:start` (`eda/node_modules/@tscircuit/core/dist/index.d.ts`, around1989). Installed core `runRenderPhase` synchronously emits the start event before `doInitialPcbCopperPourRender`; that phase depends on completed placement/trace/island/teardrop work. `CopperPour_doInitialPcbCopperPourRender` then queues native work, which calls `db.toArray()` before converting pour obstacles. Thus a synchronous metadata-only DB update at `PcbCopperPourRender:start` precedes the pour's connectivity snapshot. Starts are per renderable/cycle: the handler must be synchronous and idempotent. No asynchronous callback completion is awaited by event emission. Root owns this hook integration.

The converter's exact failure mechanism is **omission**, not intentionally assigning the trace to GND. `convertCircuitJsonToInputProblem` asks for each trace's scoped connectivity key and skips it entirely when absent (`@tscircuit/copper-pour-solver`0.0.67, `lib/circuit-json/convert-circuit-json-to-input-problem.ts`408–413). The blank native join therefore supplies no foreign-copper obstacle, allowing a GND pour to fill its area. Source completion gives it the correct V3V3 connectivity key before obstacle generation.

`pre-pour-probe.ts` derives a pre-pour input from the captured actual failed circuit by removing completed pours and their marking flags only; no trace coordinates, widths, layers or source records change. Official conversion before repair produces **zero** obstacles for `source_net_1_mst7_0`. After repair, it produces **one40-point trace** with scoped V3V3 key, distinct from the GND region key. A bounded official `CopperPourPipelineSolver` regeneration keeps just that actual obstacle and a6×6mm test region: before repair, one solid GND shape with zero holes; after repair, one GND shape with **one clearance hole containing the actual join centerline**. See `pre-pour-proof.json`. This is a bounded geometry witness, not a new full-board route/pour acceptance.

The sixth automated regression also exercises actual `cjuIndexed` (the RootCircuit database's by-ID/by-type setup) and applies the same `db.pcb_trace.update(id,{source_trace_id,source_net_id})` metadata-only writes proposed for the hook. Geometry and all source records remain identical. Official converter/solver output clears the actual join. New test alone≈177ms; **6/6 total tests pass**, targeted strict TypeScript passes. No RootCircuit render, autorouting, firmware compile or full-board pour regeneration ran in this worker.

## Actual hook timing: absent port markers

The first live hook run failed the original requirement for `route[0].start_pcb_port_id`: native DRC adds this annotation later, so the captured post-DRC circuit was stronger than a real pre-pour input. The helper now permits **undefined** start annotation only after the same independent exact audited path, canonical physical source/land/PCB-port coordinate and layer proofs succeed. Present wrong IDs, null or empty-string markers still reject. It never inserts a marker or changes route data.

The pre-pour database/convert/pour regression and `pre-pour-probe.ts` now remove all start/end annotations from the derived actual prefixes before applying the helper. The actual join still becomes a foreign V3V3 obstacle and its centerline is cleared by the bounded regenerated GND pour. An additional test loses all14prefix source IDs with these markers absent: all14prefixes plus the join repair, every route remains identical, and conflicting markers reject. **7/7 tests pass**, targeted strict TypeScript passes. This remains a derived fixture; root will capture the next live raw pre-pour circuit independently.

Helper frozen for root's actual rerun at SHA256 `db1b0e98e2a5153ade3c71969d37fc8ef49d304b06acb4254d87d3c42c2fe9c8`; test SHA256 `9231bb0fd26fa5f91b2e579534d4c65231a0d7b76a1c6d57042f7892171ed72b`.
