// One source of module geometry for board.glb and the enclosure. The enclosure's openings are fitted to
// these blocks, so a preview built from them shows the shaft under its hole and the USB at its opening.
// Importable from src/board with a '.js' specifier: this file and module-mech.ts need only the catalog.
import { detailedModulePieces } from '../models/catalog-models.js';
import { moduleDef } from '../../src/circuit/catalog.js';
import { MODULE_MECH, type LocalBlock } from './module-mech.js';

/** The module's blocks about its footprint origin (the catalog outline centre), y up, z above the carrier. */
export function moduleBlocksCentered(moduleId: string): LocalBlock[] {
  const def = moduleDef(moduleId);
  const mech = MODULE_MECH[moduleId];
  if (!mech) throw new Error(`No mechanical data for ${moduleId}`);
  const top = mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm;
  // Leaded parts: the catalog outline is a wiring sketch, so the blocks centre on the pads, as in handoff.ts.
  const leaded = Boolean(mech.bodyMm);
  const padX = def.pins.reduce((sum, p) => sum + p.physical.x, 0) / def.pins.length - def.size.w / 2;
  const padY = def.size.h / 2 - def.pins.reduce((sum, p) => sum + p.physical.y, 0) / def.pins.length;
  return mech.blocks(def.size.w, def.size.h, top).map(block => ({
    ...block,
    x: leaded ? padX + block.x : block.x - def.size.w / 2,
    y: leaded ? padY - block.y : def.size.h / 2 - block.y,
  }));
}

/** Serializable detailed plans, still anchored to the unchanged mechanical frame.
 * The glTF stage evaluates shapes separately so boolean union cannot erase their materials.
 */
export function modulePreviewPlan(moduleId: string, value?: string): { jscad: Record<string, unknown>; modelOriginPosition: { x: number; y: number; z: number } } {
  const pieces = detailedModulePieces(moduleId, value);
  return { jscad: { type: 'union', shapes: pieces.map(p => p.plan), moki: { moduleId, roles: pieces.map(p => p.role) } }, modelOriginPosition: { x: 0, y: 0, z: 0 } };
}
