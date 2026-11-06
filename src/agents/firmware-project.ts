// A custom firmware project for a design: pins from its nets, libraries from its parts, source from the
// Firmware agent. Code writes platformio.ini and pins.h, so a model can only ever change the application.
import { MODULE, moduleDef, pinDef } from '../circuit/catalog.js';
import type { CircuitDesign } from '../circuit/model.js';
import type { PinMap } from '../blocks/contract.js';

export const MAX_APP_CHARS = 30_000;

export interface AppPin { name: string; gpio: number | string; part: string; pin: string; role: string; input?: boolean; output?: boolean; adc?: boolean; internalPullup?: boolean }
export interface AppTarget { family: string; framework: string; pins: AppPin[]; libs: string[]; headers: string[]; usage: string[] }

const BASE_HEADERS = ['Arduino.h', 'math.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'string.h', 'pins.h'];
const BUS = 'adafruit/Adafruit BusIO@1.17.0';

/** Library versions match the fixed programs, so both kinds of firmware build against the same code. */
const SUPPORT: Record<string, { libs: string[]; headers: string[]; usage: string }> = {
  [MODULE.oled]: { libs: ['adafruit/Adafruit SSD1306@2.5.13', 'adafruit/Adafruit GFX Library@1.11.11', BUS], headers: ['Wire.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h'],
    usage: 'Screen: Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL); Adafruit_SSD1306 display(128, 64, &Wire, -1); display.begin(SSD1306_SWITCHCAPVCC, 0x3C). Handle a false return by carrying on over Serial. Call display.display() to show a frame.' },
  [MODULE.bme280]: { libs: ['adafruit/Adafruit BME280 Library@2.2.4', 'adafruit/Adafruit Unified Sensor@1.1.15', BUS], headers: ['Wire.h', 'Adafruit_Sensor.h', 'Adafruit_BME280.h'],
    usage: 'Air sensor: Adafruit_BME280 bme; bme.begin(0x76, &Wire), then try 0x77. readTemperature() in °C, readHumidity() in %, readPressure() in Pa. A reading can be NaN: show that it failed.' },
  [MODULE.ds18b20]: { libs: ['paulstoffregen/OneWire@2.3.8', 'milesburton/DallasTemperature@3.11.0'], headers: ['OneWire.h', 'DallasTemperature.h'],
    usage: 'Probe: OneWire wire(pin); DallasTemperature sensors(&wire); sensors.begin(); requestTemperatures() then getTempCByIndex(0). DEVICE_DISCONNECTED_C means it failed.' },
  [MODULE.encoder]: { libs: [], headers: [], usage: 'Knob: pinMode INPUT_PULLUP on CLK, DT and SW. Decode CLK and DT as quadrature. SW reads LOW when pressed: debounce it for about 30 ms.' },
  [MODULE.piezo]: { libs: [], headers: [], usage: 'Passive piezo, Arduino-ESP32 core 2.x: ledcSetup(3, 2000, 8); ledcAttachPin(pin, 3); ledcWriteTone(3, hz) to sound and ledcWriteTone(3, 0) for silence. tone() does not exist on this core.' },
  [MODULE.led]: { libs: [], headers: [], usage: 'LED: pinMode OUTPUT on the pin named for it, HIGH is on. It has its own series resistor.' },
  [MODULE.ldr]: { libs: [], headers: [], usage: 'Light sensor: analogRead on the LDR pin, 0 to 4095. Check which way the divider runs from the design before deciding what high means.' },
};

const safeName = (text: string) => text.replace(/\+/g, 'POS').replace(/[-−]/g, 'NEG').replace(/[^A-Za-z0-9]/g, '_').toUpperCase();

/** Every controller pin the design wires, named after what it reaches. Never assumes a template. */
export function appTarget(design: CircuitDesign): AppTarget {
  const mcus = design.parts.filter(p => moduleDef(p.module).category === 'controller');
  if (mcus.length !== 1) throw new Error('Custom firmware needs exactly one controller.');
  const mcu = mcus[0]!;
  const pins = new Map<string, AppPin>();
  const add = (name: string, gpio: number, part: string, pin: string, role: string, caps: { input: boolean; output: boolean; adc1: boolean; pullup: boolean }) => {
    const seen = pins.get(name);
    if (seen && seen.gpio !== gpio) throw new Error(`${name} would mean two controller pins (GPIO ${seen.gpio} and ${gpio}). Custom firmware needs one I2C bus.`);
    pins.set(name, { name, gpio, part, pin, role, input: caps.input, output: caps.output, adc: caps.adc1, internalPullup: caps.pullup });
  };
  for (const net of design.nets) {
    if (net.kind !== 'signal') continue;
    const controller = net.endpoints.filter(e => e.part === mcu.id).map(e => pinDef(mcu.module, e.pin)?.gpio).filter(g => g !== undefined);
    if (controller.length !== 1) continue;
    const caps = controller[0]!;
    for (const end of net.endpoints) {
      if (end.part === mcu.id) continue;
      const part = design.parts.find(p => p.id === end.part);
      if (!part) continue;
      add(`PIN_${safeName(part.id)}_${safeName(end.pin)}`, caps.gpio, part.id, end.pin, part.role, caps);
      if (end.pin === 'SDA' || end.pin === 'SCL') add(`PIN_I2C_${end.pin}`, caps.gpio, part.id, end.pin, 'I2C bus', caps);
      // An LED's limiter sits between it and the controller. The firmware cares about the LED, not the resistor.
      if (part.module === MODULE.resistor) {
        const other = end.pin === '1' ? '2' : '1';
        const beyond = design.nets.find(n => n.endpoints.some(e => e.part === part.id && e.pin === other));
        if (beyond?.kind === 'signal') for (const far of beyond.endpoints) {
          const farPart = design.parts.find(p => p.id === far.part);
          if (farPart && far.part !== part.id && far.part !== mcu.id) add(`PIN_${safeName(farPart.id)}_${safeName(far.pin)}`, caps.gpio, farPart.id, far.pin, farPart.role, caps);
        }
      }
    }
  }
  const support = design.parts.flatMap(p => SUPPORT[p.module] ? [SUPPORT[p.module]!] : []);
  return {
    family: 'esp32', framework: 'arduino (Arduino-ESP32 core 2.x)',
    pins: [...pins.values()].sort((a, b) => a.name.localeCompare(b.name)),
    libs: [...new Set(support.flatMap(s => s.libs))].sort(),
    headers: [...new Set([...BASE_HEADERS, ...support.flatMap(s => s.headers)])],
    usage: [...new Set(support.map(s => s.usage))],
  };
}

/**
 * Only literal includes from the allowlist, and nothing that can reach a file or the assembler. This is the
 * second defence: the sandbox is the boundary, and this only makes misuse fail early and plainly. It reads the
 * code the way the preprocessor does, so a comment or a line continuation can't hide a directive.
 */
export function checkAppSource(source: unknown, headers: readonly string[]): string[] {
  if (typeof source !== 'string' || !source.trim()) return ['Send the whole of src/main.cpp as text.'];
  if (source.length > MAX_APP_CHARS) return [`Firmware is limited to ${MAX_APP_CHARS} characters.`];
  if (/\?\?[=/'()!<>-]/.test(source)) return ['Trigraphs are not allowed.'];
  // GCC splices a backslash and newline even with spaces between them.
  const joined = source.replace(/\\[ \t\f\v]*\r?\n/g, '');
  if (/(?:\b|(?<=[^A-Za-z0-9_]))(?:u8|u|U|L)?R"/.test(joined)) return ['Raw string literals are not allowed. Use ordinary strings.'];
  let code = '', text = '';
  for (let i = 0; i < joined.length;) {
    const c = joined[i]!, next = joined[i + 1];
    if (c === '/' && next === '/') { while (i < joined.length && joined[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { const end = joined.indexOf('*/', i + 2); if (end < 0) return ['A comment is never closed.']; code += ' '; text += ' '; i = end + 2; continue; }
    // A quote straight after a digit or letter is a digit separator, like 1'000, and starts no literal.
    if (c === "'" && /[A-Za-z0-9_]/.test(joined[i - 1] ?? '')) { code += ' '; text += ' '; i++; continue; }
    if (c === '"' || c === "'") {
      const start = i;
      for (i++; i < joined.length && joined[i] !== c && joined[i] !== '\n'; i++) if (joined[i] === '\\') i++;
      code += c === '"' ? '""' : "''"; text += joined.slice(start, i + 1); i++;
      continue;
    }
    code += c; text += c; i++;
  }
  const issues: string[] = [];
  if (/%:/.test(code)) issues.push('Digraph directives are not allowed.');
  if (/##/.test(code)) issues.push('Token pasting (##) is not allowed.');
  for (const line of text.split('\n')) {
    const directive = /^\s*#\s*([A-Za-z_]*)\s*(.*)$/.exec(line);
    if (!directive) continue;
    const [, name, rest] = directive;
    if (name === 'include') {
      const header = /^(?:<([A-Za-z0-9_./]+)>|"([A-Za-z0-9_./]+)")\s*$/.exec(rest!);
      const file = header?.[1] ?? header?.[2];
      if (!file || file.startsWith('/') || file.includes('..')) issues.push(`Includes must be a plain file name: #include ${rest!.slice(0, 60)}`);
      else if (!headers.includes(file)) issues.push(`${file} isn't available for this design. You can include: ${headers.join(', ')}.`);
    } else if (name === 'pragma') { if (rest!.trim() !== 'once') issues.push('#pragma is not allowed.'); }
    else if (!['define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif'].includes(name!)) issues.push(`#${name} is not allowed.`);
  }
  for (const [pattern, what] of [[/\b(?:__)?asm(?:__)?\b/, 'Inline assembly'], [/\b_Pragma\b/, '_Pragma'], [/\b__has_include(?:_next)?\b/, '__has_include'], [/\b__FILE__\b|\b__BASE_FILE__\b/, 'File name macros'], [/\b__attribute__\s*\(\(\s*section\b/, 'Section attributes']] as const) {
    if (pattern.test(code)) issues.push(`${what} is not allowed.`);
  }
  if (/\.incbin|\.include/.test(text)) issues.push('.incbin and .include are not allowed.');
  return issues;
}

/**
 * PlatformIO runs a package's install scripts outside the sandbox, so what it may fetch is decided here and by a
 * person. A block written by an agent can name these and nothing else. Add to them by reviewing the package.
 */
export const ALLOWED_PLATFORMS: readonly string[] = ['platformio/espressif32@6.10.0', 'platformio/raspberrypi@1.20.0'];
export const ALLOWED_LIBRARIES: readonly string[] = [...new Set(Object.values(SUPPORT).flatMap(s => s.libs))];

/**
 * Tool overrides belong to a platform, chosen here. The RP2040 platform's own toolchain has no aarch64 build for this
 * server, and this exact one compiles and links its Arduino core (measured 6 Nov 2026, evidence in chip-live/reports).
 */
const PLATFORM_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  'platformio/raspberrypi@1.20.0': ['platformio/toolchain-gccarmnoneeabi@1.100301.220327'],
};
/** Headers that ship inside a core, so nothing extra is installed. The sandbox is still the boundary. */
const FAMILY_HEADERS: Readonly<Record<string, readonly string[]>> = {
  esp32: ['Wire.h', 'SPI.h', 'Preferences.h'],
  esp32s3: ['Wire.h', 'SPI.h', 'Preferences.h'],
  rp2040: ['Wire.h', 'SPI.h'],
};
/** What the Firmware agent has to know about a core, so it doesn't write for another one. */
const FAMILY_USAGE: Readonly<Record<string, string>> = {
  rp2040: 'RP2040, Arduino mbed core: Serial is native USB. analogWrite(pin, 0-255) drives PWM, and analogRead(pin) returns 0-1023 on GP26-GP29. Wire.begin() takes no pins here: use the default I2C pins the pin map names.',
};

/** Compiler flags belong to a board, chosen here. Neither a block nor a model can set one. */
const BOARD_FLAGS: Readonly<Record<string, readonly string[]>> = {
  // This module's USB is native, with no bridge chip. Without these, Serial goes to a UART nothing is wired to, and it still compiles.
  'esp32-s3-devkitc-1': ['-DARDUINO_USB_MODE=1', '-DARDUINO_USB_CDC_ON_BOOT=1'],
};

const SAFE_INI = /^[A-Za-z0-9_.@/ -]+$/;
const SAFE_PIN = /^[A-Za-z_]?[A-Za-z0-9_]*$/;
const SAFE_HEADER = /^[A-Za-z0-9_]+(?:[./][A-Za-z0-9_]+)*$/;

/** A chip-level target. Blocks can be written by agents, so their strings are checked before they reach a project file. */
export function chipTarget(map: PinMap): AppTarget {
  for (const value of [map.pio.platform, map.pio.board, map.pio.framework, ...map.libs]) if (!SAFE_INI.test(value)) throw new Error(`Unsafe firmware setting in a block: ${value.slice(0, 60)}`);
  if (!ALLOWED_PLATFORMS.includes(map.pio.platform)) throw new Error(`No one has approved the firmware platform ${map.pio.platform.slice(0, 60)} yet.`);
  for (const lib of map.libs) if (!ALLOWED_LIBRARIES.includes(lib)) throw new Error(`No one has approved the firmware library ${lib.slice(0, 60)} yet. Use the libraries the catalog lists.`);
  for (const header of map.includes) if (!SAFE_HEADER.test(header)) throw new Error(`Unsafe header in a block: ${header.slice(0, 60)}`);
  for (const pin of Object.values(map.pins)) if (!SAFE_PIN.test(String(pin.gpio))) throw new Error(`Unsafe pin id in a block: ${String(pin.gpio).slice(0, 30)}`);
  return {
    family: map.family, framework: map.pio.framework,
    pins: Object.entries(map.pins).map(([name, pin]) => ({ name, gpio: pin.gpio, part: pin.port.split('.')[0] ?? '', pin: pin.port, role: pin.port })).sort((a, b) => a.name.localeCompare(b.name)),
    libs: [...map.libs].sort(),
    headers: [...new Set([...BASE_HEADERS, ...(FAMILY_HEADERS[map.family] ?? []), ...map.includes])],
    usage: [...(FAMILY_USAGE[map.family] ? [FAMILY_USAGE[map.family]!] : []), ...map.usage.map(u => `${u.block}: ${u.note}`)],
  };
}

export function chipProject(title: string, map: PinMap, source: string): Record<string, string> {
  const target = chipTarget(map);
  const issues = checkAppSource(source, target.headers);
  if (issues.length) throw new Error(`Firmware source refused: ${issues.join(' ')}`);
  const env = (map.pio.environment ?? map.pio.board).replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    'platformio.ini': `[platformio]\ndefault_envs = ${env}\n\n[env:${env}]\nplatform = ${map.pio.platform}\nboard = ${map.pio.board}\nframework = ${map.pio.framework}\nmonitor_speed = 115200\n${PLATFORM_PACKAGES[map.pio.platform]?.length ? `platform_packages =\n${PLATFORM_PACKAGES[map.pio.platform]!.map(p => `  ${p}`).join('\n')}\n` : ''}${BOARD_FLAGS[map.pio.board]?.length ? `build_flags =\n${BOARD_FLAGS[map.pio.board]!.map(f => `  ${f}`).join('\n')}\n` : ''}lib_deps =\n${target.libs.map(l => `  ${l}`).join('\n')}\n`,
    'include/pins.h': `#pragma once\n// Generated from the board plan. The application uses these names and never a pin number.\n${target.pins.map(p => `constexpr int ${p.name} = ${p.gpio};`).join('\n')}\n`,
    'src/main.cpp': source,
    'README.md': `# Moki firmware: ${title.replace(/[\r\n]/g, ' ').slice(0, 80)}\n\nThis application was written by an AI model for this board and has only been compiled. It has not run on anything. Read it before you flash it.\n`,
  };
}

/** The whole project. Only src/main.cpp holds model-written text. */
export function appProject(design: CircuitDesign, source: string, platform: string): Record<string, string> {
  const target = appTarget(design);
  const issues = checkAppSource(source, target.headers);
  if (issues.length) throw new Error(`Firmware source refused: ${issues.join(' ')}`);
  return {
    'platformio.ini': `[platformio]\ndefault_envs = esp32dev\n\n[env:esp32dev]\nplatform = ${platform}\nboard = esp32dev\nframework = arduino\nmonitor_speed = 115200\nlib_deps =\n${target.libs.map(l => `  ${l}`).join('\n')}\n`,
    'include/pins.h': `#pragma once\n// Generated from the design's nets. The application uses these names and never a GPIO number.\n${target.pins.map(p => `constexpr int ${p.name} = ${p.gpio};`).join('\n')}\n`,
    'src/main.cpp': source,
    'README.md': `# Moki firmware: ${design.title.replace(/[\r\n]/g, ' ').slice(0, 80)}\n\nThis application was written by an AI model for this design and has only been compiled. It has not run on anything. Read it before you flash it.\n\nBuild with \`pio run -e esp32dev\`. Check your module pinouts before flashing with \`pio run -e esp32dev -t upload\`.\n`,
  };
}
