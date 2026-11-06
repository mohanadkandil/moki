# Incremental independent code review

Current scoped verdict: no unresolved confirmed finding after the fixes recorded below. Whole-board native and hardware acceptance remain separate.

Two confirmed P2 electrical-checker gaps require changes. Both concern composite blocks rather than the separately instanced seed-bus regression cases. Exact source hashes and replay details are in `final-review.json`; clearly synthetic reproduction is `final-review-i2c-repro.mts`.

1. The unused-I2C exception only tests externally linked port IDs. An explicit internal I2C net joining powered MCU and sensor pins within one block has no plan link and therefore passes without any pullup resistor. Require pullups for an internally active multi-component bus while retaining the unused single-MCU mux exception.
2. Connected analog direction validation excludes every peer in the MCU's block instance. An ADC-only MCU driving an explicit analog input on a second internal IC then passes without a DAC. Derive peer direction from actual root/component ownership, excluding the MCU own physical component rather than the whole instance.

No additional confirmed finding in the narrow C50506 title alias, read-only hash-validated bundled receipt fallback, or actual-target chip compile metadata. Prior captured identity/replay evidence was reread; no redundant full-suite or native run was performed.

The separate full53 plan delta review permits pre-layout evaluation only under its known5V/1.5A USB assumptions. It does not close any native/hardware/manufacturing gate. Native clock/ground helpers are outside this snapshot and will be reviewed when ready.

RP4 placement amendment: exact new plan hash `7416fdaa…fdb045e` independently checked. Only R1/C3poses plus revision/hash change from RP3; fresh public ERC/power pass. The previous RP3receipt is archived alongside the new receipt. This retains all supply/motor/thermal/native limitations, including that C3origin compliance does not prove a short high-frequency bypass loop.

## Fix verification and ground-plane adapter

Both original synthetic reproductions now reject with their specific electrical rule: internalI2C reports missingpullups onSDA/SCL, and internal analog consumer reports missingDAC direction. The implementer now follows actual same-net/component ownership rather than only external port links/whole-block boundaries. Independent focused run of ERC,analog-direction and ground-plane tests passes53/53,zero skips,in1.502s. Earlier P2findings are closed for this reviewed source snapshot.

No additional confirmed finding in `eda/blocks/ground-plane.ts` and its four captured-input regression tests. It proves canonical/repeated-pad logical ownership using native internal records,accepts only actualGND singleton bottom-plane connections,clones the input and adds only proven alias ownership. Geometry,connections and fabrication rules remain unchanged; via-in-pad stays disabled. The adapter calls the installed native FanoutSolver and rejects failed/partial output or incomplete solver counts. Native same-net merges and outward pad-normal directions are configuration choices; final nativeDRC and physical copper continuity remain hard downstream checks. The retained worker61-connection native replay is supporting evidence,not a whole-board acceptance or an independent native run by this reviewer.

RPclock helper review remains pending its completed implementation.

## RPclock profile review

The frozen clock helper source and eight pure regressions pass this scoped review; independent rerun passes8/8 in2.413s. A separate off-copper PILLcorner mutation0.1515mm outside actual capsule copper correctly rejects its physical endpoint contact. The helper is a finite saved-geometry profile,validates native source/pad/world identities,preserves three original named nets via fiveN−1 paths,and enforces summed native length limits,zero-via top paths,minimum width and physical clearances. The derived source/PCB test fixture is labelled correctly and is not a new native build.

One integration P2 remains: `build.ts` calls this profile for everyC2040part,while the helper rejects block IDs other thanrp2040-minimal@>=3. That prevents a distinct agent-authored RP2040reference circuit from reaching generic native routing. Scope the optional profile invocation to its known cache definition; preserve generic native routing and hard DRC for other RP2040blocks.

The optional-clock integration finding is now closed: reread root invocation is limited to the knownrp2040-minimal revision3/4 definitions. Differently authored RP2040blocks retain ordinary native routing and hard DRC. No unresolved confirmed finding remains in this scoped review. Root current RP4/motor2 job reports all eight gatespassing; that job was not run by this independent reviewer,and official post-route/hardware checks are outside this review snapshot.


