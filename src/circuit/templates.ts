import { MODULE } from './catalog.js';
import { DEFAULT_PINS } from './interpret.js';
import type { BehaviorNote, CircuitDesign, DesignNote, Interpretation, Net, NetKind, PartInstance, PinRef } from './model.js';

// Bounded templates: each one turns an Interpretation into a complete design graph with explicit
// parts, pins and nets. Explanations are written here, next to the connections they describe.

const LED_VF = 2.0;
const LED_R = 150;
const SUPPLY = 3.3;

function ref(part: string, pin: string): PinRef {
  return { part, pin };
}

function net(id: string, name: string, kind: NetKind, endpoints: PinRef[], why: string, volts?: number, analog?: boolean): Net {
  const sorted = [...endpoints].sort((a, b) => a.part.localeCompare(b.part) || a.pin.localeCompare(b.pin));
  return { id, name, kind, endpoints: sorted, why, ...(volts !== undefined ? { volts } : {}), ...(analog ? { analog } : {}) };
}

function gpio(n: number): string {
  return `GPIO${n}`;
}

const MCU: PartInstance = { id: 'U1', module: MODULE.esp32, role: 'Runs the firmware and supplies 3.3 V from its USB-powered regulator.' };

const WHY_3V3 = 'One 3.3 V supply from the ESP32 board’s regulator. Every part here runs at 3.3 V, so its signals match the ESP32’s 3.3 V logic.';
const WHY_GND = 'Common ground. Every signal is measured against it, so every part must share it.';

function i2cNets(devices: string[]): Net[] {
  const pins = (pin: string) => devices.map(d => ref(d, pin));
  const shared = devices.length > 1 ? ' Both I²C devices share these two wires; they answer to different addresses (OLED 0x3C, BME280 0x76).' : '';
  return [
    net('I2C_SCL', 'I2C_SCL', 'signal', [ref('U1', gpio(22)), ...pins('SCL')], `I²C clock, driven by the ESP32. GPIO22 is the default SCL pin of the ESP32 Arduino Wire library. Most breakouts already carry pull-up resistors.${shared}`),
    net('I2C_SDA', 'I2C_SDA', 'signal', [ref('U1', gpio(21)), ...pins('SDA')], `I²C data, in both directions. GPIO21 is the default SDA pin of the ESP32 Arduino Wire library.${shared}`),
  ];
}

function buzzerNet(pin: number): Net {
  return net('BUZZER', 'BUZZER', 'signal', [ref('U1', gpio(pin)), ref('BZ1', '+')], `GPIO${pin} toggles a tone (for example with ledcWriteTone) and the piezo clicks at that frequency. A passive piezo draws very little current, so the pin can drive it directly.`);
}

function focusTimer(i: Interpretation): CircuitDesign {
  const { options } = i;
  const parts: PartInstance[] = [
    MCU,
    { id: 'U2', module: MODULE.oled, role: 'Shows the time left in the session.' },
    { id: 'SW1', module: MODULE.encoder, role: 'Turn to set the time; press to start or pause.' },
  ];
  const power = [ref('U1', '3V3'), ref('U2', 'VCC'), ref('SW1', 'VCC')];
  const ground = [ref('U1', 'GND'), ref('U2', 'GND'), ref('SW1', 'GND')];
  const nets: Net[] = [
    ...i2cNets(['U2']),
    net('ENC_A', 'ENC_A', 'signal', [ref('U1', gpio(32)), ref('SW1', 'CLK')], 'Encoder channel A (CLK). With channel B it tells which way the knob turned: whichever changes first gives the direction.'),
    net('ENC_B', 'ENC_B', 'signal', [ref('U1', gpio(33)), ref('SW1', 'DT')], 'Encoder channel B (DT), read alongside channel A. GPIO32 and 33 are plain input/output pins with no boot role.'),
    net('ENC_SW', 'ENC_SW', 'signal', [ref('U1', gpio(27)), ref('SW1', 'SW')], 'The knob’s push switch connects this pin to ground when pressed. Enable INPUT_PULLUP on GPIO27 so it reads high when released.'),
  ];
  const notes: DesignNote[] = [
    { level: 'warning', part: 'U2', text: 'This board expects GND-VCC-SCL-SDA. Check yours before plugging it in.' },
    { level: 'warning', part: 'SW1', text: 'Power the encoder from 3V3, not 5V: its pull-ups would otherwise put 5 V on ESP32 inputs.' },
  ];
  if (options.buzzer) {
    const pin = options.pins.buzzer ?? DEFAULT_PINS.buzzer;
    parts.push({ id: 'BZ1', module: MODULE.piezo, role: 'Chimes when a session ends.' });
    ground.push(ref('BZ1', '-'));
    nets.push(buzzerNet(pin));
    notes.push({ level: 'info', part: 'BZ1', text: 'Use a passive piezo transducer. A magnetic or active buzzer needs a transistor driver, which is not drawn here.' });
  }
  nets.unshift(net('+3V3', '+3V3', 'power', power, WHY_3V3, SUPPLY), net('GND', 'GND', 'ground', ground, WHY_GND));
  const behavior: BehaviorNote[] = [
    { label: 'Session length', value: `${options.focusMinutes ?? 25} min${options.focusMinutes ? '' : ' (default)'}` },
    { label: 'Knob', value: 'Turn to adjust, press to start or pause' },
  ];
  if (options.buzzer) behavior.push({ label: 'End of session', value: 'Short chime on the piezo' });
  return { schema: 'moki.circuit-preview/1', template: 'focus-timer', title: 'Focus timer', parts, nets, notes, behavior };
}

