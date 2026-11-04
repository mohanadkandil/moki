# Independent review: tscircuit prototype and /studio

**Reviewed:** 4 Nov 2026, about 13:48–14:10, on the uncommitted working tree over commit `8f08c3b`. I did not build any of this.
**Method:** the `engineering-review` skill. I read the code in scope, ran it, and wrote my own audit scripts rather than relying on the builders' tests. Scripts, logs and screenshots are in `review/evidence/`.

## Verdict

**OK for the owner to check through a private authenticated link: YES, with the conditions below.**

**Not OK:** a public or shared link, a link without authentication, or ordering boards or printing cases yet.

The software does what the reports say. My independent checks all passed: copper, Gerbers and `pins.h` match the design, and the case openings line up with the modelled parts. The serious problem is that the API runs arbitrary code with no authentication and no sandbox (P0-1). That is acceptable for one trusted person behind real authentication for a short time, and for nothing wider.

### Conditions for the link

1. **Authenticate at the proxy, before every path.** That includes `/api/*`, `/@fs/*` and the HMR websocket. An unguessable URL or a bare quick tunnel doesn't count. Leave Vite bound to `127.0.0.1`.
2. **Preserve the Host header and allow exactly one hostname.** Set `server.allowedHosts: ['<that host>']`, never `true`. Without this the link fails: a hostname Host gets 403 on every path, and a host-rewriting proxy gets 403 on Build (P1-1).
3. **Remove inherited secrets from the worker environment first.** Use an env allowlist in `runBoardProcess` (P0-1). It is a few lines. It does not make Code-tab execution safe, because `~/.ssh` stays readable.
4. **Owner only, and time-boxed.** Take the link down after the check. Everyone who can open it can run code as `sogo` and see every job.
5. **Tell the owner what the check covers:** software output only. No board, print, flash or power-up has happened. Don't order boards until P1-2 and P1-3 are closed and real modules are measured.

Recommended before the link, but not required: the one-line race fix (P2-1) and a fix for the queue wedge (P1-4). Restarting Vite recovers from a wedge.

---

## Findings

Each finding is marked **Confirmed** (I reproduced it or read it directly) or **Plausible** (reasoned from the code or sources, not reproduced).

### P0

#### P0-1. The job API is unauthenticated remote code execution with no sandbox. Confirmed.

**Where:** `server/board-api.ts:185-193` accepts `{source}`. `eda/render.ts:34` imports it. `server/board-api.ts:22` passes on the whole `process.env`.

**Evidence:** a POST with no Origin and no credentials ran my harmless TSX as user `sogo`, in the repo directory (`evidence/logs/rce-marker.json`).
- It listed the environment variable names `CLAUDE_CODE_MESSAGING_TOKEN` and `GBRAIN_REMOTE_TOKEN`. I read names only, never values.
- It confirmed `~/.ssh` exists. I did not read inside it.
- A second job returned file content through the API: `job.error` contained `READBACK moki`, read from `package.json`.

**What an attacker on the network could do**

| Exposure | Result |
|---|---|
| Today (`127.0.0.1:5173`) | Not reachable from the network. Any local process can still POST, because a missing Origin is allowed. |
| A browser page on another site attacking the owner's machine | **Blocked.** Foreign Origin gets 403; `Origin: null` gets 400 (`Invalid URL`). |
| DNS rebinding through a hostname | **Blocked** by Vite's host check (403 on `/api/board/*` too). This protection comes from Vite's default, not from `board-api.ts`. |
| Bound to a public interface | **Full compromise.** A raw-IP Host passes Vite's check: `Host: 203.0.113.9` gets 200 on the job list, and a POST reaches the handler. |
| Behind a proxy with no authentication | **Full compromise** for any client that sends no Origin. |

"Full compromise" means the attacker can:
- run any command as `sogo` and read anything that account can read, including SSH keys, tokens and other projects;
- read results back through `job.error` or by overwriting their own artifacts;
- reach every other service on this host's loopback;
- install persistence;
- read every other job, since there is no per-user ownership;
- fill the disk.

The UUID and artifact allowlists, the traversal checks and the symlink checks all work, but they only protect the download route. Code inside TSX bypasses them by reading the file itself and writing a copy into its own job directory.

`eng_core` does disclose this ("not an OS permissions sandbox… trusted local developer prototype"), so this is not a false claim. It rates P0 only because a link is the next step.

