Clock preload caller inspection and binder patch evidence

The root-authored adapter verifies both public preload getters and returned clock records before capture, width repair or completion. Independent fake-adapter mutation controls and fixed-width-input controls pass; full native/source/all-net/width/fabrication gates remain. These checks do not establish a native routing pass.

The initial current-CJ clock selection does not work at the actual callback: job97402c60 has no rendered PCBtrace records. Its actual public phase0 event carries the literal five clock paths. The corrected capture clones that event, and its source binder adds only actual canonical source-trace/subcircuit identity. The historical71e5 selection probe is explicitly post-global logic evidence.

This reviewer then authored two authorized binder corrections: bijective coverage of the five verified profile paths, and unique complete actual same-clock-net ownership for every connectsTo alias. Geometry, IDs, alias order and existing metadata are preserved. Six focused tests pass in2.197s and strict build.ts/new-test TypeScript passes with zero diagnostics. Actual974 event plus zero-PCBtrace source projection, duplicate-path/foreign-alias repros, source/copper mutations, callback cloning and compiler-renumbering controls are retained in the formal regression.

Exact binder/test/fixture hashes are in the companion JSON. Separate independent review has been requested from GND; this is author evidence, not self-approval. No native routing, solver iteration or whole-board oracle ran here.
