// The catalog as agents see it, and the one check every proposed design goes through.
import { firmwareProject } from '../firmware/index.js';
import { generateBoardSource } from '../board/codegen.js';
import { CATALOG, MODULE } from '../circuit/catalog.js';
import type { CircuitDesign, TemplateId } from '../circuit/model.js';
import { checkDesign } from '../circuit/validate.js';
import { claimsPhysicalProof } from './facts.js';
import { appTarget, checkAppSource } from './firmware-project.js';
import { REQUIREMENT_METRICS } from './requirement-metrics.js';
import { requirementIssues } from './verifier.js';
import type { ToolDef } from './model.js';

/** The fixed programs. A design that needs other behaviour asks the Firmware agent, within the same modules. */
export const FIRMWARE_FAMILIES: Record<TemplateId, { use: string; modules: readonly string[]; settings: string; customFirmwareModules?: readonly string[] }> = {
  // Its board stacks parts in a column whatever they are, so custom firmware can have any mix of the kit on it.
  'focus-timer': { use: 'Countdown shown on a screen, set and started with a knob, optional chime at the end. With custom firmware, the board for any mix of catalog modules.', modules: [MODULE.esp32, MODULE.oled, MODULE.encoder, MODULE.piezo], settings: 'behavior "Session length" = "<1-180> min"', customFirmwareModules: Object.values(MODULE) },
  'light-lamp': { use: 'One LED that switches on below a brightness threshold read from an LDR divider.', modules: [MODULE.esp32, MODULE.ldr, MODULE.resistor, MODULE.led], settings: 'behavior "Switch on below" = "<0-100>% of the sensor range"' },
  'temp-monitor': { use: 'One temperature sensor (DS18B20 or BME280), optional screen, optional chime, optional alert threshold.', modules: [MODULE.esp32, MODULE.oled, MODULE.bme280, MODULE.ds18b20, MODULE.resistor, MODULE.piezo], settings: 'behavior "Alert above" or "Alert below" = "<-55..125> °C"; behavior "Sensor" is descriptive' },
};

const LIMITS = { parts: 12, nets: 30, endpoints: 16, notes: 10, behavior: 8, text: 400 };

/** Runs every existing validator. Empty means codegen and firmware generation both accept the design. */
export function validateDesign(value: unknown, options: { customFirmware?: boolean } = {}): string[] {
  const graph = checkDesign(value);
  if (graph.length) return graph.map(i => i.message);
  const design = value as CircuitDesign;
  const issues: string[] = [];
  if (design.parts.length > LIMITS.parts) issues.push(`A carrier board holds at most ${LIMITS.parts} parts.`);
  if (design.nets.length > LIMITS.nets) issues.push(`At most ${LIMITS.nets} nets.`);
  if (design.nets.some(n => n.endpoints.length > LIMITS.endpoints)) issues.push(`A net connects at most ${LIMITS.endpoints} pins.`);
  if (design.notes.length > LIMITS.notes || design.behavior.length > LIMITS.behavior) issues.push('Too many notes or behavior entries.');
  const words = [design.title, ...design.parts.flatMap(p => [p.role, p.value ?? '']), ...design.nets.map(n => n.why), ...design.notes.map(n => n.text), ...design.behavior.flatMap(b => [b.label, b.value])];
  if (words.some(w => w.length > LIMITS.text)) issues.push(`Text fields are limited to ${LIMITS.text} characters.`);
  if (words.some(claimsPhysicalProof)) issues.push('Design text may not claim the device was printed, flashed or works.');
  if (design.requirements !== undefined) issues.push(...requirementIssues(design.requirements, REQUIREMENT_METRICS));
  const app = design.app;
  const custom = options.customFirmware === true || app !== undefined;
  const family = FIRMWARE_FAMILIES[design.template];
  const allowed = custom ? family.customFirmwareModules ?? family.modules : family.modules;
  for (const part of design.parts) {
    if (allowed.includes(part.module)) continue;
    // Custom firmware can drive anything, but the carrier layout still has places for this family's parts only.
    issues.push(custom ? `The ${design.template} board layout has no place for ${part.module} (${part.id}). Use the focus-timer template: with custom firmware, its board takes any catalog module.` : `The ${design.template} firmware doesn't drive ${part.module} (${part.id}), so it would sit on the board doing nothing.`);
  }
  if (issues.length) return issues;
  if (custom) {
    try {
      const target = appTarget(design);
      if (app !== undefined) {
        if (typeof app !== 'object' || app === null || typeof app.brief !== 'string' || app.brief.length > 2000) issues.push('app needs its source and brief as text.');
        else issues.push(...checkAppSource(app.source, target.headers));
      }
    } catch (error) { issues.push(`Firmware pins: ${error instanceof Error ? error.message : String(error)}`); }
  } else {
    try { firmwareProject(design); } catch (error) { issues.push(`Firmware generator: ${error instanceof Error ? error.message : String(error)}`); }
  }
  try { generateBoardSource(design); } catch (error) { issues.push(`Board generator: ${error instanceof Error ? error.message : String(error)}`); }
  return issues;
}

