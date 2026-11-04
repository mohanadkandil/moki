// circuit.json to mech-handoff.json: the board facts the enclosure needs, and nothing about the enclosure.
// Parts are located from their real plated holes, so an edited board or a rotated part still lands correctly.
import { createHash } from 'node:crypto';
import { CATALOG } from '../../src/circuit/catalog.ts';
import { MODULE_MECH, type BlockColor, type LocalAperture } from './module-mech.ts';

export type Face = 'x_pos' | 'x_neg' | 'y_pos' | 'y_neg' | 'z_pos';
export interface Rect { minX: number; minY: number; maxX: number; maxY: number }
export interface HandoffBlock { shape: 'box' | 'cylinder'; color: BlockColor; label: string; x: number; y: number; w: number; h: number; z0: number; z1: number; rotationDeg: number }
export interface HandoffAperture {
  id: string; part: string; module: string; purpose: LocalAperture['purpose']; face: Face; shape: LocalAperture['shape'];
  center: { x: number; y: number }; zMm: number; widthMm: number; heightMm: number; rotationDeg: number;
  grid?: LocalAperture['grid']; activeAreaMm?: LocalAperture['activeAreaMm']; note: string;
}
export interface HandoffPart {
  id: string; module: string; name: string; category: string;
  center: { x: number; y: number }; rotationDeg: number; bbox: Rect;
  stack: { mount: string; socketMm: number; spacerMm: number; pcbMm: number; componentsMm: number; topMm: number; raisedToLid: boolean; throughLid?: { bushingTopMm: number; shaftTopMm: number; bushingDiameterMm: number; shaftDiameterMm: number } };
  fit: { method: 'pads' | 'component-center'; pins: number; maxResidualMm: number };
  blocks: HandoffBlock[]; confidence: string;
}
export interface MechHandoff {
  schema: 'moki.mech-handoff/1';
  source: { circuitJsonSha256: string; label: string | null };
  board: { widthMm: number; heightMm: number; thicknessMm: number; center: { x: number; y: number }; outline: Array<{ x: number; y: number }>; holes: Array<{ x: number; y: number; diameterMm: number }> };
  parts: HandoffPart[];
  apertures: HandoffAperture[];
  warnings: string[];
}

const MAX_BOARD_MM = 300;
const round = (n: number) => Math.round(n * 1000) / 1000;
const finite = (n: unknown, what: string): number => {
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > MAX_BOARD_MM * 2) throw new Error(`circuit.json has an invalid ${what}: ${String(n)}`);
  return n;
};
const normalizeDeg = (deg: number) => { const d = round(((deg % 360) + 360) % 360); return d === 360 ? 0 : d; };

interface Pose { rotationDeg: number; tx: number; ty: number; maxResidualMm: number; pins: number; method: 'pads' | 'component-center' }

/** Rigid 2D fit (no mirror) from catalog pins, in a y-up frame, onto measured pads. */
export function fitPose(local: Array<{ x: number; y: number }>, measured: Array<{ x: number; y: number }>): Omit<Pose, 'method'> {
  const n = local.length;
  const mean = (pts: Array<{ x: number; y: number }>) => ({ x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n });
  const cl = mean(local); const cm = mean(measured);
  let sin = 0; let cos = 0;
  for (let i = 0; i < n; i++) {
    const lx = local[i]!.x - cl.x; const ly = local[i]!.y - cl.y;
    const mx = measured[i]!.x - cm.x; const my = measured[i]!.y - cm.y;
    cos += lx * mx + ly * my; sin += lx * my - ly * mx;
  }
  const theta = n > 1 && (sin !== 0 || cos !== 0) ? Math.atan2(sin, cos) : 0;
  const c = Math.cos(theta); const s = Math.sin(theta);
  const tx = cm.x - (c * cl.x - s * cl.y); const ty = cm.y - (s * cl.x + c * cl.y);
  let maxResidualMm = 0;
  for (let i = 0; i < n; i++) {
    const px = c * local[i]!.x - s * local[i]!.y + tx; const py = s * local[i]!.x + c * local[i]!.y + ty;
    maxResidualMm = Math.max(maxResidualMm, Math.hypot(px - measured[i]!.x, py - measured[i]!.y));
  }
  return { rotationDeg: normalizeDeg((theta * 180) / Math.PI), tx, ty, maxResidualMm: round(maxResidualMm), pins: n };
}

function faceFromVector(x: number, y: number): Face {
  return Math.abs(x) >= Math.abs(y) ? (x >= 0 ? 'x_pos' : 'x_neg') : (y >= 0 ? 'y_pos' : 'y_neg');
}

