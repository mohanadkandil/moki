import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planGraph } from '../src/blocks/graph.js';
import { resolvePlanBlocks } from '../src/blocks/library.js';
import { nativePlacementIssues } from '../src/blocks/native-placement.js';
const base = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/sht40-board/';
async function actual() {
  const read = async (n: string) => JSON.parse(await readFile(base + n, 'utf8'));
  const plan = await read('plan.json');
  return { graph: planGraph(plan, resolvePlanBlocks(plan)), circuit: await read('circuit.json') };
}
test('actual native origins and decoupling distances match compiled SHT plan', async () => {
  const { graph, circuit } = await actual(),
    gate = nativePlacementIssues(graph, circuit);
  assert.equal(gate.ok, true, JSON.stringify(gate));
  assert.ok(gate.measurements.length);
});
test('shifted capacitor origin cannot pass native placement or decoupling checks', async () => {
  const { graph, circuit } = await actual(),
    part = graph.parts.find((p) => p.part.lcsc === 'C2909890')!,
    constraint = part.block.constraints.find((c) => c.kind === 'decoupling');
  assert.ok(constraint && constraint.kind === 'decoupling');
  const cap = graph.parts.find((p) => p.inst === part.inst && p.localRef === constraint.caps[0])!,
    source = circuit.find((p: any) => p.type === 'source_component' && p.name === cap.ref),
    pcb = circuit.find(
      (p: any) => p.type === 'pcb_component' && p.source_component_id === source.source_component_id,
    );
  pcb.footprint_origin.x += 10;
  const gate = nativePlacementIssues(graph, circuit);
  assert.equal(gate.ok, false);
  assert.ok(gate.issues.some((i) => i.type === 'pcb_compiler_placement_error'));
  assert.ok(gate.issues.some((i) => i.type === 'pcb_decoupling_error'));
});
test('equivalent wrapped rotations match, missing origins and wrong rotation fail', async () => {
  for (const kind of ['wrapped', 'missing', 'wrong']) {
    const { graph, circuit } = await actual(),
      source = circuit.find((p: any) => p.type === 'source_component' && p.name === graph.parts[0]!.ref),
      pcb = circuit.find(
        (p: any) => p.type === 'pcb_component' && p.source_component_id === source.source_component_id,
      );
    if (kind === 'wrapped') pcb.rotation += 360;
    else if (kind === 'missing') {
      delete pcb.footprint_origin;
      delete pcb.center;
    } else pcb.rotation += 90;
    assert.equal(nativePlacementIssues(graph, circuit).ok, kind === 'wrapped', kind);
  }
});