## Automatic placement and mixed sensor routing phases

Incremental source review and29 focused pure regressions pass (zero failures/skips,3.486s). Actual footprint-envelope fixtures check explicit board/anchor preservation, automatic compact rounded bounds, antenna keepouts, unchanged source graph and constrained legalization. The compiler saves resolved geometry separately; the original electrical plan/hash stays unchanged. The final API verifier reads actual native receipt dimensions, so an unknown boardless input cannot silently count as a checked size.

One P2 was found and fixed during review: the packer originally ignored the supported `board_size_mm` operator `within`. An actual six-block fixture requiring20×20mm packed50×58mm, although the final physical verifier would reject it. The independent saved reproduction now asserts early rejection of20×20mm and successful within52×60mm packing/verification with untouched requirements. No unresolved confirmed finding remains in this incremental snapshot.

The new SHT pretrace allowance retains only the exact four compiler footprint paths after actual source/net/subcircuit/port/pad identity and finite cardinal geometry validation. Default arbitrary routed copper rejects. Native foreign copper, hole, keepout, edge/cutout clearances and foreign-net proposed-exit collision checks remain active. Mixed routing phases may contain zero,one,two or all four original sensor endpoints; the pure helper clones inputs and leaves unrelated points/obstacles intact. These are source and pure/derived-fixture results,not a whole-device native routing or hardware pass.


## Exact saved-source attribution, pre-pour update and diagnostic refresh

No confirmed new finding in the reviewed helper and current integration. Six focused regressions independently pass in2.360s,including immutable literal saved-prefix proof,canonical physical/source/net membership,unique captured Pipeline9 saved-exit join proof,wrong-identity/net/width/capture rejections and retention of real physical clearance failures. The helper changes only source metadata and fails closed on unproved blank traces.

Installed core source confirms the lifecycle start callback emits synchronously after routing dependencies,before the copper-pour converter. Updating native DB trace source IDs at that point makes the actual foreign3V3join appear as a GND obstacle. The bounded derived6×6mm official converter/pour regression changes zeroholes to onehole while preserving actual route coordinates and all source records. It is not whole-board native or hardware acceptance.

An independent mutation executes the exact current diagnostic-refresh block extracted frombuild.ts (hash recorded inJSON). Three unmatched synthetic engine/source/trace failures survive. Actual0.052mm clearance failure remains; attribution-only accidental unnamed contact disappears; all physical geometry and source records remain identical. Official placement and routing checks are regenerated,without broad type-based filtering.

The experimental mixed-sensor platform callback,0.22mm obstacle-only margin option,and dense-first ordering were removed after native routing failures. Final source reread confirms plain `new RootCircuit()`,USB-first ordering,and the pre-existing RP native adapter are restored; no experimental phase fabrication floors remain. Ordinary smaller4layer air boards retain native GND hypernets; specialized single-port ground treatment is restricted to more than40ground terminals,and the physical GND oracle now gates all4layer outputs.

The separate four-layer air prelayout receipt binds exacthasha854b3f25ad201985ba5286ab0301c89a72662771813467b0efe5fd318670d8b. Actual plan deep comparison proves onlylayers2→4; freshERC/power pass. All USB/current/thermal/functional and native acceptance limitations from the earlier electrical review remain.


## Final phase-order and schematic note delta

No confirmed P2 in this source snapshot. After rollback, all retained explicit phases use USB at offset,dense exits at offset+1,and specialized GND when enabled at offset+2. These phase IDs are distinct with or without the preceding clock phase. The failed mixed dense-first experiment is not retained. Unassigned connections remain in the native implicit remaining phase; fabrication minima are unchanged. Repository code has no consumer of the previous routing-plan field.

