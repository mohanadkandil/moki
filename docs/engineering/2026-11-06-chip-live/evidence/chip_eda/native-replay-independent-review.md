# Independent native replay review

No actionable findings in the frozen loader and private offline integration. Reviewed loader `e5174ea9…acc62`, build `e3c47996…a8f455`, and runner `b408aab3…ff344a`; full hashes are in the JSON receipt.

The loader binds the current SRJ and six current compilation artifacts to the captured source, checks the raw output SHA, and returns all 117 native records without rewriting them. The private worker shim applies only to the exact build script. HTTP inputs and worker environment expose no replay option. The caller still runs fresh materialization, source attribution, pours, DRC, physical/pad verification and sandbox compilation. The receipt explicitly identifies captured output reuse rather than fresh routing.

Nine focused tests and strict TypeScript pass. Independent probes used distinct source/current jobs, rejected a tiny SRJ edit, a changed placement, rehashed 0.106 mm copper and an executable manifest field, and confirmed old gate canaries were not inherited. Actual fresh job `a81367d2` reached—and failed—the former source-proof gate, providing direct evidence that the offline path did not skip it.

This is scoped loader/integration review, not full-board acceptance. The reviewer did not run native routing, render, compile or a server. See `native-replay-independent-review.json` for exact hashes and evidence boundaries.