**Fix, in order:**
1. Allowlist the worker environment (`PATH`, `HOME`, the tool paths).
2. Add an authentication check inside the API, so it doesn't depend entirely on the proxy.
3. Before any second user: run render, enclosure and compile in a real sandbox (bubblewrap or nsjail with no network, read-only filesystem, only the job directory writable, memory and PID limits), or put the `source` route behind a flag.

### P1

#### P1-1. The link won't work as configured. Confirmed.

**Where:** `vite.config.ts:44` sets no `allowedHosts`. `server/board-api.ts:186` compares Origin's host to the Host header.

**Evidence, simulated with curl:**
- `Host: a.trycloudflare.com` gets **403** on `/studio`.
- `Host: 127.0.0.1:5173` with `Origin: https://link.example.com` gets **403** on POST.

**Scenario:** the owner opens the link and sees "Blocked request". If the proxy rewrites Host to get past that, the page loads and pressing Build fails with "Same-origin requests only".

**Fix:** condition 2 above. Do **not** weaken the Origin check to make it work.

**Related exposure, also Confirmed:** the dev server serves source and docs. `/@fs/.../server/board-api.ts` and `/@fs/.../PROJECT.md` both return 200, while `/@fs/home/sogo/.ssh/config` returns 403. The link would also expose `/api/*` for the workshop, including `POST /runs`. I did not call that route. PROJECT.md describes that path as paid model and device work, so check it before exposing it. Prefer `npm run build && vite preview` behind the proxy, or allowlist paths at the proxy.

#### P1-2. A correct-looking board can still destroy parts: no pin labels, no polarity marks. Confirmed. Blocks fabrication, not the link.

**Where:** `src/board/codegen.ts:49-51` emits only plated holes, one rectangle and one text line per part. `src/circuit/templates.ts:59,118` tells the maker to "Wire by the labels on your board".

**Evidence:** silkscreen dumps for all 3 templates contain no pin names, no `+`, and no cathode or flat-side mark (`shots/lamp-pcb.png`).

**Scenarios:**
- The app's own note says sellers sometimes swap OLED VCC and GND. On a fixed carrier, wiring by label is impossible. A VCC-first OLED plugged in reverses the power.
- The DS18B20 outline has no flat-side mark. Mounted backwards, it has GND and VDD swapped.
- D1 and BZ1 have no polarity marks either.

**Fix:** add per-pad silk labels, `+`, a cathode mark and the TO-92 flat. Rewrite the OLED note to: "This board expects GND-VCC-SCL-SDA. Check yours before plugging it in."

#### P1-3. KY-040 fit is the largest physical risk, with only 0.2 mm of radial margin. Plausible; dimensions are unmeasured. Blocks fabrication.

**Where:** `src/circuit/catalog.ts:97` (pins at x = 30.6). `eda/enclosure/module-mech.ts:115-121` (shaft at 9.2, lid hole 7.4 mm, bushing 7 mm).

**Evidence:**
- From the STL, the hole radius is 3.70 mm and the bushing radius is 3.50 mm.
- The 21.4 mm from header to shaft comes from the catalog's drawing, not a part. Sources I checked give overall sizes of 30×18, 32×19 and 19×15 mm, and I found no drawing of the module.
- Those figures may include the protruding right-angle header. If so, x = 30.6 could be the header's tip rather than its hole, which would make the real spacing shorter.

**Scenario:** any error above 0.2 mm in that distance means the bushing hits the lid, and the 5-pin socket can't flex to absorb it.

`eng_mech` already flags the right-angle header problem and the lever force. The tight tolerance on the distance itself is what this adds.

**Fix:** measure a real KY-040 before ordering. Consider a slot or a larger hole, and mount with the panel nut.

#### P1-4. The 120 s timeout can fail to end a job, and one job can stop the queue permanently. Confirmed.

**Where:** `server/board-api.ts:26-35` settles only on `close`, which waits for every holder of stdout to exit. `src/firmware/index.ts:122` has the same pattern. `server/board-api.ts:174` chains every job behind the previous one.

**Evidence** (`evidence/scripts/hang.mts`): with a 1,000 ms timeout and a child that calls `setsid` while keeping stdout, the promise settled after **12,054 ms**, exactly when the escaped `sleep 12` exited. The escaped process also survived the group kill, so "process group killed" was not fully true.

**Scenario:** an edited TSX starts a daemon, deliberately or by accident. With a long-lived child, the job never settles, every later job stays queued forever, and only a restart recovers.

The existing test (`tests/board.test.ts:53-55`) uses a simple child, so it can't catch this.

