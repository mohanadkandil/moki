// Native port-association diagnostic, not routing/manufacturing evidence.
import { createElement as e, cloneElement } from 'react';
import { RootCircuit } from 'tscircuit';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolvePlanBlocks, catalogPart } from '../../src/blocks/library';
import { planGraph } from '../../src/blocks/graph';
import { ensurePart } from './imported';
import { nativePart } from './schematic';
const plan = JSON.parse(
    await readFile(
      'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/plan.json',
      'utf8',
    ),
  ),
  blocks = resolvePlanBlocks(plan),
  graph = planGraph(plan, blocks),
  p = graph.parts.find((p) => p.part.lcsc === 'C2913198')!;
const imported = await ensurePart(p.part, catalogPart(p.part.lcsc, p.part.catalogReceipt));
const results: any[] = [];
for (const mode of ['imported-symbol', 'footprint-ports']) {
  let node = nativePart(p, imported, true);
  if (mode === 'footprint-ports') node = cloneElement(node, { symbol: undefined });
  const c = new RootCircuit();
  c.add(e('board', { width: 100, height: 120, schematicDisabled: true, routingDisabled: true }, node));
  c.render();
  await c.renderUntilSettled();
  const cj = c.getCircuitJson();
  const pads = cj.filter((v: any) => v.type === 'pcb_smtpad' && v.port_hints?.includes('pin41')),
    ports = cj.filter(
      (v: any) => v.type === 'source_port' && (v.name === 'pin41' || v.name?.startsWith('pin41_internal_')),
    );
  const result = {
    mode,
    padCount: pads.length,
    unassociated: pads.filter((p: any) => !p.pcb_port_id).length,
    ports,
    internal: cj.filter((v: any) => v.type === 'source_component_internal_connection'),
    errors: cj.filter((v: any) => v.type.endsWith('_error')),
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await mkdir('docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template', { recursive: true });
await writeFile(
  'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/port-diagnostic.json',
  JSON.stringify(results, null, 2),
);

// Pure pad correspondence uses every actual imported footprint. Routing remains disabled.
const nodes: any[] = [],
  mapping: any[] = [];
for (const part of graph.parts) {
  const item = await ensurePart(part.part, catalogPart(part.part.lcsc, part.part.catalogReceipt));
  nodes.push(nativePart(part, item));
  mapping.push({
    ref: part.ref,
    inst: part.inst,
    localRef: part.localRef,
    blockContentHash: part.block.contentHash,
    lcsc: part.part.lcsc,
    catalogReceipt: part.part.catalogReceipt,
    footprintSha256: catalogPart(part.part.lcsc, part.part.catalogReceipt).footprintSha256,
    pins: Object.fromEntries(item.pins),
    omitPads: part.part.omitPads ?? [],
  });
}
const all = new RootCircuit();
all.add(e('board', { width: 100, height: 120, schematicDisabled: true, routingDisabled: true }, ...nodes));
all.render();
await all.renderUntilSettled();
const { inspectBlockPadGeometry } = await import('../../src/blocks/test-block');
const { schematicHash } = await import('../../src/blocks/review');
const imports = {
    schema: 'moki.import-map/1' as const,
    inputHash: schematicHash(plan, blocks),
    parts: mapping,
  },
  circuit = all.getCircuitJson();
const gates = plan.blocks.map((i: any) => {
  const block = blocks.find((b) => b.id === i.block && b.version === i.version)!;
  const { contentHash, status, provenance, ...fields } = block;
  return {
    inst: i.inst,
    ...inspectBlockPadGeometry(
      {
        ...fields,
        provenance: {
          author: provenance.author,
          ...(provenance.authorId ? { authorId: provenance.authorId } : {}),
        },
      },
      plan,
      blocks,
      circuit,
      imports,
    ),
  };
});
const base = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/full-template/';
await writeFile(
  base + 'pad-port-diagnostic.json',
  JSON.stringify(
    {
      scope:
        'Actual native imported pad-to-port evidence only. Routing disabled; authored placement still has known overlaps. Not a DRC pass.',
      gates,
    },
    null,
    2,
  ),
);
await writeFile(base + 'associated-port-fixture.json', JSON.stringify({ circuit }, null, 2));
await writeFile(base + 'associated-port-import-map.json', JSON.stringify(imports, null, 2));
console.log(
  JSON.stringify(
    gates.map((g: any) => ({
      inst: g.inst,
      ok: g.ok,
      issues: g.issues.filter((i: any) => i.severity === 'error'),
    })),
  ),
);
if (gates.some((g: any) => !g.ok)) process.exitCode = 2;
