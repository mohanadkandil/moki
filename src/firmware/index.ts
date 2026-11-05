import { runWorker } from '../board/process.js';
import { access, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MODULE, pinDef } from '../circuit/catalog.js';
import type { CircuitDesign, PartInstance } from '../circuit/model.js';
import { checkDesign } from '../circuit/validate.js';
import { CHIME, DISPLAY, SILENT, lampProgram, temperatureProgram, timerProgram } from './programs.js';
import { appProject } from '../agents/firmware-project.js';
import { projectZip } from './zip.js';

export type FirmwareStage = { name: 'firmware' | 'firmware-compile'; status: 'done' | 'failed' | 'skipped'; ms: number; note?: string };
export const FIRMWARE_PLATFORM = 'platformio/espressif32@6.10.0';
const TOOL_ROOT = '/home/sogo/.local/share/moki-tools';
const VENV_PIO = `${TOOL_ROOT}/platformio-venv/bin/pio`;
const roundedMs = (start: number) => Math.round(performance.now() - start);

/** Resolve pins from catalog endpoints and net connectivity, never template GPIO defaults. */
export function firmwareProject(design: CircuitDesign): Record<string, string> {
  const issues = checkDesign(design);
  if (issues.length) throw new Error(`Invalid firmware graph: ${issues.map(i => i.message).join('; ')}`);
  // appProject checks the source again, so this path can't be used to get round the Firmware agent's rules.
  if (design.app) return appProject(design, design.app.source, FIRMWARE_PLATFORM);
  const byModule = (module: string, required = false): PartInstance | undefined => {
    const matches = design.parts.filter(p => p.module === module);
    if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`Firmware needs exactly one ${module}`);
    return matches[0];
  };
  const mcu = byModule(MODULE.esp32, true)!;
  const pins: Record<string, number> = {};
  const pinAt = (name: string, part: PartInstance, pin: string) => {
    const net = design.nets.find(n => n.endpoints.some(e => e.part === part.id && e.pin === pin));
    const gpio = net?.endpoints.filter(e => e.part === mcu.id).map(e => pinDef(mcu.module, e.pin)?.gpio?.gpio).filter((n): n is number => n !== undefined);
    if (gpio?.length !== 1) throw new Error(`No unique controller GPIO for ${part.id}.${pin}`);
    pins[name] = gpio[0]!;
  };
  const oled = byModule(MODULE.oled), buzzer = byModule(MODULE.piezo);
  const bme = byModule(MODULE.bme280), probe = byModule(MODULE.ds18b20);
  const bus = oled ?? bme;
  if (bus) {
    pinAt('I2C_SDA', bus, 'SDA'); pinAt('I2C_SCL', bus, 'SCL');
    // Every I2C device must share this bus; silently ignoring a second bus is unsafe.
    if (oled && bme) for (const signal of ['SDA', 'SCL']) {
      pinAt(`I2C_${signal}`, bme, signal);
      const bmePin = pins[`I2C_${signal}`];
      pinAt(`I2C_${signal}`, oled, signal);
      if (bmePin !== pins[`I2C_${signal}`]) throw new Error('OLED and BME280 must share an I2C bus');
    }
  }
  if (buzzer) pinAt('BUZZER', buzzer, '+');
  const libs: string[] = [];
  if (oled) libs.push('adafruit/Adafruit SSD1306@2.5.13', 'adafruit/Adafruit GFX Library@1.11.11');
  let program: string;
  if (design.template === 'focus-timer') {
    if (!oled) throw new Error('Focus timer requires OLED');
    const encoder = byModule(MODULE.encoder, true)!;
    pinAt('ENCODER_A', encoder, 'CLK'); pinAt('ENCODER_B', encoder, 'DT'); pinAt('ENCODER_SW', encoder, 'SW');
    program = timerProgram(behaviorNumber(design, 'Session length', 25, 1, 180));
  } else if (design.template === 'light-lamp') {
    const ldr = byModule(MODULE.ldr, true)!;
    pinAt('LIGHT_SENSE', ldr, '2');
    const led = byModule(MODULE.led, true)!;
    // LED current limiter lies between the anode and the controller output.
    const ledNet = design.nets.find(n => n.endpoints.some(e => e.part === led.id && e.pin === 'A'));
    const resistorEnd = ledNet?.endpoints.find(e => design.parts.some(p => p.id === e.part && p.module === MODULE.resistor));
    const resistor = design.parts.find(p => p.id === resistorEnd?.part);
    if (!resistor || !resistorEnd || !['1', '2'].includes(resistorEnd.pin)) throw new Error('LED needs a series resistor');
    pinAt('LED', resistor, resistorEnd.pin === '1' ? '2' : '1');
    program = lampProgram(behaviorNumber(design, 'Switch on below', 30, 0, 100));
  } else {
    if (!!bme === !!probe) throw new Error('Temperature monitor needs exactly one BME280 or DS18B20');
    if (bme) libs.push('adafruit/Adafruit BME280 Library@2.2.4', 'adafruit/Adafruit Unified Sensor@1.1.15');
    if (probe) {
      pinAt('ONEWIRE', probe, 'DQ');
      libs.push('paulstoffregen/OneWire@2.3.8', 'milesburton/DallasTemperature@3.11.0');
    }
    const below = design.behavior.some(b => b.label === 'Alert below');
    const thresholdLabel = below ? 'Alert below' : 'Alert above';
    program = temperatureProgram(bme ? 'bme280' : 'ds18b20', !!oled,
      behaviorNumber(design, thresholdLabel, 28, -55, 125), below,
      !!buzzer || design.behavior.some(b => b.label === thresholdLabel));
  }
  if (oled || bme) libs.push('adafruit/Adafruit BusIO@1.17.0');
  return {
    'platformio.ini': `[platformio]\ndefault_envs = esp32dev\n\n[env:esp32dev]\nplatform = ${FIRMWARE_PLATFORM}\nboard = esp32dev\nframework = arduino\nmonitor_speed = 115200\nlib_deps =\n${libs.sort().map(lib => `  ${lib}`).join('\n')}\n`,
    'include/pins.h': `#pragma once\n// Generated solely from the CircuitDesign nets and catalog GPIO metadata.\n${Object.keys(pins).sort().map(name => `constexpr int PIN_${name} = ${pins[name]};`).join('\n')}\n`,
    'src/main.cpp': `// Deterministic Moki ${design.template} firmware. USB power, 3.3 V logic.\n#include <Arduino.h>\n#include <math.h>\n#include "pins.h"\n${!oled && bme ? '#include <Wire.h>\n' : ''}${oled ? DISPLAY : ''}${buzzer ? CHIME : SILENT}${program}`,
    'README.md': `# Moki firmware: ${design.template}\n\nRun \`pio run -e esp32dev\` in this directory. Flash only after checking your actual module pinouts with \`pio run -e esp32dev -t upload\`. Serial monitor: 115200 baud.\n\nGenerated pins come from the design nets. Behavior settings:\n${design.behavior.map(b => `- ${b.label}: ${b.value}`).join('\n')}\n\n${design.template === 'temp-monitor' ? 'If a buzzer is selected without an explicit alert threshold, the alert defaults to above 28 C. Temperature alerts clear with 0.5 C hysteresis; a sensor error suppresses the chime.\n' : ''}${design.template === 'light-lamp' ? 'ADC is an uncalibrated percentage of its 12-bit range. Lamp switches on below the selected threshold and off 5 percentage points above it (capped at 100%). Calibrate for your LDR and room.\n' : ''}\nPlatform: ${FIRMWARE_PLATFORM}, Arduino ESP32 2.0.17. Selected for the official platform\'s Linux ARM64 Xtensa toolchain; newer Arduino APIs are not needed for this slice. Direct and transitive library dependencies are pinned.\n\nGeneration does not prove compilation. See the adjacent firmware-build.json for the actual compile result. No hardware has been flashed or physically verified.\n`,
  };
}