**Fix:** on timeout, kill, destroy the stdio streams, and reject immediately rather than waiting for `close`. Add a regression test using an escaped grandchild. A PID namespace from the sandbox would also fix the survivor.

### P2

#### P2-1. A job reports `done` before its artifact list is complete. Confirmed.

**Where:** `server/board-api.ts:152` sets the status; line 158 refreshes artifacts afterwards.

**Evidence:** on the live job `e4579517`, a poll saw `status=done artifacts=15`, then 16 about 0.1 s later (`logs/live-jobs.log`). `eng_ui` reported this and it is still open.

**Scenario:**
- Any client that stops at the first `done` misses files.
- The UI waits for two polls with the same count, 400 ms apart. On a heavily loaded host, a slow refresh could give two equal partial counts and show a build with files missing (Plausible).

**Fix:** set `job.status = 'done'` inside `finally`, after `refresh`. Keep the failed path the same way.

#### P2-2. The BOM can't be used to buy the parts. Confirmed.

**Where:** `eda/render.ts`, fab stage, plus tscircuit's stripping of non-ASCII characters.

**Evidence** (`bom.csv`):
- No female sockets, no male headers and no M3 screws, although the whole design depends on them.
- Comments are mangled: `Resistor,  W through-hole` (the ¼ is gone) and `0.96 OLED, SSD1306, IC` (the ″ and ² are gone).
- `pnp.csv` lists module centres as if they were placeable parts.

**Fix:** generate the BOM from the catalog, with rows for sockets and hardware. Use ASCII names. Label PnP as reference-only, since everything is through-hole.

#### P2-3. Silkscreen text is cut off mid-word. Confirmed. This is what the coordinator saw.

**Where:** `src/board/codegen.ts:51`, `p.role.slice(0, 38)`.

**Evidence:**
- `U1 Runs the firmware and supplies 3.3 V f`
- `SW1 Turn to set the time; press to start o`
- `R2 150 Ω Limits the LED current to a level a GP`

**Text overlap:** an estimated-bounding-box check on 4 boards found no text on pads, no text-on-text and nothing off the board. Text does cross traces, which is harmless under solder mask. The U1 outline touches the board edge on every template, so a fab may clip it.

**Fix:** print refdes and value only, as a role sentence doesn't belong on copper. The `moki` silk mark also needs replacing, as design_studio already noted.

#### P2-4. The UI doesn't say what DRC doesn't cover. Confirmed by reading.

**Where:** `web/src/studio/facts.ts`, `proofItems` and `summarize`.

**Evidence:** "DRC 0 errors" gets a green tick. Every pin is an untyped chip pin, which is why the warnings include `source_no_power_pin_defined_warning`, so tscircuit has no electrical types to check. The Not Proven list never says this.

**Scenario:** the owner reads green DRC plus green Compiled as "the circuit works".

To be fair, the separate "Not proven" list, the "Not printed" pill and "DRC 0 errors" rather than "clean" are all good.

**Fix:** add one line to Not Proven: "The design rule check covers placement and routing. It doesn't check that the circuit works, or that your modules match."

#### P2-5. Narrow screens show three unnamed green ticks. Confirmed.

**Where:** `web/src/studio/studio.css:401` hides the labels below 1240 px; `:437` applies the phone layout.

**Evidence:** `shots/studio-390.png` shows `✓ ✓ ✓ Not printed`. Hover titles don't exist on touch screens, and the owner may well open the link on a phone.

**Fix:** use short labels (`DRC`, `FW`), or a tap target that shows the claim.

#### P2-6. `/lab` makes statements that are now false. Confirmed.

**Where:** `web/src/circuit/CircuitLab.tsx:388` ("No firmware is written in this preview") and `:249` ("There is no electrical rule…").

Build Board on the same page now generates and compiles firmware. `eng_ui` flagged this. The design brief freezes `/lab`, so the coordinator needs to decide.

#### P2-7. Fab margins are at one fab's published minimum, and no fab check has run. Confirmed for the numbers.

**Evidence** (`logs/connectivity.log`):
- Vias: 0.2 mm hole, 0.3 mm pad, 0.05 mm ring.
- Every trace, power included: 0.15 mm.
- Tightest copper-to-copper gap: 0.101 mm (lamp), 0.131–0.142 mm on the others.

