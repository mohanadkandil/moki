# chip_live report, 6 Nov 2026

**Status: not accepted. No live run has produced a board.** Chip mode is wired into the live turn and on by default, so "Design an RP2040 motor controller" no longer gets refused. None of the 3 acceptance briefs built, and I stopped at $4.60 of the $5 budget because $0.40 doesn't cover a full run. Nothing here is deployed: `moki.service` still runs the old code.

## Acceptance

| Brief | Best live result | What stopped it |
|---|---|---|
| RP2040 motor controller | Passed the Verifier and Designer, using the RP2040 and DRV8833 blocks | Reviewer couldn't verify 2 sections: the block was too big to read, and the button borrowed the MCU's datasheet. Both are fixed, not re-run. Routing is also not passing yet: real_models' job `5d729e88` failed DRC |
| ESP32-S3 air quality monitor with a screen | Designer stage | No library regulator could carry the load, so the Designer spent its budget authoring one, and declined or hit the cap. Now fixed with `tps63001-usb-5v-3v3`, not re-run live. A scripted replay then stops in routing fanout |
| Soil moisture alarm | Passed ERC, SPICE and review with 2 authored blocks (run at 02:09) | Firmware refused a header it needed. A later run failed a connector check. Both are fixed, not re-run |

All 10 runs are in `evidence/chip-live-bench.json`: $4.60 in total. A run that got to review cost $0.51–0.85 and took 4–9 minutes. The bench answers the Verifier's questions and confirms its checks, using the browser's request shapes.

**Replay (no model cost):** model calls scripted, everything else real. `evidence/replay-s3-spike.json`: job `dbcce417` on the 5-block S3 spike plan reached built in 38 s with all 8 gates passing, 0 DRC errors and a real compile. That proves the path after the models on one simple board. Its plan was not designed by a model and its review was scripted, so it isn't acceptance. `evidence/replay-s3-air-library.json` is the failed air quality replay: placement passes, then job `e0ad14a3` stops with "Native fanout must be prepared before routing".

## What changed

- **Routing (`turn.ts`):** the kit Verifier's `cannot_build`, the kit Designer's decline and the Editor's decline all go to chip mode. Mains voltage still declines, because the chip Verifier refuses it too. The card carries `mode`, and `agentChat.ts` sends it back, including after a reload. `MOKI_CHIP=off` turns chip mode off.
- **Block Author (`chip.ts`):** the Designer calls `author_block`. A separate agent finds a real part, reads the datasheet and writes the block. Code stamps who wrote it, refuses MCUs and unapproved libraries, and carries it into the plan so a model can't alter it. 3 tries per board, failures included.
- **Unreviewed labels:** chat and BOM carry them, and code now writes them on the section notes, so they appear in `schematic.svg` (checked on job `dbcce417`). Whether the canvas draws them is not checked.
- **RP2040 target:** `platformio/raspberrypi@1.20.0` plus a code-owned toolchain override, because its own toolchain has no aarch64 build. Compiled in the sandbox in 12.4 s. This is the Arduino mbed core, not arduino-pico.
- **Activity line:** adds time to the cost line. Not seen rendered.

## Bugs the live runs found

1. **Price:** `gpt-6.1-sol` wasn't in the price table, so the live link counted it at $15/$75 and a turn hit its $2 cap after about 10 cents of real cost. Fixed in `model.ts`. This affects production today.
2. **Datasheets:** LCSC's 403 was only our fetch sending no User-Agent. It now sends a plain client name and follows the catalog page to the PDF. Parts the catalog gives no URL for (SCD40, ENS160) can only use a maker's PDF, from a list of hosts in code, and the PDF has to name the part.
3. **Reviewer:** block reads over 24k characters were cut off silently, and an RP2040 block is 69k. Large blocks are now read by section.
4. **Lent datasheets:** a switch inherited its MCU's datasheet. Only an IC lends its citation now, and a draft's own URL is never trusted, which was chip_eda's note.
5. **Library gaps, fixed by real_models on request:** MCUs had no GPIO ports, `usb-c-sink` lacked the USBLC6's 100 nF bypass (a real Reviewer catch), and no regulator could feed an S3 plus a screen from USB. The LDO was over budget by 0.5 mA.
6. **Saved plans:** a plan on an older block revision was refused once a new revision shipped. Fixed.
7. **Smaller:** the Designer now sees the confirmed checks, catalog 500s are retried, and J parts count as connectors (`verify.ts`, kept by real_models).

## Open

