import * as native from '../node_modules/@tscircuit/checks/dist/index.js';
import { readFileSync } from 'node:fs';

/** Exact public sequence from @tscircuit/checks 0.0.269 lib/run-all-checks.ts.
 * Keep the pin and the sequence together: a dependency upgrade must review the
 * fallback, rather than silently omit a newly introduced fabrication check. */
export const ROUTING_CHECK_VERSION = '0.0.269';
export const ROUTING_CHECK_NAMES = [
  'checkEachPcbPortConnectedToPcbTraces',
  'checkSourceTracesHavePcbTraces',
  'checkSourceTracesMatchPcbTraceThickness',
  'checkPcbBendZoneTraces',
  'checkCopperToCutoutClearance',
  'checkPcbTraceLengths',
  'checkPcbTraceStyle',
  'checkPcbBusLengthSkew',
  'checkPcbRoutingConstraints',
  'checkPcbTraceViaCounts',
  'checkEachPcbTraceNonOverlapping',
  'checkCopperPourShorts',
  'checkCopperPourIslands',
  'checkPadTraceClearance',
  'checkHoleTraceClearance',
  'checkViaTraceClearance',
  'checkViaPadClearance',
  'checkSameNetViaSpacing',
  'checkDifferentNetViaSpacing',
  'checkTracesAreContiguous',
  'checkDanglingTraces',
  'checkPcbTracesOutOfBoard',
] as const;
export interface RoutingCheckRetry {
  check: 'checkCopperPourShorts';
  originalError: string;
  scale: 1000;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
// Flatten's original precision failure, optionally prefixed with the native
// circuit element ID. Other geometry errors must remain failures.
const booleanFailure = (error: unknown) => /^(?:[^:\n]+: )?Cannot complete boolean operation$/.test(message(error));
const LENGTH_FIELDS = new Set([
  'x', 'y', 'width', 'height', 'radius', 'corner_radius', 'rect_border_radius',
  'hole_diameter', 'hole_width', 'hole_height', 'hole_offset_x', 'hole_offset_y',
  'outer_diameter', 'outer_width', 'outer_height', 'rect_pad_width', 'rect_pad_height',
  'via_diameter', 'via_hole_diameter',
]);

/** Units only, on a private clone consumed by the shorts oracle. This covers
 * every length read by its pinned flatten converter for SMT lands, plated
 * holes, vias, wire/through-pad routes, and rect/polygon/BREP pours. Ring bulges,
 * angles, source IDs, layer counts and connectivity remain untouched. No
 * clearance, islands or other native check ever receives this scaled clone. */
function shortsInMicrometers(circuit: any[]): any[] {
  const copy = structuredClone(circuit);
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'number' && LENGTH_FIELDS.has(key)) {
        const scaled = item * 1000;
        if (!Number.isFinite(item) || !Number.isFinite(scaled))
          throw Error(`Cannot rescale nonfinite native PCB length ${key}`);
        value[key] = scaled;
      } else if (item && typeof item === 'object') visit(item);
    }
  };
  for (const record of copy) if (typeof record?.type === 'string' && record.type.startsWith('pcb_')) visit(record);
  return copy;
}

/** Normal native checks first. Only its reproducible copper-pour boolean
 * precision failure enables the public-check fallback. The initial aggregate
 * already performs native endpoint annotation; individual public checks compute
 * their own native connectivity maps when the optional cache is omitted. */
export async function runRobustRoutingChecks(circuit: any[]): Promise<{ issues: any[]; retries: RoutingCheckRetry[] }> {
  let original: unknown;
  try { return { issues: await native.runAllRoutingChecks(circuit as any), retries: [] }; }
  catch (error) {
    if (!booleanFailure(error)) throw error;
    original = error;
  }
  try { await native.checkCopperPourShorts(circuit as any); }
  catch (error) {
    if (!booleanFailure(error) || message(error) !== message(original)) throw error;
    const version = JSON.parse(readFileSync(new URL('../node_modules/@tscircuit/checks/package.json', import.meta.url), 'utf8')).version;
    if (version !== ROUTING_CHECK_VERSION) throw Error(`Unsupported native routing fallback version: ${version}`);
    const retries: RoutingCheckRetry[] = [];
    const issues: any[] = [];
    for (const name of ROUTING_CHECK_NAMES) {
      const check = native[name] as (input: any[], options?: any) => any[] | Promise<any[]>;
      if (typeof check !== 'function') throw Error(`Pinned native routing check unavailable: ${name}`);
      if (name === 'checkCopperPourShorts') {
        const result = await check(shortsInMicrometers(circuit));
        // The pinned shorts check emits IDs/messages, never unit-bearing
        // coordinates. A changed native output schema requires explicit review.
        for (const item of result) {
          const keys = Object.keys(item);
          if (keys.some(key => !['type', 'pcb_placement_error_id', 'error_type', 'message', 'subcircuit_id'].includes(key)))
            throw Error('Native copper-pour shorts returned an unsupported unit-bearing error schema');
        }
        issues.push(...result);
        retries.push({ check: name, originalError: message(original), scale: 1000 });
      } else issues.push(...await check(circuit, name === 'checkCopperToCutoutClearance' ? { elementTypes: ['pcb_trace'] } : undefined));
    }
    return { issues, retries };
  }
  // A successful isolated shorts check did not identify the aggregate failure.
  throw original;
}
