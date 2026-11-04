# eng_ui report: the Board studio in /lab

**Status: built and working against the real API, but the last three small fixes have not been checked in a browser.** The final re-verification run was stopped by the system because memory was low (about 370 MB free out of 15.6 GB). I did not restart it. See "Not re-verified on the final code".

## What works

Press **Build board** in `/lab`. The studio posts the current design, polls the job and fills in each stage as it finishes. All of this ran against the real API:

| Part | What it does |
|---|---|
| Timing strip | Every stage with measured ms and a bar showing its share of the total, plus the total and cache hit/miss. Also serves as the progress list. Skip and failure reasons are written out. Time outside the named stages is stated. |
| Status row | Generated, Checked by DRC, Firmware compiled or not, Not physically tested. These are four separate claims. |
| Schematic, PCB | Pan and zoom. The PCB tab has top and bottom layer toggles and the DRC list. |
| 3D | board.glb and assembly.glb on a cutting mat with 10 mm squares. "In enclosure" and "Lid" toggles. |
| Enclosure | Base and lid viewer, STL and **STEP** downloads, dimensions, openings, print notes, software checks, assumptions and module-size confidence. |
| Firmware | pins.h, main.cpp and platformio.ini read from firmware.zip in the browser. Compile badge, flash and RAM use, log tail. |
| Code | Editable board.tsx with Re-render and inline DRC. Edits survive failures and new builds. |
| Files | Every artifact, including `enclosure.step`, with size, hash and download, or "not produced". Exact tool versions. |

`enclosure.step` is in both Files and Enclosure, as the coordinator asked. The link is absent when the enclosure stage falls back to the mesh generator, which writes no STEP.

The mock (`?mock=board&scenario=clean|drc|failed|skipped`) carries a banner saying nothing in it was rendered.

## How to reproduce

```
npm run dev                                    # 127.0.0.1:5173, then open /lab
npx tsx --test web/src/board/logic.test.ts     # also part of npm test now
node docs/engineering/2026-11-04-tscircuit/evidence/eng_ui/states.mjs <outDir> http://127.0.0.1:5173 1440 900
```

`shoot.mjs`, `states.mjs` and `probe.mjs` are in evidence/eng_ui. Teammates' edits to server/ restart the dev server and reload the page, which breaks these scripts mid-run. For that reason most captures used `npm run build && npx vite preview` on port 4173, which has the same API plugin.

## Measured

These are single runs on this shared VPS with other agents active, not a benchmark. `npm run board:bench` is the source for p50/p95.

| Job | Cache | Total | Largest stages |
|---|---|---|---|
| focus-timer | miss | 31.1 s | firmware-compile 17.1 s, enclosure 8.7 s, route 2.0 s |
| light-lamp | miss | 27.0 s | firmware-compile 13.2 s, enclosure 9.2 s, route 1.4 s |
| temp-monitor | miss | 34.2 s | firmware-compile 19.7 s, enclosure 9.3 s, route 1.7 s |
| focus-timer | hit | 19.1 s | firmware-compile 18.1 s, enclosure 0.7 s |
| focus-timer, while the box was overloaded | hit | 139.8 s | firmware-compile timed out at 127.6 s |

All three templates reported 0 DRC errors, with 19-25 warnings. The UI shows warnings in amber, so these boards do not read as fully clean.

3D model load took 3.5-7.5 s here on software rendering (SwiftShader). That says nothing about a real GPU.

## Test results and when they ran

| Check | Result | Ran on |
|---|---|---|
| `npm run typecheck` | no errors in log | after the 12:09 fixes, before the CSS-only edit |
| `npm run build` | passes | final code; the bundle contains the last two fixes |
| Board logic tests | 13/13 | after the 12:09 fixes |
| Browser state checks, 1440 and 390 | 16/16 each, no console errors | before the 12:09 fixes |
| `npm test` | 61/61 | before the 12:09 fixes |