All notes and the full reference now wrap into a measured section height. Row placement uses the maximum section height plus30px, and final document height includes all expanded rows and footer. Unicode/token and XML-sensitive text remain complete, with caller escaping intact. Five focused pure text regressions independently pass in0.194s. No native route/render was run for this delta; regenerated schematic visual inspection and actual mixed-device physical acceptance remain separate.


## Pre-pour absent port marker correction

No confirmed issue in the narrow frozen delta (`db1b0e98…`). Before late native DRC adds endpoint markers, an absent start marker is accepted only after the same exact literal saved-path, canonical physical/source port, coordinates, layer, named net and subcircuit proof. A present incorrect ID, null or empty string still rejects. The helper invents no markers and changes no route geometry.

Seven focused regressions independently pass in2.609s, including marker-free lost-prefix recovery and the derived pre-pour indexed DB/converter/pour proof after stripping late markers. The current native job had not yet emitted its raw pre-pour capture at inspection time, so this receipt remains source and bounded fixture evidence, with no new whole-board acceptance claim.


## Fresh native artifact and strict-TypeScript receipt refresh

Read-only inspection confirms actual job448386df completed in82.279s. Its raw pre-pour capture has14saved prefixes,all14without late start-port markers. The synchronous hook attributes exactly the actual V3V3saved-exit join; post-route repair is empty and no trace remains unproved. Raw-to-final and prior-fixture trace coordinates,widths,layers and route types are identical.

Native errors decrease17→12: four false same-net unnamed contacts disappear,while the actual foreign-trace GND pour short is prevented. Three real clearance errors merely gain proper trace names and remain; all12real violations still block acceptance. Sensor-copper checks pass and the async-error list is empty. This verifies the source-hook integration without claiming board acceptance.

The final helper hash26fc26a0… changes only static narrowing: each native mapping entry is validated before returning a string,instead of mapping then rejecting missing entries. The RPgenerator pin24non-null assertion follows existing1..57population and erases at runtime. No confirmed new finding. Root reports full907/907tests,41focused tests and both typechecks passing; this reviewer did not rerun those broader checks during receipt refresh.


## Independent RP integration, compact packing and physical attestation

This increment independently reviews root/other-worker code. The newly authored `repair-native-exits.ts` is excluded from this independent verdict; its separate author proof is in `native-exits-proof.json`,and the parent reviews it.

One P2 integration mismatch was found and fixed: native saved fanout resolves its follow-up through the `default` preset,so mapping only `auto` missed the intended DRV planning wrapper. Both now use the public native wrapper. Extra0.25mm obstacle margin is conditional on an actual mixed-width phase; pure0.15mm signal phases keep pre-existing planning. Fabrication minima stay unchanged. No unresolved confirmed finding remains in this reviewed root snapshot.

The actual composite USB selector now chooses J1,R7,R8 and four connector/CC nets,excluding unrelated clock/QSPI/application signals. Clock0,USB1 and merged saved exits2 remain distinct. Pre-pour and post-route integration handle both trace and via metadata audits. Fresh diagnostic checks preserve unmatched failures. Fatal native routing failures retain original native evidence and report source attribution unchecked;routing success still requires complete proven sources.

Twenty-one focused regressions independently pass in8.127s. The actual55×40packing fixture rotates RP90degrees and reduces only optional legalization reserve to zero,then legalizes actual footprints inside the unchanged outline. Explicit anchors,requirements and electrical data remain intact. Four-cardinal candidates and1/0.5/0reserve fallback do not relax final physical constraints. The1.5mm gap is a packing rule; final legalizer movements remain separately constrained.

Rotated-pill attestation retains complete source/import/physical-pad and annular-drill checks. DRV exits retain exact physical pin/source/width/pose proof and check actual foreign-pad geometry independent of copied net labels or native free-end contact inference. These captured geometry and mutation tests do not establish a whole-board native pass. Current three-job routing acceptance remains with the parent.


## Independent review of later compatibility fixes and RP phase selection

