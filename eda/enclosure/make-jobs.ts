// Dev tool: writes one job dir per template (board.tsx, design.json), ready for eda/render.ts and eda/enclosure.ts.
//   bun eda/enclosure/make-jobs.ts <root>
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateBoardSource } from '../../src/board/codegen.ts';
import { EXAMPLE_BRIEFS, interpretBrief } from '../../src/circuit/interpret.ts';
import { buildDesign } from '../../src/circuit/templates.ts';

const root = process.argv[2];
if (!root) throw new Error('Usage: bun eda/enclosure/make-jobs.ts <root>');
for (const example of EXAMPLE_BRIEFS) {
  const result: any = interpretBrief(example.brief, example.template);
  const design = buildDesign(result.interpretation ?? result);
  const dir = `${root}/${example.template}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/design.json`, JSON.stringify(design, null, 2));
  writeFileSync(`${dir}/board.tsx`, generateBoardSource(design));
  console.log(example.template, design.parts.map((p: any) => `${p.id}:${p.module}`).join(' '));
}