The 61/61 log was overwritten when the stopped run restarted the suite. What remains is `npm-test-interrupted.log`, a partial log that proves nothing. The 61/61 figure is from the session output only.

## Not re-verified on the final code

Three small changes came after the last full browser run:

1. The re-render button no longer shows "Rendering…" once a job has failed.
2. The Code tab now labels DRC results as "last finished build" when they come from an older job.
3. On phones, a long DRC list now scrolls inside a 340 px box. It was making the page 5,146 px tall.

Two screenshots show the old behaviour: `state-failed-1440.png` (items 1 and 2) and `state-drc-errors-390.png` (item 3).

**To close this:** when memory allows, run typecheck, `npm test` and `states.mjs` at both sizes, then look at those two screenshots. An attempted states rerun after the 12:09 fixes logged only 3 passes before stopping. My output filter hid the reason. The machine was very loaded at the time, but that cause is unconfirmed.

## Bugs found by rendering it

- **False-clean DRC.** A job that crashed before rendering read as "0 errors" in green, because the API starts every job with an empty DRC block. Fixed and tested. eng_core also added `drc.checked`, which the UI now trusts first.
- **Missing files at `done`.** `server/board-api.ts:152` set `done` before the final artifact refresh, so a poll could miss `enclosure.step`. The UI now polls until the file list stops changing. The server line was unchanged when I last read it, and any other client that stops at the first `done` can still miss files. Request filed in requests/eng_ui-to-eng_core.md; still open.
- **StrictMode dropped the POST answer.** In dev, the studio ignored the response and waited forever. Fixed.
- **Page 516 px wide on a 390 px phone**, caused by the tab bar. Fixed.
- A failed edit no longer replaces the last good build on screen.

## Known gaps

- **Emulated phone only.** No real device. Pinch, drag-to-orbit and drag-to-pan were not exercised; zoom was tested through its buttons. No screen-reader test.
- **Downloads** were checked for HTTP 200 and non-empty bodies only. I did not open the STEP, STL or Gerber files in other tools.
- **Touch on the 3D canvas** orbits the model instead of scrolling the page.
- **Each toggle refetches its GLB.** It took about 10-20 ms locally, but there is no in-memory cache.
- **An `assembly.glb` request logged `ERR_ABORTED`** in two capture runs. The dedicated probe saw 0 failures in 6 requests, and the model displayed in the screenshots I checked. Not root-caused.
- **Reduced motion:** the spinner's animation computes to `none` (measured). Other motion was not checked individually.

## For the coordinator

- **Stale lab copy, outside my allowed edit.** CircuitLab still says "No firmware is written in this preview" and "There is no electrical rule check, simulation or firmware". Build board now generates and compiles firmware, so these lines are misleading. I left them because my write scope there was only the mount point.
- **A cache hit is not fast.** It still spends about 18 s compiling. That is worth stating in the ADR's cached numbers.
- **Shrinking the board in Code** made build123d fail ("base came out as 3 solids"), and the enclosure fell back to the mesh box. The UI reports this honestly.
- **Running processes:** I left my dev server on 5173 (pid 929790) because others may be using it. My preview server on 4173 is stopped.
- **Design:** stays in the lab's existing visual language, with no new identity. I recorded no taste feedback, since none was given. The owner has not reviewed this UI.

## Files touched

- `web/src/board/`: api.ts, BoardStudio.tsx, board-studio.css, logic.ts, logic.test.ts, mock.ts, ModelView.tsx, panels.tsx, SvgPane.tsx, TimingStrip.tsx, types.ts, zip.ts
- `web/src/circuit/CircuitLab.tsx`: lazy mount, request state and the Build board button only
- `docs/engineering/2026-11-04-tscircuit/`: evidence/eng_ui/, reports/eng_ui.md, requests/eng_ui-to-eng_core.md

`npm run build` also rewrote the `dist/web` build output.
