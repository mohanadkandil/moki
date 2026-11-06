import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BlockDef,
  BlockDraft,
  BlockTestReceipt,
  BoardPlan,
  CatalogPart,
  GateResult,
  PinMap,
} from './contract.js';
import { checkBlockDraft as checkDraft, checkPlan as checkGraph, pinMap as mapPins } from './erc.js';
import { getPart as lookupPart } from './catalog.js';

const dataRoot = fileURLToPath(new URL('./data/', import.meta.url));
const storeRoot = () => resolve(process.env.MOKI_BLOCK_LIBRARY_DIR ?? 'var/block-library');
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
export const contentHash = (draft: BlockDraft): string =>
  createHash('sha256').update(canonical(draft)).digest('hex');
const read = (path: string, fallback: any) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
};
const records = new Map<string, CatalogPart>();
function catalog() {
  for (const file of ['parts.json', 'discrete-parts.json'])
    for (const p of read(join(dataRoot, file), []) as CatalogPart[]) records.set(`${p.lcsc}:${p.catalogReceipt}`, p);
  for (const file of existsSync(join(storeRoot(), 'parts')) ? readdirSync(join(storeRoot(), 'parts')) : []) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const p = read(join(storeRoot(), 'parts', file), null) as CatalogPart;
    if (p) records.set(`${p.lcsc}:${p.catalogReceipt}`, p);
  }
  return records;
}
function partMap(draft: BlockDraft): Map<string, CatalogPart> {
  const known = catalog();
  const out = new Map<string, CatalogPart>();
  for (const p of draft.parts ?? []) {
    const c = known.get(`${p.lcsc}:${p.catalogReceipt}`);
    if (c) out.set(p.lcsc, c);
  }
  return out;
}
export async function registerPart(lcsc: string): Promise<CatalogPart> {
  const p = await lookupPart(lcsc);
  records.set(`${p.lcsc}:${p.catalogReceipt}`, p);
  const path = join(
    storeRoot(),
    'parts',
    createHash('sha256').update(`${p.lcsc}:${p.catalogReceipt}`).digest('hex') + '.json',
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(p, null, 2));
  return p;
}
/** Immutable part revision; fresh supplier/stock captures must not invalidate saved blocks. */
export function catalogPart(lcsc: string, receipt: string): CatalogPart {
  const p = catalog().get(`${lcsc}:${receipt}`);
  if (!p) throw new Error(`Pinned catalog receipt is unavailable: ${lcsc} ${receipt}`);
  return structuredClone(p);
}
export function checkBlockDraft(draft: BlockDraft): GateResult[] {
  return checkDraft(draft, partMap(draft));
}
export function materializeDraft(draft: BlockDraft): BlockDef {
  const gates = checkBlockDraft(draft);
  const issues = gates.flatMap((g) => g.issues.filter((x) => x.severity === 'error'));
  if (issues.length) throw new Error(issues.map((x) => `${x.where ?? draft.id}: ${x.message}`).join('; '));
  return {
    ...structuredClone(draft),
    contentHash: contentHash(draft),
    status: 'unreviewed',
    provenance: { ...draft.provenance, reviews: [] },
  };
}
const identity = (id: string, version: number) => {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(id) || !Number.isSafeInteger(version) || version < 1)
    throw new Error('Invalid block identity');
  return `${id}@${version}`;
};
function trusted(block: BlockDef): BlockDef {
  const { contentHash: hash, status: _status, provenance, ...fields } = block;
  const draft = {
    ...fields,
    provenance: {
      author: provenance.author,
      ...(provenance.authorId ? { authorId: provenance.authorId } : {}),
    },
  } as BlockDraft;
  if (hash !== contentHash(draft))
    throw new Error(`Block content changed without a new revision: ${block.id}`);
  const reviews = provenance.reviews ?? [];
  const passing = reviews
    .filter(
      (x) => x.contentHash === hash && x.by !== provenance.authorId && Number.isFinite(Date.parse(x.at)),
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .at(-1);
  return { ...block, status: passing?.verdict === 'pass' ? 'reviewed' : 'unreviewed' };
}
function blocksWithHistory(): BlockDef[] {
  const all = new Map<string, BlockDef>();
  for (const file of ['seed.json', 'discrete-blocks.json'])
    for (const b of read(join(dataRoot, file), []) as BlockDef[]) all.set(identity(b.id, b.version), trusted(b));
  const root = join(storeRoot(), 'blocks');
  for (const file of existsSync(root) ? readdirSync(root) : []) {
    if (!/^[a-z][a-z0-9-]*@[1-9][0-9]*\.json$/.test(file)) continue;
    const b = trusted(read(join(root, file), null));
    all.set(identity(b.id, b.version), b);
  }
  return [...all.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}
export function listBlocks(): BlockDef[] {
  const latest = new Map<string, BlockDef>();
  for (const b of blocksWithHistory())
    if (!latest.has(b.id) || latest.get(b.id)!.version < b.version) latest.set(b.id, b);
  return [...latest.values()];
}
export function getBlock(id: string, version?: number): BlockDef | undefined {
  return blocksWithHistory()
    .filter((b) => b.id === id && (version === undefined || b.version === version))
    .at(-1);
}
export function resolvePlanBlocks(plan: BoardPlan, provided: BlockDef[] = blocksWithHistory()): BlockDef[] {
  const defs = new Map(provided.map((b) => [identity(b.id, b.version), trusted(b)]));
  for (const draft of plan.drafts ?? []) {
    const b = materializeDraft(draft);
    const key = identity(b.id, b.version);
    if (defs.has(key) && defs.get(key)!.contentHash !== b.contentHash)
      throw new Error(`Inline draft conflicts with a cached block revision: ${key}`);
    defs.set(key, b);
  }
  return [...defs.values()];
}
const failure = (error: unknown): GateResult[] => [
  {
    gate: 'erc',
    ok: false,
    issues: [
      {
        rule: 'block-resolution',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  },
  {
    gate: 'power',
    ok: false,
    issues: [
      {
        rule: 'block-resolution',
        severity: 'error',
        message: 'Power check unavailable until the block definitions are valid',
      },
    ],
  },
];
export function checkPlan(plan: BoardPlan, blocks?: BlockDef[]): GateResult[] {
  try {
    return checkGraph(plan, resolvePlanBlocks(plan, blocks));
  } catch (error) {
    return failure(error);
  }
}
export function pinMap(plan: BoardPlan, blocks?: BlockDef[]): PinMap {
  return mapPins(plan, resolvePlanBlocks(plan, blocks));
}
export async function saveBlockDraft(draft: BlockDraft): Promise<BlockDef> {
  for (const p of draft.parts)
    if (!catalog().has(`${p.lcsc}:${p.catalogReceipt}`)) {
      const actual = await registerPart(p.lcsc);
      if (actual.catalogReceipt !== p.catalogReceipt)
        throw new Error(`Get the current verified catalog receipt before saving ${p.lcsc}`);
    }
  const b = materializeDraft(draft);
  const root = join(storeRoot(), 'blocks');
  mkdirSync(root, { recursive: true });
  const path = join(root, identity(b.id, b.version) + '.json');
  const existing = read(path, null);
  if (existing && existing.contentHash !== b.contentHash)
    throw new Error('Block revision is immutable; increment version for an edit');
  if (!existing) writeFileSync(path, JSON.stringify(b, null, 2), { flag: 'wx' });
  return existing ? trusted(existing) : b;
}
/** Internal reviewer operation; never part of the author/draft JSON endpoint. */
export function recordIndependentReview(
  id: string,
  version: number,
  review: BlockDef['provenance']['reviews'][number],
  test: BlockTestReceipt,
): BlockDef {
  const b = getBlock(id, version);
  if (!b) throw new Error('Unknown block revision');
  const required = ['erc', 'power', 'drc', 'spice', 'block-test', ...(b.mcu ? ['compile'] : [])];
  if (
    !review.by ||
    review.by === b.provenance.authorId ||
    !['pass', 'fail'].includes(review.verdict) ||
    !Number.isFinite(Date.parse(review.at)) ||
    review.contentHash !== b.contentHash ||
    test.contentHash !== b.contentHash ||
    required.some((g) => test.gates.filter((x) => x.gate === g).length !== 1) ||
    test.gates.some((g) => !g.ok || g.issues.some((x) => x.severity === 'error'))
  )
    throw new Error('Promotion needs an independent exact-hash review and all passing block gates');
  const updated = trusted({
    ...b,
    provenance: { ...b.provenance, reviews: [...b.provenance.reviews, review] },
  });
  const root = join(storeRoot(), 'blocks');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, identity(id, version) + '.json'), JSON.stringify(updated, null, 2));
  return updated;
}
