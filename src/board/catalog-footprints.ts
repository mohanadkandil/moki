import { CATALOG, moduleDef } from '../circuit/catalog.js';

export interface CarrierPin { id: string; number: number; x: number; y: number; holeDiameter: number; outerDiameter: number }
export interface CarrierFootprint {
  module: string;
  kind: 'female-header' | 'through-hole';
  footprint: string;
  pinLabels: Record<string, string>;
  pins: CarrierPin[];
  dimensionsVerified: false;
  warning: string;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Keep catalog coordinates verbatim (only translating to a centered, +Y-up PCB frame).
 * The catalog is illustrative: these are prototype footprints, never measured fit claims. */
export function footprintFor(moduleId: string): CarrierFootprint {
  const module = moduleDef(moduleId);
  const kind = ['controller', 'display', 'input'].includes(module.category) || module.drawing === 'bme280' ? 'female-header' : 'through-hole';
  const pins = module.pins.map((p, i) => ({ id: p.id, number: i + 1,
    x: round(p.physical.x - module.size.w / 2), y: round(module.size.h / 2 - p.physical.y),
    holeDiameter: module.drawing === 'to92' ? 0.6 : kind === 'female-header' ? 1 : 0.8,
    outerDiameter: module.drawing === 'to92' ? 1.05 : kind === 'female-header' ? 1.8 : 1.6,
  }));
  return { module: moduleId, kind, footprint: `moki:${moduleId}`, pins,
    pinLabels: Object.fromEntries(pins.map(p => [`pin${p.number}`, p.id])), dimensionsVerified: false,
    warning: `${module.name}: footprint follows approximate catalog physical pins; verify pitch, row spacing, pin order and module outline on the actual part before fabrication. No exact module CAD model is available.`,
  };
}
export const CATALOG_FOOTPRINTS: ReadonlyMap<string, CarrierFootprint> = new Map([...CATALOG.keys()].map(id => [id, footprintFor(id)]));
