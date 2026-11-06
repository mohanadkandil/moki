/** Absolute board-minimum wire-width inspection, independent of source-trace
 * endpoint count. Native's source thickness check skips one-port→net traces.
 * This is a hard check only: no geometry, widths or source metadata are changed.
 */
export interface NativeTraceWidthIssue {
  type: 'pcb_trace_width_error';
  message: string;
  pcb_trace_id?: string;
  source_trace_id?: string;
  segment_index?: number;
  point_index?: number;
  minimum_width_mm?: number;
  actual_widths_mm?: number[];
}
const WIDTH_TOLERANCE = 1e-9;
const SEGMENT_EPS = 1e-8;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function checkNativeTraceWidths(circuit: any[]): NativeTraceWidthIssue[] {
  const issues: NativeTraceWidthIssue[] = [];
  const issue = (message: string, fields: Omit<NativeTraceWidthIssue, 'type' | 'message'> = {}) =>
    issues.push({ type: 'pcb_trace_width_error', message, ...fields });
  if (!Array.isArray(circuit)) {
    issue('Native trace width inspection requires a circuit array');
    return issues;
  }
  const boards = circuit.filter(e => e?.type === 'pcb_board');
  if (boards.length > 1) {
    issue('Native trace width inspection cannot select a unique board minimum');
    return issues;
  }
  const rule = boards[0]?.min_trace_width;
  let minimum = 0.15;
  if (rule !== undefined) {
    if (!finite(rule) || rule <= 0) issue('Native board min_trace_width must be finite and positive');
    else minimum = rule;
  }
  for (const trace of circuit.filter(e => e?.type === 'pcb_trace')) {
    const ids = {
      ...(typeof trace.pcb_trace_id === 'string' ? { pcb_trace_id: trace.pcb_trace_id } : {}),
      ...(typeof trace.source_trace_id === 'string' ? { source_trace_id: trace.source_trace_id } : {}),
      minimum_width_mm: minimum,
    };
    const name = trace.pcb_trace_id || '<unnamed trace>';
    if (!Array.isArray(trace.route)) {
      issue(`Trace ${name} has no inspectable native route`, ids);
      continue;
    }
    const valid: boolean[] = trace.route.map((p: any, index: number) => {
      if (!p || !['wire', 'via'].includes(p.route_type) || !finite(p.x) || !finite(p.y)) {
        issue(`Trace ${name} point ${index} has malformed native wire/via geometry`, { ...ids, point_index: index });
        return false;
      }
      if (p.route_type === 'wire' && (!finite(p.width) || p.width <= 0 || typeof p.layer !== 'string' || !p.layer)) {
        issue(`Trace ${name} wire point ${index} requires a finite positive width and a layer`, { ...ids, point_index: index });
        return false;
      }
      return true;
    });
    for (let i = 0; i < trace.route.length - 1; i++) {
      if (!valid[i] || !valid[i + 1]) continue;
      const a = trace.route[i], b = trace.route[i + 1];
      if (a.route_type === 'wire' && b.route_type === 'wire' && a.layer !== b.layer) {
        issue(`Trace ${name} segment ${i} changes wire layer without an explicit via`, { ...ids, segment_index: i });
        continue;
      }
      const length = Math.hypot(a.x - b.x, a.y - b.y);
      if (!finite(length)) {
        issue(`Trace ${name} segment ${i} has nonfinite length`, { ...ids, segment_index: i });
        continue;
      }
      // Native saved through-via serialization contains coincident contact
      // wires. A finite thin contact alone has no free wire extent to reject.
      if (length <= SEGMENT_EPS) continue;
      const widths = [a, b].filter(p => p.route_type === 'wire').map(p => p.width as number);
      if (!widths.length) {
        issue(`Trace ${name} segment ${i} moves between vias without an inspectable wire width`, { ...ids, segment_index: i });
        continue;
      }
      // Wire↔via approaches lie on the wire's layer. Do not reinterpret native
      // direction annotations here; physical barrel/layer proof is separate.
      // Check BOTH wire endpoints: max-width segment serialization must not
      // conceal a narrow leading endpoint or a serialized taper below the rule.
      if (widths.some(width => width < minimum - WIDTH_TOLERANCE))
        issue(`Trace ${name} segment ${i} uses wire width ${Math.min(...widths)} mm below the board minimum ${minimum} mm`, { ...ids, segment_index: i, actual_widths_mm: widths });
    }
  }
  return issues;
}
