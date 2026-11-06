# schem_ui report: schematic canvas (6 Nov 2026)

## Result
The Schematic tab is now a full-panel, editable sheet that grows live while the agent works. Carrier boards can be edited and rebuilt end to end. Chip boards are read-only for now (decision 1 below).

## What was built
All in `web/src/studio/schematic/`, plus `canvasWait.ts`, `schematic.test.ts`, and wiring in `Canvas.tsx`, `Studio.tsx` and `studio.css`.

| File | Job |
|---|---|
| `sheet.ts` | One sheet model, from a design, a chip plan and its graph, a partial plan, or `circuit.json` |
| `layout.ts` | Deterministic sections, parts, wires, zones and title block, in mm on a 2.54 mm grid |
| `ops.ts` | Draft steps, undo/redo, refusals and the draft overlay. Uses agent_core's `applyDesignOps` and the existing `checkDesign` |
| `SheetDrawing.tsx` | The SVG, with real symbols for R, C, L, LED, diode, LDR, piezo and switch |
| `SchematicCanvas.tsx` | Pan, zoom and pinch, both rails, tooltips, keyboard shortcuts, prompts, inspector, draft bar and status bar |
| `Library.tsx` | Searchable drawer of catalog modules and blocks |
| `SchematicPane.tsx` | Chooses the sheet source and staggers new parts onto the sheet |

**Rendering decision:** the canvas draws the sheet itself from design data instead of showing `schematic.svg`. Live, draft and final views all use one layout, so there is no swap at all. `schematic.svg` is still in Downloads.

| Option for each live update | Measured |
|---|---|
| Client-side sheet and layout, 24-part chip sheet | median 1.5 ms, worst 23 ms |
| Client-side sheet and layout, carrier | median 0.5 ms, worst 2 ms |
| tscircuit `svg` stage alone, same chip job | 1,066 ms, over the 1 s budget before any process start |

**Empty canvas (owner feedback, added mid-round):** it now follows the turn, on every tab.
- Waiting for the maker: "Nothing built yet. Confirm in the chat to start."
- Refused or failed: "Nothing was built. See the chat."
- Designing: the blank sheet with the live pill on Schematic, "Designing…" with a pulsing dot on other tabs.
- Fresh page: "Nothing built yet. Describe a device in the chat to start." (my wording)

agent_core emptied the same placeholder in `landing/StudioShell.tsx`.

## Acceptance evidence
Screenshots are in `../shots/`. I inspected them at 1440 and 390 (390 is browser emulation, not a physical device).

| Item | Shots | Result |
|---|---|---|
| Idle full panel | `01`, `20`, `14-chip-sections-*` | Edge to edge. Chip sheet shows all 6 titled sections |
| Each tool | `02-tool-*`, `02-tooltip`, `21` | All 8 tools plus Add part. Space and hand pan measured exact; Fit returns to 0, 0 |
| Library | `05`, `22` | Search works. Blocks show "not available yet" (gap 1) |
| Draft, Apply, rebuilt | `06`–`13` | Added `BZ1`, wired it with Wire and Power, added a note, undo and redo, Apply. Real job `4b218b81` built in 33.9 s with `BZ1` wired and the note stored |
| Invalid edit refused | `07-*` | "U1.GPIO6 is a flash pin and should not be used." and "BZ1.+ is not connected. And 1 more to fix." |
| Live sequence | `30-live-a…f`, `32-live-390-a…e` | 6 and 5 frames. Parts and sections appear one by one with the step in the pill |
| No jump on landing | `31-live-landed` | Every part moved 0 px |
| Empty states | `40`, `41`, `42` | All three checked on the page |
| Typecheck, web tests | | Clean. 95 of 95 pass, 14 of them new |

Page errors across the captured flows: none.

Bugs that capture found, now fixed:
- Escape didn't clear a selection, because the listener was removed mid-dispatch.
- Parts jumped 59 px on landing, because the Notes section was dropped while live. Now covered by a test.
- Tooltips were clipped by the rail.
- A draft was lost when switching tabs. A draft is now also dropped, with a message, if the design changes underneath it.

## Limits of this evidence
- **Live frames use replayed events.** They are real event shapes through the real parser and UI, with no model. agent_core's Designer emitting `plan.partial` during a real model turn wasn't exercised here.
- **Server refusal isn't exercised in the UI.** Refusals above come from the same validators running in the browser. A server rejection is wired to the same message, but I never triggered one.
- **`13-rebuilt.png` is a cache hit.** The last runs repeated the same design, so they took about 0.6 s. The uncached build is `4b218b81`; `31-live-landed.png` shows its 33.9 s.
- **No independent review** has looked at this yet, and I ran only typecheck and web tests, as the brief asks, not the full suite.

