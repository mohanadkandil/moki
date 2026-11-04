# fix_ui report: /studio and the /lab copy (4 Nov 2026)

All nine items in the fix_ui section are done. I checked them with screenshots at 1440, 1280 and 390 against the live API, and with a real build served under `/app/moki/`.

**For the coordinator:**
- **Rebuild needed:** `moki.service` serves `dist/web`, and I did not write to it. Run `MOKI_BASE_PATH=/app/moki/ npm run build` last, because a plain `npm run build` writes base `/` and breaks the mount. I told fix_link.
- **Outside my listed paths:** I edited `web/src/board/api.ts` and added `web/src/board/base.ts`. Item 9 needs them: that is where the board fetches and artifact URLs live, and no other agent owns that folder. The `/lab` Build Board uses the same client, so it gets the same fix.
- **Not tested:** the real Sogo Apps gateway. I used a stand-in server (`evidence/fix_ui/scripts/mount.mjs`). fix_link owns the real path.

## Findings

| Finding | What changed | Evidence |
|---|---|---|
| **P2-4** | Added the line to Not proven, once DRC has run. The DRC proof claim carries the same sentence. | `1440-case-miss.png`; unit test |
| **P2-5** | The proof pill collapses into one tappable chip, such as `✓ 3 checks · Not printed`, before the tabs get squeezed. The chip opens all four claims in words. It works by touch and keyboard, and Esc closes it. Ticks are never unnamed now. | `bar-sweep.json`, `1280-chip-open.png`, `390-chip-open.png`, `1280-chip-problem.png` |
| **Tab truncation (owner report)** | Same fix. "Firmware" shows in full at 1300 px. | `1300-firmware-tabs.png` |
| **P2-6** | Copy only, on both `/lab` lines. Line 249 now reads "There is no electrical rule check or simulation. Build Board compiles firmware, but nothing has run on hardware." Line 388 now reads "Build Board writes these into the firmware it compiles. Nothing has been flashed." | `1440-lab.png` shows line 249. Line 388 is confirmed in source only, because it appears after a circuit is drawn. |
| **P3-3** | fix_core had not answered when I finished and no connectivity field exists, so I took the fallback. The strip now says `0 routing errors`, with a hover note that this comes from DRC error types and isn't measured on the copper. An unrecognised DRC error type now shows no count rather than a false 0. | `1280-pcb.png`; unit test |
| **P3-4** | Added an "Other" row. Temp-monitor: 3.07 + 9.36 + 20.2 + 2.81 = 35.44 s against a 35.4 s total. | `1440-case-miss.png`; unit test |
| **P3-5** | The strip shows `board cache hit` and `case cache hit` separately, so a board miss with a case hit reads correctly. The case label is read from the enclosure stage's note, as there is no dedicated field. | `mounted-done-1440.png` shows `board cache miss`, `case cache hit`; unit test |
| **P3-9** | `sensor-air` now reads "Sensor air vents". I also added labels for the other two raw purposes, `light-sensor` and `indicator`; those two haven't been seen on screen. | `1440-case-miss.png` |
| **P3-10** | A build opened from history shows "Describe a new build". | `390-chat.png`; `final.mjs` output |
| **Item 9, base path** | All API and artifact URLs go through `atBase()`. Job artifact URLs are rewritten once, in the API client. The wordmark link also uses it. | `base-path-check.json` |

### Top-bar widths

The breakpoints follow the canvas width, not the window width, because the chat takes its share first.

| Canvas width | What gives way |
|---|---|
| ≤ 1090 px, problem builds only | Pill becomes chip |
| ≤ 1024 px | Pill becomes chip on all builds |
| ≤ 800 px | Download becomes icon only |
| ≤ 725 px | Tabs tighten |
| ≤ 700 px | "Not printed" leaves the chip (still in its popover and label) |
| ≤ 620 px | Tabs and bar tighten further |

**Result:** 84 samples (42 window widths from 1600 to 320 px, each on a clean and a failed build). None had a squeezed or clipped tab, or bar overflow.

## Decisions beyond the brief

- **Phone layout now starts at 900 px, up from 860.** The chat is 320 px wide at 1000 px and below. Without these, no tab layout fit between 861 and 900 px.
- **Problem builds now show every label on wide screens.** The old rule hid the labels of passing checks, which left unnamed ticks. Problem builds use the chip until the canvas is over 1090 px wide.
- **"Not printed" stays on the chip where there's room,** so "3 checks" doesn't read as the whole story. It isn't counted as a check.
- **Follow-up suggestions now need a matching design (small related fix).** They appear only when the build's template matches the session's design. A build opened from history offered changes the session couldn't apply to it.
- **Wording:** "connection problem" became "routing error" in the chat summary, to match the strip. I updated the one test that pinned the old words.
- **Other row:** it appears only on finished builds. My first version labelled a crashed worker's 5.63 s as "Starting up, hashing and saving", which was false. I caught that in the screenshot and added a test.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0 (`typecheck.log`) |
| `npm run build -- --outDir <scratch>` | Exit 0 (`build.log`). I sent output to scratch so it wouldn't overwrite fix_link's `dist/web`. |
| `tsx --test web/src/studio/studio.test.ts web/src/board/*.test.ts` | All pass (`ui-tests.log`), including 6 new Studio tests |
| Screenshots at 1440, 1280 and 390 | Inspected myself, with no page errors or HTTP errors in `final.mjs`. 3D rendered with software WebGL. |
| Built app under `/app/moki/` | 130 requests, 47 unique paths, none outside the prefix and none failing. Covers all six tabs, history, single-file links and the zip download. |
| Real build through that mount | `f60399e1`: focus timer, "Board, case and firmware in 28.3 s.", stages streamed, follow-ups shown |

I did not run the full `npm test`. fix_core owns those suites and is editing them, and memory is tight.

**Not checked:**
- the real gateway or tunnel;
- a physical phone, Safari or Firefox (390 is an emulated touch viewport in Chromium);
- the chip's running state on real data: I saw it only under `?mock=board` (`1280-chip-running-mock.png`), plus a unit test.

## Known gaps

- **Phone status strip:** at 390 px it still scrolls sideways, so the cache labels start off-screen. Job time stays first.
- **Landing link:** the "Landing" link on `/lab` and the Studio wordmark go to `/app/moki/`, which fix_link's redirect sends to `/studio`. The marketing page isn't exposed on the link, so its `/images/` and `/api/projects` paths don't matter there. They would still break if that page were ever served under a base path; `App.tsx` was outside my paths.
- **Old builds:** screenshots of older cached jobs still show the old silkscreen and the "moki" case mark. Those belong to fix_core and the case model, not this UI.

## Side effects

- **Two new jobs in History:**
  - `f60399e1` is the good build above.
  - `8d73b270` was my first try. A board-service restart killed its worker partway through, and it correctly reads "Board and case in 20.3 s. The firmware wasn't compiled." It's safe to delete.
- **Live screenshots:** they ran against the shared dev server, with no extra dev server started. The stand-in mount ran only during its checks and is stopped.
- **Taste profile:** not changed, as this round had no new owner feedback.
- **Repo state:** no commits, pushes, stashes or resets.

## Files

- **Changed:** `web/src/studio/{Canvas,CaseTab,Chat,Studio}.tsx`, `web/src/studio/{facts.ts,studio.css,studio.test.ts}`, `web/src/circuit/CircuitLab.tsx` (copy only), `web/src/board/api.ts`
- **Added:** `web/src/board/base.ts`, this report, `evidence/fix_ui/**` (reproduction scripts in `evidence/fix_ui/scripts/`)
