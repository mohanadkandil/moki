# Moki firmware: temp-monitor

Run `pio run -e esp32dev` in this directory. Flash only after checking your actual module pinouts with `pio run -e esp32dev -t upload`. Serial monitor: 115200 baud.

Generated pins come from the design nets. Behavior settings:
- Sensor: BME280 over I²C
- Alert above: 28 °C, with a chime

If a buzzer is selected without an explicit alert threshold, the alert defaults to above 28 C. Temperature alerts clear with 0.5 C hysteresis; a sensor error suppresses the chime.

Platform: platformio/espressif32@6.10.0, Arduino ESP32 2.0.17. Selected for the official platform's Linux ARM64 Xtensa toolchain; newer Arduino APIs are not needed for this slice. Direct and transitive library dependencies are pinned.

Generation does not prove compilation. See the adjacent firmware-build.json for the actual compile result. No hardware has been flashed or physically verified.
