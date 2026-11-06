// The board a plan needs, from the footprints the job will really use and the same packing the job will really run.
// An agent asks this before a build, so a board size is never a model's guess. Prints one JSON line.
// `bun eda/blocks/board-size.ts plan.json`
import { readFile } from 'node:fs/promises';
import type { BlockPart, BoardPlan } from '../../src/blocks/contract.js';
import { planGraph } from '../../src/blocks/graph.js';
import { catalogPart, resolvePlanBlocks } from '../../src/blocks/library.js';
import { placePlanSections } from './auto-placement';
import { ensurePart } from './imported';

/** Room past the packed minimum, for copper to get between sections. A reserved envelope only keeps 1 mm around each one. */
const ROUTING_MARGIN_MM = 6;

const plan = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as BoardPlan;
const { board: asked, ...free } = plan;
const blocks = resolvePlanBlocks(plan);
const graph = planGraph(plan, blocks);
const imports = new Map<BlockPart, unknown>();
for (const { part } of graph.parts) if (!imports.has(part)) imports.set(part, await ensurePart(part, catalogPart(part.lcsc, part.catalogReceipt)));
const place = (target: BoardPlan) => placePlanSections(target, graph, imports as Map<BlockPart, any>);
const packs = (target: NonNullable<BoardPlan['board']>) => { try { place({ ...free, board: target }); return true; } catch { return false; } };
const limit = (free.requirements ?? []).filter(r => r.metric === 'board_size_mm' && Array.isArray(r.value)).map(r => r.value as [number, number]);
const within = (mm: number, axis: 0 | 1) => Math.min(mm, ...limit.map(value => value[axis]));

let out: Record<string, unknown>;
try {
  const automatic = place(free), minimum = automatic.plan.board!;
  const roomy = { ...minimum, widthMm: within(minimum.widthMm + ROUTING_MARGIN_MM, 0), heightMm: within(minimum.heightMm + ROUTING_MARGIN_MM, 1) };
  out = {
    minimum,
    chosen: packs(roomy) ? roomy : minimum,
    sections: automatic.placements.map(p => ({ inst: p.inst, widthMm: +(p.reserved.maxX - p.reserved.minX).toFixed(2), heightMm: +(p.reserved.maxY - p.reserved.minY).toFixed(2) })),
    ...(asked ? { fits: packs(asked) } : {}),
  };
} catch (error) { out = { impossible: error instanceof Error ? error.message : String(error) }; }
console.log(JSON.stringify(out));
