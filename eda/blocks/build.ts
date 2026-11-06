import { createElement as e, cloneElement } from 'react';
import { RootCircuit } from 'tscircuit';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg';
import { convertCircuitJsonToGerberFiles } from 'circuit-json-to-gerber';
import { convertCircuitJsonTo3D, convertSceneToGLTF } from 'circuit-json-to-gltf';
import {
  CircuitJsonToKicadPcbConverter,
  CircuitJsonToKicadSchConverter,
  CircuitJsonToKicadProConverter,
} from 'circuit-json-to-kicad';
import { zipSync, strToU8 } from 'fflate';
import { resolvePlanBlocks, catalogPart, checkPlan } from '../../src/blocks/library';
import { planGraph } from '../../src/blocks/graph';
import { legalizePlanGraph, footprintEnvelope } from './legalize';
import { planFanout, isFanoutTarget, FANOUT_PLACEMENT_PADDING_MM } from '../../src/blocks/fanout';
import { createNativeFanoutPhase } from './fanout';
import { nativeDebugSource } from './debug-source';
import { createRpClockPhase } from './rp-clock';
import { createRpEscapePhase, type RpEscapePhase } from './rp-escape';
import { createDrv8833EscapeProposals } from './drv8833-escape';
import { createRpSignalEscapeProposals } from './rp-signal-escape';
import { createUsbSinkEscapeProposals } from './usb-sink-escape';
import { createNativePadHandoffs } from './native-handoffs';
import { selectRpCriticalSignalNets } from './rp-phase-order';
import { placePlanSections } from './auto-placement';
import { relocateSensorConnectionPoints } from './sensor-exits';
import { repairSavedSources, type SavedPhaseEvidence } from './repair-saved-sources';
import { repairNativeExits, type NativeExitPhaseEvidence } from './repair-native-exits';
import { runRobustRoutingChecks } from './robust-routing-checks';
import { runAllPlacementChecks } from '@tscircuit/checks';
import { prepareImmutablePreloads, type ImmutablePreloadExpected } from './immutable-preloads';
import { loadNativeOwnerGuard } from './native-owner-guard';
import { lockKnownPadOwnership } from './locked-pads';
import { withSmtViaExclusionColumns } from './no-via-in-pad';
import { loadNativeReplay, nativeReplayInputSha256 } from './native-replay';
import { checkNativeTraceWidths } from '../../src/blocks/native-trace-width';
import { nativePlacementIssues } from '../../src/blocks/native-placement';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist';
import { schematicHash } from '../../src/blocks/review';
import { roundedBoardOutline } from '../../src/board/codegen';
import { makerAutorouter } from '../edit-router';
import { chipAutorouter } from './router';
import { withChipRoutingPlanningMargin } from '../../src/blocks/router-planning';
import { ensurePart } from './imported';
import { nativePart, schematicSheet } from './schematic';
import { toolVersions } from '../versions';
import { checkSensorCopper } from './sensor-copper-check';
import type { BoardPlan } from '../../src/blocks/contract';
const job = resolve(process.argv[process.argv.indexOf('--job') + 1] ?? '.'),
  start = performance.now(),
  stages: any[] = [];
await mkdir(job, { recursive: true });
const save = (n: string, v: any) =>
  writeFile(
    resolve(job, n),
    typeof v === 'string' || v instanceof Uint8Array ? v : JSON.stringify(v, null, 2),
  );
