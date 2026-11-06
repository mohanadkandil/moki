export const ROUTING_PLANNING_CLEARANCE_MM = .25;

/** Preserve the established carrier adapter's trace/via-to-pad floors.
 * Other planning margins and every geometric/electrical SRJ field remain unchanged. */
export function withRoutingPlanningMargin(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Routing input must be an object');
  const next = { ...input };
  for (const key of ['minTraceToPadEdgeClearance', 'minViaEdgeToPadEdgeClearance']) {
    const value = input[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`Invalid routing clearance ${key}`);
    next[key] = Math.max(ROUTING_PLANNING_CLEARANCE_MM, value ?? 0);
  }
  return next;
}

