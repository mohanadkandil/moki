# agent_core: schematic round, and the RP2040 motor controller bug

## To put this live

Both services now, because the server work below added gateway routes:

- **Moki:** `npm run build`, then restart `moki.service`.
- **Gateway:** in `/home/sogo/projects/sogo-apps`, `npm run build`, then restart `sogo-apps.service`.

I didn't run a production build or restart anything.

## The RP2040 bug (project 24504cbd)

The Verifier didn't know what the mode could build, so it offered a board that couldn't exist. Its zero-check card then offered a confirm the server always refused. The client added "Lost contact" on top of that refusal.

| Asked for | What happens now |
|---|---|
| 1. Decide what can be built first | The Verifier is told what this mode really has and can call `cannot_build`. That gives one written message with what's missing, the closest board and the chip-level line. Code adds the chip-level sentence if the model leaves it out. There's no Looks right. A named chip is never swapped. |
| 2. Questions for a vague brief | `ask_maker`, one round only. The tool isn't offered once a question has been asked. The answer and the first request reach the card as one brief. |
| 3. Zero checks never confirm | No card is made, and the turn goes straight to design. The Designer is the second safety net and refuses the RP2040 too. The server now treats a stale confirm with no checks as "go ahead". Old saved cards lose the button, and text typed under one counts as a new request. |
| 4. One error and a retry | One error per turn: one plain sentence and Try again, on the latest turn only. Code words such as "Confirming needs the requirements." become "That didn't go through, and nothing was built." Words written for people, such as the 429 message, pass through. "Lost contact" now only appears if the stream really ends with no answer. A failure that built nothing leaves the question open. |

Declines from the Designer now also read as prose rather than a boxed "We can't do that yet".

### Measured

- **Live model judgement, no builds (board refuses every job):** 9 of 9 correct.
  - Exact brief, 3 runs: refused each time, naming the RP2040, the motor driver, the closest board and chip-level mode.
  - STM32 logger and plain DC motor controller: refused.
  - Focus timer, desk climate readout, dark-sensing lamp: still get checks and a confirm.
  - "A sensor thing for my room": one round of questions.
- **Real browser, real server, a copy of the owner's project, live model:** 28 of 28 checks passed (`evidence/rp2040/rp2040-flow.json`). This covers the saved project, Try again on it, the brief from the landing page, and forced 400 and 429 refusals. I also inspected the screenshots at 1440 and 390.
- **Replay regression tests for this exact brief** are in `tests/agent-verifier.test.ts` and `web/src/studio/agentChat.test.ts`. They include the real zero-check response and the saved turns from the project.
- **`npm test`: 729 of 730; typecheck clean.** The failure is chip_eda's `tests/blocks-sht40.test.ts` ("second address-0x44 sensor…"), which was already failing.

### Not proven

- Vague-brief questions on the exact brief in chip mode are replay only. The live "vague" case ran in carrier mode with a different brief.
- The refusal is the model's judgement, not a hard rule. It held in every live run, and the Designer refused as well in the one run that reached it. That is a small sample.
- The browser flow never pressed Looks right through to a real build. The confirm-to-build path is covered by replay tests only.

## Schematic round

- **One live activity line.** Each agent shows its mark and role with one line ("Working · reading 3 modules…", then "Designed in 14 s · 5 steps"). Steps, ms, tokens and cost, plus the per-turn total, only appear when expanded. The model name is gone. Times include the model call, not just the tool's near-zero time. Evidence: `evidence/activity-*.png` (fixture data through the real components).
- **`plan.partial`.** Emitted after each Designer step, carrier and chip, with everything known so far. `useStudioAgent` has `onPartial(event | null)`, and null only comes from the turn still running. Drafts with the wrong shape or a boastful claim stay off the canvas, but the step still shows. Tested with replay only, not yet watched live on schem_ui's canvas.
- **Edit ops.** `edits.ts` has `rename_net`, `set_value`, `add_note`, `remove_note` and `add_block`, `remove_block`, `link`, `unlink`, with no server imports. The carrier Editor can use the first four. `applyPlanOps` handles chip plans.

### Differences from the op contract

Superseded by the server work below. Still true: chip `set_value` takes `inst.param`, and `parseOps` stays capped at 12 for agents, with a canvas draft passing its own cap (64).

### Open gaps

- On a refused confirm, Looks right and Try again both show and do the same thing.
- Try again doesn't appear on a follow-up turn with no brief of its own, such as a fix after a build. The composer still works there.

## Other

- **schem_ui's request:** the shell canvas in `StudioShell.tsx` is now empty.
- **One edit outside my files:** I removed the `onRefused` line from `web/src/studio/Studio.tsx`, since nothing goes back in the box now. schem_ui has been told.
- **tscircuit skill:** I've only read `SKILL.md`, `CHECKLIST.md` and the start of `FOOTPRINTS.md`, and changed no prompts. `tsci` isn't on PATH here. Its sections advice matches what the chip Designer already does. The checklist items worth carrying over are labelled key nets and pin 1 on polarized parts. Any prompt change should wait for a paid bench once chip-level runs end to end.

## Server side of schematic edits (owner: "do it")

### What exists