No confirmed new finding in the other worker's `bc13e2f9…` compatibility patch. This independent scope covers only those later changes; the reviewer authored the original helper,which the parent/other worker reviewed. Four selected changed-area/guard tests pass in1.349s. Finite1e-7mm port-binding tolerance does not relax literal path geometry. Shared vias require exact already-proved same-net saved barrel identity,dimensions/full physical span,key and actual annular contact; arbitrary coordinate ownership and wrong metadata still reject. An independent alternate via-to-wire representation test preserves geometry and rejects an unproved owner. Official Gerber conversion confirms these segments carry copper even without redundant coincident wire vertices.

Six pure RP phase-selection tests pass in0.202s. Clock and saved-fanout ownership precede early signals; full-net power/ground roles remain authoritative. The reviewed build inline ordering applies the new early set to4layers only,with clock0,critical signals/USB1 and merged dense2. The pure helper is reviewed,but its final root call integration was not yet present in this snapshot. No whole-board success follows from this source review.

Actual power-failure capture2a502937 identifies source_net_0asV3V3 with24endpoints,and point64asU2flashVCC at(-4.155,0.780092). Twenty-four early signal traces are fixed in that phase input. The internal MST9pair is not exposed,so no exact collision is claimed. Read-only facts and the bounded strategy inference are saved in `final-review-power-capture.json`.


## Joint-prefix integration, failure diagnostics and actual preload movement

The reviewed root integration joins14RPpower,10RPsignal and9DRVprefixes in phase2 on2/4layers,with clock0 and externalUSB1. Audit/path order and physical selector ownership remain aligned. The RP selector now fails closed if any connected signal net is still unowned. Another worker reviews the new signal profile; this independent verdict covers caller integration only. No additional confirmed coverage issue.

A P2 cancellation race in the new diagnostic callback was found and fixed. An exact-source wrapper reproduction with a fake failed solver first emitted a late error afterstop during diagnostic I/O. The added post-await guard now produces zero late events; a diagnostic-save exception still preserves the original native error. No native solver ran in this reproduction.

Actualdad50c failure metadata identifiesVBUSsource_net_18_mst4 betweenUSBLC6U4pin5(-8.25,13.399096) andC17pin1(-6.950024,16.25),bothtop at0.3mm. Ten earlier automatic USB/CC traces are preloaded in that phase. Installed native contracts explicitly permit regional rerouting/splicing of preloaded copper; saved fixed clock/stubs instead become obstacles.

Read-only comparison of actual9fab input/final traces confirms30preloadIDs retained,26changed route records,and at least19definite centerline changes. Some USB routes move more than1mm; a VBUS route moves2.377mm from its previous polyline. The saved reproduction excludes mere point subdivision by checking distance to every original same-layer segment. This supports removing earlier automatic preloads through joint routing,but does not establish a new native pass. Compact receipts retain exact pair and artifact hashes. Upcoming USB-prefix integration remains outside this snapshot.


## USB and complete joint-phase integration

No confirmed new finding in the USB exit helper and full caller integration. Four focused USB/source/foreign-geometry regressions independently pass in2.006s. USB6protection-chip and2CC exits preserve actual source widths and exact physical source/net/land correspondence. Prior clock/power/signal/DRV geometry and independently owned foreign pads remain checked. No DRC waiver.

Actual134193af preflight artifacts have42paths,42audits and42unique physical selectors in jointphase2. Clock staysphase0; USBearly and specialized ground phases are disabled for knownRP. All27nonclock nets are selected,including data-driven R2pin2handoff for internalBOOTSEL. This reviewer authored that producer,so gnd_escape independently reviews it and the binder; the producer is excluded from this independent verdict. Separate `native-handoffs-proof.json` records six passing tests and the remoteSW2-still-unrouted native check.

Five router adapter protocol tests pass in1.528s against the exact transpiled module and fakeSOLVERS only. They check run/start idempotence,pending promise/single completion,synchronous output,original error preservation,and cancellation during both native step and diagnostic I/O. No real native solver is instantiated. Whole-board native routing and final physical acceptance remain parent-owned.


