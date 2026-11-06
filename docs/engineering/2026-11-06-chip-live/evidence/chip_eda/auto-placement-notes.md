# Automatic block-section placement

`eda/blocks/auto-placement.ts` owns compiler anchors for instances whose `at` field is absent. Its API is `placePlanSections(plan,graph,imports,options?)`, returning an effective plan clone, regenerated graph, placement metadata and `boardAuto`. Production callers use the three required arguments; captured actual envelopes can be injected for pure tests.

Geometry comes from the existing trusted `footprintEnvelope` converter and each part's local pose. Every declared keepout joins the reserved cluster extent. The bounded deterministic packer reserves1mm local legalizer room and1.5mm intercluster spacing, checks rounded outlines, and puts a missing-anchor MCU antenna keepout at the top edge. Explicit poses are retained exactly. Missing board dimensions are chosen compactly; confirmed `board_size_mm <= [W,H]` requirements bound that search, and requirements are never changed. Explicit boards retain their exact size and radius.

An explicit instance's primary fixed anchor and keepouts must fit the board. Existing secondary-part overlaps are delegated to the existing hard legalizer, which may move secondary parts but never the instance's primary anchor. This preserves compatibility with the actual manual USB source, whose secondary connector originally needs a small inward legalizer adjustment. Automatically assigned clusters start with all physical envelopes inside the board. The final native DRC and actual geometry checks remain mandatory.

Measured pure replay of the owner's actual six-block30-part air-monitor source:

- Remove every instance anchor, retain70×80mm board: automatic anchors in15.8ms; the existing legalizer then passes with10 secondary changes. The MCU antenna keepout reaches the top edge and its actual physical module remains inside the0.15mm edge screen.
- Remove anchors and board: compact50×58mm board,2mm corner radius, selected in160ms; the legalizer again passes with10 secondary changes.
- Explicit80×90mm rounded board also passes the pure packing/legalizer regression.

The113KB `auto-placement-fixture.json` retains the exact30 trusted imported footprint envelopes and referenced block definitions, so tests do not depend on mutable temporary files. Capturing those envelopes used converted component properties only: no RootCircuit render, solver, HTTP request or firmware build. `auto-placement-70x80.json` and `auto-placement-board.json` retain the effective compiled plans; these are diagnostic placement evidence, not accepted native jobs.

**7/7 focused tests pass** in845.7ms; targeted strict TypeScript with `noUncheckedIndexedAccess` passes. Regressions cover deterministic compact sizing, two explicit board sizes, partial explicit maker anchors, actual keepouts, confirmed limits, impossible dimensions with numeric envelope errors, absent/invalid geometry, input immutability, unchanged source nets/reference allocation and preserved import-part object identity. No native job was run by this worker. Root owns integration and the actual native routing/DRC proof.

Scope: the packer places immutable block-instance clusters in deterministic input order and records each cluster's schematic section ID. It does not rewrite a block's internal layout or electrical data; the existing legalizer handles internal secondary-part collisions. Group bounding boxes are conservative, so failure means the bounded packer found no arrangement, not a proof that all possible manual layouts are impossible.
