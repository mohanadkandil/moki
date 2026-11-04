# Moki firmware: light-lamp

Run `pio run -e esp32dev` in this directory. Flash only after checking your actual module pinouts with `pio run -e esp32dev -t upload`. Serial monitor: 115200 baud.

Generated pins come from the design nets. Behavior settings:
- Switch on below: 30% of the sensor range
- LED current: ≈ 8.7 mA (assumes 2.0 V forward voltage)

ADC is an uncalibrated percentage of its 12-bit range. Lamp switches on below the selected threshold and off 5 percentage points above it (capped at 100%). Calibrate for your LDR and room.

Platform: platformio/espressif32@6.10.0, Arduino ESP32 2.0.17. Selected for the official platform's Linux ARM64 Xtensa toolchain; newer Arduino APIs are not needed for this slice. Direct and transitive library dependencies are pinned.

Generation does not prove compilation. See the adjacent firmware-build.json for the actual compile result. No hardware has been flashed or physically verified.