## Decisions for the coordinator or owner
1. **Chip edits stay read-only for now.** `checkSchematicReview` gates chip builds, so any canvas edit to a plan would be refused without a fresh independent review. Chip tools are disabled and say to ask the agent. Making them editable needs a re-review step in the Apply flow first.
2. **The canvas no longer jumps to the 3D tab when a build lands.** The brief asks for the swap to the final schematic, and the old jump hid it. This changes earlier behaviour, so tell me if the owner wants it back.
3. **DRC and trace readouts aren't in the Schematic status bar**, which now shows cursor, grid, zoom, selection and agent state. The checks pill in the top bar remains.

## Gaps and follow-ups
1. **real_models:** `GET /api/board/library` returns 404, and `POST /api/board/ops/check` and `{ baseJobId, ops }` aren't in `board-api.ts`. Carrier Apply posts `{ design, baseJobId }` instead, which the job API accepts.
2. **real_models:** `load()` doesn't refresh artifacts, so builds from before `design.json` was listed open read-only, with a message to re-run. Refreshing on load would fix existing builds.
3. **real_models or chip_eda, optional:** the tscircuit skill recommends `<schematicsection>`. Generated TSX could use it so `schematic.svg` and KiCad exports get sections too.
4. **Minor, phone:** the live pill overlaps the sheet's top frame edge.

## Hand-offs
- **Restart:** production needs a rebuild and restart of `moki.service` to show this. I didn't touch it. My capture server on port 5199 is stopped.
- **Taste:** the owner's empty-state feedback should go in `taste.json`. The coordinator is the preference writer, so I didn't record it.
- **`ModelPane.tsx`:** not touched, per your retraction.
- **Other agents:** agent_core removed `onRefused` from `Studio.tsx`; typecheck and tests pass with that in place.
- **Contract:** `../op-contract.md`, with agent_core's differences: chip `rename_net` is always refused, chip `set_value` takes `inst.param`, and `parseOps` takes its own cap for long drafts. The canvas calls `applyDesignOps` directly, so the cap doesn't affect it.

---

# Round 2: server side wired in, chip boards editable (6 Nov 2026)

## Result
Apply, the draft bar and the Library now use agent_core's API, and chip boards can be edited on the sheet. Carrier edits build for real through `{ baseJobId, ops }`. A real chip edit passed the real Reviewer and built, and another was correctly stopped at review (below). One link is still unproven: pressing "Review and apply" in a browser with a live model.

## Corrections to round 1
- **"Every part moved 0 px on landing" was too weak.** That run compared positions before and after landing, so it couldn't see a flash in between. Sampling every frame found one: when a job appeared, the canvas remounted and showed one frame at the wrong scale. This is fixed and re-measured below.
- **Chip sheets are no longer read-only.** Decision 1 above is closed.
- **The Library and refusal notes above describe the old state.** The Library now comes from the server, and server refusals have been triggered for real.

## What changed
| Area | Now |
|---|---|
| Carrier Apply | `POST /api/board/jobs { baseJobId, ops }`. A `400` shows inline and makes no job |
| Chip Apply | `agent.send('Apply my edit', { mode:'chip', jobId, ops })`, never a direct post, because any chip edit needs a review receipt for that exact plan. The button reads "Review and apply" because this costs model money |
| During review | The draft stays on the sheet with a "Reviewing" state. It clears when the new build arrives. If the review ends with no build, the draft comes back to the maker and the reason is in the chat |
| Draft bar | Every draft goes to `ops/check`. An op that can't apply is dropped with its reason. One that applies but can't build stays, with "Can't build yet: …" |
| Library | `GET /api/board/library`: modules on carrier boards, blocks on chip boards, searched by the server |
| Chip Wire | Links ports, shown under each section title. Ports it can't sensibly join dim, and the server decides |
| Chip Add part | Becomes Add block. The new section shows at once, marked as new, and fills in when the server draws it |
| Chip Delete | A part removes its whole block. A port unlinks, with a menu when it has several links |
| Chip Select | Shows the block's values to change, and Remove block. Net label renames through the server |
| Chip Power | Off, with a tooltip saying rails join through ports |

**One graph for chip sheets:** every chip sheet now draws from the server's `sheetGraph`, using `ops/check` with `ops: []`. Before this, the build's record and the server graph disagreed on pad ids (`J1`, passives), so a note-only draft falsely marked 10 pins as changed.

