# no_mcu report, 6 Nov 2026

**Status: offline acceptance met; no real model has made this choice yet.** Both no-MCU briefs built with scripted model calls and hand-written plans, and the reaction game still builds on the kit with its ESP32. Nothing is deployed, nothing was committed, and `moki.service` wasn't touched.

## Acceptance (no live spend)

Everything after the model calls is real: the no-code rule, requirements, ERC, SPICE, job API, routing, DRC and the copper netlist check.

| Brief | Job | Board | ERC, power, requirements | SPICE | DRC | MCU in BOM | Firmware stage |
|---|---|---|---|---|---|---|---|
| A night light that turns on when it gets dark | `3fe616b4` | 20 × 42 mm, 15 s | Pass | 0.61 V at 10 lux, 4.55 V in the dark, 13.0 mA LED | 0 errors | None | None |
| A buzzer that beeps when water touches two wires | `9b5508da` | 28 × 56 mm, 15 s | Pass | 4.17 V with 200 kΩ assumed between the wires | 0 errors | None | None |
| Reaction game (`scripts/kit-replay.ts`) | `0dd05867` | Kit with ESP32, 35 s | Pass, 5 of 5 checks | Not applicable | 0 errors | ESP32 | Compiled, case generated |

The review stage in both no-MCU jobs is scripted, so **no agent or person has reviewed these schematics**. The chat line in those replays that says a second agent checked them is the scripted run speaking.

Evidence is in `evidence/no_mcu/`: `replay-*.json`, BOMs, gates and screenshots. I inspected the Firmware, Schematic, PCB and 3D screenshots in headless Chromium, using test projects I wrote from the job records. The agent card itself wasn't exercised in a browser.

## What changed

- **Who decides.** The Verifier has a `no_code_needed` tool, and it comes before asking whether the kit can build it. The kit Designer can hand over with `decline` plus `no_code_needed`, and the chip Designer can propose a plan with no MCU plus `no_mcu_reason`. Each route gives the chat one sentence saying why.
- **What holds them to it (`src/agents/no-code.ts`).** A brief that mentions a screen, Wi-Fi, a menu, a timer, a game and similar words can't lose its controller, whatever a model says. "555 timer" is exempt. A block with a bus port also needs an MCU. Once the maker has been told no MCU, a plan with one is refused.
- **MCU choice, from the owner's note.** The chip Designer prompt now says the idea picks the controller: none if it needs no logic, otherwise the one the brief names or else the smallest that does the job, with no radio unless the brief needs wireless. The old default was the ESP32-S3.
- **Pipeline.** With no MCU there's no pin map, Firmware agent or compile gate, and the job carries `noFirmware`. A plan with firmware but no MCU is refused. `server/board-api.ts` needed this, and it's outside my listed paths.
- **Firmware tab.** It says: "This board has no code: its parts do the whole job, so there's nothing to flash." The Firmware step row is gone, and a missing compile no longer counts as a warning.
- **Library.** Five new unreviewed blocks that snap together, from real LCSC parts: `usb-c-power-only`, `ldr-dark-detector`, `two-wire-probe`, `led-switch`, `buzzer-switch`. `scripts/generate-discrete-blocks.ts` writes them to new data files, so `seed.json` is untouched. A continuity tester can use the same probe and buzzer blocks, but I didn't build one. A 555 blinker has no block, so it relies on the Block Author, which is also unmeasured.
- **SPICE.** A divider can now state a resistance for a condition (a light sensor in the dark, water between wires) and pass through a series resistor. LED current can now include a closed transistor. A series resistor that feeds anything but inputs fails the check.

## A bug the renders caught

My first builds passed DRC with the USB-C socket facing into the board. On the water board, the screw terminal blocked it completely. Automatic placement has no rule for which way a USB socket faces, so the checks couldn't see it.

I fixed it for the new block: its socket faces up, and code puts it first, which lands it on the top edge. **The older `usb-c-sink` may have the same problem on an automatically placed board.** That's `eda/blocks/auto-placement.ts`, real_models' file, so I left it alone and haven't measured it on other boards.

## Limits

