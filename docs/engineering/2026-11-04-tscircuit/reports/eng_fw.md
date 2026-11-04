# eng_fw — firmware delivered, 4 November 2026

## Result

All three template families generate deterministic PlatformIO projects from the same CircuitDesign graph. All three compile successfully for esp32dev on this Linux ARM64 VPS; both DS18B20 and BME280 temperature variants were built (four projects total). No physical flash or hardware test has happened.

`src/firmware/index.ts` exports `generateFirmware(design, jobDir)` and `compileFirmware(jobDir)`. Generation writes firmware/platformio.ini, firmware/src/main.cpp, firmware/include/pins.h, firmware/README.md and firmware.zip. Compile writes firmware-build.json and firmware-compile.log. The receipt distinguishes done/failed/skipped, includes actual PlatformIO/framework/toolchain/library versions, flash/RAM bytes, exit code, measured milliseconds, log tail and physicalFlash:false. Missing PlatformIO or unsupported host tooling produces an explicit skipped receipt; compilation errors/timeouts produce failed receipts. Timeout kills the subprocess group. Default compile timeout is 120s; evidence provisioning allows 600s.

GPIOs are resolved from peripheral endpoints through nets to the catalog controller GPIO metadata. LED output follows its series resistor to the controller, rather than assuming net names or part IDs. No template GPIO numbers appear in driver source. Invalid graph connections, absent required devices, incompatible I2C buses and malformed settings fail generation. Library dependencies are exact versions, including shared Adafruit dependencies.

## Behavior implemented

- Focus timer: OLED mm:ss, quadrature encoder adjusts whole minutes (1–180) while paused, debounced press starts/pauses, restart after completion, nonblocking three-note piezo chime. Initial minutes follow design.behavior.
- Light lamp: 12-bit ADC samples the actual LDR divider pin, smooths samples, switches below the requested percentage, clears five percentage points above (capped at 100%), and drives LED PWM according to darkness. The range is uncalibrated and documented.
- Temperature monitor: selects the actual graph sensor; asynchronous DS18B20 conversions or BME280 at 0x76/0x77, OLED readout when present and serial fallback. Alert direction/threshold follow behavior; alert clears with 0.5 C hysteresis. Buzzer repeats the chime every ten seconds during an alert. Invalid/disconnected readings suppress the chime and show an error. A selected buzzer without an explicit threshold defaults to above 28 C, documented in generated README. Display and buzzer omissions are supported.

## Measured acceptance

One sequential measurement per project, not a p50/p95 benchmark. Generation includes directory/file writes and ZIP construction. Warm means deleting .pio/build and compiling all translation units again while retaining downloaded tools and installed project libraries; two compiler workers. First timer build includes initial platform/framework/toolchain/library downloads. Subsequent first builds reuse downloaded tools and may install new libraries. No download-only timing is inferred from the difference.

| Project | Generate ms | First build ms | Warm clean build ms | Flash bytes | RAM bytes |
|---|---:|---:|---:|---:|---:|
| focus-timer | 14 | 55,295 (cold, downloads included) | 15,487 | 305,961 | 22,096 |
| light-lamp | 7 | 11,336 | 11,457 | 281,513 | 21,760 |
| temp-monitor / DS18B20 | 14 | 21,634 | 16,219 | 311,001 | 22,136 |
| temp-monitor / BME280 | 6 | 23,788 | 17,310 | 313,437 | 22,168 |

Flash capacity 1,310,720 bytes; RAM capacity 327,680 bytes. An additional incremental build verified version/usage receipt parsing in 2,565–3,906ms; those are not the clean-build numbers. First/warm receipts and logs are preserved separately.

