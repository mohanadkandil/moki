import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BoardPlan, BlockDef, GateResult } from './contract.js';
import { resolvePlanBlocks } from './library.js';

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
export function schematicHash(plan: BoardPlan, blocks: BlockDef[] = resolvePlanBlocks(plan)): string {
  const { app: _app, board: _board, ...rest } = plan;
  const data = {
    ...rest,
    blocks: plan.blocks
      .map(({ at: _at, ...i }) => ({
        ...i,
        contentHash: blocks.find((b) => b.id === i.block && b.version === i.version)?.contentHash,
      }))
      .sort((a, b) => a.inst.localeCompare(b.inst)),
  };
  return createHash('sha256').update(canonical(data)).digest('hex');
}
const directory = () => resolve(process.env.MOKI_SCHEMATIC_REVIEWS_DIR ?? 'var/schematic-reviews');
export interface SchematicReview {
  by: string;
  findings: unknown[];
}
/** Trusted controller only: call AFTER its independent review/citation validator passes. */
export function recordSchematicReview(plan: BoardPlan, review: SchematicReview, blocks?: BlockDef[]): string {
  if (!review.by.trim() || !Array.isArray(review.findings) || !review.findings.length)
    throw new Error('Independent schematic review needs identity and findings');
  const hash = schematicHash(plan, blocks);
  mkdirSync(directory(), { recursive: true });
  writeFileSync(
    resolve(directory(), hash + '.json'),
    JSON.stringify(
      {
        schema: 'moki.schematic-review/1',
        hash,
        by: review.by,
        findings: review.findings,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return hash;
}
export function checkSchematicReview(plan: BoardPlan, blocks?: BlockDef[]): GateResult {
  const hash = schematicHash(plan, blocks);
  let receipt: any;
  try {
    receipt = JSON.parse(readFileSync(resolve(directory(), hash + '.json'), 'utf8'));
  } catch {}
  const ok =
    receipt?.schema === 'moki.schematic-review/1' &&
    receipt.hash === hash &&
    typeof receipt.by === 'string' &&
    receipt.by.trim() &&
    Array.isArray(receipt.findings) &&
    receipt.findings.length > 0;
  return {
    gate: 'review',
    ok: Boolean(ok),
    issues: ok
      ? []
      : [
          {
            rule: 'independent-schematic-review',
            severity: 'error',
            message:
              'An independent, code-validated schematic review is required for this electrical plan before layout',
          },
        ],
  };
}
