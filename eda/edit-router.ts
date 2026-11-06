import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from '@tscircuit/capacity-autorouter';
import { withRoutingPlanningMargin } from '../src/board/router-planning.js';

/** Established standalone solver for sensor fanout and edited carrier layouts. */
export async function makerAutorouter(input: any) {
  const planned = withRoutingPlanningMargin(input);
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(planned, { cacheProvider: null });
  const handlers = new Map<string, Array<(event: any) => void>>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (name: string, event: any) => { for (const fn of handlers.get(name) ?? []) fn(event); };
  return {
    on(name: string, fn: (event: any) => void) { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
    start() { if (stopped || timer) return; timer = setTimeout(() => {
      if (stopped) return;
      try {
        solver.solve();
        if (solver.failed || !solver.solved) throw new Error(solver.error ?? 'Board routing failed');
        emit('complete', { traces: solver.getOutputSimplifiedPcbTraces() });
      } catch (error) { emit('error', {error}); }
    }, 0); },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
    getOutputSimpleRouteJson() { return solver.getOutputSimpleRouteJson(); },
  };
}
