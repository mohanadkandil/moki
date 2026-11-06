// Bounded changes. Agents describe a change as data; this code applies it to a copy and the existing
// validators decide. No agent writes TSX, firmware or anything else that executes.
import { ASSIGNABLE_GPIO, CATALOG } from '../circuit/catalog.js';
import type { BoardPlan } from '../blocks/contract.js';
import type { CircuitDesign, NetKind, PartInstance, PinRef } from '../circuit/model.js';
import type { BoardEdits, UsbEdge } from './protocol.js';

export type DesignOp =
  | { op: 'set_pin'; net: string; gpio: number }
  | { op: 'set_behavior'; label: string; value: string }
  | { op: 'remove_behavior'; label: string }
  | { op: 'add_part'; id: string; module: string; role: string; value?: string }
  | { op: 'remove_part'; id: string }
  | { op: 'connect'; net: string; endpoints: PinRef[]; kind?: NetKind; why?: string; analog?: boolean }
  | { op: 'disconnect'; net: string; part: string; pin: string }
  | { op: 'rename_net'; net: string; name: string }
  | { op: 'set_value'; part: string; value: string }
  | { op: 'add_note'; text: string; part?: string; net?: string; section?: string }
  | { op: 'remove_note'; text: string }
  | { op: 'add_block'; inst: string; block: string; version?: number; params?: Record<string, number | string>; section?: string }
  | { op: 'remove_block'; inst: string }
  | { op: 'link'; from: string; to: string }
  | { op: 'unlink'; from: string; to: string };

/** What one agent change may hold. A person's draft on the canvas can be longer, so its caller passes its own cap. */
export const MAX_OPS = 12;
export const MAX_DRAFT_OPS = 64;
const NET_NAME = /^[A-Za-z0-9_+./-]{1,40}$/;
const INST = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const ENDPOINT = /^[A-Za-z_][A-Za-z0-9_-]{0,39}\.[A-Za-z0-9_+.-]{1,40}$/;
const ADC_ONLY = [34, 35, 36, 39];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isPinRef = (v: unknown): v is PinRef => isRecord(v) && text(v.part, 20) && text(v.pin, 20);

