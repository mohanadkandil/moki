import { ASSIGNABLE_GPIO, gpioCaps } from './catalog.js';
import type { DesignOptions, InterpretResult, PinRole, RecognizedPhrase, Rejection, SensorChoice, TemplateId } from './model.js';

// A deterministic, rule-based reader for a deliberately small vocabulary. Nothing here calls a model.
//
// Every phrase in a brief ends up in exactly one of four places:
//   1. used: it selects the template, a feature, a setting or a pin (shown as "recognized");
//   2. rejected: unsupported hardware, quantities, voltages, contradictions or out-of-range settings;
//   3. accounted as not applicable (a note, e.g. Wi-Fi is firmware);
//   4. listed as "not used": harmless description such as "cosy" or "bedside".
// Hardware words, part quantities and measurements that are left over after (1)–(3) are rejected
// by name, so a successful drawing never quietly drops something the person asked for.

export const MAX_BRIEF_LENGTH = 600;
export const TEMPLATE_IDS: readonly TemplateId[] = ['focus-timer', 'light-lamp', 'temp-monitor'];

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  'focus-timer': 'focus timer',
  'light-lamp': 'light-sensing lamp',
  'temp-monitor': 'temperature monitor',
};

export const EXAMPLE_BRIEFS: ReadonlyArray<{ template: TemplateId; label: string; brief: string }> = [
  { template: 'focus-timer', label: 'Focus timer', brief: 'A 25 minute focus timer with a small screen and a knob, and a buzzer that beeps when time is up' },
  { template: 'light-lamp', label: 'Night lamp', brief: 'A little lamp that turns on when the room gets darker than 30%' },
  { template: 'temp-monitor', label: 'Temperature monitor', brief: 'A temperature monitor with a probe and a screen that alerts above 28 °C' },
];

export const DEFAULT_PINS: Record<PinRole, number> = { led: 25, buzzer: 23, probe: 4 };