function behaviorNumber(design: CircuitDesign, label: string, fallback: number, min: number, max: number): number {
  const matches = design.behavior.filter(b => b.label === label);
  if (matches.length === 0) return fallback;
  const number = matches.length === 1 ? /^\s*(-?\d+(?:\.\d+)?)\s*(?:min|%|°C)/.exec(matches[0]!.value)?.[1] : undefined;
  const parsed = number === undefined ? NaN : Number(number);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid firmware behavior: ${label}`);
  return parsed;
}

export async function generateFirmware(design: CircuitDesign, jobDir: string): Promise<{ files: string[]; stage: FirmwareStage }> {
  const start = performance.now();
  const project = firmwareProject(design);
  for (const [name, content] of Object.entries(project)) {
    const file = join(jobDir, 'firmware', name);
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, content);
  }
  await writeFile(join(jobDir, 'firmware.zip'), projectZip(project));
  return { files: [...Object.keys(project).sort().map(name => `firmware/${name}`), 'firmware.zip'], stage: { name: 'firmware', status: 'done', ms: roundedMs(start), note: 'PlatformIO project generated; compilation is reported separately.' } };
}

async function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; log: string; timedOut: boolean }> {
  try {
    const result = await runWorker(command, args, cwd, timeoutMs, {
      PLATFORMIO_CORE_DIR: process.env.PLATFORMIO_CORE_DIR ?? `${TOOL_ROOT}/platformio-core`,
      PLATFORMIO_SETTING_ENABLE_TELEMETRY: 'No', NO_COLOR: '1',
    });
    return { code: result.code, log: result.stdout + result.stderr, timedOut: false };
  } catch (error) {
    if (error instanceof Error && /Worker timed out/.test(error.message)) return { code: null, log: error.message, timedOut: true };
    throw error;
  }
}

/** Optional overrides make cold provisioning and failure-path tests reproducible. No shell executes. */
export async function compileFirmware(jobDir: string, options: { platformioPath?: string; timeoutMs?: number } = {}): Promise<FirmwareStage> {
  const start = performance.now();
  let status: FirmwareStage['status'] = 'skipped', note = '', log = '', version = 'unavailable';
  let exitCode: number | null = null;
  let environment = 'esp32dev';
  const command = options.platformioPath ?? process.env.MOKI_PLATFORMIO ?? await access(VENV_PIO, constants.X_OK).then(() => VENV_PIO, () => 'pio');
  try {
    const probe = await run(command, ['--version'], resolve(jobDir), 10000);
    if (probe.code !== 0) throw new Error(`PlatformIO version probe failed: ${probe.log}`);
    version = probe.log.trim();
    // The MCU decides the build environment, and the project already says which one it is.
    const ini = await readFile(join(jobDir, 'firmware', 'platformio.ini'), 'utf8');
    environment = /^default_envs\s*=\s*([A-Za-z0-9_-]+)\s*$/m.exec(ini)?.[1] ?? environment;
    const result = await run(command, ['run', '-e', environment, '-j', '2'], resolve(jobDir, 'firmware'), options.timeoutMs ?? 120000);
    log = result.log; exitCode = result.code;
    const unsupported = /(?:UnknownPackageError|not available|not supported|Could not find).*(?:linux_aarch64|aarch64|arm64)|(?:linux_aarch64|aarch64|arm64).*(?:not supported|not available)/is.test(log);
    status = result.code === 0 && !result.timedOut ? 'done' : unsupported ? 'skipped' : 'failed';
    note = result.timedOut ? 'PlatformIO compile timed out; process group killed.' : status === 'done' ? `Compile checked for ${environment}; no physical flash.` : unsupported ? 'PlatformIO toolchain does not support this Linux ARM64 host; not compiled.' : `PlatformIO compile failed (exit ${result.code}); see logTail.`;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT' && version === 'unavailable';
    status = missing ? 'skipped' : 'failed';
    note = missing ? 'PlatformIO is not installed; firmware generated but not compiled.' : `PlatformIO unavailable or project invalid: ${String(error)}`;
    log = String(error);
  }
  const usage = (label: string) => {
    const match = new RegExp(`${label}:\\s*\\[[^\\]]*\\]\\s*([\\d.]+)%.*?used (\\d+) bytes from (\\d+) bytes`).exec(log);
    return match ? { percent: Number(match[1]), usedBytes: Number(match[2]), totalBytes: Number(match[3]) } : null;
  };
  const packages = Object.fromEntries([...log.matchAll(/^(?:\s+- |\|-- )([\w -]+) @ ([^\r\n]+)/gm)].map(m => [m[1]!.trim(), m[2]!.trim()]));
  const stage: FirmwareStage = { name: 'firmware-compile', status, ms: roundedMs(start), note };
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, 'firmware-build.json'), JSON.stringify({ ...stage, compiled: status === 'done', board: environment, platform: FIRMWARE_PLATFORM, host: `${process.platform}-${process.arch}`, toolVersions: { platformio: version, ...packages }, flash: usage('Flash'), ram: usage('RAM'), exitCode, logTail: log.split('\n').slice(-80).join('\n'), physicalFlash: false }, null, 2) + '\n');
  await writeFile(join(jobDir, 'firmware-compile.log'), log);
  await rm(join(jobDir, 'firmware', '.pio'), { recursive: true, force: true });
  return stage;
}
