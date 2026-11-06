// Where everything on a sheet goes, in millimetres with y down. Pure and deterministic: the same sheet always lands
// the same way, so nothing moves when a live sheet becomes the final one. Parts snap to a 2.54 mm grid.
import type { NetKind, Sheet, SheetPart, SheetPin, SheetSection, SymbolKind } from './sheet';

export const GRID = 2.54;
const CHAR = 1.22; // Width of one mono character at the pin text's size.
const STUB = GRID;
const FRAME = 7.5;
const MARGIN = 7.62;
const TITLE_BLOCK = { w: 91.44, h: 20.32 };
const LOOSE_PER_COLUMN = 4;

export type PinEnd = 'power' | 'ground' | 'label' | 'wire' | 'open';
export type DraftMark = 'added' | 'removed';
export interface LaidPin { part: string; id: string; label: string; number: string | null; side: 'left' | 'right'; x: number; y: number; ex: number; net: string | null; netName: string | null; kind: NetKind | null; end: PinEnd; required: boolean; draft?: DraftMark; was?: string | undefined }
export interface LaidPart { ref: string; name: string; value?: string | undefined; symbol: SymbolKind; x: number; y: number; w: number; h: number; pins: LaidPin[]; section: string; draft?: DraftMark | undefined }
export interface LaidWire { net: string; name: string; d: string; junctions: [number, number][]; pins: { part: string; pin: string }[] }
export interface LaidPort { key: string; inst: string; label: string; full: string; kind: string; links: string[]; x: number; y: number; w: number; h: number; draft?: DraftMark | undefined }
export interface LaidSection { id: string; title: string; x: number; y: number; w: number; h: number; notes: string[]; reference?: string | undefined; parts: string[]; ports: LaidPort[]; draft?: DraftMark | undefined }
export interface Zone { label: string; x: number; y: number }
export interface SheetLayout { w: number; h: number; sections: LaidSection[]; parts: LaidPart[]; wires: LaidWire[]; zones: Zone[]; zoneTicks: { x1: number; y1: number; x2: number; y2: number }[]; frame: { x: number; y: number; w: number; h: number }; titleBlock: { x: number; y: number; w: number; h: number } }
export interface LayoutOptions { hidden?: boolean; aspect?: number; marks?: ReadonlyMap<string, DraftMark> | undefined; pinMarks?: ReadonlyMap<string, { mark: DraftMark; was?: string }> | undefined; portMarks?: ReadonlyMap<string, DraftMark> | undefined }

const snap = (v: number) => Math.round(v / GRID) * GRID;
const up = (v: number) => Math.ceil(v / GRID - 1e-6) * GRID;
const TWO_TERMINAL = new Set<SymbolKind>(['resistor', 'capacitor', 'inductor', 'led', 'diode', 'ldr', 'piezo', 'switch']);
const twoTerminal = (p: SheetPart) => TWO_TERMINAL.has(p.symbol) && p.pins.length <= 2;

const wrap = (text: string, chars: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line.length + 1 + word.length) > chars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
};

interface Local { pins: LaidPin[]; parts: LaidPart[]; wires: LaidWire[]; w: number; h: number; notes: string[] }

function tagWidth(pin: Pick<LaidPin, 'end' | 'netName'>): number {
  if (pin.end === 'open' || pin.end === 'wire') return 0;
  if (pin.end === 'ground') return up(5);
  return up((pin.netName?.length ?? 0) * CHAR + 5);
}

