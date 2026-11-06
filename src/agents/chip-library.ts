// chip_eda's block library, as the chip-level agents see it. A server only offers chip mode once this is switched on.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BoardPlan } from '../blocks/contract.js';
import { runWorker } from '../board/process.js';
import { checkBlockDraft, checkPlan, draftToBlock, factsFromPlan, getPart, listBlocks, pinMap, runSpiceChecks, searchParts } from '../blocks/index.js';
import { planGraph, type PlanGraph, type PlacedPart } from '../blocks/graph.js';
import { catalogPart, resolvePlanBlocks } from '../blocks/library.js';
import { recordSchematicReview } from '../blocks/review.js';
import type { SheetGraph } from './protocol.js';
import type { BoardSizing, ChipLibrary } from './chip.js';
import { datasheetStore } from './datasheet.js';

/** The drawing the canvas needs, without the block library it doesn't have. */
export function sheetGraph(graph: PlanGraph): SheetGraph {
  return {
    parts: graph.parts.map(placed => {
      const { ref, inst, block, part } = placed;
      return { ref, inst, title: block.title, mpn: part.mpn, ...(part.value ? { value: part.value } : {}), pins: sheetPins(placed) };
    }),
    nets: graph.nets.map(net => ({ name: net.name, pins: [...new Map(net.pins.map(pin => [`${pin.ref}.${pin.pad}`, { ref: pin.ref, pin: pin.pad }])).values()] })),
  };
}

const JUST_A_NUMBER = /^(pin)?\d+$/i;

/** The same names the built sheet uses: what the datasheet calls each pad, so a part keeps its shape when the build lands. */
function sheetPins({ part }: PlacedPart): SheetGraph['parts'][number]['pins'] {
  let named: Map<string, string[]>;
  try { named = new Map(catalogPart(part.lcsc, part.catalogReceipt).pins.map(pin => [pin.pad, pin.labels])); }
  catch { named = new Map(); }
  const pins = new Map<string, SheetGraph['parts'][number]['pins'][number]>();
  for (const [logical, pin] of Object.entries(part.pins)) {
    if (pins.has(pin.pad)) continue;
    const label = named.get(pin.pad)?.find(text => !JUST_A_NUMBER.test(text)) ?? (JUST_A_NUMBER.test(logical) ? pin.pad : logical);
    pins.set(pin.pad, { id: pin.pad, label, role: pin.role });
  }
  return [...pins.values()];
}

/** The catalog service answers HTTP 500 now and then. A retry costs nothing, and a failed search costs a model call. */
export async function withRetries<T>(run: () => Promise<T>, waits: readonly number[] = [800, 2000, 4000]): Promise<T> {
  for (const wait of waits) {
    try { return await run(); }
    catch { await new Promise(done => setTimeout(done, wait)); }
  }
  return run();
}

/** Packing needs the real footprints, which only load in the EDA worker. The same plan packs the same way, so a repeat costs nothing. */
export function boardSizer(run: (planPath: string, signal?: AbortSignal) => Promise<{ code: number; stdout: string; stderr: string }> = (planPath, signal) => runWorker(process.env.MOKI_BUN ?? resolve(homedir(), '.bun/bin/bun'), [resolve('eda/blocks/board-size.ts'), planPath], process.cwd(), 90_000, {}, signal)) {
  const sized = new Map<string, BoardSizing>();
  return async (plan: BoardPlan, signal?: AbortSignal): Promise<BoardSizing> => {
    const { app: _app, sections: _sections, title: _title, ...shape } = plan;
    const key = JSON.stringify(shape);
    const known = sized.get(key);
    if (known) return known;
    const dir = await mkdtemp(join(tmpdir(), 'moki-board-size-'));
    try {
      const planPath = join(dir, 'plan.json');
      await writeFile(planPath, JSON.stringify(plan));
      const out = await run(planPath, signal);
      if (out.code !== 0) throw new Error(`Board sizing failed (exit ${out.code}): ${out.stderr.slice(-2000)}`);
      const result = JSON.parse(out.stdout.trim().split('\n').at(-1)!) as BoardSizing;
      if (sized.size >= 32) sized.clear();
      sized.set(key, result);
      return result;
    } finally { await rm(dir, { recursive: true, force: true }); }
  };
}

export function realChipLibrary(): ChipLibrary {
  return {
    sizeBoard: boardSizer(),
    blocks: () => listBlocks(),
    // A saved plan keeps the block revisions it was built with, and those aren't all in the latest listing.
    planBlocks: plan => resolvePlanBlocks(plan),
    checkPlan: (plan: BoardPlan, blocks) => checkPlan(plan, blocks),
    pinMap: (plan: BoardPlan, blocks) => pinMap(plan, blocks),
    searchParts: query => withRetries(() => searchParts(query)),
    getPart: lcsc => getPart(lcsc),
    checkBlockDraft: draft => checkBlockDraft(draft),
    draftToBlock: draft => draftToBlock(draft),
    runSpiceChecks: (plan, blocks) => runSpiceChecks(plan, blocks),
    factsFromPlan: (plan, blocks, spice) => factsFromPlan(plan, blocks, spice),
    planGraph: (plan, blocks) => sheetGraph(planGraph(plan, blocks)),
    planNets: (plan, blocks) => planGraph(plan, blocks).nets,
    blockHistory: () => resolvePlanBlocks({ schema: 'moki.plan/1', title: '', layers: 2, blocks: [], links: [] }),
    recordSchematicReview: (plan, review, blocks) => recordSchematicReview(plan, review, blocks),
    datasheets: datasheetStore(),
  };
}