1. **Routing, real_models:** RP2040 DRC and the S3 air fanout error.
2. **Automatic anchors, real_models (requested):** a plan with no `at` fails placement on a normal board, and the Designer's schema leaves `at` optional. I expect live plans can hit this; no live run has reached a job, so it's unmeasured. The build Fixer can only try moving parts.
3. **Budget, owner's decision:** 3 acceptance runs need about $2.50 at the measured costs, more if another bug appears. $0.40 is left.
4. **Going live before acceptance:** after a restart, those briefs will get a gate failure in writing rather than a refusal, after spending about $0.50 and several minutes. `MOKI_CHIP=off` avoids that. Your call, since the owner asked for no refusals.

## Departures from the brief

- **`testBlock` isn't called per draft.** It needs a review receipt for its context plan and repeats a full route. The plan job's `block-test` gate runs the same pad inspection on every block, drafts included. No standalone receipt exists for later promotion.
- **`plan.partial`:** sent during design, and the replay showed a 22-part sheet. Not seen growing in the browser.
- **Cap:** stays $2, not raised for Deep. No run needed more once the price was fixed.

## Tests

- Full `npm test`: 871 of 872. The failure is `tests/blocks-sht40.test.ts` (`i2c-address-collision` not raised), after real_models' `erc.ts` edit at 02:24. I've told them, and I didn't confirm the cause.
- `tsc` shows errors only in others' in-progress files: `eda/blocks/generate-rp2040.ts` and agent_core's `ops`.
- New: `tests/agent-chip-live.test.ts` and additions to `agentChat.test.ts` and `agent-datasheet.test.ts`.
- No independent review of this round's code. The maker-PDF route and the LCSC link following are the parts most worth one.

## Files outside my list

`src/agents/{turn,protocol,model,datasheet,firmware,firmware-project}.ts`, `src/blocks/verify.ts`, `web/src/studio/{agentChat.ts,agentCards.tsx}`, `tests/agent.test.ts`, `scripts/chip-live-{bench,replay}.ts`. On this server: the RP2040 platform and ARM toolchain in `~/.local/share/moki-tools`. My test server is stopped.

## Addendum, 6 Nov 04:20: job failures in the chat

After deployment, a live RP2040 job threw in `legalize.ts`, and Bun's source excerpt reached the chat in the `job-result` problems and the final message. `src/board/failure.ts` now gives one sentence plus the error's first message line, for example: "The build failed during layout. Cannot legalize unsupported footprint dimension 180deg."

- Used by `assessJob`, `closingLine` and `jobFacts`, so the Fixer no longer reads the stack or server paths either. Also used by the studio summary, `BoardStudio` and `panels`.
- The chat's "Full error" expander is gone. The full text stays in `job.json` and `render.log`, and the job API still returns it.
- A job that threw no longer adds "Compile gate: the firmware wasn't compiled", which was a misleading second reason.
- Source echoes are taken out of model-written chat messages, whole lines only. An excerpt a model flattens into a sentence isn't caught.
- Tests: `tests/agent-chip.test.ts`, `web/src/studio/studio.test.ts`. Not deployed and not seen in a browser.

## Addendum, 6 Nov 05:15: board size and Fixer rules

The second live RP2040 run ($0.90) failed on a 55 × 40 mm board the Designer guessed; the Fixer then went to 65 × 55 mm (1 DRC error) and 4 layers (17). No live money was spent on this fix.

**Board size.** `eda/blocks/board-size.ts` loads the real footprints and calls the job's own `placePlanSections`, so the agents and the job can't disagree. `sizedPlan` then replaces any board a model sent with the packed minimum plus 6 mm per axis. A sent board stays only if the maker confirmed a size, it's inside that size and it packs. A saved board in an edit stays if it still packs. If the maker's size can't hold the sections, the Designer gets the numbers back before any review. If the sizer can't run, the board is left out and the job packs the plan itself. `check_plan` shows the Designer the reserved envelopes and the board code will use.

**Fixer rules, enforced in code.** More layers are refused for a clearance failure. A fix that raises DRC errors is undone, the next fix starts from the better board, and that change is refused if it comes back. A board that doesn't pack is refused with the real minimum.

**Offline replay** of job `1f1e315c`'s plan, with scripted models and a server without an API key (`evidence/replay-rp2040-board-size.json`): the scripted Designer sent 55 × 40 mm, code used 46 × 66 mm, and job `50a05041` passed all 8 gates with 0 DRC errors and a compile, in 191 s. Size sweep of the same plan (`evidence/replay-rp2040-size-sweep.json`):

