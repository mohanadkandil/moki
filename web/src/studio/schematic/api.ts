// The schematic's side of the board API. Its contract is docs/engineering/2026-11-06-schematic/op-contract.md.
import { useEffect, useState } from 'react';
import type { BoardPlan } from '../../../../src/blocks/contract';
import type { CircuitDesign } from '../../../../src/circuit/model';
import { atBase } from '../../board/base';
import type { SheetOp } from './ops';
import type { BlockInfo, SheetGraph } from './sheet';

export interface CheckResult {
  ok: boolean;
  /** One sentence for the maker. */
  reason?: string;
  /** With no plan or design, this op can't apply at all. With one, the draft can be drawn but not built yet. */
  opIndex?: number;
  changes?: string[];
  warnings?: string[];
  /** This edit changes a reviewed plan, so it has to go through the agent's review to build. */
  needsReview?: boolean;
  design?: CircuitDesign;
  plan?: BoardPlan;
  /** Left out when a half-wired plan can't be drawn yet. */
  graph?: SheetGraph;
}

/** The server's verdict on a whole draft. Null means it couldn't be asked, so Apply gets the last word instead. */
export async function checkOps(baseJobId: string, ops: readonly SheetOp[], signal?: AbortSignal): Promise<CheckResult | null> {
  try {
    const res = await fetch(atBase('/api/board/ops/check'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseJobId, ops }), ...(signal ? { signal } : {}) });
    if (!(res.headers.get('content-type') ?? '').includes('json') || !res.ok) return null;
    return (await res.json()) as CheckResult;
  } catch {
    return null;
  }
}

export type LibraryMode = 'carrier' | 'chip';
export interface LibraryModule { id: string; name: string; category: string; pins: number }
export interface Library { modules: LibraryModule[]; blocks: BlockInfo[] }

const seen = new Map<string, Promise<Library>>();

export function fetchLibrary(mode: LibraryMode, q = ''): Promise<Library> {
  const key = `${mode}?${q}`;
  const known = seen.get(key);
  if (known) return known;
  const query = new URLSearchParams({ mode, ...(q ? { q } : {}) });
  const next = fetch(atBase(`/api/board/library?${query}`), { cache: 'no-store' }).then(async res => {
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('The library isn’t available right now.');
    const body = (await res.json()) as Partial<Library>;
    return { modules: body.modules ?? [], blocks: body.blocks ?? [] };
  });
  next.catch(() => seen.delete(key));
  seen.set(key, next);
  return next;
}

/** Every block, for the ports on a chip sheet. Null until it's answered, and empty if it can't be, so a sheet can wait and not pop its ports in. */
export function useChipBlocks(enabled: boolean): readonly BlockInfo[] | null {
  const [blocks, setBlocks] = useState<readonly BlockInfo[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchLibrary('chip').then(lib => { if (live) setBlocks(lib.blocks); }, () => { if (live) setBlocks([]); });
    return () => { live = false; };
  }, [enabled]);
  return blocks;
}
