# All-net actual-copper oracle

The existing oracle now supports `scope: 'all'`; the default remains ground-only. All-net output reports `scope: 'all-nets-actual-copper'` and `networks` for every graph net. `groundNets` still contains only nets whose actual graph pins have ground roles.

The extension changes target selection, not physical geometry or connectivity rules. Every terminal piece must belong to one actual lower-bound copper component, while upper-bound copper may touch no foreign/NC terminal. Original drill void subtraction, plated annulus checks, positive barrel contact and conservative minimum/maximum trace-width bounds remain intact. Ground pour requirements remain hard; signals do not acquire a pour requirement. Source metadata and stale native MST pairs cannot join disconnected copper.

Seven new synthetic regressions and all20 existing ground regressions pass; strict TypeScript passes. The old retained ground-only actual fixture ran7.90s because the attempted negative name filter did not exclude it. No all-net whole-board check, native route, render or compile ran on this worker. The actual all-net test is explicit opt-in with `MOKI_TEST_ALL_NET_ACTUAL_JOB=<jobdir>`. Independent review was requested. These tests are not whole-board acceptance.

## Independent P2 correction

Review found that native BREP `bulge` arcs were silently reduced to straight edges. An inward semicircle could therefore invent copper and falsely connect two terminals. The oracle now fails closed whenever a ring vertex supplies anything other than a finite numeric zero bulge. Undefined,0 and-0 retain straight-edge behavior. The shared guard covers outer/inner BREP rings and polygon pads; no arc approximation or connectivity waiver was added.

The exact reported false-connectivity fixture now rejects. Nine current all-net pure tests,19 legacy synthetic ground tests and strict TypeScript pass; no whole-board oracle ran for this fix. Tests include tiny nonzero,positive/negative,nonfinite,nonnumeric/null bulges in all three ring locations. Source is frozen at `5f348ecd…68af3` for independent re-review.
