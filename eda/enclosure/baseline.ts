// The create-fdm-enclosure baseline: a fast mesh box from the same handoff. It stays as the fallback
// when build123d is unavailable and as a comparison point. The package has no mounting bosses, so
// standoffs are added here. Its lid is friction-fit only.
import { createFdmEnclosure, type EnclosureApertureInput } from '@tscircuit/create-fdm-enclosure';
import jscad from '@jscad/modeling';
import { executeJscadOperations } from 'jscad-planner';
import { checkMesh, type MeshCheck } from './stl.ts';
import type { MechHandoff } from './handoff.ts';

const WALL = 2; const FLOOR = 2; const LID = 2; const FIT = 0.3; const STANDOFF = 5; const HEADROOM = 0.5; const USB_ABOVE_SEAM = 1.5; const LIP = 2.5;
const VENT = { width: 2, height: 10, pitch: 5, count: 8, cornerKeep: 10 };

export interface BaselineResult {
  base: Float32Array; lid: Float32Array; baseCheck: MeshCheck; lidCheck: MeshCheck;
  dimensions: { x: number; y: number; z: number; seamZ: number; boardBottomZ: number; boardTopZ: number };
  offset: { x: number; y: number }; apertures: number; warnings: string[];
}

function triangulate(geometry: any): Float32Array {
  const polygons: Array<{ vertices: number[][] }> = jscad.geometries.geom3.toPolygons(geometry) as never;
  const out: number[] = [];
  for (const { vertices } of polygons) {
    for (let i = 1; i + 1 < vertices.length; i++) out.push(...vertices[0]!, ...vertices[i]!, ...vertices[i + 1]!);
  }
  return new Float32Array(out);
}

export function buildBaseline(handoff: MechHandoff): BaselineResult {
  const { board, parts, apertures } = handoff;
  let minX = board.center.x - board.widthMm / 2; let maxX = board.center.x + board.widthMm / 2;
  let minY = board.center.y - board.heightMm / 2; let maxY = board.center.y + board.heightMm / 2;
  for (const p of parts) { minX = Math.min(minX, p.bbox.minX); maxX = Math.max(maxX, p.bbox.maxX); minY = Math.min(minY, p.bbox.minY); maxY = Math.max(maxY, p.bbox.maxY); }
  // The solver centres the board in the box. The envelope becomes its "board", which keeps an overhanging USB shell inside.
  const offset = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const fixed = parts.filter(p => !p.stack.raisedToLid);
  let headroom = Math.max(0, ...fixed.map(p => p.stack.topMm)) + HEADROOM;
  for (const a of apertures) if (a.face !== 'z_pos') headroom = Math.max(headroom, a.zMm + a.heightMm / 2 + USB_ABOVE_SEAM);

  const input: EnclosureApertureInput[] = [];
  for (const a of apertures) {
    const center = { x: a.center.x - offset.x, y: a.center.y - offset.y };
    if (a.face !== 'z_pos') input.push({ shape: 'pill', face: a.face, center, width: a.widthMm, height: a.heightMm, depth: 2, heightDimensionOffset: a.zMm - a.heightMm / 2 });
    else if (a.shape === 'circle') input.push({ shape: 'circle', face: 'z_pos', center, radius: a.widthMm / 2 });
    else if (a.shape === 'rect') input.push({ shape: 'rect', face: 'z_pos', center, width: a.widthMm, height: a.heightMm, rotation: a.rotationDeg });
    else if (a.grid) {
      const theta = (a.rotationDeg * Math.PI) / 180;
      for (let c = 0; c < a.grid.columns; c++) for (let r = 0; r < a.grid.rows; r++) {
        const lx = (c - (a.grid.columns - 1) / 2) * a.grid.pitchMm; const ly = (r - (a.grid.rows - 1) / 2) * a.grid.pitchMm;
        input.push({ shape: 'circle', face: 'z_pos', center: { x: center.x + lx * Math.cos(theta) - ly * Math.sin(theta), y: center.y + lx * Math.sin(theta) + ly * Math.cos(theta) }, radius: a.grid.holeMm / 2 });
      }
    }
  }
  const envelopeW = maxX - minX; const envelopeH = maxY - minY;
  const usesXWall = apertures.some(a => a.face === 'x_pos' || a.face === 'x_neg');
  for (const face of usesXWall ? (['y_pos', 'y_neg'] as const) : (['x_pos', 'x_neg'] as const)) {
    const span = usesXWall ? envelopeW : envelopeH;
    const count = Math.min(VENT.count, Math.floor((span - 2 * VENT.cornerKeep) / VENT.pitch));
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * VENT.pitch;
      // Vents sit near the mounting plane, below the lid lip.
      input.push({ shape: 'rect', face, center: usesXWall ? { x: along, y: 0 } : { x: 0, y: along }, width: VENT.width, height: VENT.height, heightDimensionOffset: -VENT.height / 2 + 1 });
    }
  }
  const output = createFdmEnclosure({
    board: { width: envelopeW, height: envelopeH, thickness: board.thicknessMm }, apertures: input,
    wallThickness: WALL, floorThickness: FLOOR, lidThickness: LID, boardClearance: FIT, standoffHeight: STANDOFF,
    topHeadroom: headroom, lidLipDepth: LIP, fdmRules: { slidingFitClearance: 2 * FIT },
  });
  const planOf = (id: string) => output.parts.find(p => p.id === id)!.jscadPlan;
  const baseShell = executeJscadOperations(jscad as never, planOf('base')) as never;
  const lidShell = executeJscadOperations(jscad as never, planOf('lid')) as never;
  const { booleans, primitives, transforms } = jscad;
  const boardBottomZ = FLOOR + STANDOFF;
  // Standoffs with a 2.6 mm pilot. The board screws down onto them from above.
  const posts = board.holes.map(h => transforms.translate([h.x - offset.x, h.y - offset.y, FLOOR - 0.1 + (STANDOFF + 0.1) / 2], primitives.cylinder({ radius: 3, height: STANDOFF + 0.1, segments: 32 })));
  const pilots = board.holes.map(h => transforms.translate([h.x - offset.x, h.y - offset.y, boardBottomZ - 3], primitives.cylinder({ radius: 1.3, height: 6.2, segments: 24 })));
  const baseWithPosts = posts.length ? booleans.subtract(booleans.union(baseShell, ...posts), ...pilots) : baseShell;
  const base = triangulate(baseWithPosts);
  // STL print pose: outer lid face down.
  const totalZ = output.dimensions.depth;
  const lidFlipped = transforms.translate([0, 0, totalZ], transforms.rotateX(Math.PI, lidShell));
  const lid = triangulate(lidFlipped);
  const warnings = ['The baseline is a mesh box with no STEP export. Its lid is friction-fit only, with no lid pillars, and the board screws to the standoffs from above.'];
  const baseCheck = checkMesh(base); const lidCheck = checkMesh(lid);
  if (!baseCheck.watertight || !lidCheck.watertight) warnings.push(`The baseline STLs are not edge-manifold (base: ${baseCheck.boundaryEdges} open and ${baseCheck.nonManifoldEdges} non-manifold edges; lid: ${lidCheck.boundaryEdges} open and ${lidCheck.nonManifoldEdges} non-manifold edges). JSCAD booleans leave T-junctions, so a slicer may need to repair them.`);
  return { base, lid, baseCheck, lidCheck, offset, apertures: input.length, warnings,
    dimensions: { x: output.dimensions.width, y: output.dimensions.height, z: totalZ, seamZ: output.frame.seamZ, boardBottomZ, boardTopZ: boardBottomZ + board.thicknessMm } };
}
