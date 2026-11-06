import { moduleDef } from '../circuit/catalog.js';
import { MODULE_MECH } from '../../eda/enclosure/module-mech.js';
import { footprintFor } from './catalog-footprints.js';

// Packs a carrier's modules and passives tightly, then trims the board to them. Pure and deterministic: no randomness,
// and every tie breaks on position, then on part order by id. Net order doesn't count. Parts keep their catalog orientation, so the screen, knob
// and every other lid opening stay on the front face, and the USB stays on the bottom edge.

export interface PlacedPart { id: string; module: string; value?: string }
export interface PlacedNet { kind: string; endpoints: ReadonlyArray<{ part: string; pin: string }> }
interface Box { left: number; right: number; bottom: number; top: number }

/** Clear space between two parts. Module outlines are catalog estimates, up to about 1 mm out, and they have to go in by hand. */
const GAP_MM = 1.5;
/** A part to the board edge. The lid's lip takes up 1.6 mm inside the edge, and it can't pass a tall part. */
const EDGE_MM = 2;
const HOLE_INSET_MM = 4;
/** Lid pillar radius (3 mm) plus the case's fit clearance (0.3 mm), from the middle of an M3 hole. */
const PILLAR_KEEP_MM = 3.3;
/** The screen's viewing funnel passes the module's sides by this much at the lid, at its widest angle. */
const WELL_SIDE_MM = 3.5;
/** At the lid, the funnel has to clear a neighbour's opening plus this much on every side, and it reaches 2.8 mm past the module. */
const LID_HOLE_MARGIN_MM = 1;
const FUNNEL_REACH_MM = 2.8;
/** Temperature sensors stay as far from the ESP32 as the old layout kept them: closeness would make them read warm. */
const WARM_GAP_MM = 6;
/** The lamp's LED and its light sensor both sit under the lid. Next to each other, the LED would turn itself off. */
const LIGHT_GAP_MM = 15;
/** Orderings are tried in full for this many of the largest parts. Smaller ones go in the gaps those leave. A crowded board gets fewer: this runs on the server's main thread. */
const SEARCHED_PARTS = 4;
const SEARCHED_PARTS_CROWDED = 3;
const CROWDED_FROM = 8;
const HEIGHT_STEP_MM = 5;
/** How much area a long, thin board has to save to win: 15% per unit of length-to-width beyond square. It has to fit a hand and a shelf. */
const LONG_PENALTY = 0.15;
/** A millimetre of wire counts as this many mm² of board: 80 mm less wire is worth 1 mm off an 80 mm side. Short wires are what keep a tight board routable. */
const WIRE_WEIGHT = 1;

const isThermal = (module: string) => module === 'ds18b20-to92' || module === 'bme280-i2c-4pin';
const isDisplay = (module: string) => moduleDef(module).category === 'display';

/** Where the part's body really stands, about the catalog outline's centre. A leaded part's outline is a wiring sketch with long legs: its body centres on its pads. */
export function drawnBody(module: string): { x: number; y: number; w: number; h: number } {
  const def = moduleDef(module); const mech = MODULE_MECH[module]; const pins = footprintFor(module).pins;
  // A TO-92 keeps its catalog outline: its silkscreen marks the package's flat face inside it.
  if (!mech?.bodyMm || def.drawing === 'to92') return { x: 0, y: 0, w: def.size.w, h: def.size.h };
  return { x: pins.reduce((s, p) => s + p.x, 0) / pins.length, y: pins.reduce((s, p) => s + p.y, 0) / pins.length, w: mech.bodyMm.w, h: mech.bodyMm.h };
}

export const REFERENCE_ABOVE_MM = 1.5;
export const referenceText = (part: PlacedPart) => `${part.id}${part.value ? ` ${part.value}` : ''}`;