## Independent SMT via-planning mask and hard width gate

No confirmed new finding in the root-authored mask/current caller integration or the other worker's absolute minimum-width gate. Nine focused pure regressions independently pass in0.662s. An additional independent actual302-obstacle probe adds183SMT columns while preserving every original obstacle and the original trace/connection references. Hostile component,off-board net,assignable-net,copper-pour and cached-layer aliases are stripped from every projection. All retained projection fields belong to the pinned public native Obstacle interface.

A one-layer SMT land projects onto all remaining physical layers. Every distinct two/four-layer via transition therefore meets a foreign column while the own-layer land contact remains accessible. Fixed47profile copper and actual board geometry/rules are unchanged. The mask conservatively also reserves inner/bottom routing below lands; no successful route follows from this source proof. Final physical via/pad and fabrication gates remain hard.

Fresh routing uses the projected native input. Private captured-output replay can match either the exact old base input or the exact projected input; it records which one was reused and still requires all fresh physical gates. It does not pretend an old native capture used the new mask.

The hard width checker rejects actual134's0.106066mm one-port VCORE trace that official source-thickness checking skips. It inspects all traces,both tapered endpoints and explicit layer transitions,without changing copper or metadata. Only coincident finite contacts within1e-8mm have no free-wire extent; involvement in a larger thin wire still fails. No native solve or whole-board acceptance is claimed.

The separately authored `robust-routing-checks.ts` is excluded from this independent verdict and has its own implementation proof pending independent review.


## All-net physical oracle and existing canonical-join deferral

One confirmed P2 was found and fixed in the pre-existing geometric ring converter: native BREP vertices may contain a nonzero bulge,but the oracle silently chords that edge. The independent tiny inward-semicircle reproduction reports A/B physically connected even though native copper geometry excludes A. Evidence is `all-net-bulge-independent-probe.{mts,json}`. The final guard rejects unsupported nonzero/nonfinite/malformed bulges before approximation. Current actual55capture has no such curve,so this finding does not invalidate that particular geometry.

No additional confirmed issue in the new all-net selection or canonical-join deferral linkage. Deferred existing joins receive no source metadata changes; blank joins and saved prefixes retain strict proofs. Source IDs never join physical copper. Ground-default API,actual ground-role groups,inscribed/circumscribed DSUs,drill subtraction and physical annulus guards remain.

Twenty-seven copper tests pass; the opt-in new actual all-net board test stays skipped. The legacy suite unexpectedly includes an unconditional old captured ground oracle,which ran7.7s; no router/compile ran. The selected new source-deferral test passes. An exact production build-guard extraction checks14 tiny success/failure cases across2/4layers: unchecked,wrong scope,missing/extra/missing-network and non-ok results reject,while unknown oracle throws propagate. Actual net-name coverage and passing physical result are required before successful DRC receipt and API/testBlock firmware compile. All-trace minimum-width and native clearance checks remain hard.


The final narrow bulge guard is independently verified: the original curved-edge counterexample now returns `ok:false` with `copper-geometry-unverified`; unchanged native curved/straight contact controls still show the geometric difference. Two selected new regressions independently pass in0.653s across BREP outer/inner and polygon-pad locations,including tiny/nonfinite/string/null bulges and preserved zero/absent straight edges. P2 is closed. No remaining confirmed finding in this incremental source scope.


## MCU cardinal orientation and narrow native width refinement

No confirmed new finding in the current root-authored changes. Only unanchored MCU variant lists are sorted by section-to-board aspect fit; explicit anchors bypass that loop and antenna restrictions remain. A selected two/four-layer65×55regression passes. Independent pure re-packing/legalization with captured actual pad coordinates reduces summed cross-section HPWL380.088→335.900mm(11.6%),but GND/VBUS estimates rise. This supports a bounded geometry heuristic; it does not prove90degrees alone improves native routing. Net-weighted actual-terminal HPWL over complete candidate packings is a useful future connectivity-based criterion.