/** Parses untrusted tool input into operations, or says what's wrong with it. */
export function parseOps(value: unknown, max = MAX_OPS): { ops: DesignOp[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'ops must be an array.' };
  if (value.length > max) return { error: `At most ${max} operations in one change.` };
  const ops: DesignOp[] = [];
  for (const [i, op] of value.entries()) {
    const bad = (why: string) => ({ error: `ops[${i}]: ${why}` });
    if (!isRecord(op)) return bad('not an object.');
    switch (op.op) {
      case 'set_pin':
        if (!text(op.net, 40) || !Number.isInteger(op.gpio)) return bad('set_pin needs net and an integer gpio.');
        ops.push({ op: 'set_pin', net: op.net, gpio: op.gpio as number }); break;
      case 'set_behavior':
        if (!text(op.label, 60) || !text(op.value, 120)) return bad('set_behavior needs label and value.');
        ops.push({ op: 'set_behavior', label: op.label, value: op.value }); break;
      case 'remove_behavior':
        if (!text(op.label, 60)) return bad('remove_behavior needs label.');
        ops.push({ op: 'remove_behavior', label: op.label }); break;
      case 'add_part':
        if (!text(op.id, 20) || !text(op.module, 60) || !text(op.role)) return bad('add_part needs id, module and role.');
        if (op.value !== undefined && !text(op.value, 40)) return bad('value must be short text.');
        ops.push({ op: 'add_part', id: op.id, module: op.module, role: op.role, ...(op.value ? { value: op.value as string } : {}) }); break;
      case 'remove_part':
        if (!text(op.id, 20)) return bad('remove_part needs id.');
        ops.push({ op: 'remove_part', id: op.id }); break;
      case 'connect':
        if (!text(op.net, 40) || !Array.isArray(op.endpoints) || !op.endpoints.length || !op.endpoints.every(isPinRef)) return bad('connect needs net and endpoints [{part, pin}].');
        if (op.kind !== undefined && !['power', 'ground', 'signal'].includes(String(op.kind))) return bad('kind must be power, ground or signal.');
        ops.push({ op: 'connect', net: op.net, endpoints: op.endpoints as PinRef[], ...(op.kind ? { kind: op.kind as NetKind } : {}), ...(text(op.why) ? { why: op.why } : {}), ...(op.analog === true ? { analog: true } : {}) }); break;
      case 'disconnect':
        if (!text(op.net, 40) || !text(op.part, 20) || !text(op.pin, 20)) return bad('disconnect needs net, part and pin.');
        ops.push({ op: 'disconnect', net: op.net, part: op.part, pin: op.pin }); break;
      case 'rename_net':
        if (!text(op.net, 40) || !text(op.name, 40) || !NET_NAME.test(op.name)) return bad('rename_net needs net and a name of letters, digits and + - _ . /.');
        ops.push({ op: 'rename_net', net: op.net, name: op.name }); break;
      case 'set_value':
        if (!text(op.part, 80) || !text(op.value, 40)) return bad('set_value needs part and a short value.');
        ops.push({ op: 'set_value', part: op.part, value: op.value }); break;
      case 'add_note':
        if (!text(op.text, 240)) return bad('add_note needs short text.');
        for (const key of ['part', 'net', 'section'] as const) if (op[key] !== undefined && !text(op[key], 40)) return bad(`${key} must be short text.`);
        ops.push({ op: 'add_note', text: op.text, ...(op.part ? { part: op.part as string } : {}), ...(op.net ? { net: op.net as string } : {}), ...(op.section ? { section: op.section as string } : {}) }); break;
      case 'remove_note':
        if (!text(op.text, 240)) return bad('remove_note needs the note\'s text.');
        ops.push({ op: 'remove_note', text: op.text }); break;
      case 'add_block':
        if (typeof op.inst !== 'string' || !INST.test(op.inst) || !text(op.block, 80)) return bad('add_block needs inst and block.');
        if (op.version !== undefined && !Number.isInteger(op.version)) return bad('version must be a whole number.');
        if (op.params !== undefined && (!isRecord(op.params) || !Object.values(op.params).every(v => typeof v === 'string' || typeof v === 'number'))) return bad('params must be names and values.');
        if (op.section !== undefined && !text(op.section, 40)) return bad('section must be short text.');
        ops.push({ op: 'add_block', inst: op.inst, block: op.block, ...(op.version !== undefined ? { version: op.version as number } : {}), ...(op.params ? { params: op.params as Record<string, number | string> } : {}), ...(op.section ? { section: op.section as string } : {}) }); break;
      case 'remove_block':
        if (typeof op.inst !== 'string' || !INST.test(op.inst)) return bad('remove_block needs inst.');
        ops.push({ op: 'remove_block', inst: op.inst }); break;
      case 'link':
      case 'unlink':
        if (typeof op.from !== 'string' || typeof op.to !== 'string' || !ENDPOINT.test(op.from) || !ENDPOINT.test(op.to)) return bad(`${op.op} joins inst.PORT to inst.PORT.`);
        ops.push({ op: op.op, from: op.from, to: op.to }); break;
      default:
        return bad(`unknown op ${String(op.op).slice(0, 30)}.`);
    }
  }
  return { ops };
}

