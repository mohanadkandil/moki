import { SOLVERS } from 'tscircuit';

const STITCH_OPTIONS = {
  layers: ['top', 'bottom'],
  viaHoleDiameter: .3,
  viaOuterDiameter: .6,
  viaStitchPitch: .25,
  pourEdgeClearance: .2,
  obstacleClearance: .2,
  minimumViaSeparation: .8,
  isTented: true,
};
const EPS = 1e-6;
const MAX_GRID_CANDIDATES = 100_000;
const MAX_VIAS_PER_ISLAND = 64;

interface UnsupportedStitch {
  pourId: string;
  code: 'too-narrow' | 'roi-too-large' | 'no-legal-stitch' | 'solver-failed' | 'too-many-vias';
  reason: string;
}

/** Propose native stitching copper only. This does not insert or accept vias.
 * The pinned native solver does not consult trace/keepout obstacles directly;
 * callers must run fresh official placement/routing/keepout DRC and independent
 * physical continuity on the complete candidate before accepting any proposal.
 * Preserve component obstruction flags and every original conductor/obstacle.
 */
export function proposalGroundStitches(cj: any[], islandPourIds: readonly string[]) {
  if (!Array.isArray(cj) || !Array.isArray(islandPourIds) || islandPourIds.length > 64 || islandPourIds.some((id) => typeof id !== 'string' || !id.length || id.length > 200) || new Set(islandPourIds).size !== islandPourIds.length) throw new Error('Ground stitching requires a circuit and at most64 unique native island pour IDs');
  const boards = cj.filter((item) => item.type === 'pcb_board');
  if (boards.length !== 1) throw new Error('Ground stitching requires exactly one native PCB board');
  const board = boards[0];
  if (![2, 4].includes(board.num_layers) || !Number.isFinite(board.center?.x) || !Number.isFinite(board.center?.y) || !Number.isFinite(board.width) || !Number.isFinite(board.height) || board.width <= 0 || board.height <= 0) throw new Error('Ground stitching requires valid native2/4-layer board bounds');
  const layers = board.num_layers === 4 ? ['top', 'inner1', 'inner2', 'bottom'] : ['top', 'bottom'];
  const grounds = cj.filter((item) => item.type === 'source_net' && item.name === 'GND');
  if (grounds.length !== 1 || grounds[0].is_ground !== true || typeof grounds[0].source_net_id !== 'string') throw new Error('Ground stitching requires exactly one actual native ground net named GND');
  const ground = grounds[0];
  const bounds = {
    minX: board.center.x - board.width / 2, maxX: board.center.x + board.width / 2,
    minY: board.center.y - board.height / 2, maxY: board.center.y + board.height / 2,
  };
  const validatePour = (pour: any) => {
    const shape = pour.brep_shape;
    if (pour.subcircuit_id !== board.subcircuit_id) throw new Error(`Ground pour ${pour.pcb_copper_pour_id} belongs to another native board scope`);
    if (pour.shape !== 'brep' || !Array.isArray(shape?.outer_ring?.vertices) || shape.outer_ring.vertices.length < 3 || !Array.isArray(shape.inner_rings)) throw new Error(`Ground pour ${pour.pcb_copper_pour_id} lacks native BREP geometry`);
    for (const ring of [shape.outer_ring, ...shape.inner_rings]) {
      if (!Array.isArray(ring.vertices) || ring.vertices.length < 3 || ring.vertices.some((point: any) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < bounds.minX - EPS || point.x > bounds.maxX + EPS || point.y < bounds.minY - EPS || point.y > bounds.maxY + EPS)) throw new Error(`Ground pour ${pour.pcb_copper_pour_id} has invalid or out-of-board ring bounds`);
    }
    const vertices = shape.outer_ring.vertices;
    return { minX: Math.min(...vertices.map((point: any) => point.x)), maxX: Math.max(...vertices.map((point: any) => point.x)), minY: Math.min(...vertices.map((point: any) => point.y)), maxY: Math.max(...vertices.map((point: any) => point.y)) };
  };
  const bottoms = cj.filter((item) => item.type === 'pcb_copper_pour' && item.layer === 'bottom' && item.source_net_id === ground.source_net_id);
  if (islandPourIds.length && !bottoms.length) throw new Error('Ground stitching requires actual bottom GND pour geometry');
  for (const pour of bottoms) validatePour(pour);
  const vias: any[] = [];
  const audit: Array<{ pourId: string; sourceNetId: string; roiBounds: ReturnType<typeof validatePour>; options: typeof STITCH_OPTIONS & { sourceNetIds: string[] }; inputElementCount: number; retainedBottomPourIds: string[]; nativeProcessedPourPairs?: number; nativeViaCount: number; proposedViaIds: string[]; requiresFreshDrcAndPhysicalContinuity: true; notes: string[] }> = [];
  const unsupported: UnsupportedStitch[] = [];
  const occupiedIds = new Set(cj.filter((item) => item.type === 'pcb_via').map((item) => item.pcb_via_id));
  for (const pourId of [...islandPourIds].sort()) {
    const matches = cj.filter((item) => item.type === 'pcb_copper_pour' && item.pcb_copper_pour_id === pourId);
    if (matches.length !== 1 || matches[0].layer !== 'top' || matches[0].source_net_id !== ground.source_net_id || matches[0].subcircuit_id !== board.subcircuit_id) throw new Error(`Island ${pourId} must identify one actual top GND pour on the native board`);
    const roiBounds = validatePour(matches[0]);
    const width = roiBounds.maxX - roiBounds.minX, height = roiBounds.maxY - roiBounds.minY;
    const requiredDiameter = STITCH_OPTIONS.viaOuterDiameter + 2 * STITCH_OPTIONS.pourEdgeClearance;
    if (width + EPS < requiredDiameter || height + EPS < requiredDiameter) {
      unsupported.push({ pourId, code: 'too-narrow', reason: `Native pour bounds ${width.toFixed(6)}x${height.toFixed(6)}mm cannot fit ${requiredDiameter.toFixed(3)}mm copper diameter including unchanged pour-edge clearance` });
      continue;
    }
    if ((Math.ceil(width / STITCH_OPTIONS.viaStitchPitch) + 1) * (Math.ceil(height / STITCH_OPTIONS.viaStitchPitch) + 1) > MAX_GRID_CANDIDATES) {
      unsupported.push({ pourId, code: 'roi-too-large', reason: 'Island grid exceeds the bounded native proposal budget' });
      continue;
    }
    // Remove only other TOP GND pour regions to bound the native search domain.
    // Every bottom pour, pad, hole, component, trace and keepout remains present.
    const input = structuredClone([...cj.filter((item) => !(item.type === 'pcb_copper_pour' && item.layer === 'top' && item.source_net_id === ground.source_net_id && item.pcb_copper_pour_id !== pourId)), ...vias]);
    const options = { ...STITCH_OPTIONS, layers: ['top', 'bottom'] as ['top', 'bottom'], sourceNetIds: [ground.source_net_id] };
    const row: typeof audit[number] = { pourId, sourceNetId: ground.source_net_id, roiBounds, options, inputElementCount: input.length, retainedBottomPourIds: bottoms.map((pour) => pour.pcb_copper_pour_id), nativeViaCount: 0, proposedViaIds: [], requiresFreshDrcAndPhysicalContinuity: true, notes: ['Native solver handles pads, holes and obstructing components; trace and keepout acceptance requires final official checks', 'Through barrels span every actual board copper layer; no component obstruction flag is relaxed'] };
    audit.push(row);
    let output: any;
    try {
      const solver = new SOLVERS.ViaStitchSolver({ circuitJson: input, options });
      solver.solve();
      if (solver.failed || !solver.solved) throw new Error(solver.error ?? 'Native via stitch solver did not solve');
      output = solver.getOutput();
    } catch (error) {
      unsupported.push({ pourId, code: 'solver-failed', reason: String(error) });
      continue;
    }
    if (!Array.isArray(output.pcbVias)) throw new Error('Native stitch solver returned malformed geometry');
    row.nativeProcessedPourPairs = output.processedCopperPourPairCount;
    row.nativeViaCount = output.pcbVias.length;
    if (!output.pcbVias.length) {
      unsupported.push({ pourId, code: 'no-legal-stitch', reason: 'Native solver found no stitch with0.3mm drill,0.6mm outer diameter and unchanged0.2mm pour/obstacle clearances' });
      continue;
    }
    if (output.pcbVias.length > MAX_VIAS_PER_ISLAND) {
      unsupported.push({ pourId, code: 'too-many-vias', reason: 'Native stitch output exceeds64vias for one island; proposal is not applied' });
      continue;
    }
    const nativeIds = new Set<string>();
    for (const via of output.pcbVias) {
      if (via.type !== 'pcb_via' || typeof via.pcb_via_id !== 'string' || !via.pcb_via_id.length || occupiedIds.has(via.pcb_via_id) || nativeIds.has(via.pcb_via_id) || via.source_net_id !== ground.source_net_id || !Number.isFinite(via.x) || !Number.isFinite(via.y) || !Number.isFinite(via.hole_diameter) || !Number.isFinite(via.outer_diameter) || via.x < roiBounds.minX - EPS || via.x > roiBounds.maxX + EPS || via.y < roiBounds.minY - EPS || via.y > roiBounds.maxY + EPS || Math.abs(via.hole_diameter - STITCH_OPTIONS.viaHoleDiameter) > EPS || Math.abs(via.outer_diameter - STITCH_OPTIONS.viaOuterDiameter) > EPS || via.from_layer !== 'top' || via.to_layer !== 'bottom') throw new Error(`Native stitch output for ${pourId} violates its pinned identity, dimensions or layer bounds`);
      nativeIds.add(via.pcb_via_id);
    }
    for (const via of output.pcbVias) {
      // Top-to-bottom is a physical through via on this2/4-layer board.
      // Expand emitted copper layers before any validation or fabrication export.
      vias.push({ ...via, layers: [...layers] });
      occupiedIds.add(via.pcb_via_id);
      row.proposedViaIds.push(via.pcb_via_id);
    }
  }
  return { vias, audit, unsupported };
}
