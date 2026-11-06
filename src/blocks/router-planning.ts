/** Compiler planning margins only; native fabrication DRC remains authoritative. */
export const CHIP_ROUTING_OBSTACLE_MARGIN_MM = .18;
export const CHIP_ROUTING_PAD_CLEARANCE_MM = .15;

/** Keep per-net width/nominalTraceWidth and all native routing topology intact. */
export function withChipRoutingPlanningMargin(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Routing input must be an object');
  const next = { ...input };
  for (const [key, floor] of [
    ['defaultObstacleMargin', CHIP_ROUTING_OBSTACLE_MARGIN_MM],
    ['minTraceToPadEdgeClearance', CHIP_ROUTING_PAD_CLEARANCE_MM],
    ['minViaEdgeToPadEdgeClearance', CHIP_ROUTING_PAD_CLEARANCE_MM],
  ] as const) {
    const value = input[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`Invalid routing clearance ${key}`);
    next[key] = Math.max(floor, value ?? 0);
  }
  return next;
}