const INTENTS: Record<TemplateId, RegExp> = {
  'focus-timer': /\b(focus timer|pomodoro|countdown|timer|focus)\b/g,
  'light-lamp': /\b(night ?light|light sensor|light-sensing|ldr|photoresistor|photocell|ambient light|lamp|gets? dark(?:er)?|when (?:it(?:'s| is) )?dark|darkness)\b/g,
  'temp-monitor': /\b(temperature|thermometer|temp|ds18b20|bme280|humidity|weather)\b/g,
};

interface Blocked { pattern: RegExp; reason: string }

const BLOCKED: readonly Blocked[] = [
  { pattern: /\b(mains|wall (?:socket|outlet|power|plug)|(?:power |electrical )?outlets?|power sockets?|ac power|ac adapter|household power|vac)\b/g, reason: 'Mains power is out of scope. This preview only covers USB-powered 3.3 V circuits.' },
  { pattern: /\b(motors?|servos?|steppers?|solenoids?|pumps?|fans?|heaters?|relays?)\b/g, reason: 'needs a driver and a separate supply, which this preview does not design.' },
  { pattern: /\b(speakers?|amplifiers?|amps?|microphones?|mics?)\b/g, reason: 'audio parts are not in the catalog. A passive piezo buzzer is (“with a buzzer”).' },
  { pattern: /\b(lcd|tft|e-?ink|e-?paper|touch ?screen|7-segment|seven segment)\b/g, reason: 'is not in the catalog. The supported display is a 0.96″ SSD1306 OLED (“with a screen”).' },
  { pattern: /\b(neopixels?|ws2812b?|led strips?|rgb strips?|rgb leds?|light strips?|led rings?)\b/g, reason: 'addressable or strip lighting needs 5 V power and level shifting, which this preview does not design.' },
  { pattern: /\b(batter(?:y|ies)|lipo|li-ion|lithium|18650|coin cell|solar)\b/g, reason: 'battery and charging circuits are not modelled. These circuits are powered from the ESP32 board’s USB port.' },
  { pattern: /\b(cameras?|gps|rfid|nfc|keypads?|joysticks?|ultrasonic|lidar|accelerometers?|gyro(?:scope)?s?|imu|sd ?cards?|micro ?sd|potentiometers?|pots|rtc|real[- ]time clock|dht\d*|sht\d+|bmp\d+|mpu\d+|thermocouples?|thermistors?|load cells?|pir)\b/g, reason: 'is not in the preview catalog.' },
  { pattern: /\b((?:soil|moisture|pir|motion|gas|co2|smoke|water|flow|sound|noise|distance|proximity|pressure-sensitive|touch|tilt|vibration|hall)(?: \w+)? sensors?)\b/g, reason: 'is not in the preview catalog. Supported sensors: DS18B20, BME280 and a light-dependent resistor.' },
  { pattern: /\b(arduino|raspberry ?pi|pico|esp8266|esp32[- ]?s[23]|esp32[- ]?c[36]|esp32[- ]?h2|stm32|attiny|micro:?bit|teensy)\b/g, reason: 'is a different controller. This preview only draws the ESP32-DevKitC V4.' },
];

// Voltages: "12V", "12 V", "12-volt", "230VAC", "24 VDC", "1000V".
const VOLTAGE = /(?<![\w.])(\d+(?:\.\d+)?)\s*-?\s*(?:v|volts?)(?:\s*(?:ac|dc))?\b/g;

const FEATURE = {
  display: /(?:(?<![\w.])0\.96\s*(?:″|"|-?inch|in)?\s*)?\b(displays?|screens?|oleds?|readout)\b/g,
  knob: /\b(knobs?|dials?|rotary(?: encoder)?|encoders?)\b/g,
  buzzer: /\b(buzzers?|beeps?|beeping|chimes?|piezo|alarm|sound|tone)\b/g,
  silent: /\b(silent|quiet|mute|muted)\b/g,
  button: /\b(push ?buttons?|buttons?)\b/g,
  led: /\b(leds?)\b/g,
  bme280: /\b(bme280|humidity|pressure|barometric)\b/g,
  ds18b20: /\b(ds18b20|probe|waterproof|one-?wire)\b/g,
  network: /\b(wi-?fi|bluetooth|ble|app|phone|mqtt|home assistant|internet|cloud)\b/g,
  body: /\b(enclosure|case|housing|pcb|gerbers?|3d print(?:ed)?)\b/g,
  usb: /\b(usb(?:-c)?(?: port| cable| power(?:ed)?)?)\b/g,
  esp32: /\b(esp32(?:[- ]devkitc(?:[- ]v4)?)?|devkitc(?:[- ]v4)?|wroom-?32|ky-?040|ssd1306|ds18b20|bme280)\b/g,
};

/** Words that belong to a template's own vocabulary and are consumed without changing anything. */
const TEMPLATE_WORDS: Record<TemplateId, RegExp> = {
  'focus-timer': /\b(sessions?|work|study|break|time(?:'s)? up|when time is up|ends?|finished|done|counts? down|start|pause)\b/g,
  'light-lamp': /\b(lights? up|light|lit|glows?|glowing|brightness|bright|brighter|dim|dimmer|dimming|dark|darker|dusk|night|room light|on and off)\b/g,
  'temp-monitor': /\b(temperature sensor|sensor|probe|reading|readings|measures?|measuring|shows?|displays? the temperature|alerts?|warns?|warning|logger|logs?)\b/g,
};

const COMMON_VERBS = /\b(turns? (?:on|off)|switch(?:es)? (?:on|off)|comes? on|goes? off|shows?|tells? me|lets? me|when|while|beeps? when|powered(?: by| from| over)?|runs?(?: on| from)?|uses?|using|plugged in)\b/g;

const STOPWORDS = new Set(('a an the and or but with without of for to in on at by from into onto it its it\'s is are be was this that these those my our your me i we you which who when while so then than as up just also very really some any one single small little tiny simple nice cute basic make build design create want need would like please can could should will get gets got has have having do does thing things device gadget project monitor station companion something circuit board that\'s there here how what where all only more less time').split(' '));

/** Words naming hardware or a measurement. Left over after interpretation, they block the drawing. */
const HARDWARE_RESIDUAL = /\b(sensors?|lights?|bulbs?|lamps?|leds?|screens?|displays?|knobs?|dials?|buttons?|keys?|switch(?:es)?|sliders?|modules?|chips?|transistors?|mosfets?|diodes?|capacitors?|resistors?|antennas?|haptics?|vibrat\w*|rgb|infrared|ir|remote|siren|bell|horn|gauges?|meters?|clock|connectors?|jacks?|card)\b/g;
const QUANTITY = /(?<!(?:gpio|io|pin|on|to|at)\s*#?\s*)\b((?<![\w.-])\d+(?![\d.])(?!\s*(?:%|°|º|percent|degrees?|deg|minutes?|mins?|hours?|hrs?|seconds?|secs?|v\b|volts?|c\b|f\b))|two|three|four|five|six|seven|eight|nine|ten|several|multiple|many|a few|a couple of|a pair of|pair of|dozens? of)\s+(?:[a-z-]+\s+){0,2}?(leds?|lights?|buttons?|screens?|displays?|oleds?|knobs?|dials?|encoders?|sensors?|probes?|buzzers?|piezos?|resistors?|lamps?)\b/g;
const PLURAL_PARTS = /^(leds|buttons|push buttons|pushbuttons|screens|displays|oleds|knobs|dials|encoders|buzzers|probes)$/;
const UNIT_RESIDUAL = /(?<![\w.])-?\d+(?:\.\d+)?\s*-?\s*(?:%|°|º|percent\b|s\b|secs?\b|seconds?\b|ms\b|hz\b|khz\b|mhz\b|ma\b|amps?\b|a\b|w\b|watts?\b|mm\b|cm\b|m\b|meters?\b|inch(?:es)?\b|in\b|lux\b|db\b|degrees?\b|deg\b|c\b|f\b|minutes?\b|mins?\b|hours?\b|hrs?\b|h\b|kg\b|g\b|grams?\b)/g;

const NEGATION = /\b(no|not|without|never|don't|dont|doesn't|doesnt|do not|does not|isn't|won't|skip|minus|except)\b(?:\s+[\w'-]+){0,3}\s*$/;
const CLAUSE_BREAK = /[,.;:!?]|\b(?:but|and|or|with|plus|also)\b/g;

interface Hit { text: string; index: number; end: number }

/** The normalized brief plus a record of which characters have been accounted for. */
class Reader {
  readonly text: string;
  private readonly used: boolean[];
  constructor(text: string) {
    this.text = text;
    this.used = new Array(text.length).fill(false);
  }
  find(pattern: RegExp): Hit[] {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    return [...this.text.matchAll(new RegExp(pattern.source, flags))].map(m => ({ text: m[0], index: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  }
  consume(hit: Hit): void {
    for (let i = hit.index; i < hit.end; i++) this.used[i] = true;
  }
  take(pattern: RegExp): Hit[] {
    const hits = this.find(pattern).filter(h => !this.isUsed(h));
    hits.forEach(h => this.consume(h));
    return hits;
  }
  isUsed(hit: Hit): boolean {
    for (let i = hit.index; i < hit.end; i++) if (!this.used[i]) return false;
    return true;
  }
  /** Start of the clause containing position `at`. */
  clauseStart(at: number): number {
    let start = 0;
    for (const m of this.text.slice(0, at).matchAll(CLAUSE_BREAK)) start = (m.index ?? 0) + m[0].length;
    return start;
  }
  /** "no buzzer", "without a screen", "doesn't need a screen": a negation shortly before, in the same clause. */
  negated(hit: Hit): Hit | null {
    const start = this.clauseStart(hit.index);
    const window = this.text.slice(start, hit.index);
    const m = window.match(NEGATION);
    if (!m || m.index === undefined) return null;
    return { text: m[0].trim(), index: start + m.index, end: hit.index };
  }
  residual(): string {
    return [...this.text].map((c, i) => (this.used[i] ? ' ' : c)).join('');
  }
}

function reject(reason: Rejection['reason'], message: string, details: string[] = [], candidates?: TemplateId[]): InterpretResult {
  return { ok: false, rejection: { reason, message, details, ...(candidates ? { candidates } : {}) } };
}

function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

export function normalizeBrief(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mentions of a feature, split by whether the person asked for it or ruled it out. */
function polarity(reader: Reader, pattern: RegExp): { yes: Hit[]; no: Hit[] } {
  const yes: Hit[] = [];
  const no: Hit[] = [];
  for (const hit of reader.find(pattern)) {
    if (reader.isUsed(hit)) continue;
    const neg = reader.negated(hit);
    reader.consume(hit);
    if (neg) { reader.consume(neg); no.push(hit); } else yes.push(hit);
  }
  return { yes, no };
}

export function interpretBrief(input: unknown, choice?: unknown): InterpretResult {
  if (typeof input !== 'string') return reject('invalid-input', 'The brief must be text.');
  if (choice !== undefined && !isTemplateId(choice)) return reject('invalid-input', 'That circuit choice is not one of the supported templates.');
  const brief = normalizeBrief(input);
  if (!brief) return reject('empty', 'Describe one of the supported circuits to draw it.');
  if (brief.length > MAX_BRIEF_LENGTH) return reject('too-long', `Keep the brief under ${MAX_BRIEF_LENGTH} characters. This preview reads short descriptions.`);
  const reader = new Reader(brief.toLowerCase());

  // 1. Hard scope limits come first, so an unsupported part is never silently dropped.
  //    A part the person explicitly rules out ("no motor") is not a request for it.
  const blocked: string[] = [];
  for (const rule of BLOCKED) {
    for (const hit of reader.find(rule.pattern)) {
      if (reader.isUsed(hit)) continue;
      const neg = reader.negated(hit);
      reader.consume(hit);
      if (neg) { reader.consume(neg); continue; }
      blocked.push(rule.reason.startsWith('Mains') ? rule.reason : `“${hit.text}” ${rule.reason}`);
      break;
    }
  }
  for (const hit of reader.find(VOLTAGE)) {
    reader.consume(hit);
    const volts = Number(hit.text.match(/[\d.]+/)?.[0]);
    if (volts > 5 || /ac\b/.test(hit.text)) blocked.push(`“${hit.text}” is outside this preview. Everything here runs from USB 5 V and the board’s 3.3 V regulator.`);
  }
  for (const hit of reader.find(QUANTITY)) {
    const noun = hit.text.split(/\s+/).at(-1)!;
    blocked.push(`“${hit.text}”: this preview draws at most one ${noun.replace(/s$/, '').replace(/^led$/, 'LED')}.`);
    reader.consume(hit);
  }
  if (blocked.length) return reject('unsupported', 'Part of this brief is outside what the preview can draw.', [...new Set(blocked)]);

  // 2. Exactly one template must be indicated, unless the person picked one explicitly.
  const recognized: RecognizedPhrase[] = [];
  const notes: string[] = [];
  const intentHits = TEMPLATE_IDS.map(id => ({ id, hits: reader.find(INTENTS[id]) }));
  const hits = intentHits.filter(i => i.hits.length).map(i => i.id);
  let template: TemplateId;
  if (isTemplateId(choice)) {
    template = choice;
    const others = hits.filter(h => h !== choice);
    if (others.length) notes.push(`You chose the ${TEMPLATE_NAMES[choice]}. Mentions of a ${others.map(o => TEMPLATE_NAMES[o]).join(' or ')} were not used.`);
    for (const i of intentHits) i.hits.forEach(h => reader.consume(h));
  } else if (hits.length === 0) {
    return reject('unrecognized', 'This doesn’t match one of the three circuits this preview can draw.', [
      'Supported: a focus timer (screen + knob), a light-sensing lamp, or a temperature monitor.',
      'Try one of the examples, or name one of those in your own words.',
    ]);
  } else if (hits.length > 1) {
    return reject('ambiguous', `This brief mentions a ${hits.map(h => TEMPLATE_NAMES[h]).join(' and a ')}. The preview draws one circuit at a time.`, ['Choose which one to draw, or edit the brief.'], hits);
  } else {
    template = hits[0]!;
  }
  for (const hit of intentHits.find(i => i.id === template)!.hits) {
    reader.consume(hit);
    recognized.push({ text: hit.text, meaning: `Selects the ${TEMPLATE_NAMES[template]}` });
  }

  const options: DesignOptions = { buzzer: false, display: template !== 'light-lamp', sensor: 'ds18b20', pins: {} };
  const problems: string[] = [];
  const name = TEMPLATE_NAMES[template];

  // 3. Features, with their polarity. Optional features follow the brief; fixed ones cannot be removed.
  const plural = (h: Hit) => PLURAL_PARTS.test(h.text);
  const display = polarity(reader, FEATURE.display);
  const knob = polarity(reader, FEATURE.knob);
  const button = polarity(reader, FEATURE.button);
  const buzzer = polarity(reader, FEATURE.buzzer);
  const silent = reader.take(FEATURE.silent);
  const led = polarity(reader, FEATURE.led);
  buzzer.no.push(...silent);
  for (const h of [...display.yes, ...knob.yes, ...button.yes, ...buzzer.yes, ...led.yes].filter(plural)) problems.push(`“${h.text}”: this preview draws at most one.`);
  const contradiction = (label: string, f: { yes: Hit[]; no: Hit[] }) => {
    if (f.yes.length && f.no.length) problems.push(`The brief both asks for and rules out ${label} (“${f.yes[0]!.text}”, “${f.no[0]!.text}”).`);
  };
  contradiction('a screen', display); contradiction('a buzzer', buzzer); contradiction('a knob', knob); contradiction('an LED', led);

  if (display.yes.length) {
    if (template === 'light-lamp') problems.push(`“${display.yes[0]!.text}”: the lamp has no display. The temperature monitor and focus timer do.`);
    else recognized.push({ text: display.yes[0]!.text, meaning: 'Adds the 0.96″ OLED (I²C)' });
  } else if (display.no.length) {
    if (template === 'focus-timer') problems.push('The focus timer needs its screen to show the time left. It can’t be left out.');
    else if (template === 'temp-monitor') { options.display = false; recognized.push({ text: `no ${display.no[0]!.text}`, meaning: 'Leaves out the OLED' }); }
  }
  if (knob.yes.length) {
    if (template === 'focus-timer') recognized.push({ text: knob.yes[0]!.text, meaning: 'Adds the KY-040 rotary encoder' });
    else problems.push(`“${knob.yes[0]!.text}”: only the focus timer has a knob.`);
  } else if (knob.no.length && template === 'focus-timer') {
    problems.push('The focus timer is set with its knob. It can’t be left out.');
  }
  if (button.yes.length) {
    if (template === 'focus-timer') recognized.push({ text: button.yes[0]!.text, meaning: 'Uses the encoder’s built-in push switch' });
    else problems.push(`“${button.yes[0]!.text}”: the only button in this preview is the focus timer’s knob press.`);
  }
  if (buzzer.yes.length) {
    if (template === 'light-lamp') problems.push(`“${buzzer.yes[0]!.text}”: the lamp template has no buzzer.`);
    else { options.buzzer = true; recognized.push({ text: buzzer.yes[0]!.text, meaning: 'Adds a passive piezo buzzer' }); }
  } else if (buzzer.no.length && template !== 'light-lamp') {
    recognized.push({ text: buzzer.no[0]!.text, meaning: 'No buzzer' });
  }
  if (led.yes.length) {
    if (template === 'light-lamp') recognized.push({ text: led.yes[0]!.text, meaning: 'The lamp’s amber LED' });
    else problems.push(`“${led.yes[0]!.text}”: the ${name} has no separate LED in this preview.`);
  } else if (led.no.length && template === 'light-lamp') {
    problems.push('The lamp’s LED is the lamp. It can’t be left out.');
  }

  // Sensor words may also have selected the template ("humidity"), so read them regardless of use.
  const bme = reader.find(FEATURE.bme280);
  const probe = reader.find(FEATURE.ds18b20);
  [...bme, ...probe].forEach(h => reader.consume(h));
  if (template === 'temp-monitor') {
    if (bme.length && probe.length) problems.push(`Choose one temperature sensor: “${bme[0]!.text}” needs the BME280; “${probe[0]!.text}” means the DS18B20.`);
    else if (bme.length) { options.sensor = 'bme280'; recognized.push({ text: bme[0]!.text, meaning: 'Uses the BME280 (temperature, humidity, pressure)' }); }
    else if (probe.length) recognized.push({ text: probe[0]!.text, meaning: 'Uses the DS18B20' });
  } else if (bme.length || probe.length) {
    problems.push(`“${(bme[0] ?? probe[0])!.text}”: temperature sensing belongs to the temperature monitor.`);
  }
  if (problems.length) return reject('unsupported', `The ${name} can’t be drawn exactly as described.`, problems);

  // 4. Settings and pins, each bounded by the hardware or the template.
  const settings = parseSettings(reader, template, options, recognized);
  if (settings) return settings;
  const pins = parsePins(reader, template, options, recognized);
  if (pins) return pins;

  // 5. Words that are understood but change nothing in this drawing.
  reader.take(TEMPLATE_WORDS[template]);
  reader.take(COMMON_VERBS);
  if (reader.take(FEATURE.network).length) notes.push('Wi-Fi and Bluetooth are inside the ESP32 module. Network behaviour is firmware, which this preview does not write.');
  if (reader.take(FEATURE.body).length) notes.push('Enclosures and PCB layout are not drawn here. This is a wiring preview.');
  const usb = reader.take(FEATURE.usb);
  if (usb.length) recognized.push({ text: usb[0]!.text, meaning: 'USB power through the ESP32 board' });
  reader.take(FEATURE.esp32);

  // 6. Residual accounting: leftover hardware or measurements block the drawing; prose is listed.
  const rest = reader.residual();
  const leftovers: string[] = [];
  for (const m of rest.matchAll(UNIT_RESIDUAL)) leftovers.push(`“${m[0].trim()}” isn’t a value the ${name} uses in this preview.`);
  const afterUnits = rest.replace(UNIT_RESIDUAL, m => ' '.repeat(m.length));
  for (const m of afterUnits.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g)) leftovers.push(`“${m[0]}” isn’t used by the ${name}. Each setting takes one value written with its unit (for example “28 °C”, “25 minutes”, “30%”).`);
  for (const m of rest.matchAll(HARDWARE_RESIDUAL)) leftovers.push(`“${m[0]}” isn’t part of the ${name} in this preview.`);
  if (leftovers.length) return reject('unsupported', `Some of this brief would be left out of the ${name}.`, [...new Set(leftovers)]);
  const unused = [...new Set((rest.match(/[a-z][a-z'-]+/g) ?? []).filter(w => w.length > 2 && !STOPWORDS.has(w)))];
  if (unused.length) notes.push(`Not used: ${unused.slice(0, 8).map(w => `“${w}”`).join(', ')}${unused.length > 8 ? ` and ${unused.length - 8} more` : ''}. They don’t change the circuit.`);

  const unique = recognized.filter((r, i) => recognized.findIndex(o => o.text === r.text) === i);
  return { ok: true, interpretation: { template, chosenBy: isTemplateId(choice) ? 'user' : 'brief', options, recognized: unique, notes } };
}

const SENSOR_RANGE: Record<SensorChoice, readonly [number, number]> = { ds18b20: [-55, 125], bme280: [-40, 85] };

const ABOVE = /\b(above|over|more than|greater than|higher than|hotter than|warmer than|exceeds?|exceeding|rises?|reaches?|hits?|at least|brighter than)\b/;
const BELOW = /\b(below|under|less than|lower than|colder than|cooler than|falls?|drops?|dips?|freezing|darker than|dimmer than)\b/;

// A negation up to two words before the comparison: "not above", "does not turn on below".
const NEGATED_COMPARISON = /\b(?:not|never|no|isn't|doesn't|don't|won't|without)\s+(?:[\w']+\s+){0,2}$/;

function direction(reader: Reader, hit: Hit): { dir: 'above' | 'below' | 'negated' | null; word?: Hit } {
  const start = Math.max(reader.clauseStart(hit.index), hit.index - 40);
  const window = reader.text.slice(start, hit.index);
  const words = [...window.matchAll(new RegExp(`${ABOVE.source}|${BELOW.source}`, 'g'))];
  const last = words.at(-1);
  if (!last || last.index === undefined) return { dir: null };
  // Every comparison word in the window is part of this setting ("falls below").
  const first = words[0]!.index!;
  const word = { text: window.slice(first, last.index + last[0].length), index: start + first, end: start + last.index + last[0].length };
  // "not above 30 C" means the opposite side, or nothing definite; it is not "above 30 C".
  const negation = window.slice(0, first).match(NEGATED_COMPARISON);
  if (negation && negation.index !== undefined) {
    const index = start + negation.index;
    return { dir: 'negated', word: { text: reader.text.slice(index, word.end), index, end: word.end } };
  }
  return { dir: ABOVE.test(last[0]) ? 'above' : 'below', word };
}

/** "between 18 and 24 C", "from 18 to 24 degrees", "25 or 50 minutes", "18-24C": several values for one setting. */
const SETTING_RANGE = /(?:\b(?:between|from)\s+)?(?<!(?:gpio|io|pin)\s*#?\s*)(?<![\w.-])-?\d+(?:\.\d+)?\s*(?:%|°|º|percent|degrees?|deg|c|f|minutes?|mins?|hours?|hrs?|h)?\s*(?:and|or|to|through|-)\s*-?\d+(?:\.\d+)?\s*(?:%|°|º|percent\b|degrees?\b|deg\b|c\b|f\b|celsius\b|fahrenheit\b|minutes?\b|mins?\b|hours?\b|hrs?\b|h\b)/g;

function negatedThreshold(word: Hit, value: string): InterpretResult {
  return reject('invalid-parameter', `“${word.text} ${value}” is a negated threshold, which this preview doesn’t model.`, [`Say which side should trigger it, for example “above ${value}” or “below ${value}”.`]);
}

function distinctBy<T>(items: T[], key: (t: T) => number): T[] {
  return items.filter((t, i) => items.findIndex(o => key(o) === key(t)) === i);
}

function parseSettings(reader: Reader, template: TemplateId, options: DesignOptions, recognized: RecognizedPhrase[]): InterpretResult | null {
  const range = reader.find(SETTING_RANGE)[0];
  if (range) return reject('invalid-parameter', `“${range.text.trim()}” gives a range or alternatives. This preview records one value per setting.`, ['Choose one value, for example a single alert temperature or session length.']);
  if (template === 'light-lamp') {
    const found = reader.take(/(?<![\w.])(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)/g);
    const values = distinctBy(found, h => Number(h.text.match(/[\d.]+/)![0]));
    if (values.length > 1) return reject('invalid-parameter', 'The brief gives more than one brightness threshold.', [`Found ${values.map(v => v.text).join(' and ')}. Keep one.`]);
    const hit = values[0];
    if (hit) {
      const v = Number(hit.text.match(/[\d.]+/)![0]);
      const { dir, word } = direction(reader, hit);
      if (dir === 'negated') return negatedThreshold(word!, hit.text);
      if (dir === 'above') return reject('invalid-parameter', 'The lamp switches on when the room gets darker. A “brighter than” threshold isn’t modelled.', [`Write it as “turns on when darker than ${v}%”.`]);
      if (v < 5 || v > 95) return reject('invalid-parameter', `A ${v}% threshold can’t be used.`, ['Choose a brightness between 5% and 95% of the sensor range.']);
      if (word) reader.consume(word);
      options.darkPercent = v;
      recognized.push({ text: hit.text, meaning: `Switch on below ${v}% brightness (a firmware setting)` });
    }
  }

  if (template === 'temp-monitor') {
    // "28 °C", "28C", "82 F", "28 degrees" (read as Celsius), "28 degrees fahrenheit".
    const found = reader.take(/(?<![\w.])(-?\d{1,3}(?:\.\d+)?)\s*(?:(?:°|º)\s*(?:c|f|celsius|fahrenheit)?|(?:degrees?|degs?|deg)(?:\s*(?:c|f|celsius|fahrenheit))?|c|f|celsius|fahrenheit)(?![a-z])/g);
    const parsed = found.map(hit => {
      const raw = Number(hit.text.match(/-?[\d.]+/)![0]);
      const unitText = hit.text.replace(/^-?[\d.]+\s*/, '');
      const fahrenheit = /(^|[^a-z])f|fahrenheit/.test(unitText);
      const assumed = !/c|f|celsius|fahrenheit/.test(unitText.replace(/deg(rees?)?/, ''));
      return { hit, c: Math.round((fahrenheit ? (raw - 32) * 5 / 9 : raw) * 10) / 10, assumed };
    });
    const values = distinctBy(parsed, p => p.c);
    if (values.length > 1) return reject('invalid-parameter', 'The brief gives more than one alert temperature.', [`Found ${values.map(v => `${v.c} °C`).join(' and ')}. Keep one.`]);
    const t = values[0];
    if (t) {
      const [lo, hi] = SENSOR_RANGE[options.sensor];
      if (t.c < lo || t.c > hi) return reject('invalid-parameter', `${t.c} °C is outside what the ${options.sensor === 'bme280' ? 'BME280' : 'DS18B20'} can measure.`, [`Its range is ${lo} to ${hi} °C.`]);
      const { dir, word } = direction(reader, t.hit);
      if (dir === 'negated') return negatedThreshold(word!, t.hit.text);
      if (word) reader.consume(word);
      options.alertC = t.c;
      options.alertDirection = dir ?? 'above';
      recognized.push({ text: t.hit.text, meaning: `Alert ${options.alertDirection} ${t.c} °C${t.assumed ? ' (degrees read as Celsius)' : ''}${dir ? '' : ' (above, by default)'} — a firmware setting` });
    }
  }

  if (template === 'focus-timer') {
    const seconds = reader.find(/(?<![\w.])\d+(?:\.\d+)?\s*-?\s*(?:seconds?|secs?)\b/g);
    if (seconds.length) return reject('invalid-parameter', `“${seconds[0]!.text}”: focus sessions are set in minutes (1 to 180).`);
    const found = reader.take(/(?<![\w.])(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h|minutes?|mins?)\b|\b(an?|one) hour\b|\bhalf an hour\b|\ban hour and a half\b/g);
    const parsed = found.map(hit => {
      const t = hit.text;
      let minutes: number;
      if (t === 'half an hour') minutes = 30;
      else if (t === 'an hour and a half') minutes = 90;
      else if (/^(an?|one) hour$/.test(t)) minutes = 60;
      else minutes = Number(t.match(/[\d.]+/)![0]) * (/h/.test(t.replace(/[\d.\s-]/g, '')) ? 60 : 1);
      return { hit, minutes };
    });
    const values = distinctBy(parsed, p => p.minutes);
    if (values.length > 1) return reject('invalid-parameter', 'The brief gives more than one session length.', [`Found ${values.map(v => v.hit.text).join(' and ')}. Keep one.`]);
    const v = values[0];
    if (v) {
      if (!Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 180) return reject('invalid-parameter', `A session of “${v.hit.text}” can’t be used.`, ['Choose a whole number of minutes between 1 and 180.']);
      options.focusMinutes = v.minutes;
      recognized.push({ text: v.hit.text, meaning: `${v.minutes}-minute sessions (a firmware setting)` });
    }
  }
  return null;
}

const ROLE_NAMES: Record<PinRole, string> = { led: 'LED', buzzer: 'buzzer', probe: 'DS18B20 data line' };
const ROLE_WORDS: ReadonlyArray<readonly [PinRole, RegExp]> = [
  ['led', /\b(leds?|lamp)\b/g],
  ['buzzer', /\b(buzzer|piezo|beeper)\b/g],
  ['probe', /\b(probe|ds18b20|sensor|data|one-?wire)\b/g],
];

function roleAvailable(role: PinRole, template: TemplateId, options: DesignOptions): boolean {
  if (role === 'led') return template === 'light-lamp';
  if (role === 'buzzer') return options.buzzer;
  return template === 'temp-monitor' && options.sensor === 'ds18b20';
}

/** Pins the template fixes, by GPIO number, so user assignments cannot collide with them. */
function fixedPins(template: TemplateId, options: DesignOptions): Map<number, string> {
  const fixed = new Map<number, string>();
  const i2c = template === 'focus-timer' || (template === 'temp-monitor' && (options.display || options.sensor === 'bme280'));
  if (i2c) { fixed.set(21, 'I²C SDA'); fixed.set(22, 'I²C SCL'); }
  if (template === 'focus-timer') { fixed.set(32, 'encoder CLK'); fixed.set(33, 'encoder DT'); fixed.set(27, 'encoder switch'); }
  if (template === 'light-lamp') fixed.set(34, 'the light sensor');
  return fixed;
}

function parsePins(reader: Reader, template: TemplateId, options: DesignOptions, recognized: RecognizedPhrase[]): InterpretResult | null {
  // "GPIO26", "IO 26", "pin 26", and the bare board label after a part: "LED on 26".
  const explicit = reader.find(/\b(?:gpio|io|pin)\s*#?\s*(\d{1,2})\b/g).map(hit => ({ hit, role: null as PinRole | null }));
  const bare = reader.find(/\b(leds?|lamp|buzzer|piezo|beeper|probe|ds18b20|sensor|data)\s+(?:is\s+)?(?:on|to|at)\s+(\d{1,2})\b(?!\s*(?:%|°|º|degrees?|minutes?|mins?|hours?|c\b|f\b))/g).map(hit => {
    const word = hit.text.split(/\s+/)[0]!;
    const role = ROLE_WORDS.find(([, p]) => new RegExp(p.source).test(word))![0];
    return { hit, role: role as PinRole | null };
  });
  const mentions = [...explicit, ...bare].sort((a, b) => a.hit.index - b.hit.index);
  if (!mentions.length) return null;
  const assigned = new Map<PinRole, number>();
  for (const { hit, role: given } of mentions) {
    const gpio = Number(hit.text.match(/(\d{1,2})$/)?.[1] ?? hit.text.match(/\d{1,2}/)![0]);
    let role = given;
    if (!role) {
      const start = reader.clauseStart(hit.index);
      const after = reader.text.slice(hit.end);
      const nextBreak = after.search(/[,;.]| and /);
      const clause = reader.text.slice(start, hit.end + (nextBreak === -1 ? after.length : nextBreak));
      const offset = hit.index - start;
      let best: { role: PinRole; distance: number; at: number; len: number } | null = null;
      for (const [r, pattern] of ROLE_WORDS) {
        for (const w of clause.matchAll(pattern)) {
          const at = w.index ?? 0;
          const distance = at <= offset ? offset - at : at - offset + 1000; // prefer words before the pin
          if (!best || distance < best.distance) best = { role: r, distance, at, len: w[0].length };
        }
      }
      if (!best) return reject('invalid-parameter', `Found “${hit.text}” but not which part it is for.`, ['Write it as “LED on GPIO26”, “buzzer on GPIO18” or “probe on GPIO13”.']);
      role = best.role;
      reader.consume({ text: '', index: start + best.at, end: start + best.at + best.len });
    }
    reader.consume(hit);
    if (template === 'light-lamp' && role === 'probe') return reject('invalid-parameter', 'The light sensor stays on GPIO34 in this template: it needs an ADC1 input.');
    if (!roleAvailable(role, template, options)) return reject('invalid-parameter', `“${hit.text}” is assigned to a ${ROLE_NAMES[role]}, which this ${TEMPLATE_NAMES[template]} doesn’t have.`, role === 'buzzer' ? ['Add “with a buzzer” to include one.'] : []);
    const previous = assigned.get(role);
    if (previous !== undefined && previous !== gpio) return reject('invalid-parameter', `The ${ROLE_NAMES[role]} is given two pins (GPIO${previous} and GPIO${gpio}).`, ['Keep one.']);
    const problem = pinProblem(gpio, role, template, options);
    if (problem) return reject('invalid-parameter', problem, [`Pins you can choose here: ${ASSIGNABLE_GPIO.filter(p => !fixedPins(template, options).has(p)).map(p => `GPIO${p}`).join(', ')}.`]);
    assigned.set(role, gpio);
    recognized.push({ text: hit.text, meaning: `${ROLE_NAMES[role]} on GPIO${gpio}${given ? ` (read “${gpio}” as the board’s GPIO label)` : ''}` });
  }
  const used = new Map<number, PinRole>();
  for (const [role, gpio] of assigned) {
    const clash = used.get(gpio);
    if (clash) return reject('invalid-parameter', `GPIO${gpio} is given to both the ${ROLE_NAMES[clash]} and the ${ROLE_NAMES[role]}.`, ['Give each part its own pin.']);
    used.set(gpio, role);
  }
  // A default pin of an unassigned role must not collide with an assigned one.
  for (const role of Object.keys(DEFAULT_PINS) as PinRole[]) {
    if (!roleAvailable(role, template, options) || assigned.has(role)) continue;
    const clash = used.get(DEFAULT_PINS[role]);
    if (clash) return reject('invalid-parameter', `GPIO${DEFAULT_PINS[role]} is already the ${ROLE_NAMES[role]}’s pin.`, [`Choose another pin for the ${ROLE_NAMES[clash]}.`]);
  }
  options.pins = Object.fromEntries(assigned);
  return null;
}

export function pinProblem(gpio: number, role: PinRole, template: TemplateId, options: DesignOptions): string | null {
  const exists = gpio <= 39 && ![20, 24, 28, 29, 30, 31, 37, 38].includes(gpio);
  if (!exists) return `GPIO${gpio} isn’t a pin on the ESP32-DevKitC V4.`;
  const caps = gpioCaps(gpio);
  if (caps.reserved === 'flash') return `GPIO${gpio} is wired to the board’s flash memory and can’t be used.`;
  if (caps.reserved === 'strapping') return `GPIO${gpio} is a boot strapping pin. A ${ROLE_NAMES[role]} on it can stop the board from starting.`;
  if (caps.reserved === 'uart0') return `GPIO${gpio} carries the USB serial console.`;
  if (!caps.output) return `GPIO${gpio} is input-only on the ESP32, so it can’t drive the ${ROLE_NAMES[role]}.`;
  const fixed = fixedPins(template, options).get(gpio);
  if (fixed) return `GPIO${gpio} is already used for ${fixed} in this circuit.`;
  if (!ASSIGNABLE_GPIO.includes(gpio)) return `GPIO${gpio} is kept free in this preview (PSRAM on some ESP32 boards).`;
  return null;
}
