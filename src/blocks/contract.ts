/** JSON-only block interface. Imported geometry and review receipts are resolved by code. */
export type PinId = number | string;
export interface Citation {
  url: string;
  sha256?: string;
  pages?: string;
  note?: string;
}
export interface Pose {
  x: number;
  y: number;
  rotation?: number;
}
export type ElectricalRole =
  | 'power-in'
  | 'power-out'
  | 'ground'
  | 'input'
  | 'output'
  | 'open-drain'
  | 'bidirectional'
  | 'passive'
  | 'nc';
export interface BlockPart {
  ref: string;
  mpn: string;
  lcsc: string;
  catalogReceipt: string;
  datasheet: Citation;
  pinout: 'verified' | 'unverified';
  pins: Record<
    string,
    { pad: string; role: ElectricalRole; required?: boolean; volts?: { min: number; max: number } }
  >;
  at: Pose;
  value?: string;
  valueWhy?: Citation;
  /** Audited footprint corrections, never arbitrary replacement geometry. */
  omitPads?: string[];
  correction?: Citation;
  /** Required native crystal fact, cited by the part's manufacturer datasheet. */
  crystal?: { loadCapacitancePf: number };
  /** Remove optional imported routing vias, retaining every physical pin/pad. Requires correction. */
  omitImportedVias?: boolean;
  footprint?: { source: 'jlcpcb' | 'footprinter' | 'kicad'; id: string; citation: Citation };
  switch?: 'normally-open';
}
export interface Port {
  id: string;
  label: string;
  kind: 'power-in' | 'power-out' | 'ground' | 'bus' | 'gpio' | 'analog';
  terminal?: string; // Local part.pin or net:NAME. Bus uses signals instead.
  volts?: { min: number; max: number };
  /** A dedicated control (for example reset or boot), never application GPIO. */
  fixedFunction?: string;
  bus?: {
    protocol: string;
    role: 'controller' | 'peripheral' | 'passive';
    signals: Record<string, string>;
    i2cAddresses?: number[];
  };
}
export interface McuFacts {
  family: string;
  pio: { platform: string; board: string; framework: string; environment?: string };
  pins: Array<{ id: string; gpio: PinId; caps: string[]; reserved?: string; fixedFunction?: string }>;
  flashKb: number;
  ramKb: number;
}
export type Constraint =
  | {
      kind: 'decoupling';
      ic: string;
      powerPin: string;
      groundPin: string;
      caps: string[];
      minUf: number;
      maxDistanceMm: number;
      citation: Citation;
    }
  | { kind: 'pullup'; pin: string; to: string; resistor: string; ohms: number; citation: Citation }
  | {
      kind: 'strap';
      pin: string;
      safe: 'high' | 'low' | 'floating';
      resistor?: string;
      to?: string;
      citation: Citation;
    }
  | {
      kind: 'usb-c-sink';
      connector: string;
      cc1: string;
      cc2: string;
      resistors: [string, string];
      ohms: number;
      citation: Citation;
    }
  | {
      kind: 'battery-path';
      charger: string;
      batteryPort: string;
      systemPort?: string;
      powerPath: 'isolated' | 'load-sharing' | 'integrated';
      citation: Citation;
    }
  | {
      kind: 'keepout';
      x: number;
      y: number;
      width: number;
      height: number;
      layers: string[];
      purpose: string;
      excludeParts?: string[];
      citation: Citation;
    }
  | {
      kind: 'edge';
      part: string;
      edge: 'left' | 'right' | 'top' | 'bottom';
      overhangMm?: number;
      citation: Citation;
    }
  | { kind: 'ground'; pin: string; citation: Citation };