- `POST /api/board/ops/check {baseJobId, ops}`: a dry run with no job. An op that can't apply returns `{ok:false, reason, opIndex}`. One that applies but fails its checks returns `{ok:false, reason, plan|design, graph?}`, so a half-wired draft can be drawn. Success returns `{ok:true, changes, warnings, plan|design, graph?, needsReview?}`. `ops:[]` returns the board as it stands.
- `POST /api/board/jobs {baseJobId, ops}`: refuses with a 400 and one sentence and no job, or queues one rebuild. The job records `input.ops` and `editSummary`.
- `GET /api/board/library?mode=carrier|chip&q=`: modules, and the latest revision of each block with status, ports and params.
- Chip plans: `add_block`, `remove_block`, `link`, `unlink`, `rename_net`, `set_value`, notes. `remove_part` only works when the part is a whole block; otherwise it says which block owns it.
- A chip Editor (`runChipEditor`), plus `{mode:'chip', jobId, ops}` on a turn for a person's edits. Both use the same `editPlan`.
- `BoardPlan.netNames`, in `contract.ts`, `erc.ts` and `graph.ts`, with real_models' agreement. Logic is in `server/board-ops.ts` and `src/agents/plan-edit.ts`.

### Decisions to check

- **The review gate is unchanged.** Any chip edit, even a note, changes what was reviewed. So a direct chip job with no matching receipt is refused up front instead of spending SPICE time and then failing. Chip Apply goes through the agent path, which runs the real Reviewer. That means every chip edit costs model money: about $0.14 measured on one edit. If the owner wants free note edits, the gate would have to stop covering notes, which is the owner's and real_models' decision.
- **A carrier board nobody moved is now laid out afresh after an edit.** The old path froze positions and added 2 clearance errors on any edit, even a note. Parts can shift a little after an edit on such a board. A board with hand placements keeps its layout.
- **The older `{design, baseJobId}` path still has that problem.** I changed only the ops path, so the agent Editor's carrier edits can still hit it. Its Fixer gets a chance to repair them, but I didn't measure that.
- **Chip net names are stricter than I proposed to real_models:** a letter or underscore first, then letters, digits and underscores, because the name becomes a source selector. The ground net can't be renamed, because the fanout pour targets `GND` by name.

### Measured on real workers

All in scratch directories, with scratch review receipts.

| Run | Result |
|---|---|
| Chip: add display block + 3 links, real Reviewer, real firmware, real worker | Job `6f31cc70…`: done, 8 of 8 gates, 0 DRC, firmware compiled, ops recorded, 127 s, $0.135 |
| Chip: rename `V3V3` | Refused with no review. With a fixture receipt: done, 8 of 8 gates, 0 DRC, 37 s, new name throughout the circuit and schematic |
| Carrier: note, value, rename, all three | 0 DRC and 6 vias each, same as base; a note-only edit is a cache hit |
| Chip: add SHT40 to the seed board | **Refused at review, no job, $0.18.** The Reviewer couldn't verify the 100 nF bypass from the datasheet's readable text. chip_live notes that value is cited in a separate Sensirion document, so this may be a block-citation issue for real_models |
| Chip: any added block on the accepted SHT40 plan | Refused by ERC: `Peak load 602.00 mA exceeds 600 mA` |

The rename run's receipt was a fixture, so it tests the build path only, not a review. Only the display run had a real review. Its evidence is in `evidence/chip-edit/`.

Full real runs found six bugs that stubbed tests had passed, all now fixed with regression tests:

- A saved plan pinned to older block revisions couldn't be edited.
- A new block landed off a fixed-size board.
- The Fixer added `requirements: []` to plans without requirements, which invalidated their review. **This affected any chip board without confirmed requirements, not just edits.**
- The re-review guard only looked at links and layers. It now covers everything but placement.
- The Firmware agent was told only "Apply my edit" and wrote an idle sketch.
- The citation rule went by pin count, so it asked a connector for a citation and never asked the SHT40. It now goes by designator, which makes Designer plans stricter on small ICs. It may change chip_live's bench results; chip_live has been told and has reviewed it. A 3-pin transistor (`Q`) still has no required citation, though the Reviewer does check it.

### Tests

- `npm test`: 844 of 845. The failure is chip_eda's `tests/blocks-sht40.test.ts`, which was already failing.
- Gateway: 46 of 46.
- `tsconfig.web.json` typecheck is clean. `tsconfig.json` has one error, `eda/blocks/generate-rp2040.ts:35`, a file that isn't mine, so `npm run typecheck` currently fails on it.

### Not proven

- schem_ui's canvas calling this path in a browser, including Try again resending ops. That's schem_ui's next step. My run called the same `runTurn` from a script, not over SSE through `agent-api`.
- The chip Editor proposing edits from a typed request with a live model. It's replay-tested only; the live runs were all a person's ops.
- That a Fixer can add a citation for a hand-added IC and pass review. The only live case with an IC, the SHT40, ended in a refusal, and it ran before the designator fix.
- A carrier edit that adds a part, on a real build.
- ERC reasons are passed through as they are, and some are terse, such as `Required pad has no real connection or exposed draft boundary`.

## Spend and ledger

- **Live calls, estimated at `gpt-6.1-sol`'s listed price of $2/$10 per million tokens:** about $0.03 for the RP2040 work and about $0.50 for the real chip edits. With about $1.44 from earlier rounds, that's about $2 of the $5 budget.
- **Correction:** I earlier scaled the RP2040 figure up to about $0.25 using production's ledger rate. That was wrong: production was pricing this model as unknown, which chip_live has since fixed. The $0.03 stands.
- **Ledger:** the browser flow ran from the repo directory, so it added 7 test lines ($0.0109 at that test price) to the shared `var/agent-calls.jsonl`, timestamped 01:14:06 to 01:14:38 on 2026-11-06. I left them there. They aren't production use, so leave them out of any usage totals. The earlier isolated previews ran the same way and may have added lines too.
