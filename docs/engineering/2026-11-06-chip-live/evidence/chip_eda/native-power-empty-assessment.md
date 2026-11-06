# Native built-in power expansion empty-selection assessment

Read-only primary-source assessment by /root/final_review. No native stage or router was run.

The public P7 and P9 pipeline options include `powerTraceExpansion: PowerTraceExpanderOptions`. Both stage constructors obtain `onlyConnectionNames` with nullish fallback,so an explicit empty array remains empty. Their public native PowerTraceExpansionSolver explicitly marks itself solved with progress1,MAX_ITERATIONS1 and bypassed stats when this array has length zero. Its inner solver is constructed first,but clones input traces/options and initial connectivity-safe traces; no expansion/cleanup step is executed after the outer stage is already solved. `getOutput()` returns a clone of those unchanged initial traces. Existing preloaded traces are returned as fixed traces by the pipeline rather than selected for expansion.

This is materially different from supplying only a subset of nonempty names: the inner solver's mutableBlockerTraceIndices includes all new traces that resolve to declared connections,regardless of selected names,so broad native cleanup may shove unrelated new copper.

An explicit empty selection therefore bypasses this broad optional expansion stage. It does not disable earlier native global/jointDRC stages or make their geometry immutable. A later bounded native stage can still receive only actual subminimum routes with all other routes in fixedTraces. Final source,physical copper,all-trace minimum-width and native fabrication checks remain necessary. No native pass,ampacity or native-route causal finding is established by this assessment.

Pinned bundled primary source SHA256: 9424629cc1f77f18fba24335effb5e5fc40da9a15e25aa97213b6c34af47f6fa