Six narrow width regressions independently pass in0.216s. Public native fixedTraces are indexed as immutable spatial copper without mutable trace indices; conforming same-net siblings also stay fixed. Actual8e46before/after files retain117IDs/order and change exactly two thin GND routes. All115other complete native records remain deeply identical. Minimum native wire width rises0.106066→0.15mm; the second pass consumes only optional planning reserve down to unchanged fabrication clearances. Fresh Core preserves all117copper geometries,with61route-order reversals for endpoint annotation and no point/width/layer/via movement.

Read-only proof is `native-width-independent-comparison.json`; geometry/HPWL probe is `orientation-independent-probe.{mts,json}`. Actual8e46still has217native errors and22physical all-net issues,which remain blocking. No native solver/compile or new full-board physical oracle ran for this review. The new optional RP application/USB-via profiles are outside this independent snapshot.


## Current fail-closed build integration and native empty power selection

No confirmed new finding. Exact production error-collection extraction retains eight failure categories,including original native/async errors when fallback trace artifacts exist. Refreshed physical-gate extraction retains all14two/four-layer success/failure cases. Unknown oracle throws remain fatal. Public API DRC and testBlock gates stop before firmware compile. Actual7c9failed output has both its original routing marker and async failure; actual8e46has217native/physical errors and remains failed. Having exported debug artifacts does not produce an accepted job.

Current default/caller/audit use nativePipeline9; auto/default mapping,fresh SMT masks,all-net physical continuity and absolute wire minima remain hard. Source deferral remains limited to existing canonical joins and linked to the mandatory all-net oracle. The coupled optional profile is separately reviewed by gnd_escape.

Read-only pinned public source confirms `powerTraceExpansion:{onlyConnectionNames:[]}` bypasses the built-in broad expansion/cleanup stage in bothP7/P9. The stage marks itself solved immediately and returns unchanged cloned initial traces; earlier native stages still run. A nonempty subset differs because other declared traces remain potential mutable blockers. This option assessment is in `native-power-empty-assessment.md`; no code change or native execution was performed for it.


## Minimum-width-only public native option integration

No confirmed new finding in the new root-authored option/caller/audit. `minimumWidthsOnly:true` supplies the documented empty power-expansion selection to either public native constructor. Undefined/false retain previous options. RP production callers alone enable it,and always retain outer native underfloor repair plus independent all-trace minimum,source,all-net physical and fabrication gates. Fresh audits record the exact applied options; private captured-output replay retains its explicit reuse receipt instead.

The exact fake-native adapter regression independently passes in1.420s and verifies outer repair still runs for allthree flag states. Targeted strict TypeScript passes with zero diagnostics after selecting the ESNext standard library required by imported Node22-capable dependencies. The actual pinned-stage geometry regression's final ESM-boundary import rerun and full application typecheck are parent-owned evidence. No native stage/router,compile or broader suite ran for this incremental review.


## Circular-via remaining-collar certificate

No confirmed scoped finding. Six focused pure regressions independently pass in0.775s. Only centered circular actualvias can gain the certificate. Upper-bounded own/foreign drill voids and lower-bounded copper establish a full positive collar,which must lie inside exactly one remaining lower polygon on every physical layer. Tangent/wall-reaching/destroyed/inner-layer/detached/off-centre/non-via andforeign-contact cases reject. No source/net label or claimed flag restores copper or joins layers.

Independent receipt is `annular-collar-independent-review.{json,md}`. Geometry,rules and native DRC remain unchanged. This is a physical continuity proof,not an annular-width/fabrication/hardware qualification or whole-board pass. Parent fresh actual all-net and native/fabrication gates remain necessary; no whole-board oracle or solver ran for this review.


## Native clearance semantics and completed-with-violations output

The proposed0.1mm via-clearance rootcause is rejected by pinned primary source. Fastnative trace-via checks use declared traceClearance; viaClearance controls via-via copperpairs. P9effort callback retains declaredtraceclearance. The actual0.114997mm VBUS/GNDpair is below declared0.15,but no internalfinalscorer counts exist to prove a missedpair ratherthan retained best-invalid output.