| Board | Result |
|---|---|
| 40 × 60 mm (minimum) | Built, 0 DRC errors |
| 46 × 66 mm (chosen) | Built, 0 DRC errors, in two jobs |
| 65 × 55 mm (old Fixer size) | Failed `block-test`: "Missing/degenerate/unsupported physical pad shape U5", 0 DRC errors |

What this does not show:
- **Board size isn't what cleared the DRC errors.** All three sizes have 0 now, so real_models' router work did that. Size only stops the placement failure.
- **The 6 mm margin is a judgement.** This plan builds at the bare minimum too. It's there for denser plans, and no plan has shown it's needed.
- **The review and firmware were scripted.** Nobody reviewed this replay, the firmware only prints hello, and the requirements were dropped.
- **The Fixer rules never ran on a real job,** because the replay built first time. They're covered by unit tests against a fake board.
- **The worktree moved during this.** real_models edited `auto-placement.ts` and `build.ts` at 04:57, and 55 × 40 mm now packs by rotating the MCU section, so the sizer reports it as fitting. Code still replaces it unless the maker asked for that size.

`tests/blocks-auto-placement.test.ts` has one failure, in real_models' 55 × 40 mm test, edited at 05:03: it expects an exception and none is thrown. I didn't touch that test or `auto-placement.ts`, and I haven't confirmed the cause.

## Addendum: reaction-time brief regressions (project bfaffbcf)

**Why the kit said no.** The catalog lookup never failed. The kit Designer read the catalog and declined, because `validateDesign` only allowed a family's own modules on its board and no family had an OLED, a knob, a piezo and an LED together. Its reason wasn't stored, because `toChip` threw the message away. The `Part search unavailable` line came later, from the chip Block Author's JLCPCB search, so it had nothing to do with this.

**Changes**
- With custom firmware, the focus-timer board takes any catalog module. Fixed programs keep their limits. Small parts share a row, so this board is 90 × 100 mm rather than 90 × 145 mm, and existing timers are unchanged.
- The bench view places parts a template has no spot for, where it used to throw.
- If every confirmed check is a kit part, the Designer's first decline is sent back once. A second decline goes to chip mode, and the chat now gives its reason.
- `cleanBrief` removes quote gutters and hard wraps at `parseTurn`, at project creation and in the client's `send`.
- Opening an activity row now shows one row per tool, with a count. A read that only ever came from memory gets no row, its cost moves to another row, and failures always show. Block Author steps sit in the Designer's row.
- The save retries by itself when the server is unreachable or answers 5xx, backing off from 2 s to 30 s. A 4xx refusal isn't retried.
- An interrupted turn says one sentence and offers Try again. Try again on a confirmation reopens the checks and confirms them, where it used to send "Looks right" as a new brief.
- **A bug found while checking this:** `AgentTurnCard` compared an item index with a block index, so an error after a collapsed row was often never shown. Fixed.

**About the wall of cards:** the deployed bundle already collapsed tools into one row, so the ~20 cards are what that row shows when opened. I didn't see the owner's screen, so that's an inference from the code and data.

**Measured, no model calls**
- `scripts/kit-replay.ts` on the exact brief (scripted decline, design and compile; hand-written firmware): job `23ff84d6`, outcome `built`, 5 of 5 checks, 0 DRC errors, compiled, case generated, 25 s pipeline, 37 s total. Evidence: `evidence/replay-reaction-kit.json`.
- The real saver against my test server, stopped and restarted during a save: `retrying` four times, `saved` at 7.6 s, and the state was on disk.
- The owner's project copy, rendered in headless Chromium from a scratch build: 5 activity rows at rest and no cards. Reloaded with its last turn still marked working, it showed the one sentence and Try again. Screenshot checked.

**Not measured**
- **A real model's choice:** no live runs, per the hold. The prompt and the one push-back should steer it, but nothing here shows that it now picks the kit.
- **Firmware quality:** model-written firmware for this game hasn't been written or compiled, and nothing has run on hardware.
- **Other mixes:** only this mix has been through a real build. Other mixes on the board pass validation only.
- **A stream cut in a browser:** the mid-stream path in `useStudioAgent` was only type-checked. The sentence, the reopened checks and the reload path are covered by tests and the render.
- **A false conflict:** if the server applies a save and dies before answering, the retry gets a 409 and shows the "changed in another tab" note. I didn't handle this.