/** Everything of a part that needs its own room: its body, what stands on it, its pads and its silkscreen. Excludes the USB plug, which hangs over the edge. */
function extent(part: PlacedPart): Box {
  const def = moduleDef(part.module); const mech = MODULE_MECH[part.module]; const pins = footprintFor(part.module).pins;
  const body = drawnBody(part.module);
  const box: Box = { left: body.x - body.w / 2, right: body.x + body.w / 2, bottom: body.y - body.h / 2, top: body.y + body.h / 2 };
  const grow = (left: number, right: number, bottom: number, top: number) => { box.left = Math.min(box.left, left); box.right = Math.max(box.right, right); box.bottom = Math.min(box.bottom, bottom); box.top = Math.max(box.top, top); };
  if (mech) {
    const pads = { x: pins.reduce((s, p) => s + p.x, 0) / pins.length, y: pins.reduce((s, p) => s + p.y, 0) / pins.length };
    if (mech.bodyMm) grow(pads.x - mech.bodyMm.w / 2, pads.x + mech.bodyMm.w / 2, pads.y - mech.bodyMm.h / 2, pads.y + mech.bodyMm.h / 2);
    const top = mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm;
    for (const b of mech.blocks(def.size.w, def.size.h, top)) {
      if (b.label === 'micro-usb') continue;
      const x = mech.bodyMm ? pads.x + b.x : b.x - def.size.w / 2; const y = mech.bodyMm ? pads.y - b.y : def.size.h / 2 - b.y;
      grow(x - b.w / 2, x + b.w / 2, y - b.h / 2, y + b.h / 2);
    }
  }
  for (const pin of pins) {
    grow(pin.x - pin.outerDiameter / 2, pin.x + pin.outerDiameter / 2, pin.y - pin.outerDiameter / 2, pin.y + pin.outerDiameter / 2);
    // Pin names print below a pad whose lead leaves downward, and a power pin adds its + below that.
    const physical = def.pins[pin.number - 1]!.physical;
    if (physical.dir === 'down') grow(pin.x, pin.x, pin.y - (['VCC', 'VIN', 'VDD', '3V3', '5V'].includes(pin.id) ? 3.1 : 2), pin.y);
  }
  // A TO-92's flat-face mark and its catalog outline.
  if (def.drawing === 'to92') grow(-2.2, 2.2, -def.size.h / 2, 6);
  // Its reference above the body.
  const halfText = referenceText(part).length * 0.25;
  grow(body.x - halfText, body.x + halfText, body.y + body.h / 2, body.y + body.h / 2 + REFERENCE_ABOVE_MM + 0.4);
  return box;
}

interface Item { part: PlacedPart; w: number; h: number; /** The part's origin from this box's lower left. */ originX: number; originY: number; side: number; /** How far from this part's side a screen's funnel has to stop, for its lid opening. */ funnelStop: number; controller: boolean }
type Rect = Item & { x: number; y: number };

function itemFor(part: PlacedPart): Item {
  const e = extent(part);
  const def = moduleDef(part.module); const mech = MODULE_MECH[part.module];
  const top = mech ? mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm : 0;
  const bodyWidth = drawnBody(part.module).w;
  const funnelStop = Math.max(0, ...(mech?.apertures(def.size.w, def.size.h, top) ?? []).filter(a => a.surface === 'lid').map(a => FUNNEL_REACH_MM + (a.widthMm + 2 * LID_HOLE_MARGIN_MM - bodyWidth) / 2));
  return { part, w: e.right - e.left, h: e.top - e.bottom, originX: -e.left, originY: -e.bottom, side: isDisplay(part.module) ? WELL_SIDE_MM : 0, funnelStop, controller: moduleDef(part.module).category === 'controller' };
}

function pairGap(a: Item, b: Item): number {
  if ((a.controller && isThermal(b.part.module)) || (b.controller && isThermal(a.part.module))) return WARM_GAP_MM;
  const light = [a.part.module, b.part.module];
  if (light.includes('ldr-5mm') && light.some(m => moduleDef(m).drawing === 'led')) return LIGHT_GAP_MM;
  return GAP_MM;
}

/** Side to side, a screen needs room for its funnel, and the funnel can't reach a neighbour's lid opening. */
const sideGap = (a: Item, b: Item, pair: number) => Math.max(pair, a.side, b.side, a.side ? b.funnelStop : 0, b.side ? a.funnelStop : 0);