function lightLamp(i: Interpretation): CircuitDesign {
  const { options } = i;
  const ledPin = options.pins.led ?? DEFAULT_PINS.led;
  const current = ((SUPPLY - LED_VF) / LED_R) * 1000;
  const parts: PartInstance[] = [
    MCU,
    { id: 'LDR1', module: MODULE.ldr, role: 'Senses how bright the room is.' },
    { id: 'R1', module: MODULE.resistor, value: '10 kΩ', role: 'With the LDR, turns light level into a voltage the ESP32 can measure.' },
    { id: 'R2', module: MODULE.resistor, value: `${LED_R} Ω`, role: 'Limits the LED current to a level a GPIO pin can safely supply.' },
    { id: 'D1', module: MODULE.led, value: 'amber', role: 'The lamp itself, at indicator brightness.' },
  ];
  const nets: Net[] = [
    net('+3V3', '+3V3', 'power', [ref('U1', '3V3'), ref('LDR1', '1')], WHY_3V3, SUPPLY),
    net('GND', 'GND', 'ground', [ref('U1', 'GND'), ref('R1', '2'), ref('D1', 'K')], WHY_GND),
    net('LIGHT_SENSE', 'LIGHT_SENSE', 'signal', [ref('LDR1', '2'), ref('R1', '1'), ref('U1', gpio(34))], 'The midpoint of a voltage divider. More light lowers the LDR’s resistance, so this voltage rises. GPIO34 is on ADC1, which keeps working while Wi-Fi is on; it is input-only, which is fine for reading.', undefined, true),
    net('LED_DRIVE', 'LED_DRIVE', 'signal', [ref('U1', gpio(ledPin)), ref('R2', '1')], `GPIO${ledPin} switches the LED on and off (or dims it with PWM) through the current-limiting resistor.`),
    net('LED_A', 'LED_A', 'signal', [ref('R2', '2'), ref('D1', 'A')], `Resistor to LED anode. Current ≈ (3.3 V − ${LED_VF.toFixed(1)} V) ÷ ${LED_R} Ω ≈ ${current.toFixed(1)} mA, below the ~20 mA a GPIO should supply. Check the forward voltage of your LED.`),
  ];
  const notes: DesignNote[] = [
    { level: 'warning', part: 'D1', text: 'Indicator-scale lamp: one LED straight from a GPIO pin. A brighter lamp needs a MOSFET driver and its own supply, which this preview does not design.' },
    { level: 'info', net: 'LIGHT_SENSE', text: 'LDRs vary a lot. Calibrate the threshold in your own room.' },
  ];
  const behavior: BehaviorNote[] = [
    { label: 'Switch on below', value: `${options.darkPercent ?? 30}% of the sensor range${options.darkPercent ? '' : ' (default)'}` },
    { label: 'LED current', value: `≈ ${current.toFixed(1)} mA (assumes ${LED_VF.toFixed(1)} V forward voltage)` },
  ];
  return { schema: 'moki.circuit-preview/1', template: 'light-lamp', title: 'Light-sensing lamp', parts, nets, notes, behavior };
}