Toolchain: PlatformIO Core 6.1.19 installed in `/home/sogo/.local/share/moki-tools/platformio-venv`; core package store `/home/sogo/.local/share/moki-tools/platformio-core`. Official `platformio/espressif32@6.10.0`, framework `3.20017.241212+sha.dcc1105b` (Arduino 2.0.17), Xtensa `8.4.0+2021r2-patch5`, esptool `1.40501.0 (4.5.1)`. The official pinned platform was chosen instead of the architecture's pioarduino preference because this bounded esp32dev slice needs the established core2 LEDC API and its ARM64 compiler is available and verified. The task explicitly permits this choice. No claim that pioarduino lacks ARM64 support was made. Sources: [official 6.10.0 release](https://github.com/platformio/platform-espressif32/releases/tag/v6.10.0), [esp32dev board configuration](https://docs.platformio.org/en/stable/boards/espressif32/esp32dev.html).

Ten firmware tests pass, covering graph pin sets, GPIO and I2C remaps, deterministic source and ZIP bytes, settings/sensor selection, invalid inputs, absent compiler, unsupported host, failed compilation, timeout, version parsing and memory accounting. Four host executions of the generated C++ state machines pass using GCC with mocked GPIO, ADC, sensor, time, display and LEDC. These verify timer adjustment/pause/completion/chime, hysteresis in both lamp directions, sensor readouts, alert persistence/clearance and sensor error handling; they are not hardware simulation or verification. Python zipfile independently validates archive CRCs and contents for all four projects.

Root/web TypeScript checking passed with `npm run typecheck`. The final `npm test` run passed 46/46 tests (39,377ms), including the real board-job API render/route/artifact/cache integration test and all ten firmware tests. Logs are typecheck.log, full-tests.log and tests.log in evidence/eng_fw.

## Reproduce

From repository root:

```sh
npx tsx --test tests/firmware.test.ts
npx tsx scripts/firmware-behavior.ts
npx tsx scripts/firmware-check.ts
npm run typecheck
npm test
```

`firmware-check.ts` accepts an optional output directory. It generates four designs, compiles sequentially, deletes each build output and performs a clean rebuild. Re-running now uses the installed toolchain, so it will not reproduce the initial cold download timing. `MOKI_PLATFORMIO` overrides the compiler executable; `PLATFORMIO_CORE_DIR` overrides package storage. Receipts/logs/source/archives and compile-summary.json live in `docs/engineering/2026-11-04-tscircuit/evidence/eng_fw/`. Generated .pio caches were removed from evidence after collecting receipts; downloads remain in the allowed tool directory.

## Known gaps and integration

No board was flashed, no physical knob/sensor/display/piezo was exercised, and ADC thresholds/OLED variant pinouts still need checking on purchased modules. Sensor availability is detected at startup; a missing-at-boot sensor requires a restart after fixing the wiring. No web flashing or firmware binary artifact is added; firmware.zip is the requested editable source project. ESP32-S3/GC9A01 is out of scope and remains next. Team-level p50/p95 EDA benchmarking is eng_core's work, not this single-sample compile exercise.

The existing core firmware worker already invokes both exports and can surface the compile receipt. Requests to eng_core and coordinator record the contract, actual results and independent review request. Independent review is not claimed by this implementation report. Coordinator owns PROJECT.md/.sogo updates. This pane has no HERDR_ENV, so no Herdr controls were attempted; no subagents were spawned. All commands started for firmware acceptance have completed; no persistent background worker was started.

## Files touched

- src/firmware/index.ts, programs.ts, zip.ts.
- tests/firmware.test.ts.
- scripts/firmware-check.ts, scripts/firmware-behavior.ts.
- docs/engineering/2026-11-04-tscircuit/evidence/eng_fw/** (generated projects, archives, receipts, logs, host-check sources/results, ZIP validation, receipt-verification script).
- docs/engineering/2026-11-04-tscircuit/requests/eng_fw-to-eng_core.md and eng_fw-to-coordinator.md.
- This report.
- PlatformIO venv, bootstrap and downloads under /home/sogo/.local/share/moki-tools/.

No package.json edit, git commit/push/stash/reset, publication or outreach.