export type SpiceCheck = (
  | { kind: 'rc-reset'; resistor: string; capacitor: string; supplyV: number; thresholdRatio: number }
  /**
   * `upperOhm`/`lowerOhm`: the resistance that element has in a stated condition, instead of a resistor's value: a light
   * sensor in the dark, water between two wires. `series`: a resistor on this block between the measured node and inputs
   * only, so it carries no DC current and the measured voltage reaches them.
   */
  | { kind: 'divider'; upper: string; lower: string; inputV: number; upperOhm?: number; lowerOhm?: number; series?: string }
  | { kind: 'resistor-current'; resistor: string; voltageV: number }
  /** `switch`: a transistor on this block between the LED's cathode and ground, closed for this check, dropping `switchDropV`. */
  | { kind: 'led-current'; resistor: string; supplyV: number; forwardV: number; switch?: string; switchDropV?: number }
  | { kind: 'charge-current'; resistor: string; coefficient: number }
) & { name: string; target: number; tolerance: number; citation: Citation };
export interface BlockDef {
  schema: 'moki.block/1';
  id: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  class: string;
  status: 'reviewed' | 'unreviewed';
  provenance: {
    author: 'human' | 'agent';
    authorId?: string;
    reviews: Array<{ by: string; at: string; contentHash: string; verdict: 'pass' | 'fail'; notes: string }>;
  };
  parts: BlockPart[];
  nets: Array<{ name: string; pins: string[] }>;
  params: Array<{
    id: string;
    type: 'number' | 'enum';
    min?: number;
    max?: number;
    options?: string[];
    unit?: string;
    default: number | string;
    why: string;
  }>;
  ports: Port[];
  power: {
    sources: Array<{
      port: string;
      volts: number;
      maxMa: number;
      continuousMa?: number;
      inputPort?: string;
      efficiency?: number;
      mode?: 'regulated' | 'external' | 'charger';
      conversion?: 'linear' | 'switching';
      dropoutV?: number;
      maxDissipationW?: number;
      thermal?: { thetaJa: number; maxJunctionC: number; ambientC: number };
    }>;
    sinks: Array<{ port: string; typicalMa: number; peakMa: number }>;
  };
  constraints: Constraint[];
  spiceChecks?: SpiceCheck[];
  firmware?: { libs: string[]; includes: string[]; usage: string };
  mcu?: McuFacts;
}
/** Author cannot supply a trusted review/promotion with its own draft. */
export type BlockDraft = Omit<BlockDef, 'contentHash' | 'status' | 'provenance'> & {
  provenance: { author: 'human' | 'agent'; authorId?: string };
};
export interface BoardPlan {
  schema: 'moki.plan/1';
  title: string;
  layers: 2 | 4;
  board?: { widthMm: number; heightMm: number; cornerRadiusMm?: number };
  blocks: Array<{
    inst: string;
    block: string;
    version: number;
    params: Record<string, number | string>;
    at?: Pose;
  }>;
  links: Array<{ from: string; to: string }>;
  /** A person's name for a net, keyed by a port on it: `inst.PORT`, or `inst.PORT.SIGNAL` on a bus. */
  netNames?: Record<string, string>;
  sections?: Array<{
    id: string;
    title: string;
    purpose: string;
    insts: string[];
    notes: string[];
    reference?: { lcsc: string; datasheetUrl: string; page: number; figure?: string; quote: string };
  }>;
  drafts?: BlockDraft[];
  requirements?: Requirement[];
  app?: { source: string };
}
export interface GateResult {
  /** Electrical plan/content identity for reusable measured or reviewed evidence. */
  inputHash?: string;
  gate: 'erc' | 'power' | 'drc' | 'compile' | 'block-test' | 'spice' | 'verify' | 'review';
  ok: boolean;
  issues: Array<{ rule: string; severity: 'error' | 'warning'; where?: string; message: string }>;
  measurements?: Array<{
    where: string;
    name: string;
    measured: number;
    target: number;
    tolerance: number;
    unit: string;
    ok: boolean;
  }>;
  results?: RequirementResult[];
}
export type RequirementMetric =
  | 'battery_life_h'
  | 'interface_present'
  | 'board_size_mm'
  | 'pin_capability'
  | 'net_voltage'
  | 'current_budget_ma'
  | 'part_count'
  | 'bom_cost_usd';
export type RequirementOp = '>=' | '<=' | '==' | 'within' | 'present';
export interface Requirement {
  id: string;
  plain: string;
  metric: RequirementMetric;
  args?: Record<string, string | number>;
  op?: RequirementOp;
  value?: number | string | [number, number];
  unit?: string;
  source: 'brief' | 'answer' | 'default' | 'inferred' | 'maker';
}
export interface RequirementMetricDef {
  metric: RequirementMetric;
  plain: string;
  args: Record<string, 'string' | 'number'>;
  ops: RequirementOp[];
  unit?: string;
  needs: Array<'plan' | 'power' | 'spice' | 'catalog'>;
}
export interface RequirementResult {
  id: string;
  status: 'pass' | 'fail' | 'unsupported';
  measured?: number | string | number[];
  target?: number | string | number[];
  unit?: string;
  evidence: string;
  estimated?: boolean;
}
export interface DeviceFacts {
  interfaces: string[];
  boardMm?: [number, number];
  signals: Record<string, string[]>;
  /** netVolts alone can be nominal; evidence is required for the SPICE voltage metric. */
  netVolts: Record<string, number>;
  netVoltEvidence?: Record<string, string>;
  loadMa?: { typical: number; peak: number; estimated: boolean };
  batteryMah?: number;
  /** A battery/power path is known, rather than just a hypothetical capacity. */
  batteryPresent?: boolean;
  partCount?: number;
  bomCostUsd?: number;
}
export interface PinMap {
  family: string;
  pio: McuFacts['pio'];
  pins: Record<string, { gpio: PinId; port: string }>;
  libs: string[];
  includes: string[];
  usage: Array<{ block: string; note: string }>;
}
export interface CatalogPart {
  lcsc: string;
  mpn: string;
  manufacturer?: string;
  package?: string;
  description?: string;
  stock?: number;
  catalogReceipt: string;
  importer: string;
  rawSha256: string;
  footprintSha256: string;
  pins: Array<{ pad: string; labels: string[] }>;
  models: Array<{ format: 'obj' | 'step'; url: string; sha256?: string }>;
  datasheetUrl?: string;
  datasheetReceipt?: string;
  importerUnavailableReceipt?: string;
}
export interface BlockTestReceipt {
  contentHash: string;
  at: string;
  gates: GateResult[];
  artifacts: Record<string, string>;
  ms: number;
}
