// What the 3D stage can say about a node in board.glb or assembly.glb. No three.js in here, so it stays testable.
import { CATALOG } from '../../../src/circuit/catalog';

export interface PartRef { ref: string; moduleId: string | null; socket: boolean }

const REFDES = /^[A-Z]{1,3}\d+$/;

/**
 * Reads a raw glTF node name, not `object.name`: GLTFLoader strips ':' from that one, and the raw name is kept in `userData.name`.
 * The names in use: U1:esp32-devkitc-v4 and U1:socket from the board stage, modules-U1 from the assembly, and plain U1 in older jobs.
 */
export function partOfNode(raw: string | undefined, extras?: unknown): PartRef | null {
  if (!raw) return null;
  const moki = (extras as { moki?: { module?: unknown } } | undefined)?.moki;
  const fromExtras = typeof moki?.module === 'string' ? moki.module : null;
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const ref = raw.slice(0, colon);
    const rest = raw.slice(colon + 1);
    if (!REFDES.test(ref)) return null;
    return rest === 'socket' ? { ref, moduleId: fromExtras, socket: true } : { ref, moduleId: rest || fromExtras, socket: false };
  }
  const ref = raw.startsWith('modules-') ? raw.slice('modules-'.length) : raw;
  return REFDES.test(ref) ? { ref, moduleId: fromExtras, socket: false } : null;
}

/** "U1 · ESP32-DevKitC V4". An older job has no module id on its nodes, so it gets the refdes alone. */
export function partLabel(ref: string, moduleId: string | null): { ref: string; name: string | null } {
  return { ref, name: moduleId ? CATALOG.get(moduleId)?.name ?? null : null };
}

/** How high a node rises in the exploded view, as a share of the model's height. The base stays on the bench. */
export const LIFT = { lid: 3, modules: 1.45, board: 0.7 };

export function liftShare(raw: string): number {
  if (raw === 'enclosure-lid') return LIFT.lid;
  if (raw === 'Box0') return LIFT.board;
  const part = partOfNode(raw);
  if (!part) return 0;
  // Sockets are soldered to the board, so they travel with it.
  return part.socket ? LIFT.board : LIFT.modules;
}

/** Artifact names people act on rather than read. Everything else is listed by its file name. */
const ARTIFACT_ACTIONS: Readonly<Record<string, string>> = { 'kicad.zip': 'Open in KiCad' };

export const artifactAction = (name: string): string | null => ARTIFACT_ACTIONS[name] ?? null;

/** Solder mask colours the GLB can carry, as real_models' contract names them. The hex is only the swatch. */
export const MASKS = [
  { id: 'green', label: 'Green', swatch: '#1f6b43' },
  { id: 'black', label: 'Black', swatch: '#16181a' },
  { id: 'blue', label: 'Blue', swatch: '#1c4a94' },
  { id: 'white', label: 'White', swatch: '#efeee8' },
] as const;
export type MaskId = (typeof MASKS)[number]['id'];

export type MaskMaterials = Partial<Record<MaskId, readonly [number, number]>>;

/** The colour-to-material map from `asset.extras.moki`. A GLB without one gets no picker. */
export function readMaskMaterials(asset: unknown): MaskMaterials | null {
  const map = (asset as { extras?: { moki?: { maskMaterials?: unknown } } } | undefined)?.extras?.moki?.maskMaterials;
  if (!map || typeof map !== 'object') return null;
  const found: MaskMaterials = {};
  for (const { id } of MASKS) {
    const pair = (map as Record<string, unknown>)[id];
    if (Array.isArray(pair) && pair.length === 2 && pair.every(n => Number.isInteger(n))) found[id] = [pair[0] as number, pair[1] as number];
  }
  return Object.keys(found).length > 1 ? found : null;
}

/** Which face of the board a material paints, by the names the board stage writes. Everything else on the board is left alone. */
export function maskFace(name: string): 'top' | 'bottom' | null {
  if (/^TopMaterial_|^moki-mask-.+-top$/.test(name)) return 'top';
  if (/^BottomMaterial_|^moki-mask-.+-bottom$/.test(name)) return 'bottom';
  return null;
}
