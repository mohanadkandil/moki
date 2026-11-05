# chip_agents report, 5 Nov 2026

**Status: the Verifier, Firmware agent and effort picker work live on carrier boards. The chip-level agents ran live on chip_eda's real blocks and datasheets, up to where a job would start. No chip-level board has been built through them, because the `{ plan }` job input isn't ready.** Spent $1.24 of the $5 budget. The mechanical requirements section is on hold, and nothing was built for it.

## Verifier, live

Full data: `evidence/chip_agents/agent-bench.json`. Each runs as a maker would: the checks appear, get confirmed, then the design runs against them.

| Brief | Outcome | Cost | Result |
|---|---|---|---|
| Focus timer that runs 4 h on a 1000 mAh battery | **Built, but not done** | $0.021 | 0 DRC, compiled. Battery check not counted: the carrier has no battery. About 13 h if it had one, estimated from typical currents |
| Temperature monitor on a 60 by 40 mm board | **Not done, with numbers** | $0.038 | Built at 75 by 75, failing the size check. The Fixer gave up, saying the parts' footprints can't fit, which I didn't check independently |
| Focus timer over USB with under 6 parts | Built | $0.019 | All 4 checks passed. The board was a cache hit |

- **What it caught:** on the first run the Verifier asked for `usb_power_input`, a synonym nothing reports, so a good design failed. Interfaces are now a closed list per mode, and an unknown one goes to the card's "I can't check these".
- **First battery run:** the Designer declined instead of letting the check report. The prompt is fixed, but that's a prompt rule, so it could recur.
- **Engine:** chip_eda's `src/blocks/verify.ts`. Carrier facts are mine (`verify-facts.ts`), with typical module currents labelled estimated. Those figures are my estimates from typical values, not measurements of these boards.
- **The confirm card:** "Looks right" or a typed yes confirms, and anything else edits. Only a maker's message can loosen a requirement, and they confirm the new list. Code writes requirements onto the design, whatever a model sends.
- **Gate order:** ERC, requirements, SPICE, review, DRC, compile, as briefed. The Firmware agent also does its own sandbox compile before the job, to spare a route when code is broken. On carrier boards the requirement gate runs before the build, and again with the real board size.

## Chip-level, live

Evidence: `evidence/chip_agents/chip-dry/`. Brief: an ESP32-S3 board with USB-C, a 3.3 V regulator, boot and reset buttons and an I2C header. It stopped on purpose where a job would start, with SPICE skipped.

| Step | Calls | Cost | Result |
|---|---|---|---|
| Verifier | 3 | $0.012 | 5 checks, 1 sent back by code for a zero-width voltage range |
| Designer | 7 | $0.087 | Chose all 5 seed blocks, wrote 5 titled sections, and 3 citations passed the code check |
| Reviewer | 7 | $0.112 | 15 findings match the datasheets, after code sent back 1 citation or coverage problem. Out-of-scope risks are listed for the maker |
| Firmware | 2 | $0.017 | Compiled for the S3 on try 1, 12.8 s, in the sandbox, against the real pin map |
| **Total** | **19** | **$0.23** | 145 s |

Two earlier runs are kept beside it, and each found a real problem:
1. **SPICE failure:** `runSpiceChecks` couldn't read `10kOhm` on the seed block's R1, and the Fixer then spent $0.24 on something it could never fix. A simulator that can't run now stops the turn without a Fixer. chip_eda has the evidence.
2. **Reviewer scope:** it refused the board because passives cite their IC's datasheet, which it took as a wrong datasheet, and it asked for thermal and source guarantees no schematic can give. Passives are now judged against the IC's circuit, and those risks are a separate "out-of-scope" finding shown to the maker. **I loosened that gate after seeing it fail, so the 15 passing findings are worth a person's look.** Nobody has checked the Reviewer's judgement against a known-bad schematic with a real model.