/** Applies to a deep copy. The caller still runs the validators on the result. */
export function applyDesignOps(design: CircuitDesign, ops: DesignOp[]): { design: CircuitDesign } | { error: string } {
  const next = structuredClone(design);
  const netOf = (id: string) => next.nets.find(n => n.id === id || n.name === id);
  for (const op of ops) {
    switch (op.op) {
      case 'set_pin': {
        const net = netOf(op.net);
        if (!net) return { error: `There is no net ${op.net}.` };
        const allowed = net.analog ? [...ASSIGNABLE_GPIO, ...ADC_ONLY] : ASSIGNABLE_GPIO;
        if (!allowed.includes(op.gpio)) return { error: `GPIO${op.gpio} can't be chosen for ${net.name}. Use one of ${allowed.join(', ')}.` };
        const mcu = next.parts.find(p => CATALOG.get(p.module)?.category === 'controller')?.id;
        const end = net.endpoints.find(e => e.part === mcu && e.pin.startsWith('GPIO'));
        if (!end) return { error: `${net.name} has no controller GPIO to move.` };
        end.pin = `GPIO${op.gpio}`;
        break;
      }
      case 'set_behavior': {
        const existing = next.behavior.find(b => b.label === op.label);
        if (existing) existing.value = op.value; else next.behavior.push({ label: op.label, value: op.value });
        break;
      }
      case 'remove_behavior':
        next.behavior = next.behavior.filter(b => b.label !== op.label);
        break;
      case 'add_part': {
        if (next.parts.some(p => p.id === op.id)) return { error: `Part ${op.id} already exists.` };
        const part: PartInstance = { id: op.id, module: op.module, role: op.role, ...(op.value ? { value: op.value } : {}) };
        next.parts.push(part);
        break;
      }
      case 'remove_part':
        if (!next.parts.some(p => p.id === op.id)) return { error: `There is no part ${op.id}.` };
        next.parts = next.parts.filter(p => p.id !== op.id);
        for (const net of next.nets) net.endpoints = net.endpoints.filter(e => e.part !== op.id);
        next.nets = next.nets.filter(n => n.endpoints.length >= 2);
        next.notes = next.notes.filter(n => n.part !== op.id);
        break;
      case 'connect': {
        const net = netOf(op.net);
        if (net) { net.endpoints.push(...op.endpoints); break; }
        if (!op.kind) return { error: `Net ${op.net} doesn't exist yet, so connect needs its kind.` };
        next.nets.push({ id: op.net, name: op.net, kind: op.kind, endpoints: [...op.endpoints], why: op.why ?? 'Added by a change request.', ...(op.analog ? { analog: true } : {}) });
        break;
      }
      case 'disconnect': {
        const net = netOf(op.net);
        if (!net) return { error: `There is no net ${op.net}.` };
        const before = net.endpoints.length;
        net.endpoints = net.endpoints.filter(e => !(e.part === op.part && e.pin === op.pin));
        if (net.endpoints.length === before) return { error: `${op.part}.${op.pin} is not on ${net.name}.` };
        break;
      }
      case 'rename_net': {
        const net = netOf(op.net);
        if (!net) return { error: `There is no net ${op.net}.` };
        if (next.nets.some(n => n !== net && (n.name === op.name || n.id === op.name))) return { error: `There is already a net called ${op.name}.` };
        net.name = op.name;
        break;
      }
      case 'set_value': {
        const part = next.parts.find(p => p.id === op.part);
        if (!part) return { error: `There is no part ${op.part}.` };
        part.value = op.value;
        break;
      }
      case 'add_note': {
        if (op.part && !next.parts.some(p => p.id === op.part)) return { error: `There is no part ${op.part}.` };
        if (op.net && !netOf(op.net)) return { error: `There is no net ${op.net}.` };
        if (next.notes.some(n => n.text === op.text)) return { error: 'That note is already there.' };
        next.notes.push({ level: 'info', text: op.text, ...(op.part ? { part: op.part } : {}), ...(op.net ? { net: op.net } : {}) });
        break;
      }
      case 'remove_note': {
        const before = next.notes.length;
        next.notes = next.notes.filter(n => n.text !== op.text);
        if (next.notes.length === before) return { error: 'There is no note with those words.' };
        break;
      }
      case 'add_block': case 'remove_block': case 'link': case 'unlink':
        return { error: 'This board is built from modules, so it has no blocks to change.' };
    }
  }
  return { design: next };
}

