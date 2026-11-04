# canvas_ui: canvas tools, Layer 1 and the UI side of Layer 2

4 November 2026. No commits, pushes, stashes or resets. I didn't rebuild or restart production: `moki.service` is active, and `dist/web` dates from 21:01, before this work.

## Status

**Layer 1 works in the browser on a real temp-monitor job. Layer 2's UI is wired to the real API, but a valid move has not yet produced a finished job, so that acceptance item is open.**

| Acceptance item | Result |
|---|---|
| Invalid move rejected with a clear message, no job queued | **Pass, real API.** Dragging U2 off the board returned "U2 extends outside the board outline"; job count stayed 30 → 30 (`evidence/canvas_ui/edit-real-rejection-1440.png`) |
| Move U2 → new job, 0 DRC errors, routed, copper oracle, case fit, case visibly changes | **Not proven.** Two real attempts (U2 5 mm right) reached the server with the right edit, then failed with "Worker timed out after 120000 ms": `07d4988e`, `9e479151`. Machine load was very high and an unedited job (`fc222875`) timed out the same way, so load is a likely cause, but I haven't ruled out edited renders hanging. I've asked edit_core. No after-PCB or after-case images exist. |
| `npm run typecheck` | Full run passed before my last small web edits. Web config (`tsconfig.web.json`) passes on the final code. |
| `npm test` | **Not run**, because of memory pressure. Studio and board web tests: 53/53. |
| Scratch build (`--outDir`) | Pass |
| Screenshots of every tool state at 1440 and 390, inspected | PCB and schematic retaken on the final CSS. **3D and Case at 390 predate the compact card** (see limits). |

## Decision to review: I replaced tscircuit's PCB viewer

The brief named `@tscircuit/pcb-viewer` for editing. It has no API for its camera, selection, pads or net highlight, so most of Layer 1 couldn't be built on it. `BoardCanvas.tsx` now draws the PCB as SVG from `circuit.json`. edit_core agreed: viewer events aren't needed, and the API takes placements directly.

- **Gained:** real copper and pad colours (this ends the magenta pads and the brittle CSS filter from the realism round), and a smaller lazy chunk for this tab.
- **Lost:** the viewer's own DRC-error overlays and its context menu.
- **Fallback:** if the canvas throws, the tab still falls back to the generated SVG.

## What's there

- **PCB left rail:** Grid (G), Pads (P), Nets (N), Airwires (A), Labels (L), Front / Back (B).
- **PCB right rail:** Select (V), Measure (M), Move (E), Turn 90° (R), Board size and USB edge, Undo, Redo.
- **Measure:** snaps to pads. On real pads: 25.53 mm, Δx 25.40, Δy 2.54.
- **Zoom pill and readout:** "– 1.0× + Fit" on PCB and Schematic; board size in mm at top right, plus grid pitch or net name when relevant.
- **Schematic:** Grid, Pins, Labels. Click a part to see its pins and nets. Still read-only, and still an `<img>` so edited TSX can't run scripts.
- **Cross-highlight:** a part selected on PCB, Schematic, 3D or Case stays selected on the others, with one card (refdes, module, position, pins and nets). On the PCB, a pin's net can be clicked from the card. The card sits on the far side of the drawing from the part.
- **Case:** the shell opens around a selected part (see-through lid, parts shown) and marks that part's opening. A new "Show the parts inside" tool does the same by hand.
- **Keyboard:** G, M, F, Esc on all drawings (M on PCB only). They don't fire while typing or with focus in the chat. PCB parts can be reached with Tab and picked with Enter; arrow keys nudge 1 mm in Move.
- **Phone:** the rails become one strip that scrolls sideways, with tools first. Pinch zoom is coded but not exercised. The card keeps its pins folded and gives way while moving or measuring.
- **Edits:** a draft shows what changed in words ("U2 moved 5 mm right"), with old copper dimmed and airwires on. Local overlap and off-board warnings are hints only; the server decides. A rejection appears on the canvas and creates no chat turn. Rebuild posts `{baseJobId, edits}`.
- **Edit history:** "Edited from <job>" with the server's `editSummary`. Undo opens the base job and Redo returns. Re-running an edited job posts `{baseJobId}`, so the layout survives, as edit_core asked.

## Also done

- **agent_core's patch** in `Studio.tsx` and `conversation.ts`, including the `submitByRules` correction.
- **P2-3 and P2-4** from the E7 review: see `2026-11-04-realism/reports/real_stage.md`.

## Not verified, and known limits

1. **The killed run.** My last browser run was stopped by the system for low memory, and I was told not to restart it. It would have checked, on the final code: the phone 3D and Case shots with the compact card, re-run of an edited job posting `{baseJobId}`, G from a focused tab, arrow keys staying with the tabs, and `?mock=board&agent=demo` playing agent cards. None of these has been seen working. `cross-3d-*-390.png` and `cross-case-*-390.png` show the older full card, which covers the model.
2. **Mocked evidence.** `pcb-rejected-*`, `pcb-edited-from-1440` and `pcb-redo-1440` use a mocked server response, so their words and job are stand-ins. The earlier undo and redo run used that mock.
3. **Local hints can be wrong.** They use the silk outline, while the server uses mechanical envelopes. Rebuild stays enabled so the server can overrule them, and that means a hint can warn about a move the server accepts.
4. **Class clash.** `agent.css` also uses `.st-tool`, for agent tool rows. I guarded the rails and dock, and asked agent_core to rename theirs. Until then my `.st-tool` size and tooltip rules still reach their rows. I haven't looked at how those rows render.
5. **USB edge "now" value** comes from the case's USB opening, so it's absent on a build with no case.
6. **Preview limits.** During a board-size draft, mounting holes stay where they are and the drawing doesn't refit, so it can touch the edge at 390.
7. **Source re-runs** are still titled "Edited board" (from P2-4).
8. **No physical device.** 390 is a simulated viewport with simulated touch.

## For the coordinator

- **Needs from edit_core:** a verified edited job ID. Then the before/after PCB and case evidence can be taken.
- **Needs from you:** a production rebuild after acceptance, when you choose to do it.
- **Files:** new `BoardCanvas.tsx`, `PartCard.tsx`, `SourceBadge.tsx`, `pcbModel.ts`, `editing.ts`, `useBoardModel.ts`. Changed `PcbPane`, `DrawingPane`, `Rail`, `Canvas`, `CaseTab`, `ModelPane`, `CodeTab`, `Studio`, `conversation.ts`, `facts.ts`, `studio.css`, `studio.test.ts`.
