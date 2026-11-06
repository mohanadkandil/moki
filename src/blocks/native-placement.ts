import type { PlanGraph } from './graph.js';
export function nativePlacementIssues(graph: PlanGraph, circuit: any[]) {
  const issues: Array<{ type: string; message: string }> = [],
    measurements: Array<{ where: string; measuredMm: number; maxMm: number }> = [],
    actual = new Map<string, { x: number; y: number; rotation: number }>();
  const angle = (n: number) => ((n % 360) + 360) % 360;
  for (const p of graph.parts) {
    const source = circuit.find((c) => c.type === 'source_component' && c.name === p.ref),
      pcb = circuit.find(
        (c) => c.type === 'pcb_component' && c.source_component_id === source?.source_component_id,
      ),
      origin = pcb?.footprint_origin ?? pcb?.center;
    if (!origin || ![origin.x, origin.y, pcb.rotation].every(Number.isFinite)) {
      issues.push({
        type: 'pcb_compiler_placement_error',
        message: `Native placement is unavailable for ${p.ref}`,
      });
      continue;
    }
    actual.set(p.ref, { ...origin, rotation: pcb.rotation });
    if (
      Math.hypot(origin.x - p.at.x, origin.y - p.at.y) > 1e-5 ||
      Math.min(angle(pcb.rotation - (p.at.rotation ?? 0)), angle((p.at.rotation ?? 0) - pcb.rotation)) > 1e-5
    )
      issues.push({
        type: 'pcb_compiler_placement_error',
        message: `Native ${p.ref} does not match its compiler placement`,
      });
  }
  for (const p of graph.parts)
    for (const c of p.block.constraints)
      if (c.kind === 'decoupling' && c.ic === p.localRef) {
        const ic = actual.get(p.ref);
        if (!ic) continue;
        for (const cap of c.caps) {
          const ref = graph.parts.find((q) => q.inst === p.inst && q.localRef === cap)?.ref,
            at = ref ? actual.get(ref) : undefined;
          if (!at) {
            issues.push({
              type: 'pcb_decoupling_error',
              message: `Missing native decoupling capacitor ${p.inst}.${cap}`,
            });
            continue;
          }
          const distance = Math.hypot(at.x - ic.x, at.y - ic.y);
          measurements.push({ where: p.inst + '.' + cap, measuredMm: distance, maxMm: c.maxDistanceMm });
          if (distance > c.maxDistanceMm + 1e-6)
            issues.push({
              type: 'pcb_decoupling_error',
              message: `Native ${p.inst}.${cap} is ${distance.toFixed(3)} mm from ${c.ic}, exceeding ${c.maxDistanceMm} mm`,
            });
        }
      }
  return { ok: !issues.length, issues, measurements };
}