/** One section's parts in columns, with the wires it can draw and tags for whatever leaves it. */
function layOutSection(section: SheetSection, sheet: Sheet, options: LayoutOptions): Local {
  const netById = new Map(sheet.nets.map(n => [n.id, n]));
  const members = section.parts.map(ref => sheet.parts.find(p => p.ref === ref)).filter((p): p is SheetPart => Boolean(p));
  const refs = new Set(members.map(p => p.ref));
  const pinMark = (ref: string, id: string) => options.pinMarks?.get(`${ref}.${id}`);
  const shows = (p: SheetPart, pin: SheetPin) => Boolean(pin.net) || pin.required || options.hidden || twoTerminal(p) || Boolean(pinMark(p.ref, pin.id));

  // A net is drawn as a wire only if it stays in this section. Anything leaving is a named tag, not spaghetti.
  const endpoints = new Map<string, { part: SheetPart; pin: SheetPin }[]>();
  for (const part of sheet.parts) for (const pin of part.pins) if (pin.net) endpoints.set(pin.net, [...(endpoints.get(pin.net) ?? []), { part, pin }]);
  const internal = new Set<string>();
  for (const [net, ends] of endpoints) {
    if (netById.get(net)?.kind === 'signal' && ends.length >= 2 && ends.every(e => refs.has(e.part.ref))) internal.add(net);
  }

  // Columns: the part with the most pins first, then whatever each wire reaches.
  const ordered = [...members].sort((a, b) => b.pins.length - a.pins.length || a.ref.localeCompare(b.ref));
  const column = new Map<string, number>();
  let looseCount = 0;
  for (const part of ordered) {
    if (column.has(part.ref)) continue;
    const touchesWire = part.pins.some(pin => pin.net && internal.has(pin.net));
    // Parts with no wire to anything here have no reason to sit in one tall stack. They fill short columns instead.
    const loose = !touchesWire && column.size > 0 && part.symbol !== 'chip';
    column.set(part.ref, part.symbol === 'chip' || !column.size ? 0 : loose ? 1 + Math.floor(looseCount++ / LOOSE_PER_COLUMN) : 1);
    const queue = [part.ref];
    while (queue.length) {
      const at = queue.shift()!;
      const here = column.get(at)!;
      for (const pin of sheet.parts.find(p => p.ref === at)!.pins) {
        if (!pin.net || !internal.has(pin.net)) continue;
        for (const end of endpoints.get(pin.net)!) {
          if (column.has(end.part.ref)) continue;
          column.set(end.part.ref, here + 1);
          queue.push(end.part.ref);
        }
      }
    }
  }
  const columns = Math.max(1, ...[...column.values()].map(c => c + 1));

  const endOf = (pin: SheetPin): PinEnd => {
    if (!pin.net) return 'open';
    const kind = netById.get(pin.net)?.kind;
    if (kind === 'ground') return 'ground';
    if (kind === 'power') return 'power';
    return 'label';
  };

  // Which side each pin leaves from.
  const sideOf = new Map<string, 'left' | 'right'>();
  for (const part of members) {
    const shown = part.pins.filter(pin => shows(part, pin));
    const c = column.get(part.ref)!;
    const towardLower = (pin: SheetPin) => pin.net && internal.has(pin.net) && endpoints.get(pin.net)!.some(e => e.part.ref !== part.ref && column.get(e.part.ref)! < c);
    const towardHigher = (pin: SheetPin) => pin.net && internal.has(pin.net) && endpoints.get(pin.net)!.some(e => e.part.ref !== part.ref && column.get(e.part.ref)! > c);
    if (twoTerminal(part)) {
      const [a, b] = shown;
      // The lead that goes back toward the chip faces it. Otherwise a rail goes on the far side.
      const flip = a && b && (towardLower(b) || (!towardLower(a) && (towardHigher(a) || (endOf(a) === 'power' || endOf(a) === 'ground') && endOf(b) === 'label')));
      if (a) sideOf.set(`${part.ref}.${a.id}`, flip ? 'right' : 'left');
      if (b) sideOf.set(`${part.ref}.${b.id}`, flip ? 'left' : 'right');
      continue;
    }
    const left: SheetPin[] = [];
    const right: SheetPin[] = [];
    for (const pin of shown) {
      if (towardHigher(pin)) right.push(pin);
      else if (towardLower(pin)) left.push(pin);
      else if (['power-in', 'power-out', 'ground'].includes(pin.role) || endOf(pin) === 'power' || endOf(pin) === 'ground') left.push(pin);
      else right.push(pin);
    }
    // A long side turns one tall part into a tower. Balance it with pins that don't care which way they go.
    const free = (pin: SheetPin) => !towardHigher(pin) && !towardLower(pin);
    while (right.length > left.length + 1 && right.some(free)) left.push(right.splice(right.findLastIndex(free), 1)[0]!);
    while (left.length > right.length + 1 && left.some(free)) right.unshift(left.splice(left.findLastIndex(free), 1)[0]!);
    for (const pin of left) sideOf.set(`${part.ref}.${pin.id}`, 'left');
    for (const pin of right) sideOf.set(`${part.ref}.${pin.id}`, 'right');
  }

  const gutterOf = (ref: string, pinId: string) => column.get(ref)! + (sideOf.get(`${ref}.${pinId}`) === 'right' ? 1 : 0);
  const drawn = new Map<string, number>();
  for (const net of internal) {
    const gutters = new Set(endpoints.get(net)!.filter(e => sideOf.has(`${e.part.ref}.${e.pin.id}`)).map(e => gutterOf(e.part.ref, e.pin.id)));
    if (gutters.size === 1 && endpoints.get(net)!.every(e => sideOf.has(`${e.part.ref}.${e.pin.id}`))) drawn.set(net, [...gutters][0]!);
  }

  const bodySize = (part: SheetPart) => {
    if (twoTerminal(part)) return { w: 3 * GRID, h: 2 * GRID };
    const pins = part.pins.filter(pin => sideOf.has(`${part.ref}.${pin.id}`));
    const count = (side: 'left' | 'right') => pins.filter(pin => sideOf.get(`${part.ref}.${pin.id}`) === side);
    const longest = (list: SheetPin[]) => Math.max(0, ...list.map(pin => pin.label.length));
    const w = up(Math.max(longest(count('left')) * CHAR + longest(count('right')) * CHAR + 5, Math.min(part.name.length, 28) * 1.05, 4 * GRID));
    return { w, h: Math.max(2, Math.max(count('left').length, count('right').length) + 1) * GRID };
  };

  const widths: number[] = Array.from({ length: columns }, () => 0);
  for (const part of members) widths[column.get(part.ref)!] = Math.max(widths[column.get(part.ref)!]!, bodySize(part).w);

  const facing = (gutter: number, side: 'left' | 'right') =>
    members.filter(p => column.get(p.ref) === gutter - (side === 'right' ? 1 : 0)).flatMap(p => p.pins.filter(pin => sideOf.get(`${p.ref}.${pin.id}`) === side).map(pin => {
      const net = pin.net ? netById.get(pin.net) : null;
      const end: PinEnd = pin.net && drawn.has(pin.net) ? 'wire' : endOf(pin);
      return tagWidth({ end, netName: net?.name ?? null });
    }));
  const trunks = Array.from({ length: columns + 1 }, (_, g) => [...drawn].filter(([, at]) => at === g).map(([net]) => net).sort());
  const gutterParts = Array.from({ length: columns + 1 }, (_, g) => ({
    leftTags: Math.max(0, ...facing(g, 'right')),
    rightTags: Math.max(0, ...facing(g, 'left')),
    trunks: trunks[g]!.length,
  }));
  const gutterW = gutterParts.map(g => up(g.leftTags + g.rightTags + (g.trunks ? (g.trunks + 1) * GRID : 0) + STUB * 2));

  const xOfColumn: number[] = [];
  let cursor = gutterW[0]!;
  for (let c = 0; c < columns; c++) { xOfColumn[c] = snap(cursor); cursor += widths[c]! + gutterW[c + 1]!; }
  const width = up(cursor);

  // Parts stack in their column, with room for the reference above and the name below.
  const parts: LaidPart[] = [];
  const pinAt = new Map<string, LaidPin>();
  const heights = Array.from({ length: columns }, () => 0);
  for (const part of ordered) {
    const c = column.get(part.ref)!;
    const body = bodySize(part);
    const twoPin = twoTerminal(part);
    const y = snap(heights[c]! + (twoPin ? GRID : 2 * GRID));
    const x = xOfColumn[c]! + (twoPin ? 0 : 0);
    const laidPins: LaidPin[] = [];
    let [leftRow, rightRow] = [1, 1];
    const assigned = part.pins.filter(pin => sideOf.has(`${part.ref}.${pin.id}`));
    const rank = (pin: SheetPin) => (pin.role === 'ground' || endOf(pin) === 'ground' ? 2 : pin.role === 'power-in' || pin.role === 'power-out' || endOf(pin) === 'power' ? 0 : 1);
    const sorted = twoPin ? assigned : [...assigned].sort((a, b) => rank(a) - rank(b));
    for (const pin of sorted) {
      const side = sideOf.get(`${part.ref}.${pin.id}`)!;
      const row = twoPin ? 1 : side === 'left' ? leftRow++ : rightRow++;
      const py = y + row * GRID;
      const px = side === 'left' ? x : x + (twoPin ? body.w : body.w);
      const colRight = xOfColumn[c]! + widths[c]!;
      const ex = side === 'left' ? x - STUB : colRight + STUB;
      const net = pin.net ? netById.get(pin.net) : null;
      const mark = pinMark(part.ref, pin.id);
      const laid: LaidPin = {
        part: part.ref, id: pin.id, label: pin.label, number: pin.number, side, x: px, y: py, ex,
        net: pin.net, netName: net?.name ?? null, kind: net?.kind ?? null,
        end: pin.net && drawn.has(pin.net) ? 'wire' : endOf(pin),
        required: pin.required && !pin.net,
        ...(mark ? { draft: mark.mark, was: mark.was } : {}),
      };
      laidPins.push(laid);
      pinAt.set(`${part.ref}.${pin.id}`, laid);
    }
    const mark = options.marks?.get(part.ref);
    parts.push({ ref: part.ref, name: part.name, value: part.value, symbol: part.symbol, x, y, w: body.w, h: body.h, pins: laidPins, section: section.id, ...(mark ? { draft: mark } : {}) });
    heights[c] = y + body.h + (twoPin ? GRID : 2 * GRID);
  }

  // Trunks run down the middle of their gutter, between the two sides' tags.
  const wires: LaidWire[] = [];
  trunks.forEach((nets, g) => {
    const leftEdge = g === 0 ? 0 : xOfColumn[g - 1]! + widths[g - 1]! + STUB + gutterParts[g]!.leftTags;
    nets.forEach((net, i) => {
      const x = snap(leftEdge) + (i + 1) * GRID;
      const ends = endpoints.get(net)!.map(e => pinAt.get(`${e.part.ref}.${e.pin.id}`)).filter((p): p is LaidPin => Boolean(p));
      if (ends.length < 2) return;
      const ys = ends.map(e => e.y);
      const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
      const d = [`M${x} ${top}V${bottom}`, ...ends.map(e => `M${e.ex} ${e.y}H${x}`)].join('');
      const junctions: [number, number][] = ends.length > 2 ? ends.filter(e => e.y !== top && e.y !== bottom).map(e => [x, e.y]) : [];
      wires.push({ net, name: netById.get(net)?.name ?? net, d, junctions, pins: ends.map(e => ({ part: e.part, pin: e.id })) });
    });
  });

  const contentH = Math.max(GRID, ...heights);
  const w = up(Math.max(width, section.title.length * 1.75 + 6, section.notes.length ? 72 : 0));
  // Notes wrap to the section as it will be drawn, at the note text's average width.
  const notes = section.notes.slice(0, 4).flatMap(n => wrap(n, Math.floor((w - 4) / 1.1)).slice(0, 3));
  return { pins: [...pinAt.values()], parts, wires, w, h: up(contentH), notes };
}

