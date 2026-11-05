// Domain model for the bounded circuit preview.
// A CircuitDesign is a connected design graph: explicit part instances, each referencing a catalog
// module with explicit pins, and nets that join pin references. Both the schematic and the wiring
// view are rendered from the same CircuitDesign; neither view owns connectivity.

export type TemplateId = 'focus-timer' | 'light-lamp' | 'temp-monitor';

export type PinKind =
  | 'power-out' // a supply the module provides (ESP32 3V3 from its on-board regulator)
  | 'power-in' // a supply input the module needs
  | 'ground'
  | 'gpio' // microcontroller pin; see GpioCaps for what it can do
  | 'signal' // peripheral signal pin; see SignalNeed
  | 'passive'; // two-terminal component lead

/** What a peripheral signal pin needs from the microcontroller pin it is wired to. */
export type SignalNeed = 'drive' | 'read' | 'analog' | 'bidirectional';

export interface GpioCaps {
  gpio: number;
  input: boolean;
  output: boolean;
  adc1: boolean;
  /** Has an internal pull-up resistor (GPIO 34–39 do not). */
  pullup: boolean;
  /** Pins that affect boot mode, are wired to flash, or carry the USB serial console. */
  reserved?: 'strapping' | 'flash' | 'uart0';
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface PhysicalPin {
  /** Millimetres in the module's own top-view frame, origin at its top-left. */
  x: number;
  y: number;
  /** Direction a jumper wire naturally leaves the pin. */
  dir: Direction;
}

export interface PinDef {
  id: string;
  /** Label printed next to the pin in both views. */
  label: string;
  kind: PinKind;
  /** Required pins must be connected in every design that uses the module. */
  required: boolean;
  gpio?: GpioCaps;
  need?: SignalNeed;
  /** The pin floats unless the microcontroller enables its internal pull-up. */
  needsPullup?: boolean;
  physical: PhysicalPin;
  note?: string;
}

export type ModuleCategory = 'controller' | 'display' | 'input' | 'sensor' | 'output' | 'passive';
export type SchematicSymbol = 'block' | 'resistor' | 'ldr' | 'led' | 'piezo';
export type PhysicalDrawing = 'esp32-devkitc' | 'oled-ssd1306' | 'ky040' | 'to92' | 'bme280' | 'resistor' | 'ldr' | 'led' | 'piezo';

export interface ModuleDef {
  id: string;
  name: string;
  category: ModuleCategory;
  symbol: SchematicSymbol;
  drawing: PhysicalDrawing;
  /** Approximate outline in millimetres. Not a footprint or a mechanical drawing. */
  size: { w: number; h: number };
  pins: readonly PinDef[];
  /** Acceptable supply range on the power-in pin, volts. */
  supply?: { min: number; max: number };
  /** Supply provided on power-out pins, volts. */
  provides?: number;
  notes: readonly string[];
}

export interface PartInstance {
  /** Reference designator, unique within a design (U1, R1, …). */
  id: string;
  module: string;
  /** Why this part is in the design, in the maker's terms. */
  role: string;
  value?: string;
}

export interface PinRef {
  part: string;
  pin: string;
}

export type NetKind = 'power' | 'ground' | 'signal';

export interface Net {
  id: string;
  name: string;
  kind: NetKind;
  volts?: number;
  endpoints: PinRef[];
  /** The microcontroller reads this net as an analog voltage and never drives it. */
  analog?: boolean;
  /** Why these pins connect, written for the inspector. */
  why: string;
}

export interface DesignNote {
  level: 'warning' | 'info';
  text: string;
  part?: string;
  net?: string;
}

export interface BehaviorNote {
  label: string;
  value: string;
}

export interface CircuitDesign {
  schema: 'moki.circuit-preview/1';
  template: TemplateId;
  title: string;
  parts: PartInstance[];
  nets: Net[];
  notes: DesignNote[];
  /** Parameters intended for firmware. No firmware is generated in this preview. */
  behavior: BehaviorNote[];
  /** Firmware the Firmware agent wrote for this design, and what it was asked to do. Without it, the template's fixed program runs. */
  app?: { source: string; brief: string };
  /** What the maker confirmed this device must do. Checked after every change. Stored by code, never by a model. */
  requirements?: import('../agents/protocol.js').Requirement[];
}

export type SensorChoice = 'ds18b20' | 'bme280';
export type PinRole = 'led' | 'buzzer' | 'probe';

export interface DesignOptions {
  buzzer: boolean;
  display: boolean;
  sensor: SensorChoice;
  pins: Partial<Record<PinRole, number>>;
  /** light-lamp: switch on below this brightness, percent of the sensor range. */
  darkPercent?: number;
  /** temp-monitor: alert threshold, °C, and which side of it raises the alert. */
  alertC?: number;
  alertDirection?: 'above' | 'below';
  /** focus-timer: session length, minutes. */
  focusMinutes?: number;
}

export interface RecognizedPhrase {
  text: string;
  meaning: string;
}

export interface Interpretation {
  template: TemplateId;
  chosenBy: 'brief' | 'user';
  options: DesignOptions;
  recognized: RecognizedPhrase[];
  notes: string[];
}

/** 'internal' means the preview's own template failed its checks: a product bug, not the user's input. */
export type RejectionReason = 'empty' | 'invalid-input' | 'too-long' | 'unsupported' | 'ambiguous' | 'unrecognized' | 'invalid-parameter' | 'internal';

export interface Rejection {
  reason: RejectionReason;
  message: string;
  details: string[];
  candidates?: TemplateId[];
}

export type InterpretResult = { ok: true; interpretation: Interpretation } | { ok: false; rejection: Rejection };
