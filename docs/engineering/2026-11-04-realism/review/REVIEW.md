# Independent re-review E7 — 4 November 2026

Reviewed the current uncommitted working tree over `8f08c3ba4abf0340654c169d9122ac71647aece2`, following `/home/sogo/sogo/skills/engineering-review/SKILL.md` and its code-review/find-bugs procedures. I did not implement the reviewed work. The first review, FIXES.md, fix_core/fix_link/fix_ui reports, realism brief and all three realism reports were the scope baseline. Most feature files are untracked; a commit diff cannot reconstruct the exact first-review source. Findings below describe confirmed current behavior, without inventing a change date for inherited code.

**Verdict: fit for the owner's private authenticated software check, with four P2 findings outstanding.** No new P0/P1 blocker was found at the private-link boundary. This is not closure of every earlier finding, fabrication approval, a multi-user security approval, or confirmation that the running fixed production bundle contains the realism work. The coordinator still owns the final build/deployment decision. I did not rebuild or restart it.

## Findings

### P2-1 — The copper oracle accepts vias with their entire copper annulus drilled away

**Location:** `tests/board-connectivity.py:19-20`, `:83-89` (solid-disc connectivity); `tests/board-routing.test.ts:54-55` (dimension assertions).

**Confirmed reproduction:** I copied final temperature job `b59461c0-8c5b-4fcc-a34b-a4e0e9c9c4b2` into this review's evidence, changed only its six `pcb_via.hole_diameter` values from 0.3 to **1.6 mm**, and retained their **0.6 mm** copper diameters. No source trace, design net or coordinate was changed. The oracle exits **0**, printing `annular ring mm {-0.5}` followed by `PASS: exact physical copper connectivity`. See [damaged circuit](evidence/copper/temp-monitor/oversize-drill-circuit.json), [oracle output](evidence/copper/temp-monitor/oversize-drill.log), and [reproduction script](evidence/audit.mts).

**Failure scenario:** a drill-size regression can remove the layer-transition copper and cut neighboring conductors, while this supposedly physical oracle certifies exact connectivity. It stores drill dimensions but never validates or subtracts them; pads/vias participate as filled discs. The integration test only checks minimum via drill/pad sizes, so these larger drills also satisfy its individual dimension inequalities. The existing good boards have valid 0.3/0.6 vias; this finding concerns the oracle's ability to reject broken output, not evidence of a broken final board.

**Fix:** fail closed on nonfinite/nonpositive dimensions and require a positive, policy-compliant annulus for every plated hole and via, including route-only vias. Account for drill voids where conductors can intersect them; add the oversize-drill mutant as a negative regression. Retain the current open/short/pour regressions. This leaves original P2-10 only partially closed.

### P2-2 — Production never evicts the shared mechanical cache or old test roots

