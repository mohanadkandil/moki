# Section-local legalization and optional legacy packing

Frozen source SHA256:

- `eda/blocks/legalize.ts`: `3bad7206526edba101d2579ecbe7f34f57e532eda5180d27581f0d880858bbd1`.
- `eda/blocks/auto-placement.ts`: `d5629e228c18ed7ab5b223af0d08e324d97561872dd38b438e469ceefc6f74fc`.

Comparing actual passing13a6 and currentf144 after normalizing each group into its local section frame exposed two physical differences despite identical immutable block hints: C4 changed from(5.75,-3,180degrees) to(5.75,-2.25,180degrees), and C10 from(4.5,-5,0degrees) to(5,-4.5,90degrees). The legalizer sorted equal-distance displacement candidates in world X/Y, so rotating the section selected another local candidate.

The narrow correction rotates the existing ranked offset vectors by the resolved section angle. Grid.25mm, radius12mm, passive angle candidates, actual footprint envelopes, keepouts, board bounds, decoupling limits, ordering and explicit fixed anchors remain unchanged. The actual zero-degree13a6 result reproduces all44captured poses; the f144 section-local result now agrees for all44parts. Whole-plan cardinal rotations commute with legalization, including board dimension rotation, with unchanged source inputs and fixed primary anchors. This is a placement covariance fix, not a routing guarantee.

`AutoPlacementOptions.ranking?: 'signal-hpwl'|'legacy'` separately enables a compiler-owned diagnostic. Default signal/aspect behavior is unchanged. Explicit legacy skips the signal pass and aspect sorting, tries declaration rotation0first, then existing cardinal variants when necessary. Actual65×55 selects core0;55×40 selects90because the0variant cannot fit. Explicit maker90anchors are preserved. Unknown option values reject and board/electrical data remain unchanged. The coordinator owns private CLI integration; this change exposes no new HTTP option.

Measured combined targeted command:

`tsx --test --test-concurrency=1 tests/blocks-legalize.test.ts tests/blocks-legalize-covariance.test.ts tests/blocks-auto-placement.test.ts`

All22tests passed in2.737s. Targeted strict NodeNext TypeScript passes. Coverage includes actual captures, cardinal covariance, explicit anchors/rounded outlines/impossible packing, strict impossible decoupling rejection, keepout exclusions, actual six-block packing, ranked fallback, default-equivalence and the optional legacy mode. `legalize-covariance-fixture.json` retains the actual job anchors/poses; actual imported envelopes and immutable definitions are reused from the retained packing fixture.

No native route/render/compile, service operation or fabrication relaxation was performed by this worker. Fresh whole-board native/source/all-net physical acceptance remains pending with the coordinator.
