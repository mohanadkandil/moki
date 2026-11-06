/** Exact origin-centred cardinal preconditioning of a bounded native SRJ.
 * No point interpolation, rounding, width/layer/source change or route search.
 * Unsupported constraint geometry fails closed rather than being left behind.
 */
type RecordValue = Record<string, any>;
export type RoutingFrameQuarter = 0 | 1 | 2 | 3;
const object = (o: unknown, label: string): RecordValue => {
  if (
    !o ||
    typeof o !== 'object' ||
    Array.isArray(o) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(o))
  )
    throw Error('Unsupported routing-frame ' + label);
  return o as RecordValue;
};
const keys = (o: RecordValue, names: readonly string[], label: string) => {
  const unsupported = Object.keys(o).find((k) => o[k] !== undefined && !names.includes(k));
  if (unsupported !== undefined) throw Error('Unsupported routing-frame ' + label + ' field: ' + unsupported);
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const strings = (v: any, label: string) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x))
    throw Error('Invalid routing-frame ' + label);
};
const turn = (p: RecordValue, q: RoutingFrameQuarter) =>
  q === 1
    ? { ...p, x: -p.y, y: p.x }
    : q === 2
      ? { ...p, x: -p.x, y: -p.y }
      : q === 3
        ? { ...p, x: p.y, y: -p.x }
        : { ...p };
const point = (p: unknown, label: string) => {
  const o = object(p, label);
  if (!finite(o.x) || !finite(o.y)) throw Error('Invalid routing-frame ' + label + ' coordinates');
  return o;
};
const layerNames = (count: number) =>
  count === 2 ? ['top', 'bottom'] : ['top', 'inner1', 'inner2', 'bottom'];
