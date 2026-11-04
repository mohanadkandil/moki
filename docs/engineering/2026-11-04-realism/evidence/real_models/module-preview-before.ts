// One source of module geometry for board.glb and the enclosure. The enclosure's openings are fitted to
// these blocks, so a preview built from them shows the shaft under its hole and the USB at its opening.
// Importable from src/board with a '.js' specifier: this file and module-mech.ts need only the catalog.
import { moduleDef } from '../../src/circuit/catalog.js';
import { MODULE_MECH, type BlockColor, type LocalBlock } from './module-mech.js';

const JSCAD_RGB: Record<BlockColor, [number, number, number]> = {
  socket: [0.05, 0.05, 0.06], plastic: [0.1, 0.1, 0.11], 'pcb-blue': [0.08, 0.2, 0.55], 'pcb-black': [0.06, 0.07, 0.08], 'pcb-dark': [0.08, 0.14, 0.1],
  metal: [0.72, 0.73, 0.75], glass: [0.03, 0.03, 0.04], active: [0.2, 0.75, 1], amber: [0.95, 0.55, 0.08], resistor: [0.55, 0.42, 0.28],
};

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

/** The same blocks as a tscircuit cadModel. A drop-in replacement for src/board/preview-model.ts. */
export function modulePreviewPlan(moduleId: string): { jscad: Record<string, unknown>; modelOriginPosition: { x: number; y: number; z: number } } {
  const shapes = moduleBlocksCentered(moduleId).map(block => {
    const height = block.z1 - block.z0;
    const center = [block.x, block.y, block.z0 + height / 2];
    return {
      type: 'colorize', color: JSCAD_RGB[block.color],
      shape: block.shape === 'box' ? { type: 'cuboid', size: [block.w, block.h, height], center } : { type: 'cylinder', radius: block.w / 2, height, center, segments: 28 },
    };
  });
  return { jscad: { type: 'union', shapes }, modelOriginPosition: { x: 0, y: 0, z: 0 } };
}
