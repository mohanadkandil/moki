/** Finite, inspected RP2040 oscillator paths for a native saved-route phase.
 * This is a placement profile, not a pathfinder. Unsupported geometry fails.
 * Final routing, copper continuity and full native DRC remain mandatory.
 */
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkHoleTraceClearance,
  checkViaTraceClearance,
  checkPcbTracesOutOfBoard,
  checkCopperToCutoutClearance,
  checkPcbTraceLengths,
  checkPcbTraceViaCounts,
} from '@tscircuit/checks';
import { nativeComponentPorts } from '../../src/blocks/native-ports.js';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist.js';
import { nativePlacementIssues } from '../../src/blocks/native-placement.js';
import type { PlanGraph } from '../../src/blocks/graph.js';

type Point = { x: number; y: number };
type Wire = Point & { route_type: 'wire'; layer: 'top'; width: number };
const WIDTH = 0.15,
  CLEARANCE = 0.127,
  EPS = 1e-5;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const angle = (n: number) => ((n % 360) + 360) % 360;
const one = <T>(items: T[], label: string): T => {
  if (items.length !== 1) throw Error(`RP clock requires exactly one ${label}`);
  return items[0]!;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (points: Point[]) => points.slice(1).reduce((n, p, i) => n + distance(points[i]!, p), 0);
const rotate = (p: Point, quarter: number): Point => {
  switch (((quarter % 4) + 4) % 4) {
    case 1:
      return { x: -p.y, y: p.x };
    case 2:
      return { x: -p.x, y: -p.y };
    case 3:
      return { x: p.y, y: -p.x };
    default:
      return { ...p };
  }
};
const profilePoses: Record<string, { x: number; y: number; rotation: number }[]> = {
  X1: [{ x: -1.5, y: -8, rotation: 0 }],
  R1: [
    { x: -1.55, y: -5.25, rotation: 0 },
    { x: 1, y: -5.5, rotation: 270 },
    { x: 1, y: -5.25, rotation: 0 },
  ],
  C15: [
    { x: -5, y: -8.85, rotation: 270 },
    { x: -5, y: -8.85, rotation: 180 },
  ],
  C16: [{ x: 3, y: -7.15, rotation: 0 }],
};

export interface RpClockPhase {
  props: null | {
    name: string;
    phaseIndex: 0;
    autorouter: 'auto';
    connections: string[];
    pcbTracePaths: Array<{ connection: string; route: Wire[] }>;
  };
  netNames: string[];
  audit: Array<{ from: string; to: string; net: string; lengthMm: number; route: Wire[] }>;
  lengthsByNet: Record<string, number>;
  scope: 'finite-rp2040-clock-profile-native-geometry';
}
export function createRpClockPhase(
  circuit: any[],
  graph: PlanGraph,
  mapping: Record<string, Record<string, string>>,
): RpClockPhase {
  const empty: RpClockPhase = {
    props: null,
    netNames: [],
    audit: [],
    lengthsByNet: {},
    scope: 'finite-rp2040-clock-profile-native-geometry',
  };
  if (!Array.isArray(circuit) || !Array.isArray(graph?.parts) || !Array.isArray(graph?.nets) || !mapping)
    throw Error('RP clock requires actual circuit, graph and import map');
  const mcus = graph.parts.filter((p) => p.part.lcsc === 'C2040');
  if (!mcus.length) return empty;
  const mcu = one(mcus, 'RP2040');
  if (mcu.part.mpn !== 'RP2040' || mcu.block.id !== 'rp2040-minimal' || mcu.block.version < 3)
    throw Error('Unsupported RP clock block revision');
  if (circuit.some((e) => e.type === 'pcb_trace'))
    throw Error('RP clock phase must be prepared before routing');
  const placement = nativePlacementIssues(graph, circuit);
  if (!placement.ok)
    throw Error(
      'RP clock native placement differs from compiler graph: ' +
        placement.issues.map((i) => i.message).join('; '),
    );
  const sourceIssues = nativeNetlistIssues(graph, circuit, mapping);
  if (sourceIssues.length)
    throw Error('RP clock native source graph differs: ' + sourceIssues.map((i) => i.message).join('; '));
  const board = one(
    circuit.filter((e) => e.type === 'pcb_board'),
    'native board',
  );
  if (
    ![2, 4].includes(board.num_layers) ||
    !finite(board.width) ||
    !finite(board.height) ||
    board.width <= 0 ||
    board.height <= 0
  )
    throw Error('RP clock requires a known native board');
  if (
    board.min_trace_width !== undefined &&
    (!finite(board.min_trace_width) || board.min_trace_width <= 0 || WIDTH < board.min_trace_width - EPS)
  )
    throw Error('RP clock fixed trace width violates native board rule');
  const quarter = Math.round((mcu.at.rotation ?? 0) / 90);
  if (Math.abs((mcu.at.rotation ?? 0) - quarter * 90) > EPS)
    throw Error('RP clock requires cardinal MCU placement');
  const local = (p: Point) => rotate({ x: p.x - mcu.at.x, y: p.y - mcu.at.y }, -quarter);
  const world = (p: Point) => {
    const t = rotate(p, quarter);
    return { x: t.x + mcu.at.x, y: t.y + mcu.at.y };
  };
  const part = (ref: string) =>
    one(
      graph.parts.filter((p) => p.inst === mcu.inst && p.localRef === ref),
      `${mcu.inst}.${ref}`,
    );
  for (const [ref, poses] of Object.entries(profilePoses)) {
    const p = part(ref),
      at = local(p.at),
      rotation = angle((p.at.rotation ?? 0) - quarter * 90);
    if (
      !poses.some(
        (q) =>
          distance(at, q) < EPS && Math.min(angle(rotation - q.rotation), angle(q.rotation - rotation)) < EPS,
      )
    )
      throw Error(`Unsupported RP clock placement profile ${ref}; rerun placement/profile review`);
  }
  const ports = new Map<
    string,
    { source: any; pcb: any; selector: string; pin: { ref: string; logical: string; pad: string } }
  >();
  const endpoint = (ref: string, pad: string) => {
    const p = part(ref),
      key = `${p.ref}.${pad}`;
    if (ports.has(key)) return ports.get(key)!;
    const pin = one(
      Object.entries(p.part.pins).filter(([, v]) => v.pad === pad),
      `physical pin ${key}`,
    );
    const native = mapping[p.ref]?.[pad];
    if (!native) throw Error('Missing native import mapping ' + key);
    const source = one(
      circuit.filter(
        (e) => e.type === 'source_component' && e.name === p.ref && e.manufacturer_part_number === p.part.mpn,
      ),
      `source ${p.ref}`,
    );
    const resolved = nativeComponentPorts(circuit, source, Object.values(mapping[p.ref]!));
    const sourcePort = one(resolved.byNative.get(native) ?? [], `source port ${key}`);
    if (sourcePort.pin_number !== Number(pad) || !sourcePort.port_hints?.includes(`pin${pad}`))
      throw Error('Contradictory native physical clock pin ' + key);
    const component = one(
      circuit.filter(
        (e) => e.type === 'pcb_component' && e.source_component_id === source.source_component_id,
      ),
      `PCB ${p.ref}`,
    );
    const pcb = one(
      circuit.filter(
        (e) =>
          e.type === 'pcb_port' &&
          e.source_port_id === sourcePort.source_port_id &&
          e.pcb_component_id === component.pcb_component_id,
      ),
      `PCB port ${key}`,
    );
    if (!finite(pcb.x) || !finite(pcb.y) || !pcb.layers?.includes('top') || component.layer !== 'top')
      throw Error('RP clock endpoints require actual top-layer ports');
    const pads = circuit.filter(
      (e) =>
        e.type === 'pcb_smtpad' &&
        e.pcb_port_id === pcb.pcb_port_id &&
        e.pcb_component_id === component.pcb_component_id &&
        e.layer === 'top',
    );
    if (!pads.length || !pads.some((pad) => containsPadPoint(pad, pcb)))
      throw Error('RP clock port does not touch its physical land ' + key);
    const result = {
      source: sourcePort,
      pcb,
      selector: `.${p.ref} > .${native}`,
      pin: { ref: p.ref, logical: pin[0], pad },
    };
    ports.set(key, result);
    return result;
  };
  const xin = endpoint('U1', '20'),
    xout = endpoint('U1', '21'),
    x1 = endpoint('X1', '1'),
    x3 = endpoint('X1', '3'),
    r1 = endpoint('R1', '1'),
    r2 = endpoint('R1', '2'),
    c15 = endpoint('C15', '1'),
    c16 = endpoint('C16', '1');
  const pt = (e: ReturnType<typeof endpoint>) => local(e.pcb);
  const a = pt(xin),
    b = pt(xout),
    x = pt(x1),
    z = pt(x3),
    r = pt(r1),
    s = pt(r2),
    c = pt(c15),
    d = pt(c16);
  const rightResistor = local(part('R1').at).x > 0;
  // These fixed corridors were inspected against native pin/land geometry. They
  // have no obstacle-search fallback; every candidate is checked below.
  const xinRoute = rightResistor
    ? [
        a,
        { x: a.x, y: -4.05 },
        { x: -1.232548, y: -4.05 },
        { x: -3.53, y: -6.347452 },
        { x: -3.53, y: -7.92 },
        x,
      ]
    : [
        a,
        { x: a.x, y: -3.96 },
        { x: -3, y: -3.96 },
        { x: -3.55, y: -4.51 },
        { x: -3.55, y: -8.3 },
        { x: -3, y: -8.850011 },
        x,
      ];
  const xoutRoute = rightResistor
    ? [b, { x: b.x, y: -4.1 }, { x: r.x, y: -4.1 }, r]
    : [b, { x: b.x, y: -4.4 }, { x: r.x, y: -4.4 }, r];
  const c15Route = [c, x];
  const rx = Math.abs(z.x - s.x),
    ry = Math.abs(z.y - s.y);
  const r2Route =
    rx > ry
      ? [s, { x: z.x + Math.sign(s.x - z.x) * ry, y: s.y }, z]
      : [s, { x: s.x, y: z.y + Math.sign(s.y - z.y) * rx }, z];
  const c16Route = [d, z];
  const recipes = [
    { from: xin, to: x1, route: xinRoute },
    { from: c15, to: x1, route: c15Route },
    { from: xout, to: r1, route: xoutRoute },
    { from: r2, to: x3, route: r2Route },
    { from: c16, to: x3, route: c16Route },
  ];
  const netNames = new Set<string>(),
    lengthsByNet: Record<string, number> = {},
    maximumByNet: Record<string, number> = {},
    diagnosticTraces: any[] = [],
    audit: RpClockPhase['audit'] = [];
  for (const [index, recipe] of recipes.entries()) {
    const net = one(
      graph.nets.filter(
        (n) =>
          n.pins.some((p) => p.ref === recipe.from.pin.ref && p.pad === recipe.from.pin.pad) &&
          n.pins.some((p) => p.ref === recipe.to.pin.ref && p.pad === recipe.to.pin.pad),
      ),
      `physical clock net ${recipe.from.selector}`,
    );
    const sourceNet = one(
      circuit.filter((e) => e.type === 'source_net' && e.name === net.name),
      `native net ${net.name}`,
    );
    const sourceTraces = circuit.filter(
      (e) => e.type === 'source_trace' && e.connected_source_net_ids?.includes(sourceNet.source_net_id),
    );
    if (
      !sourceTraces.length ||
      !sourceTraces.some((e) => e.connected_source_port_ids?.includes(recipe.from.source.source_port_id)) ||
      !sourceTraces.some((e) => e.connected_source_port_ids?.includes(recipe.to.source.source_port_id))
    )
      throw Error('RP clock source connection membership differs ' + net.name);
    const limits = sourceTraces.map((t) => t.max_length).filter((v) => v !== undefined);
    if (limits.some((v) => !finite(v) || v <= 0)) throw Error('Invalid native clock maximum length');
    maximumByNet[net.name] = Math.min(10, maximumByNet[net.name] ?? 10, ...limits);
    const points = recipe.route.filter((p, i, all) => i === 0 || distance(p, all[i - 1]!) > 1e-7);
    if (points.some((p) => !finite(p.x) || !finite(p.y))) throw Error('Nonfinite RP clock profile point');
    const len = length(points);
    if (len > 10 + 1e-9) throw Error('RP clock saved path exceeds native10mm maximum');
    const route: Wire[] = points.map((p) => ({
      ...world(p),
      route_type: 'wire',
      layer: 'top',
      width: WIDTH,
    }));
    if (distance(route[0]!, recipe.from.pcb) > EPS || distance(route.at(-1)!, recipe.to.pcb) > EPS)
      throw Error('RP clock saved endpoints differ from physical ports');
    lengthsByNet[net.name] = (lengthsByNet[net.name] ?? 0) + len;
    netNames.add(net.name);
    audit.push({ from: recipe.from.selector, to: recipe.to.selector, net: net.name, lengthMm: len, route });
    diagnosticTraces.push({
      type: 'pcb_trace',
      pcb_trace_id: `rp_clock_diagnostic_${index}`,
      source_trace_id: sourceTraces[0].source_trace_id,
      source_net_id: sourceNet.source_net_id,
      connection_name: sourceNet.source_net_id,
      connectsTo: [recipe.from.pcb.pcb_port_id, recipe.to.pcb.pcb_port_id],
      route: route.map((p, i) => ({
        ...p,
        ...(i === 0 ? { start_pcb_port_id: recipe.from.pcb.pcb_port_id } : {}),
        ...(i === route.length - 1 ? { end_pcb_port_id: recipe.to.pcb.pcb_port_id } : {}),
      })),
    });
  }
  for (const [net, total] of Object.entries(lengthsByNet))
    if (total > maximumByNet[net]! + 1e-9)
      throw Error(
        `RP clock native geometry: ${net} saved tree ${total.toFixed(6)}mm exceeds native ${maximumByNet[net]}mm maximum`,
      );
  const outline: Point[] =
    Array.isArray(board.outline) && board.outline.length >= 3
      ? board.outline
      : [
          { x: board.center.x - board.width / 2, y: board.center.y - board.height / 2 },
          { x: board.center.x + board.width / 2, y: board.center.y - board.height / 2 },
          { x: board.center.x + board.width / 2, y: board.center.y + board.height / 2 },
          { x: board.center.x - board.width / 2, y: board.center.y + board.height / 2 },
        ];
  if (outline.some((p) => !finite(p.x) || !finite(p.y)))
    throw Error('Unsupported native clock board outline');
  for (const path of audit)
    if (path.route.some((p) => !insidePolygon(p, outline)))
      throw Error('RP clock native geometry lies outside board outline');
  const input = structuredClone(circuit),
    checks = [...input, ...diagnosticTraces];
  // Native keepout checks currently cover pads/vias only. Project each hard
  // top keepout as foreign copper for the native trace geometry checks as well.
  for (const k of input.filter(
    (e) => e.type === 'pcb_keepout' && e.layers?.some((l: string) => l === 'top' || l === 'all'),
  )) {
    if (
      !['rect', 'rotated_rect'].includes(k.shape) ||
      ![k.center?.x, k.center?.y, k.width, k.height].every(finite)
    )
      throw Error('Unsupported native clock keepout geometry');
    checks.push({
      type: 'pcb_smtpad',
      pcb_smtpad_id: `rp_clock_keepout_${k.pcb_keepout_id}`,
      pcb_component_id: 'rp_clock_keepouts',
      shape: k.ccw_rotation ? 'rotated_rect' : 'rect',
      x: k.center.x,
      y: k.center.y,
      width: k.width,
      height: k.height,
      ccw_rotation: k.ccw_rotation ?? 0,
      layer: 'top',
    });
  }
  const clearance = Math.max(CLEARANCE, board.min_trace_to_pad_edge_clearance ?? CLEARANCE),
    holeClearance = Math.max(0.2, board.min_trace_to_hole_edge_clearance ?? 0.2);
  const errors = [
    ...checkEachPcbTraceNonOverlapping(checks, { minClearance: clearance }),
    ...checkPadTraceClearance(checks, { minClearance: clearance }),
    ...checkHoleTraceClearance(checks, { minClearance: holeClearance }),
    ...checkViaTraceClearance(checks, { minClearance: clearance }),
    ...checkPcbTracesOutOfBoard(checks, {
      margin: Math.max(CLEARANCE, board.min_board_edge_clearance ?? CLEARANCE),
    }),
    ...checkCopperToCutoutClearance(checks, { elementTypes: ['pcb_trace'] }),
    ...checkPcbTraceLengths(checks),
    ...checkPcbTraceViaCounts(checks),
  ];
  if (errors.length)
    throw Error('RP clock saved profile fails native geometry: ' + errors.map((e) => e.message).join('; '));
  return {
    scope: empty.scope,
    netNames: [...netNames],
    audit,
    lengthsByNet,
    props: {
      name: 'rp2040-clock-first',
      phaseIndex: 0,
      autorouter: 'auto',
      connections: audit.map((p) => p.from),
      pcbTracePaths: audit.map((p) => ({ connection: p.from, route: p.route })),
    },
  };
}
function containsPadPoint(p: any, point: Point): boolean {
  if (!finite(p.x) || !finite(p.y)) return false;
  const angle = (-(p.ccw_rotation ?? 0) * Math.PI) / 180,
    dx = point.x - p.x,
    dy = point.y - p.y,
    x = dx * Math.cos(angle) - dy * Math.sin(angle),
    y = dx * Math.sin(angle) + dy * Math.cos(angle);
  if (['rect', 'rotated_rect'].includes(p.shape) && finite(p.width) && finite(p.height))
    return Math.abs(x) <= p.width / 2 + EPS && Math.abs(y) <= p.height / 2 + EPS;
  if (['pill', 'rotated_pill'].includes(p.shape) && finite(p.width) && finite(p.height)) {
    const radius = Math.min(p.width, p.height) / 2;
    return p.width >= p.height
      ? Math.hypot(Math.max(0, Math.abs(x) - (p.width - p.height) / 2), y) <= radius + EPS
      : Math.hypot(x, Math.max(0, Math.abs(y) - (p.height - p.width) / 2)) <= radius + EPS;
  }
  if (p.shape === 'circle' && finite(p.radius)) return Math.hypot(dx, dy) <= p.radius + EPS;
  throw Error('Unsupported physical clock endpoint land geometry');
}

function insidePolygon(p: Point, outline: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!,
      b = outline[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