async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
  const at = performance.now();
  try {
    const v = await run();
    stages.push({ name, status: 'done', ms: performance.now() - at });
    return v;
  } catch (error) {
    stages.push({ name, status: 'failed', ms: performance.now() - at, note: String(error) });
    throw error;
  }
}
try {
  const versionSnapshot = await toolVersions();
  const plan: BoardPlan = JSON.parse(await readFile(resolve(job, 'plan.json'), 'utf8')),
    blocks = resolvePlanBlocks(plan),
    gates = checkPlan(plan, blocks);
  if (gates.some((g) => !g.ok))
    throw new Error(
      gates.flatMap((g) => g.issues.filter((i) => i.severity === 'error').map((i) => i.message)).join('; '),
    );
  let graph = planGraph(plan, blocks), effectivePlan = plan;
  const hasRpProfile = graph.parts.some(p => p.part.lcsc === 'C2040' && p.block.id === 'rp2040-minimal' && [3,4].includes(p.block.version));
  const nativePadEscape = process.argv.includes('--rp-native-pad-escape');
  if(nativePadEscape && !hasRpProfile) throw Error('Native pad-escape diagnostic requires a known RP profile');
  const frameFlags = process.argv.filter(arg => arg.startsWith('--native-frame='));
  if(frameFlags.length>1 || frameFlags.some(arg => !/^--native-frame=[0-3]$/.test(arg))) throw Error('Private native frame must be one cardinal quarter0–3');
  const nativeFrameQuarter = Number(frameFlags[0]?.slice('--native-frame='.length) ?? 0) as 0|1|2|3;
  if(nativeFrameQuarter && !nativePadEscape) throw Error('Private routing frame requires native pad-escape diagnostic');
  const lockPadNets = process.argv.includes('--lock-native-pad-nets');
  if(lockPadNets && !nativePadEscape) throw Error('Private native pad ownership requires native pad-escape diagnostic');
  const nativeOwnerGuard = process.argv.includes('--native-owner-guard');
  if(nativeOwnerGuard && (!nativePadEscape || !lockPadNets)) throw Error('Private native owner guard requires pad ownership locking and native pad-escape diagnostic');
  const nativeClearanceFloor = process.argv.includes('--native-clearance-floor');
  if(nativeClearanceFloor && !nativeOwnerGuard) throw Error('Private native clearance propagation requires the ownership guard');
  const nativeClockPreloads = process.argv.includes('--native-clock-preloads');
  if(nativeClockPreloads && (!nativeOwnerGuard || nativeFrameQuarter)) throw Error('Private immutable clock preloads require guarded native routing in the physical frame');
  const nativeClockRefinement = process.argv.includes('--native-clock-refinement');
  if(nativeClockRefinement && (!nativeClockPreloads || !nativeClearanceFloor)) throw Error('Private clock refinement requires proven native clock preloads and clearance propagation');
  const nativeGroundEscapes = process.argv.includes('--native-ground-escapes');
  if(nativeGroundEscapes && !nativeClockPreloads) throw Error('Private ground escapes require immutable clock preloads and guarded native pad routing');
  const nativeFullExpansion = process.argv.includes('--native-full-expansion');
  if(nativeFullExpansion && !nativeClockPreloads) throw Error('Private full expansion requires immutable clock preloads');
  const nativeLegacySections = process.argv.includes('--native-legacy-sections');
  if(nativeLegacySections && !nativeClockPreloads) throw Error('Private legacy section candidate requires immutable clock preloads');
  const nativeClockOnly = process.argv.includes('--native-clock-only');
  if(nativeClockOnly && !nativeClockRefinement) throw Error('Private native clock-only candidate requires checked native refinements');
  const ownerGuard = nativeOwnerGuard ? await loadNativeOwnerGuard(job, nativeClearanceFloor ? {clearanceFloorMm:.127} : {}) : undefined;
  if(ownerGuard) await save('native-owner-guard.json', ownerGuard.audit);
  const groundTerminalCount = graph.nets.filter(net => net.pins.some(pin => graph.parts.find(p => p.ref === pin.ref)!.part.pins[pin.logical]?.role === 'ground')).reduce((n, net) => n + net.pins.length, 0);
  const useGroundPlanePhase = !hasRpProfile && plan.layers === 4 && groundTerminalCount > 40 && graph.parts.some(p => isFanoutTarget(p.part));
  const imports = new Map<any, any>();
  await stage('codegen', async () => {
    for (const p of graph.parts) {
      if (imports.has(p.part)) continue;
      const catalog = catalogPart(p.part.lcsc, p.part.catalogReceipt);
      imports.set(p.part, await ensurePart(p.part, catalog));
    }
  });
  await stage('placement', async () => {
    const automatic = placePlanSections(plan, graph, imports, nativeLegacySections ? {ranking:'legacy'} : {});
    effectivePlan = automatic.plan; graph = automatic.graph;
    const envelopes = new Map();
    for (const p of graph.parts)
      if (isFanoutTarget(p.part)) {
        const box = footprintEnvelope(p.part, imports.get(p.part));
        envelopes.set(p.part, {
          ...box,
          minX: box.minX - FANOUT_PLACEMENT_PADDING_MM,
          maxX: box.maxX + FANOUT_PLACEMENT_PADDING_MM,
          minY: box.minY - FANOUT_PLACEMENT_PADDING_MM,
          maxY: box.maxY + FANOUT_PLACEMENT_PADDING_MM,
        });
      }
    const legalized = legalizePlanGraph(effectivePlan, graph, imports, { envelopes });
    graph = legalized.graph;
    await save('placement.json', {
      schema: 'moki.compiler-placement/1',
      inputHash: schematicHash(plan, blocks),
      changes: legalized.changes,
      sectionPlacements: automatic.placements,
      boardAuto: automatic.boardAuto,
      sectionReservePaddingMm: automatic.reservePaddingMm,
      resolvedBoard: effectivePlan.board,
      reservedDensePadExitMarginMm: FANOUT_PLACEMENT_PADDING_MM,
      parts: graph.parts.map((p) => ({ ref: p.ref, inst: p.inst, localRef: p.localRef, at: p.at })),
    });
  });
  await stage('svg', async () => {
    const sheet = await schematicSheet(plan, blocks, graph, imports);
    await save('schematic.svg', sheet.svg);
    await save('schematic-circuit.json', sheet.audit);
  });
  await save('plan-graph.json', graph);
  await save('import-map.json', {
    schema: 'moki.import-map/1',
    inputHash: schematicHash(plan, blocks),
    parts: graph.parts.map((p) => ({
      ref: p.ref,
      inst: p.inst,
      localRef: p.localRef,
      blockContentHash: p.block.contentHash,
      lcsc: p.part.lcsc,
      catalogReceipt: p.part.catalogReceipt,
      footprintSha256: catalogPart(p.part.lcsc, p.part.catalogReceipt).footprintSha256,
      pins: Object.fromEntries(imports.get(p.part).pins),
      omitPads: p.part.omitPads ?? [],
      footprintSource: imports.get(p.part).footprintSource ?? 'jlcpcb',
      footprintId: imports.get(p.part).footprintId ?? p.part.lcsc,
      resolvedFootprintSha256: imports.get(p.part).resolvedFootprintSha256,
      footprintAuditPath: imports.get(p.part).footprintAuditPath,
    })),
  });
  if (process.argv.includes('--schematic-only')) {
    await save('schematic-receipt.json', {
      stages,
      totalMs: performance.now() - start,
      parts: graph.parts.length,
      gates,
    });
    process.exit(0);
  }
  let nodes: any[] = graph.parts.map((p) => nativePart(p, imports.get(p.part)));
  for (const net of graph.nets) {
    const powerNet = net.pins.some((pin) =>
      ['power-in', 'power-out', 'ground'].includes(
        graph.parts.find((p) => p.ref === pin.ref)!.part.pins[pin.logical]!.role,
      ),
    );
    // RP2040's adjacent 0.4mm-pitch low-current core/IO supply pads cannot
    // escape at0.3mm with0.127mm spacing. Use the existing0.15mm board rule
    // on these <=150mA regulated rails; motor VBUS and GND retain0.3mm.
    const rpSupply = net.pins.some(pin => {
      const p = graph.parts.find(p => p.ref === pin.ref)!;
      return p.part.lcsc === 'C2040' && ['power-in', 'power-out'].includes(p.part.pins[pin.logical]!.role);
    });
    nodes.push(e('net', { name: net.name }));
    for (const pin of net.pins) {
      const p = graph.parts.find((p) => p.ref === pin.ref)!;
      const native = imports.get(p.part).pins.get(pin.pad);
      nodes.push(
        e('trace', {
          from: `.${pin.ref} > .${native}`,
          to: `net.${net.name}`,
          // The RP's low-current return/test-enable escapes use the same
          // existing0.15mm rule as its local supply rails. Motor returns stay0.3.
          thickness: p.part.lcsc === 'C2909890' || rpSupply ||
            (p.part.lcsc === 'C2040' && p.block.id === 'rp2040-minimal' && [3,4].includes(p.block.version) && ['19','57'].includes(pin.pad))
            ? 0.15 : powerNet ? 0.3 : 0.15,
          ...(p.part.lcsc === 'C2909890'
            ? {
                pcbPath: [
                  {
                    x: ['1', '2'].includes(pin.pad) ? -1.2 : 1.2,
                    y: ['1', '4'].includes(pin.pad) ? 0.40005 : -0.40005,
                  },
                ],
              }
            : {}),
        }),
      );
    }
  }
  for (const i of effectivePlan.blocks) {
    const b = blocks.find((b) => b.id === i.block && b.version === i.version)!;
    const at = i.at ?? {
        x: ((effectivePlan.blocks.indexOf(i) % 3) - 1) * 34,
        y: -Math.floor(effectivePlan.blocks.indexOf(i) / 3) * 32,
      },
      a = ((at.rotation ?? 0) * Math.PI) / 180;
    for (const [index, k] of b.constraints.entries())
      if (k.kind === 'keepout') {
        const exclude = graph.parts
          .filter((p) => p.inst === i.inst && k.excludeParts?.includes(p.localRef))
          .map((p) => '.' + p.ref);
        nodes.push(
          e('keepout', {
            name: `KO_${i.inst.replaceAll('-', '_')}_${index}`,
            shape: 'rect',
            pcbX: at.x + k.x * Math.cos(a) - k.y * Math.sin(a),
            pcbY: at.y + k.x * Math.sin(a) + k.y * Math.cos(a),
            width: Math.abs(Math.cos(a)) * k.width + Math.abs(Math.sin(a)) * k.height,
            height: Math.abs(Math.sin(a)) * k.width + Math.abs(Math.cos(a)) * k.height,
            layers: k.layers.includes('all')
              ? plan.layers === 4
                ? ['top', 'inner1', 'inner2', 'bottom']
                : ['top', 'bottom']
              : k.layers,
            excludeRefs: exclude,
          }),
        );
      }
  }
  for (const net of graph.nets.filter((n) =>
    n.pins.some(
      (pin) => graph.parts.find((p) => p.ref === pin.ref)!.part.pins[pin.logical]?.role === 'ground',
    ),
  )) {
    for (const layer of ['top', 'bottom'])
      nodes.push(
        e('copperpour', {
          name: `POUR_${net.name}_${layer}`,
          layer,
          connectsTo: `net.${net.name}`,
          clearance: 0.2,
          boardEdgeMargin: 0.3,
          useThermalReliefs: true,
          coveredWithSolderMask: true,
        }),
      );
  }
  const width = effectivePlan.board?.widthMm ?? Math.max(60, ...graph.parts.map((p) => Math.abs(p.at.x) * 2 + 28)),
    height = effectivePlan.board?.heightMm ?? Math.max(60, ...graph.parts.map((p) => Math.abs(p.at.y) * 2 + 28));
  const useTopGroundPlane = false;
  const asyncErrors: string[] = [];
  const routingAudit: any[] = [];
  const nativeExitPhases: NativeExitPhaseEvidence[] = [];
  const c = new RootCircuit(hasRpProfile ? { platform: { autorouterMap: {
    auto: { createAutorouter: async (input: any) => chipRouter(input) },
    // Native saved fanout follows up through the "default" preset, not "auto".
    default: { createAutorouter: async (input: any) => chipRouter(input) },
  } } } : undefined);
  c.on('solver:started', (event: any) => routingAudit.push({ solver: event.solverName,
    options: event.solverConstructorArgs?.[1] ?? event.solverParams?.options,
    input: event.solverConstructorArgs?.[0] ?? event.solverParams?.input ?? event.solverParams }));
  let nativeOutputIndex = 0;
  let capturedClockPhase: any[] | undefined;
  let acceptedClockTraces: any[] | undefined;
  c.on('autorouting:end', (event: any) => {
    if (nativeClockPreloads && event.phaseName === 'rp2040-clock-first' && event.phaseStageIndex === 0 && event.simpleRouteJson) {
      const traces = event.simpleRouteJson.traces;
      if (!Array.isArray(traces) || traces.length !== 5) throw Error('Clock phase event is incomplete');
      if (capturedClockPhase && nativeReplayInputSha256(capturedClockPhase) !== nativeReplayInputSha256(traces)) throw Error('Clock phase events disagree');
      capturedClockPhase = structuredClone(traces);
    }
    if (event.simpleRouteJson) writeFileSync(resolve(job, `native-phase-output-${nativeOutputIndex++}.json`), JSON.stringify({ phaseName: event.phaseName, phaseStageIndex: event.phaseStageIndex, simpleRouteJson: event.simpleRouteJson }));
  });
  c.on('asyncEffect:end', (event: any) => { if (event.error) asyncErrors.push(String(event.error)); });
  const prePourSourceAudit: any[] = [];
  const prePourViaAudit: any[] = [];
  const prePourExistingProofDeferrals: string[] = [];
  let checkedPrePourSources = false;
  c.on('renderable:renderLifecycle:PcbCopperPourRender:start', () => {
    if (checkedPrePourSources || (!savedFanoutEvidence && !nativeExitPhases.length)) return;
    const geometry = c.getCircuitJson();
    if (asyncErrors.length || geometry.some((item: any) => item.type === 'pcb_autorouting_error')) return;
    if (!geometry.some((item: any) => item.type === 'pcb_trace' && item.pcb_trace_id.startsWith('saved_phase_'))) return;
    writeFileSync(resolve(job, 'pre-pour-circuit.json'), JSON.stringify(geometry));
    const mapping = Object.fromEntries(graph.parts.map(p => [p.ref, Object.fromEntries(imports.get(p.part).pins)]));
    const repaired = nativeExitPhases.length
      ? repairNativeExits(geometry, graph, mapping, nativeExitPhases, { nativeRoutingInputs: routingAudit, ...(hasRpProfile ? { existingJoinGeometry: 'defer-to-physical-network-oracle' as const } : {}) })
      : repairSavedSources(geometry, graph, mapping, savedFanoutEvidence!, { nativeRoutingInputs: routingAudit });
    if (repaired.unrepairedTraceIds.length) throw new Error('Native copper pour requires proven trace sources: ' + repaired.unrepairedTraceIds.join(', '));
    for (const item of repaired.audit) c.db.pcb_trace.update(item.pcbTraceId, {
      source_trace_id: item.sourceTraceId, source_net_id: item.sourceNetId,
    } as any);
    prePourSourceAudit.push(...repaired.audit);
    if ('deferredExistingTraceIds' in repaired && Array.isArray(repaired.deferredExistingTraceIds)) prePourExistingProofDeferrals.push(...repaired.deferredExistingTraceIds);
    if ('viaAudit' in repaired && Array.isArray(repaired.viaAudit)) for (const item of repaired.viaAudit) {
      c.db.pcb_via.update(item.pcbViaId, { subcircuit_connectivity_map_key: item.connectivityKey });
      prePourViaAudit.push(item);
    }
    checkedPrePourSources = true;
  });
  const replayFlag = process.argv.indexOf('--native-replay');
  const nativeReplayManifest = replayFlag < 0 ? undefined : process.argv[replayFlag + 1];
  if (replayFlag >= 0 && !nativeReplayManifest) throw Error('Missing private native replay manifest');
  if (nativeReplayManifest && nativeClockPreloads) throw Error('Immutable clock preloads require fresh native routing; replay cannot verify native getters');
  const chipRouter = async (input: any) => {
    if (nativeClearanceFloor) {
      const boards = c.getCircuitJson().filter((record:any) => record.type === 'pcb_board') as any[];
      if (boards.length !== 1 || boards[0].min_trace_to_pad_edge_clearance !== .127 || boards[0].min_pad_edge_to_pad_edge_clearance !== .127)
        throw Error('Private native clearance propagation requires the proven actual 0.127mm fabrication rules');
    }
    // Native width expansion and final conservative segment widths need extra
    // room on mixed0.15/0.3mm driver nets. Pad/board fabrication rules stay fixed.
    if (lockPadNets) {
      const mapping = Object.fromEntries(graph.parts.map(p => [p.ref, Object.fromEntries(imports.get(p.part).pins)]));
      const locked = lockKnownPadOwnership(input, c.getCircuitJson(), graph, mapping);
      await save('native-pad-owner-locks.json', locked.audit);
      input = locked.input;
    }
    const mixedWidths = input.connections?.some((connection: any) => (connection.nominalTraceWidth ?? connection.width ?? .15) > .15);
    const mixedPlanning = !nativeLegacySections && graph.parts.some(p => p.part.lcsc === 'C50506') && mixedWidths
      ? { ...input, defaultObstacleMargin: Math.max(.22, input.defaultObstacleMargin ?? 0) }
      : input;
    let planned = withChipRoutingPlanningMargin(mixedPlanning);
    let immutableClock: ImmutablePreloadExpected | undefined;
    if (nativeClockPreloads) {
      if (!rpClock?.props || rpClock.audit.length !== 5) throw Error('Native preloads require the verified five-path clock profile');
      const geometry = c.getCircuitJson();
      const ownerIds = new Set(rpClock.netNames.map(name => {
        const nets = geometry.filter((record: any) => record.type === 'source_net' && record.name === name);
        if(nets.length !== 1) throw Error('Clock preload source net is not unique: ' + name);
        return (nets[0] as any).source_net_id;
      }));
      if (!capturedClockPhase || capturedClockPhase.length !== 5) throw Error('Verified clock phase event is unavailable before global routing');
      const wireGeometry = (route: any[]) => route.map(point => {
        if(point.route_type !== 'wire') throw Error('Clock profile contains unsupported copper');
        return { route_type: point.route_type, x: point.x, y: point.y, width: point.width, layer: point.layer };
      });
      const bindings: any[] = [];
      const matchedClockProfiles = new Set<number>();
      const clocks = capturedClockPhase.map(trace => {
        if (!ownerIds.has(trace.connection_name) || !trace.pcb_trace_id?.startsWith('saved_phase_') || !Array.isArray(trace.connectsTo) || !trace.connectsTo.length || trace.connectsTo.some((id: any) => typeof id !== 'string' || !id.length) || new Set(trace.connectsTo).size !== trace.connectsTo.length) throw Error('Clock event source identity differs from verified profile');
        const net = geometry.find((record: any) => record.type === 'source_net' && record.source_net_id === trace.connection_name) as any;
        const copper = nativeReplayInputSha256(wireGeometry(trace.route));
        const profiles = rpClock!.audit.filter(row => row.net === net.name && (nativeReplayInputSha256(wireGeometry(row.route)) === copper || nativeReplayInputSha256(wireGeometry([...row.route].reverse())) === copper));
        if(profiles.length !== 1) throw Error('Clock event copper differs from the verified profile');
        const profileIndex = rpClock!.audit.indexOf(profiles[0]!);
        if (matchedClockProfiles.has(profileIndex)) throw Error('Clock event repeats a verified profile path');
        matchedClockProfiles.add(profileIndex);
        const declaredPorts = trace.connectsTo.map((id: string) => {
          const ports = geometry.filter((record: any) => record.type === 'pcb_port' && record.pcb_port_id === id) as any[];
          if (ports.length !== 1) throw Error('Clock event alias is not a unique actual physical port');
          const port = ports[0];
          const sources = geometry.filter((record: any) => record.type === 'source_trace' && record.connected_source_port_ids?.length === 1 && record.connected_source_port_ids[0] === port.source_port_id && record.connected_source_net_ids?.length === 1 && record.connected_source_net_ids[0] === trace.connection_name) as any[];
          if (sources.length !== 1 || !sources[0].subcircuit_id || sources[0].subcircuit_id !== port.subcircuit_id) throw Error('Clock event alias is not a unique actual port-to-clock-net declaration');
          return { port, source: sources[0] };
        });
        const netSourcePorts = new Set(geometry.filter((record: any) => record.type === 'source_trace' && record.connected_source_port_ids?.length === 1 && record.connected_source_net_ids?.length === 1 && record.connected_source_net_ids[0] === trace.connection_name).map((record: any) => record.connected_source_port_ids[0]));
        const netPorts = geometry.filter((record: any) => record.type === 'pcb_port' && netSourcePorts.has(record.source_port_id)) as any[];
        if (netPorts.length !== declaredPorts.length || netPorts.some(port => !trace.connectsTo.includes(port.pcb_port_id))) throw Error('Clock event aliases omit an actual clock-net port');
        const first = trace.route[0];
        const ports = declaredPorts.filter(({port}: any) => port.layers?.includes(first.layer) && Math.hypot(port.x-first.x,port.y-first.y)<=1e-7);
        if(ports.length !== 1) throw Error('Clock event does not start at a unique actual physical port');
        const { port, source } = ports[0]!;
        if(trace.source_trace_id !== undefined && trace.source_trace_id !== source.source_trace_id || trace.subcircuit_id !== undefined && trace.subcircuit_id !== source.subcircuit_id) throw Error('Clock event has conflicting source metadata');
        bindings.push({ traceId: trace.pcb_trace_id, portId: port.pcb_port_id, sourcePortId: port.source_port_id, sourceTraceId: source.source_trace_id, sourceNetId: trace.connection_name, subcircuitId: source.subcircuit_id, profileCopperSha256: copper });
        return { ...trace, source_trace_id: source.source_trace_id, subcircuit_id: source.subcircuit_id };
      });
      if (matchedClockProfiles.size !== rpClock.audit.length) throw Error('Clock event omits a verified profile path');
      await save('native-clock-phase-binding.json', { fromPublicPhaseEvent: true, physicalIdentityToleranceMm: 1e-7, copperChanged: false, capturedPhaseSha256: nativeReplayInputSha256(capturedClockPhase), bindings });
      const prepared = prepareImmutablePreloads(planned, clocks);
      planned = prepared.input; immutableClock = prepared.expected;
      await save('native-clock-preloads.json', prepared.audit);
    }
    routingAudit.push({ solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph', input: { input: planned, options: { cacheProvider: null, ...(hasRpProfile && !nativeFullExpansion ? { powerTraceExpansion: { onlyConnectionNames: [] } } : {}) } } });
    if(ownerGuard) Object.assign(routingAudit.at(-1), { nativeOwnerGuard: ownerGuard.audit });
    await save('router-input.json', planned);
    if (nativeReplayManifest) {
      const manifest = JSON.parse(await readFile(nativeReplayManifest, 'utf8'));
      const projected = hasRpProfile && !nativePadEscape ? withSmtViaExclusionColumns(planned) : { input: planned, audit: [] };
      const replayInput = nativeReplayInputSha256(planned) === manifest.inputSha256 ? planned : projected.input;
      const replay = await loadNativeReplay(nativeReplayManifest, job, replayInput);
      Object.assign(routingAudit.at(-1), { input: { input: replayInput, options: { cacheProvider: null } } });
      await save('router-input.json', replayInput);
      await save('via-exclusion-columns.json', replayInput === planned ? [] : projected.audit);
      Object.assign(routingAudit.at(-1), { solver: 'AutoroutingPipelineSolver9_PreloadedTraceGraph', execution: replay.receipt.execution, reuse: replay.receipt });
      await save('native-replay.json', replay.receipt);
      const handlers = new Map<string, Array<(event: any) => void>>();
      let stopped = false, started = false;
      const output = { ...replayInput, traces: replay.traces };
      const complete = () => { if (!stopped) for (const fn of handlers.get('complete') ?? []) fn({ traces: replay.traces }); };
      return {
        on(name: string, fn: (event: any) => void) { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
        start() { if (!started && !stopped) { started = true; queueMicrotask(complete); } },
        stop() { stopped = true; },
        async run() { if (stopped) throw Error('Captured native replay was stopped'); this.start(); },
        getOutputSimpleRouteJson(): any { return output; },
      };
    }
    const viaColumns = hasRpProfile && !nativePadEscape ? withSmtViaExclusionColumns(planned) : { input: planned, audit: [] };
    const routingInput = viaColumns.input;
    Object.assign(routingAudit.at(-1), { input: { input: routingInput, options: { cacheProvider: null, ...(hasRpProfile && !nativeFullExpansion ? { powerTraceExpansion: { onlyConnectionNames: [] } } : {}) } } });
    await save('router-input.json', routingInput);
    await save('via-exclusion-columns.json', viaColumns.audit);
    const native = await chipAutorouter(routingInput, { engine: 'pipeline9', guardedPipeline9: ownerGuard?.Pipeline9, immutablePreloads: immutableClock, allowClockRefinement: nativeClockRefinement,
      onAcceptedClockTraces: traces => { acceptedClockTraces = structuredClone(traces); },
      onImmutablePreloads: evidence => save('native-clock-preload-check.json', evidence), minimumWidthsOnly: hasRpProfile && !nativeFullExpansion, frameQuarterTurns: nativeFrameQuarter, onFrame: async evidence => { await save('router-native-frame.json', evidence); Object.assign(routingAudit.at(-1), { coordinateFrame: { ...evidence, nativeInput: undefined }, nativeInputArtifact: 'router-native-frame.json', inputUsesPhysicalBoardFrame: true }); }, onFailure: evidence => save('router-error.json', evidence), widthRules: { traceToPad: input.minTraceToPadEdgeClearance ?? .127, traceToTrace: .127, viaToPad: input.minViaEdgeToPadEdgeClearance ?? .127 }, onWidths: evidence => save('native-width-refinement.json', evidence), onNativeSolved: evidence => save('native-before-width.json', evidence) });
    let lastPhase: number | undefined;
    native.on('progress', event => {
      if (event.phaseIndex === lastPhase) return;
      lastPhase = event.phaseIndex;
      writeFileSync(resolve(job, 'router-progress.json'), JSON.stringify({ phase: event.phase, phaseIndex: event.phaseIndex, progress: event.progress, elapsedMs: performance.now() - start }));
    });
    return native;
  };
  const sensorRouter = async (input: any) => {
    const { input: next, moves } = relocateSensorConnectionPoints(input, graph);
    for (const hole of c.getCircuitJson().filter((e: any) => e.type === 'pcb_hole') as any[]) {
      if (hole.hole_shape !== 'circle' && hole.hole_shape !== undefined) continue;
      const diameter = hole.hole_diameter ?? hole.diameter;
      if (!diameter) continue;
      next.obstacles.push({
        type: 'rect',
        obstacleId: 'hole_margin_' + hole.pcb_hole_id,
        center: { x: hole.x, y: hole.y },
        width: diameter + 0.1,
        height: diameter + 0.1,
        layers: ['top', 'bottom'],
        connectedTo: [],
      });
    }
    await save('router-input.json', { ...next, padExits: moves });
    return makerAutorouter(next);
  };
  const boardProps = {
    width,
    height,
    layers: plan.layers,
    ...(effectivePlan.board?.cornerRadiusMm
      ? { outline: roundedBoardOutline(width, height, effectivePlan.board.cornerRadiusMm) }
      : {}),
    schematicDisabled: true,
    routeRemaining: true,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.127,
    minPadEdgeToPadEdgeClearance: 0.127,
    minViaEdgeToPadEdgeClearance: 0.127,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: 0.6,
    pcbStyle: { viaHoleDiameter: 0.3, viaPadDiameter: 0.6 },
    ...(graph.parts.some(p => isFanoutTarget(p.part)) ? { autorouterEffortLevel: '2x' } : {}),
    ...((hasRpProfile || useTopGroundPlane || useGroundPlanePhase) ? { minViaHoleEdgeToViaHoleEdgeClearance: 0.2 } : {}),
    ...(useGroundPlanePhase ? { fanoutPourNetMap: { bottom: 'GND' } } : {}),
    autorouter: graph.parts.some((p) => p.part.lcsc === 'C2909890')
      ? { local: true, algorithmFn: sensorRouter }
      : graph.parts.some((p) => p.part.lcsc === 'C2040')
      ? { local: true, algorithmFn: chipRouter }
      : { preset: 'auto' },
  };
  let fanoutNode: any = null;
  let savedFanoutEvidence: SavedPhaseEvidence | null = null;
  let rpEscape: RpEscapePhase | null = null;
  let rpGround: RpEscapePhase | null = null;
  let rpClock: ReturnType<typeof createRpClockPhase> | null = null;
  let phaseOffset = 0;
  const clockNetNames = new Set<string>();
  if (hasRpProfile) {
    await stage('fanout', async () => {
      const diagnostic = new RootCircuit({ platform: { routingDisabled: true } });
      diagnostic.add(e('board', boardProps, ...nodes));
      diagnostic.render(); await diagnostic.renderUntilSettled();
      const geometry = diagnostic.getCircuitJson();
      const mapping = Object.fromEntries(graph.parts.map(p => [p.ref, Object.fromEntries(imports.get(p.part).pins)]));
      const clock = createRpClockPhase(geometry, graph, mapping);
      await save('clock-phase.json', clock);
      rpClock = clock;
      rpEscape = nativePadEscape ? null : createRpEscapePhase(geometry, graph, mapping, clock, { applicationVias: true, usbVias: true });
      rpGround = nativeGroundEscapes ? createRpEscapePhase(geometry, graph, mapping, clock, { groundOnly: true }) : null;
      if (rpGround) await save('rp-ground-escape-phase.json', rpGround);
      await save('rp-escape-phase.json', rpEscape ?? { strategy: 'native-pad-escape', fixedRpVias: 0, allowViaInPad: false });
      if (clock.props) {
        const names = new Set(clock.netNames);
        for (const name of names) clockNetNames.add(name);
        nodes = nodes.map(node => {
          const name = node.type === 'net' ? node.props.name : node.type === 'trace' && node.props.to?.startsWith('net.') ? node.props.to.slice(4) : undefined;
          return names.has(name) ? cloneElement(node, { routingPhaseIndex: 0 }) : node;
        });
        nodes.push(e('autoroutingphase', clock.props));
        phaseOffset = 1;
      }
    });
  }
  if (!nativeClockOnly && (graph.parts.some((p) => isFanoutTarget(p.part) || p.part.lcsc === 'C50506') || hasRpProfile)) {
    await stage('fanout', async () => {
      const diagnostic = new RootCircuit({ platform: { routingDisabled: true } });
      diagnostic.add(e('board', boardProps, ...nodes));
      diagnostic.render();
      await diagnostic.renderUntilSettled();
      const geometry = diagnostic.getCircuitJson();
      const mapping = Object.fromEntries(graph.parts.map(p => [p.ref, Object.fromEntries(imports.get(p.part).pins)]));
      const driver = createDrv8833EscapeProposals(geometry, graph, mapping);
      await save('drv8833-escape-phase.json', driver);
      const planned = planFanout(
        geometry,
        graph,
        Object.fromEntries(graph.parts.map((p) => [p.ref, Object.fromEntries(imports.get(p.part).pins)])),
      );
      await save('fanout-check.json', planned);
      if (!planned.ok)
        throw new Error(
          'Automatic pad exits failed: ' +
            planned.diagnostics
              .filter((d) => d.severity === 'error')
              .map((d) => `${d.ref ?? ''}.${d.pad ?? ''}: ${d.message}`)
              .join('; '),
        );
      const groundPins = new Set(graph.nets.filter(net => net.pins.some(pin => graph.parts.find(p => p.ref === pin.ref)!.part.pins[pin.logical]!.role === 'ground')).flatMap(net => net.pins.map(pin => `${pin.ref}.${pin.pad}`)));
      const rpSignals = rpEscape?.props && rpClock ? createRpSignalEscapeProposals(geometry, graph, mapping, rpClock, rpEscape, new Set([...driver.netNames, ...rpEscape.netNames])) : { proposals: [], audit: [], netNames: [] };
      await save('rp-signal-escape-phase.json', rpSignals);
      const usbExits = rpEscape?.props && rpClock ? createUsbSinkEscapeProposals(geometry, graph, mapping, [
        ...rpClock.audit, ...rpEscape.audit, ...rpSignals.audit,
        ...driver.proposals.map(p => ({ selector: `.${p.ref} > .pin${p.pad}`, netName: driver.audit.find(a => a.ref === p.ref && a.pad === p.pad)!.net, route: p.route })),
      ]) : { proposals: [], audit: [], netNames: [] };
      await save('usb-sink-escape-phase.json', usbExits);
      const coreInstances = new Set(graph.parts.filter(p => p.part.lcsc === 'C2040').map(p => p.inst));
      const selectedNetNames = new Set([...clockNetNames, ...(rpEscape?.netNames ?? []), ...(rpGround?.netNames ?? []), ...rpSignals.netNames, ...usbExits.netNames, ...driver.netNames,
        ...planned.proposals.flatMap(p => graph.nets.filter(n => n.pins.some(pin => pin.ref === p.ref && pin.pad === p.pad)).map(n => n.name)),
      ]);
      const missingCoreNets = new Set(hasRpProfile ? graph.nets.filter(n => n.pins.length > 1 && !selectedNetNames.has(n.name)
        && n.pins.some(pin => coreInstances.has(graph.parts.find(p => p.ref === pin.ref)!.inst))).map(n => n.name) : []);
      const handoffs = missingCoreNets.size ? createNativePadHandoffs(geometry, graph, mapping, missingCoreNets, { allowFinePitchPads: nativePadEscape }) : { proposals: [], audit: [], netNames: [] };
      await save('native-pad-handoffs.json', handoffs);
      const proposals = [...handoffs.proposals, ...rpSignals.proposals, ...usbExits.proposals, ...(useGroundPlanePhase ? planned.proposals.filter(p => !groundPins.has(`${p.ref}.${p.pad}`)) : planned.proposals), ...driver.proposals];
      let bound = createNativeFanoutPhase(geometry, proposals, { topGroundPlane: useTopGroundPlane, retainGroundExits: useTopGroundPlane,
        allowPreRoutedFootprintHints: graph.parts.some(p => p.part.lcsc === 'C2909890') });
      if (bound.preRoutedFootprintHints.length) {
        // Mixed-device phases must see every sensor escape before routing its
        // power and ground nets. Transfer the verified footprint paths into the
        // same native saved fanout phase instead of retaining duplicate copper.
        const hints = bound.preRoutedFootprintHints.map(h => {
          const trace: any = geometry.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === h.diagnosticPcbTraceId)!;
          return { ref: h.ref, pad: h.pad, route: trace.route.map((p: any) => ({ route_type: 'wire' as const, x: p.x, y: p.y, layer: p.layer, width: p.width })) };
        });
        bound = createNativeFanoutPhase(geometry, [...proposals, ...hints], { topGroundPlane: useTopGroundPlane, retainGroundExits: useTopGroundPlane, allowPreRoutedFootprintHints: true });
        const sensorRefs = new Set(bound.preRoutedFootprintHints.map(h => h.ref));
        nodes = nodes.map(node => node.type === 'trace' && [...sensorRefs].some(ref => node.props.from?.startsWith(`.${ref} > `)) ? cloneElement(node, { pcbPath: undefined }) : node);
      }
      const exitPhase = phaseOffset + 1;
      const mergedPaths = [...(rpEscape?.props?.pcbTracePaths ?? []), ...(rpGround?.props?.pcbTracePaths ?? []), ...(bound.props?.pcbTracePaths ?? [])];
      const mergedNames = [...new Set([...(rpEscape?.netNames ?? []), ...(rpGround?.netNames ?? []), ...bound.netNames])];
      const mergedProps = mergedPaths.length ? {
        ...(bound.props ?? rpEscape?.props ?? rpGround!.props!), fanoutPourNetMap: bound.props?.fanoutPourNetMap, name: 'compiler-pad-exits', phaseIndex: exitPhase,
        connections: mergedPaths.map(path => path.connection), pcbTracePaths: mergedPaths,
      } : null;
      if (mergedProps && (hasRpProfile || rpEscape?.props || driver.proposals.length)) {
        const audit = [
          ...(rpEscape?.audit ?? []),
          ...(rpGround?.audit ?? []),
          ...bound.audit.map(item => ({ ...item, netName: item.netNames[0]!, route: bound.props!.pcbTracePaths.find(path => path.connection === item.selector)!.route })),
        ];
        nativeExitPhases.push({ props: mergedProps, audit });
        await save('native-exit-phase.json', nativeExitPhases);
      }
      const phaseEvidence = { props: mergedProps, audit: bound.audit, netNames: mergedNames, omittedGround: bound.omittedGround, retainedGround: bound.retainedGround, groundPlane: bound.groundPlane, preRoutedFootprintHints: bound.preRoutedFootprintHints };
      if (phaseEvidence.props && bound.preRoutedFootprintHints.length) savedFanoutEvidence = phaseEvidence as SavedPhaseEvidence;
      await save('fanout-phase.json', phaseEvidence);
      const touched = new Set(mergedNames);
      // A composite MCU block includes unrelated oscillator/QSPI nets. Its
      // USB phase follows actual connector contacts, not every block member.
      const usbParts = new Set(graph.parts.filter(p => p.block.constraints.some(c => c.kind === 'usb-c-sink' && (!p.block.mcu || p.localRef === c.connector || c.resistors.includes(p.localRef)))).map(p => p.ref));
      const usbNets = new Set(graph.nets.filter(net => net.pins.some(pin => usbParts.has(pin.ref)) && !net.pins.some(pin => ['power-in', 'power-out', 'ground'].includes(graph.parts.find(p => p.ref === pin.ref)!.part.pins[pin.logical]!.role))).map(net => net.name));
      // Every remaining RP pin net belongs to the same native follow-up as its
      // saved power/signal/driver exits, preventing circular phase reservations.
      const rpSignalNets = selectRpCriticalSignalNets(graph, touched, clockNetNames);
      if (hasRpProfile && !nativePadEscape && [...usbNets].some(name => !touched.has(name))) throw Error('RP native exits lack joint USB coverage');
      if (hasRpProfile && !nativePadEscape && rpSignalNets.size) throw Error('RP native exits lack joint signal coverage: ' + [...rpSignalNets].join(', '));
      const earlySignalNets = hasRpProfile ? new Set<string>() : usbNets;
      const usbPhase = phaseOffset;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const netName = node.type === 'net' ? node.props.name : node.type === 'trace' && typeof node.props.to === 'string' && node.props.to.startsWith('net.') ? node.props.to.slice(4) : undefined;
        if (netName && earlySignalNets.has(netName)) nodes[i] = cloneElement(node, { routingPhaseIndex: usbPhase });
        else if (useGroundPlanePhase && node.type === 'trace' && netName === 'GND') nodes[i] = cloneElement(node, { routingPhaseIndex: phaseOffset + 2 });
        else if (netName && touched.has(netName)) nodes[i] = cloneElement(node, { routingPhaseIndex: exitPhase });
      }
      fanoutNode = mergedProps ? e('autoroutingphase', mergedProps) : null;
      if (earlySignalNets.size) nodes.push(e('autoroutingphase', { name: 'usb-cc-data', phaseIndex: usbPhase, autorouter: 'auto' }));
      if (useGroundPlanePhase) {
        nodes.push(e('autoroutingphase', { name: 'ground-plane-contacts', phaseIndex: phaseOffset + 2, autorouter: 'auto', fanoutPourNetMap: { bottom: 'GND' } }));
      }
      await save('routing-plan.json', { usbNets: [...usbNets], rpSignalNets: [...rpSignals.netNames], handoffNets: handoffs.netNames, usbPhase: hasRpProfile ? null : usbPhase, denseNets: mergedNames, densePhase: exitPhase, clockPhase: hasRpProfile ? 0 : null, ground: useGroundPlanePhase ? { phaseIndex: phaseOffset + 2, layer: 'bottom', nativeFanout: true, singlePortDrops: groundPins.size, requiresPhysicalContinuityGate: true } : bound.groundPlane });
    });
  }
  await stage('render', async () => {
    const boardNode = e('board', boardProps, ...nodes, ...(fanoutNode ? [fanoutNode] : []));
    const customRouting = useGroundPlanePhase || graph.parts.some(p => ['C2909890', 'C2040'].includes(p.part.lcsc));
    if (!customRouting) await save('debug.circuit.tsx', nativeDebugSource(boardNode));
    else await save('debug-source.json', { reason: 'Trusted native solver callbacks require engine context; replay native-routing.json phase inputs with the recorded tool versions.', engine: 'eda/blocks/build.ts' });
    c.add(boardNode);
    c.render();
  });
  await stage('route', () => c.renderUntilSettled());
  let cj: any[] = c.getCircuitJson();
  if (nativeClockRefinement && !asyncErrors.length && !cj.some(record => record.type === 'pcb_autorouting_error')) {
    await save('native-clock-materialized-circuit.json', cj);
    if (!acceptedClockTraces || acceptedClockTraces.length !== 5) throw Error('Refined clock materialization lacks its complete native certificate');
    const clockNetIds = new Set(acceptedClockTraces.map(trace => trace.connection_name));
    const clockSourceIds = new Set(cj.filter(record => record.type === 'source_trace' && record.connected_source_net_ids?.some((id:string) => clockNetIds.has(id))).map(record => record.source_trace_id));
    const clockTraceIds = new Set(acceptedClockTraces.map(trace => trace.pcb_trace_id));
    const clockPortIds = new Set(acceptedClockTraces.flatMap(trace => trace.connectsTo));
    if (cj.some(record => record.type === 'pcb_trace' && (clockSourceIds.has(record.source_trace_id) || clockNetIds.has(record.source_net_id) || record.route?.some((point:any) => clockPortIds.has(point.start_pcb_port_id) || clockPortIds.has(point.end_pcb_port_id))) && !clockTraceIds.has(record.pcb_trace_id)))
      throw Error('Refined clock materialization contains additional uncertified clock copper');
    const geometry = (route:any[]) => route.map(({route_type,x,y,layer,width}:any) => ({route_type,x,y,layer,width}));
    const materialized = acceptedClockTraces.map(expected => {
      const actual = cj.filter(record => record.type === 'pcb_trace' && record.pcb_trace_id === expected.pcb_trace_id);
      if (actual.length !== 1 || actual[0].subcircuit_id !== expected.subcircuit_id)
        throw Error('Refined clock source or unique materialized identity differs from native output');
      // Core's saved phase chooses a canonical one-port declaration on the
      // same clock net; it need not choose this route's first terminal.
      const sources = cj.filter(record => record.type === 'source_trace' && record.source_trace_id === actual[0].source_trace_id);
      if (sources.length !== 1 || sources[0].subcircuit_id !== expected.subcircuit_id || sources[0].connected_source_port_ids?.length !== 1 || sources[0].connected_source_net_ids?.length !== 1 || sources[0].connected_source_net_ids[0] !== expected.connection_name)
        throw Error('Materialized clock lacks a unique canonical declaration on its original net');
      const ports = cj.filter(record => record.type === 'pcb_port' && record.source_port_id === sources[0].connected_source_port_ids[0] && record.subcircuit_id === expected.subcircuit_id);
      if (ports.length !== 1 || !expected.connectsTo.includes(ports[0].pcb_port_id))
        throw Error('Materialized clock source is not one of its original physical terminals');
      const wanted = nativeReplayInputSha256(geometry(expected.route));
      if (nativeReplayInputSha256(geometry(actual[0].route)) !== wanted && nativeReplayInputSha256(geometry([...actual[0].route].reverse())) !== wanted)
        throw Error('Refined native clock copper was not materialized exactly');
      return {traceId:expected.pcb_trace_id,sourceTraceId:actual[0].source_trace_id,nativePreloadSourceTraceId:expected.source_trace_id,sourceNetId:expected.connection_name,copperSha256:wanted};
    });
    await save('native-clock-materialization.json', {ok:true,officialStageReplacement:true,clockTraces:materialized});
  }
  await save('native-async-errors.json', { ok: !asyncErrors.length, errors: asyncErrors });
  await save('native-routing.json', routingAudit);
  const routingFailed = asyncErrors.length > 0 || cj.some(item => item.type === 'pcb_autorouting_error');
  if (routingFailed && (savedFanoutEvidence || nativeExitPhases.length))
    await save('native-source-attribution.json', { checked: false, reason: 'Native routing failed before all audited prefixes were materialized', beforePour: prePourSourceAudit, beforePourVias: prePourViaAudit });
  if (!routingFailed && (savedFanoutEvidence || nativeExitPhases.length)) {
    const mapping = Object.fromEntries(graph.parts.map(p => [p.ref, Object.fromEntries(imports.get(p.part).pins)]));
    const repaired = nativeExitPhases.length
      ? repairNativeExits(cj, graph, mapping, nativeExitPhases, { nativeRoutingInputs: routingAudit, ...(hasRpProfile ? { existingJoinGeometry: 'defer-to-physical-network-oracle' as const } : {}) })
      : repairSavedSources(cj, graph, mapping, savedFanoutEvidence!, { nativeRoutingInputs: routingAudit });
    await save('native-source-attribution.json', { beforePour: prePourSourceAudit, beforePourVias: prePourViaAudit, prePourExistingProofDeferrals, deferredExistingTraceIds: 'deferredExistingTraceIds' in repaired ? repaired.deferredExistingTraceIds : [], allNetPhysicalOracleRequired: hasRpProfile, audit: repaired.audit, viaAudit: 'viaAudit' in repaired ? repaired.viaAudit : [], unrepairedTraceIds: repaired.unrepairedTraceIds });
    if (repaired.unrepairedTraceIds.length) throw new Error('Native routed traces lack proven source attribution: ' + repaired.unrepairedTraceIds.join(', '));
    const booleanRuntime = cj.some(item => item.type === 'source_runtime_error' && typeof item.message === 'string'
      && item.message.startsWith('DRC could not complete (routing): ') && item.message.endsWith('Cannot complete boolean operation'));
    if (repaired.audit.length || ('viaAudit' in repaired && Array.isArray(repaired.viaAudit) && repaired.viaAudit.length) || booleanRuntime) {
      // Every native check still runs. A completed, units-only native pour-short
      // retry replaces only its exact reproduced aborted-check diagnostic.
      const checks = async (circuit: any[]) => {
        const placement = await runAllPlacementChecks(structuredClone(circuit));
        const routing = await runRobustRoutingChecks(structuredClone(circuit));
        return { issues: [...placement, ...routing.issues], retries: routing.retries };
      };
      const diagnosticKey = (item: any) => JSON.stringify([item.type, item.message]);
      const originalChecks = await checks(cj);
      const baseline = new Set(originalChecks.issues.map(diagnosticKey));
      for (const retry of originalChecks.retries) baseline.add(diagnosticKey({ type: 'source_runtime_error', message: 'DRC could not complete (routing): ' + retry.originalError }));
      const retained = repaired.circuit.filter(item =>
        !((item.type.endsWith('_error') || item.type.endsWith('_warning')) && baseline.has(diagnosticKey(item))));
      const fresh = await checks(retained);
      cj = [...retained, ...fresh.issues];
      await save('native-routing-check-retries.json', { original: originalChecks.retries, fresh: fresh.retries, allUnscaledChecksRetained: true });
    }
  }
  const netlistErrors = nativeNetlistIssues(
    graph,
    cj,
    Object.fromEntries(graph.parts.map((p) => [p.ref, Object.fromEntries(imports.get(p.part).pins)])),
  );
  await save('netlist-check.json', { ok: !netlistErrors.length, issues: netlistErrors });
  await save('circuit.json', cj);
  await save('pcb.svg', convertCircuitJsonToPcbSvg(cj));
  const errors = cj
      .filter((x) => x.type.endsWith('_error'))
      .map((x) => ({ type: x.type, message: String(x.message ?? x.error_type ?? x.type) })),
    warnings = cj
      .filter((x) => x.type.endsWith('_warning'))
      .map((x) => ({ type: x.type, message: String(x.message ?? x.type) }));
  const widthIssues = checkNativeTraceWidths(cj);
  await save('native-width-check.json', { ok: !widthIssues.length, issues: widthIssues });
  errors.push(...widthIssues);
  const placementCheck = nativePlacementIssues(graph, cj);
  await save('placement-check.json', placementCheck);
  errors.push(...netlistErrors, ...placementCheck.issues, ...asyncErrors.map(message => ({ type: 'pcb_native_async_error', message }))); 
  if (
    errors.some((e) => ['pcb_autorouting_error', 'pcb_native_async_error'].includes(e.type)) ||
    (errors.length && !cj.some((e) => e.type === 'pcb_trace'))
  ) {
    const routeStage = stages.find((s) => s.name === 'route');
    if (routeStage) {
      routeStage.status = 'failed';
      routeStage.note = asyncErrors.length ? asyncErrors.join('; ') : 'Native routing did not complete; resolve placement/source errors before routing';
    }
  }
  await stage('gltf', async () => {
    const scene = await convertCircuitJsonTo3D(cj, {
      renderBoardTextures: true,
      textureResolution: 768,
      pcbColor: '#14492f',
      solderMaskWithCopperColor: '#1a5a3a',
    });
    const glb = await convertSceneToGLTF(scene, { binary: true, embedImages: true, forceIndices: true });
    await save('board.glb', new Uint8Array(glb as ArrayBuffer));
  });
  await stage('fab', async () => {
    const files = convertCircuitJsonToGerberFiles(cj);
    await save(
      'gerbers.zip',
      zipSync(Object.fromEntries(Object.entries(files).map(([n, s]) => [n, strToU8(s)]))),
    );
    const converters = [
      new CircuitJsonToKicadPcbConverter(cj),
      new CircuitJsonToKicadSchConverter(cj),
      new CircuitJsonToKicadProConverter(cj, { projectName: 'moki-chip' }),
    ];
    converters.forEach((c) => c.runUntilFinished());
    await save(
      'kicad.zip',
      zipSync(
        Object.fromEntries(
          converters.map((c, i) => [
            ['moki-chip.kicad_pcb', 'moki-chip.kicad_sch', 'moki-chip.kicad_pro'][i]!,
            strToU8(c.getOutputString().replace(/^([ \t]*)\(power[ \t]+global\)[ \t]*$/gm, '$1(power)')),
          ]),
        ),
      ),
    );
    const csv = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`,
      bom = ['Comment,Designator,Footprint,LCSC Part #,Review status'],
      cpl = ['Designator,Mid X,Mid Y,Layer,Rotation,LCSC Part #,Review status'];
    for (const p of graph.parts) {
      const source = cj.find((x) => x.type === 'source_component' && x.name === p.ref),
        pcb = cj.find(
          (x) => x.type === 'pcb_component' && x.source_component_id === source?.source_component_id,
        );
      if (!pcb) throw new Error(`Missing placement ${p.ref}`);
      bom.push(
        [p.part.value ?? p.part.mpn, p.ref, p.part.footprint?.id ?? p.part.lcsc, p.part.lcsc, p.block.status]
          .map(csv)
          .join(','),
      );
      cpl.push(
        [
          p.ref,
          pcb.footprint_origin?.x ?? pcb.center.x,
          pcb.footprint_origin?.y ?? pcb.center.y,
          pcb.layer,
          pcb.rotation,
          p.part.lcsc,
          p.block.status,
        ]
          .map(csv)
          .join(','),
      );
    }
    await save('bom.csv', bom.join('\n') + '\n');
    await save('pnp.csv', cpl.join('\n') + '\n');
    await save('cpl.csv', cpl.join('\n') + '\n');
  });
  if (plan.layers === 4 || hasRpProfile) {
    const { checkCopperNetlist } = await import('./copper-netlist');
    const continuity = checkCopperNetlist(graph, cj, Object.fromEntries(graph.parts.map(p => [p.ref, Object.fromEntries(imports.get(p.part).pins)])), { policy: useTopGroundPlane ? 'top-plane' : 'physical-network', ...(hasRpProfile ? { scope: 'all' as const } : {}) });
    await save(hasRpProfile ? 'all-net-copper-check.json' : 'ground-copper-check.json', continuity);
    const expectedNames = graph.nets.map(n => n.name).sort();
    const measuredNames = continuity.networks?.map(n => n.name).sort();
    const complete = !hasRpProfile || (continuity.checked === true && continuity.scope === 'all-nets-actual-copper' && JSON.stringify(measuredNames) === JSON.stringify(expectedNames));
    if (!continuity.ok || !complete) {
      if (hasRpProfile) {
        const physicalErrors = continuity.issues.filter(i => i.severity === 'error');
        errors.push(...physicalErrors.map(i => ({ type: 'pcb_physical_netlist_error', message: i.message })));
        if (!continuity.ok && !physicalErrors.length) errors.push({ type: 'pcb_physical_netlist_error', message: 'Physical copper oracle did not certify connectivity/isolation' });
        if (!complete) errors.push({ type: 'pcb_physical_netlist_error', message: 'Physical copper oracle did not check every actual graph net' });
      } else errors.push({ type: 'pcb_ground_copper_error', message: 'Actual ground copper is not continuous/isolated; see ground-copper-check.json' });
    }
  }
  const sensorCheck = await checkSensorCopper(job);
  if (!sensorCheck.ok)
    errors.push({
      type: 'pcb_sensor_keepout_error',
      message:
        'Exported sensor copper/paste does not meet the datasheet keepout; see sensor-copper-check.json',
    });
  await save('receipt.json', {
    stages,
    totalMs: performance.now() - start,
    drc: { checked: true, errors, warnings },
    board: {
      widthMm: width,
      heightMm: height,
      layers: plan.layers,
      traceCount: cj.filter((x) => x.type === 'pcb_trace').length,
      viaCount: cj.filter((x) => x.type === 'pcb_via').length,
    },
    nativeClockPreloads,
    nativeClockRefinement,
    nativeClearanceFloor,
    nativeGroundEscapes,
    nativeFullExpansion,
    nativeLegacySections,
    nativeClockOnly,
    nativeOwnerGuard: ownerGuard?.audit,
    nativePadOwnershipLocked: lockPadNets,
    nativeFrameQuarterTurns: nativeReplayManifest ? null : nativeFrameQuarter,
    routingStrategy: nativePadEscape ? 'native-pad-escape-private-diagnostic' : 'qualified-fixed-escapes',
    toolVersions: versionSnapshot,
  });
  process.exitCode = errors.length ? 2 : 0;
} catch (error) {
  await save('render-error.json', { error: String(error), stages, totalMs: performance.now() - start });
  console.error(error);
  process.exitCode = 1;
}