function clash(a: Rect, b: Rect): boolean {
  const pair = pairGap(a, b);
  const gapX = sideGap(a, b, pair);
  return a.x < b.x + b.w + gapX && b.x < a.x + a.w + gapX && a.y < b.y + b.h + pair && b.y < a.y + a.h + pair;
}

/** The screen stays above the knob, so a hand on the knob doesn't cover it. */
function handClear(rects: readonly Rect[]): boolean {
  const middle = (r: Rect) => r.y + r.h / 2;
  const screens = rects.filter(r => isDisplay(r.part.module));
  const knobs = rects.filter(r => moduleDef(r.part.module).category === 'input');
  return screens.every(s => knobs.every(k => middle(k) < middle(s)));
}

/** The smallest board around these parts, with an M3 hole clear of everything in each corner. Its bottom edge is fixed, at y = 0: the USB edge. */
function trim(rects: readonly Rect[]): Box {
  const out: Box = { left: Infinity, right: -Infinity, bottom: 0, top: -Infinity };
  for (const r of rects) {
    const edge = Math.max(EDGE_MM, r.side);
    out.left = Math.min(out.left, r.x - edge); out.right = Math.max(out.right, r.x + r.w + edge); out.top = Math.max(out.top, r.y + r.h + EDGE_MM);
  }
  const reach = HOLE_INSET_MM + PILLAR_KEEP_MM;
  for (let pass = 0, moved = true; moved && pass < 8; pass++) {
    moved = false;
    for (const r of rects) {
      const left = r.x - r.side; const right = r.x + r.w + r.side;
      const nearBottom = r.y < reach; const nearTop = r.y + r.h > out.top - reach;
      const grow = (side: 'left' | 'right', to: number, nearTopCorner: boolean) => {
        const sideway = Math.abs(to - out[side]) * (out.top - out.bottom);
        const upward = (r.y + r.h + reach - out.top) * (out.right - out.left);
        // Only the top corners can grow upward: the bottom edge is where the USB has to be.
        if (nearTopCorner && upward <= sideway) out.top = r.y + r.h + reach; else out[side] = to;
        moved = true;
      };
      if (left < out.left + reach && nearBottom) grow('left', left - reach, false);
      else if (left < out.left + reach && nearTop) grow('left', left - reach, true);
      if (right > out.right - reach && nearBottom) grow('right', right + reach, false);
      else if (right > out.right - reach && nearTop) grow('right', right + reach, true);
    }
  }
  return out;
}

const areaOf = (b: Box) => (b.right - b.left) * (b.top - b.bottom);

/** Each net that counts toward wire length, with its pads from their part's box. Ground goes by the pour, so it doesn't count. */
type WireNet = Array<{ part: string; x: number; y: number }>;
function wireNets(items: readonly Item[], nets: readonly PlacedNet[]): WireNet[] {
  const pads = new Map(items.map(i => [i.part.id, { item: i, pins: new Map(footprintFor(i.part.module).pins.map(p => [p.id, p])) }]));
  return nets.filter(n => n.kind !== 'ground').map(net => net.endpoints.flatMap(end => {
    const known = pads.get(end.part); const pad = known?.pins.get(end.pin);
    return known && pad ? [{ part: end.part, x: known.item.originX + pad.x, y: known.item.originY + pad.y }] : [];
  }));
}

/** Half-perimeter of each net across what's placed so far. */
function wireLength(rects: readonly Rect[], nets: readonly WireNet[]): number {
  let total = 0;
  for (const net of nets) {
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (const pad of net) {
      const rect = rects.find(r => r.part.id === pad.part);
      if (!rect) continue;
      const x = rect.x + pad.x, y = rect.y + pad.y;
      if (x < left) left = x; if (x > right) right = x; if (y < bottom) bottom = y; if (y > top) top = y;
    }
    if (right >= left) total += right - left + top - bottom;
  }
  return total;
}