export function catalogListing() {
  return {
    modules: [...CATALOG.values()].map(m => ({ id: m.id, name: m.name, category: m.category, requiredPins: m.pins.filter(p => p.required).map(p => p.id), notes: m.notes })),
    firmwareFamilies: FIRMWARE_FAMILIES,
    limits: 'USB 5 V and 3.3 V logic only. No mains, no batteries. Anything not listed here cannot be built yet.',
  };
}

export function moduleDetail(id: unknown) {
  const m = typeof id === 'string' ? CATALOG.get(id) : undefined;
  if (!m) return null;
  return {
    id: m.id, name: m.name, category: m.category, sizeMm: m.size, supply: m.supply, provides: m.provides, notes: m.notes,
    pins: m.pins.map(p => ({ id: p.id, kind: p.kind, required: p.required, ...(p.need ? { need: p.need } : {}), ...(p.needsPullup ? { needsPullup: true } : {}), ...(p.gpio ? { input: p.gpio.input, output: p.gpio.output, adc1: p.gpio.adc1, pullup: p.gpio.pullup, ...(p.gpio.reserved ? { reserved: p.gpio.reserved } : {}) } : {}), ...(p.note ? { note: p.note } : {}) })),
  };
}

const design: Record<string, unknown> = {
  type: 'object',
  description: 'A complete moki.circuit-preview/1 design graph.',
  properties: {
    schema: { type: 'string', enum: ['moki.circuit-preview/1'] },
    template: { type: 'string', enum: ['focus-timer', 'light-lamp', 'temp-monitor'], description: 'The firmware family this design runs. With custom firmware it only chooses the board layout, and focus-timer takes any catalog module.' },
    title: { type: 'string' },
    parts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, module: { type: 'string' }, role: { type: 'string' }, value: { type: 'string' } }, required: ['id', 'module', 'role'] } },
    nets: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: ['power', 'ground', 'signal'] }, volts: { type: 'number' }, analog: { type: 'boolean' }, why: { type: 'string' }, endpoints: { type: 'array', items: { type: 'object', properties: { part: { type: 'string' }, pin: { type: 'string' } }, required: ['part', 'pin'] } } }, required: ['id', 'name', 'kind', 'why', 'endpoints'] } },
    notes: { type: 'array', items: { type: 'object', properties: { level: { type: 'string', enum: ['warning', 'info'] }, text: { type: 'string' }, part: { type: 'string' }, net: { type: 'string' } }, required: ['level', 'text'] } },
    behavior: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } },
  },
  required: ['schema', 'template', 'title', 'parts', 'nets', 'notes', 'behavior'],
};

const ops: Record<string, unknown> = {
  type: 'array',
  description: 'Graph changes, applied in order: set_pin {net, gpio}; set_behavior {label, value}; remove_behavior {label}; add_part {id, module, role, value?}; remove_part {id}; connect {net, endpoints:[{part,pin}], kind?, why?, analog?} (kind is required for a new net); disconnect {net, part, pin}.; rename_net {net, name}; set_value {part, value}; add_note {text, part?, net?}; remove_note {text}',
  items: { type: 'object', properties: { op: { type: 'string', enum: ['set_pin', 'set_behavior', 'remove_behavior', 'add_part', 'remove_part', 'connect', 'disconnect', 'rename_net', 'set_value', 'add_note', 'remove_note'] } }, required: ['op'] },
};

