# fix_core — review fixes completed

4 November 2026. Read `review/REVIEW.md` in full, then `review/FIXES.md`. Implemented the assigned pipeline/API, board-output and firmware changes in the existing uncommitted tree. No commits, pushes, stashes, resets, publishing or new dev servers.

**Acceptance: passed.** `npm run typecheck` exited 0. Final `npm test` exited 0: **93/93 tests, 0 skipped, 93.10 s**. All three templates have 0 DRC errors, completed routing and exact geometry-derived copper connectivity. Rendered PCB PNGs for all three were personally inspected. Evidence is in `../evidence/fix_core/`.

## API contract for fix_link and fix_ui

- Set `MOKI_BOARD_API_TOKEN` in the private service environment **before starting the service**. Every `/api/board/*` request, including GET artifacts, lists, POST jobs and unknown board endpoints, must then include **`X-Moki-Capability`**. Invalid/missing values return 401. SHA-256 digests are compared using `timingSafeEqual`, keeping the comparison length constant. The token is excluded from worker environments.
- If the variable is unset or empty, existing local development behavior remains. The POST Origin/Host check is unchanged. The private gateway must inject the capability and preserve the matching Host/Origin contract; this report does not claim a live gateway check.
- Job JSON has **no new connectivity field**. Copper connectivity is an independent regression oracle. Told fix_ui to label the existing strip as DRC-derived routing errors.
- Artifact URLs retain the existing `/api/board/...` contract; the UI/gateway own base-path adaptation. `mech-handoff.json` is now downloadable.
- `service.close()` aborts tracked workers, drains queued jobs to persisted failures, waits for in-flight submissions and releases the job-root lock. Both development and preview HTTP-server close events call it.

## Finding-by-finding result

| Finding | Change | Evidence |
| --- | --- | --- |
| P0-1, part 1 | Shared exact-name worker env allowlist in `src/board/process.ts`; render, version probe, enclosure and firmware generator use it. Nested Python inherits the already-filtered environment; compiler subprocesses apply the allowlist again. Only PATH/HOME/temp/locale, needed Bun/PlatformIO variables and explicit tool paths are retained. | Actual TSX job sees an arbitrary parent secret as absent; fake compiler also cannot see its parent secret. `tests/board-security.test.ts`, `tests/firmware.test.ts`. |
| P0-1, part 2 | Optional in-API capability gate on every board endpoint, using a fixed-length constant-time digest comparison. | Missing, empty, wrong and wrong-length capabilities fail; the correct one succeeds; foreign POST Origin still fails. |
| P1-4 | Timeout kills the ordinary process group, destroys stdout/stderr and rejects immediately without awaiting close. Nested compilers remain in the outer worker group. | Escaped `setsid sleep` stdout-holder regression; actual TSX timeout followed by the next queued TSX; separate compiler timeout regression; nested-process shutdown regression. Escaped sessions are explicitly not claimed to be killed. |
| P2-1 | Final receipt write and full artifact refresh happen before setting terminal status. | A live HTTP poll runs every 10 ms; the **first** terminal response has exactly the final artifact map and hashes. |
| P2-8 | At most five waiting jobs; further POSTs receive 429. Compile removes `.pio` while preserving build JSON and logs. Seven-day eviction covers jobs, EDA/mechanical caches and unlocked test roots. Eviction runs at startup and history listing. | Parallel HTTP admission test; real-job `.pio` absence; compiler cleanup/receipt/log test; old/recent job/cache eviction fixture. No quota or OS sandbox is implied. |
| P2-9 | Recovery writes failed status to disk. Exclusive per-root PID/token lock prevents concurrent queues, including services in one process. Stale-owner inspection/removal is serialized under an exclusive recovery file. Shutdown aborts process groups and persists queued failures before releasing ownership. | Recovered `job.json` is failed on disk; a second service is denied; two competing processes reclaim one stale lock only once; outer and ordinary nested worker PIDs are gone/dead after close. |
| P2-10 | Adopted the independent geometry audit as `tests/board-connectivity.py`, with failing assertions for opens, shorts, floating/dead copper, pad drift and clearance. It ignores source traces and connectivity labels. Added Studio glob to npm test and symlink download refusal coverage. Both test scripts serialize test files to limit memory. | Oracle passes all three fresh renders and rejects injected opens and shorts while source traces stay intact. npm test includes the Studio suite and existing Bun enclosure driver. External symlink artifact returns 404. |
| P1-2 | Every socket pad has a pin label; supplies get + marks. LED and piezo have polarity labels and negative/cathode bars. TO-92 has a D-shaped outline and FLAT mark. OLED warning now says exactly: “This board expects GND-VCC-SCL-SDA. Check yours before plugging it in.” | Generated circuit silk records, three inspected PCB PNGs, and codegen/oracle checks. The explicitly requested OLED copy change required **only two string replacements in `src/circuit/templates.ts`**, the sole change outside the listed core file paths. |
| P2-3 | Component silk contains refdes and value only; no role sentences. Outline inset by 0.4 mm keeps U1's silk inside the board. Replaced old branded silk with a neutral CARRIER/content-id mark. | Inspected all three PCB PNGs. Values remain present; no sentence truncation. |
| P2-7 | 0.25 mm signal, 0.4 mm power/ground traces; 0.2 mm copper clearances; 0.3 mm drilled / 0.6 mm pad vias. | Three zero-error DRCs plus geometry audit and actual via/trace dimensions. Table below. A real fab upload remains a physical/fabrication prerequisite. |
| P2-2 | Catalog-derived ASCII BOM preserves readable module/value names and lists female sockets, matching module-side male headers and four M3 x 16 screws. Rows explain already-fitted headers and unverified socket fit. PnP has a per-row reference-only hand-assembly note. | BOM assertions for hardware/headers and ASCII; Python csv.reader verifies every PnP row has six fields. Renderer identity includes BOM code and catalog hashes, invalidating stale cached output. |
| P3-6 | Added `mech-handoff.json` to the artifact allowlist. | Real pipeline refresh uses the shared allowlist; successful enclosure exposes the file alongside the other artifacts. |
| P3-1 | Shortened OLED detail strings to at most 21 characters. | Generated-string assertions across all template/sensor variants; actual focus firmware compiles in the real API integration test. |
| P3-2 | Display helper compares title/value/detail and sends an OLED frame only after a content change. Timer polls encoder/switch every loop between such draws; removed periodic full-frame redraws and preserved once-per-second Serial reporting. | Host C++ test compiles and runs the actual generated timer: 2,000 unchanged polls send no new frames; a four-transition detent within 4 ms changes minutes and redraws once; start and second changes each redraw once. No physical encoder/OLED timing claim. |