NativeJoint9bounded repair canpublish best routes with nonzeroissues,and completion's newcontact guard isnotallclearancezero. Cleanup validates improvements while retaining an initialbaseline. Thussolved nativeoutput stillrequires hardfinalgates. P7's separate0.1trace evaluator is aprivate-engine difference,not justificationforpatchingdefaultP9. Read-only receipts are `native-clearance-semantics-assessment.{json,md}` and`native-clearance-pair-assessment.json`. No SDKcopy/patch,router/evaluator run orDRC change wasperformed.


## Signal-ranked automatic placement and private minimum-profile caller

Eleven focused pure regressions independently pass in1.250s. Canonical cross-instance nonpower nets rank feasible candidate component-origin placements; per-part aliases are deduplicated,and MCUaspect/antenna/explicitanchor policy remains. All footprint,keepout,board andgap checks run before ranking. If the greedy signal choice blocks a latersection,the complete legacyfirst-fit strategy retries at the sameboard/reserve. The actual44×56case stillfits. Actual65×55driver facesright at90degrees with component-centre signalHPWL70.75versus114.75priorgeometry; no native routability claim.

One private-caller proof-coverage gap was found and fixed: pad-escapeRP withoutDRV generated paths but skipped nativeExitPhases registration because rpEscape was intentionally null. The guard now includes allknownRPprofiles. An exactTS-AST production-block probe verifies privateRP/noDRV plus fivecontrolcases,including completeaudit andartifact capture. Physical/width/DRC gates were never bypassed,and the threecurrentmotorcases were unaffected.

The privatevariant retainsclock/DRV and contained handoffs,omits only additional SMTshadowcolumns,and keeps allrealnativeobstacles. Planningmargins grow; fabrication rules and native no-via-in-pad policy remain. All-net physical/source/minimum-width/finalnative gates staymandatory. PublicHTTPcannotenable the privateflag; receiptlabels it diagnostic. This review excludes this reviewer's authored handoff producer and GND's separate routing-frame scope. No native route or wholeboardoracle ran here.


## Known component ownership and virtual-port assessment

The complete pinned pure converter confirms a bounded source-inference hazard: a declared physical foreign endpoint inside an explicit GND land imports GND source aliases when netIsAssignable is true; false blocks that case. Zero-physical-port branches still import under either flag, so locking alone is insufficient. No actual routed rootcause improvement is claimed. The new locked-pads helper and tests are authored by this reviewer, with independent review delegated to gnd_escape; see locked-pads-author-proof.json rather than treating this receipt as self-approval.

The proposed original PCBport ID on a virtual exit is rejected. A complete-converter counterfactual on actual71e5 R3.1 moves pcb_port_104 by0.2mm to the saved-exit coordinates. Both native physical-port construction and position-map semantics use those coordinates. Existing sourceproof deliberately requires virtual exits to lack pcb_port_id and proves their canonical original ports separately. The immutable pure counterfactual is virtual-exit-port-counterfactual.{mts,json}; no router, physical-oracle or native acceptance run occurred.


## Separate native endpoint-inference limitation

An independent complete-converter counterfactual confirms that restricting source-owner inference alone does not fix every native overlap exemption. In both zero/one physical-port controls the guarded converter retains no foreign GND alias; the subsequent public overlap checker adds end_pcb_port_id=pcb_port_56 at the bad endpoint, then returns no issues. Native-endpoint-inference-probe.{mts,json} captures the before/after route metadata. This remains an upstream diagnostic limitation, not an acceptance waiver. The source proof and mandatory all-net physical copper oracle remain decisive. No native router or whole-board oracle ran.


## Private pinned native owner guard

Independent module review finds no actionable scoped issue. Six focused pure tests pass in3.193s; targeted strict TypeScript passes. The copy changes one hash/version-pinned source predicate, preserves other native code after audited static import relocation, rejects changed dependency entry semantics and cache tampering, and leaves installed SDK files untouched. Complete native-converter controls cover foreign/own/unowned and canonical zero-port MST ownership. The separate endpoint-inference limitation is explicitly retained.

