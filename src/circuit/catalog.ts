import type { GpioCaps, ModuleDef, PinDef } from './model.js';

// The preview catalog. Pinouts follow common hobby modules; outlines are approximate and drawn for
// recognition, not measured footprints. Module variants differ: notes say what to check.

const PITCH = 2.54;

function header(x: number, firstY: number, labels: readonly string[], dir: 'left' | 'right'): Array<{ label: string; x: number; y: number; dir: 'left' | 'right' }> {
  return labels.map((label, i) => ({ label, x, y: round(firstY + i * PITCH), dir }));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ESP32-DevKitC V4 header order, antenna end at the top, USB at the bottom.
const LEFT_HEADER = ['3V3', 'EN', 'GPIO36', 'GPIO39', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO14', 'GPIO12', 'GND', 'GPIO13', 'GPIO9', 'GPIO10', 'GPIO11', '5V'] as const;
const RIGHT_HEADER = ['GND2', 'GPIO23', 'GPIO22', 'GPIO1', 'GPIO3', 'GPIO21', 'GND3', 'GPIO19', 'GPIO18', 'GPIO5', 'GPIO17', 'GPIO16', 'GPIO4', 'GPIO0', 'GPIO2', 'GPIO15', 'GPIO8', 'GPIO7', 'GPIO6'] as const;

const INPUT_ONLY = new Set([34, 35, 36, 39]);
const ADC1 = new Set([32, 33, 34, 35, 36, 39]);
const STRAPPING = new Set([0, 2, 5, 12, 15]);
const FLASH = new Set([6, 7, 8, 9, 10, 11]);
const UART0 = new Set([1, 3]);
const SILK: Record<string, string> = { GPIO36: 'VP', GPIO39: 'VN', GPIO1: 'TX', GPIO3: 'RX', GPIO9: 'SD2', GPIO10: 'SD3', GPIO11: 'CMD', GPIO8: 'SD1', GPIO7: 'SD0', GPIO6: 'CLK' };

export function gpioCaps(gpio: number): GpioCaps {
  const caps: GpioCaps = { gpio, input: true, output: !INPUT_ONLY.has(gpio), adc1: ADC1.has(gpio), pullup: !INPUT_ONLY.has(gpio) };
  if (STRAPPING.has(gpio)) caps.reserved = 'strapping';
  else if (FLASH.has(gpio)) caps.reserved = 'flash';
  else if (UART0.has(gpio)) caps.reserved = 'uart0';
  return caps;
}

function esp32Pin(id: string, x: number, y: number, dir: 'left' | 'right'): PinDef {
  const physical = { x, y, dir };
  if (id === '3V3') return { id, label: '3V3', kind: 'power-out', required: false, physical, note: 'Output of the board regulator, fed from USB 5 V.' };
  if (id === '5V') return { id, label: '5V', kind: 'power-in', required: false, physical, note: 'USB 5 V. Not used by these circuits.' };
  if (id.startsWith('GND')) return { id, label: 'GND', kind: 'ground', required: false, physical };
  if (id === 'EN') return { id, label: 'EN', kind: 'signal', need: 'read', required: false, physical, note: 'Reset/enable. Leave unconnected.' };
  const gpio = Number(id.slice(4));
  const silk = SILK[id];
  return { id, label: silk ? `${silk}·${gpio}` : `IO${gpio}`, kind: 'gpio', required: false, gpio: gpioCaps(gpio), physical };
}

const esp32: ModuleDef = {
  id: 'esp32-devkitc-v4',
  name: 'ESP32-DevKitC V4',
  category: 'controller',
  symbol: 'block',
  drawing: 'esp32-devkitc',
  size: { w: 27.9, h: 54.4 },
  provides: 3.3,
  pins: [
    ...header(1.25, 6.9, LEFT_HEADER, 'left').map(p => esp32Pin(p.label, p.x, p.y, p.dir)),
    ...header(26.65, 6.9, RIGHT_HEADER, 'right').map(p => esp32Pin(p.label, p.x, p.y, p.dir)),
  ],
  notes: [
    'Powered from its USB port. Its regulator supplies 3.3 V to every module here.',
    'All logic is 3.3 V. Do not connect 5 V signals to GPIO pins.',
    'GPIO 34–39 are input-only. GPIO 0, 2, 5, 12 and 15 affect booting; 6–11 belong to the flash chip.',
  ],
};

function topRow(labels: ReadonlyArray<readonly [string, string, PinDef['kind'], PinDef['need']?]>, centerX: number, y: number): PinDef[] {
  return labels.map(([id, label, kind, need], i) => ({
    id, label, kind, required: true, ...(need ? { need } : {}),
    physical: { x: round(centerX + (i - (labels.length - 1) / 2) * PITCH), y, dir: 'up' as const },
  }));
}

const oled: ModuleDef = {
  id: 'ssd1306-oled-128x64-i2c',
  name: '0.96″ OLED, SSD1306, I²C',
  category: 'display',
  symbol: 'block',
  drawing: 'oled-ssd1306',
  size: { w: 27.3, h: 27.8 },
  supply: { min: 3.3, max: 5 },
  pins: topRow([['GND', 'GND', 'ground'], ['VCC', 'VCC', 'power-in'], ['SCL', 'SCL', 'signal', 'drive'], ['SDA', 'SDA', 'signal', 'bidirectional']], 13.65, 1.6),
  notes: [
    'I²C address is usually 0x3C (sometimes 0x3D, set by a jumper on the back).',
    'Accepts 3.3–5 V on VCC through its own regulator; here it runs at 3.3 V.',
  ],
};

const encoder: ModuleDef = {
  id: 'ky040-rotary-encoder',
  name: 'KY-040 rotary encoder',
  category: 'input',
  symbol: 'block',
  drawing: 'ky040',
  size: { w: 32, h: 19 },
  supply: { min: 3.3, max: 5 },
  pins: ([['GND', 'GND', 'ground'], ['VCC', '+', 'power-in'], ['SW', 'SW', 'signal', 'read'], ['DT', 'DT', 'signal', 'read'], ['CLK', 'CLK', 'signal', 'read']] as const).map(([id, label, kind, need], i) => ({
    id, label, kind, required: true, ...(need ? { need } : {}), ...(id === 'SW' ? { needsPullup: true } : {}),
    physical: { x: 30.6, y: round(4.4 + i * PITCH), dir: 'right' as const },
  })),
  notes: [
    'CLK and DT have 10 kΩ pull-ups to the + pin on the module, so + must be 3.3 V here.',
    'The push switch (SW) usually has no pull-up fitted: enable the ESP32 internal pull-up.',
  ],
};

const ds18b20: ModuleDef = {
  id: 'ds18b20-to92',
  name: 'DS18B20 temperature sensor (TO-92)',
  category: 'sensor',
  symbol: 'block',
  drawing: 'to92',
  size: { w: 5, h: 13 },
  supply: { min: 3.0, max: 5.5 },
  pins: [
    { id: 'GND', label: 'GND', kind: 'ground', required: true, physical: { x: 1.23, y: 13, dir: 'down' } },
    { id: 'DQ', label: 'DQ', kind: 'signal', need: 'bidirectional', required: true, physical: { x: 2.5, y: 13, dir: 'down' } },
    { id: 'VDD', label: 'VDD', kind: 'power-in', required: true, physical: { x: 3.77, y: 13, dir: 'down' } },
  ],
  notes: [
    'One-Wire data line: needs a 4.7 kΩ pull-up from DQ to 3.3 V.',
    'Measures −55 to 125 °C. Pin order shown with the flat face toward you.',
  ],
};

const bme280: ModuleDef = {
  id: 'bme280-i2c-4pin',
  name: 'BME280 breakout, 4-pin I²C',
  category: 'sensor',
  symbol: 'block',
  drawing: 'bme280',
  size: { w: 13, h: 11 },
  supply: { min: 1.71, max: 3.6 },
  pins: topRow([['VIN', 'VIN', 'power-in'], ['GND', 'GND', 'ground'], ['SCL', 'SCL', 'signal', 'drive'], ['SDA', 'SDA', 'signal', 'bidirectional']], 6.5, 1.4),
  notes: [
    'The 4-pin breakout has no regulator: power it from 3.3 V only.',
    'Temperature, humidity and pressure. I²C address 0x76 (0x77 on some boards).',
  ],
};

const resistor: ModuleDef = {
  id: 'resistor-axial',
  name: 'Resistor, ¼ W through-hole',
  category: 'passive',
  symbol: 'resistor',
  drawing: 'resistor',
  size: { w: 2.6, h: 16 },
  pins: [
    { id: '1', label: '1', kind: 'passive', required: true, physical: { x: 1.3, y: 0, dir: 'up' } },
    { id: '2', label: '2', kind: 'passive', required: true, physical: { x: 1.3, y: 16, dir: 'down' } },
  ],
  notes: ['Either way round.'],
};

const ldr: ModuleDef = {
  id: 'ldr-5mm',
  name: 'Light-dependent resistor, 5 mm',
  category: 'sensor',
  symbol: 'ldr',
  drawing: 'ldr',
  size: { w: 5, h: 14 },
  pins: [
    { id: '1', label: '1', kind: 'passive', required: true, physical: { x: 1.2, y: 14, dir: 'down' } },
    { id: '2', label: '2', kind: 'passive', required: true, physical: { x: 3.8, y: 14, dir: 'down' } },
  ],
  notes: ['Resistance falls as light rises (roughly 1 MΩ dark to a few kΩ in room light). Either way round.'],
};

const led: ModuleDef = {
  id: 'led-5mm-amber',
  name: 'LED, 5 mm amber',
  category: 'output',
  symbol: 'led',
  drawing: 'led',
  size: { w: 5.8, h: 14 },
  pins: [
    { id: 'A', label: 'A', kind: 'passive', required: true, physical: { x: 4.2, y: 14, dir: 'down' }, note: 'Anode, the longer leg.' },
    { id: 'K', label: 'K', kind: 'passive', required: true, physical: { x: 1.6, y: 13, dir: 'down' }, note: 'Cathode, the shorter leg by the flat edge.' },
  ],
  notes: ['Forward voltage about 2.0 V. Polarised: the long leg is the anode.'],
};

const piezo: ModuleDef = {
  id: 'piezo-passive-12mm',
  name: 'Passive piezo transducer, 12 mm',
  category: 'output',
  symbol: 'piezo',
  drawing: 'piezo',
  size: { w: 12, h: 13 },
  pins: [
    { id: '+', label: '+', kind: 'passive', required: true, physical: { x: 3.5, y: 13, dir: 'down' } },
    { id: '-', label: '−', kind: 'passive', required: true, physical: { x: 8.5, y: 13, dir: 'down' } },
  ],
  notes: ['A passive piezo draws very little current and can be driven by a GPIO tone. A magnetic buzzer would need a transistor driver.'],
};

export const CATALOG: ReadonlyMap<string, ModuleDef> = new Map([esp32, oled, encoder, ds18b20, bme280, resistor, ldr, led, piezo].map(m => [m.id, m]));

export const MODULE = {
  esp32: esp32.id,
  oled: oled.id,
  encoder: encoder.id,
  ds18b20: ds18b20.id,
  bme280: bme280.id,
  resistor: resistor.id,
  ldr: ldr.id,
  led: led.id,
  piezo: piezo.id,
} as const;

export function moduleDef(id: string): ModuleDef {
  const def = CATALOG.get(id);
  if (!def) throw new Error(`Unknown catalog module: ${id}`);
  return def;
}

export function pinDef(moduleId: string, pinId: string): PinDef | undefined {
  return CATALOG.get(moduleId)?.pins.find(p => p.id === pinId);
}

/** GPIOs a brief may assign to a part. Excludes strapping, flash, UART0, I²C defaults and 16/17 (PSRAM on WROVER boards). */
export const ASSIGNABLE_GPIO: readonly number[] = [4, 13, 14, 18, 19, 23, 25, 26, 27, 32, 33];