function tempMonitor(i: Interpretation): CircuitDesign {
  const { options } = i;
  const parts: PartInstance[] = [MCU];
  const power = [ref('U1', '3V3')];
  const ground = [ref('U1', 'GND')];
  const nets: Net[] = [];
  const notes: DesignNote[] = [];
  const i2c: string[] = [];
  if (options.display) {
    parts.push({ id: 'U2', module: MODULE.oled, role: 'Shows the current temperature.' });
    power.push(ref('U2', 'VCC')); ground.push(ref('U2', 'GND')); i2c.push('U2');
    notes.push({ level: 'warning', part: 'U2', text: 'This board expects GND-VCC-SCL-SDA. Check yours before plugging it in.' });
  }
  if (options.sensor === 'bme280') {
    parts.push({ id: 'U3', module: MODULE.bme280, role: 'Measures temperature, humidity and pressure.' });
    power.push(ref('U3', 'VIN')); ground.push(ref('U3', 'GND')); i2c.push('U3');
    notes.push({ level: 'warning', part: 'U3', text: 'Only the 3.3 V-only 4-pin BME280 breakout is modelled. Check that yours is not a BMP280, which has no humidity sensor.' });
  } else {
    const probe = options.pins.probe ?? DEFAULT_PINS.probe;
    parts.push(
      { id: 'U3', module: MODULE.ds18b20, role: 'Measures temperature on a One-Wire bus.' },
      { id: 'R1', module: MODULE.resistor, value: '4.7 kΩ', role: 'Pull-up for the One-Wire data line.' },
    );
    power.push(ref('U3', 'VDD'), ref('R1', '1')); ground.push(ref('U3', 'GND'));
    nets.push(net('ONEWIRE', 'ONEWIRE', 'signal', [ref('U1', gpio(probe)), ref('U3', 'DQ'), ref('R1', '2')], `One-Wire data. The sensor and the ESP32 only ever pull this line low; the 4.7 kΩ resistor pulls it back up to 3.3 V between bits. GPIO${probe} has no boot role.`));
    notes.push({ level: 'info', part: 'U3', text: 'A waterproof DS18B20 probe uses the same three wires (usually red VDD, black GND, yellow DQ).' });
  }
  if (i2c.length) nets.push(...i2cNets(i2c));
  if (options.buzzer) {
    const pin = options.pins.buzzer ?? DEFAULT_PINS.buzzer;
    parts.push({ id: 'BZ1', module: MODULE.piezo, role: 'Sounds the temperature alert.' });
    ground.push(ref('BZ1', '-'));
    nets.push(buzzerNet(pin));
  }
  if (!options.display && !options.buzzer) notes.push({ level: 'info', text: 'With no screen or buzzer, readings are only visible over the USB serial console.' });
  nets.unshift(net('+3V3', '+3V3', 'power', power, WHY_3V3, SUPPLY), net('GND', 'GND', 'ground', ground, WHY_GND));
  const behavior: BehaviorNote[] = [{ label: 'Sensor', value: options.sensor === 'bme280' ? 'BME280 over I²C' : 'DS18B20 over One-Wire' }];
  if (options.alertC !== undefined) behavior.push({ label: options.alertDirection === 'below' ? 'Alert below' : 'Alert above', value: `${options.alertC} °C${options.buzzer ? ', with a chime' : options.display ? ', shown on screen' : ''}` });
  return { schema: 'moki.circuit-preview/1', template: 'temp-monitor', title: 'Temperature monitor', parts, nets, notes, behavior };
}

export function buildDesign(interpretation: Interpretation): CircuitDesign {
  switch (interpretation.template) {
    case 'focus-timer': return focusTimer(interpretation);
    case 'light-lamp': return lightLamp(interpretation);
    case 'temp-monitor': return tempMonitor(interpretation);
  }
}