## Evidence
Screenshots are in `../shots/`. Unless marked otherwise, these ran against the real library, check and job routes on my own dev server.

| Item | Shots | Result |
|---|---|---|
| Carrier edit applied via ops | `50`–`53` | Job `0a9993da`, cache miss, 30.6 s. Job records `input.ops` and `editSummary`; `BZ1` on the sheet |
| Server refusal, real `400` | `54` | "This device's firmware uses U2. Ask the agent to change the firmware first." No job. The check was delayed in this run so Apply would reach the POST |
| Server refusal in the draft bar | `62` | "Can't build yet: The ground net keeps its own name, because the ground pour is built from it." |
| Chip add block, real check | `63`–`65`, `69` | Second BOOT/RESET block added and linked: 2 new parts, `ok: true`, `needsReview: true` |
| No false changes | `61` | Note-only chip draft: 0 pins marked, no width changes |
| No agent available | `66` | "Chip edits need the agent to review them, and it isn't available on this server." |
| No jump on landing, every frame | `70`, `71`, `30`, `31` | Chip and carrier: 0 changes, 0 px and no dips after the sheet settles |

**Stubbed, and named so in the file:** `67` and `68` use a stubbed agent, because my dev server has no model key. They do show the exact request sent (`message`, `mode: chip`, `jobId`, `ops`) and the draft staying through a review that ends with no build. The chip no-jump run replays the agent's events, with the real server's plan and graph and a real job to land on.

## The real chip edits (agent_core's runs)
Run by agent_core through the same server path as `agent.send`, with a real Reviewer, firmware agent and worker. Logs are in `../evidence/chip-edit/`. I copied the built job read-only, checked its record and opened it on the canvas.

| Edit | Outcome | Evidence |
|---|---|---|
| Add `ssd1306-i2c-header` as `screen` plus 3 links, on the seed board | **Built.** Job `6f31cc70`: 8 of 8 gates, 0 DRC errors, firmware compiled, 4 ops recorded. Job 36.6 s, whole turn 127 s, $0.135 | `80`, `81`, `82`. All 3 `screen` ports show as linked, in a titled section, with no draft marks left |
| Add SHT40 as `air` plus 3 links, on the seed board | **Stopped at review, no job.** The Reviewer couldn't verify the 100 nF bypass from readable datasheet text, and the Fixer gave up. 97 s, $0.182 | `add-sht40-review-refused.log` |

The SHT40 result is the gate working, but a maker will hit it. The log shows the datasheet tool refusing the PDF on hand: "That PDF doesn't name SHT40-AD1B-R2, so it isn't this part's datasheet." Until that part has a readable, matching datasheet, adding this reviewed block by hand won't get through review.

**Real refusal on the accepted SHT40 plan:** adding the display reads "Bus needs one controller when peripherals are connected" until it's wired (`83`), then "Peak load 602.00 mA exceeds 600 mA" once linked (`84`). Apply shows the same reason and posts nothing.

**Still unproven:** the browser and the real agent together. The button's request was checked against a stubbed agent, and the agent path was run from the server side, with the same fields. Neither run covered both, because my dev server has no model key. The first real press should be watched after the restart.

**Checks:** web typecheck is clean and 106 of 106 web tests pass. The root typecheck has one error in `eda/blocks/generate-rp2040.ts`, which isn't mine (see below).

## Worth knowing
- **Real power limit:** on the SHT40 board, even a second I2C header reads 602 mA against the LDO's 600 mA and can't build. The SSD1306 block hits the same limit. This is a true refusal, but it means few blocks fit on that board as it stands.
- **Terse server reasons:** some plan checks read like "Bus needs one controller when peripherals are connected" or "Linked buses need the same protocol and named signal set". They're shown as given. Plainer wording would help makers.
- **Port labels:** `J1` pins read "EH" on the sheet, from catalog labels, where the older sheet had a more varied set of names. Cosmetic.
- **Carrier re-layout:** agent_core now lays out an unmoved board afresh on edit, so PCB parts can shift. The schematic isn't affected, because it draws from the design rather than board positions.

## Hand-offs
- **Restart:** production needs a rebuild and a restart of `moki.service`. agent_core reports `sogo-apps.service` doesn't need one. I restarted nothing. My capture server is stopped.
- **Root typecheck:** `eda/blocks/generate-rp2040.ts(35,301)`, "Object is possibly undefined". Last changed at 01:49, not by me. It needs its owner to fix it before the full `npm run typecheck` passes.
- **Port 5199** is chip_live's bench. My stray requests to it returned 404 and created no jobs.
- **Taste:** the empty-state feedback from round 1 still needs recording by the coordinator.