Still not run on chip-level: SPICE, the job, DRC, a draft from a part outside the library, and a Fixer that succeeds. That firmware also compiled with the native USB flags chip_eda asked for (12.5 s, in the sandbox), which code sets per board. No block or model can set a flag.

## Effort picker

The composer now shows a mark plus **Fast / Balanced / Deep**, and model, reasoning, cap and measured cost live in the popover. Agents off shows a ring and "Rules". The mark is one component and one colour token, so the brand can change in one place. Inspected at 1440 and 390 with the real components in `evidence/chip_agents/ui/`; the bundled harness replaces the app, because the dev server is stopped, so it hasn't been seen inside the full studio.

All three efforts built a focus timer live with 0 DRC errors: Fast $0.018, Balanced $0.016, Deep $0.020, one run each. A simple brief doesn't show what they buy. The caps are my defaults: Fast $0.50, Balanced and Deep $2, with nothing above the hard $2. The popover's cost is real builds on that server, so it says "No builds yet" at first.

## Firmware agent, live

Full data: `evidence/chip_agents/agent-bench.json`. Every call: `agent-bench-calls.jsonl`. What the model wrote: `firmware/*.cpp`. Carrier boards, `gpt-6.1-sol`, one run each, against the real job API on `moki.service`. Not run through the chat, gateway or tunnel.

| Brief | Outcome | Calls | Tokens in / out | Cost | Agent time | Pipeline | Result |
|---|---|---|---|---|---|---|---|
| Desk humidity display | Built | 5 | 9,666 / 2,299 | $0.028 | 38.4 s | 24.1 s | 0 DRC, compiled on try 1, 112 lines |
| Reaction-time game | Built | 5 | 10,054 / 4,500 | $0.051 | 81.4 s | 26.2 s | 0 DRC, compiled on try 1, 206 lines |
| Broken firmware, fixed by the model | Built | 2 | 1,991 / 1,124 | $0.015 | 18.0 s | 19.6 s | 0 DRC, compiled on try 2 |
| "Show a progress bar" on a timer | Built | 4 | 6,781 / 1,578 | $0.026 | 21.0 s | 36.2 s | 0 DRC, compiled on try 1 |
| Focus timer (regression) | Built, fixed program | 3 | 7,931 / 880 | $0.016 | 12.4 s | 38.0 s | 0 DRC, compiled |
| Plant moisture alarm | Declined | 2 | 3,615 / 107 | $0.004 | 5.4 s | none | No soil probe in catalog |
| Door chime | Declined | 2 | 3,631 / 117 | $0.004 | 4.5 s | none | No door sensor in catalog |
| Pomodoro with LED ring | Declined | 2 | 3,633 / 119 | $0.004 | 4.9 s | none | No LED ring in catalog |