const edits: Record<string, unknown> = {
  type: 'object',
  description: 'Layout changes for the job API. x and y are the part centre in mm from the board centre, X right, Y up. rotation is the absolute angle in degrees, counter-clockwise.',
  properties: {
    placements: { type: 'array', items: { type: 'object', properties: { refdes: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' } }, required: ['refdes', 'x', 'y'] } },
    board: { type: 'object', properties: { widthMm: { type: 'number' }, heightMm: { type: 'number' }, cornerRadiusMm: { type: 'number' } }, required: ['widthMm', 'heightMm'] },
    usbEdge: { type: 'string', enum: ['left', 'right', 'top', 'bottom'] },
  },
};

const noInput = { type: 'object', properties: {} };

export const TOOLS = {
  list_catalog: { name: 'list_catalog', description: 'List every module that can be built with, and the firmware families. Nothing else exists.', schema: noInput },
  get_module: { name: 'get_module', description: 'Full pin list for one catalog module.', schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  validate_design: { name: 'validate_design', description: 'Run every validator on a draft design and return its issues. Does not build anything.', schema: { type: 'object', properties: { design }, required: ['design'] } },
  propose_design: { name: 'propose_design', description: 'Submit the finished design. It is validated; if valid it goes to the build pipeline and the turn ends. If not, you get the issues back.', schema: { type: 'object', properties: { design, summary: { type: 'string', description: 'One plain sentence: what this is, in the maker\'s words.' }, custom_firmware: { type: 'string', description: 'Only when no fixed program does what was asked. A precise description of the behaviour, for the Firmware agent. Leave it out otherwise.' } }, required: ['design', 'summary'] } },
  decline: { name: 'decline', description: 'Say this request cannot be built from the catalog, and name the closest thing that can.', schema: { type: 'object', properties: { message: { type: 'string', description: 'Plain words: what is missing.' }, closest: { type: 'string', description: 'The closest buildable thing, as a sentence.' }, closest_brief: { type: 'string', description: 'A brief for that closest thing the maker could send as it is.' }, no_code_needed: { type: 'boolean', description: 'True if the idea needs no microcontroller at all. message then says why, in one plain sentence.' } }, required: ['message', 'closest', 'closest_brief'] } },
  get_design: { name: 'get_design', description: 'The current design graph.', schema: noInput },
  read_job: { name: 'read_job', description: 'Facts from the build record: stages, DRC, board size, compile result, case checks and logs when something failed.', schema: { type: 'object', properties: { job_id: { type: 'string', description: 'Omit for the current build.' } } } },
  propose_edit: { name: 'propose_edit', description: 'Apply a change. Use ops for wiring, parts, pins and settings; edits for layout (board size, part placement, USB edge). It is validated and a new build starts, or you get the issues back.', schema: { type: 'object', properties: { summary: { type: 'string' }, ops, edits }, required: ['summary'] } },
  start_new: { name: 'start_new', description: 'The request is a different device, not a change to this one. Hand it to the designer.', schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  change_requirements: { name: 'change_requirements', description: 'The maker wants to change what the device must meet, such as a battery life or a size. They confirm the new list before anything is rebuilt.', schema: { type: 'object', properties: { request: { type: 'string' }, summary: { type: 'string' } }, required: ['request', 'summary'] } },
  change_firmware: { name: 'change_firmware', description: 'Change what the device does without changing its parts or board. The Firmware agent rewrites the program and a new build starts.', schema: { type: 'object', properties: { request: { type: 'string', description: 'The behaviour wanted, precisely.' }, summary: { type: 'string' } }, required: ['request', 'summary'] } },
  propose_fix: { name: 'propose_fix', description: 'Propose one bounded change for the failed build: board size, part placement, USB edge (edits) or pin choice (ops with set_pin only). A new build starts with it.', schema: { type: 'object', properties: { reason: { type: 'string', description: 'What failed and why this should fix it, citing the record.' }, ops, edits }, required: ['reason'] } },
  give_up: { name: 'give_up', description: 'No bounded change can fix this. Say why, from the record.', schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
} satisfies Record<string, ToolDef>;