/** The same operations on a chip-level plan. Each refusal is one sentence a maker can read. The plan's checks still run after this. */
export function applyPlanOps(plan: BoardPlan, ops: DesignOp[]): { plan: BoardPlan } | { error: string } {
  const next = structuredClone(plan);
  for (const op of ops) {
    switch (op.op) {
      case 'add_block': {
        if (next.blocks.some(b => b.inst === op.inst)) return { error: `There is already a block called ${op.inst}.` };
        next.blocks.push({ inst: op.inst, block: op.block, version: op.version ?? 1, params: op.params ?? {} });
        const section = op.section ? next.sections?.find(s => s.id === op.section) : undefined;
        if (op.section && !section) return { error: `There is no section ${op.section}.` };
        if (section) section.insts.push(op.inst);
        else next.sections?.push({ id: op.inst, title: op.block, purpose: 'Added by hand.', insts: [op.inst], notes: ['Added by hand.'] });
        break;
      }
      case 'remove_block': {
        if (!next.blocks.some(b => b.inst === op.inst)) return { error: `There is no block ${op.inst}.` };
        const owns = (end: string) => end.startsWith(`${op.inst}.`);
        next.blocks = next.blocks.filter(b => b.inst !== op.inst);
        next.links = next.links.filter(l => !owns(l.from) && !owns(l.to));
        if (next.netNames) {
          next.netNames = Object.fromEntries(Object.entries(next.netNames).filter(([port]) => !owns(port)));
          if (!Object.keys(next.netNames).length) delete next.netNames;
        }
        if (next.sections) next.sections = next.sections.map(s => ({ ...s, insts: s.insts.filter(i => i !== op.inst) })).filter(s => s.insts.length);
        break;
      }
      case 'link': {
        const same = (l: { from: string; to: string }) => (l.from === op.from && l.to === op.to) || (l.from === op.to && l.to === op.from);
        if (next.links.some(same)) return { error: `${op.from} and ${op.to} are already linked.` };
        next.links.push({ from: op.from, to: op.to });
        break;
      }
      case 'unlink': {
        const before = next.links.length;
        next.links = next.links.filter(l => !((l.from === op.from && l.to === op.to) || (l.from === op.to && l.to === op.from)));
        if (next.links.length === before) return { error: `${op.from} and ${op.to} aren't linked.` };
        break;
      }
      case 'set_value': {
        const [inst, param] = op.part.split('.');
        const block = next.blocks.find(b => b.inst === inst);
        if (!block || !param) return { error: `${op.part} has no value to set here. A block's values are set as block.param.` };
        const number = Number(op.value);
        block.params[param] = op.value.trim() !== '' && Number.isFinite(number) ? number : op.value;
        break;
      }
      case 'add_note': {
        const section = next.sections?.find(s => s.id === op.section || (op.part !== undefined && s.insts.includes(op.part)));
        if (!section) return { error: 'Say which section this note belongs to.' };
        section.notes.push(op.text);
        break;
      }
      case 'remove_note': {
        const section = next.sections?.find(s => s.notes.includes(op.text));
        if (!section) return { error: 'There is no note with those words.' };
        section.notes = section.notes.filter(n => n !== op.text);
        break;
      }
      case 'add_part': return { error: 'This board is built from blocks. Add a block.' };
      case 'remove_part': return { error: `${op.id} belongs to a block on this board. Remove the block, or change its values.` };
      case 'connect': case 'disconnect': return { error: 'This board joins blocks by their ports. Link them instead.' };
      case 'rename_net': {
        // `net` is a port on the net here. plan-edit.ts finds it from the name a person sees.
        if (!ENDPOINT.test(op.net)) return { error: 'Net names on this board come from its blocks.' };
        next.netNames = { ...next.netNames, [op.net]: op.name };
        break;
      }
      case 'set_pin': return { error: 'Choose a pin by linking to a different MCU port.' };
      case 'set_behavior': case 'remove_behavior': return { error: 'This board has no behaviour settings. Ask for a firmware change.' };
    }
  }
  return { plan: next };
}

const EDGES: readonly UsbEdge[] = ['left', 'right', 'top', 'bottom'];
/** The same size range the job API enforces, so a model hears about it before a request is sent. */
export const BOARD_LIMITS = { minMm: 20, maxMm: 300, maxPlacements: 12 } as const;