**Correction to my first assumption:** I expected these vias to fail. [JLCPCB's published limits](https://jlcpcb.com/capabilities/pcb-capabilities) allow a 0.15 mm hole, a 0.25 mm via, a pad 0.1 mm larger than the hole, and 0.10 mm trace and space, so they are **inside the limits, at the edge**. Component pad rings (0.225–0.4 mm) meet its 0.18 mm minimum.

**Scenario:** the design is at the limit on a board that has plenty of spare room, and "DRC 0 errors" says nothing about any fab's rules.

**Fix:** set wider rules (for example 0.3/0.6 mm vias, 0.25 mm traces, 0.2 mm clearance), then run one real fab upload check before ordering.

#### P2-8. No limits on queue length, request rate or disk use. Confirmed by reading and measuring.

**Where:** `server/board-api.ts:174`, plus no eviction anywhere.

**Evidence:** jobs average **29 MB** (140 jobs, 3.8 GB), mainly `.pio` build output. `var/board-jobs-test` is 685 MB. 107 GB is free. `var/mech-cache` has no eviction either (`eng_mech` notes this).

**Fix:** cap queued jobs with a 429, delete `.pio` after compile, and evict by age.

#### P2-9. Restart handling is only half right. Partly Confirmed.

**Confirmed:** a persisted `running` job loads as failed with a clear message, but only in memory. The file on disk still says `running`.

**Plausible, not reproduced:**
- `server/board-api.ts` is a config dependency, so editing it restarts Vite in-process and creates a **second service and queue**, breaking "one job at a time".
- The old queue keeps working while the new service says "Server restarted" for the same job, then finishes it on disk, so that job would read as failed until the next restart.
- `detached: true` also means workers outlive a killed server.

**Fix:** use one lock per job root, write back the failed status, and kill tracked process groups on server close.

#### P2-10. The test suite doesn't check the copper, and two suites sit outside `npm test`. Confirmed.

**Where:** `tests/board.test.ts:83-98` checks `source_trace`, which is the input graph echoed back. A routing short or open would pass. `package.json:15` omits `web/src/studio/*.test.ts`, and the mech Python tests are also separate.

No symlink test exists, despite the report's mention of symlink refusal. The behaviour itself works: I tested it and got 404.

The tests are otherwise good. They run real jobs, real failures and real downloads rather than mirroring the implementation.

**Fix:** adopt `evidence/scripts/connectivity.py` or `gerber.py` as a test, and add the studio glob.

### P3

| # | Where | Finding | Fix |
|---|---|---|---|
| 1 | `src/firmware/programs.ts:107,212` | **Confirmed by arithmetic, not on a display.** OLED strings overflow at 6 px per character on 128 px: `Turn: minutes / Press: go` is 150 px, `Done - press to restart` 138 px, `ALERT: threshold crossed` 144 px. The end wraps to y=60 and is clipped. Host tests use a mocked display. | Shorten them to 21 characters. |
| 2 | `src/firmware/programs.ts` timer loop | **Plausible.** The encoder is polled, and a full OLED frame blocks the loop every 100 ms, so fast turns could lose steps. Not run on hardware. | Use a pin-change interrupt or redraw only on change. |
| 3 | `web/src/studio/facts.ts:186` | "0 unconnected" is a regex over error types, not a connectivity check. It was right on every board I tested (20 on broken boards, 0 on good ones). A new tscircuit error name would silently read 0. | Compute it from the copper. |
| 4 | Chat, /studio | Stage times don't add up to the headline: 3.07 + 9.36 + 20.2 = 32.6 s against 35.4 s. The 2.8 s of untimed work (version probe, hashing, saves) is explained in `/lab` but not in `/studio`. | Add an "Other" row. |
| 5 | `web/src/studio/Canvas.tsx:218` | `cache hit` beside 22 s can read oddly, since it only means the EDA stage. The chat explains it; the strip doesn't. A build with an EDA miss and a mech hit shows only `miss`. | Label it `board cache hit`. |
| 6 | `server/board-api.ts:13` | `mech-handoff.json` is in the contract's artifact list but not the allowlist, so it can't be downloaded. | Add it, or amend the contract. |
| 7 | `eda/enclosure/module-mech.ts:64` | The confidence text says 25.4 mm is unconfirmed and that Espressif's drawing couldn't be read. **The DXF is readable** (see Verified); update the text. The last-pin-to-USB-edge distance is 1.29 mm, against the catalog's 1.78 mm. Harmless, but it should match. | Update the catalog and the text. |
| 8 | `eda/enclosure/module-mech.ts` | The ESP32's EN and BOOT buttons are modelled, but the lid has no access. Recovering a board that needs BOOT held means taking the lid off. | Note it, or add pinholes. |
| 9 | `web/src/studio/CaseTab.tsx:12` | The Case tab shows raw `sensor-air` next to friendly labels like "Sound holes". | Add it to `PURPOSES`. |
| 10 | `web/src/studio/Chat.tsx:304` | A build opened from history shows the starter placeholder "A focus timer…" under a Temperature monitor title, because history restores no design. | Use a neutral placeholder. |

---

## Your specific questions

**The trace that seemed to dead-end near SW1: not a defect.** It is a pair of 0.3 mm vias, at (6.30, −29.90) and (5.95, −32.96). They hop net ENC_SW (SW1.SW to U1.GPIO27) through a short section on the bottom layer. At normal zoom a via is almost invisible, so the line appears to stop. My geometric check finds **no dead-ended wire end** on any of the 4 boards.

**Silkscreen truncation and overlap:** truncation is real (P2-3). I found no harmful overlap.

**Are the timings honest?**
- Yes. The UI prints measured values, and the temp-monitor total of 35.4 s matches what I timed from the outside (running at 12.3 s, done at 47.7 s).
- `bench.json` matches `eng_core`'s table.
- "About 30 s" is a slight miss, disclosed in the reports: cold p95 is 27–34 s, and the Studio saw up to 40 s.
- The demo's 24 s is labelled cached, and the comparison card now says ~31 s.

**Mock data:** only shown with `?mock=`, and it carries a banner.

---

## What I verified

### Commands, run one at a time

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | 61/61 pass, 55.6 s |
| `npm run build` | exit 0 (1.76 MB viewer chunk warning) |
| `(cd eda && bun test enclosure/)` | 45/45 pass |
| `…build123d-venv/bin/python -m unittest discover -s mech/tests` | 19/19 pass |
| `npx tsx --test web/src/studio/studio.test.ts` | 13/13 pass |

### Live jobs through the API

| Job | Template | Cache | Total | Compile | Traces / vias | DRC errors / warnings |
|---|---|---|---|---|---|---|
| `30565a98` | temp-monitor, DS18B20 | **miss** | 35.4 s | 20.2 s | 11 / 6 | 0 / 23 |
| `e4579517` | focus-timer | hit | 22.0 s | 20.6 s | 11 / 7 | 0 / 19 |
| `f433160e` | light-lamp | hit | 13.8 s | 12.9 s | 7 / 0 | 0 / 25 |
| `255e8de3` | temp-monitor, BME280 | hit | 22.7 s | 21.5 s | 8 / 2 | 0 / 14 |

Focus-timer hit the cache, and the POST route can't bypass it, so I did not re-measure a cold focus build myself.

### Security probes

| Probe | Result |
|---|---|
| POST with foreign Origin | 403 |
| `Origin: null` | 400 (`Invalid URL`) |
| No Origin | Allowed |
| Foreign hostname in Host | 403 (Vite) |
| Raw IP in Host | **Allowed** |
| Body over 300 KB | 413 |
| Source of 256,001 characters | 400 |
| Malformed JSON | 400 |
| Raw and encoded traversal | 400 |
| `job.json` as artifact | 404 |
| Non-UUID job ID | 404 |
| Symlinked artifact | 404 (my own job; restored afterwards) |
| Artifact headers | `nosniff`, `no-store`, `CSP: default-src 'none'; sandbox` |
| `innerHTML` sinks in `web/src/studio` and `web/src/board` | None. SVGs render through `<img>`. |
| Injection via `{design}` | None found by reading. Quoted through `JSON.stringify`, part IDs by regex, net names sanitized, numbers parsed. Template values are checked against a fixed list. Only `{source}` runs caller code. |

### Electrical

- **PCB copper equals design nets, independently.** `connectivity.py` uses geometry only and ignores tscircuit's connectivity data. **8/8, 5/5, 6/6 and 4/4 nets match exactly**, with no opens, shorts, floating copper or dead ends. Pads are 0.0000 mm from their catalog positions.
- **Gerbers equal design nets.** `gerber.py` rebuilds connectivity from `F_Cu`, `B_Cu` and the Excellon drill alone, which is what a fab would actually use: the same exact match on all 4 boards. Every drill has pads on both layers, and there are 4 NPTH holes at 3.2 mm.
- **Firmware `pins.h` equals nets.** `fwpins.py`: exact match on all 4. All pins suit their role: no strapping, flash or UART pins, GPIO34 is ADC1 and used only as input. All 4 report a real compile (flash 281–311 KB).
- **ESP32-DevKitC V4 pin order** matches Espressif's [J2/J3 tables](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html) exactly, checked programmatically.
- **ESP32-DevKitC V4 dimensions** come from Espressif's [DXF](https://dl.espressif.com/dl/schematics/esp32_devkitc_v4_dimensions.dxf) dimension entities: **row spacing 25.40 mm** (catalog 25.40), width 27.94 mm (27.9), pitch 2.54 mm, overall length 48.26 + 6.04 = 54.3 mm (54.4). This closes the row-spacing doubt in `eng_mech`'s report.
- **KY-040:** the order GND, +, SW, DT, CLK matches [seller listings](https://components101.com/modules/KY-04-rotary-encoder-pinout-features-datasheet-working-application-alternative) (CLK, DT, SW, +, GND read from the other end). Spacing is unverified (P1-3).
- **SSD1306:** GND-VCC-SCL-SDA is a common order, with variants (P1-2).
- **Passives and leaded parts:** TO-92 pitch is 1.27 mm. LED pads are 2.79 mm apart against a typical 2.54 mm, which is bendable. Resistor span is 16 mm. Piezo spacing is flagged by `eng_mech`.
- **Schematic:** I inspected the lamp schematic; the connections match its nets.
- **Determinism:** across 23 sources, cold-run `circuit.json`, SVG, GLB and PnP hashes are identical. Only `gerbers.zip` varies, as it embeds timestamps. One source also has two BOM hashes, which I did not investigate.

### Mechanical, ray-cast from the exported STLs for all 3 templates (`mesh.py`)

- **USB:** all four corners of the modelled shell pass through the wall opening.
- **Display window:** 45/45 probe points on the active area are clear of the lid, with 0.000 mm offset from the window. The active-area position itself is an estimate, and it is labelled as one.
- **Encoder:** 0.000 mm offset from shaft to hole.
- **Holes:** each base bore is r = 1.70 mm and each lid pilot is r = 1.30 mm, centred on the PCB's M3 holes in all four directions. The nearest copper is 3.76 mm from a hole's edge, outside the 3 mm standoff radius.
- **Screw:** an M3×16 reaches z = 18.5 mm, engaging the pillar by 9.75 mm, short of the 20.75 mm pilot end.
- **Stack:** 8.5 + 2.54 + 1.6 + 6.6 = 19.24 mm is plausible, and the sums are correct. The case height of 30.49 mm follows from the USB bar. The bushing stands 2.75 mm above the lid, enough for a thin panel nut.
- **Labelling:** the UI and `enclosure.json` label estimates clearly ("Calculated fit. Nothing has been printed or test-fitted", plus a per-part confidence line).

### UI

Headless Chromium, on `/studio?job=…`: PCB and Case at 1440, default view at 390. The real viewer rendered, the figures match the API, no mock banner appeared, and the Not Proven list shows.

## What I could not verify

- **Anything physical:** no flash, print, test-fit or power-up. Firmware behaviour on hardware. The real KY-040 and OLED dimensions and the seller variants of both.
- **Third-party tools:** Gerbers in an outside viewer or a fab's upload check. STEP in another CAD application. STLs in a slicer.
- **Orientation of the ESP32 in top view:** the pin tables and spacing are verified, but left and right come from Espressif's pinout figure as I remember it. I did not machine-read the image. Check against a real board before soldering, because a mirror-image error would swap power pins.
- **A real proxy or tunnel:** I simulated those with curl headers. Retest conditions 1 and 2 on the actual link.
- **The double-queue restart path (P2-9).** Reasoned, not reproduced.
- **Other browsers and devices:** real GPU, Safari, Firefox, a physical phone, and touch. I did not re-run the 3D interactions or the end-to-end chat flow, and I did not type a brief in the browser. Stage-by-stage streaming was seen only through API polling.
- **The workshop API:** I did not call it.

## Side effects of this review

No product code was edited, and `git status` shows the same entries as at the start. Beyond `review/`, these changed:
- `dist/web` was rebuilt by `npm run build`.
- `var/board-jobs-test` received new jobs from `npm test`.
- **Six new jobs are in `var/board-jobs` and appear in Studio History:**
  - `e4579517`, `30565a98`, `f433160e`, `255e8de3` are normal builds.
  - `4a1dd27c` is the code-execution proof, and `4d1f69f5` is the file read-back proof. Both are harmless, and neither holds secrets. Delete them after the next server restart, since the running server holds them in memory.

No long-running server was started or stopped; `npm test` used its own short-lived loopback servers. No commits, pushes or outreach.