/** Puts each part where the board stays smallest, under a height limit. Null when something won't fit under it. */
function packOrder(fixed: Rect | null, order: readonly Item[], maxTop: number, nets: readonly WireNet[]): Rect[] | null {
  const placed: Rect[] = fixed ? [fixed] : [];
  for (const item of order) {
    if (!placed.length) { placed.push({ ...item, x: 0, y: EDGE_MM }); continue; }
    const xs = new Set<number>(); const ys = new Set<number>([EDGE_MM, HOLE_INSET_MM + PILLAR_KEEP_MM]);
    for (const p of placed) {
      const pair = pairGap(item, p); const gapX = sideGap(item, p, pair);
      for (const x of [p.x - item.w - gapX, p.x + p.w + gapX, p.x, p.x + p.w - item.w]) xs.add(x);
      for (const y of [p.y - item.h - pair, p.y + p.h + pair, p.y, p.y + p.h - item.h]) if (y >= EDGE_MM) ys.add(y);
    }
    const checksHand = isDisplay(item.part.module) || moduleDef(item.part.module).category === 'input';
    const spanLeft = Math.min(...placed.map(p => p.x - p.side - EDGE_MM)); const spanRight = Math.max(...placed.map(p => p.x + p.w + p.side + EDGE_MM)); const spanTop = Math.max(...placed.map(p => p.y + p.h + EDGE_MM));
    let best: { rect: Rect; area: number } | null = null;
    for (const y of [...ys].sort((a, b) => a - b)) for (const x of [...xs].sort((a, b) => a - b)) {
      if (y + item.h + EDGE_MM > maxTop) continue;
      const rect: Rect = { ...item, x, y };
      // The board can't be smaller than the parts' own span: most positions lose on that alone, before the work of trimming.
      if (best && (Math.max(spanRight, x + item.w + item.side + EDGE_MM) - Math.min(spanLeft, x - item.side - EDGE_MM)) * Math.max(spanTop, y + item.h + EDGE_MM) >= best.area) continue;
      if (placed.some(p => clash(rect, p))) continue;
      const all = [...placed, rect];
      if (checksHand && !handClear(all)) continue;
      const box = trim(all);
      if (box.top > maxTop) continue;
      // Area alone can already lose. Wire length only ever adds to it.
      const boardArea = areaOf(box);
      if (best && boardArea >= best.area - 1e-6) continue;
      const area = boardArea + WIRE_WEIGHT * wireLength(all, nets);
      if (!best || area < best.area - 1e-6) best = { rect, area };
    }
    if (!best) return null;
    placed.push(best.rect);
  }
  return placed;
}