const HEADER = 3 * GRID;
const SECTION_GAP = 3 * GRID;
const NOTE_LINE = 3.2;
const PORT_ROW = 3.81;
const PORT_H = 2.9;
const PORT_GAP = 1.27;
const PORT_INSET = 1.6;

/** Ports flow in rows under a section's title. Offsets are from the section's top left. */
function placePorts(section: SheetSection, width: number, marks: LayoutOptions['portMarks']): { ports: LaidPort[]; rows: number } {
  const list = section.ports ?? [];
  let [x, row] = [PORT_INSET, 0];
  const ports = list.map((port): LaidPort => {
    const w = port.label.length * CHAR + 2.2;
    if (x > PORT_INSET && x + w > width - PORT_INSET) { x = PORT_INSET; row++; }
    const laid: LaidPort = { key: port.key, inst: port.inst, label: port.label, full: port.full, kind: port.kind, links: port.links, x, y: HEADER - 1.6 + row * PORT_ROW, w, h: PORT_H, draft: marks?.get(port.key) };
    x += w + PORT_GAP;
    return laid;
  });
  return { ports, rows: list.length ? row + 1 : 0 };
}

function offset(local: Local, dx: number, dy: number) {
  for (const p of local.parts) {
    p.x += dx; p.y += dy;
    for (const pin of p.pins) { pin.x += dx; pin.y += dy; pin.ex += dx; }
  }
  for (const w of local.wires) {
    w.d = w.d.replace(/M([\d.-]+) ([\d.-]+)V([\d.-]+)/g, (_a, x, y, v) => `M${+x + dx} ${+y + dy}V${+v + dy}`).replace(/M([\d.-]+) ([\d.-]+)H([\d.-]+)/g, (_a, x, y, h) => `M${+x + dx} ${+y + dy}H${+h + dx}`);
    w.junctions = w.junctions.map(([x, y]) => [x + dx, y + dy]);
  }
}

