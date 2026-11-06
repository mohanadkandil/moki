import { readFileSync, writeFileSync } from 'node:fs';
import { repairSavedSources } from '../../../../../../../eda/blocks/repair-saved-sources.js';
import {
  convertCircuitJsonToInputProblem,
  CopperPourPipelineSolver,
  initializeManifoldGeometry,
} from '../../../../../../../eda/node_modules/@tscircuit/copper-pour-solver/dist/index.js';
const root = new URL('./', import.meta.url),
  read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const circuit = read('circuit.json').filter((e: any) => e.type !== 'pcb_copper_pour');
for (const trace of circuit.filter((e: any) => e.type === 'pcb_trace'))
  for (const p of trace.route) {
    delete p.is_inside_copper_pour;
    delete p.copper_pour_id;
  }
// Port markers are attached by later DRC, so omit them in this derived pre-pour input.
for (const trace of circuit.filter(
  (e: any) => e.type === 'pcb_trace' && e.pcb_trace_id.startsWith('saved_phase_'),
))
  for (const p of trace.route) {
    delete p.start_pcb_port_id;
    delete p.end_pcb_port_id;
  }
const mapping = Object.fromEntries(read('import-map.json').parts.map((p: any) => [p.ref, p.pins]));
const fixed = repairSavedSources(circuit, read('plan-graph.json'), mapping, read('fanout-phase.json'), {
  nativeRoutingInputs: read('native-routing.json'),
});
const gnd = circuit.find((e: any) => e.type === 'source_net' && e.name === 'GND'),
  join = circuit.find((e: any) => e.type === 'pcb_trace' && e.pcb_trace_id === 'source_net_1_mst7_0');
const opts = {
  layer: 'top' as const,
  source_net_id: gnd.source_net_id,
  subcircuit_id: gnd.subcircuit_id,
  pad_margin: 0.127,
  trace_margin: 0.127,
  outline: [
    { x: -4, y: -11 },
    { x: 2, y: -11 },
    { x: 2, y: -5 },
    { x: -4, y: -5 },
  ],
  board_edge_margin: 0,
};
const before = convertCircuitJsonToInputProblem(circuit, opts),
  after = convertCircuitJsonToInputProblem(fixed.circuit, opts);
const target = (input: any) => input.pads.filter((p: any) => p.padId.startsWith(join.pcb_trace_id + '-'));
console.log(
  JSON.stringify({
    before: target(before),
    after: target(after).map((p: any) => ({
      padId: p.padId,
      key: p.connectivityKey,
      shape: p.shape,
      pointCount: p.segments?.length,
    })),
    gnd: after.regionsForPour[0]?.connectivityKey,
  }),
);
await initializeManifoldGeometry();
// BOUNDED isolated converter-output reduction: keep the actual join's obstacle
// and one6x6mm region. Tests the official pour geometry primitive, not a board
// render/router or full production pour.
const minimal = (input: any) => ({ regionsForPour: input.regionsForPour, pads: target(input) });
const p0 = new CopperPourPipelineSolver(minimal(before)).getOutput(),
  p1 = new CopperPourPipelineSolver(minimal(after)).getOutput();
writeFileSync(
  new URL('pre-pour-proof.json', root),
  JSON.stringify(
    {
      kind: 'derived actual pre-pour conversion and bounded isolated6x6mm official pour regeneration',
      jobId: '53a0adba-0f2f-41d9-ac61-d43805a2e45e',
      sourceMetadataRepairs: fixed.audit,
      groundKey: after.regionsForPour[0]?.connectivityKey,
      before: { joinObstacles: target(before), pours: p0.brep_shapes },
      after: { joinObstacles: target(after), pours: p1.brep_shapes },
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    beforeShapes: p0.brep_shapes.length,
    afterShapes: p1.brep_shapes.length,
    beforeHoles: p0.brep_shapes.map((p: any) => p.inner_rings.length),
    afterHoles: p1.brep_shapes.map((p: any) => p.inner_rings.length),
  }),
);