/** Sanity bounds only. The job API owns the real checks (overlap, USB at an edge) and rejects with its own message. */
export function parseBoardEdits(value: unknown, design?: CircuitDesign): { edits: BoardEdits } | { error: string } {
  if (!isRecord(value)) return { error: 'edits must be an object.' };
  const edits: BoardEdits = {};
  if (value.board !== undefined) {
    const b = value.board;
    if (!isRecord(b) || typeof b.widthMm !== 'number' || typeof b.heightMm !== 'number') return { error: 'board needs widthMm and heightMm.' };
    for (const size of [b.widthMm, b.heightMm]) if (!(size >= BOARD_LIMITS.minMm && size <= BOARD_LIMITS.maxMm)) return { error: `Board sides must be ${BOARD_LIMITS.minMm}–${BOARD_LIMITS.maxMm} mm.` };
    if (b.cornerRadiusMm !== undefined && !(typeof b.cornerRadiusMm === 'number' && b.cornerRadiusMm >= 0 && b.cornerRadiusMm <= Math.min(b.widthMm, b.heightMm) / 2)) return { error: 'Corner radius must be between zero and half the smaller side.' };
    edits.board = { widthMm: b.widthMm, heightMm: b.heightMm, ...(typeof b.cornerRadiusMm === 'number' ? { cornerRadiusMm: b.cornerRadiusMm } : {}) };
  }
  if (value.usbEdge !== undefined) {
    if (!EDGES.includes(value.usbEdge as UsbEdge)) return { error: 'usbEdge must be left, right, top or bottom.' };
    edits.usbEdge = value.usbEdge as UsbEdge;
  }
  if (value.placements !== undefined) {
    if (!Array.isArray(value.placements) || value.placements.length > BOARD_LIMITS.maxPlacements) return { error: `placements must be a list of at most ${BOARD_LIMITS.maxPlacements}.` };
    edits.placements = [];
    for (const p of value.placements) {
      if (!isRecord(p) || !text(p.refdes, 20) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { error: 'Each placement needs refdes, x and y in mm.' };
      const rotation = p.rotation === undefined ? 0 : p.rotation;
      if (typeof rotation !== 'number' || !Number.isFinite(rotation) || Math.abs(rotation) > 360) return { error: 'rotation must be in degrees, within ±360.' };
      if (design && !design.parts.some(part => part.id === p.refdes)) return { error: `There is no part ${p.refdes}.` };
      edits.placements.push({ refdes: p.refdes, x: p.x as number, y: p.y as number, rotation });
    }
  }
  if (!edits.board && !edits.usbEdge && !edits.placements?.length) return { error: 'edits changes nothing.' };
  return { edits };
}

/** Generated boards use this radius (see src/board/codegen.ts), and the job API requires one on every board edit. */
export const DEFAULT_CORNER_RADIUS_MM = 3;

/** Later edits win per field and per part, because each job carries its whole layout. */
export function mergeEdits(base: BoardEdits | undefined, next: BoardEdits): BoardEdits {
  const placements = new Map((base?.placements ?? []).map(p => [p.refdes, p]));
  for (const p of next.placements ?? []) placements.set(p.refdes, p);
  const merged: BoardEdits = { ...base, ...next, ...(placements.size ? { placements: [...placements.values()] } : {}) };
  if (merged.board) merged.board = { ...merged.board, cornerRadiusMm: next.board?.cornerRadiusMm ?? base?.board?.cornerRadiusMm ?? DEFAULT_CORNER_RADIUS_MM };
  return merged;
}

export function describeEdits(edits: BoardEdits): string[] {
  const lines: string[] = [];
  if (edits.board) lines.push(`Board ${edits.board.widthMm} × ${edits.board.heightMm} mm${edits.board.cornerRadiusMm !== undefined ? `, ${edits.board.cornerRadiusMm} mm corners` : ''}`);
  if (edits.usbEdge) lines.push(`USB on the ${edits.usbEdge} edge`);
  for (const p of edits.placements ?? []) lines.push(`${p.refdes} placed at ${p.x}, ${p.y} mm${p.rotation ? `, rotated ${p.rotation}°` : ''}`);
  return lines;
}