export function buildMechHandoff(circuitJsonText: string, metadata?: { parts?: Array<{ id: string; module: string }> } | null): MechHandoff {
  const cj = JSON.parse(circuitJsonText) as any[];
  if (!Array.isArray(cj)) throw new Error('circuit.json is not an array');
  const warnings: string[] = [];
  const board = cj.find(e => e.type === 'pcb_board');
  if (!board) throw new Error('circuit.json has no pcb_board');
  const widthMm = finite(board.width, 'board width'); const heightMm = finite(board.height, 'board height');
  if (widthMm <= 0 || heightMm <= 0 || widthMm > MAX_BOARD_MM || heightMm > MAX_BOARD_MM) throw new Error(`Board size ${widthMm} x ${heightMm} mm is out of range`);
  const thicknessMm = finite(board.thickness ?? 1.6, 'board thickness');
  const cx = finite(board.center?.x ?? 0, 'board centre'); const cy = finite(board.center?.y ?? 0, 'board centre');
  if (Array.isArray(board.outline) && board.outline.length) warnings.push('The board has a custom outline. Rounded rectangles are followed by the enclosure; other outlines use the conservative bounding rectangle.');
  const holes: MechHandoff['board']['holes'] = [];
  for (const h of cj.filter(e => e.type === 'pcb_hole')) {
    const d = h.hole_diameter;
    if (h.hole_shape !== 'circle' || typeof d !== 'number' || d < 2.9 || d > 3.7) { warnings.push(`Ignored non-M3 board hole ${String(h.pcb_hole_id)}.`); continue; }
    holes.push({ x: round(finite(h.x, 'hole x')), y: round(finite(h.y, 'hole y')), diameterMm: d });
  }
  holes.sort((a, b) => a.x - b.x || a.y - b.y);
  if (!holes.length) warnings.push('The board has no M3 holes, so it cannot be screwed to the enclosure.');

  const moduleById = new Map((metadata?.parts ?? []).map(p => [p.id, p.module]));
  const sources = new Map(cj.filter(e => e.type === 'source_component').map(e => [e.source_component_id, e]));
  const holesByComponent = new Map<string, any[]>();
  for (const h of cj.filter(e => e.type === 'pcb_plated_hole')) {
    if (!holesByComponent.has(h.pcb_component_id)) holesByComponent.set(h.pcb_component_id, []);
    holesByComponent.get(h.pcb_component_id)!.push(h);
  }

  const parts: HandoffPart[] = []; const apertures: HandoffAperture[] = [];
  for (const component of cj.filter(e => e.type === 'pcb_component')) {
    const source = sources.get(component.source_component_id);
    const id = String(source?.name ?? component.pcb_component_id);
    const mpn = String(source?.manufacturer_part_number ?? '');
    const moduleId = moduleById.get(id) ?? [...CATALOG.values()].find(m => mpn.startsWith(m.name))?.id;
    const def = moduleId ? CATALOG.get(moduleId) : undefined;
    const mech = moduleId ? MODULE_MECH[moduleId] : undefined;
    const pads = holesByComponent.get(component.pcb_component_id) ?? [];
    if (!def || !mech) {
      const xs = pads.map(p => p.x as number); const ys = pads.map(p => p.y as number);
      if (!xs.length) { xs.push(component.center?.x ?? 0); ys.push(component.center?.y ?? 0); }
      const topMm = 12;
      parts.push({ id, module: moduleId ?? 'unknown', name: mpn || id, category: 'unknown', center: { x: round((Math.min(...xs) + Math.max(...xs)) / 2), y: round((Math.min(...ys) + Math.max(...ys)) / 2) }, rotationDeg: 0,
        bbox: { minX: round(Math.min(...xs) - 2), minY: round(Math.min(...ys) - 2), maxX: round(Math.max(...xs) + 2), maxY: round(Math.max(...ys) + 2) },
        stack: { mount: 'unknown', socketMm: 0, spacerMm: 0, pcbMm: 0, componentsMm: topMm, topMm, raisedToLid: false }, fit: { method: 'component-center', pins: pads.length, maxResidualMm: 0 }, blocks: [], confidence: 'Not a catalog module.' });
      warnings.push(`${id} is not a catalog module, so it is treated as a ${topMm} mm tall block around its pads with no opening.`);
      continue;
    }
    // Catalog frame is y down. Move it to a y-up frame about the outline centre before fitting.
    const toLocal = (x: number, y: number) => ({ x: x - def.size.w / 2, y: def.size.h / 2 - y });
    const localPins: Array<{ x: number; y: number }> = []; const measured: Array<{ x: number; y: number }> = [];
    for (const pad of pads) {
      const hint = (pad.port_hints as string[] | undefined)?.find(h => /^pin\d+$/.test(h));
      const pin = hint ? def.pins[Number(hint.slice(3)) - 1] : undefined;
      if (!pin) continue;
      localPins.push(toLocal(pin.physical.x, pin.physical.y)); measured.push({ x: pad.x, y: pad.y });
    }
    let pose: Pose;
    if (localPins.length >= 2) {
      pose = { ...fitPose(localPins, measured), method: 'pads' };
      if (pose.maxResidualMm > 0.5) warnings.push(`${id}: its pads differ from the catalog pins by up to ${pose.maxResidualMm} mm, so check its enclosure openings.`);
    } else {
      pose = { rotationDeg: normalizeDeg(component.rotation ?? 0), tx: component.center?.x ?? 0, ty: component.center?.y ?? 0, maxResidualMm: 0, pins: localPins.length, method: 'component-center' };
      warnings.push(`${id}: too few identifiable pads, so it was placed from its component centre.`);
    }
    const c = Math.cos((pose.rotationDeg * Math.PI) / 180); const s = Math.sin((pose.rotationDeg * Math.PI) / 180);
    const toBoard = (lx: number, ly: number) => ({ x: round(c * lx - s * ly + pose.tx), y: round(s * lx + c * ly + pose.ty) });
    // Leaded parts: the catalog outline is a wiring sketch with long legs, so the real body centres on the pads.
    const leaded = Boolean(mech.bodyMm);
    const padCentroid = localPins.length ? { x: localPins.reduce((a, p) => a + p.x, 0) / localPins.length, y: localPins.reduce((a, p) => a + p.y, 0) / localPins.length } : { x: 0, y: 0 };
    const place = (x: number, y: number) => leaded ? toBoard(padCentroid.x + x, padCentroid.y - y) : toBoard(x - def.size.w / 2, def.size.h / 2 - y);
    const center = leaded ? toBoard(padCentroid.x, padCentroid.y) : toBoard(0, 0);
    const size = mech.bodyMm ?? { w: def.size.w, h: def.size.h };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const lx = (a! * size.w) / 2; const ly = (b! * size.h) / 2; return { x: center.x + c * lx - s * ly, y: center.y + s * lx + c * ly }; });
    const bbox: Rect = { minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)), maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)) };
    const topMm = round(mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm);
    const localApertures = mech.apertures(def.size.w, def.size.h, topMm);
    localApertures.forEach((a, index) => {
      const at = place(a.x, a.y);
      let face: Face = 'z_pos';
      if (a.surface === 'wall') {
        const out = a.outwardLocal ?? { x: 0, y: 1 };
        face = faceFromVector(c * out.x + s * out.y, s * out.x - c * out.y);
        const over = a.overhangMm ?? 0;
        const tip = { x: at.x + (c * out.x + s * out.y) * over, y: at.y + (s * out.x - c * out.y) * over };
        bbox.minX = Math.min(bbox.minX, tip.x); bbox.maxX = Math.max(bbox.maxX, tip.x); bbox.minY = Math.min(bbox.minY, tip.y); bbox.maxY = Math.max(bbox.maxY, tip.y);
      }
      apertures.push({ id: `${id}-${a.purpose}${index ? `-${index + 1}` : ''}`, part: id, module: moduleId!, purpose: a.purpose, face, shape: a.shape, center: at, zMm: round(a.zMm), widthMm: a.widthMm, heightMm: a.heightMm, rotationDeg: pose.rotationDeg, ...(a.grid ? { grid: a.grid } : {}), ...(a.activeAreaMm ? { activeAreaMm: a.activeAreaMm } : {}), note: a.note });
    });
    parts.push({ id, module: moduleId!, name: def.name, category: def.category, center, rotationDeg: pose.rotationDeg,
      bbox: { minX: round(bbox.minX), minY: round(bbox.minY), maxX: round(bbox.maxX), maxY: round(bbox.maxY) },
      stack: { mount: mech.mount, socketMm: mech.socketMm, spacerMm: mech.spacerMm, pcbMm: mech.pcbMm, componentsMm: mech.componentsMm, topMm, raisedToLid: Boolean(mech.raisedToLid), ...(mech.throughLid ? { throughLid: mech.throughLid } : {}) },
      fit: { method: pose.method, pins: pose.pins, maxResidualMm: pose.maxResidualMm },
      blocks: mech.blocks(def.size.w, def.size.h, topMm).map(b => { const at = place(b.x, b.y); return { ...b, x: at.x, y: at.y, rotationDeg: pose.rotationDeg }; }),
      confidence: mech.confidence });
  }
  parts.sort((a, b) => a.id.localeCompare(b.id)); apertures.sort((a, b) => a.id.localeCompare(b.id));
  if (!apertures.some(a => a.purpose === 'usb')) warnings.push('No USB connector was found, so the enclosure has no power opening.');
  const silk = cj.find(e => e.type === 'pcb_silkscreen_text' && typeof e.text === 'string' && e.text.startsWith('moki'));
  const halfW = widthMm / 2; const halfH = heightMm / 2;
  return {
    schema: 'moki.mech-handoff/1',
    source: { circuitJsonSha256: createHash('sha256').update(circuitJsonText).digest('hex'), label: silk ? String(silk.text).slice(0, 32) : null },
    board: { widthMm, heightMm, thicknessMm, center: { x: cx, y: cy },
      outline: Array.isArray(board.outline) && board.outline.length >= 3 ? board.outline.map((p: any) => ({ x: finite(p.x, 'outline x'), y: finite(p.y, 'outline y') })) : [{ x: cx - halfW, y: cy - halfH }, { x: cx + halfW, y: cy - halfH }, { x: cx + halfW, y: cy + halfH }, { x: cx - halfW, y: cy + halfH }], holes },
    parts, apertures, warnings,
  };
}
