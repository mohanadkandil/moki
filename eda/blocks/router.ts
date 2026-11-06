import { verifyImmutablePreloads, type ImmutablePreloadExpected } from './immutable-preloads.js';
import { SOLVERS } from 'tscircuit';
import { verifyRefinedClockPreloads } from './refined-clock-preloads.js';
import { rotateNativeRoutingFrame, type RoutingFrameQuarter } from './routing-frame.js';
import { restoreNativeWidths, type WidthFabricationRules } from './native-width.js';
import { withChipRoutingPlanningMargin } from '../../src/blocks/router-planning.js';

/** Use the same exported solver as this RootCircuit's default local autorouter.
 * Resolve it through RootCircuit's public SOLVERS export to retain engine identity.
 * Step in bounded time slices, matching the core's asynchronous solver protocol. */
export async function chipAutorouter(input: any, diagnostics?: { engine?: 'pipeline7' | 'pipeline9'; minimumWidthsOnly?: boolean; frameQuarterTurns?: RoutingFrameQuarter; guardedPipeline9?: new (...args: any[]) => any; immutablePreloads?: ImmutablePreloadExpected; allowClockRefinement?: boolean; onAcceptedClockTraces?: (traces:any[]) => void; onImmutablePreloads?: (evidence: any) => Promise<void>; onFrame?: (evidence: any) => Promise<void>; onFailure?: (evidence: any) => Promise<void>; widthRules?: WidthFabricationRules; onWidths?: (evidence: any) => Promise<void>; onNativeSolved?: (evidence: any) => Promise<void> }) {
  if (diagnostics?.minimumWidthsOnly && !diagnostics.widthRules) throw Error('Minimum-only native widths require fabrication constraints');
  if (diagnostics?.guardedPipeline9 && diagnostics.engine === 'pipeline7') throw Error('Native ownership guard requires Pipeline9');
  if (diagnostics?.allowClockRefinement && !diagnostics.immutablePreloads) throw Error('Native clock refinement requires verified preloads');
  if (diagnostics?.immutablePreloads && diagnostics.frameQuarterTurns) throw Error('Immutable clock preloads require the physical routing frame');
  const planned = withChipRoutingPlanningMargin(input);
  // The native broad power expander can move otherwise conforming signal
  // traces while making room for optional widening. For qualified RP profiles
  // use its documented empty selection, then repair only subminimum traces
  // against all other copper as fixed obstacles below.
  const frame = diagnostics?.frameQuarterTurns ? rotateNativeRoutingFrame(planned, diagnostics.frameQuarterTurns) : undefined;
  if (frame) await diagnostics?.onFrame?.({ ...frame.audit, nativeInput: frame.input });
  const solverInput = frame?.input ?? planned;
  const options = { cacheProvider: null, ...(diagnostics?.minimumWidthsOnly ? { powerTraceExpansion: { onlyConnectionNames: [] as string[] } } : {}) };
  const solver = diagnostics?.engine === 'pipeline7'
    ? new SOLVERS.AutoroutingPipelineSolver7_MultiGraph(solverInput, options)
    : new (diagnostics?.guardedPipeline9 ?? SOLVERS.AutoroutingPipelineSolver9_PreloadedTraceGraph)(solverInput, options);
  const handlers = new Map<string, Array<(event: any) => void>>();
  let started = false, stopped = false;
  let completedOutput: any, terminalFailure: unknown;
  let runPromise: Promise<void> | undefined, rejectRun: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (name: string, event: any) => { for (const fn of handlers.get(name) ?? []) fn(event); };
  const cycle = async () => {
    timer = undefined;
    if (stopped) return;
    try {
      const until = performance.now() + 250;
      while (!stopped && !solver.failed && !solver.solved && performance.now() < until) {
        if ('stepAsync' in solver && typeof solver.stepAsync === 'function') await solver.stepAsync();
        else solver.step();
      }
      if (stopped) return;
      if (solver.failed) throw new Error(solver.error ?? 'Chip-board routing failed');
      if (solver.solved) {
        const nativeOutput: any = solver.getOutputSimpleRouteJson();
        let output: any = frame ? { ...planned, traces: frame.inverseTraces(nativeOutput.traces ?? []) } : nativeOutput;
        let refinedClock:any[]|undefined;
        if (diagnostics?.immutablePreloads) {
          try {
            const checked = diagnostics.allowClockRefinement
              ? verifyRefinedClockPreloads(solver, output, diagnostics.immutablePreloads)
              : verifyImmutablePreloads(solver, output, diagnostics.immutablePreloads);
            if ('acceptedClockTraces' in checked) {
              refinedClock = checked.acceptedClockTraces;
              diagnostics.onAcceptedClockTraces?.(structuredClone(refinedClock));
            }
            output = checked.outputWithFixedTracesRemoved;
            await diagnostics.onImmutablePreloads?.(checked.audit);
          } catch (error) {
            // Keep the rejected native evidence reviewable without publishing
            // any of it as the parent circuit's routed copper.
            try { await diagnostics.onImmutablePreloads?.({ ok: false, error: String(error),
              updatedPreloadedTraces: solver.getUpdatedPreloadedTraces(),
              mutatedPreloadedTraces: solver.getMutatedPreloadedTraces() }); } catch { /* Preserve the original verification failure. */ }
            throw error;
          }
        }
        await diagnostics?.onNativeSolved?.(output);
        if (diagnostics?.widthRules) {
          const clockById = new Map(refinedClock?.map(trace => [trace.pcb_trace_id,trace]) ?? []);
          const preloadedIds = new Set(diagnostics?.immutablePreloads ? (planned.traces ?? []).map((trace:any) => trace.pcb_trace_id) : []);
          const returnedPreloads = (output.traces ?? []).filter((trace:any) => preloadedIds.has(trace.pcb_trace_id));
          const globals = (output.traces ?? []).filter((trace:any) => !preloadedIds.has(trace.pcb_trace_id));
          const widthInput = {...planned,traces:(planned.traces ?? []).map((trace:any) => clockById.get(trace.pcb_trace_id) ?? trace)};
          const restored = await restoreNativeWidths(solver, widthInput, globals, diagnostics.widthRules, () => stopped);
          output = { ...output, traces: [...restored.traces,...returnedPreloads] };
          await diagnostics.onWidths?.(restored.audit);
        }
        if (stopped) return;
        completedOutput = output;
        if (!stopped) emit('complete', { traces: completedOutput.traces });
        return;
      }
      emit('progress', { progress: solver.progress, phaseIndex: solver.currentPipelineStepIndex, phase: solver.pipelineDef?.[solver.currentPipelineStepIndex]?.solverName });
      if (!stopped) timer = setTimeout(() => void cycle(), 0);
    } catch (error) {
      terminalFailure = error;
      if (!stopped) {
        if (diagnostics?.onFailure) {
          try { await diagnostics.onFailure({ error: String(error), phaseIndex: solver.currentPipelineStepIndex,
            phase: solver.activeSubSolver?.getSolverName(), phaseTimesMs: solver.timeSpentOnPhase,
            coordinateFrame: frame?.audit, pointPairs: solver.srjWithPointPairs, graphics: solver.visualize() }); } catch { /* Preserve the original native failure. */ }
        }
        if (!stopped) emit('error', { error });
      }
    }
  };
  return {
    on(name: string, fn: (event: any) => void) { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
    start() { if (started || stopped) return; started = true; timer = setTimeout(() => void cycle(), 0); },
    run(): Promise<void> {
      if (stopped) return Promise.reject(new Error('Native autorouter was stopped'));
      if (terminalFailure !== undefined) return Promise.reject(terminalFailure);
      if (solver.failed) return Promise.reject(new Error(solver.error ?? 'Chip-board routing failed'));
      if (completedOutput) return Promise.resolve();
      if (!runPromise) runPromise = new Promise<void>((resolve, reject) => {
        rejectRun = reject;
        this.on('complete', () => { rejectRun = undefined; resolve(); });
        this.on('error', event => { rejectRun = undefined; reject(event.error); });
        this.start();
      });
      return runPromise;
    },
    stop() { stopped = true; rejectRun?.(new Error('Native autorouter was stopped')); rejectRun = undefined; if (timer !== undefined) clearTimeout(timer); timer = undefined; },
    // Core's event adapter consumes this synchronously; the platform type also
    // describes run-based adapters, so keep the actual SRJ return at this boundary.
    getOutputSimpleRouteJson(): any { return completedOutput ?? solver.getOutputSimpleRouteJson(); },
  };
}
