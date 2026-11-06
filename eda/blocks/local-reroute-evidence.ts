/** Read-only preparation of an actual captured native local reroute.
 * Preparation does not route. The explicit whole-trace-run mode requires the
 * coordinator's native slot and caps routing at90seconds. Fail closed if the
 * public clipping API loses outside barrels; never invent route stitches.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AutoroutingPipelineSolver7_MultiGraph, AutoroutingPipelineSolver9_PreloadedTraceGraph, getRerouteSimpleRouteJson, reconnectReroutedSimpleRouteJsonRegion, type RerouteRectRegion } from '@tscircuit/capacity-autorouter';
import { nativeReplayInputSha256 } from './native-replay.js';
import { restoreNativeWidths } from './native-width.js';

const source = resolve(process.argv[2]!), out = resolve(process.argv[3]!);
if (process.argv[4] === 'whole-trace-run') {
  // A native async step can block past an in-process deadline. An independent
  // OS watchdog owns the actual routing deadline, even during that step.
  const started = performance.now();
  const child = spawn('timeout', ['--signal=TERM', '--kill-after=5s', '90s', process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), source, out, 'whole-trace-run-watched'], { stdio: 'inherit' });
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal }));
  });
  if (outcome.code === 124 || outcome.code === 137 || outcome.signal) {
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, 'whole-trace-failure.json'), JSON.stringify({ nativeRoutingExecuted: true, accepted: false, error: 'Independent OS watchdog stopped native local reroute at90seconds', ms: performance.now() - started, exitCode: outcome.code, signal: outcome.signal, candidateMayNotBeUsed: true }, null, 2) + '\n');
  }
  process.exit(outcome.code ?? 1);
}
const region: RerouteRectRegion = { shape: 'rect', minX: -7.5, maxX: -2.5, minY: 2, maxY: 7 };
const read = async (name: string) => {
  const bytes = await readFile(resolve(source, name));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
};
const [capturedInput, capturedNative] = await Promise.all([read('router-input.json'), read('native-before-width.json')]);
const input = capturedInput.value, native = capturedNative.value;
if (!Array.isArray(native.traces) || !native.traces.length || input.traces?.length)
  throw Error('Diagnostic requires the actual completed joint native phase and original empty preload set');
// Native pipeline annotates obstacle stack indices; these are derived layer
// caches, not altered geometry. Compare every other captured input field.
const comparison = { ...native, traces: input.traces, obstacles: native.obstacles.map((obstacle: any) => {
  const copy = { ...obstacle }; delete copy.zLayers; delete copy.__zLayers; return copy;
}) };
if (nativeReplayInputSha256(comparison) !== nativeReplayInputSha256(input))
  throw Error('Captured native output does not retain exact original routing inputs');
const original = { ...structuredClone(input), traces: structuredClone(native.traces) };
const before = nativeReplayInputSha256(original);
if (['whole-trace', 'whole-trace-run-watched'].includes(process.argv[4] ?? '')) {
  const traceId = 'source_net_13_0', selected = native.traces.filter((t: any) => t.pcb_trace_id === traceId);
  if (selected.length !== 1 || selected[0].connection_name !== 'source_net_13') throw Error('Actual offending trace identity differs');
  const connections = input.connections.filter((c: any) => c.name === selected[0].connection_name);
  if (connections.length !== 1 || connections[0].pointsToConnect.length !== 2) throw Error('Whole-trace diagnostic requires one exact two-terminal native connection');
  const fixed = native.traces.filter((t: any) => t.pcb_trace_id !== traceId);
  // Resolve the official native converter through a public pipeline definition.
  // Only this preprocessing step runs; no routing/pathfinding solver is stepped.
  // Convert only fixed traces. The native stage also canonicalizes existing
  // rotated pad obstacles; leave those original captured obstacles verbatim
  // and append the native-generated fixed-Cu obstacles instead.
  const conversionInput = { ...structuredClone(input), obstacles: [], connections: structuredClone(connections), traces: structuredClone(fixed) };
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(conversionInput, { cacheProvider: null });
  const definition = pipeline.pipelineDef.find(p => p.solverName === 'preprocessSimpleRouteJsonSolver');
  if (!definition) throw Error('Official native preprocessing conversion is unavailable');
  const conversion = new (definition.solverClass as any)(conversionInput);
  conversion.step();
  if (!conversion.solved || conversion.failed) throw Error(conversion.error ?? 'Official native trace-to-obstacle conversion failed');
  const converted = conversion.getOutputSimpleRouteJson();
  const withoutCaches = (obstacles: any[]) => obstacles.map(obstacle => {
    const copy = { ...obstacle }; delete copy.zLayers; delete copy.__zLayers; return copy;
  });
  const fixedVias = fixed.flatMap((t: any) => t.route.filter((p: any) => p.route_type === 'via'));
  const convertedVias = converted.obstacles.filter((o: any) => /^trace_obstacle_.*_via$/.test(o.obstacleId ?? ''));
  // Native preprocessing deduplicates coincident same physical barrels. Prove
  // every literal captured record has its exact full-span physical footprint;
  // do not require duplicate records to produce duplicate obstacle objects.
  if (fixedVias.some((v: any) => !convertedVias.some((o: any) => o.center.x === v.x && o.center.y === v.y && o.width >= v.via_diameter && o.height >= v.via_diameter && o.layers.includes(v.from_layer) && o.layers.includes(v.to_layer))))
    throw Error('Official conversion did not represent every actual fixed barrel');
  const prepared = { ...structuredClone(input), connections: structuredClone(connections), obstacles: [...structuredClone(input.obstacles), ...converted.obstacles], traces: [] };
  if (nativeReplayInputSha256(withoutCaches(prepared.obstacles.slice(0, input.obstacles.length))) !== nativeReplayInputSha256(input.obstacles))
    throw Error('Preparation changed original fixed prefix/pad/projection obstacles');
  if (nativeReplayInputSha256(original) !== before) throw Error('Preparation mutated captured native copper');
  await mkdir(out, { recursive: true });
  const write = async (name: string, data: unknown) => {
    const bytes = JSON.stringify(data); await writeFile(resolve(out, name), bytes);
    return createHash('sha256').update(bytes).digest('hex');
  };
  const inputRawSha256 = await write('whole-trace-input.json', prepared), fixedRawSha256 = await write('fixed-native-records.json', fixed);
  const receipt = {
    schema: 'moki.public-native-whole-trace-reroute-preparation/1', source, traceId,
    originalInputRawSha256: capturedInput.sha256, capturedNativeRawSha256: capturedNative.sha256,
    originalInputCanonicalSha256: nativeReplayInputSha256(input), preparedInputRawSha256: inputRawSha256,
    preparedInputCanonicalSha256: nativeReplayInputSha256(prepared), fixedRecordsRawSha256: fixedRawSha256,
    fixedTraceCount: fixed.length, fixedViaRecordCount: fixedVias.length, convertedViaObstacleCount: convertedVias.length,
    originalFixedObstacleCount: input.obstacles.length, preparedObstacleCount: prepared.obstacles.length,
    sourceUnchanged: true, originalObstaclesRetained: true, converter: 'Public Pipeline7 preprocessSimpleRouteJsonSolver; no custom geometry converter',
    futureNativeOptions: { cacheProvider: null, powerTraceExpansion: { onlyConnectionNames: [], allowNewVias: false } },
    futureOutputRequirements: ['Exact source13 connection and trace ID; no other routed trace names', 'Reattach fixed-native-records.json verbatim, preserving every literal outside route and barrel', 'Native minimum-width restoration; fresh Core materialization/source/all-net physical/DRC/fabrication/compile gates'],
    nativeRoutingExecuted: false, accepted: false, freshGatesMandatory: true,
  };
  await writeFile(resolve(out, 'whole-trace-preparation.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  if (process.argv[4] === 'whole-trace-run-watched') {
    const started = performance.now(), fixedFingerprint = nativeReplayInputSha256(fixed);
    const options = receipt.futureNativeOptions;
    const solver: any = new AutoroutingPipelineSolver9_PreloadedTraceGraph(prepared, options);
    let lastPhase: number | undefined;
    try {
      while (!solver.solved && !solver.failed) {
        const until = performance.now() + 100;
        while (!solver.solved && !solver.failed && performance.now() < until) {
          if (performance.now() - started > 90000) throw Error('Whole-source13 native reroute exceeded90seconds');
          if (typeof solver.stepAsync === 'function') await solver.stepAsync(); else solver.step();
        }
        if (solver.currentPipelineStepIndex !== lastPhase) {
          lastPhase = solver.currentPipelineStepIndex;
          const progress = { phase: solver.pipelineDef[lastPhase!]?.solverName, phaseIndex: lastPhase, ms: performance.now() - started };
          await writeFile(resolve(out, 'whole-trace-progress.json'), JSON.stringify(progress));
          console.log(JSON.stringify(progress));
        }
        await new Promise(r => setTimeout(r, 0));
      }
      if (solver.failed) throw Error(solver.error ?? 'Whole-source13 native reroute failed');
      const result = solver.getOutputSimpleRouteJson();
      const outputRawSha256 = await write('whole-trace-native-output.json', result);
      if (result.traces?.length !== 1 || result.traces[0].pcb_trace_id !== traceId || result.traces[0].connection_name !== selected[0].connection_name)
        throw Error('Native whole-trace reroute changed expected trace identity/coverage');
      // Keep the exact captured record order and all other copper verbatim.
      const combined = native.traces.map((t: any) => t.pcb_trace_id === traceId ? result.traces[0] : t);
      if (nativeReplayInputSha256(combined.filter((t: any) => t.pcb_trace_id !== traceId)) !== fixedFingerprint)
        throw Error('Whole-trace reroute changed fixed literal copper');
      const combinedRawSha256 = await write('whole-trace-combined-before-width.json', combined);
      const widthPipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { cacheProvider: null });
      const restored = await restoreNativeWidths(widthPipeline, structuredClone(input), combined, { traceToPad: .127, traceToTrace: .127, viaToPad: .127 });
      const candidateRawSha256 = await write('whole-trace-width-candidate.json', restored.traces);
      await write('whole-trace-width-audit.json', restored.audit);
      const min = Math.min(...restored.traces.flatMap(t => t.route.filter(p => p.route_type === 'wire').map(p => p.width)));
      if (!Number.isFinite(min) || min < input.minTraceWidth - 1e-9) throw Error('Native candidate remains below fabrication minimum');
      const completed = { ...receipt, nativeRoutingExecuted: true, outputRawSha256, combinedRawSha256, candidateRawSha256, nativeMs: performance.now() - started, minimumWidthMm: min, traceCount: restored.traces.length, accepted: false, freshGatesMandatory: true };
      await writeFile(resolve(out, 'whole-trace-result.json'), JSON.stringify(completed, null, 2) + '\n');
      console.log(JSON.stringify(completed));
    } catch (cause) {
      await writeFile(resolve(out, 'whole-trace-failure.json'), JSON.stringify({ nativeRoutingExecuted: true, accepted: false, error: String(cause), ms: performance.now() - started, phaseIndex: solver.currentPipelineStepIndex, phase: solver.pipelineDef[solver.currentPipelineStepIndex]?.solverName, phaseTimesMs: solver.timeSpentOnPhase, candidateMayNotBeUsed: true }, null, 2) + '\n');
      throw cause;
    }
  }
  process.exit(0);
}
const local = getRerouteSimpleRouteJson(original, region);
const reconnectedWithoutRouting = reconnectReroutedSimpleRouteJsonRegion(original, local);
if (nativeReplayInputSha256(original) !== before) throw Error('Public local reroute API mutated captured source');
// A barrel whose complete copper disk lies outside the region cannot legally
// disappear when only the inside region is ripped up. Preserve the literal
// native via record (including actual layer traversal and dimensions).
const outside = (p: any) => {
  if (p.route_type !== 'via' || !Number.isFinite(p.via_diameter) || p.via_diameter <= 0) return false;
  const radius = p.via_diameter / 2;
  return p.x + radius < region.minX || p.x - radius > region.maxX || p.y + radius < region.minY || p.y - radius > region.maxY;
};
const key = (net: string, via: any) => nativeReplayInputSha256({ net, via });
const keptBarrels = new Set(local.traces!.flatMap(t => t.route.filter(outside).map(via => key(t.connection_name, via))));
const lostOutsideBarrels = native.traces.flatMap((trace: any) => trace.route.filter(outside).filter((via: any) => !keptBarrels.has(key(trace.connection_name, via))).map((via: any) => ({ traceId: trace.pcb_trace_id, net: trace.connection_name, via })));
// Public converter must retain every actual fixed obstacle verbatim. It may
// append boundary endpoint obstacles but may not remove/alter captured pads.
if (nativeReplayInputSha256(local.obstacles.slice(0, input.obstacles.length)) !== nativeReplayInputSha256(input.obstacles))
  throw Error('Local reroute did not retain original fixed obstacle geometry');
await mkdir(out, { recursive: true });
const save = async (name: string, value: unknown) => {
  const bytes = JSON.stringify(value);
  await writeFile(resolve(out, name), bytes);
  return createHash('sha256').update(bytes).digest('hex');
};
const localInputRawSha256 = await save('local-input.json', local);
const reconnectProbeRawSha256 = await save('reconnect-probe.json', reconnectedWithoutRouting);
const receipt = {
  schema: 'moki.public-native-local-reroute-preparation/1', source, region,
  capturedInputRawSha256: capturedInput.sha256, capturedNativeRawSha256: capturedNative.sha256,
  originalInputCanonicalSha256: nativeReplayInputSha256(input), originalWithNativeCopperCanonicalSha256: before,
  localInputRawSha256, localInputCanonicalSha256: nativeReplayInputSha256(local), reconnectProbeRawSha256,
  localConnections: local.connections.length, originalTraceCount: native.traces.length, keptPieceCount: local.traces!.length,
  originalObstaclesRetained: true, sourceUnchanged: true, lostOutsideBarrels,
  supportedForCapturedGeometry: lostOutsideBarrels.length === 0,
  nativeRoutingExecuted: false, accepted: false, freshGatesMandatory: true,
  reason: lostOutsideBarrels.length ? 'Public clipping API drops actual outside-region via records on affected multi-via traces. No native reroute executed or custom stitching attempted.' : 'Outside-barrel prerequisite passed. Native routing remains unexecuted and requires coordinator slot approval.',
};
await writeFile(resolve(out, 'preparation.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, lostOutsideBarrels: lostOutsideBarrels.map((p: any) => ({ traceId: p.traceId, net: p.net, x: p.via.x, y: p.via.y })) }));
if (lostOutsideBarrels.length) process.exitCode = 2;