- **Real models:** whether one picks this route, how much it costs and how long it takes are all unmeasured. A night light used to go down the kit path, so a real run now costs more than that did: extra Verifier and Reviewer calls at least.
- **A live Reviewer** could stop on these boards. The USB connector's catalog PDF has no readable text, and its prompt says a connector's missing datasheet is no reason to stop, but I haven't seen one try with no IC on the board.
- **SPICE doesn't simulate the transistor.** It checks the voltage at the gate and the LED current with fixed profiles, so the switching itself is inferred from the datasheet's threshold.
- **The 200 kΩ water figure is my assumption,** not a measurement. It's labelled that way on the sheet.
- **Behaviour you might not assume:** the buzzer gives a steady tone while wet, not a beep. The night light comes on gradually around 1 to 3 lux, from my estimate of the sensor's response. The LED's light reaching the sensor could make it flicker, which nothing checks, so the sheet says to keep it off.
- **Thin sources:** the LED's polarity comes from the catalog's pad labels. I didn't read the datasheet's drawing. The 2N7002's 2.5 V maximum threshold comes from the catalog listing, because its datasheet text only showed the 1 V figure.
- **No case** on these boards: chip-level boards still skip it, so the summary says the case wasn't generated.
- **Smaller MCU choice is prompt-only.** Boards that need no radio will now tend to use `rp2040-minimal`, which has had less proof: the S3 spike built in 38 s, while an RP2040 plan took 191 s and needed its board size fixed first. The kit stays ESP32-only. With agents off, the rules still build the ESP32 lamp.
- **Editing a no-MCU board** is only partly covered: the code path handles it, but no replay ran it.

## Tests

- `tests/agent-no-mcu.test.ts`: 31 tests, all passing. Additions in `web/src/board/logic.test.ts` and `agentChat.test.ts`.
- Full `npm test`: 1258 tests, 1255 pass, 2 fail, 1 skipped. Neither failure looks like this work:
  - `generated design centres match actual circuit centres` fails on `BZ1`, including when run alone. `src/board/codegen.ts` was edited at 10:44 during the run, so I expect it's agent_core's compaction in progress. I didn't confirm that.
  - `real board job API: focus timer…` passes when run alone. An earlier full run failed a different integration test, which also passed alone. Both look load-related, but I didn't establish that.
- `tsc` is clean for both configs.
- No independent review of this code.
- `eda/blocks/auto-placement.ts` and `src/board/codegen.ts` changed at 10:41 and 10:44, after my builds, so the three jobs above ran on the earlier versions and weren't repeated.

## Proposal: smaller controllers for the kit (nothing built; owner decides)

The DevKitC is why kit boards start large. The other figures here need checking against drawings before any build.

| Controller | Size | Area | Against DevKitC | Radio | Pins | Flashing | LCSC stock |
|---|---|---|---|---|---|---|---|
| ESP32-DevKitC V4 (today) | 27.9 × 54.4 mm (our catalog) | 1518 mm² | 100% | Wi-Fi, Bluetooth | Most of the list in `roles.ts` | USB | Not checked |
| XIAO ESP32-C3 | 21 × 17.8 mm | 374 mm² | 25% | Wi-Fi, Bluetooth LE | 11 | USB-C | C18212168: 109 |
| RP2040-Zero | 23.5 × 18 mm | 423 mm² | 28% | None | 20 on the edge, 29 in all | USB-C | C5350143: 5 |
| ATtiny85, SOIC-8 | About 5.3 × 8 mm | About 42 mm² | 3% | None | 6, including reset | Needs a programmer | C31540447: 508 |

**Recommendation: add the XIAO ESP32-C3 as a second kit controller, and let the Designer use it whenever its 11 pins are enough.** It keeps wireless, and the reaction game needs only 7 pins. It still needs a kit module, a new pin list, its own firmware target, the fixed programs ported to it, and a case model. I haven't estimated that work.

The RP2040-Zero only saves money or power if wireless isn't needed, and stock is thin. I'd leave the ATtiny out of the kit: 6 pins is too few for the reaction game, and a programmer is a poor first step for a maker. It suits chip mode better, as a future block for very small logic jobs.

Sources: [Espressif DevKitC guide](https://docs.espressif.com/projects/esp-idf/en/v5.2.2/esp32/hw-reference/esp32/get-started-devkitc.html) (other sources give 48.2 mm for the length; 54.4 mm is what our catalog uses), [Seeed XIAO ESP32C3 wiki](https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/), [Waveshare RP2040-Zero](https://www.waveshare.com/rp2040-zero.htm) (pins; the size comes from a [third-party guide](https://zbotic.in/waveshare-rp2040-zero-tiny-but-powerful-board-guide/) and a catalog package name). The ATtiny size is from my memory of the package, not a drawing. Stock is from the catalog search on 6 Nov.

## State

My test server is stopped and port 5199 is free. Its jobs are in my scratch folder, not `var/`. Production wasn't restarted, and `dist/` wasn't built.

**Files outside my listed paths:** `server/board-api.ts`, `server/agent-api.ts`, `src/board/model.ts` (one field), `web/src/board/{types.ts,logic.ts,BoardStudio.tsx,panels.tsx}`, `web/src/studio/{FirmwareTab.tsx,facts.ts,agentChat.ts}`, `scripts/{generate-discrete-blocks,no-mcu-replay}.ts`.