export function layOutSheet(sheet: Sheet, options: LayoutOptions = {}): SheetLayout {
  const locals = sheet.sections.map(section => ({ section, local: layOutSection(section, sheet, options) }));
  const size = locals.map(({ section, local }) => {
    const placed = placePorts(section, local.w, options.portMarks);
    const portsH = placed.rows * PORT_ROW;
    return {
      w: local.w,
      portsH,
      ports: placed.ports,
      h: HEADER + portsH + local.h + (local.notes.length ? local.notes.length * NOTE_LINE + GRID : GRID) + (section.reference ? NOTE_LINE : 0),
    };
  });
  // Sections fill columns, shortest first. The count is whichever comes closest to the panel's shape.
  const aspect = options.aspect ?? 1.35;
  type Trial = { cols: number; at: { x: number; y: number; w: number }[]; w: number; h: number };
  const pack = (cols: number): Trial => {
    const assigned: number[][] = Array.from({ length: cols }, () => []);
    const tall = Array.from({ length: cols }, () => 0);
    size.forEach((s, i) => {
      const shortest = tall.indexOf(Math.min(...tall));
      assigned[shortest]!.push(i);
      tall[shortest]! += s.h + SECTION_GAP;
    });
    const at: { x: number; y: number; w: number }[] = [];
    let x = 0;
    for (const list of assigned) {
      let y = 0;
      // A column's sections share its width, so the sheet reads as a grid and not a pile.
      const columnW = Math.max(0, ...list.map(i => size[i]!.w));
      for (const i of list) { at[i] = { x, y, w: columnW }; y += size[i]!.h + SECTION_GAP; }
      x += columnW + SECTION_GAP;
    }
    return { cols, at, w: Math.max(x - SECTION_GAP, 0), h: Math.max(...tall, SECTION_GAP) - SECTION_GAP };
  };
  const trials = Array.from({ length: Math.min(4, Math.max(1, sheet.sections.length)) }, (_, i) => pack(i + 1));
  const score = (t: Trial) => {
    const [w, h] = [t.w + 2 * (FRAME + MARGIN), t.h + 2 * (FRAME + MARGIN) + TITLE_BLOCK.h];
    const fill = Math.min(1 / w * 1000 * aspect, 1 / h * 1000); // How large it can draw in a panel this shape.
    return fill;
  };
  const best = trials.reduce((a, b) => (score(b) > score(a) ? b : a), trials[0]!);

  const originX = FRAME + MARGIN;
  const originY = FRAME + MARGIN;
  const sections: LaidSection[] = [];
  const parts: LaidPart[] = [];
  const wires: LaidWire[] = [];
  locals.forEach(({ section, local }, i) => {
    const place = best.at[i]!;
    const [x, y] = [snap(originX + place.x), snap(originY + place.y)];
    offset(local, x, y + HEADER + size[i]!.portsH);
    sections.push({ id: section.id, title: section.title, x, y, w: place.w, h: size[i]!.h, notes: local.notes, reference: section.reference, parts: section.parts, ports: size[i]!.ports.map(p => ({ ...p, x: p.x + x, y: p.y + y })), draft: options.marks?.get(`section:${section.id}`) });
    parts.push(...local.parts);
    wires.push(...local.wires);
  });

  const blockW = TITLE_BLOCK.w;
  const narrow = aspect < 1;
  const w = up(Math.max(best.w, blockW + GRID, narrow ? 0 : 150) + 2 * originX);
  const h = up(Math.max(best.h, 60) + 2 * originY + TITLE_BLOCK.h + GRID);
  // A single column on a phone takes the sheet's whole width.
  if (best.cols === 1) for (const section of sections) section.w = w - 2 * originX;
  const frame = { x: FRAME, y: FRAME, w: w - 2 * FRAME, h: h - 2 * FRAME };
  const titleBlock = { x: frame.x + frame.w - TITLE_BLOCK.w, y: frame.y + frame.h - TITLE_BLOCK.h, w: TITLE_BLOCK.w, h: TITLE_BLOCK.h };

  const zones: Zone[] = [];
  const zoneTicks: SheetLayout['zoneTicks'] = [];
  const columnsAcross = Math.max(2, Math.round(frame.w / 50));
  const rowsDown = Math.max(2, Math.round(frame.h / 40));
  for (let i = 0; i < columnsAcross; i++) {
    const x = frame.x + ((i + 0.5) * frame.w) / columnsAcross;
    const label = String(i + 1);
    zones.push({ label, x, y: FRAME / 2 + 0.6 }, { label, x, y: h - FRAME / 2 + 0.6 });
    if (i) { const tick = frame.x + (i * frame.w) / columnsAcross; zoneTicks.push({ x1: tick, y1: FRAME - 2.5, x2: tick, y2: FRAME }, { x1: tick, y1: h - FRAME, x2: tick, y2: h - FRAME + 2.5 }); }
  }
  for (let i = 0; i < rowsDown; i++) {
    const y = frame.y + ((i + 0.5) * frame.h) / rowsDown + 0.6;
    const label = String.fromCharCode(65 + (i % 26));
    zones.push({ label, x: FRAME / 2, y }, { label, x: w - FRAME / 2, y });
    if (i) { const tick = frame.y + (i * frame.h) / rowsDown; zoneTicks.push({ x1: FRAME - 2.5, y1: tick, x2: FRAME, y2: tick }, { x1: w - FRAME, y1: tick, x2: w - FRAME + 2.5, y2: tick }); }
  }
  return { w, h, sections, parts, wires, zones, zoneTicks, frame, titleBlock };
}

/** The view that fits the sheet in the room the rails leave. */
export function fitView(layout: Pick<SheetLayout, 'w' | 'h'>, width: number, height: number, inset: { left: number; right: number; top: number; bottom: number }) {
  const roomW = Math.max(width - inset.left - inset.right, 40);
  const roomH = Math.max(height - inset.top - inset.bottom, 40);
  const s = Math.min(roomW / layout.w, roomH / layout.h);
  return { s, x: inset.left + (roomW - layout.w * s) / 2, y: inset.top + (roomH - layout.h * s) / 2 };
}

/** Grid dots a comfortable distance apart at this zoom: the same 2.54 mm grid, in steps of five past a point. */
export function gridStep(s: number): number {
  let step = GRID;
  while (step * s < 11) step *= 5;
  return step;
}