## Measured board output

| Template | DRC errors | Exact copper nets | Vias (hole/pad mm) | Signal / power trace mm | Tightest inter-net copper gap mm |
| --- | ---: | ---: | --- | --- | ---: |
| focus-timer | 0 | 8/8 | 5 at 0.3/0.6 | 0.25 / 0.4 | 0.200 |
| light-lamp | 0 | 5/5 | 0 | 0.25 / 0.4 | 0.200 |
| temp-monitor, DS18B20 | 0 | 6/6 | 6 at 0.3/0.6 | 0.25 / 0.4 | 0.220 including adjacent sensor pads |

No opens, shorts, floating islands or dead-ended wire ends; maximum pad drift from catalog coordinates is 0.0000 mm for each. Power branches and actual trace widths are recorded in each `connectivity.log`.

Personally inspected: [focus timer PCB](../evidence/fix_core/focus-timer/pcb.png), [lamp PCB](../evidence/fix_core/light-lamp/pcb.png), [temperature PCB](../evidence/fix_core/temp-monitor/pcb.png). Confirmed pin labels, polarity/flat marks, concise refdes/value silk and inset controller outline. Source/SVG/JSON, BOM, PnP, receipt and copper logs accompany each image.

## Validation and independent review

- [Final typecheck log](../evidence/fix_core/typecheck.log): exit 0.
- [Final complete npm test log](../evidence/fix_core/npm-test.log): 93/93, no failures/skips; includes three real EDA renders, the real API pipeline/cache/download/failure checks, security/lifecycle tests, firmware tests and Studio tests. The existing enclosure driver runs its Bun suite.
- [Targeted failure and firmware regressions](../evidence/fix_core/failure-regressions.log): 21/21.
- Real focus firmware compilation in the integration suite succeeded with generated display changes; build receipts/logs remain in `var/board-jobs-test`, without `.pio`.
- [Independent read-only review](../evidence/fix_core/independent-review.md): native agent `/root/review_core` completed; no unresolved findings after fixes. It caught stale-lock takeover and CRLF CSV defects, both corrected and covered. Reviewer did not run overlapping heavy commands.

## Limits and handoff

The assigned P0 parts are fixed; **edited TSX still runs as the trusted owner without an OS sandbox** and can read owner-readable files. The env allowlist and capability do not change that. An escaped session can survive a group kill, although it cannot retain the queue through stdout. Keep the link owner-only behind gateway authentication. No fabrication, print, flash, test fit or power-up occurred. KY-040 geometry and real module variants remain unmeasured; this round does not close P1-3 or replace a fab upload check.

An abandoned `.queue-recovery.lock`, unreadable primary lock or live unrelated PID conservatively fails closed with 503. Inspect the owner/process before removing a lock; this avoids guessing through ownership races. A normal stale primary PID lock is recovered automatically.

Herdr was unavailable (`HERDR_ENV` unset), so no Herdr control or cross-agent prompts were attempted. Used the specified capability contract, answered fix_ui's connectivity question in the task conversation, and preserved the coordinator's ownership of PROJECT.md/.sogo/project.json. Actual native review agent is finished; no persistent worker or service is claimed. Gateway, UI screenshots and app activation remain with fix_link/fix_ui/coordinator.
