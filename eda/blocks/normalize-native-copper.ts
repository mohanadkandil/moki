/** Exact representation cleanup of native global copper, not route finding.
 * An equal-width axis-aligned connected run covers precisely its closed min/max
 * interval swept by the same disk. Keeping its original extrema preserves that
 * union, including backtracking. No coordinates, widths or metadata are edited.
 * Call only on new global routing output; saved fixed phases are also excluded.
 */
export interface NativeCopperNormalizationAudit {
  pcbTraceId?: string;
  startIndex: number;
  endIndex: number;
  axis: 'x' | 'y';
  keptIndices: number[];
  beforePoints: number;
  afterPoints: number;
  min: number;
  max: number;
}
const plainWire = (p: any) =>
  p?.route_type === 'wire' &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Number.isFinite(p.width) &&
  p.width > 0 &&
  typeof p.layer === 'string' &&
  Object.keys(p).every((k) => ['route_type', 'x', 'y', 'width', 'layer'].includes(k));
const compatible = (a: any, b: any) =>
  plainWire(a) && plainWire(b) && a.width === b.width && a.layer === b.layer;

export function normalizeNativeCopper<
  T extends {
    pcb_trace_id?: string;
    route: any[];
    route_thickness_mode?: string;
    should_round_corners?: boolean;
  },
>(traces: readonly T[]) {
  const audit: NativeCopperNormalizationAudit[] = [];
  const output = traces.map((trace) => {
    if (
      !Array.isArray(trace.route) ||
      trace.pcb_trace_id?.startsWith('saved_phase_') ||
      (trace.route_thickness_mode !== undefined && trace.route_thickness_mode !== 'constant') ||
      trace.should_round_corners === true
    )
      return trace;
    const original = trace.route,
      indices: number[] = [];
    const keep = (index: number) => {
      if (indices.at(-1) !== index) indices.push(index);
    };
    for (let i = 0; i < original.length; ) {
      const first = original[i];
      let distinct = i + 1;
      while (
        distinct < original.length &&
        compatible(first, original[distinct]) &&
        first.x === original[distinct].x &&
        first.y === original[distinct].y
      )
        distinct++;
      const next = original[distinct];
      const axis: 'x' | 'y' | undefined = compatible(first, next)
        ? first.x === next.x
          ? 'y'
          : first.y === next.y
            ? 'x'
            : undefined
        : distinct > i + 1
          ? 'x'
          : undefined;
      if (!axis) {
        keep(i++);
        continue;
      }
      const fixed = axis === 'x' ? 'y' : 'x';
      let end = i;
      while (
        end + 1 < original.length &&
        compatible(first, original[end + 1]) &&
        original[end + 1][fixed] === first[fixed]
      )
        end++;
      let minIndex = i,
        maxIndex = i;
      for (let j = i + 1; j <= end; j++) {
        if (original[j][axis] < original[minIndex][axis]) minIndex = j;
        if (original[j][axis] > original[maxIndex][axis]) maxIndex = j;
      }
      const selected = [...new Set([i, minIndex, maxIndex, end])].sort((a, b) => a - b);
      for (const j of selected) keep(j);
      if (selected.length < end - i + 1)
        audit.push({
          pcbTraceId: trace.pcb_trace_id,
          startIndex: i,
          endIndex: end,
          axis,
          keptIndices: selected,
          beforePoints: end - i + 1,
          afterPoints: selected.length,
          min: original[minIndex][axis],
          max: original[maxIndex][axis],
        });
      i = end > i ? end : i + 1;
    }
    if (indices.length === original.length) return trace;
    return { ...trace, route: indices.map((i) => original[i]) };
  });
  return { traces: output, audit };
}
