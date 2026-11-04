# eng_fw: firmware from the same design graph, compile-checked

Read first: ../BRIEF.md. Then:
- src/circuit/{model,catalog,templates}.ts. Note `design.behavior`; that is the firmware intent. Also see src/circuit/export.ts `behaviorForFirmware`.
- docs/strategy/02-architecture.md §firmware (pioarduino platform choice).

## Allowed write paths
- src/firmware/**
- tests/firmware*.test.ts
- scripts/firmware-*.ts
- package.json: scripts entries only. Coordinate with eng_core; append only.
- docs/engineering/2026-11-04-tscircuit/{evidence/eng_fw,reports/eng_fw.md}
- Toolchains under /home/sogo/.local/share/moki-tools/ (e.g. a Python venv with PlatformIO)

## Deliver
1. `src/firmware/index.ts` exports:
   - `generateFirmware(design: CircuitDesign, jobDir: string): Promise<{ files: string[], stage: {name:'firmware', status, ms, note?} }>`. It writes `firmware/` (platformio.ini, src/main.cpp, include/pins.h generated from the nets) and `firmware.zip` into jobDir.
   - `compileFirmware(jobDir): Promise<{name:'firmware-compile', status, ms, note?}>`. It writes firmware-build.json with tool versions, flash/RAM usage and the log tail. It returns status `skipped` with a reason if PlatformIO isn't installed.
2. **Real behavior per template.** No TODO stubs.
   - focus-timer: the OLED shows mm:ss; the encoder sets minutes; a press starts/pauses; the piezo chimes at the end.
   - light-lamp: the LDR is read through ADC; the LED is driven via PWM with hysteresis.
   - temp-monitor: the sensor variant the design chose (BME280 I2C or DS18B20 OneWire); the OLED readout; the buzzer alert threshold.
   - Pins come **only** from the design graph, never hard-coded. Libraries are pinned in platformio.ini `lib_deps` with exact versions.
3. **Install PlatformIO** into a venv under /home/sogo/.local/share/moki-tools/ and actually compile all 3 templates for the esp32dev board, using the pioarduino platform or the official espressif32 one (justify the choice).
   - Measure cold time (first toolchain download, reported separately) and warm compile ms.
   - Note: this VPS is linux-arm64 (aarch64). Check the toolchain supports it; if it doesn't, say so with evidence and leave compile as `skipped`, with the reason surfaced.
4. Tests:
   - pins.h matches the design nets for each template;
   - output is deterministic;
   - a pin change in the design changes pins.h.

## Acceptance
- 3/3 templates generate. The compile results are reported honestly, with logs in evidence/eng_fw/.
- No physical flash has happened. Say so.
- Report in reports/eng_fw.md.