**How to read these:**
- **Compile only:** this firmware has never run on anything, so "compiled" says nothing about behaviour. I spot-checked two of the sources; I didn't review their logic in full.
- **Reruns:** the humidity and game rows are the latest runs, after fixes. The first humidity build failed because the sandbox couldn't start under `moki.service`. That's fixed. All runs are in the total.
- **Fix case:** the design and a deliberately broken first source were scripted. The compile errors and the fix were real.
- **First draft of the humidity firmware:** the model wrote its own register-level BME280 driver, which compiled but which nothing could check. The agent is now told to use the listed library, and it does.
- **Cost:** provider tokens at the [listed price](https://developers.openai.com/api/docs/pricing), not an invoice. Cached input is charged at $0.20 rather than $0.10 per million, so it's slightly high.
- **The three declines** are correct on carrier boards. In chip-level mode, the Designer could use real parts for them, but that hasn't run.

## What was built

- **Firmware agent** (`src/agents/firmware.ts`, `firmware-project.ts`): writes against a pin map, fixes from real compiler errors, 3 compiles at most, and works for any target a spec names. The Designer asks for it when a fixed program can't do the job, and the Editor when a maker changes behaviour.
- **Compile sandbox** (`src/agents/pio-sandbox.sh`): no network, read-only toolchain. Measured: the same source can see the `moki.env` path without the sandbox and can't inside it (`evidence/chip_agents/sandbox.json`). Compiles took 3–15 s. The S3 toolchain is installed and compiles too.
- **Datasheets** (`src/agents/datasheet.ts`): fetches only catalog URLs on public hosts, reads by page, and code checks each quote against the page. Tested offline on the real ESP32-S3 PDF: 53 pages in 1.6 s.
- **Chip-level agents** (`src/agents/chip.ts`): Designer with sections and citations, schematic Reviewer, Fixer with enforced bounds, and gates in order: ERC, SPICE, review, compile, DRC. **Fake library only.**
- **Architecture:** `architecture.md` and `architecture.png`, inspected, label **proposed**. Block contract agreed with chip_eda, who owns `src/blocks/contract.ts`.

## Tests

- **Full `npm test`: 491 of 491 pass**, run before the native USB flag. After it, all 257 agent tests pass. `npm run typecheck` passes.
- The default test path has no network and no paid calls.
- Replay uses a fake engine and board, and a few tests use chip_eda's real engine.

## Independent review

One read-only review ran, on an earlier version, traced by hand without running GCC. It found no route from model-written C++ to `moki.env`. The findings it raised:

**Fixed:**
- Library install scripts could run code, so platforms and libraries now come from an approved list.
- The toolchain was writable from the sandbox, so it's now read-only.
- Four ways past the source check.
- Many compiles in one response got round the limit.
- Firmware smuggled inside a design.
- "Skipped" counted as compiled.
- A brief that grew until it failed validation.
- Behaviour settings that silently did nothing on custom firmware.
- A firmware-only change the browser ignored.
- Library sets that removed each other.
- Moving a power link, and server paths in log tails.

I also found and fixed a gap myself: a build fix could change values after review had passed.

These fixes, and everything added since (Verifier, datasheets, Reviewer, picker), have not had an independent review.

**Handled by chip_eda:** `POST /api/board/jobs` with `{ source }` ran TSX outside any sandbox and could read `moki.env`. chip_eda has refused `source` on the production preview. Per its report that isn't live until you restart.

## Gaps

1. **Chip-level end to end:** needs chip_eda's `{ plan }` adapter and the SPICE value fix. Chip mode is off until `MOKI_CHIP=on`.
2. **No chip-level UI:** nothing in the composer sends `mode: 'chip'`, and `plan` events aren't drawn. real_stage is closed, so it needs an owner.
3. **Reviewer not tested on a bad schematic:** see above. Same model in a fresh context, so it shares blind spots.
4. **Growth loop:** promotion isn't built, and no real draft has run. All seed blocks currently say unreviewed, and chat says so.
5. **Live link:** a restart is needed for all of this. The Verifier then runs on every new design, adding about $0.01 and one confirm step. Tunnel streaming is still unproven.
6. **Fixed firmware and the checks:** behaviour the firmware doesn't have can't be checked by any metric. It goes in "I can't check these".

## Files outside my list

- `src/firmware/index.ts`, `src/circuit/model.ts`, `validate.ts`, `graph.ts`: `design.app` and `design.requirements`, with chip_eda's agreement. `src/firmware/index.ts` now also imports from `src/agents/firmware-project.ts`.
- `package.json`, `package-lock.json`: `pdfjs-dist` 4.10.38 added exactly.
- `src/board/firmware-worker.ts`: chip_eda made the sandbox change I asked for.
- `var/`: `firmware-shared` and bench jobs in `board-jobs-app`, not tracked.
- `/home/sogo/.local/share/moki-tools`: S3 toolchain added, about 1.4 GB.
- `var/schematic-reviews`: one review receipt from the chip-level dry run, written by the same function a real run uses.