**Location:** `server/board-api.ts:82-94`; deployed configuration `/home/sogo/projects/sogo-apps/integration/moki.service:10` (also the installed user unit's job-root setting).

**Confirmed reproduction:** the service's extra cleanup runs only when `jobsRoot === <root>/var/board-jobs`. The installed production service uses **`var/board-jobs-app`**. With that exact layout under evidence, I created an eight-day-old `var/mech-cache/<64-hex>` directory and triggered startup/history eviction. It survives: `productionMechCacheSurvivesEviction: true` in [audit.json](evidence/audit.json). The reproduction never touches the real cache.

**Failure scenario:** after switching to the intended production service, each new handoff can add a shared mechanical-cache entry indefinitely. Production still cleans its own job and EDA-cache directories, but the shared cache and abandoned test roots are skipped. The report's general seven-day eviction claim does not hold for the deployed root.

**Fix:** express shared-cache maintenance as an explicit service option/configuration, enabled for the actual production service, rather than inferring it from one directory spelling. Keep the active-test-root exclusion. Test both default-dev and deployed production layouts. Original P2-8 is partially closed.

### P2-3 — A failed source is labelled “Rendered” in Code

**Location:** `web/src/studio/CodeTab.tsx:18-35`.

**Confirmed by data-flow and a retained real failed job:** Code loads `board.tsx` into `draft.text` and `draft.base`. When they match, it unconditionally shows a green **Rendered** badge and “The source tscircuit rendered.” It never checks job status, render stages or circuit output. The server saves source before attempting render and exposes it even on failure. Existing job `4d1f69f5-640b-4bdc-ae0f-57b6eb76707a` is `failed`, reports only skipped codegen and has only `board.tsx`/`receipt.json`; its source is nevertheless eligible for that badge. The non-sensitive supporting fields are in [failed-code-claim.json](evidence/failed-code-claim.json).

**Failure scenario:** open a failed import/syntax job, then Code. Unedited source is described as successfully rendered although no circuit exists. This contradicts the rest of Studio's truthful failure state. Switching jobs with a retained dirty draft can also leave the editor associated with a different job, so identity must be part of the check.

**Fix:** derive the badge from the displayed source's job identity and its actual render result. Use “Source saved”, “Not rendered”, “Rendering” or “Render failed” as appropriate, reserving green “Rendered” for matching source with successful output. Add a component-level failed-job regression; the existing pure facts tests do not exercise this badge.

### P2-4 — “Re-run this build” can submit a different revision

**Location:** `web/src/studio/Studio.tsx:200-205`.

**Confirmed by control flow and real session generation:** the rerun branch checks only equal template names, then submits `revision.design`, not the displayed job's design. [rerun-check.json](evidence/rerun-check.json) generates a 25-minute focus design (`484fd6e8aeec4d7f`) and a 45-minute design (`409650de1636dae5`). Both match that condition despite differing content identities. No actual job was submitted by this reproduction.

**Failure scenario:** build 25 minutes, revise to 45, select the earlier run in the chat/history and click “Re-run this build”. It submits 45 minutes and records “Re-ran the same design”. The same problem can change sensor, display, buzzer or pin choices within a template. This is a current-flow finding; the unavailable first-review source snapshot prevents dating its introduction.

**Fix:** require the displayed job's `input.designContentId` to match `contentId(revision.design)` before using the current session. Otherwise restore the original validated graph, or use the existing source fallback with its honest firmware-skipped semantics. Test two revisions of one template and a history job from another session.

## Closure audit of every original P0/P1/P2

“Closed” here means the requested bounded software correction is present, supported by inspected code/tests and retained evidence; fresh execution is listed separately below.

| Original finding | Current result |
| --- | --- |
| P0-1 | **Assigned environment/auth parts closed. Sandbox remains explicitly deferred.** Exact-name worker allowlist is shared by render, enclosure wrapper and compiler paths. API hashes both configured/supplied capability to fixed-size SHA-256 digests before `timingSafeEqual`. Every board endpoint enters the gate. Trusted edited TSX still runs as the owner and can read owner-readable files; neither the token nor filtered environment creates an OS sandbox. |
| P1-1 | **Closed for the configured private link.** Production preview hooks, exact Host list, gateway login and path/method allowlists, original Host/Origin forwarding and base-aware client URLs are present. Actual unauthenticated preview API gets 401; source/workshop paths get 404. Gateway's retained actual-preview receipt has 9/9 checks; this review did not obtain a live owner session. |
| P1-2 | **Closed in code/output.** Generated per-pad names, supply plus signs, LED/piezo cathode/minus marks, TO-92 flat mark and explicit OLED GND-VCC-SCL-SDA warning are present. This does not validate purchased-module pin orders. |
| P1-3 | **Still open and disclosed.** KY-040 shaft/header geometry and tight hole margin remain estimates. No actual-module measurement or physical fit was supplied. It continues to block fabrication, not the bounded private check. |
| P1-4 | **Closed for queue settlement.** Timeout kills the ordinary group, destroys pipes and rejects independently of `close`; escaped descendants cannot hold settlement through stdout. Fresh escaped-session probe settled in 258 ms for a 250 ms timeout and the next worker succeeded. Escaped sessions still require a sandbox; the probe killed its own escaped child. |
| P2-1 | **Closed.** Final receipt, cleanup and artifact refresh precede terminal status; the integration regression compares the first terminal artifact map with the final map. |
| P2-2 | **Closed for requested BOM correction.** Catalog ASCII BOM includes female sockets, male headers and four M3 screws; PnP rows explicitly say reference-only hand assembly. Purchasing availability and exact socket fit remain unverified. |
| P2-3 | **Closed.** Silk uses refdes/value, no truncated role sentence; component rectangles are inset by 0.4 mm per side. |
| P2-4 | **Closed for DRC scope copy.** Proof detail and chat Not proven explain that DRC checks placement/routing, not electrical operation or module matching. |
| P2-5 | **Closed.** A labelled, tappable/keyboard-operable proof disclosure replaces unnamed ticks. Retained 390/1440 contact sheets were inspected. |
| P2-6 | **Closed.** Both stale Lab statements now acknowledge Build Board's firmware generation/compilation and absence of hardware execution. |
| P2-7 | **Software rule changes closed; fab validation remains open.** Final outputs use 0.25/0.4 traces, 0.3/0.6 vias and >=0.2 inter-net clearance in the oracle. No real fab upload check is claimed. The new drill blind spot must be fixed before relying on that oracle for manufacturing. |
| P2-8 | **Partial.** Five-waiter queue cap, `.pio` deletion and own-root age eviction are implemented. Shared production cache/test-root cleanup is defective (new P2-2). No disk quota is claimed. |
| P2-9 | **Closed for the requested lifecycle behavior.** Exclusive PID/token root lock with serialized stale takeover, persisted restart failures and service-close abort/drain/release are present. Dedicated tests cover stale competing processes and normal nested worker shutdown. I did not restart either live server to repeat those tests. |
| P2-10 | **Partial.** Studio glob and Bun enclosure driver run in npm test; download symlink refusal has a real regression. The copper oracle is geometric and checks pours, opens and shorts, but accepts destructive drills (new P2-1). |

The requested P3 corrections also have concrete implementations: shorter OLED strings and change-only redraw, Other timing row, separate board/case cache wording, handoff download, friendly vent labels and neutral history placeholder. ESP32 confidence text still contains the old “could not read”/unconfirmed-spacing language (original P3-7); EN/BOOT lid access remains a physical usability limitation (P3-8). Neither is represented as resolved here.

## Security and claims checked

The threat model is one trusted owner behind Sogo Apps authentication. Anonymous clients and foreign browser origins must not invoke owner code; authenticated owner TSX is intentionally executable. There is no per-user job ownership, so this is unsuitable for a second user without a sandbox/ownership design.

Direct middleware fixtures used a newly invented review token, never the production capability. Missing/wrong tokens returned 401 on list, artifact and unknown routes; correct token allowed the fixture ZIP. Foreign POST Origin returned 403, encoded traversal 400, and an artifact symlink outside its job directory 404. ZIP serving retains `application/zip`, `nosniff`, no-store and sandbox CSP. Raw path validation, UUID and artifact-name allowlists, and realpath containment remain intact. Gateway overwrites any browser capability and validates mutation Origin before forwarding. Preview only exposes the board API and selected production HTML/assets; it does not install workshop routes through `configurePreviewServer`.

DRC warnings are not hidden: the status strip is neutral when warnings exist, proof detail says “DRC 0 errors” and lists warning scope, and chat reports warning counts. A green aggregate means the enumerated checks passed, not that there were no warnings. “Compiled” follows `firmware-compile.status === done`, which the backend produces from successful compiler execution; skipped/failed stages are distinguished. Measured total/stage times and Other are used rather than fabricated durations. New Code's “Rendered” is the exception documented above.

“Open in KiCad” is a download action with a tooltip naming `kicad.zip`, not an application-launch integration. The ZIP contains exactly the three project files plus README. Converter version **0.0.267** is pinned. The `(power global)` normalization is anchored to a standalone grammar line, preserving ordinary quoted labels. I independently plotted each exact evidence ZIP's PCB and schematic with native KiCad **9.0.8**: all six commands exit 0 and emit nonempty SVGs. The retained native warning about a missing global IPC schema persists; it did not prevent these readers/plotters. This establishes readability, not GUI project opening, ERC, KiCad DRC or fabrication correctness.

## Fresh checks and evidence honesty

Commands ran sequentially, without the full npm test or a new server:

| Fresh check | Result / evidence |
| --- | --- |
| `npm run typecheck` | Exit 0 — [typecheck.log](evidence/typecheck.log) |
| Board web + Studio tests | **35/35** — [ui-tests.log](evidence/ui-tests.log) |
| Bun catalog mesh suite | **16/16**, 173 assertions — [models-tests.log](evidence/models-tests.log) |
| Rounded-outline build123d test | **1/1** — [rounded-geometry.log](evidence/rounded-geometry.log) |
| Physical oracle on three final job copies | **3/3 pass**; trace-removal mutant rejected; destructive-drill mutant wrongly passes — [audit.json](evidence/audit.json) and `evidence/copper/` |
| Exported GLB binary positions | All named part/socket minima meet their seats, including TO-92 and seated piezo — [artifact-audit.json](evidence/artifact-audit.json) |
| Native KiCad readers/plotters | **6/6** pass — same receipt and `evidence/kicad/` SVGs |
| Existing preview, unauthenticated GETs only | Studio 200; board API 401; source, filesystem, study and workshop paths 404 — [preview-probes.json](evidence/preview-probes.json) |
| Escaped-child timeout and next worker | Pass — [process-check.json](evidence/process-check.json) |

Final board/assembly sizes exactly match the realism report: focus **1,726,656 / 2,927,340 B**, lamp **1,461,988 / 2,512,496 B**, temperature **1,535,416 / 2,883,988 B**. The temperature area reduction is exactly **34.21%** from 90×95 to 75×75 mm. All 52 rounded outline points reach the handoff unchanged; enclosure output records a 3 mm board radius and 5.3 mm outer radius. Native rounded-cavity probing passes.

Model tests exercise actual JSCAD triangles, materials and header support occupancy, not only declared seat metadata. Integration tests open the exported GLB and require every placed part's named node. My additional check reads binary POSITION data rather than trusting accessor min bounds. Current exported part nodes have baked orientation, without extra matrix/rotation/scale transforms. Seat/presence evidence meaningfully addresses the supplied floating-piezo/missing-TO-92 complaint; it is not proof that arbitrary future placeholder geometry will resemble real parts or that real purchased modules fit.

The reports' **93/93** fix-core, **97/97** final model-round npm tests, **20/20** mechanical tests, **34/34** Apps checks and **9/9** actual preview/gateway checks have retained supporting logs/JSON. I did not rerun those complete suites. The final palette-only change occurred after the full suite and is disclosed, with later output checks. Historical larger pre-compaction GLBs in the earlier independent report are explicitly superseded, not contradictory final measurements.

I inspected retained 1440 and 390 before/after contact sheets and the 1280 evidence inventory. Screenshots establish the claimed visual changes; they are not new browser interaction tests by me. The lack of a 1280 before sheet, use of a different pre-round job for before, added alarm part in the final temperature image, simulated in-flight state, approximate owner-camera match and software-renderer limits are disclosed or visible in evidence. No fabricated test count was found. The no-hitch acceptance is **not established**: the report openly records 117 ms median/1700 ms p95 at 390 under SwiftShader and asks for actual-device checking. “All done” must not be read as physical fit, phone GPU performance, or every original finding being closed.

## Scope, checklist and limits

[scope.md](evidence/scope.md) records source coverage, including partial reads. Review considered runtime/error paths, interfaces/cache identity, compatibility, resource use, injection/output handling, authentication, authenticated ownership boundaries, CSRF/Origin, races, cryptography, sessions, information disclosure and business-flow claims. The confirmed failures are the four above. No additional exploitable injection, XSS or anonymous authorization bypass was established. SVGs remain image sources rather than HTML injection sinks; the owner-code execution exception remains deliberate.

I did not start/stop servers, look for secrets, submit live jobs, run the full npm/Apps suites, rebuild production, order boards, print, flash, or contact anyone. No independent fresh authentication session, complete gateway mutation/build flow, Gerber re-extraction, STEP re-open, physical module measurement, physical phone/GPU, Safari or Firefox check was performed. These limits prevent a public/multi-user or manufacturing verdict.

Only this REVIEW.md and review/evidence files were intentionally written. Test fixtures, extracted KiCad inputs and generated SVGs are confined there. Source and handoff files were not edited; start/end git status listings match. No commit, push, stash or reset occurred. No review subagents or persistent workers were started. The existing 5173/8847 services were left running as found.
