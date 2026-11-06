# compact: smaller carrier boards

## To put this live

Run `npm run build`, then restart `moki.service` when no maker turn is running. I haven't restarted anything. The gateway isn't affected.

## Board area before and after

These come from real builds on real workers, in a scratch job root: routing, DRC, copper check, case and firmware.

| Board | Before (mm) | Area | After (mm) | Area | Smaller by | Case, before → after (mm) | Vias, before → after |
|---|---|---|---|---|---|---|---|
| Focus timer | 90 × 100 | 9000 | 86 × 62 | 5332 | **41%** | 94.6 × 105.6 → 90.6 × 67.6 | 4 → 3 |
| Light lamp | 90 × 105 | 9450 | 45 × 59 | 2655 | **72%** | 94.6 × 110.6 → 49.6 × 64.6 | 0 → 0 |
| Temperature, DS18B20 | 75 × 75 | 5625 | 71 × 59 | 4189 | **26%** | 79.6 × 80.6 → 75.6 × 64.6 | 6 → 4 |
| Temperature, BME280 | 75 × 75 | 5625 | 70 × 59 | 4130 | **27%** | 79.6 × 80.6 → 74.6 × 64.6 | 5 → 1 |
| Reaction game | 90 × 100 | 9000 | 86 × 62 | 5332 | **41%** | 94.6 × 105.6 → 90.6 × 67.6 | 6 → 2 |

All five finished with:

- 0 DRC errors, fully routed, and the copper-connectivity check passing
- the case built with no fit warnings, and the same lip (2.95 mm)
- the screen's viewing angle unchanged at 35° on the four boards with a screen
- firmware built

The height of the case didn't change, at 30.49 mm. The ESP32 alone is 54.4 mm long, so about 59 mm is the shortest any of these boards can be with the USB on an edge.

I also built six module mixes nobody had tried on a compact board, including 11 parts at once. All six passed the same checks, at up to 77 × 78 mm and 10 vias. The numbers are in `evidence/compact/results-after.json`, and the before figures in `results-before.json`.

## Renders

`evidence/compact/reaction-{before,after}-*.png`, inspected: populated board, lid on, lid off, and bare board from above.

- The ESP32, screen, knob, buzzer, LED and resistor now fill the board.
- The screen sits above the knob on the lid.
- The USB opening is on the front wall.
- Nothing collides, and the silkscreen is readable.
- The LED floats above the board in these renders, before and after. That's how it's modelled: it stands on long leads up to its lid hole.

## What changed

- **`src/board/compact.ts` (new) replaces the slot placement.** It tries each ordering of the four largest parts under a range of height limits. Each part goes where the board stays smallest, counting wire length as well as area. It then trims the outline to the parts. This goes further than the brief's pass after slot placement: the slots are gone, because they added nothing once the search ran.
- **`src/board/codegen.ts`:**
  - It uses that placement.
  - The silkscreen outline and reference of an LED, LDR, buzzer or resistor are now drawn where the part really stands, on its pads. The case and the 3D model already put them there.
  - The board's ID goes in a clear strip, not at a fixed spot.
- **`src/board/edits.ts`:** when the USB moves to another edge, the ESP32 slides along that edge to the nearest clear spot.

## Rules it keeps

| Rule | Value | Why |
|---|---|---|
| Part to part | 1.5 mm | Outlines are catalog estimates, and modules go in by hand. The existing rule's 0.2 mm is still enforced too |
| Part to board edge | 2 mm | The lid's lip takes 1.6 mm, and it can't pass a tall part |
| Part to M3 hole | 3.3 mm | Lid pillar radius plus the case's fit clearance. Holes stay 4 mm in from each corner, with the 3 mm corner radius unchanged |
| Beside the screen | 3.5 mm | Room for the viewing funnel at its widest, and for a neighbour's lid hole |
| Screen and knob | Screen above knob | A hand on the knob doesn't cover the screen |
| USB | Exactly on the bottom edge | Same check as a hand edit |
| Temperature sensor to ESP32 | 6 mm | What the old layout gave it. Not thermally simulated |
| LED to light sensor | 15 mm | So the lamp's LED doesn't turn itself off. This is my judgement and hasn't been tested on a real lamp |

Parts aren't rotated. The same design always gives the same board: tests cover repeat calls and reversed part lists, and the source regenerated in a separate process matched what was built on all 11 boards, checked before the last two placement changes.

## Measured

- **`npm test`:** 1267 of 1268 pass, 0 fail. This includes the Bun enclosure suite, the real routing and copper test on all templates, and real hand edits rebuilt on compact boards. The other one didn't report a pass or a fail, and I haven't identified it.
- **`mech/tests`:** 21 of 21.
- **Typecheck:** clean on both configs.
- **Tests changed:**
  - `tests/board-compact.test.ts` is new.
  - Four assertions that hard-coded the old layout now follow the new one: in `agent-kit-mix`, `board-routing` and two places in `board-edits-integration`.
  - `board-edits` reads a new fixture built from a real compact board. Its other tests still use the old 75 × 75 board, so old saved boards remain covered as editable.
  - The temperature test's "no more than 40% smaller" limit is gone.

## What the real builds caught

My first version passed all its unit tests but failed on real builds:

- **Keeping the ESP32 leftmost** made USB moves easy, but it broke the key board. The knob's pins then face away from the ESP32, and the reaction game came out with one unrouted trace and 13 DRC errors. So parts can now sit on either side of the ESP32, and placement counts wire length.
- **The LED's lid hole** narrowed the screen's funnel from 35° to 26.6°, which is why the screen clearance is 3.5 mm rather than 2.8 mm.

## Things to know

- **No automatic fallback if a compact board won't route.** 11 of 11 routed, but the router is a heuristic and this keeps less spare room than before. A design that fails gets DRC errors, as any board does today, and the Fixer can then move parts or enlarge the board, which costs model money. A retry with wider spacing would have to go in the job pipeline in `server/board-api.ts`, which real_models owns. I didn't add it.
- **A finished job can report DRC errors.** The failed reaction build above still had status `done` with 13 errors. I didn't change that.
- **Moving the USB on an already compact board is usually refused,** because the ESP32 is 54 mm long and has nowhere to go. It works on a bigger board. The old large boards had more room, though they refused many of these moves too.
- **The placement search takes about 0.15 s on 5 parts and 0.7 s at the 12-part limit,** once per design in each process, because results are cached. It blocks the server's event loop while it runs.
- **Tall parts can't sit under the ESP32.** A resistor would fit between its sockets and save more area, but the existing rule refuses overlapping outlines, so I left that alone.
- **A hand-edited board's ID goes back to the top of the board,** set by `eda/apply-layout.ts`. It can land on a part there. This affects silkscreen only.
- **Other rounds' evidence got overwritten.** The existing tests write into `docs/engineering/2026-11-04-tscircuit/evidence/fix_core` and `docs/engineering/2026-11-04-canvas-tools/evidence/edit_core` on each run, so those folders now show compact boards. Those tests already did this before this round.
- **Measured from software only.** No board has been printed or test-fitted, and module outlines are still catalog estimates.