function orderings<T>(items: readonly T[]): T[][] {
  if (items.length < 2) return [[...items]];
  return items.flatMap((item, i) => orderings([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

export interface CompactBoard { widthMm: number; heightMm: number; at: Map<string, { x: number; y: number }> }

/** Positions are the catalog outline's centre, in a board frame with the origin at the board's centre. */
export function compactBoard(parts: readonly PlacedPart[], nets: readonly PlacedNet[] = []): CompactBoard {
  const key = JSON.stringify([
    [...parts].map(p => [p.id, p.module, p.value ?? '']).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    nets.map(n => [n.kind, [...n.endpoints].map(e => `${e.part}.${e.pin}`).sort()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
  const known = packed.get(key);
  if (known) return known;
  const board = packBoard(parts, nets);
  if (packed.size >= 64) packed.delete(packed.keys().next().value!);
  packed.set(key, board);
  return board;
}

/** The search takes about a tenth of a second, and a design's board is asked for several times on the way to a build. */
const packed = new Map<string, CompactBoard>();

function packBoard(parts: readonly PlacedPart[], nets: readonly PlacedNet[]): CompactBoard {
  const items = [...parts].sort((a, b) => a.id.localeCompare(b.id)).map(itemFor);
  const wires = wireNets(items, nets);
  const controller = items.find(i => i.controller) ?? null;
  // The controller's USB is on the bottom edge: the catalog outline's lower edge lands exactly on y = 0.
  const fixed: Rect | null = controller && { ...controller, x: 0, y: moduleDef(controller.part.module).size.h / 2 - controller.originY };
  const free = items.filter(i => i !== controller).sort((a, b) => b.w * b.h - a.w * a.h || a.part.id.localeCompare(b.part.id));
  const searchedCount = items.length >= CROWDED_FROM ? SEARCHED_PARTS_CROWDED : SEARCHED_PARTS;
  const searched = free.slice(0, searchedCount); const rest = free.slice(searchedCount);
  // A board is worth having small on both sides, not just in area: try each height limit, from barely above the tallest part to a stack of everything.
  const lowest = Math.max(...items.map(i => (i === controller ? fixed!.y : EDGE_MM) + i.h + EDGE_MM));
  // Past this, the board is long and thin whatever fits on it. `LONG_PENALTY` would pass it over anyway.
  const highest = Math.max(lowest, 1.5 * Math.sqrt(1.3 * items.reduce((sum, i) => sum + (i.w + GAP_MM) * (i.h + GAP_MM), 0)));
  let best: { rects: Rect[]; box: Box; w: number; h: number; score: number } | null = null;
  for (let maxTop = lowest; maxTop <= highest + HEIGHT_STEP_MM; maxTop += HEIGHT_STEP_MM) for (const order of orderings(searched)) {
    const rects = packOrder(fixed, [...order, ...rest], maxTop, wires);
    if (!rects) continue;
    const box = trim(rects);
    const w = Math.ceil(box.right - box.left - 1e-9); const h = Math.ceil(box.top - box.bottom - 1e-9);
    const score = w * h * (1 + LONG_PENALTY * Math.max(0, Math.max(w, h) / Math.min(w, h) - 1)) + WIRE_WEIGHT * wireLength(rects, wires);
    if (!best || score < best.score - 1e-6) best = { rects, box, w, h, score };
  }
  if (!best) {
    // Nothing kept the screen above the knob under any limit. A stack above the controller is tall, but always valid.
    const rects: Rect[] = fixed ? [fixed] : []; let y = fixed ? fixed.y + fixed.h + GAP_MM : EDGE_MM;
    for (const item of [...free].sort((a, b) => Number(isDisplay(a.part.module)) - Number(isDisplay(b.part.module)))) { rects.push({ ...item, x: fixed?.x ?? 0, y }); y += item.h + LIGHT_GAP_MM; }
    const box = trim(rects); best = { rects, box, w: Math.ceil(box.right - box.left - 1e-9), h: Math.ceil(box.top - box.bottom - 1e-9), score: 0 };
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { widthMm: best.w, heightMm: best.h, at: new Map(best.rects.map(r => [r.part.id, { x: round(r.x + r.originX - best!.box.left - best!.w / 2), y: round(r.y + r.originY - best!.h / 2) }])) };
}

/** A clear place on the top side for a line of silkscreen, or null. Tries from the top of the board, nearest the middle first. */
export function clearSilkSpot(board: { widthMm: number; heightMm: number; parts: ReadonlyArray<PlacedPart & { x: number; y: number }>; mountingHoles: ReadonlyArray<{ x: number; y: number }> }, textW: number, textH: number): { x: number; y: number } | null {
  const boxes = board.parts.map(p => { const e = extent(p); return { left: p.x + e.left, right: p.x + e.right, bottom: p.y + e.bottom, top: p.y + e.top }; });
  const holes = board.mountingHoles.map(h => ({ left: h.x - 2.6, right: h.x + 2.6, bottom: h.y - 2.6, top: h.y + 2.6 }));
  const free = (x: number, y: number) => [...boxes, ...holes].every(b => x + textW / 2 < b.left || x - textW / 2 > b.right || y + textH / 2 < b.bottom || y - textH / 2 > b.top);
  const halfW = board.widthMm / 2 - 1 - textW / 2; const halfH = board.heightMm / 2 - 1 - textH / 2;
  for (let y = halfH; y >= -halfH; y -= 0.5) for (let step = 0; step <= 2 * halfW; step += 0.5) {
    const x = (step % 1 === 0 ? 1 : -1) * Math.ceil(step / 2) ;
    if (Math.abs(x) <= halfW && free(x, y)) return { x, y };
  }
  return null;
}