const metadata = (v: any) => {
  if (v === undefined) return;
  const m = object(v, 'metadata');
  keys(
    m,
    [
      'pcb_smtpad_id',
      'pcb_plated_hole_id',
      'pcb_port_id',
      'pcb_via_id',
      'source_component_name',
      'source_port_name',
    ],
    'metadata',
  );
  if (Object.values(m).some((x) => x !== undefined && typeof x !== 'string'))
    throw Error('Invalid routing-frame metadata');
};
const traceKeys = [
  'type',
  'pcb_trace_id',
  'connection_name',
  'connectsTo',
  'route',
  'source_trace_id',
  'source_net_id',
  'subcircuit_id',
  'rootConnectionName',
  'mergedConnectionNames',
  '__replaces_pcb_trace_id',
  'route_thickness_mode',
];
function traces(value: any, q: RoutingFrameQuarter, layers: string[]) {
  if (!Array.isArray(value)) throw Error('Invalid routing-frame traces');
  const ids = new Set<string>();
  return value.map((item: any) => {
    const t = object(item, 'trace');
    keys(t, traceKeys, 'trace');
    if (
      t.type !== 'pcb_trace' ||
      typeof t.pcb_trace_id !== 'string' ||
      !t.pcb_trace_id ||
      ids.has(t.pcb_trace_id) ||
      typeof t.connection_name !== 'string' ||
      !t.connection_name ||
      !Array.isArray(t.route) ||
      t.route.length < 2
    )
      throw Error('Invalid routing-frame trace identity/route');
    ids.add(t.pcb_trace_id);
    for (const k of ['connectsTo', 'mergedConnectionNames']) if (t[k] !== undefined) strings(t[k], k);
    for (const k of [
      'source_trace_id',
      'source_net_id',
      'subcircuit_id',
      'rootConnectionName',
      '__replaces_pcb_trace_id',
    ])
      if (t[k] !== undefined && typeof t[k] !== 'string') throw Error('Invalid routing-frame trace metadata');
    if (
      t.route_thickness_mode !== undefined &&
      !['constant', 'interpolated'].includes(t.route_thickness_mode)
    )
      throw Error('Unsupported routing-frame thickness mode');
    return {
      ...t,
      route: t.route.map((item: any) => {
        const p = point(item, 'route point');
        if (p.route_type === 'wire') {
          keys(p, ['route_type', 'x', 'y', 'width', 'layer', 'start_pcb_port_id', 'end_pcb_port_id'], 'wire');
          if (!finite(p.width) || p.width <= 0 || !layers.includes(p.layer))
            throw Error('Invalid routing-frame wire');
          for (const k of ['start_pcb_port_id', 'end_pcb_port_id'])
            if (p[k] !== undefined && typeof p[k] !== 'string') throw Error('Invalid routing-frame marker');
        } else if (p.route_type === 'via') {
          keys(
            p,
            ['route_type', 'x', 'y', 'from_layer', 'to_layer', 'layers', 'via_diameter', 'via_hole_diameter'],
            'via',
          );
          if (!layers.includes(p.from_layer) || !layers.includes(p.to_layer) || p.from_layer === p.to_layer)
            throw Error('Invalid routing-frame via layers');
          for (const k of ['via_diameter', 'via_hole_diameter'])
            if (p[k] !== undefined && (!finite(p[k]) || p[k] <= 0))
              throw Error('Invalid routing-frame via size');
          if (p.layers !== undefined) {
            strings(p.layers, 'via layers');
            if (p.layers.some((l: string) => !layers.includes(l)))
              throw Error('Invalid routing-frame via span');
          }
        } else throw Error('Unsupported routing-frame route geometry');
        return turn(p, q);
      }),
    };
  });
}
const numbers = [
  'minTraceWidth',
  'nominalTraceWidth',
  'minViaDiameter',
  'minViaHoleDiameter',
  'minViaPadDiameter',
  'min_via_hole_diameter',
  'min_via_pad_diameter',
  'defaultObstacleMargin',
  'minTraceToPadEdgeClearance',
  'minTraceToHoleEdgeClearance',
  'minBoardEdgeClearance',
  'minViaEdgeToPadEdgeClearance',
  'minViaHoleEdgeToViaHoleEdgeClearance',
  'minPlatedHoleDrillEdgeToDrillEdgeClearance',
  'minPadEdgeToPadEdgeClearance',
];
const booleans = ['allowBlindAndBuriedVias', 'allowViaInPad', 'allowJumpers'];
export function rotateNativeRoutingFrame(value: any, quarterTurns: RoutingFrameQuarter) {
  if (!Number.isInteger(quarterTurns) || quarterTurns < 0 || quarterTurns > 3)
    throw Error('Routing-frame quarter must be 0–3');
  const original = object(value, 'input');
  keys(
    original,
    [
      'layerCount',
      'bounds',
      'outline',
      'obstacles',
      'connections',
      'traces',
      'fixedTraces',
      ...numbers,
      ...booleans,
    ],
    'input',
  );
  if (![2, 4].includes(original.layerCount)) throw Error('Routing-frame needs two/four physical layers');
  for (const k of numbers)
    if (original[k] !== undefined && (!finite(original[k]) || original[k] < 0))
      throw Error('Invalid routing-frame scalar rule');
  if (!finite(original.minTraceWidth) || original.minTraceWidth <= 0)
    throw Error('Invalid routing-frame minimum trace width');
  for (const k of booleans)
    if (original[k] !== undefined && typeof original[k] !== 'boolean')
      throw Error('Invalid routing-frame boolean rule');
  if (original.allowJumpers === true) throw Error('Unsupported routing-frame jumper geometry');
  const q = quarterTurns,
    layers = layerNames(original.layerCount),
    input = structuredClone(original),
    b = object(input.bounds, 'bounds');
  keys(b, ['minX', 'maxX', 'minY', 'maxY'], 'bounds');
  if (![b.minX, b.maxX, b.minY, b.maxY].every(finite) || b.maxX <= b.minX || b.maxY <= b.minY)
    throw Error('Invalid routing-frame bounds');
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.minX, y: b.maxY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
  ].map((p) => turn(p, q));
  input.bounds = {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
  if (input.outline !== undefined) {
    if (!Array.isArray(input.outline) || input.outline.length < 3)
      throw Error('Invalid routing-frame outline');
    input.outline = input.outline.map((v: any) => {
      const p = point(v, 'outline');
      keys(p, ['x', 'y'], 'outline');
      return turn(p, q);
    });
  }
  if (!Array.isArray(input.obstacles) || !Array.isArray(input.connections))
    throw Error('Invalid routing-frame collections');
  input.obstacles = input.obstacles.map((v: any) => {
    const o = object(v, 'obstacle');
    keys(
      o,
      [
        'obstacleId',
        'componentId',
        'isFanoutSourceKeepout',
        'isNonPlatedHole',
        'shape',
        'circuitJsonMetadata',
        'type',
        'layers',
        'zLayers',
        '__zLayers',
        'center',
        'width',
        'height',
        'ccwRotationDegrees',
        'connectedTo',
        'isCopperPour',
        'netIsAssignable',
        'offBoardConnectsTo',
      ],
      'obstacle',
    );
    if (
      !['rect', 'oval'].includes(o.type) ||
      !finite(o.width) ||
      !finite(o.height) ||
      o.width <= 0 ||
      o.height <= 0
    )
      throw Error('Unsupported routing-frame obstacle geometry');
    const c = point(o.center, 'obstacle center');
    keys(c, ['x', 'y'], 'obstacle center');
    strings(o.layers, 'obstacle layers');
    if (!o.layers.length || o.layers.some((l: string) => !layers.includes(l)))
      throw Error('Invalid routing-frame obstacle layers');
    strings(o.connectedTo, 'obstacle connections');
    if (o.offBoardConnectsTo !== undefined) strings(o.offBoardConnectsTo, 'off-board aliases');
    metadata(o.circuitJsonMetadata);
    for (const k of ['obstacleId', 'componentId'])
      if (o[k] !== undefined && typeof o[k] !== 'string')
        throw Error('Invalid routing-frame obstacle identity');
    for (const k of ['isFanoutSourceKeepout', 'isNonPlatedHole', 'isCopperPour', 'netIsAssignable'])
      if (o[k] !== undefined && typeof o[k] !== 'boolean') throw Error('Invalid routing-frame obstacle flag');
    for (const k of ['zLayers', '__zLayers'])
      if (
        o[k] !== undefined &&
        (!Array.isArray(o[k]) ||
          o[k].some((z: any) => !Number.isInteger(z) || z < 0 || z >= original.layerCount))
      )
        throw Error('Invalid routing-frame z layers');
    if (o.shape !== undefined && (o.shape !== 'circle' || o.width !== o.height))
      throw Error('Unsupported routing-frame obstacle shape');
    if (
      o.ccwRotationDegrees !== undefined &&
      (!finite(o.ccwRotationDegrees) || o.ccwRotationDegrees % 90 !== 0)
    )
      throw Error('Unsupported routing-frame noncardinal obstacle');
    return {
      ...o,
      center: turn(c, q),
      ...(o.ccwRotationDegrees !== undefined
        ? {
            ccwRotationDegrees: q
              ? (((o.ccwRotationDegrees + 90 * q) % 360) + 360) % 360
              : o.ccwRotationDegrees,
          }
        : q % 2
          ? { width: o.height, height: o.width }
          : {}),
    };
  });
  input.connections = input.connections.map((v: any) => {
    const c = object(v, 'connection');
    keys(
      c,
      [
        'name',
        'routingPcbGroupId',
        'source_trace_id',
        'rootConnectionName',
        'mergedConnectionNames',
        '__rootConnectionNames',
        'isOffBoard',
        'netConnectionName',
        '__netConnectionName',
        'nominalTraceWidth',
        'width',
        'pointsToConnect',
      ],
      'connection',
    );
    if (typeof c.name !== 'string' || !c.name || !Array.isArray(c.pointsToConnect))
      throw Error('Invalid routing-frame connection');
    for (const k of [
      'routingPcbGroupId',
      'source_trace_id',
      'rootConnectionName',
      'netConnectionName',
      '__netConnectionName',
    ])
      if (c[k] !== undefined && typeof c[k] !== 'string')
        throw Error('Invalid routing-frame connection identity');
    for (const k of ['mergedConnectionNames', '__rootConnectionNames'])
      if (c[k] !== undefined) strings(c[k], k);
    for (const k of ['width', 'nominalTraceWidth'])
      if (c[k] !== undefined && (!finite(c[k]) || c[k] <= 0))
        throw Error('Invalid routing-frame connection width');
    if (c.isOffBoard !== undefined && typeof c.isOffBoard !== 'boolean')
      throw Error('Invalid routing-frame off-board flag');
    return {
      ...c,
      pointsToConnect: c.pointsToConnect.map((v: any) => {
        const p = point(v, 'terminal');
        keys(
          p,
          ['x', 'y', 'layer', 'layers', 'pointId', 'pcb_port_id', 'port_selector', 'busId', 'terminalVia'],
          'terminal',
        );
        if ((p.layer !== undefined) === (p.layers !== undefined))
          throw Error('Unsupported routing-frame mixed terminal layers');
        if (p.layer !== undefined && !layers.includes(p.layer))
          throw Error('Invalid routing-frame terminal layer');
        if (p.layers !== undefined) {
          strings(p.layers, 'terminal layers');
          if (!p.layers.length || p.layers.some((l: string) => !layers.includes(l)))
            throw Error('Invalid routing-frame terminal layers');
        }
        for (const k of ['pointId', 'pcb_port_id', 'port_selector', 'busId'])
          if (p[k] !== undefined && typeof p[k] !== 'string')
            throw Error('Invalid routing-frame terminal identity');
        if (p.terminalVia !== undefined) {
          const t = object(p.terminalVia, 'terminal via');
          keys(t, ['toLayer', 'viaDiameter'], 'terminal via');
          if (
            p.layers !== undefined ||
            !layers.includes(t.toLayer) ||
            (t.viaDiameter !== undefined && (!finite(t.viaDiameter) || t.viaDiameter <= 0))
          )
            throw Error('Invalid routing-frame terminal via');
        }
        return turn(p, q);
      }),
    };
  });
  for (const k of ['traces', 'fixedTraces'])
    if (input[k] !== undefined) input[k] = traces(input[k], q, layers);
  const inverseQuarter = ((4 - q) % 4) as RoutingFrameQuarter;
  return {
    input: q ? input : value,
    inverseTraces: (output: any[]) => {
      const result = traces(structuredClone(output), inverseQuarter, layers);
      return q ? result : output;
    },
    audit: {
      quarterTurns: q,
      inverseQuarterTurns: inverseQuarter,
      origin: { x: 0, y: 0 },
      method: 'exact-cardinal-coordinate-frame',
      obstacles: input.obstacles.length,
      connectionPoints: input.connections.reduce((n: number, c: any) => n + c.pointsToConnect.length, 0),
    },
  };
}