Receipt native-owner-guard-independent-review.{json,md} excludes this reviewer's authored pad-lock producer and the not-yet-present parent guarded-constructor caller. No actual routed improvement or acceptance is claimed, and no solver or whole-board physical oracle ran.


## Private native owner guard v2

No actionable scoped finding. Nine focused tests independently pass in11.470s and targeted strict TypeScript passes. Both exact pinned runtime marker arrows filter only their annotation-local trace list for unique structural owners; they preserve every CJ/source/route record and existing marker. Unknown/empty/duplicate owners retain native behavior. Complete copied-runtime contact controls pass, and original plus guarded SDK constructors coexist at zero iterations with the private hash-pinned utility registry.

Current private CLI/constructor linkage retains explicit provenance and mandatory canonical-source, all-net physical, width and native/fabrication gates. Receipt native-owner-guard-v2-independent-review.{json,md} records exact source/caller hashes and scope. No routing job, solver iteration, whole-board oracle or native acceptance claim occurred; the authored locked-pad producer remains separately independently reviewed by gnd_escape.


## Immutable native clock preloads

Final helper review passes: eight focused tests0.679s, strict TypeScript and both independent mutation repros reject. Initial P2 allowing changed/replaced unrelated preloads in returned output is fixed across all expected IDs; only the five clock duplicates are stripped. Exact canonical getters/output checks, immutable expected snapshots and renamed compiler owner controls retain every input record and fabrication constraint.

Receipt immutable-preloads-independent-review.{json,md} records the resolved finding and exact hashes. Caller clock semantics and integration remain separate responsibilities; no native solver iteration, routing job, physical oracle or acceptance claim occurred.


## Clock-preload caller and authorized binder fixes

The actual974 lifecycle falsifies current-CJ trace selection: the callback has zero rendered PCBtraces. Historical71e5 selection evidence is explicitly logic-only. Root replaced that path with the real public phase0 event and canonical current source declarations. Adapter verification-before-capture/width/completion and fixed-clock width arguments independently pass their bounded probes; final full gates stay mandatory.

Two binder gaps were independently reproduced and then fixed by this reviewer under root authorization: duplicate/missing same-net profile branches, and foreign connectsTo aliases. Full profile bijection and unique complete same-clock-net actual physical aliases now reject both original counterexamples. Six actual-fixture regressions2.197s and strict build/new-test TypeScript pass. This patch is authored work and awaits separate independent review; clock-preload-caller-author-proof.{json,md} records the boundary. No routing acceptance or native/whole-board run occurred.


## Optional ground caller and private replay exclusion

Narrow source review finds no ground-caller defect: private flag dependencies, literal two-path/netname/audit transfer, GND handoff exclusion, low-current source widths and joint-phase source registration remain consistent. Every actual physical/source/native gate stays mandatory. This excludes geometry-helper reapproval and native routing acceptance.

The root separately read and approved the authored binder fixes. A newly authored guard rejects native-output replay with immutable-clock mode, since that path cannot supply live getter verification. Its exact-AST truth table passes with seven clock/guard tests1.972s and strict build/new-test TypeScript exit0. Receipt ground-caller-and-replay-review.{json,md} records independent versus authored scope; no native/whole-board execution occurred.


## Private clearance caller and diagnostic failure handling

No scoped finding. Actual-board and loader-option assertions, diagnostic-writer failure and diagnostic cancellation controls pass in four pure tests1.749s; root no-publish regression independently passes1.495s. Strict new-test TypeScript exits0. No source/default-routing or final physical/fabrication rule is changed by the caller boundary.

Receipt clearance-caller-diagnostics-independent-review.{json,md} excludes the subsequently introduced optional refined-clock helper/caller. That integration remains a separate review/typecheck checkpoint. No native or whole-board execution occurred.
